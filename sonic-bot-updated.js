/**
 * Sonic Flipper — Persistent Telegram Bot (polling)
 * Commands: /report, /bundles, /scan, /status, /top5, /prospects, /help
 */

'use strict';

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

const BOT_TOKEN = config.telegram.botToken;
const CHAT_ID   = String(config.telegram.chatId);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('Sonic Flipper Bot starting...');

// ── helpers ────────────────────────────────────────────────────────────────

function reply(chatId, text) {
  return bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  }).catch(err => console.error('Reply failed:', err.message));
}

async function safeRun(chatId, label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} error:`, err.message);
    await reply(chatId, `❌ *${label} failed:* ${err.message}`);
  }
}

// ── command handlers ───────────────────────────────────────────────────────

bot.onText(/\/(report|bundles)/, async (msg) => {
  const chatId = String(msg.chat.id);
  await reply(chatId, 'Running bundle report...');
  await safeRun(chatId, 'Bundle report', async () => {
    const { sendBundleReports, openDb, getAllItems } = require('./sonic-bundle-report');
    const db   = openDb();
    const items = getAllItems(db);
    db.close();
    if (items.length === 0) {
      await reply(chatId, 'No items in DB yet. Run /scan first.');
      return;
    }
    await sendBundleReports(items);
    await reply(chatId, '✅ Bundle report sent.');
  });
});

bot.onText(/\/scan/, async (msg) => {
  const chatId = String(msg.chat.id);
  await reply(chatId, '🔍 Running fresh eBay scan + bundle report + prospects... (this may take a minute)');
  await safeRun(chatId, 'Scan', async () => {
    const tracking = require('./ebay-sales-tracking');
    await tracking.main();
    await reply(chatId, '✅ eBay scan complete. Generating reports...');
    const { sendBundleReports, sendTop5ByCategory, sendProspects, openDb, getAllItems } = require('./sonic-bundle-report');
    const db   = openDb();
    const items = getAllItems(db);
    db.close();
    await sendBundleReports(items);
    await sendProspects(items);
    await sendTop5ByCategory(items);
    await reply(chatId, '✅ Scan + reports + prospects complete.');
  });
});

bot.onText(/\/prospects/, async (msg) => {
  const chatId = String(msg.chat.id);
  await reply(chatId, '🎯 Checking package prospects...');
  await safeRun(chatId, 'Prospects', async () => {
    const { sendProspects, openDb, getAllItems } = require('./sonic-bundle-report');
    const db   = openDb();
    const items = getAllItems(db);
    db.close();
    if (items.length === 0) {
      await reply(chatId, 'No items in DB yet. Run /scan first.');
      return;
    }
    await sendProspects(items);
    await reply(chatId, '✅ Prospects report sent.');
  });
});

bot.onText(/\/status/, async (msg) => {
  const chatId = String(msg.chat.id);
  await safeRun(chatId, 'Status', async () => {
    const { openDb } = require('./sonic-bundle-report');
    const db = openDb();

    let itemCount = 0;
    let lastScan  = 'N/A';
    let bundleCount = 0;

    try {
      const row = db.prepare('SELECT COUNT(*) AS cnt FROM items').get();
      itemCount = row ? row.cnt : 0;
    } catch (e) { /* table may not exist yet */ }

    try {
      const row = db.prepare('SELECT timestamp FROM items ORDER BY timestamp DESC LIMIT 1').get();
      if (row) lastScan = row.timestamp;
    } catch (e) { /* ignore */ }

    try {
      const row = db.prepare('SELECT COUNT(*) AS cnt FROM purchases').get();
      bundleCount = row ? row.cnt : 0;
    } catch (e) { /* table may not exist yet */ }

    db.close();

    const text = `*Sonic Flipper Status*\n\n` +
      `📦 Items in DB: ${itemCount}\n` +
      `🕐 Last scan: ${lastScan}\n` +
      `🛒 Bundles tracked: ${bundleCount}`;
    await reply(chatId, text);
  });
});

bot.onText(/\/top5/, async (msg) => {
  const chatId = String(msg.chat.id);
  await reply(chatId, 'Fetching top 5 cheapest per category...');
  await safeRun(chatId, 'Top5', async () => {
    const { sendTop5ByCategory, openDb, getAllItems } = require('./sonic-bundle-report');
    const db   = openDb();
    const items = getAllItems(db);
    db.close();
    if (items.length === 0) {
      await reply(chatId, 'No items in DB yet. Run /scan first.');
      return;
    }
    await sendTop5ByCategory(items);
    await reply(chatId, '✅ Top 5 sent.');
  });
});

bot.onText(/\/help/, async (msg) => {
  const chatId = String(msg.chat.id);
  const text = `*Sonic Flipper Bot — Commands*\n\n` +
    `/scan — Fresh eBay scan + full reports + prospects\n` +
    `/report or /bundles — Bundle opportunity report\n` +
    `/prospects — Show potential package prospects (partial bundles)\n` +
    `/status — DB item count, last scan time\n` +
    `/top5 — Top 5 cheapest items per category\n` +
    `/help — Show this help`;
  await reply(chatId, text);
});

// ── polling error handler ──────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

bot.on('error', (err) => {
  console.error('Bot error:', err.message);
});

// ── startup notification ───────────────────────────────────────────────────

reply(CHAT_ID, '🚀 *Sonic Flipper Bot started* — send /help for commands.')
  .then(() => console.log('Startup notification sent.'))
  .catch(err => console.error('Startup notification failed:', err.message));

console.log('Bot is running and polling for messages.');
