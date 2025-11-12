#!/usr/bin/env node
/**
 * Baseline Performance Metrics Capture Script
 *
 * Captures current performance metrics for comparison after optimizations.
 * Outputs metrics to console and optionally saves to file.
 *
 * Usage:
 *   node scripts/baseline-metrics.js [--save] [--output=FILE]
 *
 * Options:
 *   --save          Save metrics to file (default: performance-baseline.json)
 *   --output=FILE   Custom output file path
 *   --pretty        Pretty-print JSON output
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const OUTPUT_FILE = 'performance-baseline.json';

// Parse CLI arguments
const args = process.argv.slice(2);
const shouldSave = args.includes('--save');
const prettyPrint = args.includes('--pretty');
const customOutput = args.find(arg => arg.startsWith('--output='))?.split('=')[1];

/**
 * Measure response time for an endpoint
 */
async function measureResponseTime(url, options = {}) {
    const start = Date.now();
    try {
        const response = await axios({
            url: `${BASE_URL}${url}`,
            method: options.method || 'GET',
            timeout: 30000,
            ...options,
        });
        const duration = Date.now() - start;
        return {
            success: true,
            duration,
            statusCode: response.status,
            size: JSON.stringify(response.data).length,
        };
    } catch (error) {
        return {
            success: false,
            duration: Date.now() - start,
            error: error.message,
        };
    }
}

/**
 * Get performance metrics (includes cache stats, source metrics, system info)
 */
async function getPerformanceMetrics() {
    try {
        const response = await axios.get(`${BASE_URL}/api/admin/performance/metrics`, {
            headers: {
                Cookie: process.env.SESSION_COOKIE || '',
            },
        });
        return response.data.data;
    } catch (error) {
        console.error(
            'Warning: Could not fetch performance metrics (auth required):',
            error.message
        );
        return null;
    }
}

/**
 * Sample API response times multiple times
 */
async function sampleEndpoint(url, samples = 5) {
    console.log(`  Sampling ${url} (${samples}x)...`);
    const results = [];

    for (let i = 0; i < samples; i++) {
        const result = await measureResponseTime(url);
        results.push(result);
        // Wait 200ms between samples
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    const successfulResults = results.filter(r => r.success);
    const durations = successfulResults.map(r => r.duration);

    if (durations.length === 0) {
        return {
            success: false,
            samples: 0,
            error: 'All requests failed',
        };
    }

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const median = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)];

    return {
        success: true,
        samples: durations.length,
        avg: Math.round(avg),
        min,
        max,
        median,
        avgSize: Math.round(
            successfulResults.reduce((a, b) => a + b.size, 0) / successfulResults.length
        ),
    };
}

/**
 * Main baseline capture
 */
