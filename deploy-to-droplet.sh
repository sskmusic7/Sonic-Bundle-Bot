#!/bin/bash
# Deploy Sonic Bot v4.0 (Shrine Pipeline) to droplet
# Run: bash deploy-to-droplet.sh

DROPLET="root@178.62.45.130"
REMOTE_DIR="/opt/molteesha/data/workspace/Sonic-Bundle-Bot"

echo "=== Deploying Sonic Bot v4.0 (Shrine Pipeline) to droplet ==="

# 1. Copy core files
echo "Copying core files..."
scp sonic-bot.js "$DROPLET:$REMOTE_DIR/sonic-bot.js"
scp config.js "$DROPLET:$REMOTE_DIR/config.js"
scp package.json "$DROPLET:$REMOTE_DIR/package.json"
scp sonic-bundle-report.js "$DROPLET:$REMOTE_DIR/sonic-bundle-report.js"
scp sonic-bundle-report-remote.js "$DROPLET:$REMOTE_DIR/sonic-bundle-report-remote.js"
scp ebay-sales-tracking.js "$DROPLET:$REMOTE_DIR/ebay-sales-tracking.js"
scp ebay-auth.js "$DROPLET:$REMOTE_DIR/ebay-auth.js"
scp ebay-lister.js "$DROPLET:$REMOTE_DIR/ebay-lister.js"
scp ebay-watcher.js "$DROPLET:$REMOTE_DIR/ebay-watcher.js"
scp sonic-ai.js "$DROPLET:$REMOTE_DIR/sonic-ai.js"

# 2. Copy agents directory
echo "Copying agents..."
ssh "$DROPLET" "mkdir -p $REMOTE_DIR/agents"
scp agents/*.js "$DROPLET:$REMOTE_DIR/agents/"

# 3. Install dependencies inside Docker container
echo "Installing dependencies..."
ssh "$DROPLET" "docker exec openclaw-gateway bash -c 'cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot && npm install --production 2>&1'"

# 4. Kill any running bot process
echo "Stopping old bot..."
ssh "$DROPLET" "docker exec openclaw-gateway bash -c 'ps aux | grep sonic-bot | grep -v grep | awk \"{print \\\$2}\" | xargs -r kill'"

# 5. Start the new bot
echo "Starting Sonic Bot v4.0..."
ssh "$DROPLET" "docker exec -d openclaw-gateway bash -c 'cd /home/node/.openclaw/workspace/Sonic-Bundle-Bot && node sonic-bot.js >> logs/sonic-bot.log 2>&1'"

# 6. Verify
echo "Checking logs..."
sleep 3
ssh "$DROPLET" "docker exec openclaw-gateway tail -20 /home/node/.openclaw/workspace/Sonic-Bundle-Bot/logs/sonic-bot.log"

echo ""
echo "=== Deploy complete ==="
echo "Send /help to @ChaosEmeraldTypeBot to verify"
