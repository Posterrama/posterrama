#!/bin/bash

# Live Environment Smoke Test
# Quick check om te verifiëren dat de productie server correct werkt

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Target server
TARGET=${1:-"http://localhost:4000"}

echo -e "${BLUE}🚀 Live Environment Smoke Test${NC}"
echo "Target: $TARGET"
echo ""

# Function to test endpoint
test_endpoint() {
    local name="$1"
    local path="$2"
    local expected_status="${3:-200}"
    
    echo -n "  Testing $name... "
    
    response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$TARGET$path" 2>/dev/null)
    
    if [ "$response" = "$expected_status" ]; then
        echo -e "${GREEN}✅ $response${NC}"
        return 0
    else
        echo -e "${RED}❌ Got $response, expected $expected_status${NC}"
        return 1
    fi
}

# Function to test JSON response
test_json_endpoint() {
    local name="$1"
    local path="$2"
    local expected_field="$3"
    
    echo -n "  Testing $name... "
    
    response=$(curl -s --max-time 10 "$TARGET$path" 2>/dev/null)
    
    if echo "$response" | grep -q "\"$expected_field\""; then
        echo -e "${GREEN}✅ Valid JSON with '$expected_field'${NC}"
        return 0
    else
        echo -e "${RED}❌ Missing field '$expected_field' or invalid JSON${NC}"
        return 1
    fi
}

failures=0

echo "📋 Basic Connectivity:"
test_endpoint "Root page" "/" 200 || ((failures++))
test_endpoint "Admin page" "/admin.html" 200 || ((failures++))
echo ""

echo "🔌 API Endpoints:"
test_json_endpoint "Health check" "/api/health" "status" || ((failures++))
test_json_endpoint "Config endpoint" "/get-config" "config" || ((failures++))
test_json_endpoint "Posters endpoint" "/api/posters" "posters" || ((failures++))
echo ""

echo "📄 Static Assets:"
test_endpoint "Logo" "/logo.png" 200 || ((failures++))
test_endpoint "Admin CSS" "/admin.css" 200 || ((failures++))
test_endpoint "Admin JS" "/admin.js" 200 || ((failures++))
echo ""

echo "🎨 Display Modes:"
test_endpoint "Screensaver" "/screensaver.html" 200 || ((failures++))
test_endpoint "Wallart" "/wallart.html" 200 || ((failures++))
test_endpoint "Cinema" "/cinema.html" 200 || ((failures++))
echo ""

# Performance check
echo "⚡ Performance:"
echo -n "  Response time check... "
start=$(date +%s%N)
curl -s -o /dev/null "$TARGET/api/health" 2>/dev/null
end=$(date +%s%N)
duration=$(( (end - start) / 1000000 ))

if [ $duration -lt 100 ]; then
    echo -e "${GREEN}✅ ${duration}ms (excellent)${NC}"
elif [ $duration -lt 500 ]; then
    echo -e "${YELLOW}⚠️  ${duration}ms (acceptable)${NC}"
else
    echo -e "${RED}❌ ${duration}ms (slow)${NC}"
    ((failures++))
fi
echo ""

# Summary
echo "========================================"
if [ $failures -eq 0 ]; then
    echo -e "${GREEN}✅ ALL SMOKE TESTS PASSED${NC}"
    echo "Environment is healthy and ready"
    exit 0
else
    echo -e "${RED}❌ $failures SMOKE TESTS FAILED${NC}"
    echo "Environment may have issues"
    exit 1
fi
