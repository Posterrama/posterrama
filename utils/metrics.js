const os = require('os');
const process = require('process');

class MetricsManager {
    constructor(startTime) {
        // Allow injection of startTime for deterministic tests; fallback to Date.now()
        this.startTime = typeof startTime === 'number' ? startTime : Date.now();
        this.requestMetrics = new Map(); // endpoint -> { count, totalTime, errors, responses }
        this.systemMetrics = {
            totalRequests: 0,
            totalErrors: 0,
            responseTimeHistory: [],
            errorHistory: [],
            cacheStats: { hits: 0, misses: 0 },
        };
        this.endpointStats = new Map();
        this.historicalData = [];
        this.config = {
            enabled: true,
            collectInterval: 60000,
            retentionPeriod: 86400000,
            maxHistoryPoints: 1440, // 24 hours of minute-by-minute data
        };

        // Internal samplers for CPU calculations
        this._lastSystemCpuTimes = null; // { idle, total }
        this._lastProcessCpu = null; // result of process.cpuUsage()
        this._lastHrtime = null; // result of process.hrtime()

        // Avoid background timers automatically in test environment to prevent noisy failures & open handles
        if (process.env.NODE_ENV !== 'test') {
            this.startMetricsCollection();
        }
    }

    // Record a request
    recordRequest(method, path, responseTime, statusCode, cached = false) {
        if (!this.config.enabled) return;

        const endpoint = `${method} ${path}`;
        const isError = statusCode >= 400;

        // Update endpoint-specific metrics
        if (!this.requestMetrics.has(endpoint)) {
            this.requestMetrics.set(endpoint, {
                count: 0,
                totalTime: 0,
                errors: 0,
                responses: [],
            });
        }

        const endpointData = this.requestMetrics.get(endpoint);
        endpointData.count++;
        endpointData.totalTime += responseTime;
        endpointData.responses.push({ time: Date.now(), responseTime, statusCode, cached });

        if (isError) {
            endpointData.errors++;
            this.systemMetrics.totalErrors++;
            this.systemMetrics.errorHistory.push({
                timestamp: Date.now(),
                statusCode,
                endpoint,
                responseTime,
            });
        }

        // Update system-wide metrics
        this.systemMetrics.totalRequests++;
        this.systemMetrics.responseTimeHistory.push({
            timestamp: Date.now(),
            responseTime,
            endpoint,
            statusCode,
            cached,
        });

        // Update cache stats
        if (cached) {
            this.systemMetrics.cacheStats.hits++;
        } else {
            this.systemMetrics.cacheStats.misses++;
        }

        // Keep history manageable
        this.trimHistory();
    }

    // Record cache events
    recordCacheEvent(type, _key) {
        if (!this.config.enabled) return;

        if (type === 'hit') {
            this.systemMetrics.cacheStats.hits++;
        } else if (type === 'miss') {
            this.systemMetrics.cacheStats.misses++;
        }
    }

    // Get performance metrics
    getPerformanceMetrics() {
        const responseTimes = this.systemMetrics.responseTimeHistory
            .filter(r => Date.now() - r.timestamp < 3600000) // Last hour
            .map(r => r.responseTime)
            .sort((a, b) => a - b);

        if (responseTimes.length === 0) {
            return {
                responseTime: {
                    average: 0,
                    median: 0,
                    p95: 0,
                    p99: 0,
                },
            };
        }

        const average = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const median = responseTimes[Math.floor(responseTimes.length / 2)];
        const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
        const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];

