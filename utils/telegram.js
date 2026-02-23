const TelegramBot = require('node-telegram-bot-api');
const { logger } = require('./logger');
const config = require('../config');

class TelegramNotifier {
  constructor() {
    this.bot = null;
    this.chatId = null;
    this.enabled = false;
  }

  init() {
    if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
      logger.warn('Telegram notifications disabled - missing bot token or chat ID');
      return;
    }

    this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
    this.chatId = config.telegram.chatId;
    this.enabled = true;

    logger.info('Telegram notifications enabled');
  }

  async sendMessage(message, options = {}) {
    if (!this.enabled || !this.bot) {
      logger.debug('Telegram not enabled, skipping message');
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        ...options
      });
      logger.debug('Telegram message sent successfully');
    } catch (error) {
      logger.error(`Failed to send Telegram message: ${error.message}`);
    }
  }

  async sendDealAlert(item, analysis) {
    if (!this.enabled) return;

    const marginEmoji = analysis.margin >= 50 ? '🔥' : analysis.margin >= 30 ? '💰' : '💵';

    const message = `
${marginEmoji} *PROFITABLE DEAL FOUND*

🎮 ${item.title}

💰 *Price:* ${item.price}
📈 *Resale:* $${analysis.suggestedPrice.toFixed(2)}
📊 *Margin:* ${analysis.margin}%
💵 *Net Profit:* $${analysis.netProfit.toFixed(2)}

🏪 *Platform:* ${item.platform}
🔗 ${item.url}

📅 Found: ${new Date().toLocaleString()}
`;

    await this.sendMessage(message);
  }

  async sendBundleAlert(bundle) {
    if (!this.enabled) return;

    const itemsList = bundle.items.map((item, i) =>
      `${i + 1}. ${item.title} - ${item.price} (${item.platform})`
    ).join('\n');

    const message = `
🎁 *BUNDLE OPPORTUNITY*

📦 *Bundle:* ${bundle.bundleName}
${bundle.viable ? '✅ *VIABLE*' : '⚠️ *CHECK MARGINS*'}

💰 *Total Cost:* $${bundle.totalCost.toFixed(2)}
📈 *Resale Value:* $${bundle.resaleValue.toFixed(2)}
💵 *Net Profit:* $${bundle.netProfit.toFixed(2)}
📊 *Net Margin:* ${bundle.netMargin}%

*Items:*
${itemsList}

📅 Found: ${new Date().toLocaleString()}
`;

    await this.sendMessage(message);
  }

  async sendDailySummary(stats, platformCounts) {
    if (!this.enabled) return;

    const platformBreakdown = Object.entries(platformCounts)
      .map(([platform, count]) => `  • ${platform}: ${count}`)
      .join('\n');

    const message = `
📊 *Daily Summary - Sonic Flipper*

🔍 *Searches Today:* ${stats.searches}
📦 *Items Found:* ${stats.itemsFound}
💰 *Profitable Deals:* ${stats.profitableDeals}
💵 *Potential Profit:* $${stats.totalPotentialProfit.toFixed(2)}

*Platforms:*
${platformBreakdown}

📅 ${new Date().toLocaleDateString()}
`;

    await this.sendMessage(message);
  }

  async sendWeeklyReport(weeklyStats) {
    if (!this.enabled) return;

    const message = `
📈 *Weekly Report - Sonic Flipper*

🔍 *Total Searches:* ${weeklyStats.total_searches}
📦 *Items Found:* ${weeklyStats.total_items_found}
💰 *Profitable Deals:* ${weeklyStats.total_profitable_deals}
💵 *Potential Profit:* $${weeklyStats.total_potential_profit.toFixed(2)}
🛒 *Purchases Made:* ${weeklyStats.total_purchases}
✅ *Sales Completed:* ${weeklyStats.total_sales}
🏆 *Actual Profit:* $${weeklyStats.total_actual_profit.toFixed(2)}

📅 Week of: ${new Date().toLocaleDateString()}
`;

    await this.sendMessage(message);
  }

  async sendErrorAlert(error) {
    if (!this.enabled) return;

    const message = `
⚠️ *Error Alert*

❌ *Error:* ${error.message}
📍 *Location:* ${error.stack?.split('\n')[1]?.trim() || 'Unknown'}
📅 ${new Date().toLocaleString()}
`;

    await this.sendMessage(message);
  }

  async sendStartupNotification() {
    if (!this.enabled) return;

    const message = `
🚀 *Sonic Flipper Bot Started*

🤖 Autonomous mode enabled
🔍 Searching for profitable deals across 8 platforms
💰 Minimum margin: ${config.profit.minProfitMargin}%

📅 ${new Date().toLocaleString()}
`;

    await this.sendMessage(message);
  }

  async sendShutdownNotification(stats) {
    if (!this.enabled) return;

    const message = `
🛑 *Sonic Flipper Bot Stopped*

📊 *Session Stats:*
  • Searches: ${stats.searches}
  • Items Found: ${stats.itemsFound}
  • Profitable Deals: ${stats.profitableDeals}
  • Potential Profit: $${stats.totalPotentialProfit.toFixed(2)}

📅 ${new Date().toLocaleString()}
`;

    await this.sendMessage(message);
  }
}

const telegram = new TelegramNotifier();

module.exports = { telegram };
