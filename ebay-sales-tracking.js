/**
 * eBay Browse API v2 sales tracking for Sonic Flipper
 * Track Sonic listings to build market intelligence database
 * Uses eBay Browse API (no Playwright needed)
 */

'use strict';

const axios = require('axios');
const Database = require('better-sqlite3');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const EBAY_CONFIG = {
  appId: process.env.EBAY_APP_ID,
  certId: process.env.EBAY_CERT_ID,
  devId: process.env.EBAY_DEV_ID,
  env: 'production'
};

const DB_PATH = './data/sonic_tracker.db';

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: './logs/sales-tracking.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// ── Relevance filter ──────────────────────────────────────────────────────
// Reject false positives (DC Comics, Skylanders, restaurant toys, etc.)

const SONIC_REQUIRED = ['sonic', 'shadow', 'tails', 'knuckles', 'amy rose', 'silver hedgehog', 'eggman', 'robotnik', 'chao', 'cream rabbit', 'rouge bat', 'hedgehog'];
const SONIC_BRANDS = ['ge ', 'great eastern', 'first4figures', 'boom8', 'jakks', 'tomy sonic', 'sega'];
const FALSE_POSITIVE_TERMS = ['skylanders', 'sonic drive', 'drive-in', 'dc comics', 'sonar', 'hot wheels', 'matchbox', 'snackles', 'baskin robbins', 'justice league', 'spyro', 'wonder woman'];

function isSonicRelevant(title) {
  const t = title.toLowerCase();
  if (FALSE_POSITIVE_TERMS.some(fp => t.includes(fp))) return false;
  return SONIC_REQUIRED.some(kw => t.includes(kw)) || SONIC_BRANDS.some(b => t.includes(b));
}

// ── Search queries ─────────────────────────────────────────────────────────
// Expanded set: covers plushies, figures, lots, specific brands, and characters
const SEARCH_QUERIES = [
  // Core plush characters
  'GE Sonic plush',
  'GE Shadow plush',
  'GE Tails plush',
  'GE Knuckles plush',
  'GE Amy Rose plush',
  'GE Silver Hedgehog plush',

  // Figures
  'Boom8 Shadow figure',
  'Boom8 Sonic figure',
  'First4Figures Sonic',
  'Jakwares Sonic figure',
  'Sonic Adventure Hedgehog figure',

  // Lots and bundles (goldmine for cheap sourcing)
  'Sonic plush lot',
  'Sonic plush bundle',
  'Sonic the Hedgehog figure lot',
  'Sonic the Hedgehog collectible lot',
  'Sonic the Hedgehog toy bundle',

  // Brand-specific
  'Great Eastern Sonic',
  'GE Animation Sonic',
  'SEGA official plush Sonic',
  'Tomy Sonic plush',

  // Movie / modern
  'Sonic movie plush',
  'Sonic the Hedgehog 2 plush',
  'Sonic the Hedgehog 3 plush',
  'Shadow Hedgehog plush',

  // Broader catch-all
  'Sonic the Hedgehog plush',
  'Sonic the Hedgehog figure',
];

// ── Database setup ─────────────────────────────────────────────────────────
// Matches the EXISTING schema on the droplet — do NOT add new columns

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      price REAL NOT NULL,
      platform TEXT NOT NULL,
      url TEXT,
      image TEXT,
      condition TEXT,
      shipping TEXT,
      search_term TEXT,
      timestamp TEXT NOT NULL,
      profitable BOOLEAN DEFAULT 0,
      buy_price REAL,
      suggested_price REAL,
      gross_profit REAL,
      fees REAL,
      net_profit REAL,
      margin REAL,
      ebay_item_id TEXT,
      seller_username TEXT,
      seller_feedback INTEGER,
      UNIQUE(title, platform, price, timestamp)
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      queries_run INTEGER,
      items_found INTEGER,
      new_items INTEGER
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      purchase_price REAL,
      purchase_date TEXT,
      notes TEXT,
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_search ON items(search_term);
    CREATE INDEX IF NOT EXISTS idx_items_price ON items(price);
    CREATE INDEX IF NOT EXISTS idx_items_timestamp ON items(timestamp);

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watched_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ebay_item_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      price REAL NOT NULL,
      watch_reason TEXT,
      added_at TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS bundle_viability (
      bundle_name TEXT PRIMARY KEY,
      first_viable_at TEXT NOT NULL
    );
  `);

  // Migration: add new columns to existing DB if missing
  try {
    const cols = db.prepare("PRAGMA table_info(items)").all().map(c => c.name);
    if (!cols.includes('ebay_item_id')) {
      db.exec('ALTER TABLE items ADD COLUMN ebay_item_id TEXT');
    }
    if (!cols.includes('seller_username')) {
      db.exec('ALTER TABLE items ADD COLUMN seller_username TEXT');
    }
    if (!cols.includes('seller_feedback')) {
      db.exec('ALTER TABLE items ADD COLUMN seller_feedback INTEGER');
    }
  } catch (e) {
    // columns already exist — ignore
  }

  return db;
}

// ── OAuth ──────────────────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiry = 0;

async function getOAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('scope', 'https://api.ebay.com/oauth/api_scope');

    const response = await axios({
      method: 'POST',
      url: 'https://api.ebay.com/identity/v1/oauth2/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${EBAY_CONFIG.appId}:${EBAY_CONFIG.certId}`).toString('base64')}`
      },
      data: params.toString()
    });

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
    logger.info('OAuth token acquired');
    return cachedToken;
  } catch (error) {
    logger.error('OAuth failed:', error.response?.data || error.message);
    throw new Error('eBay OAuth failed: ' + (error.response?.data?.error_description || error.message));
  }
}

// ── Browse API search ──────────────────────────────────────────────────────

async function searchEbay(token, query, limit = 50) {
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://api.ebay.com/buy/browse/v1/item_summary/search',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json'
      },
      params: {
        q: query,
        limit: limit,
        sort: 'price',
        filter: 'price:[0..50],priceCurrency:USD,buyingOptions:{FIXED_PRICE|AUCTION}'
      }
    });

    const summaries = response.data?.itemSummaries || [];
    logger.info(`Search "${query}": ${summaries.length} results`);
    return summaries;
  } catch (error) {
    if (error.response?.status === 429) {
      logger.warn(`Rate limited on "${query}", waiting 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      return [];
    }
    logger.error(`Search failed for "${query}":`, error.response?.data || error.message);
    return [];
  }
}

