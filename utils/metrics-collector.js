/**
 * Performance Metrics Collector
 * Collects and stores performance metrics in a rolling window (7 days max)
 */

class MetricsCollector {
    constructor({ maxDataPoints = 10080, logger }) {
        // 10080 points = 7 days of 1-minute intervals
        this.maxDataPoints = maxDataPoints;
        this.logger = logger;

        // Rolling window storage
        this.requestMetrics = []; // { timestamp, latency, endpoint, statusCode }
        this.cacheMetrics = []; // { timestamp, hitRate, memoryMB, diskMB }
        this.websocketMetrics = []; // { timestamp, activeDevices, reconnects }
        this.sourceMetrics = []; // { timestamp, source, healthy, errors, latency }

        // Aggregated stats (current period)
        this.currentPeriod = {
            startTime: Date.now(),
            requestCount: 0,
            slowRequestCount: 0,
            totalLatency: 0,
            latencies: [], // For percentile calculation
        };

        // Start periodic aggregation (every 1 minute)
        this.startAggregation();
    }

    /**
     * Start periodic aggregation of metrics
     */
    startAggregation() {
        this.aggregationInterval = setInterval(() => {
            this.aggregateCurrentPeriod();
        }, 60000); // 1 minute

        // Cleanup old data every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldData();
        }, 3600000); // 1 hour
    }

    /**
     * Record a request metric
     */
    recordRequest({ latency, endpoint: _endpoint, statusCode: _statusCode }) {
        this.currentPeriod.requestCount++;
        this.currentPeriod.totalLatency += latency;
        this.currentPeriod.latencies.push(latency);

        if (latency > 2000) {
            this.currentPeriod.slowRequestCount++;
        }
    }

    /**
     * Record cache metrics snapshot
     */
    recordCache({ hitRate, memoryMB, diskMB }) {
        const dataPoint = {
            timestamp: Date.now(),
            hitRate,
            memoryMB,
            diskMB,
        };

        this.cacheMetrics.push(dataPoint);
        this.pruneArray(this.cacheMetrics);
    }

    /**
     * Record websocket metrics snapshot
     */
    recordWebSocket({ activeDevices, reconnects }) {
        const dataPoint = {
            timestamp: Date.now(),
            activeDevices,
            reconnects: reconnects || 0,
        };

        this.websocketMetrics.push(dataPoint);
        this.pruneArray(this.websocketMetrics);
    }

    /**
     * Record source health metrics
     */
    recordSource({ source, healthy, errors, latency }) {
        const dataPoint = {
            timestamp: Date.now(),
            source,
            healthy,
            errors: errors || 0,
            latency: latency || 0,
        };

        this.sourceMetrics.push(dataPoint);
        this.pruneArray(this.sourceMetrics);
    }

    /**
     * Aggregate current period and reset
     */
    aggregateCurrentPeriod() {
        const now = Date.now();
        const duration = now - this.currentPeriod.startTime;
        const requestsPerMinute = this.currentPeriod.requestCount / (duration / 60000);

        // Calculate percentiles
        const latencies = this.currentPeriod.latencies.sort((a, b) => a - b);
        const p50 = this.getPercentile(latencies, 50);
        const p95 = this.getPercentile(latencies, 95);
        const p99 = this.getPercentile(latencies, 99);
        const avg = latencies.length > 0 ? this.currentPeriod.totalLatency / latencies.length : 0;

        const dataPoint = {
            timestamp: now,
            requestCount: this.currentPeriod.requestCount,
            slowRequestCount: this.currentPeriod.slowRequestCount,
            requestsPerMinute: Math.round(requestsPerMinute * 100) / 100,
            latency: {
                avg: Math.round(avg),
                p50: Math.round(p50),
                p95: Math.round(p95),
                p99: Math.round(p99),
            },
        };

        this.requestMetrics.push(dataPoint);
        this.pruneArray(this.requestMetrics);

        // Reset current period
        this.currentPeriod = {
            startTime: now,
            requestCount: 0,
            slowRequestCount: 0,
            totalLatency: 0,
            latencies: [],
        };
    }

    /**
     * Calculate percentile from sorted array
     */
    getPercentile(sortedArray, percentile) {
        if (sortedArray.length === 0) return 0;

        const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
        return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
    }

    /**
     * Prune array to max data points
     */
    pruneArray(array) {
        if (array.length > this.maxDataPoints) {
            array.splice(0, array.length - this.maxDataPoints);
        }
    }

    /**
     * Cleanup data older than 7 days
     */
    cleanupOldData() {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        this.requestMetrics = this.requestMetrics.filter(m => m.timestamp > sevenDaysAgo);
        this.cacheMetrics = this.cacheMetrics.filter(m => m.timestamp > sevenDaysAgo);
        this.websocketMetrics = this.websocketMetrics.filter(m => m.timestamp > sevenDaysAgo);
        this.sourceMetrics = this.sourceMetrics.filter(m => m.timestamp > sevenDaysAgo);

        this.logger.debug('[MetricsCollector] Cleaned up old data', {
            requestMetrics: this.requestMetrics.length,
            cacheMetrics: this.cacheMetrics.length,
            websocketMetrics: this.websocketMetrics.length,
            sourceMetrics: this.sourceMetrics.length,
        });
    }

    /**
     * Get all metrics for dashboard
     */
    getMetrics() {
        const now = Date.now();

        return {
            timestamp: now,
            requests: {
                current: this.getCurrentRequestStats(),
                history: this.requestMetrics.slice(-168), // Last 7 days (hourly)
            },
            cache: {
                current: this.getLatestMetric(this.cacheMetrics),
                history: this.cacheMetrics.slice(-168),
            },
            websocket: {
                current: this.getLatestMetric(this.websocketMetrics),
                history: this.websocketMetrics.slice(-168),
            },
            sources: {
                current: this.getCurrentSourceStats(),
                history: this.getSourceHistory(),
            },
        };
    }

    /**
     * Get current request stats
     */
    getCurrentRequestStats() {
        if (this.requestMetrics.length === 0) {
            return {
                requestsPerMinute: 0,
                latency: { avg: 0, p50: 0, p95: 0, p99: 0 },
                slowRequestCount: 0,
            };
        }

        const latest = this.requestMetrics[this.requestMetrics.length - 1];
        return {
            requestsPerMinute: latest.requestsPerMinute || 0,
            latency: latest.latency || { avg: 0, p50: 0, p95: 0, p99: 0 },
            slowRequestCount: latest.slowRequestCount || 0,
        };
    }

    /**
     * Get current source stats (per source type)
     */
    getCurrentSourceStats() {
        const sources = {};
        const recentMetrics = this.sourceMetrics.slice(-10); // Last 10 entries

        for (const metric of recentMetrics) {
            if (!sources[metric.source]) {
                sources[metric.source] = {
                    healthy: metric.healthy,
                    errors: metric.errors,
                    avgLatency: metric.latency,
                    count: 1,
                };
            } else {
                sources[metric.source].healthy = metric.healthy;
                sources[metric.source].errors += metric.errors;
                sources[metric.source].avgLatency += metric.latency;
                sources[metric.source].count++;
            }
        }

        // Calculate averages
        for (const source in sources) {
            sources[source].avgLatency = Math.round(
                sources[source].avgLatency / sources[source].count
            );
            delete sources[source].count;
        }

        return sources;
    }

    /**
     * Get source history grouped by source
     */
    getSourceHistory() {
        const history = {};
        const recentMetrics = this.sourceMetrics.slice(-500); // Last 500 entries

        for (const metric of recentMetrics) {
            if (!history[metric.source]) {
                history[metric.source] = [];
            }
            history[metric.source].push({
                timestamp: metric.timestamp,
                healthy: metric.healthy,
                errors: metric.errors,
                latency: metric.latency,
            });
        }

        return history;
    }

    /**
     * Get latest metric from array
     */
    getLatestMetric(array) {
        if (array.length === 0) return null;
        return array[array.length - 1];
    }

    /**
     * Stop collection
     */
    stop() {
        if (this.aggregationInterval) {
            clearInterval(this.aggregationInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

module.exports = MetricsCollector;
