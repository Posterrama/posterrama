#!/usr/bin/env node
/**
 * Performance Monitoring - Continuous performance regression detection
 * Measures key metrics and compares against baselines
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'http://localhost:4000';
const BASELINE_FILE = path.join(__dirname, '../../__tests__/regression/performance-baseline.json');

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
    '/api/health': { max: 50, warning: 30 },
    '/get-config': { max: 200, warning: 100 },
    '/api/posters': { max: 500, warning: 300 },
};

class PerformanceMonitor {
    constructor() {
        this.baseline = this.loadBaseline();
        this.results = [];
    }

    loadBaseline() {
        try {
            if (fs.existsSync(BASELINE_FILE)) {
                return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
            }
        } catch (err) {
            console.warn('⚠️  No baseline found, creating new baseline');
        }
        return {};
    }

    saveBaseline() {
        const dir = path.dirname(BASELINE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(BASELINE_FILE, JSON.stringify(this.baseline, null, 2));
        console.log(`\n💾 Baseline saved to ${BASELINE_FILE}`);
    }

    async measureEndpoint(endpoint, iterations = 5) {
        console.log(`\n📊 Measuring: ${endpoint} (${iterations} iterations)`);

        const timings = [];
        for (let i = 0; i < iterations; i++) {
            const start = Date.now();
            try {
                await this.makeRequest(endpoint);
                const duration = Date.now() - start;
                timings.push(duration);
                process.stdout.write('.');
            } catch (err) {
                console.error(`\n❌ Request failed: ${err.message}`);
                return null;
            }
        }

        console.log(''); // New line after dots

        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        const min = Math.min(...timings);
        const max = Math.max(...timings);
        const p95 = this.percentile(timings, 95);

        return { endpoint, avg, min, max, p95, timings };
    }

    makeRequest(path) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, BASE_URL);
            const req = http.get(
                {
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    timeout: 10000,
                },
                res => {
                    let body = '';
                    res.on('data', chunk => (body += chunk));
                    res.on('end', () => resolve({ statusCode: res.statusCode, body }));
                }
            );
            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Timeout')));
        });
    }

    percentile(arr, p) {
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil((sorted.length * p) / 100) - 1;
        return sorted[index];
    }

    analyzeResults(result) {
        const { endpoint, avg, p95 } = result;
        const threshold = THRESHOLDS[endpoint];
        const baseline = this.baseline[endpoint];

        console.log(`   Average: ${avg.toFixed(2)}ms`);
        console.log(`   Min: ${result.min}ms | Max: ${result.max}ms | P95: ${p95.toFixed(2)}ms`);

        // Check against thresholds
        if (threshold) {
            if (avg > threshold.max) {
                console.log(`   ❌ FAIL: Exceeded max threshold (${threshold.max}ms)`);
                return 'FAIL';
            } else if (avg > threshold.warning) {
                console.log(`   ⚠️  WARNING: Above warning threshold (${threshold.warning}ms)`);
            } else {
                console.log(`   ✅ PASS: Within thresholds`);
            }
        }

        // Compare to baseline
        if (baseline && baseline.avg) {
            const change = ((avg - baseline.avg) / baseline.avg) * 100;
            const symbol = change > 0 ? '📈' : '📉';
            console.log(
                `   ${symbol} vs Baseline: ${change.toFixed(1)}% (was ${baseline.avg.toFixed(2)}ms)`
            );

            if (Math.abs(change) > 20) {
                console.log(`   ⚠️  WARNING: >20% performance change detected`);
                return 'WARNING';
            }
        } else {
            console.log(`   📝 No baseline - this will be the new baseline`);
        }

        return 'PASS';
    }

    async run(updateBaseline = false) {
        console.log('🚀 Performance Monitoring Suite');
        console.log(`📡 Target: ${BASE_URL}\n`);

        const endpoints = Object.keys(THRESHOLDS);
        let hasFailures = false;

        for (const endpoint of endpoints) {
            const result = await this.measureEndpoint(endpoint);
            if (!result) {
                hasFailures = true;
                continue;
            }

            this.results.push(result);
            const status = this.analyzeResults(result);

            if (status === 'FAIL') {
                hasFailures = true;
            }

            if (updateBaseline) {
                this.baseline[endpoint] = {
                    avg: result.avg,
                    p95: result.p95,
                    timestamp: new Date().toISOString(),
                };
            }
        }

        if (updateBaseline) {
            this.saveBaseline();
        }

        this.printSummary();

        if (hasFailures) {
            console.log('\n❌ Performance tests FAILED');
            process.exit(1);
        }
    }

    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 Performance Summary');
        console.log('='.repeat(60));
        this.results.forEach(r => {
            console.log(`${r.endpoint}: ${r.avg.toFixed(2)}ms avg (P95: ${r.p95.toFixed(2)}ms)`);
        });
        console.log('='.repeat(60));
    }
}

// Main
const monitor = new PerformanceMonitor();
const updateBaseline = process.argv.includes('--update-baseline');

monitor.run(updateBaseline).catch(err => {
    console.error('\n💥 Performance monitoring failed:', err.message);
    process.exit(1);
});
