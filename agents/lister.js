/**
 * Lister Agent — Publishes ready bundles to eBay
 * Uses existing ebay-lister.js pipeline (Inventory API)
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const ebayAuth = require('../ebay-auth');
const ebayLister = require('../ebay-lister');
const { generateListingCopy } = require('../sonic-ai');

const name = 'lister';
const interval = 60 * 60 * 1000; // 1 hour

async function run(db, { notify, notifyPhoto }) {
  // Get bundles ready to list (have image or marked as 'none')
  const bundles = db.prepare(`
    SELECT * FROM shrine_bundles
    WHERE status = 'ready' AND hero_image_path IS NOT NULL
    LIMIT 2
  `).all();

  if (bundles.length === 0) return { processed: 0 };

  // Get user token
  let userToken;
  try {
    userToken = await ebayAuth.getUserToken(db);
  } catch (err) {
    console.error('Lister: Failed to get user token:', err.message);
    return { processed: 0, error: 'No eBay auth token — run /ebayauth' };
  }

  if (!userToken) {
    const errorMsg = 'LISTER BLOCKED: No eBay auth token — run /ebayauth';
    console.error(errorMsg);
    await notify(`*${errorMsg}*`);
    return { processed: 0, error: errorMsg };
  }

  let listed = 0;

  for (const bundle of bundles) {
    try {
      // Mark as listing in progress
      db.prepare("UPDATE shrine_bundles SET status = 'listing' WHERE id = ?").run(bundle.id);

      // Load components
      const components = db.prepare(`
        SELECT sc.role, sc.locked_price, si.title, si.image_url, si.ebay_item_id
        FROM shrine_components sc
        JOIN sourced_items si ON sc.sourced_item_id = si.id
        WHERE sc.bundle_id = ?
      `).all(bundle.id);

      // Generate listing copy
      const compList = components.map(c => ({
        label: c.role,
        item: { title: c.title, image: c.image_url }
      }));

      const listingCopy = await generateListingCopy(
        bundle.bundle_name, compList, bundle.list_price
      );

      if (!listingCopy) {
        console.error(`Lister: Failed to generate copy for bundle ${bundle.id}`);
        db.prepare("UPDATE shrine_bundles SET status = 'ready' WHERE id = ?").run(bundle.id);
        continue;
      }

      // Collect image URLs
      const imageUrls = [];

      // If we have a hero image, we'd need to host it (eBay needs URLs)
      // For now, use component images from eBay (they're already hosted)
      for (const comp of components) {
        if (comp.image_url) imageUrls.push(comp.image_url);
      }

      // Create eBay listing via existing pipeline
      const sku = `SHRINE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      await ebayLister.createInventoryItem(sku, listingCopy, imageUrls, userToken);
      const offerId = await ebayLister.createOffer(sku, bundle.list_price, userToken);
      const listingId = await ebayLister.publishOffer(offerId, userToken);

      const listingUrl = `https://www.ebay.com/itm/${listingId}`;

      // Update bundle in DB
      db.prepare(`
        UPDATE shrine_bundles
        SET status = 'active', ebay_listing_id = ?, ebay_sku = ?, listed_at = datetime('now')
        WHERE id = ?
      `).run(listingId, sku, bundle.id);

      listed++;

      // Notify
      await notify(
        `*LISTER: Listed on eBay!*\n` +
        `*${listingCopy.title}*\n` +
        `Price: $${bundle.list_price}\n` +
        `Cost: $${bundle.total_cost} | Margin: ${bundle.margin_pct}%\n` +
        `[View Listing](${listingUrl})`
      );

      // Send hero image if we have one
      if (bundle.hero_image_path && bundle.hero_image_path !== 'none' && fs.existsSync(bundle.hero_image_path)) {
        try {
          const imgBuffer = fs.readFileSync(bundle.hero_image_path);
          await notifyPhoto(imgBuffer, `Listed: ${listingCopy.title}`);
        } catch (err) {
          // Non-critical
        }
      }

      // Rate limit between listings
      await new Promise(r => setTimeout(r, 3000));

    } catch (err) {
      console.error(`Lister failed on bundle ${bundle.id}:`, err.message);
      // Reset status so it can be retried
      db.prepare("UPDATE shrine_bundles SET status = 'ready' WHERE id = ?").run(bundle.id);

      await notify(`*LISTER ERROR:* Failed to list "${bundle.bundle_name}": ${err.message}`);
    }
  }

  return { processed: listed };
}

module.exports = { name, interval, run };
