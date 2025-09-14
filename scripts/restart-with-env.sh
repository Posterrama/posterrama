#!/bin/bash
# Helper script to restart PM2 with fresh environment variables
# Usage: ./scripts/restart-with-env.sh

echo "🔄 Restarting Posterrama with fresh environment variables..."

# Method 1: Delete and restart (most reliable)
echo "📋 Stopping PM2 processes..."
pm2 delete posterrama 2>/dev/null || true

echo "🚀 Starting with fresh environment..."
pm2 start ecosystem.config.js

echo "✅ PM2 restart complete!"
echo "📊 Process status:"
pm2 list

echo ""
echo "🔍 Environment check:"
pm2 env 0 | grep -E "JELLYFIN_API_KEY|PLEX_TOKEN" | sed 's/\(.\{20\}\).*/\1.../' || echo "No API keys found in PM2 env"

echo ""
echo "📝 Recent logs (last 10 lines):"
pm2 logs posterrama --lines 10 --nostream
