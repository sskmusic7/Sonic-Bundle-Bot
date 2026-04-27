/**
 * Sonic Flipper — Persistent Telegram Bot (polling) — OPTIMISED
 * Commands: /report, /bundles, /scan, /status, /top5, /prospects, /market, /setinterval, /help
 * Built-in auto-scan cron (no Playwright dependency)
 */

'use strict';

require('dotenv').config({ override: true });
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const config = require('./config');
const fs = require('fs');

const Database = require('better-sqlite3');

const { AgentRunner } = require('./agents/runner');

const BOT_TOKEN = config.telegram.botToken;
const CHAT_ID   = String(config.telegram.chatId);
const DB_PATH   = './data/sonic_tracker.db';
const LOCK_FILE = './data/bot.lock';

// ── Single-Instance Lock ───────────────────────────────────────────────────

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    try {
      process.kill(lockData.pid, 0); // Check if PID exists
      console.error(`Bot already running (PID ${lockData.pid}). Exiting.`);
      process.exit(1);
    } catch {
      console.log(`Removing stale lock from PID ${lockData.pid}`);
      fs.unlinkSync(LOCK_FILE);
    }
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
  console.log(`Lock acquired (PID ${process.pid})`);
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    console.log('Lock released');
  }
}

// Acquire lock before starting bot
acquireLock();

// Signal handlers for graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down...');
  releaseLock();
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  releaseLock();
  process.exit(0);
});
process.on('exit', releaseLock);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('Sonic Flipper Bot v4.0 starting...');

// ── Shrine Pipeline (Agent Runner) ──────────────────────────────────────────

let agentRunner = null;

function initShrineAgents() {
  if (!config.shrine?.enabled) {
    console.log('Shrine pipeline disabled in config');
    return;
  }

  try {
    const { ensureDb } = require('./ebay-sales-tracking');
    const db = ensureDb();

    agentRunner = new AgentRunner(db, bot, CHAT_ID);

    // Register all agents
    agentRunner.register(require('./agents/sourcer'));
    agentRunner.register(require('./agents/validator'));
    agentRunner.register(require('./agents/bundler'));
    agentRunner.register(require('./agents/creative'));
    agentRunner.register(require('./agents/lister'));
    agentRunner.register(require('./agents/guardian'));

    agentRunner.startAll();
    console.log('Shrine pipeline: 6 agents registered and started');
  } catch (err) {
    console.error('Shrine pipeline init failed:', err.message);
  }
}

// ── State ──────────────────────────────────────────────────────────────────

let autoScanIntervalHours = 6;     // Default: every 6 hours (4x/day)
let lastScanItemCount = 0;         // For dedup: track item count from last scan
let lastScanTime = null;
let scanRunning = false;
let cronTask = null;
let watcherCronTask = null;        // Watcher cron (every 2 hours)

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Full scan + report pipeline ────────────────────────────────────────────

