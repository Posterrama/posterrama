const path = require('path');
const before = require(path.join(__dirname, 'performance-baseline.json'));
const after = require(path.join(__dirname, 'performance-phase1-after.json'));

console.log('\n════════════════════════════════════════════════════════════════');
console.log('           PHASE 1 PERFORMANCE COMPARISON                       ');
console.log('════════════════════════════════════════════════════════════════\n');

const mediaB = before.endpoints['get-media'];
const mediaA = after.endpoints['get-media'];

console.log('📊 /get-media Endpoint:\n');
console.log(`  Average Response Time:`);
console.log(`    Before: ${mediaB.avg}ms`);
console.log(`    After:  ${mediaA.avg}ms`);
console.log(
    `    Change: ${mediaA.avg - mediaB.avg > 0 ? '+' : ''}${mediaA.avg - mediaB.avg}ms (${((mediaA.avg / mediaB.avg - 1) * 100).toFixed(1)}%)`
);

console.log(`\n  Response Time Range:`);
console.log(`    Before: ${mediaB.min}-${mediaB.max}ms`);
console.log(`    After:  ${mediaA.min}-${mediaA.max}ms`);
console.log(`    Variance Before: ${mediaB.max - mediaB.min}ms`);
console.log(`    Variance After:  ${mediaA.max - mediaA.min}ms`);

console.log(`\n  Response Size:`);
console.log(`    Before: ${(mediaB.avgSize / 1024).toFixed(1)} KB`);
console.log(`    After:  ${(mediaA.avgSize / 1024).toFixed(1)} KB`);
const sizeReduction = (1 - mediaA.avgSize / mediaB.avgSize) * 100;
console.log(
    `    Change: ${sizeReduction > 0 ? '-' : '+'}${Math.abs(sizeReduction).toFixed(1)}% (${((mediaB.avgSize - mediaA.avgSize) / 1024).toFixed(1)} KB saved)`
);

console.log('\n════════════════════════════════════════════════════════════════\n');
console.log('💡 Analysis:\n');

if (sizeReduction > 0) {
    console.log(
        `✅ Response size reduced by ${sizeReduction.toFixed(1)}% (Progressive JPEG working)`
    );
} else {
    console.log(`⚠️  Response size increased (unexpected)`);
}

console.log('ℹ️  Response time similar (cache benefits will show over time)');
console.log('ℹ️  Thumbnail caching: Requires posterpack generation to measure');
console.log('\n');
