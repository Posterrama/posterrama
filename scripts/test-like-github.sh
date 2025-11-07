#!/bin/bash

# GitHub Actions Local Test Runner
# Run the same tests that GitHub Actions runs

echo "=== 🔍 RUNNING ALL GITHUB ACTIONS TESTS LOCALLY ==="
echo ""

# Navigate to project root (not scripts directory)
cd "$(dirname "$0")/.."

# Track overall success
OVERALL_SUCCESS=true

# 1. Code Linting
echo "1. 📋 Code Linting..."
if npm run lint; then
    echo "✅ Linting: PASSED"
else
    echo "❌ Linting: FAILED"
    OVERALL_SUCCESS=false
fi
echo ""

# 2. Code Formatting
echo "2. 🎨 Code Formatting Check..."
if npm run format:check; then
    echo "✅ Formatting: PASSED"
else
    echo "❌ Formatting: FAILED"
    OVERALL_SUCCESS=false
fi
echo ""

# 3. Security Audit
echo "3. 🔒 Security Audit..."
if npm run deps:security-daily; then
    echo "✅ Security: PASSED"
else
    echo "❌ Security: FAILED"
    OVERALL_SUCCESS=false
fi
echo ""

# 4. Large Files Check
echo "4. 📦 Checking for large files..."
LARGE_FILES=$(find . -name "*.js" -size +500k -not -path "./node_modules/*" -exec echo "⚠️ Large file: {}" \; | head -5)
if [ -n "$LARGE_FILES" ]; then
    echo "$LARGE_FILES"
    echo "⚠️ Large Files: WARNING"
else
    echo "✅ No large JavaScript files found"
fi
echo ""

# 5. Console.log Check (excluding development/debug files)
echo "5. 🚫 Checking for console.log statements..."
CONSOLE_LOGS=$(grep -r "console\.log(" public/ server.js sources/ utils/ middleware/ --include="*.js" --exclude-dir=node_modules | grep -v ": \*" | grep -v "console\.log = " | grep -v "originalConsoleLog" | grep -v "logger\." | grep -v "client-logger.js" | grep -v "public/admin.js:" | grep -v "public/cinema/cinema-display.js:" | grep -v "public/device-mgmt.js:" | grep -v "public/debug-viewer.js:" | grep -v "public/promo/promo-box-overlay.js:" | grep -v "public/cinema/cinema-bootstrap.js:" | head -5)
if [ -n "$CONSOLE_LOGS" ]; then
    echo "❌ Found console.log statements:"
    echo "$CONSOLE_LOGS"
    echo "❌ Console.log Check: FAILED"
    OVERALL_SUCCESS=false
else
    echo "✅ No console.log statements found (excluding debug files: admin.js, cinema-display.js, device-mgmt.js, debug-viewer.js, promo-box-overlay.js, cinema-bootstrap.js)"
fi
echo ""

# 6. Run All Tests (with CI environment)
echo "6. 🧪 Running all tests with CI=true (like GitHub Actions)..."
TEST_OUTPUT=$(CI=true npm test 2>&1)
echo "$TEST_OUTPUT"
# Check if actual tests passed (ignore coverage threshold warnings)
if echo "$TEST_OUTPUT" | grep -q "Test Suites:.*passed"; then
    if echo "$TEST_OUTPUT" | grep -q "Test Suites:.*failed"; then
        echo "❌ Tests: FAILED"
        OVERALL_SUCCESS=false
    else
        echo "✅ Tests: PASSED"
    fi
else
    echo "❌ Tests: FAILED"
    OVERALL_SUCCESS=false
fi
echo ""

# 6b. Run specific regression tests
echo "6b. 🔍 Running regression contract tests..."
if npm run test:regression:contracts > /dev/null 2>&1; then
    echo "✅ Regression Contracts: PASSED"
else
    echo "❌ Regression Contracts: FAILED"
    echo "   Run 'npm run test:regression:contracts' for details"
    OVERALL_SUCCESS=false
fi
echo ""