async function runFullScan(chatId, silent = false, brief = false, detailed = false) {
  if (scanRunning) {
    if (!silent) await reply(chatId, '⏳ Scan already running, please wait...');
    return;
  }

  scanRunning = true;
  const startTime = Date.now();

  try {
    // 1. Run eBay API scan
    if (!silent) await reply(chatId, '🔍 Running eBay scan...');
    const tracking = require('./ebay-sales-tracking');
    const scanStats = await tracking.main();

    // 2. Load items from DB
    const { sendBundleReports, sendTop5ByCategory, sendProspects, openDb, getAllItems } = require('./sonic-bundle-report');
    const db    = openDb();
    const items = getAllItems(db);
    db.close();

    const currentCount = items.length;
    const newItems = currentCount - lastScanItemCount;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (newItems > 0 || lastScanItemCount === 0) {
      if (brief) {
        // Auto-scan: brief summary only — saves tokens
        const cheapest = items.slice().sort((a, b) => a.price - b.price).slice(0, 3);
        const cheapList = cheapest.map(i => `  • ${i.title.slice(0, 40)} — $${i.price.toFixed(2)}`).join('\n');
        await reply(chatId,
          `🔄 *Auto-scan* — ${elapsed}s\n` +
          `*${newItems} new items* (${currentCount} total)\n\n` +
          `💰 *Cheapest new finds:*\n${cheapList}\n\n` +
          `_Use /scan for full reports_`
        );
      } else {
        // Manual /scan: full reports (concise by default, detailed if requested)
        await reply(chatId, `✅ Scan complete in ${elapsed}s — *${newItems} new items* found (${currentCount} total)`);
        await sendBundleReports(items, detailed);
        await sendProspects(items, detailed);
        await sendTop5ByCategory(items, detailed);
      }
    } else {
      await reply(chatId, `${brief ? '🔄 *Auto-scan*' : '✅ Scan complete'} — ${elapsed}s — no new items. ${currentCount} total in DB.`);
    }

    // Send bundle completion alerts from scan
    if (scanStats.bundleAlerts && scanStats.bundleAlerts.length > 0) {
      for (const alert of scanStats.bundleAlerts) {
        await reply(chatId, alert.message);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    lastScanItemCount = currentCount;
    lastScanTime = new Date().toISOString();

  } catch (err) {
    console.error('Scan error:', err.message);
    await reply(chatId, `❌ *Scan failed:* ${err.message}`);
  } finally {
    scanRunning = false;
  }
}

// ── Auto-scan cron ─────────────────────────────────────────────────────────

function startAutoScan() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  if (autoScanIntervalHours <= 0) {
    console.log('Auto-scan disabled (interval <= 0)');
    return;
  }

  // Convert hours to cron: e.g. 2h = "0 */2 * * *", 0.5h = "*/30 * * * *"
  let cronPattern;
  if (autoScanIntervalHours < 1) {
    const minutes = Math.max(1, Math.round(autoScanIntervalHours * 60));
    cronPattern = `*/${minutes} * * * *`;
  } else {
    const hours = Math.round(autoScanIntervalHours);
    cronPattern = `0 */${hours} * * *`;
  }

  cronTask = cron.schedule(cronPattern, async () => {
    console.log(`[AUTO-SCAN] Triggered at ${new Date().toISOString()}`);
    await runFullScan(CHAT_ID, false, true);
  });

  console.log(`Auto-scan started: every ${autoScanIntervalHours}h (cron: ${cronPattern})`);
}

// ── Command handlers ───────────────────────────────────────────────────────

bot.onText(/\/(report|bundles)\s*(.*)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const arg = (match[2] || '').trim().toLowerCase();
  const detailed = arg === 'detailed';
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
    await sendBundleReports(items, detailed);
    await reply(chatId, '✅ Bundle report sent.');
  });
});

bot.onText(/\/scan\s*(.*)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const arg = (match[1] || '').trim().toLowerCase();
  const detailed = arg === 'detailed';
  await runFullScan(chatId, false, false, detailed);
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
    let scanCount = 0;

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

    try {
      const row = db.prepare('SELECT COUNT(*) AS cnt FROM scan_log').get();
      scanCount = row ? row.cnt : 0;
    } catch (e) { /* ignore */ }

    db.close();

    // Shrine pipeline counts
    let shrineInfo = '';
    if (agentRunner) {
      try {
        const counts = agentRunner.getPipelineCounts();
        shrineInfo = `\n*Shrine Pipeline:*\n` +
          `  📥 Sourced: ${counts.sourced} pending | ${counts.validated} valid\n` +
          `  📦 Bundles: ${counts.ready} ready | ${counts.active} active | ${counts.sold} sold\n`;
      } catch (e) { /* ignore */ }
    }

    const text = `*Sonic Flipper Status*\n\n` +
      `📦 Items in DB: ${itemCount}\n` +
      `🕐 Last scan: ${lastScanTime || lastScan}\n` +
      `🔄 Total scans: ${scanCount}\n` +
      `🛒 Bundles tracked: ${bundleCount}\n` +
      `⏰ Auto-scan: every ${autoScanIntervalHours}h\n` +
      `${scanRunning ? '🔍 Scan currently running...' : '✅ Idle'}` +
      `${shrineInfo}`;
    await reply(chatId, text);
  });
});

bot.onText(/\/top5\s*(.*)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const arg = (match[1] || '').trim().toLowerCase();
  const detailed = arg === 'detailed';
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
    await sendTop5ByCategory(items, detailed);
    await reply(chatId, '✅ Top 5 sent.');
  });
});

// ── /market — Market intelligence report ───────────────────────────────────

bot.onText(/\/market/, async (msg) => {
  const chatId = String(msg.chat.id);
  await reply(chatId, '📊 Generating market intelligence...');
  await safeRun(chatId, 'Market', async () => {
    const { sendMarketReport, openDb, getAllItems } = require('./sonic-bundle-report');
    const db   = openDb();
    const items = getAllItems(db);
    db.close();
    if (items.length === 0) {
      await reply(chatId, 'No market data yet. Run /scan first.');
      return;
    }
    await sendMarketReport(items);
    await reply(chatId, '✅ Market report sent.');
  });
});

