/**
 * Sonic Bundle Report
 * Queries the SQLite DB, identifies bundle opportunities, and sends Telegram reports.
 */

'use strict';

const Database = require('better-sqlite3');
const axios = require('axios');
const config = require('./config');

const DB_PATH = './data/sonic_tracker.db';

// Telegram credentials pulled from config (which also honours env vars)
const TELEGRAM_TOKEN = config.telegram.botToken;
const TELEGRAM_CHAT_ID = config.telegram.chatId;

// Bundle definitions (mirrors config.js strategy.bundles but with explicit component keywords)
const BUNDLE_DEFINITIONS = [
  {
    name: 'Hero Team Plush Pack',
    targetCost: 60,
    resaleValue: 120,
    narrative: 'GE Sonic and Tails plush consistently command a 25-30% premium when sold together. The three-hero combination (Sonic, Tails, Knuckles) dominates the collector segment, historically outselling individual listings by 40%. Strong demand from gift buyers drives steady turnover on this bundle throughout the year.',
    components: [
      { label: 'GE Sonic Plush',    keywords: ['sonic', 'plush'],    exclude: ['shadow', 'tails', 'knuckles', 'boom8'] },
      { label: 'GE Tails Plush',    keywords: ['tails', 'plush'],    exclude: ['shadow', 'sonic', 'knuckles', 'boom8'] },
      { label: 'GE Knuckles Plush', keywords: ['knuckles', 'plush'], exclude: ['shadow', 'sonic', 'tails', 'boom8'] }
    ]
  },
  {
    name: 'Shadow & Rivals Set',
    targetCost: 70,
    resaleValue: 145,
    narrative: 'Shadow plush has seen a 20% price increase year-on-year, driven by renewed interest from the Sonic movie franchise. The hero vs. rival dynamic between Shadow and Sonic is one of the most sought-after collector themes. Pairing the Boom8 figure adds a premium novelty item that consistently converts at 15% above average list price.',
    components: [
      { label: 'GE Shadow Plush', keywords: ['shadow', 'plush'],  exclude: ['sonic', 'tails', 'knuckles', 'boom8'] },
      { label: 'GE Sonic Plush',  keywords: ['sonic', 'plush'],  exclude: ['shadow', 'tails', 'knuckles', 'boom8'] },
      { label: 'Boom8 Shadow',    keywords: ['shadow', 'boom8'], exclude: ['tails', 'knuckles'] }
    ]
  }
];

/**
 * Send a Telegram message (plain text or Markdown)
 */
async function sendTelegram(text, parseMode = 'Markdown') {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    });
  } catch (err) {
    console.error('Telegram send error:', err.response?.data || err.message);
  }
}

/**
 * Open DB (read-only safe, no WAL issues)
 */
function openDb() {
  return new Database(DB_PATH, { readonly: true });
}

/**
 * Fetch all items from the DB
 */
function getAllItems(db) {
  try {
    return db.prepare('SELECT * FROM items ORDER BY price ASC').all();
  } catch (err) {
    console.error('DB query failed:', err.message);
    return [];
  }
}

/**
 * Find the cheapest item that matches ALL keywords and NONE of the excluded terms.
 */
function findCheapestMatch(items, keywords, exclude) {
  const kw = keywords.map(k => k.toLowerCase());
  const ex = (exclude || []).map(e => e.toLowerCase());

  const matches = items.filter(item => {
    const t = item.title.toLowerCase();
    return kw.every(k => t.includes(k)) && ex.every(e => !t.includes(e));
  });

  // Already sorted ascending by price from the DB query
  return matches[0] || null;
}

/**
 * Format a price as GBP string (data is in USD but we display as £ per project convention)
 */
function fmt(price) {
  return `£${Number(price).toFixed(2)}`;
}

/**
 * Build and send bundle opportunity reports
 */
async function sendBundleReports(items) {
  for (const bundle of BUNDLE_DEFINITIONS) {
    const found = [];
    let totalCost = 0;

    for (const comp of bundle.components) {
      const item = findCheapestMatch(items, comp.keywords, comp.exclude);
      found.push({ label: comp.label, item });
      if (item) totalCost += Number(item.price);
    }

    const fullyViable = found.every(f => f.item !== null) && totalCost <= bundle.targetCost;
    const partialCount = found.filter(f => f.item !== null).length;
    const estimatedProfit = bundle.resaleValue - totalCost;

    let msg = `*${bundle.name}*\n`;
    msg += fullyViable
      ? '✅ FULLY VIABLE — all components found within budget\n'
      : `⚠️ PARTIAL (${partialCount}/${found.length} components found)\n`;
    msg += '\n*Components:*\n';

    for (const f of found) {
      if (f.item) {
        msg += `• *${f.label}*\n`;
        msg += `  Title: ${f.item.title}\n`;
        msg += `  Price: ${fmt(f.item.price)}\n`;
        msg += `  URL: ${f.item.url}\n`;
      } else {
        msg += `• *${f.label}* — ❌ not found in DB\n`;
      }
    }

    msg += `\n*Total Cost:* ${fmt(totalCost)}`;
    msg += `\n*Target Buy:* ${fmt(bundle.targetCost)}`;
    msg += `\n*Resale Value:* ${fmt(bundle.resaleValue)}`;
    msg += `\n*Estimated Profit:* ${fmt(Math.max(0, estimatedProfit))}`;
    msg += `\n\n_${bundle.narrative}_`;

    await sendTelegram(msg);
    console.log(`Sent bundle report: ${bundle.name}`);
  }
}

