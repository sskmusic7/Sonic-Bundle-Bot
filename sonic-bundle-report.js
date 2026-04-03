/**
 * Sonic Bundle Report — Optimised
 * Multiple bundle tiers, prospect alerts, market intelligence, top deals
 */

'use strict';

const Database = require('better-sqlite3');
const axios = require('axios');
const config = require('./config');

const { analyzeBundle, generateBundleArt } = require('./sonic-ai');

const DB_PATH = './data/sonic_tracker.db';

const TELEGRAM_TOKEN = config.telegram.botToken;
const TELEGRAM_CHAT_ID = config.telegram.chatId;

// ── Condition label mapping ──────────────────────────────────────────────
const CONDITION_MAP = {
  'New': 'New', 'NEW': 'New',
  'New with tags': 'NWT', 'New without tags': 'NWOT',
  'New with defects': 'Defects',
  'Pre-owned': 'Used', 'Used': 'Used',
  'Very Good': 'VG', 'Good': 'Good', 'Acceptable': 'Fair',
  'For parts or not working': 'Parts',
};

function condLabel(condition) {
  if (!condition || condition === 'N/A') return '';
  return CONDITION_MAP[condition] || condition;
}

// ── Bundle Definitions ─────────────────────────────────────────────────────
// 5 tiers: starter, hero team, shadow rivals, complete team, grail display

