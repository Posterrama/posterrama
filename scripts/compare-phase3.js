#!/usr/bin/env node
/**
 * Compare performance across all optimization phases
 * Baseline → Phase 1 → Phase 2 → Phase 3
 */

const fs = require('fs');
const path = require('path');

// Load baseline files
const baselinePath = path.join(__dirname, 'performance-baseline.json');
const phase1Path = path.join(__dirname, 'performance-phase1-after.json');
const phase2Path = path.join(__dirname, 'performance-phase2-after.json');
const phase3Path = path.join(__dirname, 'performance-phase3-after.json');

function loadBaseline(filePath, label) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { label, data, exists: true };
    } catch (error) {
        return { label, exists: false, error: error.message };
    }
}

const baseline = loadBaseline(baselinePath, 'Baseline');
const phase1 = loadBaseline(phase1Path, 'Phase 1');
const phase2 = loadBaseline(phase2Path, 'Phase 2');
const phase3 = loadBaseline(phase3Path, 'Phase 3');

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  Performance Comparison: Baseline → Phase 1 → Phase 2 → Phase 3 ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// Check if all files exist
const phases = [baseline, phase1, phase2, phase3];
const missingPhases = phases.filter(p => !p.exists);

if (missingPhases.length > 0) {
    console.error('❌ Missing baseline files:');
    missingPhases.forEach(p => {
        console.error(`   • ${p.label}: ${p.error}`);
    });
    console.log('\n💡 Run baseline-metrics.js to capture missing data\n');
    process.exit(1);
}

// Extract metrics
function getMetrics(phase) {
    // Handle both old and new format
    let mediaEndpoint;

    if (phase.data.endpoints && Array.isArray(phase.data.endpoints)) {
        // New format (array)
        mediaEndpoint = phase.data.endpoints.find(e => e.name === 'get-media');
    } else if (phase.data.endpoints && phase.data.endpoints['get-media']) {
        // Old format (object)
        mediaEndpoint = phase.data.endpoints['get-media'];
        // Normalize to new format
        mediaEndpoint = {
            average: mediaEndpoint.avg,
            min: mediaEndpoint.min,
            max: mediaEndpoint.max,
            avgResponseSize: mediaEndpoint.avgSize,
        };
    }

    if (!mediaEndpoint) return null;

    return {
        avgTime: mediaEndpoint.average || mediaEndpoint.avg,
        minTime: mediaEndpoint.min,
        maxTime: mediaEndpoint.max,
        variance: mediaEndpoint.max - mediaEndpoint.min,
        avgSize: mediaEndpoint.avgResponseSize || mediaEndpoint.avgSize,
    };
}

const baselineMetrics = getMetrics(baseline);
const phase1Metrics = getMetrics(phase1);
const phase2Metrics = getMetrics(phase2);
const phase3Metrics = getMetrics(phase3);

// Display comparison table
console.log('📊 RESPONSE TIME COMPARISON (get-media endpoint)');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Phase       │ Avg Time │ Range      │ Variance │ vs Baseline');
console.log('────────────┼──────────┼────────────┼──────────┼─────────────');
console.log(
    `Baseline    │   ${baselineMetrics.avgTime}ms  │ ${baselineMetrics.minTime}-${baselineMetrics.maxTime}ms │   ${baselineMetrics.variance}ms   │     -`
);

// Phase 1
const p1Diff = phase1Metrics.avgTime - baselineMetrics.avgTime;
const p1Pct = ((p1Diff / baselineMetrics.avgTime) * 100).toFixed(1);
const p1Sign = p1Diff > 0 ? '+' : '';
console.log(
    `Phase 1     │  ${phase1Metrics.avgTime}ms  │ ${phase1Metrics.minTime}-${phase1Metrics.maxTime}ms │   ${phase1Metrics.variance}ms   │ ${p1Sign}${p1Pct}% (${p1Sign}${p1Diff}ms)`
);

// Phase 2
const p2Diff = phase2Metrics.avgTime - baselineMetrics.avgTime;
const p2Pct = ((p2Diff / baselineMetrics.avgTime) * 100).toFixed(1);
const p2Sign = p2Diff > 0 ? '+' : '';
console.log(
    `Phase 2     │   ${phase2Metrics.avgTime}ms  │ ${phase2Metrics.minTime}-${phase2Metrics.maxTime}ms │   ${phase2Metrics.variance}ms   │ ${p2Sign}${p2Pct}% (${p2Sign}${p2Diff}ms)`
);

// Phase 3
const p3Diff = phase3Metrics.avgTime - baselineMetrics.avgTime;
const p3Pct = ((p3Diff / baselineMetrics.avgTime) * 100).toFixed(1);
const p3Sign = p3Diff > 0 ? '+' : '';
console.log(
    `Phase 3     │   ${phase3Metrics.avgTime}ms  │ ${phase3Metrics.minTime}-${phase3Metrics.maxTime}ms │   ${phase3Metrics.variance}ms   │ ${p3Sign}${p3Pct}% (${p3Sign}${p3Diff}ms)`
);