async function captureBaseline() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  Posterrama Performance Baseline Metrics Capture       ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    const baseline = {
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        endpoints: {},
        performance: null,
        system: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
        },
    };

    // 1. Health check
    console.log('📡 Testing connectivity...');
    const health = await measureResponseTime('/health');
    if (!health.success) {
        console.error('❌ Server not responding at', BASE_URL);
        console.error('   Make sure Posterrama is running and BASE_URL is correct');
        process.exit(1);
    }
    console.log('✅ Server online\n');

    // 2. Sample key endpoints
    console.log('⏱️  Measuring API response times...');

    const endpointsToTest = [
        { name: 'health', url: '/health' },
        { name: 'get-config', url: '/get-config' },
        { name: 'get-media', url: '/get-media?type=movie&count=50' },
        { name: 'device-list', url: '/api/devices' },
    ];

    for (const endpoint of endpointsToTest) {
        const result = await sampleEndpoint(endpoint.url, 5);
        baseline.endpoints[endpoint.name] = result;

        if (result.success) {
            console.log(
                `  ✓ ${endpoint.name}: ${result.avg}ms avg (${result.min}-${result.max}ms)`
            );
        } else {
            console.log(`  ✗ ${endpoint.name}: ${result.error}`);
        }
    }

    console.log();

    // 3. Performance metrics (cache, sources, system)
    console.log('📊 Fetching performance metrics...');
    baseline.performance = await getPerformanceMetrics();
    if (baseline.performance) {
        // Cache stats
        const apiCache = baseline.performance.cache?.api;
        if (apiCache) {
            console.log(`  Cache (API):`);
            console.log(`    Hit rate: ${(apiCache.hitRate * 100).toFixed(1)}%`);
            console.log(
                `    Requests: ${apiCache.totalRequests} (${apiCache.hits} hits / ${apiCache.misses} misses)`
            );
            console.log(`    Size: ${apiCache.size} entries`);
        }

        const mainCache = baseline.performance.cache?.main;
        if (mainCache) {
            console.log(`  Cache (Main):`);
            console.log(`    Hit rate: ${(mainCache.hitRate * 100).toFixed(1)}%`);
            console.log(`    Size: ${mainCache.size} entries`);
        }

        // Source metrics
        if (baseline.performance.sources) {
            const sources = baseline.performance.sources;
            console.log(`  Media Sources:`);
            if (sources.plex) {
                const plexNames = Object.keys(sources.plex);
                console.log(`    Plex: ${plexNames.length} server(s)`);
            }
            if (sources.jellyfin) {
                const jellyNames = Object.keys(sources.jellyfin);
                console.log(`    Jellyfin: ${jellyNames.length} server(s)`);
            }
            if (sources.tmdb) {
                console.log(`    TMDB: ${sources.tmdb.requestCount || 0} requests`);
            }
            if (sources.local) {
                console.log(`    Local: ${sources.local.totalItems || 0} items`);
            }
        }

        // System info
        if (baseline.performance.system) {
            const sys = baseline.performance.system;
            console.log(`  System:`);
            console.log(`    Memory: ${sys.memory?.heapUsed}MB / ${sys.memory?.heapTotal}MB`);
            console.log(`    Uptime: ${sys.uptime?.formatted}`);
        }
    } else {
        console.log('  ⚠️  Performance metrics not available (requires authentication)');
        console.log('  💡  Set SESSION_COOKIE environment variable for authenticated endpoints');
    }

    console.log();

    // 4. Summary
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('📊 BASELINE SUMMARY\n');

    const mediaEndpoint = baseline.endpoints['get-media'];
    if (mediaEndpoint && mediaEndpoint.success) {
        console.log(`Primary endpoint (/get-media):`);
        console.log(`  • Average response time: ${mediaEndpoint.avg}ms`);
        console.log(`  • Response time range: ${mediaEndpoint.min}-${mediaEndpoint.max}ms`);
        console.log(`  • Average response size: ${(mediaEndpoint.avgSize / 1024).toFixed(1)}KB`);
    }

    if (baseline.performance?.cache?.api) {
        const apiCache = baseline.performance.cache.api;
        console.log(`\nCache performance:`);
        console.log(`  • API Cache hit rate: ${(apiCache.hitRate * 100).toFixed(1)}%`);
        console.log(`  • Total requests: ${apiCache.totalRequests}`);
        console.log(`  • Hits: ${apiCache.hits}, Misses: ${apiCache.misses}`);

        if (baseline.performance.cache.main) {
            const mainCache = baseline.performance.cache.main;
            console.log(`  • Main Cache hit rate: ${(mainCache.hitRate * 100).toFixed(1)}%`);
            console.log(`  • Main Cache size: ${mainCache.size} entries`);
        }
    }

    console.log('\n═══════════════════════════════════════════════════════\n');

    // 5. Save to file if requested
    if (shouldSave) {
        const outputPath = customOutput || OUTPUT_FILE;
        const outputFullPath = path.resolve(outputPath);

        const jsonContent = prettyPrint
            ? JSON.stringify(baseline, null, 2)
            : JSON.stringify(baseline);

        await fs.writeFile(outputFullPath, jsonContent, 'utf8');
        console.log(`💾 Baseline saved to: ${outputFullPath}\n`);
    } else {
        console.log('💡 Tip: Use --save to save these metrics to a file\n');
    }

    return baseline;
}

/**
 * Run capture
 */
if (require.main === module) {
    captureBaseline()
        .then(() => {
            console.log('✅ Baseline capture complete\n');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Error capturing baseline:', error.message);
            if (error.response) {
                console.error('   Status:', error.response.status);
                console.error('   Data:', error.response.data);
            }
            process.exit(1);
        });
}

module.exports = { captureBaseline, measureResponseTime, sampleEndpoint, getPerformanceMetrics };
