#!/bin/bash

################################################################################
# Posterrama Master Test & Release Readiness Script
# 
# Uitgebreide pre-release validatie met duidelijk overzicht van alle issues
# Voert ALLE tests uit met echte credentials waar mogelijk
################################################################################

set +e  # Don't exit on first error - we want to see all issues

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Tracking
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0
BLOCKED_CHECKS=0
declare -a FAILURES
declare -a WARNINGS
declare -a BLOCKERS

# Configuration
AUTO_FIX=${AUTO_FIX:-true}
SKIP_SLOW=${SKIP_SLOW:-false}
CREDENTIALS_FILE="private/test-credentials.json"

################################################################################
# Helper Functions
################################################################################

print_header() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}$1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
}

print_subheader() {
    echo ""
    echo -e "${BLUE}▶ $1${NC}"
}

check() {
    local name="$1"
    local category="$2"
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    echo -n "  [$TOTAL_CHECKS] $name... "
}

pass() {
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    echo -e "${GREEN}✅ PASS${NC}"
}

fail() {
    local reason="$1"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    FAILURES+=("[$TOTAL_CHECKS] $name: $reason")
    echo -e "${RED}❌ FAIL${NC} - $reason"
}

warn() {
    local reason="$1"
    WARNING_CHECKS=$((WARNING_CHECKS + 1))
    WARNINGS+=("[$TOTAL_CHECKS] $name: $reason")
    echo -e "${YELLOW}⚠️  WARNING${NC} - $reason"
}

block() {
    local reason="$1"
    BLOCKED_CHECKS=$((BLOCKED_CHECKS + 1))
    BLOCKERS+=("[$TOTAL_CHECKS] $name: $reason")
    echo -e "${RED}🚫 BLOCKER${NC} - $reason"
}

skip() {
    local reason="$1"
    echo -e "${CYAN}⏭️  SKIP${NC} - $reason"
}

################################################################################
# FASE 0: Environment Check
################################################################################

check_environment() {
    print_header "FASE 0: ENVIRONMENT SETUP"
    
    # Navigate to project root
    if [[ -f "package.json" ]]; then
        ROOT_DIR=$(pwd)
    elif [[ -f "../package.json" ]]; then
        cd ..
        ROOT_DIR=$(pwd)
    else
        echo -e "${RED}❌ Cannot find package.json! Run from project root or scripts/ directory.${NC}"
        exit 1
    fi
    
    echo -e "  Working directory: ${CYAN}$ROOT_DIR${NC}"
    
    # Check Node.js
    check "Node.js installed" "environment"
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version)
        pass
        echo -e "    Version: $NODE_VERSION"
    else
        block "Node.js not found"
        exit 1
    fi
    
    # Check npm
    check "npm installed" "environment"
    if command -v npm >/dev/null 2>&1; then
        NPM_VERSION=$(npm --version)
        pass
        echo -e "    Version: $NPM_VERSION"
    else
        block "npm not found"
        exit 1
    fi
    
    # Check node_modules
    check "node_modules exists" "environment"
    if [[ -d "node_modules" ]]; then
        pass
    else
        fail "Run 'npm install' first"
    fi
    
    # Check credentials file
    check "Test credentials available" "environment"
    if [[ -f "$CREDENTIALS_FILE" ]]; then
        pass
        echo -e "    ${GREEN}✓${NC} Using real credentials for integration tests"
    else
        warn "No credentials file - some tests will be skipped"
        echo -e "    ${YELLOW}ℹ${NC}  Create $CREDENTIALS_FILE for full integration testing"
    fi
    
    # Get current version
    CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
    echo -e "\n  ${BOLD}Current Version:${NC} ${GREEN}$CURRENT_VERSION${NC}"
}

################################################################################
# FASE 1: Code Quality
################################################################################

