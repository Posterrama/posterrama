#!/bin/bash
# Posterrama Production Deployment Script
# Restarts PM2 with production environment

set -e  # Exit on error

echo "🚀 Posterrama Production Deployment"
echo "===================================="
echo ""

# Check if in correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Run this script from the project root."
    exit 1
fi

# Step 1: Stop PM2 process
echo "🛑 Step 1: Stopping PM2 process..."
pm2 stop posterrama 2>/dev/null || echo "⚠️  posterrama not running"
echo ""

# Step 2: Start PM2 with production environment
echo "🚀 Step 2: Starting PM2 in production mode..."
pm2 delete posterrama 2>/dev/null || true  # Delete old process
pm2 start ecosystem.config.js

if [ $? -ne 0 ]; then
    echo "❌ PM2 start failed!"
    exit 1
fi

echo "✅ PM2 started successfully!"
echo ""

# Step 3: Save PM2 configuration
echo "💾 Step 3: Saving PM2 configuration..."
pm2 save

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📍 Useful commands:"
echo "   pm2 logs posterrama    - View logs"
echo "   pm2 status             - Check status"
echo "   pm2 monit              - Monitor resources"
echo "   pm2 restart posterrama - Restart app"
echo ""
echo "🌐 App should be running on port 4000"
echo "   Check: http://localhost:4000"
