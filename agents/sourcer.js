/**
 * Sourcer Agent — Finds individual items per character across categories
 * Searches eBay Browse API for shrine-worthy components
 */

'use strict';

const axios = require('axios');
const config = require('../config');
const { isSonicRelevant } = require('../ebay-sales-tracking');

const name = 'sourcer';
const interval = 4 * 60 * 60 * 1000; // 4 hours

// Client credentials token (Browse API — read only)
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

async function searchEbay(token, query) {
  try {
    const resp = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      },
      params: {
        q: query,
        limit: 30,
        sort: 'price',
        filter: `price:[0..${config.shrine?.maxComponentPrice || 50}],priceCurrency:USD,buyingOptions:{FIXED_PRICE}`
      },
      timeout: 15000
    });
    return resp.data?.itemSummaries || [];
  } catch (err) {
    if (err.response?.status === 429) {
      await new Promise(r => setTimeout(r, 5000));
    }
    console.error(`Sourcer search failed for "${query}":`, err.response?.data?.errors?.[0]?.message || err.message);
    return [];
  }
}

/**
 * Guess character and category from title
 */
function classifyItem(title) {
  const t = title.toLowerCase();
  const shrine = config.shrine || {};
  const characters = shrine.characters || [];

  let character = null;
  for (const ch of characters) {
    if (t.includes(ch)) {
      character = ch;
      break;
    }
  }
  // Fallbacks for partial matches
  if (!character) {
    if (t.includes('shadow') && t.includes('hedgehog')) character = 'shadow';
    else if (t.includes('sonic')) character = 'sonic';
    else if (t.includes('tails') || t.includes('miles prower')) character = 'tails';
    else if (t.includes('knuckles')) character = 'knuckles';
    else if (t.includes('amy')) character = 'amy rose';
    else if (t.includes('silver') && t.includes('hedgehog')) character = 'silver';
    else if (t.includes('cream') && t.includes('rabbit')) character = 'cream';
    else if (t.includes('rouge') && t.includes('bat')) character = 'rouge';
    else if (t.includes('eggman') || t.includes('robotnik')) character = 'eggman';
    else if (t.includes('metal sonic')) character = 'metal sonic';
    else if (t.includes('blaze')) character = 'blaze';
    else if (t.includes('big the cat') || t.includes('big cat')) character = 'big the cat';
  }

  let category = 'accessory';
  if (t.includes('plush') || t.includes('stuffed') || t.includes('plushie')) category = 'plush';
  else if (t.includes('figure') || t.includes('figurine') || t.includes('statue') || t.includes('boom8') || t.includes('first4figures')) category = 'figure';
  else if (t.includes('keychain') || t.includes('pin') || t.includes('badge') || t.includes('hat') || t.includes('backpack') || t.includes('mug')) category = 'accessory';

  return { character, category };
}

async function run(db, { notify }) {
  const shrine = config.shrine || {};
  const characters = shrine.characters || ['sonic', 'shadow', 'tails', 'knuckles', 'amy rose', 'silver'];
  const categories = shrine.categories || ['plush', 'action figure', 'keychain pin accessory'];

  let token;
  try {
    token = await getOAuthToken();
  } catch (err) {
    throw new Error('Sourcer: OAuth failed — ' + err.message);
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO sourced_items
    (ebay_item_id, title, character, category, price, shipping, image_url,
     seller_username, seller_feedback, available_qty, condition, item_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalNew = 0;
  let queriesRun = 0;

  for (const character of characters) {
    for (const category of categories) {
      // Build search query
      const query = `Sonic ${character} ${category} -lot -custom -bootleg`;
      const results = await searchEbay(token, query);
      queriesRun++;

      for (const item of results) {
        const title = item.title || '';
        const price = item.price?.value ? parseFloat(item.price.value) : 0;
        if (price <= 0 || price > (shrine.maxComponentPrice || 50)) continue;
        if (!isSonicRelevant(title)) continue;

        const ebayItemId = item.itemId || '';
        if (!ebayItemId) continue;

        const shipping = item.shippingOptions?.[0]?.shippingCost?.value
          ? parseFloat(item.shippingOptions[0].shippingCost.value)
          : 0;
        const image = item.image?.imageUrl || '';
        const seller = item.seller?.username || '';
        const feedback = item.seller?.feedbackScore || 0;
        const qty = item.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity || 1;
        const condition = item.condition || '';
        const url = item.itemWebUrl || '';

        // Prefer high-feedback sellers
        if (feedback < (shrine.minSellerScore || 95) && feedback > 0) continue;

        const { character: guessedChar, category: guessedCat } = classifyItem(title);

        const result = insertStmt.run(
          ebayItemId, title, guessedChar || character, guessedCat || category,
          price, shipping, image, seller, feedback, qty, condition, url
        );

        if (result.changes > 0) totalNew++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 600));
    }
  }

  if (totalNew > 0) {
    await notify(`*SOURCER:* Found ${totalNew} new items across ${queriesRun} searches`);
  }

  return { processed: totalNew, queries: queriesRun };
}

module.exports = { name, interval, run };
