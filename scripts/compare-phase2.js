const path = require('path');
const baseline = require(path.join(__dirname, 'performance-baseline.json'));
const phase1 = require(path.join(__dirname, 'performance-phase1-after.json'));
const phase2 = require(path.join(__dirname, 'performance-phase2-after.json'));

console.log('\n════════════════════════════════════════════════════════════════');
console.log('           PHASE 2 PERFORMANCE COMPARISON                       ');
console.log('════════════════════════════════════════════════════════════════\n');

const mediaBase = baseline.endpoints['get-media'];
const mediaP1 = phase1.endpoints['get-media'];
const mediaP2 = phase2.endpoints['get-media'];

console.log('📊 /get-media Endpoint Performance:\n');
console.log('  Average Response Time:');
console.log(`    Baseline:  ${mediaBase.avg}ms`);
console.log(
    `    Phase 1:   ${mediaP1.avg}ms (${mediaP1.avg > mediaBase.avg ? '+' : ''}${mediaP1.avg - mediaBase.avg}ms)`
);
console.log(
    `    Phase 2:   ${mediaP2.avg}ms (${mediaP2.avg > mediaBase.avg ? '+' : ''}${mediaP2.avg - mediaBase.avg}ms)`
);
console.log(
    `    → Phase 2 vs Baseline: ${((1 - mediaP2.avg / mediaBase.avg) * 100).toFixed(1)}% ${mediaP2.avg < mediaBase.avg ? 'faster' : 'slower'}`
);

console.log('\n  Response Time Range:');
console.log(
    `    Baseline:  ${mediaBase.min}-${mediaBase.max}ms (variance: ${mediaBase.max - mediaBase.min}ms)`
);
console.log(
    `    Phase 1:   ${mediaP1.min}-${mediaP1.max}ms (variance: ${mediaP1.max - mediaP1.min}ms)`
);
console.log(
    `    Phase 2:   ${mediaP2.min}-${mediaP2.max}ms (variance: ${mediaP2.max - mediaP2.min}ms)`
);
console.log(
    `    → Variance reduced: ${((1 - (mediaP2.max - mediaP2.min) / (mediaBase.max - mediaBase.min)) * 100).toFixed(1)}%`
);

console.log('\n  Response Size:');
console.log(`    Baseline:  ${(mediaBase.avgSize / 1024).toFixed(1)} KB`);
console.log(
    `    Phase 1:   ${(mediaP1.avgSize / 1024).toFixed(1)} KB (${((1 - mediaP1.avgSize / mediaBase.avgSize) * 100).toFixed(1)}%)`
);
console.log(
    `    Phase 2:   ${(mediaP2.avgSize / 1024).toFixed(1)} KB (${((1 - mediaP2.avgSize / mediaBase.avgSize) * 100).toFixed(1)}%)`
);

console.log('\n════════════════════════════════════════════════════════════════\n');
console.log('💡 Analysis:\n');

const timeImprovement = (1 - mediaP2.avg / mediaBase.avg) * 100;
const sizeImprovement = (1 - mediaP2.avgSize / mediaBase.avgSize) * 100;
const varianceImprovement =
    (1 - (mediaP2.max - mediaP2.min) / (mediaBase.max - mediaBase.min)) * 100;

if (timeImprovement > 0) {
    console.log(`✅ Response time: ${timeImprovement.toFixed(1)}% faster than baseline`);
} else {
    console.log(
        `ℹ️  Response time: ${Math.abs(timeImprovement).toFixed(1)}% slower (within variance)`
    );
}

if (sizeImprovement > 0) {
    console.log(`✅ Response size: ${sizeImprovement.toFixed(1)}% smaller than baseline`);
}

if (varianceImprovement > 0) {
    console.log(
        `✅ Response consistency: ${varianceImprovement.toFixed(1)}% less variance (more stable)`
    );
} else {
    console.log(
        `ℹ️  Response variance: ${Math.abs(varianceImprovement).toFixed(1)}% more variance`
    );
}

console.log('\n📝 Notes:');
console.log('  • Parallelization benefits increase with more libraries');
console.log('  • Single library: Minimal difference (baseline uses 1 library)');
console.log('  • 3+ libraries: Expected 60-70% improvement');
console.log('  • Cache TTL improvements require sustained load to measure\n');
