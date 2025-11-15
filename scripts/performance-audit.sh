#!/bin/bash
# Performance audit script using Lighthouse
# Runs performance audits on key pages and saves results

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/lighthouse-reports"
SERVER_URL="${SERVER_URL:-http://localhost:4000}"

# Get Puppeteer Chrome path
CHROME_PATH=$(node -e "const puppeteer = require('puppeteer'); console.log(puppeteer.executablePath());")
export CHROME_PATH

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Posterrama Performance Audit"
echo "================================"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if server is running
echo "📡 Checking if server is accessible..."
if ! curl -s "$SERVER_URL" > /dev/null; then
    echo -e "${RED}❌ Server not accessible at $SERVER_URL${NC}"
    echo "Please start the server with: pm2 start posterrama"
    exit 1
fi
echo -e "${GREEN}✅ Server is accessible${NC}"
echo ""

# Pages to audit
declare -a PAGES=(
    "admin:Admin Dashboard"
    "wallart:Wallart Mode"
    "cinema:Cinema Mode"
    "screensaver:Screensaver Mode"
    "login:Login Page"
)

# Lighthouse configuration
LIGHTHOUSE_FLAGS="--chrome-flags='--headless --no-sandbox --disable-gpu' --only-categories=performance,accessibility,best-practices,seo"

echo "🚀 Running Lighthouse audits..."
echo ""

for page_info in "${PAGES[@]}"; do
    IFS=':' read -r page_path page_name <<< "$page_info"
    
    echo -e "${YELLOW}📊 Auditing: $page_name ($SERVER_URL/$page_path)${NC}"
    
    # Run Lighthouse (use eval to properly handle flags with quotes)
    CHROME_PATH="$CHROME_PATH" npx lighthouse "$SERVER_URL/$page_path" \
        --output=json \
        --output=html \
        --output-path="$OUTPUT_DIR/lighthouse-$page_path" \
        --chrome-flags='--headless --no-sandbox --disable-gpu' \
        --only-categories=performance,accessibility,best-practices,seo \
        --quiet 2>&1 || echo "  Warning: Lighthouse execution had errors"
    
    # Extract scores from JSON report
    if [ -f "$OUTPUT_DIR/lighthouse-$page_path.report.json" ]; then
        echo -e "${GREEN}✅ Report saved: lighthouse-reports/lighthouse-$page_path.report.{json,html}${NC}"
        
        # Extract key metrics using jq if available
        if command -v jq &> /dev/null; then
            PERF_SCORE=$(jq -r '.categories.performance.score * 100 | floor' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            A11Y_SCORE=$(jq -r '.categories.accessibility.score * 100 | floor' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            BP_SCORE=$(jq -r '.categories."best-practices".score * 100 | floor' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            SEO_SCORE=$(jq -r '.categories.seo.score * 100 | floor' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            
            FCP=$(jq -r '.audits."first-contentful-paint".displayValue' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            LCP=$(jq -r '.audits."largest-contentful-paint".displayValue' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            TTI=$(jq -r '.audits.interactive.displayValue' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            TBT=$(jq -r '.audits."total-blocking-time".displayValue' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            CLS=$(jq -r '.audits."cumulative-layout-shift".displayValue' "$OUTPUT_DIR/lighthouse-$page_path.report.json")
            
            echo "  Performance: $PERF_SCORE/100"
            echo "  Accessibility: $A11Y_SCORE/100"
            echo "  Best Practices: $BP_SCORE/100"
            echo "  SEO: $SEO_SCORE/100"
            echo "  ---"
            echo "  FCP: $FCP"
            echo "  LCP: $LCP"
            echo "  TTI: $TTI"
            echo "  TBT: $TBT"
            echo "  CLS: $CLS"
        fi
    else
        echo -e "${RED}❌ Failed to generate report${NC}"
    fi
    
    echo ""
done

echo -e "${GREEN}✅ All audits complete!${NC}"
echo ""
echo "📄 Reports saved in: $OUTPUT_DIR"
echo ""
echo "📊 To view HTML reports:"
echo "  open $OUTPUT_DIR/lighthouse-admin.report.html"
echo ""
echo "📈 To compare with baseline:"
echo "  See docs/PERFORMANCE-BASELINE.md for expected scores"
echo ""
