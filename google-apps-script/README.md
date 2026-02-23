# Google Apps Script Integration

This directory contains the Google Apps Script code that provides:
- Time-driven triggers for automated searches
- Webhook triggers for instant alerts
- Weekly profit reporting to Google Sheets
- Email reports

## 🚀 Quick Start

### 1. Create Google Apps Script Project

1. Go to [script.google.com](https://script.google.com/)
2. Click "New Project"
3. Copy all code from `Code.js` to the editor
4. Save the project (File → Save)

### 2. Configure Settings

Edit the `CONFIG` object at the top of `Code.js`:

```javascript
const CONFIG = {
  // Sonic Bundle Bot API endpoint
  BOT_API_URL: 'https://your-bot-server.com/api',

  // Telegram configuration (optional)
  TELEGRAM_BOT_TOKEN: 'your_bot_token_here',
  TELEGRAM_CHAT_ID: 'your_chat_id_here',

  // Google Sheet for profit tracking
  SHEET_ID: 'your_google_sheet_id_here',

  // Email for notifications
  EMAIL_ADDRESS: 'your-email@example.com',

  // Schedule settings
  SEARCH_INTERVAL_MINUTES: 30,
  WEEKLY_REPORT_DAY: ScriptApp.WeekDay.SUNDAY,
  WEEKLY_REPORT_HOUR: 20,
  DAILY_REPORT_HOUR: 9,
};
```

### 3. Setup Google Sheets

1. Create a new Google Sheet at [sheets.google.com](https://sheets.google.com/)
2. Copy the Sheet ID from the URL: `docs.google.com/spreadsheets/d/SHEET_ID/edit`
3. Update `CONFIG.SHEET_ID` in the code

### 4. Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Click the gear icon → **Web app**
3. Configure:
   - Description: "Sonic Bundle Bot Webhook"
   - Execute as: **Me** (your account)
   - Who has access: **Anyone** (required for webhooks)
4. Click **Deploy**
5. Authorize the script when prompted
6. Copy the **Web app URL**

### 5. Run Initial Setup

1. Select `setup` from the function dropdown
2. Click **Run**
3. Authorize the script
4. The script will:
   - Create all triggers
   - Initialize Google Sheets with columns
   - Display your webhook URL

## 📊 Features

### Time-Driven Triggers

**Automatic Searches:**
- Runs every 30 minutes (configurable)
- Calls bot API to trigger new search
- Sends Telegram notification with results

**Daily Reports:**
- Runs at 9 AM every day
- Sends summary to Telegram
- Updates Google Sheets with daily stats

**Weekly Reports:**
- Runs Sunday at 8 PM
- Sends comprehensive report to Telegram
- Updates Google Sheets with weekly data
- Sends email report to configured address

### Webhook Triggers

Your web app can receive HTTP POST requests to trigger actions:

```bash
# Trigger a search
curl -X POST WEB_APP_URL \
  -H "Content-Type: application/json" \
  -d '{"action": "search"}'

# Generate a report
curl -X POST WEB_APP_URL \
  -H "Content-Type: application/json" \
  -d '{"action": "report"}'

# Get current stats
curl -X POST WEB_APP_URL \
  -H "Content-Type: application/json" \
  -d '{"action": "stats"}'
```

### Google Sheets Integration

Automatic sheets created:
- **Items** - All found items with profit analysis
- **Bundles** - Bundle opportunities and calculations
- **Stats** - Daily statistics and summaries
- **Dashboard** - Summary with charts and formulas

### Email Reports

Weekly reports sent to your email with:
- Total searches and items found
- Profitable deals count
- Potential and actual profit
- Purchases and sales tracking
- Link to Google Sheets

## 🔧 Available Functions

| Function | Description |
|----------|-------------|
| `setup()` | Initial setup - creates triggers and sheets |
| `triggerSearch()` | Manually trigger a search |
| `sendDailySummary()` | Send daily report immediately |
| `sendWeeklyReport()` | Send weekly report immediately |
| `generateWeeklyReport()` | Full report with Google Sheets sync |
| `listTriggers()` | List all configured triggers |
| `clearAllTriggers()` | Remove all triggers |
| `testSearch()` | Test search functionality |
| `testDailyReport()` | Test daily report |
| `testWeeklyReport()` | Test weekly report |

## 🔌 Integration with Sonic Bundle Bot

### Option 1: Webhook Integration

Add this endpoint to your Sonic Bundle Bot:

```javascript
// In your bot's server code
app.post('/api/search', (req, res) => {
  // Trigger a search
  hunter.run().then(() => {
    res.json({
      success: true,
      itemsFound: hunter.results.length,
      timestamp: new Date().toISOString()
    });
  });
});

app.get('/api/stats/current', (req, res) => {
  res.json(hunter.stats);
});

app.get('/api/stats/daily', (req, res) => {
  res.json(database.getDailyStats(1));
});

app.get('/api/stats/weekly', (req, res) => {
  res.json(database.getWeeklyReport());
});

app.get('/api/export/weekly', (req, res) => {
  res.json({
    items: database.getProfitableItems(100),
    bundles: database.getViableBundles(50),
    stats: database.getWeeklyReport()
  });
});
```

### Option 2: Direct Database Access

The Google Apps Script can query your bot's database directly:

1. Host your bot on a server (Heroku, Railway, etc.)
2. Create API endpoints for data access
3. Use `UrlFetchApp.fetch()` to call these endpoints

## 📈 Example Use Cases

### Use Case 1: Nightly Automation

Configure searches to run every 30 minutes:
- Bot searches eBay, Mercari, Facebook, etc.
- Google Apps Script tracks progress
- Morning summary shows all deals found overnight

### Use Case 2: Weekly Business Review

Set up weekly report for Sunday evening:
- Comprehensive analysis of all finds
- Profit breakdown by platform
- Email sent to your inbox
- Google Sheets updated with full data

### Use Case 3: Real-Time Alerts

Use webhook for instant alerts:
- When bot finds a high-margin deal (>50%)
- Send webhook to Google Apps Script
- Google Apps Script forwards to Telegram and email
- You get notified within minutes

### Use Case 4: Portfolio Tracking

Google Sheets as your profit database:
- Every search updates the Items sheet
- Every purchase tracked in dedicated columns
- Every sale logged with actual profit
- Dashboard formulas calculate totals

## 🔒 Security Considerations

1. **Web App Access**: Set to "Anyone" for webhooks, but validate requests
2. **API Keys**: Store in script properties, not hardcoded:
   ```javascript
   const API_KEY = PropertiesService.getScriptProperties().getProperty('API_KEY');
   ```
3. **Rate Limiting**: Google Apps Script has daily quotas
4. **Authorization**: Use OAuth2 for bot API access when possible

## 📊 Monitoring and Debugging

### View Logs

1. Open your Apps Script project
2. Click **Executions** on the left
3. View function execution history and logs

### Test Functions

1. Select function from dropdown
2. Click **Run**
3. Check output in **Execution Log**

### Check Triggers

Run `listTriggers()` to see all active triggers.

## 🐛 Troubleshooting

### "Authorization required"
- Click **Review Permissions**
- Select your account
- Allow access

### "Web app URL not accessible"
- Check that access is set to "Anyone"
- Redeploy the web app

### "No email sent"
- Check Gmail quota (100/day)
- Verify `EMAIL_ADDRESS` is correct
- Check email spam folder

### "Sheets not updating"
- Verify `SHEET_ID` is correct
- Check script has edit permissions
- Run `setup()` again

## 📚 Advanced Customization

### Custom Report Formatting

Edit the message templates in `sendDailySummary()` and `sendWeeklyReport()`.

### Add New Platforms

Add to `updateItemsSheet()` function:
```javascript
// Add new platform column
itemsSheet.getRange(1, 13).setValue('New Platform');
```

### Custom Charts

Add charts in `createDashboard()`:
```javascript
const chart = dashboard.newChart()
  .setChartType(Charts.ChartType.BAR)
  .addRange(dataRange)
  .setPosition(row, column, numRows, numColumns);
```

## 🔗 Useful Resources

- [Google Apps Script Documentation](https://developers.google.com/apps-script)
- [Spreadsheet Service](https://developers.google.com/apps-script/reference/spreadsheet)
- [UrlFetch Service](https://developers.google.com/apps-script/reference/url-fetch)
- [Content Service](https://developers.google.com/apps-script/reference/content)
- [Triggers](https://developers.google.com/apps-script/reference/script/trigger)

## 💡 Tips

1. **Start Small**: Test with `testSearch()` before enabling triggers
2. **Monitor Logs**: Check execution logs regularly
3. **Backup Data**: Google Sheets auto-saves, but export regularly
4. **Rate Limits**: Stay within Apps Script quotas
5. **Error Handling**: Add try-catch blocks for API calls

## 🆘 Support

For issues with:
- **Sonic Bundle Bot**: Check the main README
- **Google Apps Script**: Visit [Stack Overflow](https://stackoverflow.com/questions/tagged/google-apps-script)
- **API Integration**: Verify bot server is running and accessible

---

**Happy Automation! 🤖📊**
