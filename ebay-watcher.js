/**
 * eBay Watcher — Item watching, sell-through detection, bundle completion alerts
 * Uses Browse API (client_credentials) for item status checks
 */

'use strict';

const axios = require('axios');
const Database = require('better-sqlite3');

const DB_PATH = './data/sonic_tracker.db';

// ── Watched Items CRUD ───────────────────────────────────────────────────

function addWatchedItem(db, ebayItemId, title, price, reason) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO watched_items (ebay_item_id, title, price, watch_reason, added_at, status)
    VALUES (?, ?, ?, ?, datetime('now'), 'active')
  `);
  return stmt.run(ebayItemId, title, price, reason || 'manual');
}

function removeWatchedItem(db, idOrItemId) {
  // Try by row ID first, then by ebay_item_id
  let result = db.prepare("UPDATE watched_items SET status = 'removed' WHERE id = ?").run(idOrItemId);
  if (result.changes === 0) {
    result = db.prepare("UPDATE watched_items SET status = 'removed' WHERE ebay_item_id = ?").run(String(idOrItemId));
  }
  return result.changes > 0;
}

function getWatchedItems(db) {
  return db.prepare("SELECT * FROM watched_items WHERE status = 'active' ORDER BY added_at DESC").all();
}

// ── Item status check (Browse API) ───────────────────────────────────────

async function checkItemStatus(itemId, token) {
  try {
    const resp = await axios.get(`https://api.ebay.com/buy/browse/v1/item/${itemId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      },
      timeout: 10000
    });

    const data = resp.data;
    const currentPrice = data.price?.value ? parseFloat(data.price.value) : null;

    if (data.itemEndDate && new Date(data.itemEndDate) < new Date()) {
      return { status: 'ENDED', price: currentPrice };
    }

    return { status: 'ACTIVE', price: currentPrice };
  } catch (err) {
    if (err.response?.status === 404) {
      return { status: 'SOLD_OR_REMOVED' };
    }
    console.error(`Check item ${itemId} failed:`, err.response?.data?.errors?.[0]?.message || err.message);
    return { status: 'ERROR' };
  }
}

// ── Check all watched items ──────────────────────────────────────────────

async function checkWatchedItems(db, token) {
  const items = getWatchedItems(db);
  if (items.length === 0) return [];

  const alerts = [];

  for (const item of items) {
    const result = await checkItemStatus(item.ebay_item_id, token);

    if (result.status === 'SOLD_OR_REMOVED') {
      // Mark as sold in DB
      db.prepare("UPDATE watched_items SET status = 'sold' WHERE id = ?").run(item.id);
      alerts.push({
        type: 'sold',
        item,
        message: `🔔 *SOLD/REMOVED:* "${item.title}" — was $${item.price.toFixed(2)}\n` +
          (item.watch_reason ? `⚡ Watch reason: ${item.watch_reason}` : '')
      });
    } else if (result.status === 'ENDED') {
      db.prepare("UPDATE watched_items SET status = 'ended' WHERE id = ?").run(item.id);
      alerts.push({
        type: 'ended',
        item,
        message: `⏹️ *ENDED:* "${item.title}" — was $${item.price.toFixed(2)}`
      });
    } else if (result.status === 'ACTIVE' && result.price !== null) {
      const oldPrice = item.price;
      const pctChange = ((result.price - oldPrice) / oldPrice) * 100;

      if (Math.abs(pctChange) >= 20) {
        // Update stored price
        db.prepare("UPDATE watched_items SET price = ? WHERE id = ?").run(result.price, item.id);

        if (pctChange < 0) {
          alerts.push({
            type: 'price_drop',
            item,
            oldPrice,
            newPrice: result.price,
            pctChange,
            message: `📉 *PRICE DROP:* "${item.title}"\n$${oldPrice.toFixed(2)} → $${result.price.toFixed(2)} (${pctChange.toFixed(0)}%)`
          });
        } else {
          alerts.push({
            type: 'price_increase',
            item,
            oldPrice,
            newPrice: result.price,
            pctChange,
            message: `📈 *PRICE UP:* "${item.title}"\n$${oldPrice.toFixed(2)} → $${result.price.toFixed(2)} (+${pctChange.toFixed(0)}%)`
          });
        }
      }
    }

    // Rate limit between checks
    await new Promise(r => setTimeout(r, 300));
  }

  return alerts;
}

