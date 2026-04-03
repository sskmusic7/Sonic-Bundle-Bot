/**
 * Validator Agent — LLM verifies sourced items for character accuracy + authenticity
 * Uses Gemini Flash for fast, cheap validation
 */

'use strict';

const { callGeminiFlash } = require('../sonic-ai');

const name = 'validator';
const interval = 30 * 60 * 1000; // 30 minutes

async function run(db, { notify }) {
  // Get pending items (max 20 per run to stay within rate limits)
  const pending = db.prepare(`
    SELECT * FROM sourced_items WHERE validation_status = 'pending' ORDER BY sourced_at ASC LIMIT 20
  `).all();

  if (pending.length === 0) return { processed: 0 };

  const updateStmt = db.prepare(`
    UPDATE sourced_items
    SET validation_status = ?, validation_notes = ?, character = COALESCE(?, character)
    WHERE id = ?
  `);

  let validated = 0;
  let rejected = 0;

  for (const item of pending) {
    try {
      const prompt = `You are an expert Sonic the Hedgehog merchandise authenticator.

Given this eBay listing:
Title: "${item.title}"
Price: $${item.price}
Condition: ${item.condition || 'Unknown'}

Answer these questions in a strict JSON format (no markdown, no code blocks):
{
  "character": "exact character name or null if unclear",
  "official": true/false,
  "condition_assessment": "new/used/unknown",
  "red_flags": "brief note or null",
  "verdict": "valid" or "rejected",
  "reason": "1-sentence explanation"
}

Rules:
- "valid" = clearly a specific Sonic character, appears official/licensed, no bootleg indicators
- "rejected" = wrong franchise, bootleg/custom, unclear character, lot/bundle of mixed items, or misleading title
- Look for red flags: "custom", "handmade", "fan made", "unofficial", "lot of", "mixed", "random"
- Multi-item lots should be REJECTED (we want individual items only)`;

      const response = await callGeminiFlash(prompt);
      if (!response) {
        // Skip if Gemini is down — leave as pending for next run
        continue;
      }

      // Parse JSON from response (handle markdown code blocks)
      let parsed;
      try {
        const jsonStr = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch {
        // If JSON parse fails, try to extract verdict manually
        const isRejected = response.toLowerCase().includes('"rejected"') ||
                          response.toLowerCase().includes('verdict: rejected');
        parsed = {
          verdict: isRejected ? 'rejected' : 'valid',
          character: item.character,
          reason: response.slice(0, 200)
        };
      }

      const status = parsed.verdict === 'valid' ? 'valid' : 'rejected';
      const notes = parsed.reason || parsed.red_flags || '';
      const character = parsed.character || null;

      updateStmt.run(status, notes, character, item.id);

      if (status === 'valid') validated++;
      else rejected++;

      // Rate limit Gemini calls
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`Validator failed on item ${item.id}:`, err.message);
    }
  }

  if (validated > 0 || rejected > 0) {
    await notify(`*VALIDATOR:* ${validated} approved, ${rejected} rejected (${pending.length} checked)`);
  }

  return { processed: validated + rejected, validated, rejected };
}

module.exports = { name, interval, run };
