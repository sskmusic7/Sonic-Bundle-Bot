# Sonic Bundle Bot v2.0 - Autonomous Edition

🤖 **Fully autonomous Sonic the Hedgehog collectible hunting bot** with scheduling, Telegram notifications, and profit tracking.

## ✨ New Features in v2.0

### 🚀 Autonomous Operation
- **Automated Scheduling**: Runs searches every 15-30 minutes (configurable)
- **Background Daemon**: Runs continuously without intervention
- **Daily Reports**: Automatic summary of finds at configurable time
- **Weekly Reports**: Profit and performance analysis every Sunday

### 📱 Telegram Notifications
- **Instant Deal Alerts**: Get notified immediately when profitable deals are found
- **Bundle Alerts**: Special notifications for high-margin bundle opportunities
- **Daily/Weekly Summaries**: Automated reports sent to your Telegram
- **Error Alerts**: Instant notifications if something goes wrong

### 💾 Database Tracking
- **SQLite Database**: Tracks all found items, bundles, purchases, and sales
- **Profit History**: Complete record of potential and actual profits
- **Platform Analytics**: See which platforms perform best
- **Search History**: Log of all searches for analysis

### 💰 Enhanced Profit Calculation
- **Accurate Fee Tracking**: Platform-specific fees (eBay 13%, Mercari 10%, etc.)
- **Smart Resale Estimation**: AI-powered pricing based on item characteristics
- **Break-Even Analysis**: Calculate minimum price for profit
- **Bundle Profit Calculator**: Analyze multi-item purchases

### 📊 Advanced Logging
- **Winston Logger**: Professional logging system with multiple levels
- **Search Logs**: Detailed record of all searches
- **Profit Logs**: Track every profit analysis
- **Error Logs**: Complete error history for debugging

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd Sonic-Bundle-Bot
npm install
```

### 2. Install Playwright Browser

```bash
npx playwright install chromium
```

### 3. Configure the Bot

Edit `config.js` to customize:
- Target items and search terms
- Price limits and profit margins
- Platform preferences
- Scheduling intervals

### 4. Run the Bot

**Single run (test):**
```bash
node index.js run
```

**Autonomous mode (recommended):**
```bash
node index.js schedule
```

## ⚙️ Configuration

### Telegram Setup (Optional but Recommended)

1. Create a bot via [BotFather](https://t.me/BotFather) on Telegram
2. Get your bot token
3. Get your chat ID (message [@userinfobot](https://t.me/userinfobot))
4. Set environment variables:

```bash
# Linux/Mac
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_CHAT_ID="your_chat_id_here"

# Windows (PowerShell)
$env:TELEGRAM_BOT_TOKEN="your_bot_token_here"
$env:TELEGRAM_CHAT_ID="your_chat_id_here"

# Windows (Command Prompt)
set TELEGRAM_BOT_TOKEN=your_bot_token_here
set TELEGRAM_CHAT_ID=your_chat_id_here
```

Or edit `config.js` directly:

```javascript
telegram: {
  enabled: true,
  botToken: 'your_bot_token_here',
  chatId: 'your_chat_id_here',
  // ...
}
```

### Scheduling Configuration

```javascript
scheduling: {
  enabled: true,                    // Enable/disable autonomous scheduling
  searchIntervalMinutes: 30,        // Run searches every 30 minutes
  dailyReportHour: 9,               // Daily report at 9 AM
  weeklyReportDay: 0,               // 0 = Sunday
  weeklyReportHour: 20,             // Sunday at 8 PM
  timezone: 'America/New_York'
}
```

### Profit Configuration

```javascript
profit: {
  minProfitMargin: 20,              // Minimum profit margin %
  targetProfitMargin: 50,           // Target profit margin %
  includeFeesInCalculation: true,   // Account for platform fees
  includeShippingCost: true,        // Include estimated shipping
  estimatedShippingCost: 8,          // Average shipping cost
  maxPurchasePrice: 100             // Maximum purchase price
}
```

### Fee Configuration (Pre-configured)

```javascript
fees: {
  ebay: { percentage: 13, fixed: 0.30 },      // eBay fees
  mercari: { percentage: 10, fixed: 0 },     // Mercari fees
  offerup: { percentage: 0, shippingPercentage: 12.9 },
  poshmark: { percentage: 20, fixed: 2.95 },
  // ... more platforms
}
```

## 📊 Usage Commands

```bash
# Run single search and exit
node index.js run
# or
node index.js hunt

# Run in autonomous mode with scheduling
node index.js schedule
# or
node index.js daemon

# Show database statistics
node index.js stats

# Run test mode (minimal search)
node index.js test

