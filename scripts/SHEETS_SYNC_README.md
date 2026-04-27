# Sonic Bot Bundles → Google Sheets Sync

Automatically syncs shrine bundle data from SQLite DB to Google Sheets.

## Setup

### 1. Install Dependencies

**On droplet (inside container):**

```bash
ssh root@178.62.45.130
docker exec -it openclaw-gateway bash
cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot
npm install googleapis
exit
```

### 2. Verify Service Account Key

The key should already exist on the droplet at:

```
/opt/claudisha/claude-telegram-relay/scripts/molteesha-sa-key.json
```

Verify:

```bash
ssh root@178.62.45.130
ls -la /opt/claudisha/claude-telegram-relay/scripts/molteesha-sa-key.json
```

If missing, download from Command Center dashboard or regenerate in GCP.

### 3. Create Google Sheet

1. Go to https://sheets.google.com
2. Create a new spreadsheet
3. Name it "Sonic Bundle Tracker" (or anything you want)
4. Create a tab/sheet named **"Sonic Bundles"** (matches `CONFIG.SHEET_NAME` in the script)
5. Copy the Sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
   ```
6. Share the sheet with the service account email:
   - Click "Share" button
   - Add: `molteesha-reporter@blackwidow-467921.iam.gserviceaccount.com`
   - Give **Editor** access

### 4. Configure Sheet ID on Droplet

```bash
ssh root@178.62.45.130
cat >> /opt/molteesha/data/workspace/Sonic-Bundle-Bot/.env << 'EOF'
SONIC_BUNDLES_SHEET_ID=your-sheet-id-here
EOF
```

## Usage

### Run Once (Test)

```bash
ssh root@178.62.45.130
docker exec openclaw-gateway bash -c "cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot && node scripts/sync-bundles-to-sheets.js"
```

### Run on Schedule (Cron)

Add to droplet crontab:

```bash
ssh root@178.62.45.130
crontab -e

# Add this line (runs every 6 hours)
0 */6 * * * docker exec openclaw-gateway bash -c "cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot && node scripts/sync-bundles-to-sheets.js" >> /var/log/sonic-sheets-sync.log 2>&1
```

## Output Columns

| Column | Description |
|--------|-------------|
| Bundle ID | Unique bundle identifier |
| Name | "{Character} Shrine Bundle" |
| Character | Sonic, Shadow, Tails, etc. |
| Total Cost | Sum of all component prices |
| List Price | 40% markup target price |
| Margin% | Profit margin percentage |
| Status | ready/pending/listed/paused |
| Created | Date bundle was created |
| Components | Comma-separated list of items |
| Sourcer | ✅ if components were sourced |
| Validator | ✅ (X/Y) if components validated |
| Bundler | ✅ if bundle created |
| Creative | ✅ if hero image generated |
| Lister | ✅ (eBay ID) if listed |
| Guardian | ✅ if monitoring active |

## Pipeline Status Legend

- **Sourcer:** Always ✅ if bundle exists (components were found)
- **Validator:** ✅ (X/Y) where X = validated, Y = total components
- **Bundler:** Always ✅ if bundle exists
- **Creative:** ✅ if `hero_image_path` is not null
- **Lister:** ✅ (eBay listing ID) if `ebay_listing_id` is not null
- **Guardian:** ✅ if bundle is listed (monitoring active)

## Data Source

**Location:** `Sonic-Bundle-Bot/data/sonic_tracker.db` (SQLite)

**Tables:**
- `shrine_bundles` - Bundle metadata (character, costs, status)
- `shrine_components` - Items in each bundle
- `sourced_items` - All items found by sourcer agent

**Query:** Joins all three tables to build complete bundle data

Example data flow:
```
sourcer → sourced_items → validator → shrine_components → bundler → shrine_bundles
                                                                     ↓
                                                                  creative
                                                                     ↓
                                                                   lister
                                                                     ↓
                                                                  guardian
```

## Troubleshooting

### Error: Database not found

Verify the DB exists:

```bash
ssh root@178.62.45.130
docker exec openclaw-gateway ls -la /home/node/.openclaw/workspace/Sonic-Bundle-Bot/data/sonic_tracker.db
```

If missing, the Sonic Bot may not have run yet. Start it first.

### Error: Service account key not found

Check the key exists on the droplet:

```bash
ssh root@178.62.45.130
ls -la /opt/claudisha/claude-telegram-relay/scripts/molteesha-sa-key.json
```

If missing, copy from Command Center or regenerate in GCP.

### Error: SHEET_ID not configured

Set the environment variable in the bot's `.env` file (see Setup step 4).

### Error: Sheet tab not found

Make sure the sheet has a tab named **"Sonic Bundles"** (matches `CONFIG.SHEET_NAME`).

### Error: Permission denied

Ensure the sheet is shared with `molteesha-reporter@blackwidow-467921.iam.gserviceaccount.com` with Editor access.

### No bundles found

The sourcer/bundler agents may not have run yet. Check:

```bash
ssh root@178.62.45.130
docker exec openclaw-gateway sqlite3 /home/node/.openclaw/workspace/Sonic-Bundle-Bot/data/sonic_tracker.db "SELECT COUNT(*) FROM shrine_bundles"
```

If 0, run the bundler agent manually:

```bash
# Inside Telegram bot
/runagent bundler
```

## Manual Testing

```bash
# SSH to droplet
ssh root@178.62.45.130

# Run the sync script
docker exec openclaw-gateway bash -c "cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot && SONIC_BUNDLES_SHEET_ID='your-sheet-id' node scripts/sync-bundles-to-sheets.js"
```

Expected output:
```
═══════════════════════════════════════════════
  Sonic Bot Bundles → Google Sheets Sync
═══════════════════════════════════════════════

📂 Loading bundles from data/sonic_tracker.db...
   Found 11 bundles
   ✅ Loaded 11 bundles with components
🔑 Authenticating with service account...
   ✅ Authenticated
📊 Writing 11 bundles to Google Sheets...
   Sheet ID: 1AbC...
   Sheet Name: Sonic Bundles
   🧹 Cleared existing data
   ✅ Wrote 12 rows (including header)
   🎨 Formatted header row

✅ Sync complete!
   Bundles synced: 11
   View sheet: https://docs.google.com/spreadsheets/d/.../edit
```

## Integration with Agent Workflow

The sync runs independently but reflects the full pipeline status:

1. **Sourcer** runs every 6h → finds items → inserts to `sourced_items`
2. **Validator** runs every 2h → validates items → updates `shrine_components`
3. **Bundler** runs every 6h → creates bundles → inserts to `shrine_bundles`
4. **Creative** runs every 6h → generates images → updates `hero_image_path`
5. **Lister** runs every 6h → publishes to eBay → updates `ebay_listing_id`
6. **Guardian** runs every 1h → monitors listings → checks prices

**Sheets sync** runs every 6h and shows the current state of all pipelines.
