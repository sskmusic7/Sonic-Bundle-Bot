/**
 * Google Apps Script Integration for Sonic Bundle Bot
 *
 * This script provides:
 * 1. Time-driven triggers for automated searches
 * 2. Webhook triggers for instant alerts
 * 3. Weekly profit reporting to Google Sheets
 * 4. Database sync with Google Sheets
 */

// ==================== CONFIGURATION ====================
const CONFIG = {
  // Sonic Bundle Bot API endpoint
  BOT_API_URL: 'YOUR_BOT_API_URL', // e.g., 'https://your-bot-server.com/api/trigger-search'

  // Telegram configuration
  TELEGRAM_BOT_TOKEN: 'YOUR_TELEGRAM_BOT_TOKEN',
  TELEGRAM_CHAT_ID: 'YOUR_TELEGRAM_CHAT_ID',

  // Google Sheet for profit tracking
  SHEET_ID: 'YOUR_GOOGLE_SHEET_ID',

  // Email for notifications
  EMAIL_ADDRESS: 'your-email@example.com',

  // Schedule settings
  SEARCH_INTERVAL_MINUTES: 30,
  WEEKLY_REPORT_DAY: ScriptApp.WeekDay.SUNDAY,
  WEEKLY_REPORT_HOUR: 20, // 8 PM
  DAILY_REPORT_HOUR: 9, // 9 AM
};

// ==================== WEBHOOK HANDLERS ====================

/**
 * Handle incoming webhook requests
 * Can be called from external systems to trigger bot actions
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    switch (action) {
      case 'search':
        triggerSearch();
        return respond({ success: true, message: 'Search triggered' });

      case 'report':
        generateWeeklyReport();
        return respond({ success: true, message: 'Report generated' });

      case 'stats':
        const stats = getStats();
        return respond({ success: true, data: stats });

      default:
        return respond({ success: false, message: 'Unknown action' });
    }
  } catch (error) {
    return respond({ success: false, error: error.message });
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== TRIGGER FUNCTIONS ====================

/**
 * Trigger a new search via the bot API
 */
function triggerSearch() {
  try {
    const response = UrlFetchApp.fetch(CONFIG.BOT_API_URL + '/search', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        timestamp: new Date().toISOString(),
        source: 'Google Apps Script'
      }),
      headers: {
        'Authorization': 'Bearer YOUR_API_TOKEN'
      }
    });

    const result = JSON.parse(response.getContentText());
    Logger.log(`Search triggered: ${JSON.stringify(result)}`);

    // Send Telegram notification
    if (result.success) {
      sendTelegramMessage(`🔍 Search triggered via Google Apps Script\n\nResults: ${result.itemsFound} items found`);
    }

    return result;
  } catch (error) {
    Logger.log(`Error triggering search: ${error.toString()}`);
    throw error;
  }
}

/**
 * Schedule regular searches
 */
function scheduleSearches() {
  // Clear existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'triggerSearch') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new time-based trigger
  ScriptApp.newTrigger('triggerSearch')
    .timeBased()
    .everyMinutes(CONFIG.SEARCH_INTERVAL_MINUTES)
    .create();

  Logger.log(`Scheduled searches every ${CONFIG.SEARCH_INTERVAL_MINUTES} minutes`);
}

/**
 * Setup daily report trigger
 */
function scheduleDailyReport() {
  ScriptApp.newTrigger('sendDailySummary')
    .timeBased()
    .atHour(CONFIG.DAILY_REPORT_HOUR)
    .everyDays(1)
    .create();

  Logger.log(`Scheduled daily report at ${CONFIG.DAILY_REPORT_HOUR}:00`);
}

/**
 * Setup weekly report trigger
 */
function scheduleWeeklyReport() {
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(CONFIG.WEEKLY_REPORT_DAY)
    .atHour(CONFIG.WEEKLY_REPORT_HOUR)
    .everyWeeks(1)
    .create();

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  Logger.log(`Scheduled weekly report on ${dayNames[CONFIG.WEEKLY_REPORT_DAY]} at ${CONFIG.WEEKLY_REPORT_HOUR}:00`);
}

/**
 * Setup all triggers at once
 */
function setupAllTriggers() {
  // Clear all existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // Create new triggers
  scheduleSearches();
  scheduleDailyReport();
  scheduleWeeklyReport();

  Logger.log('All triggers set up successfully');
}

// ==================== REPORTING FUNCTIONS ====================

/**
 * Generate and send daily summary
 */
