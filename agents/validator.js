/**
 * Validator Agent — Rule-based validation (no Gemini on the hot path)
 *
 * Previous design called Gemini Flash per item, burning ~500-1000 calls/day on
 * pure keyword classification work. Gemini should only be used at the end of
 * the pipeline (image generation + listing copy), not for deciding whether
 * "Sonic Shadow Plush 12-inch by Jakks NEW" is a valid Sonic product.
 *
 * This version:
 *   - Classifies every item via deterministic rules (character match, red-flag
 *     keywords, multi-item detection, franchise markers, price sanity).
 *   - Optionally falls back to Gemini ONLY for items the rule engine marked
 *     "uncertain" (soft reject), gated by VALIDATOR_USE_LLM_FALLBACK=1 and
 *     a hard hourly cap (VALIDATOR_LLM_PER_HOUR, default 10).
 *
 * Expected Gemini burn:
 *   rules-only:      0 calls/day
 *   with fallback:   ≤ 10/hour × 24 = 240 calls/day (hard cap)
 *   previous design: 500–1000 calls/day
 */

'use strict';

const { callGeminiFlash } = require('../sonic-ai');
const config = require('../config');

const name = 'validator';
const interval = 30 * 60 * 1000; // 30 minutes

const SHRINE = config.shrine || {};

// Flatten characters into (canonical, aliases) pairs so "amy" still matches "amy rose".
const CHAR_ALIASES = {
  'amy rose': ['amy', 'amy rose'],
  'metal sonic': ['metal sonic'],
  'big the cat': ['big the cat'],
  'eggman': ['eggman', 'dr eggman', 'dr. eggman', 'robotnik']
};
const CHARACTERS = (SHRINE.characters || []).map(c => c.toLowerCase());

// Tokenise category phrases into single words so "keychain pin accessory"
// becomes ['keychain','pin','accessory'] and "action figure" becomes
// ['action figure','action','figure'] (phrase kept for stricter match first).
function expandCategories(raw) {
  const out = new Set();
  for (const phrase of raw.map(c => c.toLowerCase())) {
    out.add(phrase);
    for (const token of phrase.split(/\s+/)) {
      if (token.length >= 3) out.add(token);
    }
  }
  return [...out];
}
const CATEGORIES = expandCategories(SHRINE.categories || []);

// Franchise markers — title should contain at least one
const FRANCHISE_MARKERS = [
  'sonic', 'sega', 'hedgehog', 'jakks', 'tomy', 'first 4 figures',
  'sanei', 'great eastern', 'ge animation'
];

// Red flags → instant reject
const RED_FLAGS = [
  'custom', 'handmade', 'fan made', 'fanmade', 'unofficial',
  'bootleg', 'repro', 'replica', 'knockoff', 'knock-off',
  ' lot ', 'lot of ', 'bundle of ', 'set of ', 'mixed lot',
  'random', 'grab bag', 'mystery box',
  ' 3d print', '3d-print', 'printed by', 'resin print'
];

// Multi-item patterns: "2x", "3 pc", "4pcs", "pack of 5"
const MULTI_ITEM_PATTERNS = [
  /\b[2-9]\s?x\b/i,
  /\b\d+\s?pcs?\b/i,
  /\bpack of \d+/i,
  /\bset of \d+/i
];

const MIN_PRICE = 1;
const MAX_PRICE = SHRINE.maxComponentPrice || 50;

function matchCharacter(title) {
  for (const c of CHARACTERS) {
    const aliases = CHAR_ALIASES[c] || [c];
    for (const a of aliases) {
      // Word-boundary-ish check to avoid "sonicare" matching "sonic"
      const re = new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
      if (re.test(title)) return c;
    }
  }
  return null;
}

function matchCategory(title) {
  for (const c of CATEGORIES) {
    if (title.includes(c)) return c;
  }
  return null;
}