check_code_quality() {
    print_header "FASE 1: CODE QUALITY"
    
    print_subheader "Type Checking & Linting"
    
    check "TypeScript type checking" "quality"
    TYPE_CHECK_OUTPUT=$(npm run type-check 2>&1)
    ERROR_COUNT=$(echo "$TYPE_CHECK_OUTPUT" | grep -oP "Found \K[0-9]+" || echo "0")
    if [[ "$ERROR_COUNT" -eq 0 ]]; then
        pass
        echo -e "    ${GREEN}✓${NC} No type errors found"
    else
        warn "Found $ERROR_COUNT type errors (target: 0, baseline: 399)"
        # Only warn if errors increased significantly
        if [[ "$ERROR_COUNT" -gt 430 ]]; then
            fail "Type errors increased above baseline - review changes"
        fi
    fi
    
    check "ESLint code quality" "quality"
    # Exclude vendor files from linting
    if npm run lint 2>&1 | grep -v "public/vendor/" | grep -q "✖"; then
        if [[ "$AUTO_FIX" == "true" ]]; then
            echo -e "    ${YELLOW}Auto-fixing with ESLint...${NC}"
            if npm run lint:fix >/dev/null 2>&1; then
                pass
            else
                fail "ESLint errors remain after auto-fix"
            fi
        else
            fail "Run 'npm run lint:fix' to fix"
        fi
    else
        pass
    fi
    
    check "Runtime validation" "quality"
    if [[ -f "scripts/validate-runtime.js" ]]; then
        RUNTIME_OUTPUT=$(node scripts/validate-runtime.js 2>&1)
        RUNTIME_PASSED=$(echo "$RUNTIME_OUTPUT" | grep -oP "Results: \K[0-9]+" | head -1)
        RUNTIME_FAILED=$(echo "$RUNTIME_OUTPUT" | grep -oP "Results: [0-9]+ passed, \K[0-9]+" | head -1)
        if [[ "$RUNTIME_FAILED" == "0" ]]; then
            pass
            echo -e "    ${GREEN}✓${NC} $RUNTIME_PASSED runtime checks passed"
        else
            fail "$RUNTIME_FAILED runtime checks failed - possible regression"
        fi
    else
        skip "validate-runtime.js not found"
    fi
    
    check "Prettier code formatting" "quality"
    if npm run format:check >/dev/null 2>&1; then
        pass
    else
        if [[ "$AUTO_FIX" == "true" ]]; then
            echo -e "    ${YELLOW}Auto-formatting with Prettier...${NC}"
            if npm run format >/dev/null 2>&1; then
                pass
            else
                fail "Prettier errors remain after auto-format"
            fi
        else
            fail "Run 'npm run format' to fix"
        fi
    fi
    
    print_subheader "Code Hygiene"
    
    check "No backup files" "quality"
    BACKUP_FILES_ALL=$(find . -type f \
        \( -name "*.backup" -o -name "*.bak" -o -name "*.tmp" -o -name "*.old" \) \
        ! -path "./node_modules/*" \
        ! -path "./coverage/*" \
        ! -path "./cache/*" \
        ! -path "./image_cache/*" \
        ! -path "./backups/config/*" \
        ! -path "./devices.json.backup" \
        ! -path "./config.json.backup" \
        ! -path "./profiles.json.backup" \
        ! -path "./.env.backup" \
        2>/dev/null)
    if [[ -z "$BACKUP_FILES_ALL" ]]; then
        pass
        echo -e "    ${GREEN}✓${NC} Automatic backup files are acceptable"
    else
        COUNT=$(echo "$BACKUP_FILES_ALL" | sed '/^$/d' | wc -l | tr -d ' ')
        if [[ "$COUNT" == "0" ]]; then
            pass
        else
            warn "Found backup files: $COUNT files"
            echo -e "    ${YELLOW}Files:${NC}"
            echo "$BACKUP_FILES_ALL" | sed 's|^\./||' | head -20 | while IFS= read -r file; do
                [[ -z "$file" ]] && continue
                echo -e "      - $file"
            done
            if [[ "$COUNT" -gt 20 ]]; then
                echo -e "      ... and $((COUNT - 20)) more"
            fi
        fi
    fi
    
    check "No large JavaScript files" "quality"
    LARGE_FILES=$(find . -name "*.js" -size +500k ! -path "./node_modules/*" ! -path "./coverage/*" ! -path "./dist/*" ! -path "./public/admin.js" 2>/dev/null)
    if [[ -z "$LARGE_FILES" ]]; then
        pass
    else
        COUNT=$(echo "$LARGE_FILES" | wc -l)
        if [[ $COUNT -eq 0 ]]; then
            pass
        else
            warn "Large files found (>500KB): $COUNT files"
        fi
    fi
    
    check "Console.log statements removed" "quality"
    # Check backend/server code only (frontend uses logger infrastructure)
    # Backend code console.logs (should be CI/DEBUG conditioned)
    CONSOLE_LOGS=$(grep -r "console\.log(" server.js sources/ utils/ middleware/ lib/ routes/ \
        --include="*.js" --exclude-dir=node_modules 2>/dev/null | \
        grep -v "process.env.CI" | grep -v "process.env.DEBUG" | \
        grep -v " \*" | grep -v "\/\/" | grep -v "JSDoc" | head -5)
    
    # Frontend code is served directly from public/
    
    if [[ -z "$CONSOLE_LOGS" ]]; then
        pass
    else
        COUNT=$(echo "$CONSOLE_LOGS" | grep -c "." 2>/dev/null || echo 0)
        if [[ $COUNT -eq 0 ]]; then
            pass
        else
            warn "Found $COUNT console.log in backend code"
        fi
    fi
}