function sendDailySummary() {
  try {
    // Fetch daily stats from bot API
    const response = UrlFetchApp.fetch(CONFIG.BOT_API_URL + '/stats/daily', {
      method: 'get',
      headers: {
        'Authorization': 'Bearer YOUR_API_TOKEN'
      }
    });

    const stats = JSON.parse(response.getContentText());

    const message = `
📊 *Daily Summary - Sonic Flipper*

🔍 Searches: ${stats.searches}
📦 Items Found: ${stats.itemsFound}
💰 Profitable Deals: ${stats.profitableDeals}
💵 Potential Profit: $${stats.totalPotentialProfit.toFixed(2)}

📅 ${new Date().toLocaleDateString()}
`;

    sendTelegramMessage(message);
    appendToSheet(stats);

    Logger.log('Daily summary sent');
  } catch (error) {
    Logger.log(`Error sending daily summary: ${error.toString()}`);
  }
}

/**
 * Generate and send weekly report
 */
function sendWeeklyReport() {
  try {
    // Fetch weekly stats from bot API
    const response = UrlFetchApp.fetch(CONFIG.BOT_API_URL + '/stats/weekly', {
      method: 'get',
      headers: {
        'Authorization': 'Bearer YOUR_API_TOKEN'
      }
    });

    const stats = JSON.parse(response.getContentText());

    const message = `
📈 *Weekly Report - Sonic Flipper*

🔍 Total Searches: ${stats.total_searches}
📦 Items Found: ${stats.total_items_found}
💰 Profitable Deals: ${stats.total_profitable_deals}
💵 Potential Profit: $${stats.total_potential_profit.toFixed(2)}
🛒 Purchases Made: ${stats.total_purchases}
✅ Sales Completed: ${stats.total_sales}
🏆 Actual Profit: $${stats.total_actual_profit.toFixed(2)}

📅 Week of: ${new Date().toLocaleDateString()}
`;

    sendTelegramMessage(message);
    appendWeeklyToSheet(stats);
    sendEmailReport(stats);

    Logger.log('Weekly report sent');
  } catch (error) {
    Logger.log(`Error sending weekly report: ${error.toString()}`);
  }
}

/**
 * Generate detailed report with Google Sheets
 */
function generateWeeklyReport() {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // Ensure required sheets exist
  ensureSheetsExist(sheet);

  // Fetch data from bot API
  const response = UrlFetchApp.fetch(CONFIG.BOT_API_URL + '/export/weekly', {
    method: 'get',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN'
    }
  });

  const data = JSON.parse(response.getContentText());

  // Update sheets
  updateItemsSheet(sheet, data.items);
  updateBundlesSheet(sheet, data.bundles);
  updateStatsSheet(sheet, data.stats);

  // Create summary dashboard
  createDashboard(sheet, data);

  Logger.log('Weekly report generated and synced to Google Sheets');
}

// ==================== GOOGLE SHEETS INTEGRATION ====================

/**
 * Ensure required sheets exist in the spreadsheet
 */
function ensureSheetsExist(sheet) {
  const requiredSheets = ['Items', 'Bundles', 'Stats', 'Dashboard'];

  requiredSheets.forEach(sheetName => {
    if (sheet.getSheetByName(sheetName) === null) {
      sheet.insertSheet(sheetName);
      setupSheetColumns(sheet.getSheetByName(sheetName), sheetName);
    }
  });
}

/**
 * Setup columns for a new sheet
 */
function setupSheetColumns(sheet, type) {
  switch (type) {
    case 'Items':
      sheet.getRange('A1:L1').setValues([[
        'ID', 'Title', 'Price', 'Platform', 'URL', 'Image',
        'Condition', 'Buy Date', 'Suggested Price', 'Gross Profit',
        'Net Profit', 'Margin %'
      ]]);
      break;

    case 'Bundles':
      sheet.getRange('A1:J1').setValues([[
        'ID', 'Bundle Name', 'Total Cost', 'Resale Value',
        'Gross Profit', 'Fees', 'Net Profit', 'Margin %',
        'Viable', 'Date'
      ]]);
      break;

    case 'Stats':
      sheet.getRange('A1:I1').setValues([[
        'Date', 'Searches', 'Items Found', 'Profitable Deals',
        'Potential Profit', 'Purchases', 'Sales', 'Actual Profit',
        'Notes'
      ]]);
      break;

    case 'Dashboard':
      sheet.getRange('A1:B10').setValues([
        ['Metric', 'Value'],
        ['Total Searches', '=SUM(Stats!B2:B)'],
        ['Total Items', '=SUM(Stats!C2:C)'],
        ['Total Profitable Deals', '=SUM(Stats!D2:D)'],
        ['Total Potential Profit', '=SUM(Stats!E2:E)'],
        ['Total Purchases', '=SUM(Stats!F2:F)'],
        ['Total Sales', '=SUM(Stats!G2:G)'],
        ['Total Actual Profit', '=SUM(Stats!H2:H)'],
        ['Best Platform', '=INDEX(Items!D2:D, MATCH(MAX(COUNTIF(Items!D2:D, Items!D2:D)), COUNTIF(Items!D2:D, Items!D2:D), 0))'],
        ['Last Updated', '=NOW()']
      ]);
      break;
  }

  sheet.getRange('1:1').setFontWeight('bold').setBackground('#4285F4').setFontColor('white');
}