        return {
            responseTime: {
                average: Math.round(average * 100) / 100,
                median,
                p95,
                p99,
            },
        };
    }

    // Get endpoint metrics
    getEndpointMetrics() {
        const endpoints = [];

        for (const [endpoint, data] of this.requestMetrics.entries()) {
            const averageResponseTime = data.count > 0 ? data.totalTime / data.count : 0;
            const errorRate = data.count > 0 ? (data.errors / data.count) * 100 : 0;

            endpoints.push({
                path: endpoint,
                requestCount: data.count,
                averageResponseTime: Math.round(averageResponseTime * 100) / 100,
                errorRate: Math.round(errorRate * 100) / 100,
                totalErrors: data.errors,
            });
        }

        return { endpoints };
    }

    // Get error metrics
    getErrorMetrics() {
        const recentErrors = this.systemMetrics.errorHistory.filter(
            e => Date.now() - e.timestamp < 3600000
        ); // Last hour

        const errorsByStatus = {};
        recentErrors.forEach(error => {
            errorsByStatus[error.statusCode] = (errorsByStatus[error.statusCode] || 0) + 1;
        });

        const totalRequests = this.systemMetrics.responseTimeHistory.filter(
            r => Date.now() - r.timestamp < 3600000
        ).length;

        const errorRate = totalRequests > 0 ? (recentErrors.length / totalRequests) * 100 : 0;

        return {
            errorRate: Math.round(errorRate * 100) / 100,
            totalErrors: recentErrors.length,
            errorsByStatus,
        };
    }

    // Get cache metrics
    getCacheMetrics() {
        const { hits, misses } = this.systemMetrics.cacheStats;
        const total = hits + misses;

        return {
            hitRate: total > 0 ? Math.round((hits / total) * 10000) / 100 : 0,
            missRate: total > 0 ? Math.round((misses / total) * 10000) / 100 : 0,
            totalHits: hits,
            totalMisses: misses,
        };
    }

    // Get system metrics
    getSystemMetrics() {
        const memUsage = process.memoryUsage();
        const uptime = Date.now() - this.startTime;

        // CPU usage percentages (system and process) computed via time-delta sampling
        const cpuStats = this.getCpuUsage();

        return {
            memory: {
                used: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100, // MB
                total: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100, // MB
                percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 10000) / 100,
            },
            cpu: {
                // Keep backward compatibility: usage == overall system percent
                usage: Math.round(cpuStats.systemPercent * 100) / 100,
                percent: Math.round(cpuStats.systemPercent * 100) / 100,
                system: Math.round(cpuStats.systemPercent * 100) / 100,
                process: Math.round(cpuStats.processPercent * 100) / 100,
                loadAverage: cpuStats.loadAverage1m,
                cores: cpuStats.cores,
            },
            uptime: Math.round(uptime / 1000), // seconds
        };
    }

    // Get real-time metrics
    getRealTimeMetrics() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        const recentRequests = this.systemMetrics.responseTimeHistory.filter(
            r => r.timestamp > oneMinuteAgo
        );

        return {
            activeConnections: this.getActiveConnections(),
            requestsPerMinute: recentRequests.length,
            timestamp: now,
        };
    }

    // Get historical metrics
    getHistoricalMetrics(period = '1h') {
        const now = Date.now();
        let timeRange;
        let intervalMs;

        switch (period) {
            case '15m':
                timeRange = 15 * 60 * 1000;
                intervalMs = 60 * 1000; // 1 minute intervals
                break;
            case '1h':
                timeRange = 60 * 60 * 1000;
                intervalMs = 5 * 60 * 1000; // 5 minute intervals
                break;
            case '6h':
                timeRange = 6 * 60 * 60 * 1000;
                intervalMs = 30 * 60 * 1000; // 30 minute intervals
                break;
            case '24h':
                timeRange = 24 * 60 * 60 * 1000;
                intervalMs = 60 * 60 * 1000; // 1 hour intervals
                break;
            default:
                timeRange = 60 * 60 * 1000;
                intervalMs = 5 * 60 * 1000;
        }

        const startTime = now - timeRange;
        const dataPoints = [];

        for (let time = startTime; time < now; time += intervalMs) {
            const endTime = time + intervalMs;
            const periodData = this.systemMetrics.responseTimeHistory.filter(
                r => r.timestamp >= time && r.timestamp < endTime
            );

            const errors = periodData.filter(r => r.statusCode >= 400).length;
            const avgResponseTime =
                periodData.length > 0
                    ? periodData.reduce((sum, r) => sum + r.responseTime, 0) / periodData.length
                    : 0;

            dataPoints.push({
                timestamp: time,
                requests: periodData.length,
                errors,
                avgResponseTime: Math.round(avgResponseTime * 100) / 100,
                errorRate: periodData.length > 0 ? (errors / periodData.length) * 100 : 0,
            });
        }

        return {
            period,
            dataPoints,
        };
    }

    // Get dashboard summary
    getDashboardSummary() {
        const performanceMetrics = this.getPerformanceMetrics();
        const errorMetrics = this.getErrorMetrics();
        const systemMetrics = this.getSystemMetrics();

        return {
            summary: {
                totalRequests: this.systemMetrics.totalRequests,
                averageResponseTime: performanceMetrics.responseTime.average,
                errorRate: errorMetrics.errorRate,
                uptime: systemMetrics.uptime,
            },
        };
    }

    // Export metrics in different formats
    exportMetrics(format = 'json') {
        const metrics = {
            performance: this.getPerformanceMetrics(),
            endpoints: this.getEndpointMetrics(),
            errors: this.getErrorMetrics(),
            cache: this.getCacheMetrics(),
            system: this.getSystemMetrics(),
            realtime: this.getRealTimeMetrics(),
        };

        if (format === 'prometheus') {
            return this.toPrometheusFormat(metrics);
        }

        return {
            metrics,
            timestamp: Date.now(),
            format,
        };
    }

    // Convert to Prometheus format
    toPrometheusFormat(metrics) {
        let prometheus = '';

        // Response time metrics
        prometheus += '# HELP http_request_duration_seconds HTTP request duration in seconds\n';
        prometheus += '# TYPE http_request_duration_seconds histogram\n';
        prometheus += `http_request_duration_seconds_sum ${metrics.performance.responseTime.average / 1000}\n`;
        prometheus += `http_request_duration_seconds_count ${this.systemMetrics.totalRequests}\n`;

        // Request count
        prometheus += '# HELP http_requests_total Total number of HTTP requests\n';
        prometheus += '# TYPE http_requests_total counter\n';
        prometheus += `http_requests_total ${this.systemMetrics.totalRequests}\n`;

        // Error rate
        prometheus += '# HELP http_request_errors_total Total number of HTTP request errors\n';
        prometheus += '# TYPE http_request_errors_total counter\n';
        prometheus += `http_request_errors_total ${this.systemMetrics.totalErrors}\n`;

        // Memory usage
        prometheus += '# HELP process_resident_memory_bytes Resident memory size in bytes\n';
        prometheus += '# TYPE process_resident_memory_bytes gauge\n';
        prometheus += `process_resident_memory_bytes ${metrics.system.memory.used * 1024 * 1024}\n`;

        // CPU usage
        prometheus += '# HELP process_cpu_usage_percent CPU usage percentage\n';
        prometheus += '# TYPE process_cpu_usage_percent gauge\n';
        prometheus += `process_cpu_usage_percent ${metrics.system.cpu.usage}\n`;

        // Cache metrics
        prometheus += '# HELP cache_hits_total Total cache hits\n';
        prometheus += '# TYPE cache_hits_total counter\n';
        prometheus += `cache_hits_total ${metrics.cache.totalHits}\n`;

        prometheus += '# HELP cache_misses_total Total cache misses\n';
        prometheus += '# TYPE cache_misses_total counter\n';
        prometheus += `cache_misses_total ${metrics.cache.totalMisses}\n`;

        return prometheus;
    }

    // Update configuration
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };

        // Restart collection if interval changed
        if (newConfig.collectInterval) {
            this.startMetricsCollection();
        }
    }

    // Helper methods
    // Compute CPU usage using deltas over time to better match OS tools
    getCpuUsage() {
        // Defaults
        let cores = 1;
        try {
            const cpuInfo = typeof os.cpus === 'function' ? os.cpus() : [];
            if (Array.isArray(cpuInfo) && cpuInfo.length) cores = cpuInfo.length;
        } catch (_) {
            cores = 1;
        }
        if (cores <= 0) cores = 1;

        // Load average (1 minute) as supplemental info
        let loadAverage1m = 0;
        try {
            const la = typeof os.loadavg === 'function' ? os.loadavg() : [0];
            if (Array.isArray(la) && la.length) loadAverage1m = Number(la[0]) || 0;
        } catch (_) {
            loadAverage1m = 0;
        }

        // Aggregate current system CPU times
        const currentTimes = this._readSystemCpuTimes();

        // Initialize sampling windows if needed
        if (!this._lastSystemCpuTimes || !this._lastHrtime || !this._lastProcessCpu) {
            this._lastSystemCpuTimes = currentTimes;
            this._lastHrtime = process.hrtime();
            this._lastProcessCpu = process.cpuUsage();
            return {
                systemPercent: Math.min((loadAverage1m / cores) * 100, 100),
                processPercent: 0,
                loadAverage1m,
                cores,
            };
        }

        // Calculate deltas
        const prevTimes = this._lastSystemCpuTimes;
        const idleDelta = currentTimes.idle - prevTimes.idle;
        const totalDelta = currentTimes.total - prevTimes.total;
        let systemPercent = 0;
        if (totalDelta > 0) {
            systemPercent = (1 - idleDelta / totalDelta) * 100;
        }

        // Process CPU percent over wall time and cores
        const hrDelta = process.hrtime(this._lastHrtime);
        const elapsedMicros = hrDelta[0] * 1e6 + hrDelta[1] / 1e3; // wall time in microseconds
        const procDelta = process.cpuUsage(this._lastProcessCpu); // microseconds used by process since last sample
        const usedMicros = (procDelta.user || 0) + (procDelta.system || 0);
        let processPercent = 0;
        if (elapsedMicros > 0) {
            processPercent = (usedMicros / (elapsedMicros * cores)) * 100;
        }

        // Update baselines for next call
        this._lastSystemCpuTimes = currentTimes;
        this._lastHrtime = process.hrtime();
        this._lastProcessCpu = process.cpuUsage();

        // Clamp values to [0, 100]
        systemPercent = Math.max(0, Math.min(100, systemPercent));
        processPercent = Math.max(0, Math.min(100, processPercent));

        return { systemPercent, processPercent, loadAverage1m, cores };
    }

    // Backward-compatible helper returning overall CPU usage percent
    // Tests expect this to reflect load-average based estimate on first call
    getCpuUsagePercent() {
        try {
            const stats = this.getCpuUsage();
            // Keep two decimals without introducing floating drift
            return Math.round(stats.systemPercent * 100) / 100;
        } catch (_) {
            return 0;
        }
    }

    _readSystemCpuTimes() {
        try {
            const cpuInfo = typeof os.cpus === 'function' ? os.cpus() : [];
            if (!Array.isArray(cpuInfo) || cpuInfo.length === 0) {
                return { idle: 0, total: 1 }; // avoid division by zero
            }
            let idle = 0;
            let total = 0;
            for (const cpu of cpuInfo) {
                const t = cpu.times || {};
                const i = Number(t.idle || 0);
                const s = Number(t.sys || t.system || 0);
                const u = Number(t.user || 0);
                const n = Number(t.nice || 0);
                const irq = Number(t.irq || 0);
                idle += i;
                total += i + s + u + n + irq;
            }
            return { idle, total };
        } catch (_) {
            // Fallback that avoids NaN in case os.cpus() throws
            return { idle: 0, total: 1 };
        }
    }

    getActiveConnections() {
        // This is a placeholder - in a real implementation,
        // you'd track actual connection counts
        return Math.floor(Math.random() * 10) + 1;
    }

    trimHistory() {
        const maxAge = this.config.retentionPeriod;
        const cutoff = Date.now() - maxAge;

        // Trim response time history
        this.systemMetrics.responseTimeHistory = this.systemMetrics.responseTimeHistory.filter(
            r => r.timestamp > cutoff
        );

        // Trim error history
        this.systemMetrics.errorHistory = this.systemMetrics.errorHistory.filter(
            e => e.timestamp > cutoff
        );

        // Trim endpoint response history
        for (const [, data] of this.requestMetrics.entries()) {
            data.responses = data.responses.filter(r => r.time > cutoff);
        }
    }

    startMetricsCollection() {
        if (this.collectionInterval) {
            clearInterval(this.collectionInterval);
        }

        // Skip creating intervals when disabled or in test environment unless explicitly invoked by tests
        if (process.env.NODE_ENV === 'test') {
            return; // Tests that need this can set NODE_ENV differently or call with env adjusted
        }

        this.collectionInterval = setInterval(() => {
            if (this.config.enabled) {
                // Collect periodic system metrics
                const systemMetrics = this.getSystemMetrics();
                this.historicalData.push({
                    timestamp: Date.now(),
                    ...systemMetrics,
                });

                // Keep historical data manageable
                if (this.historicalData.length > this.config.maxHistoryPoints) {
                    this.historicalData = this.historicalData.slice(-this.config.maxHistoryPoints);
                }
            }
        }, this.config.collectInterval);
    }

    // Reset all metrics
    reset() {
        this.requestMetrics.clear();
        this.systemMetrics = {
            totalRequests: 0,
            totalErrors: 0,
            responseTimeHistory: [],
            errorHistory: [],
            cacheStats: { hits: 0, misses: 0 },
        };
        this.endpointStats.clear();
        this.historicalData = [];
    }

    // Get metrics for specific endpoint
    getEndpointMetric(endpoint) {
        return this.requestMetrics.get(endpoint) || null;
    }

    // Shutdown helper for graceful test teardown
    shutdown() {
        if (this.collectionInterval) clearInterval(this.collectionInterval);
    }

    // Testing helper to realign start time with mocked Date.now
    _resetStartTime() {
        this.startTime = Date.now();
    }
    _setStartTime(ts) {
        this.startTime = ts;
    }
}

// Create singleton instance (default)
const metricsManager = new MetricsManager();

module.exports = metricsManager;
// Also export the class for tests that need a fresh instance with controlled start time
module.exports.constructor = MetricsManager;
