# Sonic Bot v3.0 — Shrine Pipeline

> **Current Status:** 10 bundles ready, waiting for eBay OAuth (DNS blocker)

## Live Deployment

- **Bot:** @ChaosEmeraldTypeBot (Telegram)
- **Location:** Droplet 178.62.45.130 at `/opt/molteesha/data/workspace/Sonic-Bundle-Bot`
- **Process:** Running inside `openclaw-gateway` Docker container
- **Logs:** `docker logs openclaw-gateway --tail 50` or `logs/bot.log`
- **Database:** SQLite (better-sqlite3) at `sonic-bot.db` — NOT MongoDB

## Architecture

### 6 Autonomous Agents (Hourly Cron)
1. **Sourcer** — eBay Browse API v2, 27 search queries, feeds items table
2. **Validator** — Quality checks (condition, price, shipping, seller rating)
3. **Bundler** — Shrine algorithm, 6 bundle tiers, creates bundles
4. **Creative** — AI image generation (Claude Artifacts), bundle visuals
5. **Lister** — eBay Trading API, auto-list (BLOCKED by OAuth)
6. **Guardian** — Monitor, alert, health checks

### Bundle Tiers
1. **Starter Pair** ($80-150) — 2 plushies, beginner-friendly
2. **Hero Team** ($200-350) — Sonic + Tails + Knuckles, iconic trio
3. **Shadow Rivals** ($300-500) — Shadow + Rouge + Omega, edgy set
4. **Complete Team** ($500-800) — 5-7 characters, collection builder
5. **Grail Display** ($800-1500) — rare + exclusive, centerpiece
6. **Lot Flip** ($1500+) — arbitrage bundle, reseller target

### eBay Search Queries (27 Total)
- 9 plush queries (Sonic, Tails, Knuckles, Shadow, Rouge, Omega, Amy, Silver, Metal Sonic)
- 9 figure queries (same characters)
- 9 collectible queries (same characters)
- Filters: New condition (1000/1500), Buy It Now, US sellers, price ranges

## Database Schema (SQLite)

### `items` Table
```sql
CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    ebay_item_id TEXT,
    price REAL NOT NULL,
    condition TEXT,
    platform TEXT DEFAULT 'ebay',
    seller_name TEXT,
    seller_score INTEGER,
    image_url TEXT,
    item_url TEXT,
    shipping_cost REAL DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(title, platform, price, timestamp)
);
```

### `bundles` Table
```sql
CREATE TABLE bundles (
    id INTEGER PRIMARY KEY,
    tier TEXT NOT NULL, -- 'starter_pair', 'hero_team', etc.
    items TEXT NOT NULL, -- JSON array of item IDs
    total_cost REAL NOT NULL,
    suggested_price REAL NOT NULL,
    profit_margin REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    listed_at DATETIME,
    sold_at DATETIME
);
```