// ── /setinterval — Change auto-scan frequency ─────────────────────────────

bot.onText(/\/setinterval\s*(.*)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const val = parseFloat(match[1]);

  if (isNaN(val) || val < 0) {
    await reply(chatId, '*Usage:* `/setinterval <hours>`\n\nExamples:\n`/setinterval 1` — every hour\n`/setinterval 4` — every 4 hours\n`/setinterval 6` — every 6 hours (default)\n`/setinterval 0.5` — every 30 min\n`/setinterval 0` — disable auto-scan');
    return;
  }

  autoScanIntervalHours = val;

  if (val === 0) {
    if (cronTask) { cronTask.stop(); cronTask = null; }
    await reply(chatId, '⏸️ Auto-scan *disabled*.');
  } else {
    startAutoScan();
    await reply(chatId, `✅ Auto-scan interval set to *${val} hours*.`);
  }
});

// ── /ebayauth — 3-legged OAuth flow ─────────────────────────────────────

bot.onText(/\/ebayauth/, async (msg) => {
  const chatId = String(msg.chat.id);
  await safeRun(chatId, 'eBay Auth', async () => {
    const ebayAuth = require('./ebay-auth');
    const { ensureDb } = require('./ebay-sales-tracking');
    const db = ensureDb();

    const { authUrl, waitForCode } = await ebayAuth.runAuthFlow(db);

    await reply(chatId,
      `🔐 *eBay Authorization Required*\n\n` +
      `Click the link below to authorize Sonic Bot to list items on your eBay account:\n\n` +
      `[Authorize on eBay](${authUrl})\n\n` +
      `_Waiting up to 5 minutes for authorization..._`
    );

    try {
      await waitForCode();
      await reply(chatId, '✅ *eBay authorization successful!* Tokens stored. You can now use /list to create listings.');
    } catch (err) {
      await reply(chatId, `❌ Authorization failed: ${err.message}`);
    }

    db.close();
  });
});

// ── /list — Create eBay listing for a bundle ────────────────────────────

bot.onText(/\/list\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const bundleName = match[1].trim();

  await safeRun(chatId, 'List Bundle', async () => {
    const { BUNDLE_DEFINITIONS, findCheapestMatch, openDb, getAllItems } = require('./sonic-bundle-report');
    const ebayAuth = require('./ebay-auth');
    const ebayLister = require('./ebay-lister');
    const { ensureDb } = require('./ebay-sales-tracking');

    // Find matching bundle definition
    const bundle = BUNDLE_DEFINITIONS.find(b =>
      b.name.toLowerCase().includes(bundleName.toLowerCase())
    );

    if (!bundle) {
      const names = BUNDLE_DEFINITIONS.map(b => `  • ${b.name}`).join('\n');
      await reply(chatId, `❌ Bundle not found: "${bundleName}"\n\n*Available bundles:*\n${names}`);
      return;
    }

    // Check for user token
    const db = ensureDb();
    const userToken = await ebayAuth.getUserToken(db);

    if (!userToken) {
      await reply(chatId, '❌ No eBay auth token. Run /ebayauth first.');
      db.close();
      return;
    }

    // Check bundle viability
    const readDb = openDb();
    const items = getAllItems(readDb);
    readDb.close();

    const found = [];
    let totalCost = 0;

    for (const comp of bundle.components) {
      const item = findCheapestMatch(items, comp.keywords, comp.exclude, comp.altKeywords);
      found.push({ label: comp.label, item });
      if (item) totalCost += Number(item.price);
    }

    const fullyViable = found.every(f => f.item !== null);

    if (!fullyViable) {
      const missing = found.filter(f => !f.item).map(f => f.label).join(', ');
      await reply(chatId, `❌ Bundle "${bundle.name}" is not fully viable.\n\nMissing: ${missing}`);
      db.close();
      return;
    }

    await reply(chatId, `📦 Creating eBay listing for "${bundle.name}"...\nGenerating AI copy + artwork...`);

    try {
      const result = await ebayLister.createBundleListing(bundle, found, userToken);

      // Send artwork to Telegram if generated
      if (result.artBuffer) {
        const { sendTelegramPhoto } = require('./sonic-bundle-report');
        await sendTelegramPhoto(result.artBuffer, `🎨 *${bundle.name}* — Listing Artwork`);
      }

      await reply(chatId,
        `✅ *eBay Listing Created!*\n\n` +
        `📦 *${result.title}*\n` +
        `💰 Price: $${bundle.resaleValue}\n` +
        `🏷️ SKU: ${result.sku}\n` +
        `🔗 [View Listing](${result.listingUrl})`
      );
    } catch (err) {
      await reply(chatId, `❌ Listing creation failed: ${err.response?.data?.errors?.[0]?.message || err.message}`);
    }

    db.close();
  });
});