const BUNDLE_DEFINITIONS = [
  // TIER 1 — Starter (low entry, fast flip)
  {
    name: 'Starter Plush Pair',
    targetCost: 25,
    resaleValue: 50,
    narrative: 'Two-pack starter set targets casual buyers and gift shoppers. Low cost of entry, fast turnover. Best sold as "Sonic & Friend" duo — works on eBay, FB Marketplace, and Vinted. Free shipping at this price point wins every time.',
    components: [
      { label: 'Sonic Plush (any)',  keywords: ['sonic', 'plush'],    exclude: ['shadow', 'tails', 'knuckles', 'amy', 'silver', 'lot', 'bundle'] },
      { label: 'Tails Plush (any)', keywords: ['tails', 'plush'],    exclude: ['shadow', 'sonic', 'knuckles', 'amy', 'silver', 'lot', 'bundle'] }
    ]
  },

  // TIER 2 — Hero Team (the classic 3-pack)
  {
    name: 'Hero Team Plush Pack',
    targetCost: 60,
    resaleValue: 120,
    narrative: 'GE Sonic, Tails, and Knuckles together command a 25-30% premium over individual sales. The three-hero combo dominates the collector segment. Strong gift buyer demand drives steady turnover year-round.',
    components: [
      { label: 'GE Sonic Plush',    keywords: ['sonic', 'plush'],    exclude: ['shadow', 'tails', 'knuckles', 'amy', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Tails Plush',    keywords: ['tails', 'plush'],    exclude: ['shadow', 'sonic', 'knuckles', 'amy', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Knuckles Plush', keywords: ['knuckles', 'plush'], exclude: ['shadow', 'sonic', 'tails', 'amy', 'boom8', 'lot', 'bundle'] }
    ]
  },

  // TIER 3 — Shadow & Rivals (premium villain set)
  {
    name: 'Shadow & Rivals Set',
    targetCost: 70,
    resaleValue: 145,
    narrative: 'Shadow plush has seen a 20% price increase YoY from the movie franchise. Hero vs rival dynamic is one of the most sought-after collector themes. Boom8 figure adds a novelty premium that converts at 15% above average list.',
    components: [
      { label: 'GE Shadow Plush', keywords: ['shadow', 'plush'],  exclude: ['sonic', 'tails', 'knuckles', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Sonic Plush',  keywords: ['sonic', 'plush'],   exclude: ['shadow', 'tails', 'knuckles', 'boom8', 'lot', 'bundle'] },
      { label: 'Boom8 Shadow',    keywords: ['shadow', 'boom8'],  exclude: ['tails', 'knuckles', 'lot'] }
    ]
  },

  // TIER 4 — Complete Team (4 main characters)
  {
    name: 'Complete Team Set',
    targetCost: 80,
    resaleValue: 180,
    narrative: 'The full Sonic, Tails, Knuckles, Shadow lineup. Premium display set for adult collectors. Sells best with good photos of all 4 displayed together. Title it "Complete Sonic Heroes Collection" for max search visibility.',
    components: [
      { label: 'GE Sonic Plush',    keywords: ['sonic', 'plush'],    exclude: ['shadow', 'tails', 'knuckles', 'amy', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Tails Plush',    keywords: ['tails', 'plush'],    exclude: ['shadow', 'sonic', 'knuckles', 'amy', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Knuckles Plush', keywords: ['knuckles', 'plush'], exclude: ['shadow', 'sonic', 'tails', 'amy', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Shadow Plush',   keywords: ['shadow', 'plush'],   exclude: ['sonic', 'tails', 'knuckles', 'amy', 'boom8', 'lot', 'bundle'] }
    ]
  },

  // TIER 5 — Grail Display (premium collector set)
  {
    name: 'Grail Display Collection',
    targetCost: 100,
    resaleValue: 220,
    narrative: 'Premium 5-piece set with Amy Rose or Silver as the rare draw piece. Target adult collectors willing to pay £150+ for a shelf-ready display. Photograph on a clean display shelf with character-accurate positioning. This is the highest-margin bundle.',
    components: [
      { label: 'GE Sonic Plush',    keywords: ['sonic', 'plush'],    exclude: ['shadow', 'tails', 'knuckles', 'amy', 'silver', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Tails Plush',    keywords: ['tails', 'plush'],    exclude: ['shadow', 'sonic', 'knuckles', 'amy', 'silver', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Knuckles Plush', keywords: ['knuckles', 'plush'], exclude: ['shadow', 'sonic', 'tails', 'amy', 'silver', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Shadow Plush',   keywords: ['shadow', 'plush'],   exclude: ['sonic', 'tails', 'knuckles', 'amy', 'silver', 'boom8', 'lot', 'bundle'] },
      { label: 'GE Amy/Silver Plush', keywords: ['plush'],            exclude: ['sonic', 'tails', 'knuckles', 'shadow', 'boom8', 'lot', 'bundle'],
        // Match amy OR silver
        altKeywords: [['amy', 'plush'], ['silver', 'hedgehog', 'plush']] }
    ]
  },

  // BONUS — Lot Flip (buy bulk, resell as bundles)
  {
    name: 'Lot Flip Opportunity',
    targetCost: 30,
    resaleValue: 80,
    narrative: 'Buy a mixed Sonic lot/bundle listing for cheap, then break it apart or re-bundle as curated sets. The profit is in the sorting — most lot sellers don\'t know individual values. Look for "clearing out" and "kids grown out of" language.',
    components: [
      { label: 'Sonic Lot/Bundle', keywords: ['sonic'], exclude: ['single', 'individual'],
        altKeywords: [['sonic', 'lot'], ['sonic', 'bundle'], ['sonic', 'plush', 'lot'], ['sonic', 'toy', 'bundle']] }
    ]
  }
];

// ── Telegram ───────────────────────────────────────────────────────────────

async function sendTelegram(text, parseMode = 'Markdown') {
  try {
    // Telegram has a 4096 char limit per message — split if needed
    const chunks = [];
    if (text.length > 4000) {
      let remaining = text;
      while (remaining.length > 0) {
        let cutAt = remaining.lastIndexOf('\n', 4000);
        if (cutAt <= 0) cutAt = 4000;
        chunks.push(remaining.substring(0, cutAt));
        remaining = remaining.substring(cutAt);
      }
    } else {
      chunks.push(text);
    }

    for (const chunk of chunks) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: chunk,
        parse_mode: parseMode,
        disable_web_page_preview: true
      });
    }
  } catch (err) {
    console.error('Telegram send error:', err.response?.data || err.message);
  }
}

async function sendTelegramPhoto(imageBuffer, caption) {
  try {
    const FormData = require('form-data') || null;
    // Use axios multipart upload
    const boundary = '----BundleArt' + Date.now();
    const crlf = '\r\n';

    let body = '';
    body += `--${boundary}${crlf}`;
    body += `Content-Disposition: form-data; name="chat_id"${crlf}${crlf}`;
    body += `${TELEGRAM_CHAT_ID}${crlf}`;

    if (caption) {
      body += `--${boundary}${crlf}`;
      body += `Content-Disposition: form-data; name="caption"${crlf}${crlf}`;
      body += `${caption}${crlf}`;

      body += `--${boundary}${crlf}`;
      body += `Content-Disposition: form-data; name="parse_mode"${crlf}${crlf}`;
      body += `Markdown${crlf}`;
    }

    body += `--${boundary}${crlf}`;
    body += `Content-Disposition: form-data; name="photo"; filename="bundle.png"${crlf}`;
    body += `Content-Type: image/png${crlf}${crlf}`;

    const header = Buffer.from(body, 'utf8');
    const footer = Buffer.from(`${crlf}--${boundary}--${crlf}`, 'utf8');
    const payload = Buffer.concat([header, imageBuffer, footer]);

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, payload, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length
      },
      maxBodyLength: 10 * 1024 * 1024
    });
  } catch (err) {
    console.error('Telegram photo send error:', err.response?.data || err.message);
  }
}

// ── DB helpers ─────────────────────────────────────────────────────────────

function openDb() {
  return new Database(DB_PATH, { readonly: true });
}

function getAllItems(db) {
  try {
    return db.prepare('SELECT * FROM items ORDER BY price ASC').all();
  } catch (err) {
    console.error('DB query failed:', err.message);
    return [];
  }
}

// ── Matching ───────────────────────────────────────────────────────────────

function findCheapestMatch(items, keywords, exclude, altKeywords) {
  const kw = keywords.map(k => k.toLowerCase());
  const ex = (exclude || []).map(e => e.toLowerCase());

  let matches = items.filter(item => {
    const t = item.title.toLowerCase();
    return kw.every(k => t.includes(k)) && ex.every(e => !t.includes(e));
  });

  // If no matches and altKeywords provided, try each alternative
  if (matches.length === 0 && altKeywords) {
    for (const altKw of altKeywords) {
      const altLower = altKw.map(k => k.toLowerCase());
      matches = items.filter(item => {
        const t = item.title.toLowerCase();
        return altLower.every(k => t.includes(k)) && ex.every(e => !t.includes(e));
      });
      if (matches.length > 0) break;
    }
  }

  return matches[0] || null; // already sorted by price ASC
}

function findAllMatches(items, keywords, exclude, altKeywords, maxResults = 5) {
  const kw = keywords.map(k => k.toLowerCase());
  const ex = (exclude || []).map(e => e.toLowerCase());

  let matches = items.filter(item => {
    const t = item.title.toLowerCase();
    return kw.every(k => t.includes(k)) && ex.every(e => !t.includes(e));
  });

  if (matches.length === 0 && altKeywords) {
    for (const altKw of altKeywords) {
      const altLower = altKw.map(k => k.toLowerCase());
      matches = items.filter(item => {
        const t = item.title.toLowerCase();
        return altLower.every(k => t.includes(k)) && ex.every(e => !t.includes(e));
      });
      if (matches.length > 0) break;
    }
  }

  return matches.slice(0, maxResults);
}

function fmt(price) {
  return `£${Number(price).toFixed(2)}`;
}

// ── Bundle Reports ─────────────────────────────────────────────────────────

async function sendBundleReports(items, detailed = false) {
  for (const bundle of BUNDLE_DEFINITIONS) {
    const found = [];
    let totalCost = 0;

    for (const comp of bundle.components) {
      const item = findCheapestMatch(items, comp.keywords, comp.exclude, comp.altKeywords);
      found.push({ label: comp.label, item });
      if (item) totalCost += Number(item.price);
    }

    const fullyViable = found.every(f => f.item !== null) && totalCost <= bundle.targetCost;
    const partialCount = found.filter(f => f.item !== null).length;
    const estimatedProfit = bundle.resaleValue - totalCost;
    const margin = totalCost > 0 ? ((estimatedProfit / totalCost) * 100).toFixed(0) : '0';

    if (detailed) {
      // ── Detailed (original verbose format) ──

      // Send bundle artwork for fully viable bundles
      if (fullyViable) {
        try {
          const artBuffer = await generateBundleArt(bundle.name, found);
          if (artBuffer) {
            await sendTelegramPhoto(artBuffer, `🎨 *${bundle.name}* — AI Generated Bundle Art`);
          }
        } catch (err) {
          console.warn('Bundle art generation skipped:', err.message);
        }
      }

      let msg = `*${bundle.name}*\n`;
      msg += fullyViable
        ? '✅ FULLY VIABLE — all components found within budget\n'
        : `⚠️ PARTIAL (${partialCount}/${found.length} components found)\n`;
      msg += '\n*Components:*\n';

      for (const f of found) {
        if (f.item) {
          const cond = condLabel(f.item.condition);
          msg += `• *${f.label}*\n`;
          msg += `  Title: ${f.item.title}\n`;
          msg += `  Price: ${fmt(f.item.price)}${cond ? ` (${cond})` : ''}\n`;
          if (f.item.seller_username) msg += `  Seller: ${f.item.seller_username}`;
          if (f.item.seller_feedback) msg += ` (${f.item.seller_feedback} feedback)`;
          if (f.item.seller_username) msg += '\n';
          if (f.item.url) msg += `  URL: ${f.item.url}\n`;
        } else {
          msg += `• *${f.label}* — ❌ not found in DB\n`;
        }
      }

      msg += `\n*Total Cost:* ${fmt(totalCost)}`;
      msg += `\n*Target Buy:* ${fmt(bundle.targetCost)}`;
      msg += `\n*Resale Value:* ${fmt(bundle.resaleValue)}`;
      msg += `\n*Estimated Profit:* ${fmt(Math.max(0, estimatedProfit))}`;
      if (fullyViable) msg += `\n*Margin:* ${margin}%`;
      msg += `\n\n_${bundle.narrative}_`;

      // Same-seller detection
      const sellerMsg = detectSameSeller(found);
      if (sellerMsg) msg += `\n${sellerMsg}`;

      // AI analysis for viable or near-viable bundles
      if (fullyViable || partialCount >= Math.ceil(found.length * 0.5)) {
        try {
          const analysis = await analyzeBundle(bundle.name, found);
          if (analysis) {
            msg += `\n\n🤖 *AI Analysis:*\n${analysis.assessment}`;
          }
        } catch (err) {
          console.warn('AI analysis skipped:', err.message);
        }
      }

      await sendTelegram(msg);
    } else {
      // ── Concise format ──
      const status = fullyViable ? '✅' : '⚠️';
      let msg = `${status} *${bundle.name}* — ${fmt(totalCost)} total → ${fmt(bundle.resaleValue)} resale (${margin}% margin)\n`;
      const parts = found
        .map(f => {
          if (!f.item) return `❌ ${f.label}`;
          const cond = condLabel(f.item.condition);
          return `${f.label} ${fmt(f.item.price)}${cond ? ` [${cond}]` : ''}`;
        })
        .join(' • ');
      msg += `  • ${parts}`;

      // Same-seller detection
      const sellerMsg = detectSameSeller(found);
      if (sellerMsg) msg += `\n${sellerMsg}`;

      await sendTelegram(msg);
    }

    console.log(`Sent bundle report: ${bundle.name}`);
  }
}

function detectSameSeller(found) {
  const sellerCounts = {};
  for (const f of found) {
    if (f.item?.seller_username) {
      if (!sellerCounts[f.item.seller_username]) sellerCounts[f.item.seller_username] = 0;
      sellerCounts[f.item.seller_username]++;
    }
  }
  const msgs = [];
  for (const [seller, count] of Object.entries(sellerCounts)) {
    if (count >= 2) {
      msgs.push(`⚡ ${count} items from same seller: "${seller}" — potential combo shipping`);
    }
  }
  return msgs.length > 0 ? msgs.join('\n') : null;
}

// ── Top 5 per category ─────────────────────────────────────────────────────

async function sendTop5ByCategory(items, detailed = false) {
  const byTerm = {};
  for (const item of items) {
    const term = item.search_term || 'Unknown';
    if (!byTerm[term]) byTerm[term] = [];
    byTerm[term].push(item);
  }

  let msg = '*Top 5 Cheapest Deals by Category*\n\n';
  let count = 0;

  for (const [term, termItems] of Object.entries(byTerm)) {
    // Dedup by ebay_item_id (or URL as fallback)
    const seen = new Set();
    const deduped = termItems.filter(item => {
      const key = item.ebay_item_id || item.url;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const top5 = deduped.slice(0, 5);

    msg += `*${term}*\n`;
    top5.forEach((item, i) => {
      const cond = condLabel(item.condition);
      if (detailed) {
        msg += `${i + 1}. ${fmt(item.price)}${cond ? ` [${cond}]` : ''} — ${item.title}\n`;
        if (item.seller_username) msg += `   Seller: ${item.seller_username}\n`;
        if (item.url) msg += `   ${item.url}\n`;
      } else {
        msg += `${i + 1}. ${fmt(item.price)}${cond ? ` [${cond}]` : ''} — ${item.title.slice(0, 60)}\n`;
      }
    });
    msg += '\n';
    count++;

    if (msg.length > 3500) {
      await sendTelegram(msg);
      msg = '*Top 5 (continued)*\n\n';
    }
  }

  if (msg.length > 30) {
    await sendTelegram(msg);
  }
  console.log(`Sent top-5 deals across ${count} categories.`);
}

// ── Prospects ──────────────────────────────────────────────────────────────

async function sendProspects(items, detailed = false) {
  let hasProspects = false;

  for (const bundle of BUNDLE_DEFINITIONS) {
    const found = [];
    const missing = [];

    for (const comp of bundle.components) {
      const item = findCheapestMatch(items, comp.keywords, comp.exclude, comp.altKeywords);
      if (item) {
        found.push({ label: comp.label, item });
      } else {
        missing.push(comp.label);
      }
    }

    if (missing.length === 0 || found.length === 0) continue;

    hasProspects = true;
    const currentCost = found.reduce((sum, f) => sum + Number(f.item.price), 0);
    const remainingBudget = bundle.targetCost - currentCost;
    const pct = ((found.length / bundle.components.length) * 100).toFixed(0);

    let msg = `🎯 *PROSPECT: ${bundle.name}*\n`;
    msg += `📊 ${pct}% complete (${found.length}/${bundle.components.length} items)\n\n`;

    msg += `*Found:*\n`;
    for (const f of found) {
      const cond = condLabel(f.item.condition);
      msg += `  ✅ *${f.label}*\n`;
      msg += `     ${fmt(f.item.price)}${cond ? ` [${cond}]` : ''} — ${f.item.title}\n`;
      if (detailed && f.item.url) msg += `     ${f.item.url}\n`;
    }

    msg += `\n*Still Need:*\n`;
    for (const m of missing) {
      msg += `  ❌ ${m}\n`;
    }

    msg += `\n💰 Spent so far: ${fmt(currentCost)}`;
    msg += `\n💵 Budget remaining: ${fmt(Math.max(0, remainingBudget))}`;
    msg += `\n📈 Potential profit if completed: ${fmt(bundle.resaleValue - bundle.targetCost)}`;

    // Same-seller detection
    const sellerMsg = detectSameSeller(found);
    if (sellerMsg) msg += `\n${sellerMsg}`;

    await sendTelegram(msg);
    console.log(`Sent prospect: ${bundle.name}`);
  }

  if (!hasProspects) {
    await sendTelegram('🎯 *No partial bundle prospects right now.* All bundles are either complete or have no matching items.');
  }
}

// ── Market Intelligence ────────────────────────────────────────────────────

async function sendMarketReport(items, detailed = false) {
  if (items.length === 0) {
    await sendTelegram('📊 *No market data yet.* Run /scan first.');
    return;
  }

  // Category averages
  const byTerm = {};
  for (const item of items) {
    const term = item.search_term || 'Unknown';
    if (!byTerm[term]) byTerm[term] = [];
    byTerm[term].push(Number(item.price));
  }

  let msg = '📊 *Market Intelligence Report*\n\n';
  msg += `📦 *Total items tracked:* ${items.length}\n\n`;

  msg += '*Average Prices by Category:*\n';
  const categoryStats = [];
  for (const [term, prices] of Object.entries(byTerm)) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    categoryStats.push({ term, avg, min, max, count: prices.length });
  }

  // Sort by count (most items first)
  categoryStats.sort((a, b) => b.count - a.count);

  for (const cat of categoryStats.slice(0, 15)) {
    msg += `\n*${cat.term}* (${cat.count} items)\n`;
    msg += `  Avg: ${fmt(cat.avg)} | Low: ${fmt(cat.min)} | High: ${fmt(cat.max)}\n`;
  }

  // Best deals right now (cheapest 10 items overall)
  const cheapest = items.slice(0, 10);
  msg += '\n\n*🔥 Best Deals Right Now:*\n';
  cheapest.forEach((item, i) => {
    msg += `${i + 1}. ${fmt(item.price)} — ${item.title}\n`;
  });

  // Price distribution
  const under5 = items.filter(i => Number(i.price) < 5).length;
  const under10 = items.filter(i => Number(i.price) >= 5 && Number(i.price) < 10).length;
  const under20 = items.filter(i => Number(i.price) >= 10 && Number(i.price) < 20).length;
  const under50 = items.filter(i => Number(i.price) >= 20 && Number(i.price) < 50).length;
  const over50 = items.filter(i => Number(i.price) >= 50).length;

  msg += '\n\n*Price Distribution:*\n';
  msg += `  Under £5: ${under5}\n`;
  msg += `  £5-£10: ${under10}\n`;
  msg += `  £10-£20: ${under20}\n`;
  msg += `  £20-£50: ${under50}\n`;
  msg += `  Over £50: ${over50}\n`;

  await sendTelegram(msg);
  console.log('Sent market intelligence report.');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Sonic Bundle Report ===\n');

  console.log('Refreshing eBay data...');
  try {
    const tracking = require('./ebay-sales-tracking');
    await tracking.main();
  } catch (err) {
    console.warn('eBay refresh skipped (non-fatal):', err.message);
  }

  const db = openDb();
  const items = getAllItems(db);
  db.close();

  if (items.length === 0) {
    await sendTelegram('No items found in the database yet. Run an eBay scan first.');
    return;
  }

  console.log(`Loaded ${items.length} items from DB.`);

  await sendBundleReports(items);
  await sendTop5ByCategory(items);

  console.log('\n=== Report complete ===');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  main,
  sendBundleReports,
  sendTop5ByCategory,
  sendProspects,
  sendMarketReport,
  sendTelegram,
  sendTelegramPhoto,
  openDb,
  getAllItems,
  findCheapestMatch,
  BUNDLE_DEFINITIONS
};