function classify(item) {
  const title = (item.title || '').toLowerCase();
  const price = Number(item.price) || 0;

  if (price < MIN_PRICE) {
    return { verdict: 'rejected', reason: 'price below floor', character: null };
  }
  if (price > MAX_PRICE) {
    return { verdict: 'rejected', reason: `price > $${MAX_PRICE} cap`, character: null };
  }

  for (const rf of RED_FLAGS) {
    if (title.includes(rf)) {
      return { verdict: 'rejected', reason: `red-flag "${rf.trim()}"`, character: null };
    }
  }

  for (const re of MULTI_ITEM_PATTERNS) {
    if (re.test(title)) {
      return { verdict: 'rejected', reason: 'multi-item', character: null };
    }
  }

  const hasFranchise = FRANCHISE_MARKERS.some(m => title.includes(m));
  if (!hasFranchise) {
    return { verdict: 'rejected', reason: 'not Sonic franchise', character: null };
  }

  const character = matchCharacter(title);
  if (!character) {
    // No known character matched but franchise was present — soft reject.
    // LLM fallback (if enabled) may rescue these.
    return { verdict: 'uncertain', reason: 'no canonical character', character: null };
  }

  const category = matchCategory(title);
  if (!category) {
    return { verdict: 'uncertain', reason: 'no known category', character };
  }

  return { verdict: 'valid', reason: `rule: ${character} / ${category}`, character };
}

// Optional Gemini fallback, gated hard by env + hourly budget
const USE_LLM_FALLBACK = process.env.VALIDATOR_USE_LLM_FALLBACK === '1';
const LLM_PER_HOUR     = parseInt(process.env.VALIDATOR_LLM_PER_HOUR || '10', 10);
let   llmWindowStart   = Date.now();
let   llmCalls         = 0;

function llmBudgetAvailable() {
  const now = Date.now();
  if (now - llmWindowStart > 60 * 60 * 1000) {
    llmWindowStart = now;
    llmCalls = 0;
  }
  return llmCalls < LLM_PER_HOUR;
}

async function llmAdjudicate(item) {
  if (!USE_LLM_FALLBACK || !llmBudgetAvailable()) {
    return { verdict: 'rejected', reason: 'uncertain, LLM fallback unavailable', character: null };
  }
  llmCalls++;

  const prompt = `Title: "${item.title}"
Price: $${item.price}

Return STRICT JSON: {"verdict":"valid"|"rejected","character":"name or null","reason":"<=1 sentence"}
"valid" only if clearly an official single Sonic franchise item with identifiable character.`;

  const response = await callGeminiFlash(prompt);
  if (!response) {
    return { verdict: 'rejected', reason: 'LLM unavailable', character: null };
  }
  try {
    const jsonStr = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      verdict: parsed.verdict === 'valid' ? 'valid' : 'rejected',
      reason:  (parsed.reason || 'LLM').slice(0, 200),
      character: parsed.character || null
    };
  } catch {
    return { verdict: 'rejected', reason: 'LLM parse failed', character: null };
  }
}

async function run(db, { notify }) {
  const pending = db.prepare(`
    SELECT * FROM sourced_items WHERE validation_status = 'pending' ORDER BY sourced_at ASC LIMIT 100
  `).all();

  if (pending.length === 0) return { processed: 0 };

  const updateStmt = db.prepare(`
    UPDATE sourced_items
    SET validation_status = ?, validation_notes = ?, character = COALESCE(?, character)
    WHERE id = ?
  `);

  let validated = 0, rejected = 0, llmCallsMade = 0;

  for (const item of pending) {
    try {
      let decision = classify(item);

      if (decision.verdict === 'uncertain') {
        const before = llmCalls;
        decision = await llmAdjudicate(item);
        if (llmCalls > before) llmCallsMade++;
      }

      const status = decision.verdict === 'valid' ? 'valid' : 'rejected';
      updateStmt.run(status, decision.reason, decision.character, item.id);

      if (status === 'valid') validated++;
      else rejected++;
    } catch (err) {
      console.error(`Validator failed on item ${item.id}:`, err.message);
    }
  }

  if (validated > 0 || rejected > 0) {
    console.log(
      `Validator: ${validated} approved, ${rejected} rejected ` +
      `(${pending.length} checked, ${llmCallsMade} LLM fallbacks)`
    );
  }

  return { processed: validated + rejected, validated, rejected, llmFallbacks: llmCallsMade };
}

module.exports = { name, interval, run };
