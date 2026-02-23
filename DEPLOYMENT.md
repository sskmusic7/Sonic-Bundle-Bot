# 🚀 Sonic Bundle Bot - Deployment Guide

Complete guide to deploying the Sonic Bundle Bot for autonomous operation.

## 📋 Prerequisites

- Node.js v14+ installed
- Git (for cloning the repo)
- Terminal/Command Prompt access

## ⚡ Quick Deploy (5 Minutes)

### 1. Clone and Install

```bash
# Clone the repository
cd C:\Users\Shadow\.openclaw\workspace
git clone https://github.com/sskmusic7/Sonic-Bundle-Bot.git
cd Sonic-Bundle-Bot

# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium
```

### 2. Configure

Edit `config.js` to customize:
- Target items (line ~100)
- Price limits (line ~140)
- Profit margins (line ~120)
- Platform preferences (line ~180)

### 3. Test Run

```bash
# Test with a single search
node index.js test
```

### 4. Run Autonomously

```bash
# Run in autonomous mode
node index.js schedule
```

That's it! The bot will now search every 30 minutes and send alerts.

---

## 📱 Full Setup with Telegram (15 Minutes)

### Step 1: Set Up Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` command
3. Choose a name for your bot (e.g., "Sonic Flipper Bot")
4. Choose a username (must end in `bot`, e.g., `SonicFlipperBot`)
5. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Get Your Chat ID

1. Search for **@userinfobot** on Telegram
2. Send any message to it
3. It will reply with your **chat ID** (numbers only)

### Step 3: Configure Environment Variables

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

**Linux/Mac:**
```bash
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_CHAT_ID="your_chat_id_here"
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

### Step 4: Verify Telegram Setup

```bash
# Run a test search - you should get a Telegram notification
node index.js test
```

---

## 🖥️ Running as a Service (Autonomous)

### Option 1: Using PM2 (Recommended)

**Install PM2 globally:**
```bash
npm install -g pm2
```

**Start the bot as a service:**
```bash
cd Sonic-Bundle-Bot
pm2 start index.js --name sonic-bot -- schedule
```

**PM2 Commands:**
```bash
# View status
pm2 status

# View logs
pm2 logs sonic-bot

# Stop the bot
pm2 stop sonic-bot

# Restart the bot
pm2 restart sonic-bot

# Start on system boot
pm2 startup
pm2 save
```

### Option 2: Using Node.js Process Manager

**Create ecosystem file `ecosystem.config.js`:**
```javascript
module.exports = {
  apps: [{
    name: 'sonic-bot',
    script: './index.js',
    args: 'schedule',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
    }
  }]
};
```

**Run with ecosystem:**
```bash
pm2 start ecosystem.config.js
```

### Option 3: Windows Task Scheduler

1. Open **Task Scheduler**
2. Create **Basic Task**
3. Set trigger: "When I log on" or "At startup"
4. Action: "Start a program"
5. Program: `node.exe` (full path: `C:\Program Files\nodejs\node.exe`)
6. Arguments: `"C:\path\to\Sonic-Bundle-Bot\index.js" schedule`
7. Start in: `"C:\path\to\Sonic-Bundle-Bot"`

### Option 4: Linux systemd

**Create service file `/etc/systemd/system/sonic-bot.service`:**
```ini
[Unit]
Description=Sonic Bundle Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/Sonic-Bundle-Bot
ExecStart=/usr/bin/node index.js schedule
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=TELEGRAM_BOT_TOKEN=your_bot_token
Environment=TELEGRAM_CHAT_ID=your_chat_id

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl enable sonic-bot
sudo systemctl start sonic-bot
sudo systemctl status sonic-bot
```

---

## 🌐 Cloud Deployment

### Option 1: Heroku

**Install Heroku CLI:**
```bash
npm install -g heroku
```

**Create `Procfile`:**
```
worker: node index.js schedule
```

**Deploy:**
```bash
# Login
heroku login

# Create app
heroku create sonic-bundle-bot

# Set environment variables
heroku config:set TELEGRAM_BOT_TOKEN=your_token
heroku config:set TELEGRAM_CHAT_ID=your_chat_id

# Deploy
git push heroku main

# Scale up worker
heroku ps:scale worker=1

# View logs
heroku logs --tail
```

### Option 2: Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Add variables
railway variables set TELEGRAM_BOT_TOKEN=your_token
railway variables set TELEGRAM_CHAT_ID=your_chat_id

# Deploy
railway up
```

### Option 3: Render