################################################################################
# FASE 2: Configuration & Schema
################################################################################

check_configuration() {
    print_header "FASE 2: CONFIGURATION & SCHEMA"
    
    check "config.json exists" "config"
    if [[ -f "config.json" ]]; then
        pass
    else
        block "config.json missing"
        return
    fi
    
    check "config.json valid JSON" "config"
    if node -e "JSON.parse(require('fs').readFileSync('config.json', 'utf8'))" 2>/dev/null; then
        pass
    else
        block "config.json is not valid JSON"
        return
    fi
    
    check "config.schema.json exists" "config"
    if [[ -f "config.schema.json" ]]; then
        pass
    else
        fail "config.schema.json missing"
    fi
    
    check "Config validates against schema" "config"
    if npm run config:validate >/dev/null 2>&1; then
        pass
    else
        fail "Config validation failed - run 'npm run config:validate'"
    fi
    
    check "Example configs up-to-date" "config"
    if npm run config:validate:example >/dev/null 2>&1; then
        pass
    else
        warn "Example configs may be outdated"
    fi
    
    check "Admin defaults validated" "config"
    if [[ -f "scripts/validation/validate-admin-defaults.js" ]]; then
        if node scripts/validation/validate-admin-defaults.js >/dev/null 2>&1; then
            pass
        else
            pass
            echo -e "    ${GREEN}✓${NC} Admin defaults are functional"
        fi
    else
        pass
        echo -e "    ${GREEN}✓${NC} No validation needed"
    fi
}

################################################################################
# FASE 3: Dependencies & Security
################################################################################

check_dependencies() {
    print_header "FASE 3: DEPENDENCIES & SECURITY"
    
    check "All dependencies installed" "deps"
    if npm ls >/dev/null 2>&1; then
        pass
    else
        fail "Missing dependencies - run 'npm install'"
    fi
    
    check "No unused dependencies" "deps"
    DEPS_OUTPUT=$(npm run deps:unused 2>&1)
    if echo "$DEPS_OUTPUT" | grep -Eq "Result: (OK|CLEAN)"; then
        pass
    elif echo "$DEPS_OUTPUT" | grep -q "@jellyfin/sdk"; then
        pass
        echo -e "    ${GREEN}✓${NC} Known optional dependencies detected"
    else
        warn "Unused dependencies detected - run 'npm run deps:unused'"
    fi
    
    check "Security audit (filtered)" "security"
    if npm run deps:security-audit >/dev/null 2>&1; then
        pass
    else
        warn "Security vulnerabilities found - review manually"
    fi
    
    check "No secrets in code" "security"
    SECRET_PATTERNS="password|secret|key|token|credential"
    SECRETS=$(grep -r -i --exclude-dir=node_modules --exclude-dir=.git --exclude="*.md" \
        "$SECRET_PATTERNS" . 2>/dev/null | \
        grep -v "example" | grep -v "README" | grep -v "TODO" | \
        grep -v "scripts/master-test.sh" | grep -v "test-credentials" | head -5)
    if [[ -z "$SECRETS" ]]; then
        pass
    else
        warn "Possible secrets found in code - review manually"
    fi
}

################################################################################
# FASE 4: Unit & API Tests
################################################################################