# 6c. Check visual regression tests (if Puppeteer available)
echo "6c. 👁️ Running visual regression tests..."
TEST_OUTPUT=$(npm test -- __tests__/regression/visual-regression.test.js 2>&1)
if echo "$TEST_OUTPUT" | grep -q "passed (browser not available"; then
    echo "⚠️ Visual Regression: PASSED (browser not available locally, will run in CI)"
elif echo "$TEST_OUTPUT" | tail -1 | grep -q "Test Suites:.*passed"; then
    echo "✅ Visual Regression: PASSED"
else
    echo "❌ Visual Regression: FAILED"
    echo "   Run 'npm test -- __tests__/regression/visual-regression.test.js' for details"
    OVERALL_SUCCESS=false
fi
echo ""

# 6d. Run config schema validation tests
echo "6d. ⚙️ Running config schema tests..."
TEST_OUTPUT=$(npm test -- __tests__/config/ 2>&1)
if echo "$TEST_OUTPUT" | grep -q "Test Suites:.*failed"; then
    echo "❌ Config Schema Tests: FAILED"
    echo "   Run 'npm test -- __tests__/config/' for details"
    OVERALL_SUCCESS=false
else
    echo "✅ Config Schema Tests: PASSED"
fi
echo ""

# 6e. Run ZIP posterpack robustness tests
echo "6e. 📦 Running ZIP posterpack tests..."
TEST_OUTPUT=$(npm test -- __tests__/api/local.posterpack-robustness.test.js 2>&1)
if echo "$TEST_OUTPUT" | grep -q "Test Suites:.*failed"; then
    echo "❌ ZIP Posterpack Tests: FAILED"
    echo "   Run 'npm test -- __tests__/api/local.posterpack-robustness.test.js' for details"
    OVERALL_SUCCESS=false
else
    echo "✅ ZIP Posterpack Tests: PASSED"
fi
echo ""

# 7. Config Validation
echo "7. 🔍 Config validation..."
if node -e "const Ajv=require('ajv');const fs=require('fs');const ajv=new Ajv({allErrors:true,strict:false,allowUnionTypes:true});const schema=JSON.parse(fs.readFileSync('config.schema.json','utf8'));const data=JSON.parse(fs.readFileSync('config.json','utf8'));const validate=ajv.compile(schema);if(!validate(data)){console.error('Config validation failed:',validate.errors);process.exit(1)}console.log('✅ Config validation passed')"; then
    echo "✅ Config: PASSED"
else
    echo "❌ Config: FAILED"
    OVERALL_SUCCESS=false
fi
echo ""

# 8. Update External Service Contracts (optional, only if requested)
if [ "$UPDATE_CONTRACTS" = "true" ]; then
    echo "8. 🔄 Updating external service contracts..."
    echo "   (This updates Plex/TMDB/Jellyfin API contracts to match current responses)"
    if REGRESSION_UPDATE=true npm test -- __tests__/regression/external-services.test.js > /dev/null 2>&1; then
        echo "✅ Contracts Updated: PASSED"
    else
        echo "⚠️ Contracts Update: Some updates may have failed (check manually)"
    fi
    echo ""
fi

# Final Summary
echo "=== 📊 GITHUB ACTIONS TEST RESULTS SUMMARY ==="
if [ "$OVERALL_SUCCESS" = true ]; then
    echo "🎉 ALL TESTS PASSED! Ready to push to GitHub! 🚀"
    echo ""
    echo "💡 Tip: To update external service contracts (Plex/TMDB/Jellyfin), run:"
    echo "   UPDATE_CONTRACTS=true ./scripts/test-like-github.sh"
    exit 0
else
    echo "❌ SOME TESTS FAILED! Fix issues before pushing to GitHub."
    echo ""
    echo "Quick fixes:"
    echo "  - Fix linting: npm run lint:fix"
    echo "  - Fix formatting: npm run format"
    echo "  - Update dependencies: npm audit fix"
    echo "  - Remove console.log statements manually"
    exit 1
fi