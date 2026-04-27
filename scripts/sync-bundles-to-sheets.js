#!/usr/bin/env node

/**
 * Sonic Bot Bundles → Google Sheets Sync
 *
 * Reads shrine bundles from SQLite DB and syncs to Google Sheets
 * Uses Molteesha's service account for authentication
 *
 * Usage: node scripts/sync-bundles-to-sheets.js
 * Cron (droplet): 0 STAR/6 STAR STAR STAR docker exec openclaw-gateway bash -c "cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot && node scripts/sync-bundles-to-sheets.js"
 * (Replace STAR with * in crontab)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { google } = require('googleapis');

// Load environment variables from .env file
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const CONFIG = {
  // Service account key path
  // On droplet (container): /home/node/.openclaw/workspace/molteesha-sa-key.json
  // On Shadow PC: set GOOGLE_SA_KEY_PATH env var
  SA_KEY_PATH: process.env.GOOGLE_SA_KEY_PATH ||
    (fs.existsSync('/home/node/.openclaw/workspace/molteesha-sa-key.json')
      ? '/home/node/.openclaw/workspace/molteesha-sa-key.json'
      : path.join(__dirname, '../molteesha-sa-key.json')),

  // Google Sheet ID (from URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit)
  SHEET_ID: process.env.SONIC_BUNDLES_SHEET_ID || '',

  // Sheet name/tab
  SHEET_NAME: 'Sonic Bundles',

  // SQLite DB path
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/sonic_tracker.db'),
};

/**
 * Load bundles from SQLite database
 */
function loadBundles() {
  console.log(`📂 Loading bundles from ${CONFIG.DB_PATH}...`);

  if (!fs.existsSync(CONFIG.DB_PATH)) {
    throw new Error(`Database not found: ${CONFIG.DB_PATH}`);
  }

  const db = new Database(CONFIG.DB_PATH, { readonly: true });

  try {
    // Get all shrine bundles
    const bundles = db.prepare(`
      SELECT
        id,
        bundle_name,
        target_character,
        total_cost,
        list_price,
        margin_pct,
        status,
        created_at,
        hero_image_path,
        ebay_listing_id,
        ebay_sku
      FROM shrine_bundles
      ORDER BY created_at DESC
    `).all();

    console.log(`   Found ${bundles.length} bundles`);

    // Get components for each bundle
    bundles.forEach(bundle => {
      const components = db.prepare(`
        SELECT
          sc.sourced_item_id,
          sc.status,
          si.title,
          si.price
        FROM shrine_components sc
        LEFT JOIN sourced_items si ON si.id = sc.sourced_item_id
        WHERE sc.bundle_id = ?
      `).all(bundle.id);

      bundle.components = components;
      bundle.component_count = components.length;
      bundle.validated_count = components.filter(c => c.status === 'available').length;
    });

    console.log(`   ✅ Loaded ${bundles.length} bundles with components`);
    return bundles;

  } finally {
    db.close();
  }
}

/**
 * Get pipeline status for each agent
 */
function getPipelineStatus(bundle) {
  const status = {
    sourcer: '❌',
    validator: '❌',
    bundler: '❌',
    creative: '❌',
    lister: '❌',
    guardian: '❌',
  };

  // Sourcer: always ✅ if bundle exists (components were sourced)
  if (bundle.component_count > 0) {
    status.sourcer = '✅';
  }

  // Validator: check if components have validation_status='valid'
  if (bundle.validated_count > 0) {
    status.validator = `✅ (${bundle.validated_count}/${bundle.component_count})`;
  }

  // Bundler: always ✅ if bundle exists
  status.bundler = '✅';

  // Creative: check if hero_image_path is not null
  if (bundle.hero_image_path) {
    status.creative = '✅';
  }

  // Lister: check if ebay_listing_id is not null
  if (bundle.ebay_listing_id) {
    status.lister = `✅ (${bundle.ebay_listing_id})`;
  }

  // Guardian: check if bundle has been checked (if lister completed)
  if (bundle.ebay_listing_id) {
    status.guardian = '✅';
  }

  return status;
}

/**
 * Convert bundles to sheet rows
 */
