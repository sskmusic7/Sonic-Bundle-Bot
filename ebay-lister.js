/**
 * eBay Lister — Create eBay listings via Inventory API
 * Requires 3-legged OAuth (user token from ebay-auth.js)
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { generateListingCopy, generateBundleArt } = require('./sonic-ai');

const EBAY_API = 'https://api.ebay.com';

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
  const url = `${EBAY_API}/sell/inventory/v1/offer`;

  const payload = {
    sku: sku,
    marketplaceId: 'EBAY_US',
    format: 'FIXED_PRICE',
    listingDescription: '',  // Uses inventory item description
    availableQuantity: 1,
    pricingSummary: {
      price: {
        value: price.toFixed(2),
        currency: 'USD'
      }
    },
    categoryId: '158769',  // Collectible Plush Toys & Stuffed Animals
    listingPolicies: {
      // These must be set up in eBay seller hub
      // Will use default policies if available
    },
    merchantLocationKey: 'default'  // Must be created in seller account
  };

  const resp = await axios.post(url, payload, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US'
    },
    timeout: 15000
  });

  return resp.data.offerId;
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
