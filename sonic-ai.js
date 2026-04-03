/**
 * Sonic AI — Gemini Flash integration for bundle analysis + image generation
 * Fail-open design: errors return null, never block reports
 */

'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const IMAGE_CACHE_DIR = './data/bundle_images';

// Ensure image cache directory exists
if (!fs.existsSync(IMAGE_CACHE_DIR)) {
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
}

// ── Gemini Flash text generation ─────────────────────────────────────────

async function callGeminiFlash(prompt) {
  if (!config.gemini.apiKey) return null;

  try {
    const url = `${GEMINI_URL}/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
    const resp = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
    }, { timeout: 30000 });

    return resp.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('Gemini Flash error:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// ── Bundle analysis ──────────────────────────────────────────────────────

async function analyzeBundle(bundleName, components) {
  const itemList = components
    .filter(c => c.item)
    .map(c => `- ${c.label}: "${c.item.title}" at $${Number(c.item.price).toFixed(2)} (${c.item.condition || 'N/A'})`)
    .join('\n');

  const prompt = `You are an expert Sonic the Hedgehog collectibles appraiser and reseller.

Analyze this bundle opportunity:

Bundle: "${bundleName}"
Components found:
${itemList}

Rate each aspect 1-10 and give a brief assessment:
1. RARITY: How rare/hard to find are these items together?
2. LEGITIMACY: Are these likely genuine licensed products? Any red flags?
3. DEMAND: Current collector demand for this combination?
4. SYNERGY: How well do these items complement each other as a set?

End with a one-sentence BUY/PASS/WAIT recommendation.

Keep response under 400 characters total. Use numbers only for ratings, no verbose explanations.`;

  const text = await callGeminiFlash(prompt);
  if (!text) return null;

  // Parse ratings from response
  const rarityMatch = text.match(/RARITY[:\s]*(\d+)/i);
  const legitimacyMatch = text.match(/LEGITIMACY[:\s]*(\d+)/i);
  const demandMatch = text.match(/DEMAND[:\s]*(\d+)/i);
  const synergyMatch = text.match(/SYNERGY[:\s]*(\d+)/i);

  return {
    assessment: text,
    rarity: rarityMatch ? parseInt(rarityMatch[1]) : null,
    legitimacy: legitimacyMatch ? parseInt(legitimacyMatch[1]) : null,
    demand: demandMatch ? parseInt(demandMatch[1]) : null,
    synergy: synergyMatch ? parseInt(synergyMatch[1]) : null
  };
}

// ── Image generation ─────────────────────────────────────────────────────

async function generateBundleArt(bundleName, components) {
  if (!config.gemini.apiKey) return null;

  // Check cache (1 per day max per bundle)
  const dateKey = new Date().toISOString().slice(0, 10);
  const hash = crypto.createHash('md5').update(`${bundleName}-${dateKey}`).digest('hex');
  const cachePath = path.join(IMAGE_CACHE_DIR, `${hash}.png`);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  try {
    const itemNames = components
      .filter(c => c.item)
      .map(c => c.label)
      .join(', ');

    const url = `${GEMINI_URL}/${config.gemini.imageModel}:generateContent?key=${config.gemini.apiKey}`;
    const resp = await axios.post(url, {
      contents: [{
        parts: [{
          text: `Create a professional product photography style image showing a collectible bundle called "${bundleName}" featuring: ${itemNames}. Style: clean white background, items arranged in an appealing display layout, soft studio lighting, high quality product photo suitable for an eBay listing. Sonic the Hedgehog themed collectibles.`
        }]
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    }, { timeout: 60000 });

    // Find image data in response
    const parts = resp.data.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        // Cache it
        fs.writeFileSync(cachePath, buffer);
        return buffer;
      }
    }

    return null;
  } catch (err) {
    console.error('Gemini image gen error:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// ── Listing copy generation ──────────────────────────────────────────────

async function generateListingCopy(bundleName, components, resaleValue) {
  const itemList = components
    .filter(c => c.item)
    .map(c => `- ${c.label}: "${c.item.title}"`)
    .join('\n');

  const prompt = `Write an eBay listing for a Sonic the Hedgehog collectible bundle.

Bundle name: "${bundleName}"
Items included:
${itemList}
Suggested price: $${resaleValue}

Generate:
1. TITLE: eBay title (max 80 chars, include key search terms)
2. DESCRIPTION: HTML description (200-300 words) with:
   - Attention-grabbing opening
   - Item details in a clean list
   - Condition note (all items are pre-owned/used unless stated)
   - Shipping info (ships within 1-2 business days, USPS Priority)
   - "Bundle saves you 20%+ vs buying separately" value prop

Format your response exactly as:
TITLE: [title here]
DESCRIPTION: [html here]`;

  const text = await callGeminiFlash(prompt);
  if (!text) return null;

  const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|DESCRIPTION:)/s);
  const descMatch = text.match(/DESCRIPTION:\s*([\s\S]+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : `${bundleName} - Sonic Collectible Bundle`,
    description: descMatch ? descMatch[1].trim() : `<p>${bundleName} bundle listing</p>`
  };
}

module.exports = {
  callGeminiFlash,
  analyzeBundle,
  generateBundleArt,
  generateListingCopy
};
