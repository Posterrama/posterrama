#!/usr/bin/env node

// Auto-fix admin defaults for new installations
const fs = require('fs');

// Color codes
const colors = {
    red: '\x1b[0;31m',
    green: '\x1b[0;32m',
    yellow: '\x1b[1;33m',
    blue: '\x1b[0;34m',
    nc: '\x1b[0m',
};

function log(level, message) {
    const color = colors[level] || colors.nc;
    console.log(`${color}${message}${colors.nc}`);
}

let fixed = 0;
let errors = 0;

function fixExampleEnv() {
    log('blue', '🔧 Auto-fixing config.example.env...');

    if (!fs.existsSync('config.example.env')) {
        log('red', '❌ config.example.env not found');
        errors++;
        return;
    }

    let content = fs.readFileSync('config.example.env', 'utf8');
    const lines = content.split('\n');
    let modified = false;

    // Fix placeholder values
    const placeholderFixes = [
        { pattern: /=TODO$/gm, replacement: '=', description: 'Removed TODO placeholder' },
        {
            pattern: /=CHANGE_ME$/gm,
            replacement: '=',
            description: 'Removed CHANGE_ME placeholder',
        },
        { pattern: /=your_(.+)$/gm, replacement: '=', description: 'Removed your_ placeholder' },
        {
            pattern: /=REPLACE_(.+)$/gm,
            replacement: '=',
            description: 'Removed REPLACE_ placeholder',
        },
        { pattern: /=xxx$/gim, replacement: '=', description: 'Removed xxx placeholder' },
    ];

    placeholderFixes.forEach(({ pattern, replacement, description }) => {
        const originalContent = content;
        content = content.replace(pattern, replacement);
        if (content !== originalContent) {
            log('green', `✅ ${description}`);
            modified = true;
            fixed++;
        }
    });

    // Add essential missing variables
    const essentialVars = [
        {
            name: 'NODE_ENV',
            value: 'production',
            comment: '# Node environment: production | development | test',
        },
        {
            name: 'DEBUG',
            value: 'true',
            comment: "# Set to 'true' to enable verbose logging for debugging",
        },
        {
            name: 'SERVER_PORT',
            value: '4000',
            comment: '# The port on which the web server will run',
        },
    ];

    essentialVars.forEach(({ name, value, comment }) => {
        const hasVar = lines.some(
            line => line.startsWith(`${name}=`) || line.startsWith(`# ${name}=`)
        );

        if (!hasVar) {
            content += `\n${comment}\n${name}=${value}\n`;
            log('green', `✅ Added missing essential variable: ${name}`);
            modified = true;
            fixed++;
        }
    });

    if (modified) {
        fs.writeFileSync('config.example.env', content);
        log('green', '✅ config.example.env updated');
    } else {
        log('green', '✅ config.example.env is already clean');
    }
}

function fixExampleConfig() {
    log('blue', '🔧 Auto-fixing config.example.json structure...');

    // Load current config and example config
    let currentConfig = null;
    let exampleConfig = null;

    try {
        if (fs.existsSync('config.json')) {
            currentConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        }
        if (fs.existsSync('config.example.json')) {
            exampleConfig = JSON.parse(fs.readFileSync('config.example.json', 'utf8'));
        }
    } catch (e) {
        log('red', `❌ Error loading config files: ${e.message}`);
        errors++;
        return;
    }

    if (!currentConfig || !exampleConfig) {
        log('yellow', '⚠️  Missing config files - skipping example config fixes');
        return;
    }

    // Add missing properties from current config to example
    let modified = false;

    function addMissingProps(source, target, path = '') {
        for (const [key, value] of Object.entries(source)) {
            const fullPath = path ? `${path}.${key}` : key;

            if (!(key in target)) {
                // Add missing property with a safe default value
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    target[key] = {};
                    addMissingProps(value, target[key], fullPath);
                } else {
                    // Use example-safe values
                    target[key] = getExampleValue(value);
                }
                log('green', `✅ Added missing property: ${fullPath}`);
                modified = true;
                fixed++;
            } else if (
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value) &&
                typeof target[key] === 'object' &&
                target[key] !== null &&
                !Array.isArray(target[key])
            ) {
                addMissingProps(value, target[key], fullPath);
            }
        }
    }

    function getExampleValue(value) {
        // Convert actual values to example-safe equivalents
        if (typeof value === 'string') {
            if (value.includes('localhost') || value.includes('127.0.0.1')) return value;
            if (value.includes('http')) return 'http://your-server:port';
            if (value.includes('@')) return 'user@domain.com';
            return value.length > 20 ? 'your-value-here' : value;
        }
        return value;
    }

    addMissingProps(currentConfig, exampleConfig);

    if (modified) {
        fs.writeFileSync('config.example.json', JSON.stringify(exampleConfig, null, 4));
        log('green', '✅ config.example.json updated with missing properties');
    } else {
        log('green', '✅ config.example.json structure is already up-to-date');
    }
}

// Main execution
async function main() {
    log('blue', '🔧 Auto-fixing admin defaults for new installations...\n');

    fixExampleEnv();
    fixExampleConfig();

    console.log('\n📊 Admin Defaults Auto-fix Summary:');
    if (fixed > 0) {
        log('green', `✅ ${fixed} issues fixed`);
    }
    if (errors > 0) {
        log('red', `❌ ${errors} errors occurred`);
    }

    if (errors === 0) {
        log('green', '✅ Admin defaults are now suitable for new installations');
        process.exit(0);
    } else {
        log('yellow', '⚠️  Some issues could not be auto-fixed - manual intervention needed');
        process.exit(1);
    }
}

main().catch(e => {
    log('red', `❌ Unexpected error: ${e.message}`);
    process.exit(1);
});
