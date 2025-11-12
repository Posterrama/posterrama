#!/usr/bin/env node
/**
 * Test script to compare cache performance with/without tiering
 * Simulates realistic workload with hot/warm/cold data patterns
 */

// Mock logger to avoid circular dependencies
const logger = {
    debug: () => {},
    info: console.log,
    warn: console.warn,
    error: console.error,
};

// Load cache module
const cacheModule = require('../utils/cache');
cacheModule.initializeCache(logger);
const { CacheManager } = cacheModule;

// Test configuration
const TEST_DURATION = 30000; // 30 seconds
const ACCESS_INTERVAL = 10; // 10ms between accesses

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  Tiered Cache Performance Test                                 ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

/**
 * Simulate realistic workload
 * 20% hot data (accessed frequently)
 * 30% warm data (accessed occasionally)
 * 50% cold data (accessed rarely)
 */
function simulateWorkload(cache, duration) {
    return new Promise(resolve => {
        const startTime = Date.now();
        const stats = {
            sets: 0,
            gets: 0,
            hits: 0,
            misses: 0,
        };

        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            if (elapsed >= duration) {
                clearInterval(interval);
                resolve(stats);
                return;
            }

            const random = Math.random();

            // 40% of operations: access hot data (20% of keys)
            if (random < 0.4) {
                const hotKey = `hot-${Math.floor(Math.random() * 20)}`;
                const entry = cache.get(hotKey);
                stats.gets++;
                if (entry) {
                    stats.hits++;
                } else {
                    stats.misses++;
                    cache.set(hotKey, { data: 'hot', timestamp: Date.now() }, 300000);
                    stats.sets++;
                }
            }
            // 30% of operations: access warm data (30% of keys)
            else if (random < 0.7) {
                const warmKey = `warm-${Math.floor(Math.random() * 30)}`;
                const entry = cache.get(warmKey);
                stats.gets++;
                if (entry) {
                    stats.hits++;
                } else {
                    stats.misses++;
                    cache.set(warmKey, { data: 'warm', timestamp: Date.now() }, 300000);
                    stats.sets++;
                }
            }
            // 30% of operations: access cold data (50% of keys)
            else {
                const coldKey = `cold-${Math.floor(Math.random() * 50)}`;
                const entry = cache.get(coldKey);
                stats.gets++;
                if (entry) {
                    stats.hits++;
                } else {
                    stats.misses++;
                    cache.set(coldKey, { data: 'cold', timestamp: Date.now() }, 300000);
                    stats.sets++;
                }
            }
        }, ACCESS_INTERVAL);
    });
}

/**
 * Run test with specific configuration
 */
async function runTest(config, name) {
    console.log(`\n📊 Testing: ${name}`);
    console.log('─'.repeat(64));

    const cache = new CacheManager(config);

    // Run workload
    const startTime = Date.now();
    const stats = await simulateWorkload(cache, TEST_DURATION);
    const duration = Date.now() - startTime;

    // Get cache stats
    const cacheStats = cache.getStats();

    // Calculate metrics
    const hitRate = stats.gets > 0 ? ((stats.hits / stats.gets) * 100).toFixed(2) : 0;
    const opsPerSecond = ((stats.gets + stats.sets) / (duration / 1000)).toFixed(0);

    console.log(`\nWorkload Results:`);
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`  Total operations: ${stats.gets + stats.sets}`);
    console.log(`  Operations/sec: ${opsPerSecond}`);
    console.log(`  Sets: ${stats.sets}`);
    console.log(`  Gets: ${stats.gets}`);
    console.log(`  Hits: ${stats.hits}`);
    console.log(`  Misses: ${stats.misses}`);
    console.log(`  Hit rate: ${hitRate}%`);

    console.log(`\nCache Statistics:`);
    console.log(`  Total hits: ${cacheStats.hits}`);
    console.log(`  Total misses: ${cacheStats.misses}`);
    console.log(`  Cache sets: ${cacheStats.sets}`);
    console.log(`  Cache deletes: ${cacheStats.deletes}`);

    if (config.enableTiering && cacheStats.tiering) {
        const tiering = cacheStats.tiering;
        console.log(`\nTier Distribution:`);
        console.log(
            `  L1: ${tiering.l1Size}/${tiering.l1MaxSize} entries (${tiering.l1Hits} hits)`
        );
        console.log(
            `  L2: ${tiering.l2Size}/${tiering.l2MaxSize} entries (${tiering.l2Hits} hits)`
        );
        console.log(
            `  L3: ${tiering.l3Size}/${tiering.l3MaxSize} entries (${tiering.l3Hits} hits)`
        );
        console.log(`  Promotions: ${tiering.promotions}`);
        console.log(`  Demotions: ${tiering.demotions}`);

        // Calculate tier hit percentages
        const totalTierHits = tiering.l1Hits + tiering.l2Hits + tiering.l3Hits;
        if (totalTierHits > 0) {
            const l1Pct = ((tiering.l1Hits / totalTierHits) * 100).toFixed(1);
            const l2Pct = ((tiering.l2Hits / totalTierHits) * 100).toFixed(1);
            const l3Pct = ((tiering.l3Hits / totalTierHits) * 100).toFixed(1);
            console.log(`\nTier Hit Distribution:`);
            console.log(`  L1: ${l1Pct}% (target: 60-70%)`);
            console.log(`  L2: ${l2Pct}% (target: 20-30%)`);
            console.log(`  L3: ${l3Pct}% (target: 5-15%)`);
        }
    }

    // Cleanup
    cache.cleanup();

    return {
        name,
        duration,
        hitRate: parseFloat(hitRate),
        opsPerSecond: parseInt(opsPerSecond),
        stats: cacheStats,
    };
}

