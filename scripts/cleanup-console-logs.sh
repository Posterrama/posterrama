#!/bin/bash

# Script to remove all console.log statements from the codebase
# This will preserve the logger functionality and only remove console.log debug statements

echo "🧹 Removing console.log statements from codebase..."
echo ""

# Files to clean up
FILES=(
    "server.js"
    "sources/plex.js"
    "sources/tmdb.js"
    "sources/tvdb.js"
    "config/validate-env.js"
    "public/sw.js"
)

# Count initial console.log statements
echo "📊 Before cleanup:"
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        count=$(grep -c "console\.log" "$file" || echo "0")
        echo "  $file: $count console.log statements"
    fi
done
echo ""

# Create backup directory
BACKUP_DIR="backup_before_console_cleanup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "💾 Creating backups in $BACKUP_DIR..."
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$BACKUP_DIR/"
        echo "  ✅ Backed up $file"
    fi
done
echo ""

echo "🔧 Processing files..."

# Process each file
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  Processing $file..."
        
        # Remove console.log statements while preserving structure
        # This is a complex operation, so we'll do it line by line
        
        # Create temporary file
        temp_file="${file}.tmp"
        
        # Process the file
        python3 -c "
import re
import sys

def process_file(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    # Remove standalone console.log statements
    # Pattern 1: if (isDebug) console.log(...)
    content = re.sub(r'\s*if\s*\(\s*isDebug\s*\)\s*console\.log\([^;]*\);?\s*\n', '', content)
    
    # Pattern 2: console.log statements inside if blocks
    content = re.sub(r'\s*console\.log\([^;]*\);\s*\n', '', content)
    
    # Pattern 3: multiline console.log statements
    content = re.sub(r'\s*console\.log\(\s*\n[^)]*\);\s*\n', '', content, flags=re.MULTILINE | re.DOTALL)
    
    # Remove empty if blocks that only contained console.log
    content = re.sub(r'if\s*\(\s*isDebug\s*\)\s*{\s*}\s*\n', '', content)
    
    # Clean up multiple empty lines
    content = re.sub(r'\n\n\n+', '\n\n', content)
    
    return content

try:
    processed_content = process_file('$file')
    with open('$temp_file', 'w') as f:
        f.write(processed_content)
    print('✅ Processed $file')
except Exception as e:
    print(f'❌ Error processing $file: {e}')
    sys.exit(1)
"
        
        # Check if processing was successful
        if [ $? -eq 0 ]; then
            mv "$temp_file" "$file"
            echo "    ✅ Updated $file"
        else
            echo "    ❌ Failed to process $file"
            rm -f "$temp_file"
        fi
    fi
done

echo ""
echo "📊 After cleanup:"
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        count=$(grep -c "console\.log" "$file" || echo "0")
        echo "  $file: $count console.log statements"
    fi
done

echo ""
echo "🎉 Cleanup completed!"
echo "📁 Backups stored in: $BACKUP_DIR"
echo ""
echo "🧪 Next steps:"
echo "  1. npm run lint:fix  # Fix any linting issues"
echo "  2. npm test          # Run tests to ensure nothing broke"
echo "  3. npm run format    # Format the cleaned code"
echo ""