/**
 * Update the Items sheet
 */
function updateItemsSheet(sheet, items) {
  const itemsSheet = sheet.getSheetByName('Items');
  itemsSheet.clearContents();
  setupSheetColumns(itemsSheet, 'Items');

  if (items.length > 0) {
    const rows = items.map(item => [
      item.id,
      item.title,
      item.price,
      item.platform,
      item.url,
      item.image,
      item.condition || 'N/A',
      item.timestamp || new Date().toISOString(),
      item.suggestedPrice,
      item.grossProfit,
      item.netProfit,
      item.margin
    ]);
    itemsSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/**
 * Update the Bundles sheet
 */
function updateBundlesSheet(sheet, bundles) {
  const bundlesSheet = sheet.getSheetByName('Bundles');
  bundlesSheet.clearContents();
  setupSheetColumns(bundlesSheet, 'Bundles');

  if (bundles.length > 0) {
    const rows = bundles.map(bundle => [
      bundle.id,
      bundle.bundleName,
      bundle.totalCost,
      bundle.resaleValue,
      bundle.grossProfit,
      bundle.fees.total,
      bundle.netProfit,
      bundle.netMargin,
      bundle.viable ? 'Yes' : 'No',
      bundle.timestamp || new Date().toISOString()
    ]);
    bundlesSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/**
 * Update the Stats sheet
 */
function updateStatsSheet(sheet, stats) {
  const statsSheet = sheet.getSheetByName('Stats');
  const lastRow = statsSheet.getLastRow();

  if (lastRow === 1) {
    // First data entry
    statsSheet.appendRow([
      new Date().toISOString(),
      stats.searches,
      stats.itemsFound,
      stats.profitableDeals,
      stats.totalPotentialProfit,
      stats.purchases,
      stats.sales,
      stats.actualProfit,
      'Auto-generated'
    ]);
  } else {
    // Check if today already exists
    const dates = statsSheet.getRange('A2:A').getValues().flat();
    const today = new Date().toISOString().split('T')[0];
    const todayIndex = dates.findIndex(d => d.startsWith(today));

    if (todayIndex >= 0) {
      // Update today's entry
      statsSheet.getRange(todayIndex + 2, 1, 1, 9).setValues([[
        new Date().toISOString(),
        stats.searches,
        stats.itemsFound,
        stats.profitableDeals,
        stats.totalPotentialProfit,
        stats.purchases,
        stats.sales,
        stats.actualProfit,
        'Updated'
      ]]);
    } else {
      // Append new entry
      statsSheet.appendRow([
        new Date().toISOString(),
        stats.searches,
        stats.itemsFound,
        stats.profitableDeals,
        stats.totalPotentialProfit,
        stats.purchases,
        stats.sales,
        stats.actualProfit,
        'Auto-generated'
      ]);
    }
  }
}

/**
 * Create/update dashboard
 */
function createDashboard(sheet, data) {
  const dashboard = sheet.getSheetByName('Dashboard');
  dashboard.clear();
  setupSheetColumns(dashboard, 'Dashboard');

  // Add charts
  const itemsSheet = sheet.getSheetByName('Items');

  if (itemsSheet.getLastRow() > 1) {
    // Platform breakdown pie chart
    const platformRange = itemsSheet.getRange('D2:D' + itemsSheet.getLastRow());
    const chart = dashboard.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(platformRange)
      .setPosition(1, 4, 10, 10)
      .setOption('title', 'Items by Platform');
    dashboard.addChart(chart);
  }
}

/**
 * Append single stats entry to sheet
 */
function appendToSheet(stats) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const statsSheet = sheet.getSheetByName('Stats');

  statsSheet.appendRow([
    new Date().toISOString(),
    stats.searches,
    stats.itemsFound,
    stats.profitableDeals,
    stats.totalPotentialProfit,
    stats.purchases,
    stats.sales,
    stats.actualProfit,
    'Daily update'
  ]);
}

/**
 * Append weekly summary to sheet
 */
function appendWeeklyToSheet(stats) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const statsSheet = sheet.getSheetByName('Stats');

  statsSheet.appendRow([
    'Week of ' + new Date().toISOString().split('T')[0],
    stats.total_searches,
    stats.total_items_found,
    stats.total_profitable_deals,
    stats.total_potential_profit,
    stats.total_purchases,
    stats.total_sales,
    stats.total_actual_profit,
    'Weekly summary'
  ]);
}

// ==================== TELEGRAM NOTIFICATIONS ====================

/**
 * Send message to Telegram
 */
function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CONFIG.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  };

  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });
  } catch (error) {
    Logger.log(`Telegram error: ${error.toString()}`);
  }
}

