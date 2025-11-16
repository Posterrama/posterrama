/**
 * Jest global setup for proper cleanup of intervals and timeouts
 * This prevents memory leaks and hanging test processes
 */

// Track all intervals and timeouts for cleanup
global.testIntervals = [];
global.testTimeouts = [];

// Override setInterval to track intervals
const originalSetInterval = global.setInterval;
global.setInterval = function (callback, delay) {
    const intervalId = originalSetInterval(callback, delay);
    global.testIntervals.push(intervalId);
    return intervalId;
};

// Override setTimeout to track timeouts
const originalSetTimeout = global.setTimeout;
global.setTimeout = function (callback, delay) {
    const timeoutId = originalSetTimeout(callback, delay);
    global.testTimeouts.push(timeoutId);
    return timeoutId;
};

// Override clearInterval to remove from tracking
const originalClearInterval = global.clearInterval;
global.clearInterval = function (intervalId) {
    const index = global.testIntervals.indexOf(intervalId);
    if (index > -1) {
        global.testIntervals.splice(index, 1);
    }
    return originalClearInterval(intervalId);
};

// Override clearTimeout to remove from tracking
const originalClearTimeout = global.clearTimeout;
global.clearTimeout = function (timeoutId) {
    const index = global.testTimeouts.indexOf(timeoutId);
    if (index > -1) {
        global.testTimeouts.splice(index, 1);
    }
    return originalClearTimeout(timeoutId);
};

// Clean up function to clear all tracked intervals and timeouts
global.cleanupTimers = function () {
    // Clear all tracked intervals
    global.testIntervals.forEach(intervalId => {
        try {
            originalClearInterval(intervalId);
        } catch (error) {
            // Ignore errors - interval might already be cleared
        }
    });
    global.testIntervals = [];

    // Clear all tracked timeouts
    global.testTimeouts.forEach(timeoutId => {
        try {
            originalClearTimeout(timeoutId);
        } catch (error) {
            // Ignore errors - timeout might already be cleared
        }
    });
    global.testTimeouts = [];
};

// Set test environment
process.env.NODE_ENV = 'test';
process.env.TEST_SILENT = 'true'; // Suppress logger output

// Increase MaxListeners for tests that start multiple servers
// This prevents warnings when tests run in parallel
require('events').EventEmitter.defaultMaxListeners = 20;

// Ensure config.json exists for tests (copy from example if missing)
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const configExamplePath = path.join(__dirname, 'config.example.json');

if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
    try {
        const exampleConfig = JSON.parse(fs.readFileSync(configExamplePath, 'utf8'));
        // Create minimal test config
        const testConfig = {
            ...exampleConfig,
            port: 4000,
            mediaServers: [],
            // Ensure backups config is complete with all required fields
            backups: {
                enabled: false,
                time: '02:00',
                retention: 7,
            },
        };
        fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 4));
        console.log('✅ Created config.json from example for tests');
    } catch (error) {
        console.warn('⚠️ Could not create config.json:', error.message);
    }
}

// Snapshot immutable test fixture(s) to ensure tests do not mutate them in-place
const CRITICAL_FIXTURES = [
    path.join(__dirname, '__tests__', 'utils', 'fake-backup', 'package.json'),
];
const fixtureSnapshots = new Map();
for (const f of CRITICAL_FIXTURES) {
    try {
        if (fs.existsSync(f)) {
            fixtureSnapshots.set(f, fs.readFileSync(f, 'utf8'));
        }
    } catch (_) {
        // ignore
    }
}

// Global teardown after each test
afterEach(() => {
    global.cleanupTimers();

    // Cleanup any server instances
    if (global.server && typeof global.server.cleanup === 'function') {
        global.server.cleanup();
    }

    // Clear require cache for modules that might have intervals
    const modulePattern = /\/var\/www\/posterrama\/(server|utils|middleware|sources)/;
    Object.keys(require.cache).forEach(key => {
        if (modulePattern.test(key)) {
            delete require.cache[key];
        }
    });

    // Verify critical fixtures unchanged
    for (const [f, orig] of fixtureSnapshots.entries()) {
        if (fs.existsSync(f)) {
            const current = fs.readFileSync(f, 'utf8');
            if (current !== orig) {
                throw new Error(`Test mutated immutable fixture: ${f}`);
            }
        }
    }
});

// Global teardown before exit
afterAll(() => {
    global.cleanupTimers();
});
