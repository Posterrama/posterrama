#!/bin/bash
# Test script for mode change WebSocket broadcast
# Usage: ./test-mode-change.sh [screensaver|wallart|cinema]

TARGET_MODE="${1:-wallart}"

echo "=========================================="
echo "Testing Mode Change: Current -> $TARGET_MODE"
echo "=========================================="
echo ""

# Read current config
CURRENT_CONFIG=$(cat config.json)
CURRENT_ENV=$(cat .env | grep -v "^#" | grep "=" | awk -F= '{printf "\"%s\": \"%s\",\n", $1, $2}' | sed '$ s/,$//')

# Determine which flags to set
case "$TARGET_MODE" in
    screensaver)
        CINEMA_MODE="false"
        WALLART_ENABLED="false"
        echo "Setting: cinemaMode=false, wallartMode.enabled=false"
        ;;
    wallart)
        CINEMA_MODE="false"
        WALLART_ENABLED="true"
        echo "Setting: cinemaMode=false, wallartMode.enabled=true"
        ;;
    cinema)
        CINEMA_MODE="true"
        WALLART_ENABLED="false"
        echo "Setting: cinemaMode=true, wallartMode.enabled=false"
        ;;
    *)
        echo "Invalid mode: $TARGET_MODE (must be screensaver, wallart, or cinema)"
        exit 1
        ;;
esac

echo ""
echo "Step 1: Creating updated config..."

# Create modified config with jq
UPDATED_CONFIG=$(echo "$CURRENT_CONFIG" | jq --argjson cinema "$CINEMA_MODE" --argjson wallart "$WALLART_ENABLED" \
    '.cinemaMode = $cinema | .wallartMode.enabled = $wallart')

# Create request body
REQUEST_BODY=$(jq -n \
    --argjson config "$UPDATED_CONFIG" \
    --arg env "$CURRENT_ENV" \
    '{config: $config, env: {}}')

echo "Step 2: Using API token for authentication..."

# Use API token from test credentials
API_TOKEN=$(jq -r '.api.accessToken' private/test-credentials.json 2>/dev/null)

if [ -z "$API_TOKEN" ] || [ "$API_TOKEN" = "null" ]; then
    echo "❌ API token not found in private/test-credentials.json"
    exit 1
else
    echo "✅ API token loaded"
    AUTH_HEADER="-H \"Authorization: Bearer $API_TOKEN\""
fi

echo ""
echo "Step 3: Saving config to trigger mode change..."
echo ""

# Save config
SAVE_RESPONSE=$(curl -s -H "Authorization: Bearer $API_TOKEN" -X POST "http://localhost:4000/api/admin/config" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY")

echo "Response:"
echo "$SAVE_RESPONSE" | jq '.' 2>/dev/null || echo "$SAVE_RESPONSE"

echo ""
echo "Step 4: Checking PM2 logs for mode change detection..."
echo ""

sleep 1

pm2 logs posterrama --lines 30 --nostream 2>&1 | grep -i "mode change\|broadcast\|mode.navigate" | tail -15

echo ""
echo "=========================================="
echo "Test complete!"
echo "=========================================="
echo ""
echo "Expected logs:"
echo "  [Admin API] Mode change detection"
echo "  [Admin API] Display mode changed, will broadcast navigation"
echo "  [WS] Broadcasting mode.navigate"
echo "  [WS] Broadcast mode.navigate completed"
echo ""