// ── /watch — Watch an eBay item for sold/price changes ──────────────────

bot.onText(/\/watch\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const input = match[1].trim();

  await safeRun(chatId, 'Watch', async () => {
    const watcher = require('./ebay-watcher');
    const { ensureDb } = require('./ebay-sales-tracking');

    const itemId = watcher.extractEbayItemId(input);
    if (!itemId) {
      await reply(chatId, '❌ Could not parse eBay item ID.\n\nUsage: `/watch <ebay_url>` or `/watch <item_id>`');
      return;
    }

    const db = ensureDb();

    // Try to get item details from Browse API
    let title = `Item ${itemId}`;
    let price = 0;

    try {
      const tracking = require('./ebay-sales-tracking');
      // Reuse the client_credentials token
      const tokenMod = require('./ebay-sales-tracking');
      // We need to get an OAuth token — import the function
      const axios = require('axios');
      const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
      const EBAY_CERT_ID = process.env.EBAY_CERT_ID || '';

      const params = new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' });
      const tokenResp = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64')}`
        }
      });
      const token = tokenResp.data.access_token;

      const itemResp = await axios.get(`https://api.ebay.com/buy/browse/v1/item/${itemId}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
        timeout: 10000
      });
      title = itemResp.data.title || title;
      price = itemResp.data.price?.value ? parseFloat(itemResp.data.price.value) : 0;
    } catch (err) {
      // Non-fatal — we'll watch it with minimal info
      console.warn('Could not fetch item details:', err.message);
    }

    watcher.addWatchedItem(db, itemId, title, price, 'manual');
    db.close();

    await reply(chatId,
      `👁️ *Now watching:*\n` +
      `${title}\n` +
      `💰 $${price.toFixed(2)}\n` +
      `🆔 ${itemId}\n\n` +
      `_You'll get alerts for sold, ended, or 20%+ price changes._`
    );
  });
});

// ── /unwatch — Stop watching an item ────────────────────────────────────

bot.onText(/\/unwatch\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const input = match[1].trim();

  await safeRun(chatId, 'Unwatch', async () => {
    const watcher = require('./ebay-watcher');
    const { ensureDb } = require('./ebay-sales-tracking');
    const db = ensureDb();

    const removed = watcher.removeWatchedItem(db, input);
    db.close();

    if (removed) {
      await reply(chatId, `✅ Removed from watch list.`);
    } else {
      await reply(chatId, `❌ Item not found in watch list. Use /watching to see active items.`);
    }
  });
});

// ── /watching — Show all watched items ──────────────────────────────────

bot.onText(/\/watching/, async (msg) => {
  const chatId = String(msg.chat.id);

  await safeRun(chatId, 'Watching', async () => {
    const watcher = require('./ebay-watcher');
    const { ensureDb } = require('./ebay-sales-tracking');
    const db = ensureDb();

    const items = watcher.getWatchedItems(db);
    db.close();

    if (items.length === 0) {
      await reply(chatId, '👁️ *No items being watched.*\n\nUse `/watch <ebay_url>` to start watching.');
      return;
    }

    let msg_text = `👁️ *Watching ${items.length} items:*\n\n`;
    for (const item of items) {
      msg_text += `*${item.id}.* ${item.title.slice(0, 50)}\n`;
      msg_text += `   💰 $${item.price.toFixed(2)} | Added: ${item.added_at}\n`;
      if (item.watch_reason) msg_text += `   📌 ${item.watch_reason}\n`;
      msg_text += '\n';
    }
    msg_text += `_Use /unwatch <id> to stop watching._`;

    await reply(chatId, msg_text);
  });
});

// ── /shrine — Shrine pipeline dashboard ──────────────────────────────────