/**
 * Main test runner
 */
async function main() {
    console.log(`Test configuration:`);
    console.log(`  Duration: ${TEST_DURATION / 1000}s`);
    console.log(`  Access interval: ${ACCESS_INTERVAL}ms`);
    console.log(`  Workload: 40% hot, 30% warm, 30% cold`);

    // Test 1: Without tiering (baseline)
    const baseline = await runTest(
        {
            maxSize: 500,
            defaultTTL: 300000,
            enableTiering: false,
        },
        'Baseline (No Tiering)'
    );

    // Test 2: With tiering
    const tiered = await runTest(
        {
            maxSize: 500,
            defaultTTL: 300000,
            enableTiering: true,
            l1MaxSize: 100,
            l2MaxSize: 300,
            l3MaxSize: 500,
            promotionThreshold: 3,
            demotionAge: 10 * 60 * 1000,
        },
        'Tiered Cache (L1/L2/L3)'
    );

    // Comparison
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  Comparison Results                                            ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    const hitRateDiff = tiered.hitRate - baseline.hitRate;
    const hitRatePctChange = ((hitRateDiff / baseline.hitRate) * 100).toFixed(1);

    console.log(`Hit Rate:`);
    console.log(`  Baseline: ${baseline.hitRate}%`);
    console.log(`  Tiered:   ${tiered.hitRate}%`);
    console.log(
        `  Difference: ${hitRateDiff > 0 ? '+' : ''}${hitRateDiff.toFixed(2)}% (${hitRatePctChange > 0 ? '+' : ''}${hitRatePctChange}%)`
    );

    console.log(`\nOperations per Second:`);
    console.log(`  Baseline: ${baseline.opsPerSecond}`);
    console.log(`  Tiered:   ${tiered.opsPerSecond}`);
    const opsDiff = tiered.opsPerSecond - baseline.opsPerSecond;
    console.log(`  Difference: ${opsDiff > 0 ? '+' : ''}${opsDiff}`);

    console.log(`\n📈 Verdict:`);
    if (hitRateDiff > 2) {
        console.log(`  ✅ Tiering shows ${hitRateDiff.toFixed(1)}% better hit rate!`);
        console.log(`  💡 Recommendation: Enable tiering in production`);
    } else if (hitRateDiff > 0) {
        console.log(`  ⚡ Tiering shows slight improvement (+${hitRateDiff.toFixed(1)}%)`);
        console.log(`  💡 Recommendation: Monitor in production, enable if workload is sustained`);
    } else {
        console.log(`  ⚠️  Tiering shows no improvement for this workload`);
        console.log(`  💡 Recommendation: Keep disabled, current performance is good`);
    }

    console.log('\n✅ Test complete\n');
}

// Run tests
main().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
