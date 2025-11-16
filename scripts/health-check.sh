#!/bin/bash

# Project Health Check Script
# Run this script to verify all quality gates are passing

set -e

echo "🔍 Posterrama Project Health Check"
echo "=================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to run a check and report status
run_check() {
    local check_name="$1"
    local command="$2"
    local required="$3"
    
    echo -n "  $check_name... "
    
    if eval "$command" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PASS${NC}"
        return 0
    else
        if [ "$required" = "true" ]; then
            echo -e "${RED}❌ FAIL (REQUIRED)${NC}"
            return 1
        else
            echo -e "${YELLOW}⚠️ SKIP${NC}"
            return 0
        fi
    fi
}

# Function to run a check with output
run_check_with_output() {
    local check_name="$1"
    local command="$2"
    
    echo "  $check_name:"
    if eval "$command" 2>&1; then
        echo -e "    ${GREEN}✅ PASS${NC}"
        return 0
    else
        echo -e "    ${RED}❌ FAIL${NC}"
        return 1
    fi
}

echo -e "${BLUE}📋 Environment Checks${NC}"
run_check "Node.js installed" "node --version" true
run_check "npm installed" "npm --version" true
run_check "Git installed" "git --version" true
echo ""

echo -e "${BLUE}📦 Dependencies${NC}"
run_check "package.json exists" "test -f package.json" true
run_check "node_modules exists" "test -d node_modules" true
run_check "Dependencies up to date" "npm outdated --depth=0 | wc -l | grep -q '^0$'" false
echo ""

echo -e "${BLUE}⚙️ Configuration${NC}"
run_check "config.json exists" "test -f config.json" true
run_check "config.json valid" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"config.json\", \"utf8\"))'" true
echo ""

echo -e "${BLUE}🧹 Code Quality${NC}"
if run_check "ESLint configuration" "test -f .eslintrc.js || test -f .eslintrc.json" true; then
    run_check_with_output "Linting check" "npm run lint"
fi

if run_check "Prettier configuration" "test -f .prettierrc" true; then
    run_check_with_output "Formatting check" "npm run format:check"
fi
echo ""

echo -e "${BLUE}🧪 Testing${NC}"
run_check "Jest configuration" "test -f jest.config.js" true
if run_check "Test files exist" "find __tests__ -name '*.test.js' | head -1" true; then
    echo "  Running all tests..."
    if npm test >/dev/null 2>&1; then
        echo -e "    ${GREEN}✅ All tests PASS${NC}"
        
        # Get test summary
        TEST_OUTPUT=$(npm test 2>&1 | tail -5)
        echo "    $TEST_OUTPUT" | grep -E "(Tests:|Suites:)" | head -2 | sed 's/^/    /'
    else
        echo -e "    ${RED}❌ Tests FAIL${NC}"
        echo "    Run 'npm test' to see details"
        return 1
    fi
fi
echo ""

echo -e "${BLUE}🔒 Security${NC}"
run_check_with_output "Security audit (filtered, excluding accepted risks)" "npm run deps:security-audit"
echo ""

echo -e "${BLUE}🔧 Git Configuration${NC}"
run_check "Git repository" "test -d .git" true
run_check "Pre-commit hook" "test -f .git/hooks/pre-commit" true
run_check "GitHub workflows" "test -f .github/workflows/ci.yml" true
echo ""

echo -e "${BLUE}📖 Documentation${NC}"
run_check "README.md exists" "test -f README.md" true
echo ""

echo -e "${BLUE}🚀 Deployment Readiness${NC}"
run_check "No .env files committed" "! find . -name '.env*' -not -name '.env.example' -not -path './node_modules/*'" false
run_check "Large files check" "! find . -name '*.js' -size +500k -not -path './node_modules/*'" false
echo ""

echo "=================================="
echo -e "${GREEN}🎉 Health check completed!${NC}"
echo ""
echo "Next steps:"
echo "  • Run tests: npm test"
echo "  • Check security: npm run deps:security-audit"
echo "  • Full release check: npm run release:ready"
echo "  • Commit changes: git add . && git commit"
echo ""
# Documentation references disabled - guides not required for this project
# echo "For more information, see:"
# echo "  • docs/DEPENDENCY-MANAGEMENT.md"
# echo "  • docs/CODE-REVIEW-PROCESS.md"
echo ""
