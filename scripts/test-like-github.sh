#!/bin/bash

# GitHub Actions Local Test Runner
# Run the same tests that GitHub Actions runs

echo "=== 🔍 RUNNING ALL GITHUB ACTIONS TESTS LOCALLY ==="
echo ""

# Navigate to project directory
cd "$(dirname "$0")"

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

# 5. Console.log Check
echo "5. 🚫 Checking for console.log statements..."
CONSOLE_LOGS=$(grep -r "console\.log(" public/ server.js sources/ utils/ middleware/ --include="*.js" --exclude-dir=node_modules | grep -v ": \*" | grep -v "console\.log = " | grep -v "originalConsoleLog" | grep -v "logger\." | grep -v "client-logger.js" | head -5)
if [ -n "$CONSOLE_LOGS" ]; then
    echo "❌ Found console.log statements:"
    echo "$CONSOLE_LOGS"
    echo "❌ Console.log Check: FAILED"
    OVERALL_SUCCESS=false
else
    echo "✅ No console.log statements found"
fi
echo ""

# 6. Run All Tests
echo "6. 🧪 Running all tests..."
if npm test; then
    echo "✅ Tests: PASSED"
else
    echo "❌ Tests: FAILED"
    OVERALL_SUCCESS=false
fi
echo ""

# 7. Config Validation
echo "7. 🔍 Config validation..."
if node -e "const Ajv=require('ajv');const fs=require('fs');const ajv=new Ajv({allErrors:true});const schema=JSON.parse(fs.readFileSync('../config.schema.json','utf8'));const data=JSON.parse(fs.readFileSync('../config.json','utf8'));const validate=ajv.compile(schema);if(!validate(data)){console.error('Config validation failed:',validate.errors);process.exit(1)}console.log('✅ Config validation passed')"; then
    echo "✅ Config: PASSED"
else
    echo "❌ Config: FAILED"
    OVERALL_SUCCESS=false
fi
echo ""

# Final Summary
echo "=== 📊 GITHUB ACTIONS TEST RESULTS SUMMARY ==="
if [ "$OVERALL_SUCCESS" = true ]; then
    echo "🎉 ALL TESTS PASSED! Ready to push to GitHub! 🚀"
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