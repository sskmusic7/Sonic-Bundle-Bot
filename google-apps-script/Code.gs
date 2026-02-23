/**
 * Sonic Bundle Bot - Google Apps Script Version
 * Autonomous Sonic collectible hunting with Google Apps Script triggers
 */

// ==================== CONFIGURATION ====================
const CONFIG = {
  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID: 'YOUR_CHAT_ID_HERE',

  // Scheduling
  SEARCH_INTERVAL_MINUTES: 30,
  DAILY_REPORT_HOUR: 9,
  WEEKLY_REPORT_DAY: 0, // 0 = Sunday
  WEEKLY_REPORT_HOUR: 20,

  // Webhook (optional - for receiving alerts from Node.js bot)
  WEBHOOK_URL: 'https://your-server.com/webhook',

  // Google Sheets for reports
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',

  // Search Settings
  MAX_PRICE_PER_ITEM: 25,
  MIN_PROFIT_MARGIN: 20,
  TARGET_PROFIT_MARGIN: 50,

  // Target Items
  TARGET_ITEMS: [
    'GE Sonic plush',
    'GE Shadow plush',
    'GE Tails plush',
    'GE Knuckles plush',
    'Boom8 Sonic figure',
    'Boom8 Shadow figure'
  ]
};

// ==================== MAIN SEARCH FUNCTION ====================

/**
 * Main function - triggered by time-based trigger
 */
function runScheduledSearch() {
  const startTime = new Date();

  try {
    Logger.log(`🚀 Starting scheduled search: ${startTime}`);

    const results = searchAllPlatforms();
    const profitableDeals = analyzeResults(results);

    // Send notifications for profitable deals
    if (profitableDeals.length > 0) {
      sendDealAlerts(profitableDeals);
    }

    // Save results to Google Sheet
    if (CONFIG.SPREADSHEET_ID) {
      saveToSheet(results, profitableDeals);
    }

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;

    Logger.log(`✅ Search completed in ${duration.toFixed(2)} seconds`);
    Logger.log(`📊 Found ${results.length} items, ${profitableDeals.length} profitable`);

  } catch (error) {
    Logger.log(`❌ Error in scheduled search: ${error.message}`);
    sendErrorAlert(error);
  }
}

/**
 * Test function - run manually to test the system
 */
function testSearch() {
  Logger.log('🧪 Running test search...');

  // Search for one item on one platform
  const results = [{
    title: 'Test Sonic Plush',
    price: 15,
    platform: 'eBay',
    url: 'https://ebay.com/test',
    timestamp: new Date().toISOString()
  }];

  const profitableDeals = analyzeResults(results);

  if (profitableDeals.length > 0) {
    sendTelegramMessage(`🧪 Test successful! Found ${profitableDeals.length} profitable deals.`);
  } else {
    sendTelegramMessage('🧪 Test completed successfully.');
  }

  Logger.log('✅ Test search completed');
}

/**
 * Search across all platforms
 * Note: This is a placeholder - real implementation would need API access
 */
function searchAllPlatforms() {
  const results = [];

  // In a real implementation, you would:
  // 1. Call eBay Finding API
  // 2. Call Mercari API
  // 3. Call other platform APIs
  // 4. Parse and return results

  // For now, return mock data to demonstrate structure
  return [
    {
      title: 'GE Sonic Plush - Mint Condition',
      price: 15,
      platform: 'eBay',
      url: 'https://ebay.com/sonic-plush',
      condition: 'New',
      timestamp: new Date().toISOString()
    },
    {
      title: 'Sonic Bundle - 5 Figures',
      price: 45,
      platform: 'Mercari',
      url: 'https://mercari.com/sonic-bundle',
      condition: 'Used',
      timestamp: new Date().toISOString()
    }
  ];
}

/**
 * Analyze search results for profit opportunities
 */
function analyzeResults(results) {
  const profitableDeals = [];

  for (const item of results) {
    const analysis = analyzeProfit(item);

    if (analysis.profitable) {
      profitableDeals.push({
        ...item,
        analysis
      });
    }
  }

  // Sort by profit margin (highest first)
  profitableDeals.sort((a, b) => b.analysis.margin - a.analysis.margin);

  return profitableDeals;
}

/**
 * Calculate profit for an item
 */
function analyzeProfit(item) {
  const buyPrice = item.price;

  // Calculate fees based on platform
  const fees = calculateFees(item.platform, buyPrice);

  // Estimate resale value
  const suggestedPrice = estimateResaleValue(item, buyPrice);

  // Calculate profit
  const grossProfit = suggestedPrice - buyPrice;
  const netProfit = grossProfit - fees.total;
  const margin = (netProfit / buyPrice) * 100;

  return {
    buyPrice,
    suggestedPrice,
    grossProfit,
    fees,
    netProfit,
    margin: margin.toFixed(1),
    profitable: netProfit > 0 && margin >= CONFIG.MIN_PROFIT_MARGIN
  };
}

