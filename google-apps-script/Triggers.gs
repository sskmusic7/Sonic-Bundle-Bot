/**
 * Trigger Management for Sonic Bundle Bot
 * Setup and manage time-based triggers
 */

/**
 * Set up all triggers for the bot
 * Run this function once to enable autonomous operation
 */
function setupTriggers() {
  Logger.log('🔧 Setting up triggers...');

  // Delete existing triggers
  deleteTriggers();

  // Set up search trigger
  setupSearchTrigger();

  // Set up daily report trigger
  setupDailyReportTrigger();

  // Set up weekly report trigger
  setupWeeklyReportTrigger();

  Logger.log('✅ All triggers set up successfully!');
  listTriggers();
}

/**
 * Set up the main search trigger
 */
function setupSearchTrigger() {
  const trigger = ScriptApp.newTrigger('runScheduledSearch')
    .timeBased()
    .everyMinutes(CONFIG.SEARCH_INTERVAL_MINUTES)
    .create();

  Logger.log(`✅ Search trigger set to run every ${CONFIG.SEARCH_INTERVAL_MINUTES} minutes`);
}

/**
 * Set up daily report trigger
 */
function setupDailyReportTrigger() {
  const trigger = ScriptApp.newTrigger('generateDailyReport')
    .timeBased()
    .atHour(CONFIG.DAILY_REPORT_HOUR)
    .everyDays(1)
    .create();

  Logger.log(`✅ Daily report trigger set for ${CONFIG.DAILY_REPORT_HOUR}:00`);
}

/**
 * Set up weekly report trigger
 */
function setupWeeklyReportTrigger() {
  const trigger = ScriptApp.newTrigger('generateWeeklyReport')
    .timeBased()
    .onWeekDay(CONFIG.WEEKLY_REPORT_DAY)
    .atHour(CONFIG.WEEKLY_REPORT_HOUR)
    .create();

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  Logger.log(`✅ Weekly report trigger set for ${days[CONFIG.WEEKLY_REPORT_DAY]} at ${CONFIG.WEEKLY_REPORT_HOUR}:00`);
}

/**
 * Delete all triggers
 */
function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  if (triggers.length === 0) {
    Logger.log('No existing triggers to delete.');
    return;
  }

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
    Logger.log(`🗑️  Deleted trigger: ${trigger.getHandlerFunction()}`);
  }

  Logger.log(`✅ Deleted ${triggers.length} triggers`);
}

/**
 * List all active triggers
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  if (triggers.length === 0) {
    Logger.log('No active triggers.');
    return;
  }

  Logger.log('📋 Active Triggers:');
  Logger.log('═'.repeat(50));

  for (const trigger of triggers) {
    Logger.log(`Handler: ${trigger.getHandlerFunction()}`);
    Logger.log(`Trigger Source: ${trigger.getTriggerSource()}`);
    Logger.log(`Unique ID: ${trigger.getUniqueId()}`);
    Logger.log('─'.repeat(30));
  }
}

/**
 * Generate daily report
 */
function generateDailyReport() {
  Logger.log('📊 Generating daily report...');

  try {
    const today = new Date();
    const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    // Get today's data from Google Sheet
    const stats = getDailyStats(dateStr);

    if (!stats) {
      Logger.log('No data for today');
      return;
    }

    // Send Telegram notification
    const message = `
📊 *Daily Report - Sonic Flipper*

📅 ${dateStr}

🔍 Searches: ${stats.searches || 0}
📦 Items Found: ${stats.itemsFound || 0}
💰 Profitable Deals: ${stats.profitableDeals || 0}
💵 Potential Profit: $${(stats.totalProfit || 0).toFixed(2)}

_Generated at ${new Date().toLocaleString()}_
`;

    sendTelegramMessage(message);

    Logger.log('✅ Daily report sent');

  } catch (error) {
    Logger.log(`❌ Error generating daily report: ${error.message}`);
  }
}

/**
 * Get daily stats from Google Sheet
 */
function getDailyStats(dateStr) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Results');

    if (!sheet || sheet.getLastRow() === 0) {
      return null;
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);

    // Find indices
    const timestampIndex = headers.indexOf('Timestamp');
    const marginIndex = headers.indexOf('Margin %');
    const profitIndex = headers.indexOf('Net Profit');

    if (timestampIndex === -1) {
      return null;
    }

    // Filter for today
    const todayRows = rows.filter(row => {
      const timestamp = row[timestampIndex];
      const rowDate = Utilities.formatDate(new Date(timestamp), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      return rowDate === dateStr;
    });

    if (todayRows.length === 0) {
      return null;
    }

    // Calculate stats
    const profitableDeals = todayRows.filter(row => {
      const margin = parseFloat(row[marginIndex]) || 0;
      return margin >= CONFIG.MIN_PROFIT_MARGIN;
    });

    const totalProfit = profitableDeals.reduce((sum, row) => {
      return sum + (parseFloat(row[profitIndex]) || 0);
    }, 0);

    return {
      searches: 1, // Approximate
      itemsFound: todayRows.length,
      profitableDeals: profitableDeals.length,
      totalProfit: totalProfit
    };

  } catch (error) {
    Logger.log(`❌ Error getting daily stats: ${error.message}`);
    return null;
  }
}
