#!/bin/bash

# Automated Code Review Pre-Check Script
# Run this before submitting code for review

set -e

echo "🔍 Pre-Review Automated Checks"
echo "=============================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Function to run check
run_check() {
    local check_name="$1"
    local command="$2"
    local is_critical="$3"
    
    echo -n "  $check_name... "
    
    if eval "$command" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((PASSED++))
        return 0
    else
        if [ "$is_critical" = "true" ]; then
            echo -e "${RED}❌ FAIL${NC}"
            ((FAILED++))
            return 1
        else
            echo -e "${YELLOW}⚠️ WARN${NC}"
            ((WARNINGS++))
            return 0
        fi
    fi
}

# Function to check file content
check_content() {
    local check_name="$1"
    local pattern="$2"
    local files="$3"
    local should_find="$4"
    
    echo -n "  $check_name... "
    
    if [ "$should_find" = "true" ]; then
        # Should find pattern
        if grep -r "$pattern" $files >/dev/null 2>&1; then
            echo -e "${GREEN}✅ PASS${NC}"
            ((PASSED++))
        else
            echo -e "${RED}❌ FAIL${NC}"
            ((FAILED++))
        fi
    else
        # Should NOT find pattern
        if ! grep -r "$pattern" $files >/dev/null 2>&1; then
            echo -e "${GREEN}✅ PASS${NC}"
            ((PASSED++))
        else
            echo -e "${RED}❌ FAIL${NC}"
            echo "    Found: $(grep -r "$pattern" $files | head -3)"
            ((FAILED++))
        fi
    fi
}

echo -e "${BLUE}📋 Basic Checks${NC}"
run_check "Git repository exists" "test -d .git" true
# run_check "Git repository clean" "git diff --quiet && git diff --cached --quiet" false
# run_check "No uncommitted changes" "[ -z \"\$(git status --porcelain)\" ]" false
# run_check "On feature branch" "[ \"\$(git branch --show-current)\" != \"main\" ]" false
echo ""

echo -e "${BLUE}🧪 Code Quality${NC}"
run_check "ESLint passes" "npm run lint" true
run_check "Prettier formatting" "npm run format:check" true
run_check "All tests pass" "npm test" true
echo ""

echo -e "${BLUE}🔒 Security Checks${NC}"
run_check "Security audit clean" "npm run deps:security-audit" true
check_content "No console.log in production" "console\\.log" "server.js sources/ utils/ middleware/" false
check_content "No TODO comments" "TODO" "server.js sources/ utils/ middleware/" false
check_content "No hardcoded passwords" "password.*=.*[\"']" "server.js sources/ utils/ middleware/" false
echo ""

echo -e "${BLUE}📝 Code Structure${NC}"
run_check "No large files (>500KB)" "! find . -name '*.js' -size +500k -not -path './node_modules/*'" true
run_check "No long functions (>50 lines)" "! grep -A 50 'function\\|=>' server.js sources/ utils/ middleware/ | grep -B 50 '^}$' | wc -l | awk '{print (\$1 > 50)}' | grep -q 1" false

# Check for specific patterns
echo ""
echo -e "${BLUE}📊 Code Patterns${NC}"
check_content "Proper error handling present" "try.*catch\\|throw.*Error" "server.js sources/ utils/ middleware/" true
check_content "Input validation present" "validate\\|joi\\|schema" "server.js sources/ utils/ middleware/" true
check_content "No var declarations" "var " "server.js sources/ utils/ middleware/" false
echo ""

echo -e "${BLUE}📚 Documentation${NC}"
run_check "README.md exists" "test -f README.md" true
run_check "Function comments present" "grep -r '/\\*\\*\\|//' server.js sources/ utils/ middleware/" false
echo ""

echo -e "${BLUE}🧪 Test Coverage${NC}"
if run_check "Test files exist" "find __tests__ -name '*.test.js' | head -1" true; then
    # Count test files vs source files
    TEST_FILES=$(find __tests__ -name '*.test.js' | wc -l)
    SOURCE_FILES=$(find sources/ utils/ middleware/ -name '*.js' | wc -l)
    
    if [ $TEST_FILES -gt 0 ] && [ $SOURCE_FILES -gt 0 ]; then
        COVERAGE_RATIO=$((TEST_FILES * 100 / SOURCE_FILES))
        if [ $COVERAGE_RATIO -gt 70 ]; then
            echo -e "  Test coverage ratio... ${GREEN}✅ GOOD ($COVERAGE_RATIO%)${NC}"
            ((PASSED++))
        else
            echo -e "  Test coverage ratio... ${YELLOW}⚠️ LOW ($COVERAGE_RATIO%)${NC}"
            ((WARNINGS++))
        fi
    fi
fi
echo ""

# Summary
echo "=============================="
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${YELLOW}⚠️ Warnings: $WARNINGS${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 Ready for code review!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. git add ."
    echo "  2. git commit -m 'feat: your feature description'"
    echo "  3. git push origin \$(git branch --show-current)"
    echo "  4. Create Pull Request"
    echo ""
    echo "Review tips:"
    echo "  • Keep PR small (<400 lines)"
    echo "  • Write clear description"
    echo "  • Link to related issues"
    echo "  • Add screenshots if UI changes"
    exit 0
else
    echo -e "${RED}🚫 Please fix issues before submitting for review${NC}"
    echo ""
    echo "Common fixes:"
    echo "  • npm run lint:fix"
    echo "  • npm run format"
    echo "  • npm test"
    echo "  • Remove console.log statements"
    echo "  • Add error handling"
    exit 1
fi
