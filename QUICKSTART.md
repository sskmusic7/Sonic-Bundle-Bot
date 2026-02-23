# 🚀 Quick Start - Sonic Flipper Bot

Get your autonomous Sonic collectible hunting bot running in 5-15 minutes!

---

## ⚡ 5-Minute Quick Start

```bash
# Navigate to bot directory
cd C:\Users\Shadow\.openclaw\workspace\Sonic-Bundle-Bot

# Install dependencies
npm install

# Install browser
npx playwright install chromium

# Test the bot
node index.js test
```

✅ Bot is now working!

---

## 📱 15-Minute Full Setup (with Telegram Alerts)

### Step 1: Set Up Telegram Bot (3 minutes)

1. Open Telegram, search **@BotFather**
2. Send: `/newbot`
3. Choose name: "Sonic Flipper Bot"
4. Choose username: `SonicFlipperBot` (must end in `bot`)
5. **Copy the token** (e.g., `123456789:ABC...`)

### Step 2: Get Your Chat ID (1 minute)

1. Search **@userinfobot** on Telegram
2. Send any message to it
3. **Copy the chat ID** (numbers only, e.g., `123456789`)

### Step 3: Configure Bot (2 minutes)

**Windows PowerShell:**
```powershell
$env:TELEGRAM_BOT_TOKEN="your_bot_token_here"
$env:TELEGRAM_CHAT_ID="your_chat_id_here"
```

**Windows CMD:**
```cmd
set TELEGRAM_BOT_TOKEN=your_bot_token_here
set TELEGRAM_CHAT_ID=your_chat_id_here
```

### Step 4: Test (1 minute)

```bash
node index.js test
```

You should receive a Telegram message! 🎉

### Step 5: Run Autonomously (1 minute)

```bash
node index.js schedule
```

The bot will now:
- 🔍 Search every 30 minutes
- 💰 Send Telegram alerts for profitable deals
- 📊 Track everything in database
- 📈 Send daily/weekly summaries

---

## 🖥️ Run as a Service (PM2) - Recommended!

**Install PM2:**
```bash
npm install -g pm2
```

**Start Bot Service:**
```bash
pm2 start index.js --name sonic-bot -- schedule
```

**Enable Auto-Start:**
```bash
pm2 startup
pm2 save
```

**PM2 Commands:**
```bash
pm2 status              # Check if running
pm2 logs sonic-bot      # View logs
pm2 restart sonic-bot   # Restart
pm2 stop sonic-bot      # Stop
```

---

## ⚙️ Customize Settings

Edit `config.js`:

```javascript
// Target items to search for
strategy: {
  targetItems: [
    'GE Sonic plush',
    'GE Shadow plush',
    'GE Tails plush',
    // Add your items here
  ]
}

// Profit settings
profit: {
  minProfitMargin: 20,        // Min 20% profit
  targetProfitMargin: 50,     // Target 50% profit
  maxPurchasePrice: 100       // Don't pay more than $100
}

// Scheduling
scheduling: {
  enabled: true,
  searchIntervalMinutes: 30,   // Search every 30 min
  dailyReportHour: 9,          // Daily report at 9 AM
}

// Platforms
platforms: {
  ebay: { enabled: true },
  mercari: { enabled: true },
  facebook: { enabled: false },  // Requires login
  // Enable/disable as needed
}
```

---

## 📊 View Statistics

```bash
node index.js stats
```

Shows:
- Weekly summary (searches, items, profit)
- Daily stats (last 7 days)
- Platform breakdown
- Top 10 profitable deals
- Viable bundles

---

## 📂 Important Files

```
Sonic-Bundle-Bot/
├── index.js              # Main bot file
├── config.js             # Settings (edit this!)
├── DEPLOYMENT.md          # Full deployment guide
├── README.md             # Detailed documentation
├── data/
│   └── sonic_tracker.db  # SQLite database
├── logs/
│   ├── combined.log       # All logs
│   └── error.log          # Errors only
└── sonic_results/
    ├── *.json             # Search results
    └── *.csv              # Spreadsheet format
```

---

## 🔧 Troubleshooting

**Bot won't start?**
```bash
npm install
npx playwright install chromium --force
```

**No results found?**
- Increase `maxPricePerItem` in config.js
- Verify platforms are enabled
- Check internet connection

**Telegram not working?**
- Verify bot token and chat ID
- Send message to bot first
- Check logs: `pm2 logs sonic-bot`

---

## 📚 More Documentation

- **Full Report:** `../reports/sonic-flipper-improvements.md`
- **Deployment Guide:** `DEPLOYMENT.md`
- **Google Apps Script:** `google-apps-script/README.md`
- **Main README:** `README.md`

---

## ✅ Deployment Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] Browser installed (`npx playwright install chromium`)
- [ ] Config customized (`config.js`)
- [ ] Telegram bot created (optional)
- [ ] Test successful (`node index.js test`)
- [ ] Running autonomously (`node index.js schedule` or PM2)

---

## 🎯 What the Bot Does

**Every 30 minutes (configurable):**
1. Searches eBay, Mercari, OfferUp, etc. for Sonic items
2. Analyzes each item for profit potential
3. Calculates fees and net profit
4. Detects bundle opportunities
5. Sends Telegram alerts for good deals
6. Saves everything to database

**Daily (9 AM):**
- Sends summary of all finds
- Updates statistics

**Weekly (Sunday 8 PM):**
- Sends comprehensive report
- Total profit analysis
- Platform performance breakdown

---

**That's it! Your autonomous Sonic collectible bot is ready to find deals 24/7! 🦔💰**

---

**Need Help?** Check the full report: `reports/sonic-flipper-improvements.md`