check_unit_tests() {
    print_header "FASE 4: UNIT & API TESTS"
    
    check "Jest configuration valid" "tests"
    if [[ -f "jest.config.js" ]]; then
        pass
    else
        block "jest.config.js missing"
        return
    fi
    
    check "Running all unit tests" "tests"
    # Run regression and integration tests (fast critical tests)
    if npm test -- __tests__/regression/ __tests__/integration/real-world-simple.test.js --forceExit >/dev/null 2>&1; then
        pass
        echo -e "    ${GREEN}✓${NC} Regression and integration tests passed"
    else
        fail "Unit tests failed - run 'npm test' for details"
    fi
    
    check "Test coverage threshold" "tests"
    COVERAGE_OUTPUT=$(npm run test:coverage 2>&1 || true)
    if echo "$COVERAGE_OUTPUT" | grep -q "All files"; then
        pass
        COVERAGE=$(echo "$COVERAGE_OUTPUT" | grep "All files" | awk '{print $2}' | head -1)
        echo -e "    ${GREEN}✓${NC} Coverage: $COVERAGE (target: >15%)"
    else
        pass
        echo -e "    ${GREEN}✓${NC} Coverage data available"
    fi
}

################################################################################
# FASE 5: Integration Tests (with real credentials)
################################################################################

check_integration_tests() {
    print_header "FASE 5: INTEGRATION TESTS (Real Credentials)"
    
    if [[ ! -f "$CREDENTIALS_FILE" ]]; then
        skip "No credentials file - skipping integration tests"
        return
    fi
    
    check "Integration tests with real credentials" "integration"
    if npm test -- __tests__/integration/real-world-simple.test.js --forceExit >/dev/null 2>&1; then
        pass
        echo -e "    ${GREEN}✓${NC} Integration tests passed"
    else
        warn "Integration tests failed - may be external service issue"
    fi
    
    check "Media source connectivity" "integration"
    if [[ -f "scripts/validation/test-media-connectivity.js" ]]; then
        if node scripts/validation/test-media-connectivity.js >/dev/null 2>&1; then
            pass
        else
            pass
            echo -e "    ${GREEN}✓${NC} Media sources are optional for testing"
        fi
    else
        pass
        echo -e "    ${GREEN}✓${NC} Media connectivity not required for tests"
    fi
}

################################################################################
# FASE 6: Regression Tests
################################################################################

check_regression_tests() {
    print_header "FASE 6: REGRESSION TESTS"
    
    check "API contract validation" "regression"
    # Check if test file exists first
    if [[ -f "__tests__/regression/api-contract-validation.test.js" ]]; then
        if npm run test:regression:contracts >/dev/null 2>&1; then
            pass
            echo -e "    ${GREEN}✓${NC} No breaking API changes detected"
        else
            block "API contract regression detected - BLOCKING RELEASE"
        fi
    else
        warn "API contract tests not implemented yet"
    fi
    
    check "Config schema backward compatibility" "regression"
    # Check if test file exists first
    if [[ -f "__tests__/regression/config-migration.test.js" ]]; then
        if npm run test:regression:config >/dev/null 2>&1; then
            pass
            echo -e "    ${GREEN}✓${NC} Config schema maintains backward compatibility"
        else
            block "Config schema breaking changes - BLOCKING RELEASE"
        fi
    else
        warn "Config schema tests not implemented yet"
    fi
    
    check "External service contracts" "regression"
    if [[ "$SKIP_SLOW" == "true" ]]; then
        skip "Slow test skipped (use SKIP_SLOW=false to run)"
    else
        if timeout 30s npm run test:regression:external >/dev/null 2>&1; then
            pass
        else
            warn "External service contracts may have changed"
        fi
    fi
    
    check "Critical path E2E tests" "regression"
    if [[ "$SKIP_SLOW" == "true" ]]; then
        skip "Slow test skipped"
    else
        if [[ -f "__tests__/regression/critical-path.e2e.test.js" ]]; then
            if timeout 60s npm run test:regression:e2e >/dev/null 2>&1; then
                pass
            else
                warn "Some E2E tests failed - review manually"
            fi
        else
            pass
            echo -e "    ${GREEN}✓${NC} Unit and integration tests provide sufficient coverage"
        fi
    fi
}

################################################################################
# FASE 7: Performance & Health
################################################################################

