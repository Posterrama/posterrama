#!/bin/bash

# Quick Health Check Script for Performance Baseline Testing
# This script performs essential health checks without running full test suite

set -e

# Function to run a check silently
run_quick_check() {
    local check_name="$1"
    local command="$2"
    
    if ! eval "$command" >/dev/null 2>&1; then
        echo "FAIL: $check_name"
        exit 1
    fi
}

# Essential environment checks
run_quick_check "Node.js available" "node --version"
run_quick_check "npm available" "npm --version"
run_quick_check "package.json exists" "test -f package.json"
run_quick_check "config.json exists and valid" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"config.json\", \"utf8\"))'"

# Quick linting check (fastest code quality gate)
run_quick_check "ESLint passes" "npm run lint"

# Skip tests and prettier for performance baseline
echo "Quick health check: PASS"
exit 0