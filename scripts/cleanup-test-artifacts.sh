#!/bin/bash

# Cleanup Test Artifacts Script
# Removes test-generated files that accumulate during test runs

echo "🧹 Cleaning up test artifacts..."

# Count files before cleanup
BEFORE=$(find . -maxdepth 1 -name "devices.broadcast.*.json" -o -name "*.groups.test.json" -o -name "devices.test.*.json" | wc -l)

# Remove device broadcast test files
rm -f devices.broadcast.*.json 2>/dev/null || true

# Remove group test files
rm -f *.groups.test.json 2>/dev/null || true

# Remove device test files
rm -f devices.test.*.json 2>/dev/null || true

# Count files after cleanup
AFTER=$(find . -maxdepth 1 -name "devices.broadcast.*.json" -o -name "*.groups.test.json" -o -name "devices.test.*.json" | wc -l)
REMOVED=$((BEFORE - AFTER))

if [ $REMOVED -gt 0 ]; then
    echo "✅ Removed $REMOVED test artifact file(s)"
else
    echo "✅ No test artifacts found (already clean)"
fi
