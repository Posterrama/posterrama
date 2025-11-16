#!/bin/bash
#
# Production Build Script
# Removes console.logs from frontend JavaScript for production deployment
#

set -e

echo "=========================================="
echo "Posterrama Production Build v2.9.4"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PUBLIC_DIR="public"
DIST_DIR="dist/public"
BACKUP_DIR="dist/backup"

# Step 1: Clean dist directory
echo "Step 1/4: Cleaning dist directory..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
mkdir -p "$BACKUP_DIR"
echo -e "${GREEN}✓ Dist directory cleaned${NC}"
echo ""

# Step 2: Copy all public files to dist
echo "Step 2/4: Copying public files to dist..."
cp -r "$PUBLIC_DIR"/* "$DIST_DIR"/
echo -e "${GREEN}✓ Files copied${NC}"
echo ""

# Step 3: Remove console.logs from JavaScript files
echo "Step 3/4: Removing console.logs from JavaScript..."

# Use Node.js script for more reliable processing
node << 'EOF'
const fs = require('fs');
const path = require('path');

const DIST_DIR = 'dist/public';
const BACKUP_DIR = 'dist/backup';

function findJSFiles(dir) {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') {
                files.push(...findJSFiles(fullPath));
            }
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.min.js')) {
            files.push(fullPath);
        }
    }
    
    return files;
}

function removeConsoleLogs(filePath) {
    const basename = path.basename(filePath);
    
    // Skip client-logger.js
    if (basename === 'client-logger.js') {
        console.log(`  ⊘ Skipped: ${filePath} (logger infrastructure)`);
        return { processed: false, removed: 0 };
    }
    
    // Read file
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Backup
    fs.writeFileSync(path.join(BACKUP_DIR, basename + '.backup'), content);
    
    // Count before
    const beforeMatches = content.match(/console\.(log|debug|info)\(/g);
    const before = beforeMatches ? beforeMatches.length : 0;
    
    if (before === 0) {
        console.log(`  ✓ Clean: ${filePath}`);
        return { processed: true, removed: 0 };
    }
    
    // Remove console.log, console.debug, console.info
    // Keep console.warn and console.error
    content = content.replace(/console\.(log|debug|info)\([^)]*\);?/g, '/* removed console.$1 */');
    
    // Handle multi-line console statements (simple cases)
    content = content.replace(/console\.(log|debug|info)\([^;]*?\);?/gs, '/* removed console.$1 */');
    
    // Write back
    fs.writeFileSync(filePath, content);
    
    // Count after
    const afterMatches = content.match(/console\.(log|debug|info)\(/g);
    const after = afterMatches ? afterMatches.length : 0;
    const removed = before - after;
    
    if (removed > 0) {
        console.log(`  ✓ Processed: ${filePath} (removed ${removed} console statements)`);
    } else {
        console.log(`  ⚠ Partial: ${filePath} (complex patterns remain)`);
    }
    
    return { processed: true, removed };
}

// Main
const files = findJSFiles(DIST_DIR);
let totalProcessed = 0;
let totalRemoved = 0;

for (const file of files) {
    const result = removeConsoleLogs(file);
    if (result.processed) totalProcessed++;
    totalRemoved += result.removed;
}

console.log('');
console.log(`✓ Processed ${totalProcessed} JavaScript files`);
console.log(`✓ Removed ${totalRemoved} console statements`);
EOF

echo ""

# Step 4: Verify console.logs removed
echo "Step 4/4: Verifying console.logs removed..."
REMAINING=$(grep -r "console\.log(" "$DIST_DIR" --include="*.js" 2>/dev/null | \
    grep -v "client-logger.js" | \
    grep -v "removed console" | \
    wc -l)

if [ "$REMAINING" -eq 0 ]; then
    echo -e "${GREEN}✓ All console.logs successfully removed${NC}"
else
    echo -e "${YELLOW}⚠ Warning: $REMAINING console.log statements still found${NC}"
    echo "Files with remaining console.logs:"
    grep -r "console\.log(" "$DIST_DIR" --include="*.js" 2>/dev/null | \
        grep -v "client-logger.js" | \
        grep -v "removed console" | \
        cut -d: -f1 | sort -u | head -10
fi

echo ""
echo "=========================================="
echo "Production Build Complete!"
echo "=========================================="
echo ""
echo "Output directory: $DIST_DIR"
echo "Backup directory: $BACKUP_DIR"
echo ""
echo "Next steps:"
echo "  1. Test the build: node server.js --public-dir=dist/public"
echo "  2. Deploy: rsync -av dist/public/ user@server:/path/to/posterrama/public/"
echo ""