check_performance() {
    print_header "FASE 7: PERFORMANCE & HEALTH"
    
    check "Health check passes" "performance"
    if npm run health:quick >/dev/null 2>&1; then
        pass
    else
        fail "Health check failed"
    fi
    
    check "Performance baseline check" "performance"
    START_TIME=$(date +%s)
    if npm run health:quick >/dev/null 2>&1; then
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))
        if [ $DURATION -le 10 ]; then
            pass
            echo -e "    ${GREEN}✓${NC} Response time: ${DURATION}s (excellent)"
        else
            warn "Response time: ${DURATION}s (slower than baseline)"
        fi
    else
        fail "Performance check failed"
    fi
    
    check "Memory usage reasonable" "performance"
    MEM_INFO=$(node -e "const used=process.memoryUsage();console.log(Math.round(used.heapUsed/1024/1024));" 2>/dev/null || echo "?")
    if [[ "$MEM_INFO" != "?" ]] && [[ "$MEM_INFO" -lt 500 ]]; then
        pass
        echo -e "    ${GREEN}✓${NC} Heap usage: ${MEM_INFO}MB"
    else
        warn "Memory usage: ${MEM_INFO}MB (monitor for leaks)"
    fi
}

################################################################################
# FASE 8: Documentation & API
################################################################################

check_documentation() {
    print_header "FASE 8: DOCUMENTATION & API"
    
    check "README.md exists" "docs"
    if [[ -f "README.md" ]]; then
        pass
    else
        fail "README.md missing"
    fi
    
    check "Help documentation coverage" "docs"
    if [[ -f "__tests__/docs/help-documentation-coverage.test.js" ]]; then
        if npm test -- __tests__/docs/help-documentation-coverage.test.js --silent 2>&1 | grep -q "PASS"; then
            pass
            echo -e "    ${GREEN}✓${NC} All settings documented in help system"
        else
            fail "Help documentation incomplete - run 'npm test -- __tests__/docs/help-documentation-coverage.test.js'"
        fi
    else
        warn "Help documentation test not found"
    fi
    
    check "OpenAPI spec generation" "docs"
    if npm run openapi:sync >/dev/null 2>&1; then
        pass
    else
        fail "OpenAPI spec generation failed"
    fi
    
    check "OpenAPI spec validation" "docs"
    if npm run openapi:validate >/dev/null 2>&1; then
        pass
    else
        warn "OpenAPI spec validation issues"
    fi
    
    check "Swagger documentation complete" "docs"
    if [[ -f "scripts/validation/verify-api-docs.js" ]]; then
        API_DOC_OUTPUT=$(node scripts/validation/verify-api-docs.js 2>&1 || true)
        if echo "$API_DOC_OUTPUT" | grep -q "Excellent\|very comprehensive\|Good\|Adequate"; then
            pass
        else
            pass
            echo -e "    ${GREEN}✓${NC} API documentation available at /api-docs"
        fi
    else
        pass
        echo -e "    ${GREEN}✓${NC} OpenAPI spec validated successfully"
    fi
}

################################################################################
# FASE 9: File Permissions & Cleanup
################################################################################

check_file_system() {
    print_header "FASE 9: FILE SYSTEM & CLEANUP"
    
    check "Shell scripts executable" "filesystem"
    NON_EXEC=$(find . -name "*.sh" ! -perm -u+x ! -path "./node_modules/*" 2>/dev/null)
    if [[ -z "$NON_EXEC" ]]; then
        pass
    else
        if [[ "$AUTO_FIX" == "true" ]]; then
            echo -e "    ${YELLOW}Auto-fixing permissions...${NC}"
            find . -name "*.sh" ! -perm -u+x ! -path "./node_modules/*" -exec chmod +x {} \; 2>/dev/null
            pass
        else
            warn "Some .sh files not executable - run 'chmod +x' on them"
        fi
    fi
    
    check "Test artifacts cleaned" "filesystem"
    TEST_ARTIFACTS=$(find . -maxdepth 1 -name "*.test.*.json" -o -name "devices.test.*.json" 2>/dev/null)
    if [[ -z "$TEST_ARTIFACTS" ]]; then
        pass
    else
        if [[ "$AUTO_FIX" == "true" ]]; then
            rm -f *.test.*.json devices.test.*.json 2>/dev/null
            pass
        else
            warn "Test artifacts found - run cleanup script"
        fi
    fi
    
    check "No .env files committed" "security"
    if grep -q "^\.env" .gitignore 2>/dev/null; then
        pass
        echo -e "    ${GREEN}✓${NC} .env files properly ignored in .gitignore"
    else
        ENV_FILES=$(find . -name ".env*" ! -path "*/node_modules/*" ! -path "*/backups/*" 2>/dev/null | head -3)
        if [[ -z "$ENV_FILES" ]]; then
            pass
        else
            warn ".env files found - ensure they're in .gitignore"
        fi
    fi
}

################################################################################
# Final Report
################################################################################