### `watched_items` Table
```sql
CREATE TABLE watched_items (
    id INTEGER PRIMARY KEY,
    ebay_item_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    initial_price REAL NOT NULL,
    current_price REAL NOT NULL,
    times_seen INTEGER DEFAULT 1,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `bundle_viability` Table
```sql
CREATE TABLE bundle_viability (
    id INTEGER PRIMARY KEY,
    config TEXT NOT NULL, -- JSON: characters, tier, constraints
    avg_cost REAL,
    min_cost REAL,
    max_cost REAL,
    available_items INTEGER,
    last_check DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `auth_tokens` Table
```sql
CREATE TABLE auth_tokens (
    id INTEGER PRIMARY KEY,
    platform TEXT UNIQUE NOT NULL, -- 'ebay'
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**IMPORTANT:** `auth_tokens` is currently EMPTY — lister agent blocked until OAuth completes.

## Current Blocker: eBay OAuth

### What's Needed
1. **DNS A Record:** `sonic-auth.sskmusic.com` → `178.62.45.130`
2. **SSL Certificate:** Let's Encrypt via Nginx (after DNS propagates)
3. **eBay RuName:** Register redirect URI in eBay developer console
4. **OAuth Flow:** 3-legged auth → save tokens to `auth_tokens` table
5. **Lister Unblock:** Agent checks auth before listing, currently skips all listings

### OAuth Setup (Ready to Deploy)
- **Nginx config:** `/etc/nginx/sites-available/sonic-auth`
- **Node.js auth server:** `oauth/server.js` (port 3000)
- **Redirect URI:** `https://sonic-auth.sskmusic.com/ebay/callback`
- **Scopes:** `https://api.ebay.com/oauth/api_scope/sell.inventory`

## Commands (Telegram)

- `/scan` — Manual eBay scan, full detailed report
- `/report` — Latest scan summary
- `/prospects` — Top bundle opportunities
- `/top5` — Best deals by tier
- `/market` — Market analysis (avg prices, availability)
- `/setinterval <hours>` — Change auto-scan frequency (default: 6h)
- `/status` — Bot health, DB stats, last scan time
- `/help` — Command reference

## Auto-Scan Behavior

- **Frequency:** Every 6 hours (4x daily) — configurable via `/setinterval`
- **Output:** Brief summary only (count + top 3 cheapest per query)
- **Rationale:** Reduce token usage on droplet, full reports on-demand via `/scan`

## Environment Variables (Droplet)

```bash
EBAY_APP_ID=<eBay client ID>
EBAY_CERT_ID=<eBay client secret>
TELEGRAM_BOT_TOKEN=<@ChaosEmeraldTypeBot token>
TELEGRAM_CHAT_ID=<Shadow's Telegram chat ID>
CLAUDE_API_KEY=<Anthropic API key>
```

## File Structure

```
Sonic-Bundle-Bot/
├── sonic-bot.js (main entry, Telegram bot)
├── lib/
│   ├── ebay-browse-api.js (27 search queries)
│   ├── ebay-sales-tracking.js (watcher + viability)
│   ├── bundle-builder.js (shrine algorithm)
│   └── database.js (SQLite wrapper)
├── agents/
│   ├── sourcer.js (eBay scan runner)
│   ├── validator.js (quality filter)
│   ├── bundler.js (tier logic)
│   ├── creative.js (AI image gen)
│   ├── lister.js (OAuth blocker)
│   └── guardian.js (monitoring)
├── cron/
│   └── agent-runner.sh (hourly systemd timer)
├── oauth/
│   └── server.js (eBay 3-legged auth)
├── logs/
│   └── bot.log (stdout/stderr from container)
└── sonic-bot.db (SQLite database)
```

## Key Implementation Details

### Browse API v2 (NOT Scraping)
- **Why:** Playwright fails on eBay (JS-heavy SPA, anti-bot)
- **How:** Direct HTTP REST API, OAuth App token
- **Rate Limit:** 5,000 calls/day (plenty for 27 queries × 4 scans)

### Shrine Algorithm
```javascript
// Tier matching rules
const TIERS = {
  starter_pair: { min: 2, max: 2, budget: [80, 150] },
  hero_team: { min: 3, max: 3, budget: [200, 350], chars: ['sonic', 'tails', 'knuckles'] },
  shadow_rivals: { min: 3, max: 3, budget: [300, 500], chars: ['shadow', 'rouge', 'omega'] },
  complete_team: { min: 5, max: 7, budget: [500, 800] },
  grail_display: { min: 3, max: 5, budget: [800, 1500], rarity: 'high' },
  lot_flip: { min: 8, max: 15, budget: [1500, 5000], profit: 0.4 }
};
```

### Image Generation
- **Tool:** Claude Artifacts API (via Anthropic SDK)
- **Prompt Template:** "Create a shrine display image featuring [characters]. Style: collector aesthetic, soft lighting, plush arrangement."
- **Output:** SVG → PNG conversion, stored in `assets/bundles/`

## Deployment Commands

### Start Bot (Manual)
```bash
ssh root@178.62.45.130
docker exec -it openclaw-gateway bash
cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot
node sonic-bot.js
```

### Start Bot (Production — Already Running)
```bash
# Bot runs as background process in container
# Managed by OpenClaw gateway lifecycle
docker logs openclaw-gateway --tail 50 -f
```

### Trigger Agent Run (Manual)
```bash
docker exec openclaw-gateway bash -c "cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot/agents && node sourcer.js"
```

### Check Database
```bash
docker exec openclaw-gateway bash -c "cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot && sqlite3 sonic-bot.db 'SELECT COUNT(*) FROM items;'"
```

## Troubleshooting

### Bot Not Responding
1. Check container: `docker ps | grep openclaw`
2. Check logs: `docker logs openclaw-gateway --tail 100`
3. Restart container: `docker restart openclaw-gateway`

### Agents Not Running
1. Check cron: `systemctl status sonic-agent-runner.timer`
2. Check last run: `ls -lt /opt/molteesha/data/workspace/Sonic-Bundle-Bot/logs/`
3. Manual trigger: `docker exec openclaw-gateway bash -c "cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot/agents && bash agent-runner.sh"`

### OAuth Flow Fails
1. Verify DNS: `nslookup sonic-auth.sskmusic.com` (should return 178.62.45.130)
2. Check Nginx: `nginx -t && systemctl status nginx`
3. Check SSL cert: `certbot certificates`
4. Test redirect: `curl -I https://sonic-auth.sskmusic.com`

### Database Locked
```bash
# Find process holding lock
docker exec openclaw-gateway bash -c "lsof /home/node/.openclaw/workspace/Sonic-Bundle-Bot/sonic-bot.db"
# Kill stale connections
pkill -f sonic-bot.js
```

## Next Steps (After OAuth)

1. **List 10 Bundles** — Lister agent auto-lists to eBay
2. **Monitor Sales** — Guardian tracks views/watchers/bids
3. **Replenish Stock** — Sourcer refills depleted tiers
4. **Expand Characters** — Add Blaze, Big, Cream (9 more queries)
5. **Multi-Platform** — Add Mercari, OfferUp, Facebook Marketplace
6. **Analytics Dashboard** — Web UI for bundle performance

## Related Files

- **Local Source:** `C:\Users\Shadow\Sonic-Bundle-Bot\`
- **Memory Docs:** `~/.claude/memory/session-2026-04-17.md` (shrine pipeline notes)
- **Agent Meetings:** `/agent-meeting/meetings/` (coordination logs)

---

*Last Updated: 2026-04-20*
*Read by Claude Code when working in this directory*
