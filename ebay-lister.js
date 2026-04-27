/**
 * eBay Lister — Create eBay listings via Inventory API
 * Requires 3-legged OAuth (user token from ebay-auth.js)
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { generateListingCopy, generateBundleArt } = require('./sonic-ai');

const EBAY_API = 'https://api.ebay.com';

// ── Retry helper for API calls ───────────────────────────────────────────

async function retryAxios(fn, maxRetries = 3, baseDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      const isRetryable = status >= 500 || status === 429;
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed (${status}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── Create/update inventory item ─────────────────────────────────────────

async function createInventoryItem(sku, listingCopy, imageUrls, token) {
  const url = `${EBAY_API}/sell/inventory/v1/inventory_item/${sku}`;

  const payload = {
    product: {
      title: listingCopy.title,
      description: listingCopy.description,
      imageUrls: imageUrls || []
    },
    condition: 'USED_EXCELLENT',
    conditionDescription: 'Bundle of pre-owned collectibles in excellent condition. See photos and description for details.',
    availability: {
      shipToLocationAvailability: {
        quantity: 1
      }
    }
  };

  const resp = await axios.put(url, payload, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US'
    },
    timeout: 15000
  });

  return resp.status === 204 || resp.status === 200;
}

// ── Create offer ─────────────────────────────────────────────────────────

async function createOffer(sku, price, token) {
  const config = require('./config');
  const policies = config.ebayPolicies;

  // Validate policies configured
  if (!policies.fulfillmentPolicyId || !policies.paymentPolicyId || !policies.returnPolicyId) {
    throw new Error('eBay business policies not configured in .env');
  }
  if (!policies.merchantLocationKey) {
    throw new Error('Merchant location not configured in .env');
  }

  const payload = {
    sku,
    marketplaceId: 'EBAY_US',
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    pricingSummary: {
      price: {
        value: price.toFixed(2),
        currency: 'USD'
      }
    },
    categoryId: policies.categoryId,
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId
    },
    merchantLocationKey: policies.merchantLocationKey
  };

  try {
    const resp = await retryAxios(() => axios.post(`${EBAY_API}/sell/inventory/v1/offer`, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }));
    return resp.data.offerId;
  } catch (err) {
    // Handle 409 Conflict (SKU already exists)
    if (err.response?.status === 409) {
      console.log(`SKU ${sku} exists, retrieving offer...`);
      const getResp = await axios.get(`${EBAY_API}/sell/inventory/v1/offer?sku=${sku}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      });
      if (getResp.data.offers?.[0]) {
        return getResp.data.offers[0].offerId;
      }

      // Retry with new SKU
      const newSku = sku + '-' + Date.now().toString(36).slice(-4);
      console.log(`Retrying with new SKU: ${newSku}`);
      payload.sku = newSku;
      const retryResp = await retryAxios(() => axios.post(`${EBAY_API}/sell/inventory/v1/offer`, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }));
      return retryResp.data.offerId;
    }
    throw err;
  }
}

// ── Publish offer ────────────────────────────────────────────────────────

async function publishOffer(offerId, token) {
  const url = `${EBAY_API}/sell/inventory/v1/offer/${offerId}/publish`;

  const resp = await axios.post(url, {}, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return resp.data.listingId;
}

// ── Full listing pipeline ────────────────────────────────────────────────

async function createBundleListing(bundle, foundComponents, userToken) {
  const sku = `SONIC-BUNDLE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  // 1. Generate AI listing copy
  console.log('Generating listing copy...');
  const listingCopy = await generateListingCopy(bundle.name, foundComponents, bundle.resaleValue);
  if (!listingCopy) {
    throw new Error('Failed to generate listing copy. Check Gemini API key.');
  }

  // 2. Generate bundle artwork (optional — don't fail if it errors)
  console.log('Generating bundle artwork...');
  let imageUrls = [];
  const artBuffer = await generateBundleArt(bundle.name, foundComponents);
  // Note: To use generated images in eBay listings, they'd need to be hosted
  // For now, use component images from eBay
  const componentImages = foundComponents
    .filter(c => c.item?.image)
    .map(c => c.item.image);
  imageUrls = componentImages.length > 0 ? componentImages : [];

  // 3. Create inventory item
  console.log(`Creating inventory item (SKU: ${sku})...`);
  await createInventoryItem(sku, listingCopy, imageUrls, userToken);

  // 4. Create offer
  console.log('Creating offer...');
  const offerId = await createOffer(sku, bundle.resaleValue, userToken);

  // 5. Publish
  console.log('Publishing listing...');
  const listingId = await publishOffer(offerId, userToken);

  const listingUrl = `https://www.ebay.com/itm/${listingId}`;
  console.log(`Listing created: ${listingUrl}`);

  return {
    sku,
    offerId,
    listingId,
    listingUrl,
    title: listingCopy.title,
    artBuffer // Return for Telegram photo
  };
}

module.exports = {
  createInventoryItem,
  createOffer,
  publishOffer,
  createBundleListing
};
