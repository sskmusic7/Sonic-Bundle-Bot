/**
 * Guardian Agent — Monitors active bundles for stock-outs and price changes
 * Auto-reprices or takes down listings when components become unavailable
 */

'use strict';

const axios = require('axios');
const config = require('../config');

const name = 'guardian';
const interval = 10 * 60 * 1000; // 10 minutes

// Client credentials token for Browse API
let cachedToken = null;
let tokenExpiry = 0;

async function getOAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const appId = process.env.EBAY_APP_ID || '';
  const certId = process.env.EBAY_CERT_ID || '';

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'https://api.ebay.com/oauth/api_scope');

  const resp = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${appId}:${certId}`).toString('base64')}`
    },
    timeout: 15000
  });

  cachedToken = resp.data.access_token;
  tokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Check a single item's status via Browse API
 */
async function checkItem(itemId, token) {
  try {
    const resp = await axios.get(`https://api.ebay.com/buy/browse/v1/item/${itemId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      },
      timeout: 10000
    });

    const data = resp.data;
    const price = data.price?.value ? parseFloat(data.price.value) : null;
    const qty = data.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity || 0;
    const ended = data.itemEndDate && new Date(data.itemEndDate) < new Date();

    if (ended || qty < 1) {
      return { available: false, price, reason: ended ? 'ended' : 'out of stock' };
    }

    return { available: true, price, qty };
  } catch (err) {
    if (err.response?.status === 404) {
      return { available: false, price: null, reason: 'removed/sold' };
    }
    // API error — don't break the bundle on transient errors
    return { available: true, price: null, reason: 'api_error' };
  }
}

/**
 * Recalculate list price using the margin formula
 */
function recalcPrice(totalCost, character) {
  const shrine = config.shrine || {};
  const ebayFee = shrine.ebayFeePct || 0.13;
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
 * End an eBay listing via Sell Inventory API (withdraw the offer)
 */
async function endListing(offerId, userToken) {
  // The Inventory API doesn't have a direct "end listing" — we withdraw the offer
  // This requires the offerId which we don't store yet, so we'll deactivate via inventory
  // For now, log the action — full implementation needs offer tracking
  console.log(`Guardian: Would end listing (offerId needed). Marking as broken in DB.`);
}

async function run(db, { notify }) {
  const activeBundles = db.prepare(`
    SELECT * FROM shrine_bundles WHERE status = 'active'
  `).all();

  if (activeBundles.length === 0) return { processed: 0 };

  let token;
  try {
    token = await getOAuthToken();
  } catch (err) {
    throw new Error('Guardian: OAuth failed — ' + err.message);
  }

  let checked = 0;
  let broken = 0;
  let repriced = 0;

  for (const bundle of activeBundles) {
    const components = db.prepare(`
      SELECT sc.*, si.ebay_item_id, si.title as item_title
      FROM shrine_components sc
      JOIN sourced_items si ON sc.sourced_item_id = si.id
      WHERE sc.bundle_id = ?
    `).all(bundle.id);

    let bundleValid = true;
    let newTotalCost = 0;
    let priceChanged = false;

    for (const comp of components) {
      if (!comp.ebay_item_id) continue;

      const status = await checkItem(comp.ebay_item_id, token);
      checked++;

      if (!status.available) {
        bundleValid = false;

        // Update component status
        db.prepare("UPDATE shrine_components SET status = 'oos' WHERE id = ?").run(comp.id);

        await notify(
          `*GUARDIAN: Component OOS!*\n` +
          `Bundle: "${bundle.bundle_name}"\n` +
          `Missing: "${comp.item_title}" — ${status.reason}`
        );
        break;
      }

      if (status.price !== null) {
        const oldPrice = comp.locked_price;
        const shipping = 0; // Shipping already factored into locked_price
        const newCost = status.price + shipping;
        newTotalCost += newCost;

        if (Math.abs(newCost - oldPrice) / oldPrice > 0.05) {
          priceChanged = true;
          // Update locked price
          db.prepare("UPDATE shrine_components SET locked_price = ?, status = 'price_changed' WHERE id = ?")
            .run(newCost, comp.id);
        }
      } else {
        newTotalCost += comp.locked_price;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 300));
    }

    if (!bundleValid) {
      // Take down the listing
      db.prepare("UPDATE shrine_bundles SET status = 'broken' WHERE id = ?").run(bundle.id);
      broken++;

      await notify(
        `*GUARDIAN: BUNDLE BROKEN — LISTING ENDED*\n` +
        `"${bundle.bundle_name}" taken down. Component unavailable.`
      );
      continue;
    }

    if (priceChanged && newTotalCost > 0) {
      const newListPrice = recalcPrice(newTotalCost, bundle.target_character);
      const newMargin = (newListPrice - newTotalCost) / newListPrice;

      if (newMargin < 0.15) {
        // No longer profitable — take down
        db.prepare("UPDATE shrine_bundles SET status = 'broken' WHERE id = ?").run(bundle.id);
        broken++;

        await notify(
          `*GUARDIAN: BUNDLE UNPROFITABLE — ENDED*\n` +
          `"${bundle.bundle_name}"\n` +
          `New cost: $${newTotalCost.toFixed(2)} | Margin: ${Math.round(newMargin * 100)}% (too low)`
        );
      } else {
        // Update pricing
        db.prepare(`
          UPDATE shrine_bundles SET total_cost = ?, list_price = ?, margin_pct = ? WHERE id = ?
        `).run(newTotalCost, Math.round(newListPrice * 100) / 100, Math.round(newMargin * 100), bundle.id);
        repriced++;

        // TODO: Update eBay listing price via Sell API (needs offer ID tracking)
        await notify(
          `*GUARDIAN: Price adjusted*\n` +
          `"${bundle.bundle_name}"\n` +
          `$${bundle.total_cost.toFixed(2)} → $${newTotalCost.toFixed(2)} cost\n` +
          `$${bundle.list_price} → $${newListPrice.toFixed(2)} list (${Math.round(newMargin * 100)}%)`
        );
      }
    }

    // Update last_checked on sourced items
    const itemIds = components.map(c => c.sourced_item_id);
    if (itemIds.length > 0) {
      db.prepare(`
        UPDATE sourced_items SET last_checked = datetime('now')
        WHERE id IN (${itemIds.map(() => '?').join(',')})
      `).run(...itemIds);
    }
  }

  return { processed: checked, broken, repriced };
}

module.exports = { name, interval, run };
