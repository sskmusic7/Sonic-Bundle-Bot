/**
 * Bundler Agent — Assembles validated items into shrine bundles
 * Groups by character, picks cheapest per category, calculates pricing
 */

'use strict';

const config = require('../config');

const name = 'bundler';
const interval = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Calculate list price with margin formula:
 * Price = (ItemsCost + ShippingCost) * Multiplier / (1 - eBayFee)
 */
function calculateListPrice(totalCost, character) {
  const shrine = config.shrine || {};
  const ebayFee = shrine.ebayFeePct || 0.13;

  // Check for hot target multiplier
  let multiplier = shrine.defaultMultiplier || 1.4;
  const hotTargets = shrine.hotTargets || {};
  for (const [key, target] of Object.entries(hotTargets)) {
    if (character && character.toLowerCase().includes(key)) {
      multiplier = Math.max(multiplier, target.multiplier);
    }
  }

  return (totalCost * multiplier) / (1 - ebayFee);
}

/**
 * Generate a bundle name
 */
function generateBundleName(character, components) {
  const charName = character.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const itemTypes = components.map(c => c.category).join(' + ');
  return `The ${charName} Ultimate Fan Set (${itemTypes})`;
}

async function run(db, { notify }) {
  const shrine = config.shrine || {};
  const minComponents = shrine.minComponentsForBundle || 2;
  const minListPrice = shrine.minListPrice || 40;
  const minMargin = shrine.minMarginPct || 0.25;

  // Get all valid items NOT already in a bundle
  const validItems = db.prepare(`
    SELECT si.* FROM sourced_items si
    WHERE si.validation_status = 'valid'
    AND si.id NOT IN (SELECT sourced_item_id FROM shrine_components WHERE sourced_item_id IS NOT NULL)
    ORDER BY si.price ASC
  `).all();

  if (validItems.length === 0) return { processed: 0 };

  // Group by character
  const byCharacter = {};
  for (const item of validItems) {
    const ch = (item.character || 'unknown').toLowerCase();
    if (ch === 'unknown') continue;
    if (!byCharacter[ch]) byCharacter[ch] = {};
    const cat = item.category || 'accessory';
    if (!byCharacter[ch][cat]) byCharacter[ch][cat] = [];
    byCharacter[ch][cat].push(item);
  }

  let bundlesCreated = 0;

  const insertBundle = db.prepare(`
    INSERT INTO shrine_bundles (bundle_name, target_character, total_cost, list_price, margin_pct, status)
    VALUES (?, ?, ?, ?, ?, 'ready')
  `);

  const insertComponent = db.prepare(`
    INSERT INTO shrine_components (bundle_id, sourced_item_id, role, locked_price)
    VALUES (?, ?, ?, ?)
  `);

  for (const [character, categories] of Object.entries(byCharacter)) {
    const catNames = Object.keys(categories);
    if (catNames.length < minComponents) continue;

    // Check we haven't already got an active/ready bundle for this character
    const existing = db.prepare(`
      SELECT id FROM shrine_bundles
      WHERE target_character = ? AND status IN ('assembling', 'ready', 'active', 'listing')
    `).get(character);
    if (existing) continue;

    // Pick cheapest item per category
    const components = [];
    let totalCost = 0;

    for (const cat of catNames) {
      const cheapest = categories[cat][0]; // Already sorted by price ASC
      if (!cheapest) continue;
      const itemCost = cheapest.price + (cheapest.shipping || 0);
      components.push({ item: cheapest, category: cat, cost: itemCost });
      totalCost += itemCost;
    }

    if (components.length < minComponents) continue;

    // Calculate pricing
    const listPrice = calculateListPrice(totalCost, character);
    if (listPrice < minListPrice) continue;

    const margin = (listPrice - totalCost) / listPrice;
    if (margin < minMargin) continue;

    const bundleName = generateBundleName(character, components);

    // Create bundle
    const result = insertBundle.run(bundleName, character, totalCost, Math.round(listPrice * 100) / 100, Math.round(margin * 100));

    const bundleId = result.lastInsertRowid;

    // Link components
    for (const comp of components) {
      insertComponent.run(bundleId, comp.item.id, comp.category, comp.cost);
    }

    bundlesCreated++;

    const componentList = components.map(c =>
      `  ${c.category}: "${c.item.title}" — $${c.cost.toFixed(2)}`
    ).join('\n');

    await notify(
      `*BUNDLER: New shrine assembled!*\n` +
      `*${bundleName}*\n` +
      `${componentList}\n\n` +
      `Cost: $${totalCost.toFixed(2)} | List: $${listPrice.toFixed(2)} | Margin: ${Math.round(margin * 100)}%`
    );
  }

  return { processed: bundlesCreated };
}

module.exports = { name, interval, run };