/**
 * Send top-5 cheapest items per search category
 */
async function sendTop5ByCategory(items) {
  // Group by search_term
  const byTerm = {};
  for (const item of items) {
    const term = item.search_term || 'Unknown';
    if (!byTerm[term]) byTerm[term] = [];
    byTerm[term].push(item);
  }

  let msg = '*Top 5 Cheapest Deals by Category*\n\n';

  for (const [term, termItems] of Object.entries(byTerm)) {
    const top5 = termItems.slice(0, 5); // already sorted by price ASC
    msg += `*${term}*\n`;
    top5.forEach((item, i) => {
      msg += `${i + 1}. ${fmt(item.price)} — ${item.title}\n   ${item.url}\n`;
    });
    msg += '\n';
  }

  await sendTelegram(msg);
  console.log('Sent top-5 deals message.');
}

/**
 * Send prospect alerts — show partial bundle matches with what's found, what's missing,
 * and how close each bundle is to being viable.
 */
async function sendProspects(items) {
  let hasProspects = false;

  for (const bundle of BUNDLE_DEFINITIONS) {
    const found = [];
    const missing = [];

    for (const comp of bundle.components) {
      const item = findCheapestMatch(items, comp.keywords, comp.exclude);
      if (item) {
        found.push({ label: comp.label, item });
      } else {
        missing.push(comp.label);
      }
    }

    // Skip if fully complete (already covered by bundle report) or nothing found
    if (missing.length === 0 || found.length === 0) continue;

    hasProspects = true;
    const currentCost = found.reduce((sum, f) => sum + Number(f.item.price), 0);
    const remainingBudget = bundle.targetCost - currentCost;
    const pct = ((found.length / bundle.components.length) * 100).toFixed(0);

    let msg = `🎯 *PROSPECT: ${bundle.name}*\n`;
    msg += `📊 ${pct}% complete (${found.length}/${bundle.components.length} items)\n\n`;

    msg += `*Found:*\n`;
    for (const f of found) {
      msg += `  ✅ *${f.label}*\n`;
      msg += `     ${fmt(f.item.price)} — ${f.item.title}\n`;
      msg += `     ${f.item.url}\n`;
    }

    msg += `\n*Still Need:*\n`;
    for (const m of missing) {
      msg += `  ❌ ${m}\n`;
    }

    msg += `\n💰 Spent so far: ${fmt(currentCost)}`;
    msg += `\n💵 Budget remaining: ${fmt(Math.max(0, remainingBudget))}`;
    msg += `\n📈 Potential profit if completed: ${fmt(bundle.resaleValue - bundle.targetCost)}`;

    await sendTelegram(msg);
    console.log(`Sent prospect: ${bundle.name}`);
  }

  if (!hasProspects) {
    await sendTelegram('🎯 *No partial bundle prospects right now.* All bundles are either complete or have no matching items in the DB.');
  }
}

/**
 * Main reporting function — exported for use by sonic-bot.js
 */
async function main() {
  console.log('=== Sonic Bundle Report ===\n');

  // Refresh eBay data before reporting
  console.log('Refreshing eBay data...');
  try {
    const tracking = require('./ebay-sales-tracking');
    await tracking.main ? tracking.main() : null;
  } catch (err) {
    console.warn('eBay refresh skipped (non-fatal):', err.message);
  }

  const db = openDb();
  const items = getAllItems(db);
  db.close();

  if (items.length === 0) {
    await sendTelegram('No items found in the database yet. Run an eBay scan first.');
    return;
  }

  console.log(`Loaded ${items.length} items from DB.`);

  // Send bundle opportunity reports
  await sendBundleReports(items);

  // Send top deals by category
  await sendTop5ByCategory(items);

  console.log('\n=== Report complete ===');
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { main, sendBundleReports, sendTop5ByCategory, sendProspects, sendTelegram, openDb, getAllItems };
