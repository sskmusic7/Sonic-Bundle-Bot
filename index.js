#!/usr/bin/env node

/**
 * Sonic Bundle Bot - Main Entry Point
 * Autonomous Sonic collectible hunting with scheduling and notifications
 */

const { logger } = require('./utils/logger');
const { database } = require('./utils/database');
const { telegram } = require('./utils/telegram');
const Scheduler = require('./scheduler');
const SonicBundleHunter = require('./sonic_bundle_hunter');
const config = require('./config');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'run';

async function main() {
  logger.info('🚀 Starting Sonic Bundle Bot v2.0 (Autonomous)');

  try {
    switch (command) {
      case 'run':
      case 'hunt':
        // Single run mode
        logger.info('📋 Mode: Single run');
        const hunter = new SonicBundleHunter();
        await hunter.run();
        break;

      case 'schedule':
      case 'daemon':
        // Scheduled mode (autonomous)
        logger.info('📋 Mode: Scheduled/Autonomous');
        const scheduler = new Scheduler();
        scheduler.init();

        // Keep process running
        logger.info('✅ Scheduler active. Press Ctrl+C to stop.');
        await new Promise(() => {}); // Keep running forever
        break;

      case 'stats':
        // Show statistics
        logger.info('📊 Fetching statistics...');
        await showStats();
        break;

      case 'test':
        // Test mode - single platform, minimal search
        logger.info('🧪 Mode: Test');
        await testMode();
        break;

      case 'setup':
        // Setup mode
        logger.info('🔧 Running setup...');
        await setupMode();
        break;

      default:
        logger.error(`Unknown command: ${command}`);
        console.log(`
Usage: node index.js [command]

Commands:
  run, hunt        - Run single search and exit (default)
  schedule, daemon - Run in autonomous mode with scheduling
  stats            - Show database statistics
  test             - Run test mode (minimal search)
  setup            - Run setup and configuration

Examples:
  node index.js run
  node index.js schedule
  node index.js stats
        `);
        process.exit(1);
    }
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    if (config.telegram.enabled) {
      await telegram.sendErrorAlert(error);
    }
    process.exit(1);
  } finally {
    database.close();
  }
}

async function showStats() {
  const profitableItems = await database.getProfitableItems(10);
  const viableBundles = await database.getViableBundles(5);
  const dailyStats = await database.getDailyStats(7);
  const platformBreakdown = await database.getPlatformBreakdown();
  const weeklyReport = await database.getWeeklyReport();

  console.log('\n📊 Sonic Flipper Statistics\n');
  console.log('═'.repeat(50));

  // Weekly summary
  if (weeklyReport) {
    console.log('\n📈 Weekly Summary:');
    console.log(`  Searches: ${weeklyReport.total_searches}`);
    console.log(`  Items Found: ${weeklyReport.total_items_found}`);
    console.log(`  Profitable Deals: ${weeklyReport.total_profitable_deals}`);
    console.log(`  Potential Profit: $${weeklyReport.total_potential_profit?.toFixed(2) || '0.00'}`);
    console.log(`  Purchases: ${weeklyReport.total_purchases}`);
    console.log(`  Sales: ${weeklyReport.total_sales}`);
    console.log(`  Actual Profit: $${weeklyReport.total_actual_profit?.toFixed(2) || '0.00'}`);
  }

  // Daily stats
  console.log('\n📅 Daily Stats (Last 7 Days):');
  dailyStats.forEach(stat => {
    console.log(`  ${stat.date}: ${stat.profitable_deals} deals, $${stat.total_potential_profit?.toFixed(2) || '0.00'} potential`);
  });

  // Platform breakdown
  console.log('\n🏪 Platform Breakdown:');
  platformBreakdown.forEach(p => {
    console.log(`  ${p.platform}: ${p.item_count} items, ${p.profitable_count} profitable, avg $${p.avg_profit?.toFixed(2) || '0.00'}`);
  });

  // Top deals
  console.log('\n💰 Top 10 Profitable Deals:');
  profitableItems.forEach((item, i) => {
    console.log(`  ${i + 1}. $${item.net_profit?.toFixed(2) || '0.00'} (${item.margin}%) - ${item.title.substring(0, 50)}...`);
  });

  // Viable bundles
  console.log('\n📦 Viable Bundles:');
  viableBundles.forEach((bundle, i) => {
    console.log(`  ${i + 1}. $${bundle.net_profit?.toFixed(2) || '0.00'} (${bundle.net_margin}) - ${bundle.bundle_name}`);
  });

  console.log('\n' + '═'.repeat(50) + '\n');
}

async function testMode() {
  console.log('\n🧪 Test Mode - Searching eBay for "GE Sonic plush"...\n');

  // Temporarily enable only eBay for testing
  const originalConfig = { ...config };
  config.platforms.ebay.enabled = true;
  config.platforms.mercari.enabled = false;
  config.platforms.facebook.enabled = false;
  config.platforms.offerup.enabled = false;
  config.platforms.poshmark.enabled = false;
  config.platforms.depop.enabled = false;
  config.platforms.etsy.enabled = false;
  config.platforms.shopgoodwill.enabled = false;

  config.strategy.targetItems = ['GE Sonic plush'];
  config.search.maxResultsPerPlatform = 5;

  const hunter = new SonicBundleHunter();
  await hunter.run();

  // Restore original config
  Object.assign(config, originalConfig);
}

async function setupMode() {
  console.log('\n🔧 Sonic Bundle Bot Setup\n');
  console.log('1. Installing dependencies...');
  console.log('   Run: npm install\n');

  console.log('\n2. Installing Playwright browser...');
  console.log('   Run: npx playwright install chromium\n');

  console.log('\n3. Setting up Telegram (optional but recommended):');
  console.log('   a. Create a bot: https://t.me/BotFather');
  console.log('   b. Get your bot token');
  console.log('   c. Get your chat ID (message @userinfobot)');
  console.log('   d. Set environment variables:');
  console.log('      export TELEGRAM_BOT_TOKEN="your_token_here"');
  console.log('      export TELEGRAM_CHAT_ID="your_chat_id_here"\n');

  console.log('\n4. Configure settings:');
  console.log('   Edit config.js to customize:');
  console.log('   - Target items and search terms');
  console.log('   - Price limits and profit margins');
  console.log('   - Platform preferences');
  console.log('   - Scheduling intervals\n');

  console.log('\n5. Run the bot:');
  console.log('   Single run:  node index.js run');
  console.log('   Autonomous: node index.js schedule\n');

  console.log('✅ Setup complete!\n');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('\n🛑 Shutting down gracefully...');
  database.close();

  if (config.telegram.enabled) {
    // We don't have stats here, but we can send a shutdown notification
    await telegram.sendShutdownNotification({
      searches: 0,
      itemsFound: 0,
      profitableDeals: 0,
      totalPotentialProfit: 0
    });
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('\n🛑 Shutting down gracefully...');
  database.close();
  process.exit(0);
});

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
