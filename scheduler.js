const cron = require('node-cron');
const { logger } = require('./utils/logger');
const { database } = require('./utils/database');
const { telegram } = require('./utils/telegram');
const SonicBundleHunter = require('./sonic_bundle_hunter');
const config = require('./config');

class Scheduler {
  constructor() {
    this.scheduledTasks = [];
    this.isRunning = false;
  }

  init() {
    logger.info('Initializing scheduler...');

    // Send startup notification
    if (config.telegram.enabled) {
      telegram.sendStartupNotification();
    }

    // Schedule periodic searches
    this.scheduleSearches();

    // Schedule daily report
    this.scheduleDailyReport();

    // Schedule weekly report
    this.scheduleWeeklyReport();

    // Schedule database cleanup
    this.scheduleCleanup();

    logger.info('Scheduler initialized');
  }

  scheduleSearches() {
    if (!config.scheduling.enabled) {
      logger.info('Scheduling disabled - searches will run manually only');
      return;
    }

    const interval = config.scheduling.searchIntervalMinutes;
    const cronPattern = `*/${interval} * * * *`; // Every N minutes

    const task = cron.schedule(cronPattern, async () => {
      if (this.isRunning) {
        logger.info('Search already running, skipping this cycle');
        return;
      }

      try {
        this.isRunning = true;
        logger.info(`🕐 Starting scheduled search (${new Date().toLocaleString()})`);

        const hunter = new SonicBundleHunter();
        await hunter.run();

        // Update daily stats
        await database.updateStats(new Date().toISOString().split('T')[0], hunter.stats);

        logger.info(`✅ Scheduled search completed`);
      } catch (error) {
        logger.error(`Error in scheduled search: ${error.message}`);
        if (config.telegram.enabled) {
          await telegram.sendErrorAlert(error);
        }
      } finally {
        this.isRunning = false;
      }
    });

    this.scheduledTasks.push({ name: 'searches', task });
    logger.info(`📅 Searches scheduled to run every ${interval} minutes`);
  }

  scheduleDailyReport() {
    if (!config.scheduling.enabled) {
      return;
    }

    const hour = config.scheduling.dailyReportHour;
    const cronPattern = `0 ${hour} * * *`; // Every day at specified hour

    const task = cron.schedule(cronPattern, async () => {
      try {
        logger.info(`📊 Generating daily report (${new Date().toLocaleString()})`);

        const stats = await database.getDailyStats(1);
        const platformBreakdown = await database.getPlatformBreakdown();

        if (stats.length > 0 && config.telegram.enabled) {
          await telegram.sendDailySummary(stats[0], platformBreakdown);
        }

        logger.info('✅ Daily report sent');
      } catch (error) {
        logger.error(`Error generating daily report: ${error.message}`);
      }
    });

    this.scheduledTasks.push({ name: 'daily-report', task });
    logger.info(`📅 Daily report scheduled for ${hour}:00`);
  }

  scheduleWeeklyReport() {
    if (!config.scheduling.enabled) {
      return;
    }

    const day = config.scheduling.weeklyReportDay;
    const hour = config.scheduling.weeklyReportHour;
    const cronPattern = `0 ${hour} * * ${day}`; // Every week on specified day and hour

    const task = cron.schedule(cronPattern, async () => {
      try {
        logger.info(`📈 Generating weekly report (${new Date().toLocaleString()})`);

        const weeklyStats = await database.getWeeklyReport();

        if (weeklyStats && config.telegram.enabled) {
          await telegram.sendWeeklyReport(weeklyStats);
        }

        logger.info('✅ Weekly report sent');
      } catch (error) {
        logger.error(`Error generating weekly report: ${error.message}`);
      }
    });

    this.scheduledTasks.push({ name: 'weekly-report', task });
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    logger.info(`📅 Weekly report scheduled for ${dayNames[day]} at ${hour}:00`);
  }

  scheduleCleanup() {
    const cronPattern = '0 3 * * *'; // Every day at 3 AM

    const task = cron.schedule(cronPattern, async () => {
      try {
        logger.info('🧹 Cleaning old database entries...');

        await database.cleanOldData(config.results.maxHistoryDays || 90);

        logger.info('✅ Database cleanup completed');
      } catch (error) {
        logger.error(`Error during database cleanup: ${error.message}`);
      }
    });

    this.scheduledTasks.push({ name: 'cleanup', task });
    logger.info('📅 Database cleanup scheduled for daily at 3:00 AM');
  }

  stop() {
    logger.info('Stopping scheduler...');

    this.scheduledTasks.forEach(({ name, task }) => {
      task.stop();
      logger.info(`Stopped: ${name}`);
    });

    this.scheduledTasks = [];

    logger.info('Scheduler stopped');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      schedulingEnabled: config.scheduling.enabled,
      searchInterval: config.scheduling.searchIntervalMinutes,
      scheduledTasks: this.scheduledTasks.map(t => t.name),
      nextRun: this.scheduledTasks.length > 0 ? 'Every ' + config.scheduling.searchIntervalMinutes + ' minutes' : 'Not scheduled'
    };
  }
}

// Run scheduler if this file is executed directly
if (require.main === module) {
  const scheduler = new Scheduler();
  scheduler.init();

  console.log('Scheduler is running. Press Ctrl+C to stop.');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping scheduler gracefully...');

    if (config.telegram.enabled) {
      await telegram.sendShutdownNotification({ searches: 0, itemsFound: 0, profitableDeals: 0, totalPotentialProfit: 0 });
    }

    scheduler.stop();
    database.close();

    console.log('Scheduler stopped.');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Stopping scheduler gracefully...');
    scheduler.stop();
    database.close();
    process.exit(0);
  });
}

module.exports = Scheduler;