// ── Process and store results ──────────────────────────────────────────────

function processResults(db, summaries, searchTerm) {
  const timestamp = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO items (title, price, platform, url, image, condition, shipping, search_term, timestamp, ebay_item_id, seller_username, seller_feedback)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let newCount = 0;
  let filteredCount = 0;

  for (const item of summaries) {
    const title = item.title || 'Unknown';
    const price = item.price?.value ? parseFloat(item.price.value) : 0;
    const condition = item.condition || item.conditionId || 'N/A';
    const url = item.itemWebUrl || item.itemHref || '';
    const image = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '';
    const shippingCost = item.shippingOptions?.[0]?.shippingCost?.value || 'Free';
    const platform = 'eBay';

    // Extract item ID and seller info from Browse API response
    const ebayItemId = item.itemId || item.legacyItemId || '';
    const sellerUsername = item.seller?.username || '';
    const sellerFeedback = item.seller?.feedbackScore || 0;

    if (price <= 0) continue;

    // Relevance filter — reject false positives
    if (!isSonicRelevant(title)) {
      filteredCount++;
      continue;
    }

    const result = insertStmt.run(title, price, platform, url, image, condition, shippingCost, searchTerm, timestamp, ebayItemId, sellerUsername, sellerFeedback);
    if (result.changes > 0) newCount++;
  }

  if (filteredCount > 0) {
    logger.info(`Filtered out ${filteredCount} irrelevant items for "${searchTerm}"`);
  }

  return newCount;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  logger.info('=== eBay Sales Tracking Scan ===');

  const db = ensureDb();
  let token;

  try {
    token = await getOAuthToken();
  } catch (err) {
    logger.error('Cannot get OAuth token, aborting scan');
    db.close();
    throw err;
  }

  let totalFound = 0;
  let totalNew = 0;

  for (const query of SEARCH_QUERIES) {
    const summaries = await searchEbay(token, query);
    const newItems = processResults(db, summaries, query);
    totalFound += summaries.length;
    totalNew += newItems;

    // Rate limit: 500ms between requests
    await new Promise(r => setTimeout(r, 500));
  }

  // Log the scan
  db.prepare('INSERT INTO scan_log (queries_run, items_found, new_items) VALUES (?, ?, ?)')
    .run(SEARCH_QUERIES.length, totalFound, totalNew);

  logger.info(`Scan complete: ${SEARCH_QUERIES.length} queries, ${totalFound} results, ${totalNew} new items`);

  // Check for newly viable bundles after scan (only if new items found)
  let bundleAlerts = [];
  if (totalNew > 0) {
    try {
      const watcher = require('./ebay-watcher');
      bundleAlerts = await watcher.detectBundleCompletion(db);
    } catch (err) {
      logger.warn('Bundle completion check skipped:', err.message);
    }
  }

  db.close();

  return { queriesRun: SEARCH_QUERIES.length, totalFound, totalNew, bundleAlerts };
}

// Run directly
if (require.main === module) {
  main().then(stats => {
    console.log('Scan stats:', stats);
  }).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { main, ensureDb, SEARCH_QUERIES, isSonicRelevant };