bot.onText(/\/shrine/, async (msg) => {
  const chatId = String(msg.chat.id);
  if (!agentRunner) {
    await reply(chatId, '❌ Shrine pipeline not active. Check config.');
    return;
  }

  await safeRun(chatId, 'Shrine', async () => {
    const counts = agentRunner.getPipelineCounts();
    const statuses = agentRunner.getStatus();

    let agentLines = '';
    for (const [name, s] of Object.entries(statuses)) {
      const icon = s.running ? '🔄' : s.paused ? '⏸️' : '✅';
      const lastInfo = s.lastRun
        ? `${s.lastRun.status} (${s.lastRun.processed} items, ${s.lastRun.at})`
        : 'never run';
      agentLines += `${icon} *${name}*: ${lastInfo}\n`;
    }

    await reply(chatId,
      `*Shrine Pipeline Dashboard*\n\n` +
      `*Pipeline Counts:*\n` +
      `  📥 Sourced (pending): ${counts.sourced}\n` +
      `  ✅ Validated: ${counts.validated}\n` +
      `  ❌ Rejected: ${counts.rejected}\n` +
      `  🔧 Assembling: ${counts.assembling}\n` +
      `  📦 Ready to list: ${counts.ready}\n` +
      `  🟢 Active listings: ${counts.active}\n` +
      `  🔴 Broken: ${counts.broken}\n` +
      `  💰 Sold: ${counts.sold}\n\n` +
      `*Agents:*\n${agentLines}\n` +
      `_/runagent <name> | /pauseagent <name> | /resumeagent <name>_`
    );
  });
});

// ── /runagent — Trigger a single agent run ───────────────────────────────

bot.onText(/\/runagent\s+(.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const agentName = match[1].trim().toLowerCase();

  if (!agentRunner) {
    await reply(chatId, '❌ Shrine pipeline not active.');
    return;
  }

  await reply(chatId, `🔄 Running *${agentName}*...`);
  await safeRun(chatId, `Run ${agentName}`, async () => {
    const result = await agentRunner.runAgent(agentName);
    if (result.skipped) {
      await reply(chatId, `⏭️ *${agentName}* skipped: ${result.reason}`);
    } else if (result.success) {
      await reply(chatId, `✅ *${agentName}* completed in ${result.elapsed}s — ${result.processed || 0} processed`);
    } else {
      await reply(chatId, `❌ *${agentName}* failed: ${result.error}`);
    }
  });
});

// ── /pauseagent — Pause an agent (or all) ────────────────────────────────

bot.onText(/\/pauseagent\s*(.*)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const agentName = (match[1] || '').trim().toLowerCase();

  if (!agentRunner) {
    await reply(chatId, '❌ Shrine pipeline not active.');
    return;
  }

  if (agentName) {
    agentRunner.pause(agentName);
    await reply(chatId, `⏸️ *${agentName}* paused.`);
  } else {
    agentRunner.pause();
    await reply(chatId, '⏸️ All agents paused.');
  }
});

// ── /resumeagent — Resume an agent (or all) ─────────────────────────────

bot.onText(/\/resumeagent\s*(.*)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const agentName = (match[1] || '').trim().toLowerCase();

  if (!agentRunner) {
    await reply(chatId, '❌ Shrine pipeline not active.');
    return;
  }

  if (agentName) {
    const ok = agentRunner.resume(agentName);
    await reply(chatId, ok ? `▶️ *${agentName}* resumed.` : `❌ Unknown agent: ${agentName}`);
  } else {
    agentRunner.resume();
    await reply(chatId, '▶️ All agents resumed.');
  }
});

// ── /bundles — Show shrine bundles from pipeline ────────────────────────

bot.onText(/\/shrinelist/, async (msg) => {
  const chatId = String(msg.chat.id);

  await safeRun(chatId, 'Shrine List', async () => {
    const { ensureDb } = require('./ebay-sales-tracking');
    const db = ensureDb();

    const bundles = db.prepare(`
      SELECT * FROM shrine_bundles ORDER BY created_at DESC LIMIT 10
    `).all();

    if (bundles.length === 0) {
      await reply(chatId, '📦 No shrine bundles yet. Pipeline is sourcing items...');
      db.close();
      return;
    }

    let text = `*Shrine Bundles (${bundles.length}):*\n\n`;
    for (const b of bundles) {
      const icon = { assembling: '🔧', ready: '📦', listing: '📝', active: '🟢', broken: '🔴', sold: '💰' }[b.status] || '❓';
      text += `${icon} *${b.bundle_name}*\n`;
      text += `   ${b.target_character} | $${b.total_cost?.toFixed(2)} cost → $${b.list_price?.toFixed(2)} list | ${b.margin_pct}% margin\n`;
      text += `   Status: ${b.status}`;
      if (b.ebay_listing_id) text += ` | [eBay](https://www.ebay.com/itm/${b.ebay_listing_id})`;
      text += '\n\n';
    }

    await reply(chatId, text);
    db.close();
  });
});