function bundlesToRows(bundles) {
  const header = [
    'Bundle ID',
    'Name',
    'Character',
    'Hero Image',
    'Total Cost',
    'List Price',
    'Margin%',
    'Status',
    'Created',
    'Components',
    'Sourcer',
    'Validator',
    'Bundler',
    'Creative',
    'Lister',
    'Guardian',
  ];

  const rows = bundles.map(b => {
    const pipeline = getPipelineStatus(b);

    // Format bundle name
    const name = `${b.target_character} Shrine Bundle`;

    // Format costs
    const totalCost = `£${parseFloat(b.total_cost || 0).toFixed(2)}`;
    const listPrice = `£${parseFloat(b.list_price || 0).toFixed(2)}`;
    const margin = `${parseFloat(b.margin_pct || 0).toFixed(1)}%`;

    // Format created date
    const created = b.created_at ? new Date(b.created_at).toISOString().split('T')[0] : '';

    // Components summary
    const components = b.components.map(c => c.title).join(', ');

    // GitHub raw URL for hero image (clickable in Sheets)
    const imageUrl = `https://raw.githubusercontent.com/sskmusic7/Sonic-Bundle-Bot/main/data/shrine-images/shrine-${b.id}.png`;
    const imageLink = `=HYPERLINK("${imageUrl}", "View Image")`;

    return [
      b.id,
      name,
      b.target_character,
      imageLink,
      totalCost,
      listPrice,
      margin,
      b.status || 'ready',
      created,
      components,
      pipeline.sourcer,
      pipeline.validator,
      pipeline.bundler,
      pipeline.creative,
      pipeline.lister,
      pipeline.guardian,
    ];
  });

  return [header, ...rows];
}

/**
 * Authenticate with Google Sheets API
 */
async function getAuthClient() {
  console.log(`🔑 Authenticating with service account...`);

  if (!fs.existsSync(CONFIG.SA_KEY_PATH)) {
    throw new Error(`Service account key not found: ${CONFIG.SA_KEY_PATH}\n\nEnsure the key exists at this path on the droplet.`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: CONFIG.SA_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  console.log(`   ✅ Authenticated`);
  return auth.getClient();
}

/**
 * Write data to Google Sheets
 */
async function writeToSheet(authClient, rows) {
  if (!CONFIG.SHEET_ID) {
    throw new Error('SHEET_ID not configured. Set SONIC_BUNDLES_SHEET_ID env var.');
  }

  console.log(`📊 Writing ${rows.length - 1} bundles to Google Sheets...`);
  console.log(`   Sheet ID: ${CONFIG.SHEET_ID}`);
  console.log(`   Sheet Name: ${CONFIG.SHEET_NAME}`);

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  try {
    // Check if sheet tab exists, create if not
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: CONFIG.SHEET_ID,
    });

    const sheetExists = spreadsheet.data.sheets.some(
      s => s.properties.title === CONFIG.SHEET_NAME
    );

    if (!sheetExists) {
      console.log(`   📄 Creating sheet tab "${CONFIG.SHEET_NAME}"...`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: CONFIG.SHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: { title: CONFIG.SHEET_NAME }
            }
          }]
        }
      });
      console.log(`   ✅ Created sheet tab`);
    }

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId: CONFIG.SHEET_ID,
      range: `${CONFIG.SHEET_NAME}!A:Z`,
    });

    console.log(`   🧹 Cleared existing data`);

    // Write new data
    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.SHEET_ID,
      range: `${CONFIG.SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      resource: { values: rows },
    });

    console.log(`   ✅ Wrote ${rows.length} rows (including header)`);

    // Format header row (bold + background)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.SHEET_ID,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0, // Assumes first sheet
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: { red: 0.2, green: 0.3, blue: 0.5 },
                  textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
        ],
      },
    });

    console.log(`   🎨 Formatted header row`);

  } catch (err) {
    if (err.message.includes('Unable to parse range')) {
      throw new Error(`Sheet tab "${CONFIG.SHEET_NAME}" not found. Create it first or update CONFIG.SHEET_NAME.`);
    }
    throw err;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Sonic Bot Bundles → Google Sheets Sync');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  try {
    // 1. Load bundles
    const bundles = loadBundles();

    if (bundles.length === 0) {
      console.log('⚠️  No bundles found. Nothing to sync.');
      return;
    }

    // 2. Convert to rows
    const rows = bundlesToRows(bundles);

    // 3. Authenticate
    const authClient = await getAuthClient();

    // 4. Write to sheet
    await writeToSheet(authClient, rows);

    console.log('');
    console.log('✅ Sync complete!');
    console.log(`   Bundles synced: ${bundles.length}`);
    console.log(`   View sheet: https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`);
    console.log('');

  } catch (err) {
    console.error('');
    console.error('❌ Error:', err.message);
    console.error('');
    if (err.stack && process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { loadBundles, bundlesToRows, getAuthClient, writeToSheet };