// ── Auto-watch bundle components ─────────────────────────────────────────

function autoWatchBundleComponents(db, bundleName, foundComponents) {
  let added = 0;
  for (const comp of foundComponents) {
    if (!comp.item?.ebay_item_id) continue;

    try {
      addWatchedItem(
        db,
        comp.item.ebay_item_id,
        comp.item.title,
        Number(comp.item.price),
        `Part of "${bundleName}" bundle`
      );
      added++;
    } catch (err) {
      // Already watching — ignore UNIQUE constraint
    }
  }
  return added;
}

// ── Bundle completion detection ──────────────────────────────────────────

async function detectBundleCompletion(db) {
  // Lazy-require to avoid circular dependency
  const { BUNDLE_DEFINITIONS, findCheapestMatch, getAllItems, openDb } = require('./sonic-bundle-report');

  const readDb = openDb();
  const items = getAllItems(readDb);
  readDb.close();

  const alerts = [];

  for (const bundle of BUNDLE_DEFINITIONS) {
    const found = [];
    let totalCost = 0;

    for (const comp of bundle.components) {
      const item = findCheapestMatch(items, comp.keywords, comp.exclude, comp.altKeywords);
      found.push({ label: comp.label, item });
      if (item) totalCost += Number(item.price);
    }

    const fullyViable = found.every(f => f.item !== null) && totalCost <= bundle.targetCost;

    if (fullyViable) {
      // Check if we already knew about this
      const existing = db.prepare("SELECT * FROM bundle_viability WHERE bundle_name = ?").get(bundle.name);

      if (!existing) {
        // Newly viable! Record and alert
        db.prepare("INSERT OR IGNORE INTO bundle_viability (bundle_name, first_viable_at) VALUES (?, datetime('now'))").run(bundle.name);

        const margin = ((bundle.resaleValue - totalCost) / totalCost * 100).toFixed(0);
        const newItem = found[found.length - 1]; // Last component is likely the newest

        alerts.push({
          type: 'bundle_viable',
          bundleName: bundle.name,
          totalCost,
          resaleValue: bundle.resaleValue,
          margin,
          message: `🎯 *BUNDLE NOW VIABLE: "${bundle.name}"*\n` +
            found.map(f => `  ${f.item ? '✅' : '❌'} ${f.label} — $${f.item ? Number(f.item.price).toFixed(2) : '?'}`).join('\n') +
            `\n\n💰 Total cost: $${totalCost.toFixed(2)} → $${bundle.resaleValue} resale (${margin}% margin)\n` +
            `Use /list ${bundle.name} to create eBay listing`
        });

        // Auto-watch components of newly viable bundles
        autoWatchBundleComponents(db, bundle.name, found);
      }
    } else {
      // If was viable but no longer, remove from table so we re-alert if it becomes viable again
      db.prepare("DELETE FROM bundle_viability WHERE bundle_name = ?").run(bundle.name);
    }
  }

  return alerts;
}

// ── Extract eBay item ID from URL or raw ID ──────────────────────────────

function extractEbayItemId(input) {
  input = input.trim();

  // Full eBay URL: extract item ID
  const urlMatch = input.match(/ebay\.com\/itm\/(?:.*\/)?(\d+)/);
  if (urlMatch) return urlMatch[1];

  // v1| format (Browse API item ID)
  if (input.startsWith('v1|')) return input;

  // Raw numeric ID
  if (/^\d+$/.test(input)) return input;

  return null;
}

module.exports = {
  addWatchedItem,
  removeWatchedItem,
  getWatchedItems,
  checkItemStatus,
  checkWatchedItems,
  autoWatchBundleComponents,
  detectBundleCompletion,
  extractEbayItemId
};
