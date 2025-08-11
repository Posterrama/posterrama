#!/bin/bash

# Posterrama Promobox Site Status Checker
echo "🔍 Checking Posterrama Promobox Site Status..."
echo "============================================="

# Check main app
echo -n "Main App (port 4000): "
if curl -s --connect-timeout 3 http://localhost:4000/get-config >/dev/null 2>&1; then
    echo "✅ Running"
else
    echo "❌ Not responding"
fi

# Check promobox site
echo -n "Promobox Site (port 4001): "
if curl -s --connect-timeout 3 http://localhost:4001 >/dev/null 2>&1; then
    echo "✅ Running"
else
    echo "❌ Not running"
fi

# Check configuration
echo ""
echo "📋 Configuration Status:"
if [ -f "config.json" ]; then
    if grep -q '"siteServer"' config.json; then
        ENABLED=$(grep -A 3 '"siteServer"' config.json | grep '"enabled"' | grep -o 'true\|false')
        PORT=$(grep -A 3 '"siteServer"' config.json | grep '"port"' | grep -o '[0-9]\+')
        echo "   siteServer.enabled: $ENABLED"
        echo "   siteServer.port: $PORT"
        
        if [ "$ENABLED" = "true" ]; then
            echo "   ✅ Promobox site should be running"
        else
            echo "   ℹ️  Promobox site is disabled in config"
        fi
    else
        echo "   ⚠️  No siteServer configuration found"
    fi
else
    echo "   ❌ config.json not found"
fi

# Check ports in use
echo ""
echo "🌐 Network Status:"
echo "   Ports in use by posterrama:"
ss -tlnp 2>/dev/null | grep node | while read line; do
    PORT=$(echo "$line" | grep -o ':\([0-9]\+\)' | head -1 | cut -d: -f2)
    echo "   - Port $PORT: Active"
done

# Quick access URLs
echo ""
echo "🔗 Access URLs:"
IP=$(hostname -I | awk '{print $1}')
echo "   Main App: http://$IP:4000"
echo "   Admin: http://$IP:4000/admin"
echo "   Promobox: http://$IP:4001 (if enabled)"

echo ""
echo "💡 Tip: Enable the promobox site in Admin > Public Site Settings"