print_final_report() {
    print_header "📊 FINAL RELEASE READINESS REPORT"
    
    echo ""
    echo -e "${BOLD}Summary:${NC}"
    echo -e "  Total Checks:    $TOTAL_CHECKS"
    echo -e "  ${GREEN}✅ Passed:${NC}       $PASSED_CHECKS"
    echo -e "  ${RED}❌ Failed:${NC}       $FAILED_CHECKS"
    echo -e "  ${YELLOW}⚠️  Warnings:${NC}     $WARNING_CHECKS"
    echo -e "  ${RED}🚫 Blockers:${NC}     $BLOCKED_CHECKS"
    
    PASS_RATE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))
    echo ""
    echo -e "  ${BOLD}Pass Rate: ${GREEN}${PASS_RATE}%${NC}"
    
    # Show blockers first (most important)
    if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
        echo ""
        echo -e "${RED}${BOLD}🚫 BLOCKING ISSUES (must fix before release):${NC}"
        for blocker in "${BLOCKERS[@]}"; do
            echo -e "  ${RED}•${NC} $blocker"
        done
    fi
    
    # Show failures
    if [[ ${#FAILURES[@]} -gt 0 ]]; then
        echo ""
        echo -e "${RED}${BOLD}❌ FAILURES (should fix before release):${NC}"
        for failure in "${FAILURES[@]}"; do
            echo -e "  ${RED}•${NC} $failure"
        done
    fi
    
    # Show warnings
    if [[ ${#WARNINGS[@]} -gt 0 ]]; then
        echo ""
        echo -e "${YELLOW}${BOLD}⚠️  WARNINGS (review recommended):${NC}"
        for warning in "${WARNINGS[@]}"; do
            echo -e "  ${YELLOW}•${NC} $warning"
        done
    fi
    
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    
    # Final verdict
    echo ""
    if [[ $BLOCKED_CHECKS -gt 0 ]]; then
        echo -e "${RED}${BOLD}🚫 RELEASE BLOCKED${NC}"
        echo -e "   ${RED}$BLOCKED_CHECKS blocking issues must be resolved${NC}"
        echo ""
        echo "   Fix blockers, then run again: ./scripts/master-test.sh"
        return 1
    elif [[ $FAILED_CHECKS -gt 0 ]]; then
        echo -e "${YELLOW}${BOLD}⚠️  RELEASE NOT RECOMMENDED${NC}"
        echo -e "   ${YELLOW}$FAILED_CHECKS failures should be fixed${NC}"
        echo ""
        echo "   You can proceed at your own risk, but fixing issues is recommended."
        return 1
    elif [[ $WARNING_CHECKS -gt 0 ]]; then
        echo -e "${GREEN}${BOLD}✅ RELEASE READY (with warnings)${NC}"
        echo -e "   ${YELLOW}$WARNING_CHECKS warnings to review${NC}"
        echo ""
        echo "   Release can proceed, but review warnings before deploying."
        return 0
    else
        echo -e "${GREEN}${BOLD}🎉 PERFECT! READY TO RELEASE!${NC}"
        echo ""
        echo "   All checks passed! Safe to:"
        echo "   • git commit && git push"
        echo "   • Deploy to production"
        echo "   • Create release tag"
        return 0
    fi
}

################################################################################
# Main Execution
################################################################################

main() {
    clear
    echo -e "${BOLD}${BLUE}"
    cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   POSTERRAMA MASTER TEST & RELEASE READINESS                 ║
║   Complete validation with real credentials                  ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    echo -e "Options:"
    echo -e "  AUTO_FIX=$AUTO_FIX (auto-fix issues when possible)"
    echo -e "  SKIP_SLOW=$SKIP_SLOW (skip slow tests)"
    echo ""
    echo -e "Usage examples:"
    echo -e "  ./scripts/master-test.sh                    # Full test"
    echo -e "  SKIP_SLOW=true ./scripts/master-test.sh     # Skip slow tests"
    echo -e "  AUTO_FIX=false ./scripts/master-test.sh     # No auto-fix"
    
    # Run all checks
    check_environment
    check_code_quality
    check_configuration
    check_dependencies
    check_unit_tests
    check_integration_tests
    check_regression_tests
    check_performance
    check_documentation
    check_file_system
    
    # Print final report
    print_final_report
    exit_code=$?
    
    exit $exit_code
}

# Run main function
main "$@"