/**
 * Calculate fees based on platform
 */
function calculateFees(platform, price) {
  const platformLower = platform.toLowerCase();

  let percentage = 10;
  let fixed = 0;
  let shipping = 8; // Estimated shipping cost

  if (platformLower.includes('ebay')) {
    percentage = 13;
    fixed = 0.30;
  } else if (platformLower.includes('mercari')) {
    percentage = 10;
    fixed = 0;
  } else if (platformLower.includes('poshmark')) {
    percentage = 20;
    fixed = 2.95;
  } else if (platformLower.includes('facebook')) {
    percentage = 0;
    fixed = 0;
    shipping = 0;
  } else if (platformLower.includes('offerup')) {
    percentage = 0;
    shipping = 0; // Local pickup
  }

  const percentageFee = (price * percentage) / 100;
  const total = percentageFee + fixed + shipping;

  return {
    percentage,
    percentageFee: percentageFee.toFixed(2),
    fixed,
    shipping,
    total: total.toFixed(2)
  };
}

/**
 * Estimate resale value based on item characteristics
 */
function estimateResaleValue(item, buyPrice) {
  let multiplier = 1.5; // Default 50% markup

  const title = item.title.toLowerCase();

  // Adjust for keywords
  if (title.includes('rare') || title.includes('limited')) {
    multiplier += 0.3;
  }
  if (title.includes('bundle') || title.includes('lot')) {
    multiplier += 0.2;
  }
  if (title.includes('vintage') || title.includes('retro')) {
    multiplier += 0.25;
  }
  if (title.includes('new') || title.includes('mint') || title.includes('sealed')) {
    multiplier += 0.2;
  }
  if (title.includes('damaged') || title.includes('broken')) {
    multiplier -= 0.4;
  }

  let suggestedPrice = buyPrice * multiplier;
  suggestedPrice = Math.ceil(suggestedPrice) - 0.01; // Retail pricing

  return parseFloat(suggestedPrice.toFixed(2));
}

/**
 * Save results to Google Sheet
 */
function saveToSheet(results, profitableDeals) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Results') || ss.insertSheet('Results');

    // Add header if needed
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Timestamp',
        'Title',
        'Price',
        'Platform',
        'Suggested Price',
        'Net Profit',
        'Margin %',
        'URL'
      ]);
    }

    // Add profitable deals
    for (const deal of profitableDeals) {
      sheet.appendRow([
        new Date(),
        deal.title,
        deal.price,
        deal.platform,
        deal.analysis.suggestedPrice,
        deal.analysis.netProfit,
        deal.analysis.margin,
        deal.url
      ]);
    }

    Logger.log(`💾 Saved ${profitableDeals.length} deals to Google Sheet`);

  } catch (error) {
    Logger.log(`❌ Error saving to sheet: ${error.message}`);
  }
}

/**
 * Send deal alerts to Telegram
 */
function sendDealAlerts(deals) {
  for (const deal of deals) {
    const message = formatDealMessage(deal);
    sendTelegramMessage(message);
  }
}

/**
 * Format deal message for Telegram
 */
function formatDealMessage(deal) {
  const marginEmoji = deal.analysis.margin >= 50 ? '🔥' : deal.analysis.margin >= 30 ? '💰' : '💵';

  return `
${marginEmoji} *PROFITABLE DEAL FOUND*

🎮 ${deal.title}

💰 *Price:* $${deal.price}
📈 *Resale:* $${deal.analysis.suggestedPrice.toFixed(2)}
📊 *Margin:* ${deal.analysis.margin}%
💵 *Net Profit:* $${deal.analysis.netProfit.toFixed(2)}

🏪 *Platform:* ${deal.platform}
🔗 ${deal.url}

📅 Found: ${new Date().toLocaleString()}
`;
}

/**
 * Send error alert to Telegram
 */
function sendErrorAlert(error) {
  const message = `
⚠️ *Error Alert*

❌ *Error:* ${error.message}
📍 *Line:* ${error.lineNumber || 'Unknown'}
📅 ${new Date().toLocaleString()}
`;

  sendTelegramMessage(message);
}

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

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseText = response.getContentText();

    if (response.getResponseCode() !== 200) {
      Logger.log(`❌ Telegram API error: ${responseText}`);
    }

  } catch (error) {
    Logger.log(`❌ Failed to send Telegram message: ${error.message}`);
  }
}
