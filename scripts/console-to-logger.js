#!/usr/bin/env node

/**
 * Replace console.log with logger.debug for controlled debugging
 * This preserves all debugging functionality but makes it controllable
 */

const fs = require('fs');
const path = require('path');

function replaceConsoleWithLogger(filePath) {
    console.log(`Processing: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf8');
    let modified = content;
    let replacements = 0;

    // Replace console.log with logger.debug
    modified = modified.replace(/console\.log\(/g, () => {
        replacements++;
        return 'logger.debug(';
    });

    // Replace console.warn with logger.warn
    modified = modified.replace(/console\.warn\(/g, () => {
        replacements++;
        return 'logger.warn(';
    });

    // Replace console.info with logger.info
    modified = modified.replace(/console\.info\(/g, () => {
        replacements++;
        return 'logger.info(';
    });

    // Keep console.error as is (always logged) but could replace with logger.error
    // Uncomment the next lines if you want to use logger.error instead
    // modified = modified.replace(/console\.error\(/g, () => {
    //     replacements++;
    //     return 'logger.error(';
    // });

    if (replacements > 0) {
        fs.writeFileSync(filePath, modified);
        console.log(`  Replaced ${replacements} console statements with logger calls`);
    } else {
        console.log(`  No console statements found to replace`);
    }
}

// Files to process
const filesToProcess = ['public/admin.js', 'public/script.js', 'public/sw.js'];

console.log('🔄 Replacing console.log with logger.debug...\n');

for (const file of filesToProcess) {
    const fullPath = path.resolve(file);
    if (fs.existsSync(fullPath)) {
        replaceConsoleWithLogger(fullPath);
    } else {
        console.log(`⚠️  File not found: ${file}`);
    }
}

console.log('\n✅ Console to logger replacement completed!');
console.log('\n💡 How to use:');
console.log('   - In browser console: enableDebug() to turn on logging');
console.log('   - In browser console: disableDebug() to turn off logging');
console.log('   - Add ?debug=true to URL for temporary debugging');
console.log('   - Set defaults.DEBUG=true in server config for persistent debugging');