console.log('\n📊 VARIANCE COMPARISON (consistency metric)');
console.log('═══════════════════════════════════════════════════════════════\n');

const baselineVar = baselineMetrics.variance;
const p1VarDiff = ((phase1Metrics.variance - baselineVar) / baselineVar) * 100;
const p2VarDiff = ((phase2Metrics.variance - baselineVar) / baselineVar) * 100;
const p3VarDiff = ((phase3Metrics.variance - baselineVar) / baselineVar) * 100;

console.log(
    `Baseline: ${baselineVar}ms variance (${baselineMetrics.minTime}-${baselineMetrics.maxTime}ms)`
);
console.log(
    `Phase 1:  ${phase1Metrics.variance}ms variance (${p1VarDiff > 0 ? '+' : ''}${p1VarDiff.toFixed(1)}%) ${p1VarDiff > 0 ? '⚠️  WORSE' : '✅ BETTER'}`
);
console.log(
    `Phase 2:  ${phase2Metrics.variance}ms variance (${p2VarDiff > 0 ? '+' : ''}${p2VarDiff.toFixed(1)}%) ${p2VarDiff > 0 ? '⚠️  WORSE' : '✅ BETTER'}`
);
console.log(
    `Phase 3:  ${phase3Metrics.variance}ms variance (${p3VarDiff > 0 ? '+' : ''}${p3VarDiff.toFixed(1)}%) ${p3VarDiff > 0 ? '⚠️  WORSE' : '✅ BETTER'}`
);

console.log('\n📊 RESPONSE SIZE COMPARISON');
console.log('═══════════════════════════════════════════════════════════════\n');

const baselineSize = baselineMetrics.avgSize;
const p1SizeDiff = ((phase1Metrics.avgSize - baselineSize) / baselineSize) * 100;
const p2SizeDiff = ((phase2Metrics.avgSize - baselineSize) / baselineSize) * 100;
const p3SizeDiff = ((phase3Metrics.avgSize - baselineSize) / baselineSize) * 100;

console.log(
    `Baseline: ${(baselineSize / 1024).toFixed(0)} KB (${(baselineSize / 1024 / 1024).toFixed(2)} MB)`
);
console.log(
    `Phase 1:  ${(phase1Metrics.avgSize / 1024).toFixed(0)} KB (${p1SizeDiff > 0 ? '+' : ''}${p1SizeDiff.toFixed(1)}%)`
);
console.log(
    `Phase 2:  ${(phase2Metrics.avgSize / 1024).toFixed(0)} KB (${p2SizeDiff > 0 ? '+' : ''}${p2SizeDiff.toFixed(1)}%)`
);
console.log(
    `Phase 3:  ${(phase3Metrics.avgSize / 1024).toFixed(0)} KB (${p3SizeDiff > 0 ? '+' : ''}${p3SizeDiff.toFixed(1)}%)`
);

console.log('\n🎯 KEY ACHIEVEMENTS');
console.log('═══════════════════════════════════════════════════════════════\n');

// Find best improvements
const bestSpeed = Math.min(p1Diff, p2Diff, p3Diff);
const bestSpeedPhase = [p1Diff, p2Diff, p3Diff].indexOf(bestSpeed) + 1;

const bestVariance = Math.min(
    phase1Metrics.variance,
    phase2Metrics.variance,
    phase3Metrics.variance
);
const bestVariancePhase =
    [phase1Metrics.variance, phase2Metrics.variance, phase3Metrics.variance].indexOf(bestVariance) +
    1;

const bestSize = Math.min(phase1Metrics.avgSize, phase2Metrics.avgSize, phase3Metrics.avgSize);
const bestSizePhase =
    [phase1Metrics.avgSize, phase2Metrics.avgSize, phase3Metrics.avgSize].indexOf(bestSize) + 1;

console.log(
    `⚡ Best speed:       Phase ${bestSpeedPhase} (${bestSpeed > 0 ? '+' : ''}${bestSpeed}ms from baseline)`
);
console.log(`📊 Best consistency: Phase ${bestVariancePhase} (${bestVariance}ms variance)`);
console.log(`💾 Best size:        Phase ${bestSizePhase} (${(bestSize / 1024).toFixed(0)} KB)`);

console.log('\n📝 PHASE 3 NOTES');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('⚠️  Tiered caching: DISABLED by default (enableTiering: false)');
console.log('✅ Request deduplication: ACTIVE on all Plex/Jellyfin requests');
console.log('💡 To enable tiering: Set enableTiering: true in CacheManager config');
console.log('📊 Deduplication benefits visible under concurrent load only');
console.log('🔧 Phase 3 optimizations require sustained load to show full impact\n');

console.log('✅ Full comparison complete\n');
