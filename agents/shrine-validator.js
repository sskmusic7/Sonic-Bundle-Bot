/**
 * Shrine Component Validator Agent — HYBRID EVENT + SCHEDULED
 * Event-driven: Reacts to bid/buy signals from lister
 * Scheduled: Polls components every N minutes (configurable)
 */

'use strict';

const Database = require('better-sqlite3');
const axios = require('axios');
const { notify } = require('../sonic-ai');
const config = require('../config');

const name = 'shrine-validator';

// Parse command line arguments
const mode = process.argv[2] || 'scheduled'; // 'scheduled' | 'validate' | 'standalone'
const checkIntervalMinutes = parseInt(process.argv[3]) || 10; // Default: 10 minutes

// ── Validation Rules ───────────────────────────────────────

const RULES = {
  itemExpired: 'Item is no longer available',
  itemSold: 'Item has been sold',
  listingEnded: 'Listing has ended without sale',
  outOfStock: 'Seller marked as out of stock',
  priceTooHigh: 'Price increased above threshold',
  quantityZero: 'Available quantity dropped to zero'
};

// ── Database Queries ───────────────────────────────────────

function initDb(db) {
  // Create validation_events table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS validation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      bundle_id INTEGER,
      component_id INTEGER,
      status TEXT NOT NULL,
      check_result TEXT NOT NULL,
      checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      FOREIGN KEY (bundle_id) REFERENCES shrine_bundles(id)
    )
  `);

  // Create validator_signals table for inter-process communication
  db.exec(`
    CREATE TABLE IF NOT EXISTS validator_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT NOT NULL,
      bundle_id INTEGER,
      component_id INTEGER,
      message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed BOOLEAN DEFAULT 0
    )
  `);

  return db;
}

// ── Component Availability Check ───────────────────────────

async function checkComponentAvailability(component) {
  const { id, item_url, title, last_checked } = component;

  // Skip if checked within check interval (unless forced)
  const intervalMs = checkIntervalMinutes * 60 * 1000;
  if (last_checked && Date.now() - new Date(last_checked).getTime() < intervalMs) {
    return { status: 'skip', reason: `Checked within last ${checkIntervalMinutes} minutes` };
  }

  try {
    // Try to fetch eBay item page
    const response = await axios.get(item_url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ShrineValidator/2.0)'
      }
    });

    const html = response.data;

    // Check for availability indicators
    const unavailableIndicators = [
      'This listing was ended',
      'Item is no longer available',
      'This item has ended',
      'Item is unavailable',
      'Out of stock',
      'Sold'
    ];

    const isUnavailable = unavailableIndicators.some(indicator =>
      html.toLowerCase().includes(indicator.toLowerCase())
    );

    return {
      status: isUnavailable ? 'unavailable' : 'available',
      reason: isUnavailable ? 'Listing ended or sold' : 'Available',
      httpStatus: response.status
    };

  } catch (error) {
    if (error.response) {
      if (error.response.status === 404) {
        return { status: 'unavailable', reason: '404 Not Found' };
      }
      return { status: 'unknown', reason: `HTTP ${error.response.status}` };
    }
    return { status: 'error', reason: error.message };
  }
}

// ── Bundle Component Validation ──────────────────────────────

async function validateBundleComponents(db, bundleId, forceCheck = false) {
  // Get all components for this bundle
  const components = db.prepare(`
    SELECT sc.*, si.item_url, si.title, si.last_checked
    FROM shrine_components sc
    JOIN sourced_items si ON sc.sourced_item_id = si.id
    WHERE sc.bundle_id = ? AND sc.status = 'available'
  `).all(bundleId);

  if (components.length === 0) {
    await notify(`⚠️ VALIDATOR: Bundle #${bundleId} has no components to validate`);
    return { valid: false, components: [] };
  }

  const results = [];
  let unavailableCount = 0;

  for (const component of components) {
    const result = await checkComponentAvailability(component);

    // Update component status based on check
    const newStatus = result.status === 'available' ? 'available' : 'unavailable';

    db.prepare(`
      UPDATE shrine_components
      SET status = ?, last_checked = datetime('now')
      WHERE id = ?
    `).run(newStatus, component.id);

    // Log validation event
    db.prepare(`
      INSERT INTO validation_events (event_type, bundle_id, component_id, status, check_result, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run('component_check', bundleId, component.id, result.status, result.reason);

    results.push({
      componentId: component.id,
      itemTitle: component.title,
      status: result.status,
      reason: result.reason
    });

    if (result.status === 'unavailable') {
      unavailableCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const bundleValid = unavailableCount === 0;

  // Update bundle status based on validation
  const bundleStatus = bundleValid ? 'ready' : 'invalid';
  db.prepare(`
    UPDATE shrine_bundles
    SET status = ?
    WHERE id = ?
  `).run(bundleStatus, bundleId);

  await notify(`
*VALIDATOR: Bundle #${bundleId} Checked*
Bundle: ${db.prepare('SELECT bundle_name FROM shrine_bundles WHERE id = ?').get(bundleId)?.bundle_name}

Components checked: ${components.length}
Unavailable: ${unavailableCount}
Status: ${bundleStatus.toUpperCase()}
  `);

  return { valid: bundleValid, components: results, unavailableCount };
}

// ── Find Replacement Components ───────────────────────

async function findReplacements(db, unavailableComponent, character, category) {
  // Search sourced_items table for available replacements
  const replacements = db.prepare(`
    SELECT * FROM sourced_items
    WHERE character = ? AND category = ? AND validation_status = 'valid'
    AND id NOT IN (SELECT sourced_item_id FROM shrine_components WHERE status = 'available')
    AND id NOT IN (SELECT sourced_item_id FROM shrine_components WHERE status = 'unavailable')
    ORDER BY price ASC
    LIMIT 5
  `).all(character, category);

  if (replacements.length > 0) {
    await notify(`
*VALIDATOR: Found ${replacements.length} replacements for ${unavailableComponent.itemTitle}*

Character: ${character}
Category: ${category}

Top 5 replacements:
${replacements.map((r, i) => `  ${i+1}. $${r.price.toFixed(2)} - ${r.title}`).join('\n')}
    `);

    return replacements;
  }

  await notify(`⚠️ VALIDATOR: No available replacements found for ${unavailableComponent.itemTitle}`);
  return [];
}

// ── Send Signal to Lister Agent ──────────────────────────

async function sendToLister(db, signalType, bundleId, componentId, message) {
  // Insert signal for lister to process
  db.prepare(`
    INSERT INTO validator_signals (signal_type, bundle_id, component_id, message, processed)
    VALUES (?, ?, ?, ?, 0)
  `).run(signalType, bundleId, componentId, message);

  await notify(`
📡 VALIDATOR SIGNAL → LISTER
Signal: ${signalType}
Bundle: #${bundleId}${componentId ? ` | Component: #${componentId}` : ''}
Message: ${message}
  `);
}

// ── Pull Bundle from Lister ──────────────────────────────

async function pullBundleFromLister(db, bundleId, reason) {
  // Update bundle status to invalid
  db.prepare(`
    UPDATE shrine_bundles
    SET status = 'invalid', listed_at = NULL, ebay_listing_id = NULL, ebay_sku = NULL
    WHERE id = ?
  `).run(bundleId);

  await notify(`
🚨 VALIDATOR: Bundle #${bundleId} PULLED FROM LISTER

Reason: ${reason}

The lister agent will receive this signal and remove the listing from eBay.
  `);
}

// ── Process Incoming Signals (Event-Driven) ───────────────────────

async function processIncomingSignals(db) {
  const signals = db.prepare(`
    SELECT * FROM validator_signals
    WHERE processed = 0
    ORDER BY created_at ASC
  `).all();

  for (const signal of signals) {
    console.log(`📡 Processing signal: ${signal.signal_type} for bundle ${signal.bundle_id}`);

    switch (signal.signal_type) {
      case 'bid_started':
      case 'buyer_won':
        // Re-check bundle components when someone bids or wins
        await validateBundleComponents(db, signal.bundle_id, true);
        break;

      case 'component_unavailable':
        // Component marked unavailable by another check
        await validateBundleComponents(db, signal.bundle_id, true);
        break;

      case 'pull_bundle':
        // Bundle pulled from lister - mark as invalid
        db.prepare(`
          UPDATE shrine_bundles
          SET status = 'invalid', listed_at = NULL, ebay_listing_id = NULL, ebay_sku = NULL
          WHERE id = ?
        `).run(signal.bundle_id);
        await notify(`🚨 VALIDATOR: Bundle #${signal.bundle_id} marked invalid and pulled from lister`);
        break;

      default:
        console.log(`Unknown signal type: ${signal.signal_type}`);
    }

    // Mark signal as processed
    db.prepare('UPDATE validator_signals SET processed = 1 WHERE id = ?').run(signal.id);
  }

  if (signals.length > 0) {
    await notify(`📡 VALIDATOR: Processed ${signals.length} incoming signals`);
  }
}