// ── /help ──────────────────────────────────────────────────────────────────

bot.onText(/\/help/, async (msg) => {
  const chatId = String(msg.chat.id);
  const text = `*Sonic Flipper Bot v4.0 — Commands*\n\n` +
    `*Scanning:*\n` +
    `/scan — Fresh eBay scan + concise reports\n` +
    `/scan detailed — Full verbose reports with AI analysis\n` +
    `/setinterval <hours> — Set auto-scan interval (default: 6h)\n\n` +
    `*Reports:*\n` +
    `/report — Bundle opportunity report (concise)\n` +
    `/report detailed — Verbose report with AI analysis + artwork\n` +
    `/prospects — Show partial bundle matches\n` +
    `/top5 — Top 5 cheapest per category (deduped)\n` +
    `/market — Market intelligence (averages, distribution)\n\n` +
    `*Shrine Pipeline (Autonomous):*\n` +
    `/shrine — Pipeline dashboard (counts + agent status)\n` +
    `/shrinelist — Show assembled bundles\n` +
    `/runagent <name> — Trigger agent manually\n` +
    `/pauseagent [name] — Pause agent (or all)\n` +
    `/resumeagent [name] — Resume agent (or all)\n` +
    `_Agents: sourcer, validator, bundler, creative, lister, guardian_\n\n` +
    `*eBay Listing:*\n` +
    `/ebayauth — Authorize eBay Sell API (one-time)\n` +
    `/list <bundle> — Auto-create eBay listing with AI copy\n\n` +
    `*Watching:*\n` +
    `/watch <url/id> — Watch an eBay item for changes\n` +
    `/unwatch <id> — Stop watching\n` +
    `/watching — Show all watched items\n\n` +
    `*Info:*\n` +
    `/status — DB stats, scan status, auto-scan interval\n` +
    `/help — Show this help\n\n` +
    `_v4.0: Shrine Pipeline — 6 autonomous agents (source→validate→bundle→create→list→guard)_`;
  await reply(chatId, text);
});

// ── Error handlers ─────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

bot.on('error', (err) => {
  console.error('Bot error:', err.message);
});

// ── Startup ────────────────────────────────────────────────────────────────

reply(CHAT_ID, `🚀 *Sonic Flipper Bot v4.0 started*\n\n` +
  `📦 6 bundle tiers active\n` +
  `🤖 Gemini AI analysis + image gen\n` +
  `🏛️ Shrine Pipeline: 6 autonomous agents\n` +
  `👁️ Item watcher + sell-through alerts\n` +
  `⏰ Auto-scan: every ${autoScanIntervalHours}h\n\n` +
  `Send /help for full command list.`)
  .then(() => console.log('Startup notification sent.'))
  .catch(err => console.error('Startup notification failed:', err.message));

// Start auto-scan cron
startAutoScan();

// Start shrine pipeline agents
initShrineAgents();

// ── Watcher cron — check watched items every 2 hours ─────────────────────

function startWatcherCron() {
  if (watcherCronTask) { watcherCronTask.stop(); watcherCronTask = null; }

  watcherCronTask = cron.schedule('0 */2 * * *', async () => {
    console.log(`[WATCHER] Checking watched items at ${new Date().toISOString()}`);
    try {
      const watcher = require('./ebay-watcher');
      const { ensureDb } = require('./ebay-sales-tracking');
      const axios = require('axios');

      const db = ensureDb();

      // Get client_credentials token for Browse API
      const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
      const EBAY_CERT_ID = process.env.EBAY_CERT_ID || '';
      const params = new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' });
      const tokenResp = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64')}`
        }
      });
      const token = tokenResp.data.access_token;

      const alerts = await watcher.checkWatchedItems(db, token);
      db.close();

      for (const alert of alerts) {
        await reply(CHAT_ID, alert.message);
        await new Promise(r => setTimeout(r, 500));
      }

      if (alerts.length > 0) {
        console.log(`[WATCHER] Sent ${alerts.length} alerts`);
      }
    } catch (err) {
      console.error('[WATCHER] Error:', err.message);
    }
  });

  console.log('Watcher cron started: every 2 hours');
}

startWatcherCron();

console.log('Bot is running and polling for messages.');
console.log(`Auto-scan interval: ${autoScanIntervalHours}h`);
