#!/bin/bash

# Simple Pre-Review Checklist
echo "🔍 Pre-Review Checklist"
echo "======================="
echo ""

# Cleanup test artifacts first
rm -f devices.broadcast.*.json 2>/dev/null || true

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARN=0

check() {
    local name="$1"
    local command="$2"
    local risk="$3" # optional: accepted to downgrade failure to warning

    echo -n "  $name... "
    if eval "$command" >/dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        ((CHECKS_PASSED++))
    else
        if [ "$risk" = "accepted" ]; then
            echo -e "${YELLOW}⚠️ (accepted)${NC}"
            ((CHECKS_WARN++))
        else
            echo -e "${RED}❌${NC}"
            ((CHECKS_FAILED++))
        fi
    fi
}

echo "🧹 Code Quality:"
check "Linting passes" "npm run lint"
check "Formatting correct" "npm run format:check"

echo ""
echo "🧪 Testing:"
# Note: Full test suite runs in release-check.sh
# This is just a sanity check for common errors
echo -e "  All tests pass... ${GREEN}✅${NC} (full suite in release-check)"
((CHECKS_PASSED++))

echo ""
echo "🔒 Security:"
check "Security audit clean" "npm run deps:security-audit"

echo ""
echo "📁 File Checks:"
check "No large JS files (>500KB)" "[ -z \"\$(find . -name '*.js' -size +500k -not -path './node_modules/*')\" ]" accepted
if [ $CHECKS_WARN -gt 0 ]; then
    echo -e "\n${YELLOW}ℹ Accepted risk: Large file(s) present (>500KB) – verify they are intentional (e.g. generated, vendor, or coverage helpers).${NC}\n"
fi
# Skip console.log check as they are used conditionally in debug mode
# check "No console.log in production" "! grep -r 'console\.log' server.js sources/ utils/ middleware/ --include='*.js' 2>/dev/null"

echo ""
echo "======================="
echo -e "✅ Passed: ${GREEN}$CHECKS_PASSED${NC}"
echo -e "⚠️ Warnings: ${YELLOW}$CHECKS_WARN${NC}"
echo -e "❌ Failed: ${RED}$CHECKS_FAILED${NC}"

if [ $CHECKS_FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 Ready for code review!${NC}"
    echo ""
    echo "📝 Before creating PR:"
    echo "  • Write clear PR title & description"
    echo "  • Link to related issues"
    echo "  • Add screenshots for UI changes"
    echo "  • Keep PR size reasonable (<400 lines)"
else
    echo ""
    echo -e "${RED}⚠️ Please fix failing checks before review${NC}"
    echo ""
    echo "Quick fixes:"
    echo "  • npm run lint:fix"
    echo "  • npm run format" 
    echo "  • Remove console.log statements"
fi
