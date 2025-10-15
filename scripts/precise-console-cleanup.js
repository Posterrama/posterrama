#!/usr/bin/env node

/**
 * Precise console.log removal script
 * Only removes standalone console.log statements, preserves code structure
 */

const fs = require('fs');
const path = require('path');

function removeStandaloneConsoleLogs(filePath) {
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

        // Skip assignments and definitions
        if (
            trimmed.includes('console.log = ') ||
            trimmed.includes('originalConsoleLog') ||
            trimmed.includes('"console.log') ||
            trimmed.includes("'console.log") ||
            trimmed.includes('`console.log')
        ) {
            newLines.push(line);
            continue;
        }

        // Only remove standalone console.log statements
        if (trimmed.startsWith('console.log(') && trimmed.endsWith(');')) {
            removedCount++;
            // Keep the indentation but remove the content
            const indent = line.match(/^\s*/)[0];
            newLines.push(indent + '// console.log removed for cleaner browser console');
            continue;
        }

        // Remove simple if (debug) console.log(...) statements
        if (
            trimmed.startsWith('if (') &&
            trimmed.includes('console.log(') &&
            !trimmed.includes('{') &&
            trimmed.endsWith(');')
        ) {
            removedCount++;
            const indent = line.match(/^\s*/)[0];
            newLines.push(indent + '// debug console.log removed');
            continue;
        }

        newLines.push(line);
    }

    if (removedCount > 0) {
        fs.writeFileSync(filePath, newLines.join('\n'));
        console.log(`  Replaced ${removedCount} console.log statements with comments`);
    } else {
        console.log(`  No standalone console.log statements found`);
    }
}

// Files to process
const filesToProcess = ['public/admin.js', 'public/sw.js'];

console.log('🧹 Precise console.log removal starting...\n');

for (const file of filesToProcess) {
    const fullPath = path.resolve(file);
    if (fs.existsSync(fullPath)) {
        removeStandaloneConsoleLogs(fullPath);
    } else {
        console.log(`⚠️  File not found: ${file}`);
    }
}

console.log('\n✅ Precise console.log cleanup completed!');