# Show setup instructions
node index.js setup
```

## 📈 Database Features

### View Statistics

```bash
node index.js stats
```

This shows:
- Weekly summary (searches, items, profit potential)
- Daily stats for last 7 days
- Platform breakdown
- Top 10 profitable deals
- Viable bundles

### Database Tables

- **items**: All found items with profit analysis
- **bundles**: Bundle opportunities and calculations
- **purchases**: Executed purchases tracking
- **sales**: Completed sales with actual profit
- **stats**: Daily statistics aggregation

### Access Database Directly

```bash
# Using sqlite3 CLI
sqlite3 data/sonic_tracker.db

# Example queries
SELECT * FROM items WHERE profitable = 1 ORDER BY net_profit DESC LIMIT 10;
SELECT * FROM bundles WHERE viable = 1;
SELECT * FROM stats ORDER BY date DESC LIMIT 7;
```

## 🎯 Platform Coverage

### Primary Platforms (8 total)
- **eBay** - Largest selection, good for completed item research
- **Mercari** - Competitive pricing, good flips
- **Facebook Marketplace** - Nationwide search capability
- **OfferUp** - Local deals, pickup options
- **Poshmark** - Fashion and collectibles marketplace
- **Depop** - Youth-focused resale platform
- **Etsy** - Handmade and vintage items
- **ShopGoodwill** - Thrift store online auctions

## 💰 Profit Strategy

### Target Items
- GE Sonic/Shadow/Tails/Knuckles plushes
- Boom8 Sonic/Shadow figures
- First4Figures collectibles
- Jazwares figures
- Vintage SEGA merchandise

### Bundle Opportunities
- **Hero Team Plush Pack**: Buy for $60, sell for $120 (100% margin)
- **Shadow & Rivals Set**: Buy for $70, sell for $145 (107% margin)
- **Complete Team Set**: Buy for $80, sell for $180 (125% margin)

### Profit Margins
- **Minimum**: 20% profit margin
- **Good**: 30-50% profit margin
- **Excellent**: 50%+ profit margin

## 📁 File Structure

```
Sonic-Bundle-Bot/
├── index.js                 # Main entry point
├── sonic_bundle_hunter.js   # Core bot logic
├── scheduler.js             # Autonomous scheduling
├── config.js                # Configuration file
├── package.json             # Dependencies
├── utils/
│   ├── logger.js            # Logging system
│   ├── database.js          # SQLite database manager
│   ├── telegram.js          # Telegram notifications
│   └── profit-calculator.js # Profit calculations
├── data/
│   └── sonic_tracker.db     # SQLite database
├── logs/
│   ├── combined.log         # All logs
│   ├── error.log            # Errors only
│   ├── searches.log         # Search history
│   └── profits.log          # Profit analysis
├── sonic_results/
│   ├── images/              # Downloaded images
│   ├── *.json               # Detailed results
│   └── *.csv                # Spreadsheet format
└── README.md                # This file
```

## 🔄 Google Apps Script Integration

For those who prefer Google Apps Script triggers instead of Node.js scheduling, see `google-apps-script/` directory for:

1. **Time-based triggers** - Run searches at specific intervals
2. **Webhook triggers** - Instant alerts via webhooks
3. **Weekly profit reporting** - Automated Google Sheets reports

Setup instructions are in `google-apps-script/README.md`.

## 🛡️ Safety & Best Practices

1. **Start Small**: Begin with lower price limits to test
2. **Verify Items**: Check photos and descriptions carefully
3. **Factor in All Costs**: Include fees, shipping, and your time
4. **Track Everything**: Use the database to learn what works
5. **Review Daily**: Check Telegram alerts and adjust settings
6. **Market Research**: Compare against completed listings before buying

## 🐛 Troubleshooting

### Bot won't start
- Check that all dependencies are installed: `npm install`
- Verify Playwright is installed: `npx playwright install chromium`

### No results found
- Increase `maxPricePerItem` in config.js
- Check if platforms are enabled
- Verify internet connection

### Telegram not working
- Verify bot token and chat ID are correct
- Test bot by sending it a message first
- Check Telegram bot API status

### Database errors
- Ensure `data/` directory exists
- Check file permissions
- Delete database file and let it recreate

## 📞 Support & Updates

- **Check logs**: `logs/combined.log` for detailed info
- **Check errors**: `logs/error.log` for errors only
- **Verify config**: Ensure all settings in `config.js` are correct
- **Test mode**: Run `node index.js test` for quick verification

## 📜 License

MIT License - Feel free to use and modify for your own needs.

---

**Happy Hunting! 🦔💰**

*Version 2.0 - Autonomous Edition*