// ── Main Validation Loop (Scheduled + Event-Driven) ───────────────

async function runValidation(db, options = {}) {
  const {
    checkNewBundles = true,
    checkActiveBundles = true,
    forceCheck = false
  } = options;

  // Check newly created bundles
  if (checkNewBundles) {
    const newBundles = db.prepare(`
      SELECT id FROM shrine_bundles
      WHERE status = 'ready' AND created_at >= datetime('now', '-2 hours')
    `).all();

    for (const bundle of newBundles) {
      await validateBundleComponents(db, bundle.id, forceCheck);
    }
  }

  // Check bundles that are active/listed/listing
  if (checkActiveBundles) {
    const activeBundles = db.prepare(`
      SELECT id FROM shrine_bundles
      WHERE status IN ('listing', 'active', 'assembling')
    `).all();

    for (const bundle of activeBundles) {
      const result = await validateBundleComponents(db, bundle.id, forceCheck);

      // If any component unavailable, send delist signal
      if (!result.valid && result.unavailableCount > 0) {
        await pullBundleFromLister(db, bundle.id, `${result.unavailableCount} components unavailable`);

        // Try to find replacements
        const components = db.prepare(`
          SELECT sc.*, si.character, si.category, si.item_url
          FROM shrine_components sc
          JOIN sourced_items si ON sc.sourced_item_id = si.id
          WHERE sc.bundle_id = ? AND sc.status = 'unavailable'
        `).all(bundle.id);

        for (const comp of components) {
          const replacements = await findReplacements(db, comp, comp.character, comp.category);
          if (replacements.length > 0) {
            await sendToLister(db, 'replace_component', bundle.id, comp.id,
              `Replacement available: ${replacements[0].title} ($${replacements[0].price.toFixed(2)})`
            );
          }
        }
      }
    }
  }

  // Process incoming signals from lister (bid/buy events)
  const signals = db.prepare(`
    SELECT * FROM validator_signals
    WHERE processed = 0
    ORDER BY created_at ASC
  `).all();

  for (const signal of signals) {
    switch (signal.signal_type) {
      case 'bid_started':
        // Re-check bundle components when someone bids
        await validateBundleComponents(db, signal.bundle_id, true);
        break;

      case 'buyer_won':
        // Final check when buyer wins
        await validateBundleComponents(db, signal.bundle_id, true);
        break;

      case 'component_unavailable':
        // Already processed via re-check
        break;

      default:
        console.log(`Unknown signal type: ${signal.signal_type}`);
    }

    // Mark signal as processed
    db.prepare('UPDATE validator_signals SET processed = 1 WHERE id = ?').run(signal.id);
  }

  await notify(`🔄 VALIDATOR: Checked ${signals.length} new signals, processed validation for active bundles`);
}