1. Create account at [render.com](https://render.com)
2. Create **New Web Service**
3. Connect GitHub repo
4. Set environment variables
5. Command: `node index.js schedule`
6. Deploy

---

## 📊 Monitoring

### View Logs

**Local deployment:**
```bash
# Live logs (if using PM2)
pm2 logs sonic-bot --lines 100

# Or view log files directly
tail -f logs/combined.log
tail -f logs/error.log
```

**Cloud deployment:**
```bash
# Heroku
heroku logs --tail

# Railway
railway logs
```

### Check Database

```bash
# Open SQLite database
sqlite3 data/sonic_tracker.db

# View profitable items
SELECT * FROM items WHERE profitable = 1 ORDER BY net_profit DESC LIMIT 10;

# View bundles
SELECT * FROM bundles WHERE viable = 1;

# View stats
SELECT * FROM stats ORDER BY date DESC LIMIT 7;

# Exit
.quit
```

### View Statistics

```bash
# Show bot statistics
node index.js stats
```

---

## 🔧 Configuration

### Scheduling

Edit `config.js`:
```javascript
scheduling: {
  enabled: true,              // Enable/disable scheduling
  searchIntervalMinutes: 30,  // How often to search (15-60 recommended)
  dailyReportHour: 9,         // Daily report at 9 AM
  weeklyReportDay: 0,         // 0=Sunday, 1=Monday, etc.
  weeklyReportHour: 20,       // Weekly report at 8 PM
  timezone: 'America/New_York'
}
```

### Profit Settings

Edit `config.js`:
```javascript
profit: {
  minProfitMargin: 20,        // Minimum profit margin % to consider
  targetProfitMargin: 50,     // Target margin for notifications
  includeFeesInCalculation: true,
  includeShippingCost: true,
  estimatedShippingCost: 8,
  maxPurchasePrice: 100       // Maximum price to pay
}
```

### Platform Settings

Edit `config.js`:
```javascript
platforms: {
  ebay: { enabled: true },
  mercari: { enabled: true },
  facebook: { enabled: false },  // Requires login
  offerup: { enabled: true },
  poshmark: { enabled: true },
  depop: { enabled: true },
  etsy: { enabled: true },
  shopgoodwill: { enabled: true }
}
```

### Telegram Settings

Edit `config.js`:
```javascript
telegram: {
  enabled: true,
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  notifyOnDeal: true,         // Alert on all profitable deals
  notifyOnHighProfit: true,   // Alert on >50% profit deals
  notifyOnSummary: true,       // Send daily/weekly summaries
  alertThreshold: 30          // Minimum margin % for alerts
}
```

---

## 🔒 Security Best Practices

1. **Environment Variables:** Never commit tokens to git
   ```bash
   # Add to .gitignore
   .env
   config.local.js
   ```

2. **Database Backups:** Regularly backup the SQLite database
   ```bash
   # Backup script
   cp data/sonic_tracker.db backups/sonic_tracker_$(date +%Y%m%d).db
   ```

3. **Rate Limiting:** Don't set search interval too low (min 15 minutes)

4. **Error Monitoring:** Check logs regularly

---

## 🐛 Troubleshooting

### Bot Not Starting

**Check dependencies:**
```bash
npm install
```

**Check Playwright:**
```bash
npx playwright install chromium
```

### No Results Found

- Increase `maxPricePerItem` in config.js
- Verify platforms are enabled
- Check internet connection
- Run test mode: `node index.js test`

### Telegram Not Working

- Verify bot token and chat ID are correct
- Send a message to your bot first
- Check bot is running: `pm2 status`
- View logs: `pm2 logs sonic-bot`

### High Memory Usage

- Restart bot: `pm2 restart sonic-bot`
- Reduce search interval
- Clear old database entries (runs automatically at 3 AM)

### Browser Issues

```bash
# Reinstall Playwright
npx playwright install chromium --force

# Check headless mode in config.js
browser: {
  headless: true  // Set to false for debugging
}
```

---

## 📈 Performance Tips

1. **Optimize Search Interval:** 30 minutes is optimal for most platforms
2. **Limit Platforms:** Disable slow/unreliable platforms
3. **Price Filters:** Set reasonable `maxPricePerItem`
4. **Database Cleanup:** Automatic cleanup runs at 3 AM daily
5. **Monitor Performance:** Check `node index.js stats` regularly

---

## 📞 Getting Help

**Check Logs First:**
- Local: `logs/combined.log` and `logs/error.log`
- PM2: `pm2 logs sonic-bot`
- Cloud: Platform-specific logs

**Useful Commands:**
```bash
# Test mode
node index.js test

# View stats
node index.js stats

# Show setup help
node index.js setup
```

**Resources:**
- Main README: Full feature documentation
- Google Apps Script: Advanced automation
- GitHub Issues: Report bugs

---

## ✅ Deployment Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] Playwright browser installed (`npx playwright install chromium`)
- [ ] Config file customized (`config.js`)
- [ ] Telegram bot created and configured
- [ ] Test run successful (`node index.js test`)
- [ ] Running autonomously (`node index.js schedule` or PM2)
- [ ] Receiving Telegram notifications
- [ ] Database working (`node index.js stats`)
- [ ] Logs being generated
- [ ] Auto-restart configured (PM2 or systemd)

---

**Happy Hunting! 🦔💰**