// ==================== EMAIL REPORTS ====================

/**
 * Send weekly report via email
 */
function sendEmailReport(stats) {
  const subject = `📈 Sonic Flipper Weekly Report - ${new Date().toLocaleDateString()}`;

  const htmlBody = `
    <h2>📈 Sonic Flipper Weekly Report</h2>
    <h3>Week of: ${new Date().toLocaleDateString()}</h3>
    <table border="1" cellpadding="10">
      <tr><td>Total Searches</td><td>${stats.total_searches}</td></tr>
      <tr><td>Items Found</td><td>${stats.total_items_found}</td></tr>
      <tr><td>Profitable Deals</td><td>${stats.total_profitable_deals}</td></tr>
      <tr><td>Potential Profit</td><td>$${stats.total_potential_profit.toFixed(2)}</td></tr>
      <tr><td>Purchases Made</td><td>${stats.total_purchases}</td></tr>
      <tr><td>Sales Completed</td><td>${stats.total_sales}</td></tr>
      <tr><td><strong>Actual Profit</strong></td><td><strong>$${stats.total_actual_profit.toFixed(2)}</strong></td></tr>
    </table>
    <p>View detailed data in <a href="https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}">Google Sheets</a></p>
  `;

  MailApp.sendEmail({
    to: CONFIG.EMAIL_ADDRESS,
    subject: subject,
    htmlBody: htmlBody
  });
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Get current stats from bot
 */
function getStats() {
  try {
    const response = UrlFetchApp.fetch(CONFIG.BOT_API_URL + '/stats/current', {
      method: 'get',
      headers: {
        'Authorization': 'Bearer YOUR_API_TOKEN'
      }
    });

    return JSON.parse(response.getContentText());
  } catch (error) {
    Logger.log(`Error getting stats: ${error.toString()}`);
    return { error: error.message };
  }
}

/**
 * Manually trigger a search (for testing)
 */
function testSearch() {
  triggerSearch();
}

/**
 * Manually send daily report (for testing)
 */
function testDailyReport() {
  sendDailySummary();
}

/**
 * Manually send weekly report (for testing)
 */
function testWeeklyReport() {
  sendWeeklyReport();
}

/**
 * Get all current triggers
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const triggerList = triggers.map(t => ({
    function: t.getHandlerFunction(),
    source: t.getTriggerSource(),
    type: t.getTriggerSource()
  }));

  Logger.log(JSON.stringify(triggerList, null, 2));
  return triggerList;
}

/**
 * Clear all triggers
 */
function clearAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  Logger.log('All triggers cleared');
}

// ==================== SETUP FUNCTION ====================

/**
 * Initial setup - Run this once to configure everything
 */
function setup() {
  // Verify configuration
  if (CONFIG.BOT_API_URL === 'YOUR_BOT_API_URL') {
    throw new Error('Please configure BOT_API_URL in CONFIG');
  }

  if (CONFIG.SHEET_ID === 'YOUR_GOOGLE_SHEET_ID') {
    throw new Error('Please configure SHEET_ID in CONFIG');
  }

  // Setup all triggers
  setupAllTriggers();

  // Initialize Google Sheets
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ensureSheetsExist(sheet);

  Logger.log('Setup complete! Google Apps Script integration is ready.');
  Logger.log('Webhook URL: ' + ScriptApp.getService().getUrl());
}