// ── Scheduled Mode: Polling + Event Reactivity ───────────────

async function scheduledMode() {
  console.log(`🔄 VALIDATOR: Running scheduled mode (${checkIntervalMinutes}-minute checks)`);

  const db = new Database(config.database.path);

  try {
    // Initialize database schema
    initDb(db);

    // Run continuous validation loop
    console.log(`✅ VALIDATOR: Monitoring shrine bundles every ${checkIntervalMinutes} minutes, listening for signals...`);

    while (true) {
      const cycleStart = Date.now();

      // Process any incoming signals first (event-driven)
      await processIncomingSignals(db);

      // Then run scheduled validation (periodic polling)
      await runValidation(db, {
        checkNewBundles: true,
        checkActiveBundles: true,
        forceCheck: false
      });

      const cycleEnd = Date.now();
      const cycleTime = (cycleEnd - cycleStart) / 1000;
      const waitTime = Math.max(0, (checkIntervalMinutes * 60 * 1000) - cycleTime);

      if (waitTime > 0) {
        console.log(`⏳ VALIDATOR: Cycle complete (${cycleTime}ms), waiting ${Math.round(waitTime/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

  } catch (error) {
    console.error('❌ VALIDATOR Error:', error);
    await notify(`❌ VALIDATOR Error: ${error.message}`);
  } finally {
    db.close();
  }
}

// ── Standalone Mode (if run directly) ─────────────────────

async function standaloneMode() {
  console.log('🔄 VALIDATOR: Running standalone mode (one-time check)');

  const db = new Database(config.database.path);

  try {
    // Initialize database schema
    initDb(db);

    // Run validation with options
    await runValidation(db, {
      checkNewBundles: true,
      checkActiveBundles: true,
      forceCheck: true
    });

  } catch (error) {
    console.error('❌ VALIDATOR Error:', error);
    await notify(`❌ VALIDATOR Error: ${error.message}`);
  } finally {
    db.close();
  }
}

// ── Validate Specific Bundle (manual mode) ─────────────────────

async function validateMode() {
  const bundleId = parseInt(process.argv[3]);
  if (!bundleId) {
    console.error('Usage: node shrine-validator.js validate <bundle_id>');
    process.exit(1);
  }

  const db = new Database(config.database.path);
  initDb(db);

  validateBundleComponents(db, bundleId, true)
    .then(result => {
      console.log(`✅ Bundle #${bundleId} validation: ${result.valid ? 'VALID' : 'INVALID'}`);
      console.log(`Components checked: ${result.components.length}`);
      console.log(`Unavailable: ${result.unavailableCount}`);
      db.close();
    })
    .catch(error => {
      console.error('Validation error:', error);
      db.close();
      process.exit(1);
    });
}

// ── Main Entry Point ─────────────────────────────────────────────

if (require.main === module) {
  const mode = process.argv[2] || 'scheduled';

  if (mode === 'scheduled') {
    scheduledMode();
  } else if (mode === 'validate') {
    validateMode();
  } else if (mode === 'standalone') {
    standaloneMode();
  } else {
    console.error('Usage: node shrine-validator.js [scheduled|validate|standalone] [interval_minutes]');
    console.log('');
    console.log('Modes:');
    console.log('  scheduled  - Run continuously: polls components every N minutes AND reacts to signals from lister');
    console.log('  validate   - One-time validation of specific bundle');
    console.log('  standalone  - One-time check of all bundles');
    console.log('');
    console.log('Examples:');
    console.log('  node shrine-validator.js scheduled      # Poll every 10 mins + react to signals');
    console.log('  node shrine-validator.js scheduled 5    # Poll every 5 mins + react to signals');
    console.log('  node shrine-validator.js validate 123    # Check bundle #123 once');
    console.log('  node shrine-validator.js standalone          # One-time check of all bundles');
    process.exit(1);
  }
}

module.exports = {
  validateBundleComponents,
  checkComponentAvailability,
  findReplacements,
  sendToLister,
  pullBundleFromLister,
  runValidation
};
