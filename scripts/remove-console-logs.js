#!/usr/bin/env node

/**
 * Smart console.log removal script
 * Removes console.log statements while preserving code structure
 */

const fs = require('fs');
const path = require('path');

function removeConsoleLogs(filePath) {
    console.log(`Processing: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const newLines = [];
    let removedCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip comments and JSDoc
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            newLines.push(line);
            continue;
        }

        // Check if line contains console.log
        if (trimmed.includes('console.log(')) {
            // Skip if it's part of a string or comment
            if (
                trimmed.includes('"console.log') ||
                trimmed.includes("'console.log") ||
                trimmed.includes('`console.log') ||
                trimmed.includes('console.log = ') ||
                trimmed.includes('originalConsoleLog')
            ) {
                newLines.push(line);
                continue;
            }

            // Check if it's a conditional console.log that can be safely removed
            if (trimmed.startsWith('if (') && trimmed.includes('console.log(')) {
                // Single line if statement with console.log
                removedCount++;
                continue;
            }

            // Check if it's just a console.log statement
            if (trimmed.startsWith('console.log(')) {
                removedCount++;
                continue;
            }

            // If console.log is embedded in other code, replace it with empty call
            const replaced = line.replace(/console\.log\([^)]*\);?/g, '');
            if (replaced.trim() === '') {
                // Entire line was just console.log
                removedCount++;
                continue;
            } else if (replaced !== line) {
                // Part of the line was console.log
                newLines.push(replaced);
                removedCount++;
                continue;
            }
        }

        newLines.push(line);
    }

    if (removedCount > 0) {
        fs.writeFileSync(filePath, newLines.join('\n'));
        console.log(`  Removed ${removedCount} console.log statements`);
    } else {
        console.log(`  No changes needed`);
    }
}

// Files to process
const filesToProcess = ['public/admin.js', 'public/sw.js'];

console.log('🧹 Smart console.log removal starting...\n');

for (const file of filesToProcess) {
    const fullPath = path.resolve(file);
    if (fs.existsSync(fullPath)) {
        removeConsoleLogs(fullPath);
    } else {
        console.log(`⚠️  File not found: ${file}`);
    }
}

console.log('\n✅ Console.log cleanup completed!');
