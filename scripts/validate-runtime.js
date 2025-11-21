#!/usr/bin/env node
/**
 * Runtime Validation Script
 * Tests all TypeScript-modified modules for runtime functionality
 */

const logger = require('../utils/logger.js');
const { cacheManager: cache } = require('../utils/cache.js');
const errors = require('../utils/errors.js');
const plexHelpers = require('../lib/plex-helpers.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`❌ ${name}: ${err.message}`);
        failed++;
    }
}

console.log('\n🔍 Runtime Validation - TypeScript Modified Modules\n');

// ============================================================================
// 1. Logger Tests (utils/logger.js)
// ============================================================================
console.log('📝 Testing Logger...');

test('Logger: info() method exists', () => {
    if (typeof logger.info !== 'function') throw new Error('info() not a function');
});

test('Logger: warn() method exists', () => {
    if (typeof logger.warn !== 'function') throw new Error('warn() not a function');
});

test('Logger: error() method exists', () => {
    if (typeof logger.error !== 'function') throw new Error('error() not a function');
});

test('Logger: fatal() method exists', () => {
    if (typeof logger.fatal !== 'function') throw new Error('fatal() not a function');
});

test('Logger: memoryLogs property exists', () => {
    if (!Array.isArray(logger.memoryLogs)) throw new Error('memoryLogs not an array');
});

test('Logger: events property exists', () => {
    if (typeof logger.events !== 'object') throw new Error('events not an object');
});

test('Logger: can write info log', () => {
    logger.info('[RUNTIME-TEST] Info log test');
});

test('Logger: can write error log', () => {
    logger.error('[RUNTIME-TEST] Error log test', { context: 'validation' });
});

test('Logger: memoryLogs captures logs', () => {
    const initialLength = logger.memoryLogs.length;
    logger.info('[RUNTIME-TEST] Memory capture test');
    if (logger.memoryLogs.length <= initialLength) throw new Error('Log not captured');
});

test('Logger: getRecentLogs() works', () => {
    if (typeof logger.getRecentLogs !== 'function') throw new Error('getRecentLogs not a function');
    const logs = logger.getRecentLogs(null, 5);
    if (!Array.isArray(logs)) throw new Error('getRecentLogs did not return array');
});

// ============================================================================
// 2. Cache Tests (utils/cache.js)
// ============================================================================
console.log('\n💾 Testing Cache...');

test('Cache: set() method exists', () => {
    if (typeof cache.set !== 'function') throw new Error('set() not a function');
});

test('Cache: get() method exists', () => {
    if (typeof cache.get !== 'function') throw new Error('get() not a function');
});

test('Cache: delete() method exists', () => {
    if (typeof cache.delete !== 'function') throw new Error('delete() not a function');
});

test('Cache: getStats() method exists', () => {
    if (typeof cache.getStats !== 'function') throw new Error('getStats() not a function');
});

test('Cache: can set and get value', () => {
    cache.set('runtime-test-key', { data: 'test-value' }, 10000);
    const result = cache.get('runtime-test-key');
    // Cache returns wrapper with {value, etag, createdAt, etc}
    if (!result || !result.value || result.value.data !== 'test-value') {
        throw new Error('Cache get/set failed');
    }
});

test('Cache: getStats() returns valid data', () => {
    const stats = cache.getStats();
    if (typeof stats.sets !== 'number') throw new Error('stats.sets not a number');
    if (typeof stats.hits !== 'number') throw new Error('stats.hits not a number');
    if (typeof stats.misses !== 'number') throw new Error('stats.misses not a number');
});

test('Cache: can delete value', () => {
    cache.set('runtime-test-delete', { data: 'delete-me' }, 10000);
    cache.delete('runtime-test-delete');
    const result = cache.get('runtime-test-delete');
    // After delete, get() should return undefined
    if (result !== undefined && result !== null) {
        throw new Error('Cache delete failed');
    }
});

test('Cache: l1Cache (LRU) exists', () => {
    if (!cache.l1Cache) throw new Error('l1Cache not found');
});

test('Cache: l2Cache (Map) exists', () => {
    if (!cache.l2Cache) throw new Error('l2Cache not found');
});

// ============================================================================
// 3. Error Handling Tests (utils/errors.js)
// ============================================================================
console.log('\n⚠️  Testing Error Handling...');

test('Errors: SourceError class exists', () => {
    if (typeof errors.SourceError !== 'function') throw new Error('SourceError not exported');
});

test('Errors: ApiError class exists', () => {
    if (typeof errors.ApiError !== 'function') throw new Error('ApiError not exported');
});

test('Errors: NetworkError class exists', () => {
    if (typeof errors.NetworkError !== 'function') throw new Error('NetworkError not exported');
});

test('Errors: can create SourceError', () => {
    const err = new errors.SourceError('Test error', {
        source: 'test',
        operation: 'validation',
        isRetryable: false,
    });
    if (err.name !== 'SourceError') throw new Error('SourceError name incorrect');
    if (err.source !== 'test') throw new Error('SourceError source incorrect');
    if (err.operation !== 'validation') throw new Error('SourceError operation incorrect');
});

test('Errors: normalizeError() exists', () => {
    if (typeof errors.normalizeError !== 'function') throw new Error('normalizeError not exported');
});

test('Errors: normalizeError() works', () => {
    const genericError = new Error('Generic error');
    const normalized = errors.normalizeError(genericError, { source: 'test', operation: 'test' });
    if (!(normalized instanceof errors.SourceError))
        throw new Error('normalizeError did not return SourceError');
});

// ============================================================================
// 4. Plex Helpers Tests (lib/plex-helpers.js)
// ============================================================================
console.log('\n🎬 Testing Plex Helpers...');

test('Plex: getPlexClient() exists', () => {
    if (typeof plexHelpers.getPlexClient !== 'function')
        throw new Error('getPlexClient not exported');
});

test('Plex: getPlexLibraries() exists', () => {
    if (typeof plexHelpers.getPlexLibraries !== 'function')
        throw new Error('getPlexLibraries not exported');
});

test('Plex: getPlexGenresWithCounts() exists', () => {
    if (typeof plexHelpers.getPlexGenresWithCounts !== 'function')
        throw new Error('getPlexGenresWithCounts not exported');
});

test('Plex: getPlexQualitiesWithCounts() exists', () => {
    if (typeof plexHelpers.getPlexQualitiesWithCounts !== 'function')
        throw new Error('getPlexQualitiesWithCounts not exported');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n' + '='.repeat(60));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60) + '\n');

if (failed > 0) {
    console.error('❌ Runtime validation FAILED - Some functionality is broken!');
    process.exit(1);
} else {
    console.log('✅ Runtime validation PASSED - All functionality working!');
    process.exit(0);
}
