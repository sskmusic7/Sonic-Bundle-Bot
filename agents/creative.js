/**
 * Creative Agent — Generates hero images for ready bundles using Gemini
 * Produces professional product photos for eBay listings
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateBundleArt } = require('../sonic-ai');

const name = 'creative';
const interval = 60 * 60 * 1000; // 1 hour

const SHRINE_IMAGE_DIR = './data/shrine-images';

// Ensure image directory exists
if (!fs.existsSync(SHRINE_IMAGE_DIR)) {
  fs.mkdirSync(SHRINE_IMAGE_DIR, { recursive: true });
}

async function run(db, { notify, notifyPhoto }) {
  // Get bundles that need images
  const bundles = db.prepare(`
    SELECT * FROM shrine_bundles
    WHERE status = 'ready' AND hero_image_path IS NULL
    LIMIT 3
  `).all();

  if (bundles.length === 0) return { processed: 0 };

  let imagesGenerated = 0;

  for (const bundle of bundles) {
    try {
      // Load components
      const components = db.prepare(`
        SELECT sc.role, sc.locked_price, si.title, si.image_url, si.character
        FROM shrine_components sc
        JOIN sourced_items si ON sc.sourced_item_id = si.id
        WHERE sc.bundle_id = ?
      `).all(bundle.id);

      if (components.length === 0) continue;

      // Build component list for image gen (match sonic-ai.js format)
      const compList = components.map(c => ({
        label: c.role,
        item: { title: c.title, image: c.image_url }
      }));

      // Generate hero image via Gemini
      const imageBuffer = await generateBundleArt(bundle.bundle_name, compList);

      if (imageBuffer) {
        // Save to disk
        const imagePath = path.join(SHRINE_IMAGE_DIR, `shrine-${bundle.id}.png`);
        fs.writeFileSync(imagePath, imageBuffer);

        // Update bundle
        db.prepare(`
          UPDATE shrine_bundles SET hero_image_path = ? WHERE id = ?
        `).run(imagePath, bundle.id);

        imagesGenerated++;

        // Send preview to Telegram
        try {
          await notifyPhoto(imageBuffer,
            `*CREATIVE:* Hero image for "${bundle.bundle_name}"\n$${bundle.list_price} list price`
          );
        } catch (err) {
          // Photo send might fail — don't block pipeline
          await notify(`*CREATIVE:* Hero image generated for "${bundle.bundle_name}" (photo preview failed)`);
        }
      } else {
        // Image gen failed — still mark as ready for lister (will use component images)
        console.log(`Creative: Image gen failed for bundle ${bundle.id}, will use component images`);
        // Set a placeholder so lister knows to proceed without hero image
        db.prepare(`
          UPDATE shrine_bundles SET hero_image_path = 'none' WHERE id = ?
        `).run(bundle.id);
      }

      // Rate limit between image generations
      await new Promise(r => setTimeout(r, 5000));

    } catch (err) {
      console.error(`Creative failed on bundle ${bundle.id}:`, err.message);
    }
  }

  if (imagesGenerated > 0) {
    await notify(`*CREATIVE:* Generated ${imagesGenerated} hero image(s)`);
  }

  return { processed: imagesGenerated };
}

module.exports = { name, interval, run };
