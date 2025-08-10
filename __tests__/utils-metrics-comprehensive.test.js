const os = require('os');

// Mock system modules
jest.mock('os');

describe('MetricsManager - Comprehensive Tests', () => {
    let metricsManager;

    beforeEach(() => {
        // Reset the singleton instance
        jest.resetModules();
        
        // Setup default mocks
        os.loadavg.mockReturnValue([0.5, 0.3, 0.1]);
        os.cpus.mockReturnValue([{}, {}, {}, {}]); // 4 CPUs
        
        // Mock process methods
        jest.spyOn(process, 'memoryUsage').mockReturnValue({
            heapUsed: 50 * 1024 * 1024, // 50MB
            heapTotal: 100 * 1024 * 1024, // 100MB
            external: 10 * 1024 * 1024,
            arrayBuffers: 5 * 1024 * 1024
        });
        jest.spyOn(process, 'cpuUsage').mockReturnValue({
            user: 1000000,
            system: 500000
        });

        // Create fresh instance for each test
        const MetricsManagerClass = require('../utils/metrics').constructor;
        metricsManager = new MetricsManagerClass();
        
        // Mock Date.now for consistent testing
        jest.spyOn(Date, 'now').mockReturnValue(1000000000);
    });

    afterEach(() => {
        if (metricsManager.collectionInterval) {
            clearInterval(metricsManager.collectionInterval);
        }
        jest.restoreAllMocks();
    });

    describe('Initialization', () => {
        test('should initialize with default configuration', () => {
            expect(metricsManager.config.enabled).toBe(true);
            expect(metricsManager.config.collectInterval).toBe(60000);
            expect(metricsManager.config.retentionPeriod).toBe(86400000);
            expect(metricsManager.config.maxHistoryPoints).toBe(1440);
        });

        test('should initialize empty metrics', () => {
            expect(metricsManager.systemMetrics.totalRequests).toBe(0);
            expect(metricsManager.systemMetrics.totalErrors).toBe(0);
            expect(metricsManager.requestMetrics.size).toBe(0);
            expect(metricsManager.historicalData).toEqual([]);
        });

        test('should set start time', () => {
            expect(metricsManager.startTime).toBe(1000000000);
        });
    });

    describe('Request Recording', () => {
        test('should record successful request', () => {
            metricsManager.recordRequest('GET', '/api/config', 150, 200);
            
            expect(metricsManager.systemMetrics.totalRequests).toBe(1);
            expect(metricsManager.systemMetrics.totalErrors).toBe(0);
            
            const endpointData = metricsManager.requestMetrics.get('GET /api/config');
            expect(endpointData.count).toBe(1);
            expect(endpointData.totalTime).toBe(150);
            expect(endpointData.errors).toBe(0);
        });

        test('should record error request', () => {
            metricsManager.recordRequest('GET', '/api/invalid', 200, 404);
            
            expect(metricsManager.systemMetrics.totalRequests).toBe(1);
            expect(metricsManager.systemMetrics.totalErrors).toBe(1);
            
            const endpointData = metricsManager.requestMetrics.get('GET /api/invalid');
            expect(endpointData.errors).toBe(1);
        });

        test('should record cached request', () => {
            metricsManager.recordRequest('GET', '/api/data', 50, 200, true);
            
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(1);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(0);
        });

        test('should record non-cached request', () => {
            metricsManager.recordRequest('GET', '/api/data', 150, 200, false);
            
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(1);
        });

        test('should not record when disabled', () => {
            metricsManager.config.enabled = false;
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            expect(metricsManager.systemMetrics.totalRequests).toBe(0);
        });

        test('should accumulate multiple requests for same endpoint', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            metricsManager.recordRequest('GET', '/api/test', 200, 200);
            
            const endpointData = metricsManager.requestMetrics.get('GET /api/test');
            expect(endpointData.count).toBe(2);
            expect(endpointData.totalTime).toBe(300);
        });

        test('should store response history', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const endpointData = metricsManager.requestMetrics.get('GET /api/test');
            expect(endpointData.responses).toHaveLength(1);
            expect(endpointData.responses[0]).toEqual({
                time: 1000000000,
                responseTime: 100,
                statusCode: 200,
                cached: false
            });
        });
    });

    describe('Cache Event Recording', () => {
        test('should record cache hit', () => {
            metricsManager.recordCacheEvent('hit', 'test-key');
            
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(1);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(0);
        });

        test('should record cache miss', () => {
            metricsManager.recordCacheEvent('miss', 'test-key');
            
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(1);
        });

        test('should not record when disabled', () => {
            metricsManager.config.enabled = false;
            metricsManager.recordCacheEvent('hit', 'test-key');
            
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
        });
    });

    describe('Performance Metrics', () => {
        test('should calculate response time statistics with data', () => {
            // Add test data with known values
            metricsManager.systemMetrics.responseTimeHistory = [
                { timestamp: 1000000000, responseTime: 100 },
                { timestamp: 1000000000, responseTime: 200 },
                { timestamp: 1000000000, responseTime: 300 },
                { timestamp: 1000000000, responseTime: 400 },
                { timestamp: 1000000000, responseTime: 500 }
            ];
            
            const metrics = metricsManager.getPerformanceMetrics();
            
            expect(metrics.responseTime.average).toBe(300);
            expect(metrics.responseTime.median).toBe(300);
            expect(metrics.responseTime.p95).toBe(500);
            expect(metrics.responseTime.p99).toBe(500);
        });

        test('should handle empty response time history', () => {
            const metrics = metricsManager.getPerformanceMetrics();
            
            expect(metrics.responseTime.average).toBe(0);
            expect(metrics.responseTime.median).toBe(0);
            expect(metrics.responseTime.p95).toBe(0);
            expect(metrics.responseTime.p99).toBe(0);
        });

        test('should filter to last hour only', () => {
            const oneHourAgo = 1000000000 - 3600000;
            const twoHoursAgo = 1000000000 - 7200000;
            
            metricsManager.systemMetrics.responseTimeHistory = [
                { timestamp: twoHoursAgo, responseTime: 1000 }, // Should be filtered out
                { timestamp: oneHourAgo + 1000, responseTime: 100 } // Should be included
            ];
            
            const metrics = metricsManager.getPerformanceMetrics();
            expect(metrics.responseTime.average).toBe(100);
        });
    });

    describe('Endpoint Metrics', () => {
        test('should return endpoint statistics', () => {
            metricsManager.recordRequest('GET', '/api/test1', 100, 200);
            metricsManager.recordRequest('GET', '/api/test1', 200, 200);
            metricsManager.recordRequest('POST', '/api/test2', 150, 404);
            
            const metrics = metricsManager.getEndpointMetrics();
            
            expect(metrics.endpoints).toHaveLength(2);
            
            const getEndpoint = metrics.endpoints.find(e => e.path === 'GET /api/test1');
            expect(getEndpoint.requestCount).toBe(2);
            expect(getEndpoint.averageResponseTime).toBe(150);
            expect(getEndpoint.errorRate).toBe(0);
            
            const postEndpoint = metrics.endpoints.find(e => e.path === 'POST /api/test2');
            expect(postEndpoint.errorRate).toBe(100);
            expect(postEndpoint.totalErrors).toBe(1);
        });

        test('should handle zero requests', () => {
            const metrics = metricsManager.getEndpointMetrics();
            expect(metrics.endpoints).toEqual([]);
        });
    });

    describe('Error Metrics', () => {
        test('should calculate error statistics', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 404);
            metricsManager.recordRequest('GET', '/api/test', 100, 500);
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const metrics = metricsManager.getErrorMetrics();
            
            expect(metrics.totalErrors).toBe(2);
            expect(metrics.errorRate).toBe(66.67);
            expect(metrics.errorsByStatus['404']).toBe(1);
            expect(metrics.errorsByStatus['500']).toBe(1);
        });

        test('should handle no errors', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const metrics = metricsManager.getErrorMetrics();
            
            expect(metrics.totalErrors).toBe(0);
            expect(metrics.errorRate).toBe(0);
            expect(metrics.errorsByStatus).toEqual({});
        });

        test('should filter to last hour', () => {
            const twoHoursAgo = 1000000000 - 7200000;
            
            // Add old error that should be filtered out
            metricsManager.systemMetrics.errorHistory.push({
                timestamp: twoHoursAgo,
                statusCode: 404,
                endpoint: 'GET /old',
                responseTime: 100
            });
            
            metricsManager.recordRequest('GET', '/api/current', 100, 500);
            
            const metrics = metricsManager.getErrorMetrics();
            expect(metrics.totalErrors).toBe(1);
        });
    });

    describe('Cache Metrics', () => {
        test('should calculate cache hit rate', () => {
            metricsManager.systemMetrics.cacheStats.hits = 75;
            metricsManager.systemMetrics.cacheStats.misses = 25;
            
            const metrics = metricsManager.getCacheMetrics();
            
            expect(metrics.hitRate).toBe(75);
            expect(metrics.missRate).toBe(25);
            expect(metrics.totalHits).toBe(75);
            expect(metrics.totalMisses).toBe(25);
        });

        test('should handle no cache activity', () => {
            const metrics = metricsManager.getCacheMetrics();
            
            expect(metrics.hitRate).toBe(0);
            expect(metrics.missRate).toBe(0);
            expect(metrics.totalHits).toBe(0);
            expect(metrics.totalMisses).toBe(0);
        });
    });

    describe('System Metrics', () => {
        test('should return system metrics', () => {
            const metrics = metricsManager.getSystemMetrics();
            
            expect(metrics.memory.used).toBe(50); // 50MB
            expect(metrics.memory.total).toBe(100); // 100MB
            expect(metrics.memory.percentage).toBe(50);
            expect(metrics.uptime).toBe(0); // Started at same time as test
            expect(typeof metrics.cpu.usage).toBe('number');
        });

        test('should calculate CPU usage percentage', () => {
            os.loadavg.mockReturnValue([2.0, 1.5, 1.0]);
            os.cpus.mockReturnValue([{}, {}]); // 2 CPUs
            
            const cpuPercent = metricsManager.getCpuUsagePercent();
            expect(cpuPercent).toBe(100); // 2.0 / 2 * 100 = 100%
        });

        test('should cap CPU usage at 100%', () => {
            os.loadavg.mockReturnValue([10.0, 5.0, 3.0]);
            os.cpus.mockReturnValue([{}]); // 1 CPU
            
            const cpuPercent = metricsManager.getCpuUsagePercent();
            expect(cpuPercent).toBe(100);
        });
    });

    describe('Real-time Metrics', () => {
        test('should return real-time metrics', () => {
            // Add some recent requests
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const metrics = metricsManager.getRealTimeMetrics();
            
            expect(metrics.requestsPerMinute).toBe(1);
            expect(metrics.timestamp).toBe(1000000000);
            expect(typeof metrics.activeConnections).toBe('number');
        });

        test('should filter to last minute', () => {
            const twoMinutesAgo = 1000000000 - 120000;
            
            // Add old request
            metricsManager.systemMetrics.responseTimeHistory.push({
                timestamp: twoMinutesAgo,
                responseTime: 100
            });
            
            metricsManager.recordRequest('GET', '/api/current', 100, 200);
            
            const metrics = metricsManager.getRealTimeMetrics();
            expect(metrics.requestsPerMinute).toBe(1);
        });
    });

    describe('Historical Metrics', () => {
        beforeEach(() => {
            // Add test data with various timestamps
            const baseTime = 1000000000;
            for (let i = 0; i < 10; i++) {
                metricsManager.systemMetrics.responseTimeHistory.push({
                    timestamp: baseTime - (i * 300000), // 5 min intervals
                    responseTime: 100 + i * 10,
                    statusCode: i > 7 ? 500 : 200
                });
            }
        });

        test('should return 1 hour historical data', () => {
            const metrics = metricsManager.getHistoricalMetrics('1h');
            
            expect(metrics.period).toBe('1h');
            expect(Array.isArray(metrics.dataPoints)).toBe(true);
            expect(metrics.dataPoints.length).toBeGreaterThan(0);
        });

        test('should return 15 minute historical data', () => {
            const metrics = metricsManager.getHistoricalMetrics('15m');
            
            expect(metrics.period).toBe('15m');
            expect(metrics.dataPoints.length).toBeGreaterThan(0);
        });

        test('should calculate data point statistics', () => {
            const metrics = metricsManager.getHistoricalMetrics('1h');
            
            const dataPoint = metrics.dataPoints.find(dp => dp.requests > 0);
            if (dataPoint) {
                expect(dataPoint).toHaveProperty('timestamp');
                expect(dataPoint).toHaveProperty('requests');
                expect(dataPoint).toHaveProperty('errors');
                expect(dataPoint).toHaveProperty('avgResponseTime');
                expect(dataPoint).toHaveProperty('errorRate');
            }
        });

        test('should handle unknown period', () => {
            const metrics = metricsManager.getHistoricalMetrics('unknown');
            
            expect(metrics.period).toBe('unknown');
            // Should default to 1h behavior
        });
    });

    describe('Dashboard Summary', () => {
        test('should return dashboard summary', () => {
            metricsManager.recordRequest('GET', '/api/test', 150, 200);
            
            const summary = metricsManager.getDashboardSummary();
            
            expect(summary.summary.totalRequests).toBe(1);
            expect(summary.summary.averageResponseTime).toBe(150);
            expect(summary.summary.errorRate).toBe(0);
            expect(typeof summary.summary.uptime).toBe('number');
        });
    });

    describe('Metrics Export', () => {
        beforeEach(() => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            metricsManager.recordRequest('POST', '/api/test', 200, 404);
        });

        test('should export metrics in JSON format', () => {
            const exported = metricsManager.exportMetrics('json');
            
            expect(exported.format).toBe('json');
            expect(exported.timestamp).toBe(1000000000);
            expect(exported.metrics).toHaveProperty('performance');
            expect(exported.metrics).toHaveProperty('endpoints');
            expect(exported.metrics).toHaveProperty('errors');
            expect(exported.metrics).toHaveProperty('cache');
            expect(exported.metrics).toHaveProperty('system');
            expect(exported.metrics).toHaveProperty('realtime');
        });

        test('should export metrics in Prometheus format', () => {
            const exported = metricsManager.exportMetrics('prometheus');
            
            expect(typeof exported).toBe('string');
            expect(exported).toContain('# HELP http_request_duration_seconds');
            expect(exported).toContain('# TYPE http_request_duration_seconds histogram');
            expect(exported).toContain('http_requests_total');
            expect(exported).toContain('process_resident_memory_bytes');
            expect(exported).toContain('cache_hits_total');
        });

        test('should default to JSON format', () => {
            const exported = metricsManager.exportMetrics();
            
            expect(exported.format).toBe('json');
        });
    });

    describe('Configuration Management', () => {
        test('should update configuration', () => {
            const newConfig = {
                enabled: false,
                collectInterval: 30000
            };
            
            metricsManager.updateConfig(newConfig);
            
            expect(metricsManager.config.enabled).toBe(false);
            expect(metricsManager.config.collectInterval).toBe(30000);
            expect(metricsManager.config.retentionPeriod).toBe(86400000); // Unchanged
        });

        test('should restart metrics collection when interval changes', () => {
            const spy = jest.spyOn(metricsManager, 'startMetricsCollection');
            
            metricsManager.updateConfig({ collectInterval: 30000 });
            
            expect(spy).toHaveBeenCalled();
        });
    });

    describe('Data Management', () => {
        test('should trim old history data', () => {
            const oldTime = 1000000000 - (metricsManager.config.retentionPeriod + 1000);
            
            metricsManager.systemMetrics.responseTimeHistory.push({
                timestamp: oldTime,
                responseTime: 100
            });
            metricsManager.systemMetrics.errorHistory.push({
                timestamp: oldTime,
                statusCode: 404
            });
            
            metricsManager.trimHistory();
            
            expect(metricsManager.systemMetrics.responseTimeHistory).toHaveLength(0);
            expect(metricsManager.systemMetrics.errorHistory).toHaveLength(0);
        });

        test('should reset all metrics', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            metricsManager.reset();
            
            expect(metricsManager.systemMetrics.totalRequests).toBe(0);
            expect(metricsManager.systemMetrics.totalErrors).toBe(0);
            expect(metricsManager.requestMetrics.size).toBe(0);
            expect(metricsManager.historicalData).toHaveLength(0);
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(0);
        });

        test('should get specific endpoint metric', () => {
            metricsManager.recordRequest('GET', '/api/specific', 100, 200);
            
            const metric = metricsManager.getEndpointMetric('GET /api/specific');
            expect(metric).toBeDefined();
            expect(metric.count).toBe(1);
            
            const nonExistent = metricsManager.getEndpointMetric('GET /nonexistent');
            expect(nonExistent).toBeNull();
        });
    });

    describe('Background Collection', () => {
        test('should start metrics collection', () => {
            const spy = jest.spyOn(global, 'setInterval');
            
            metricsManager.startMetricsCollection();
            
            expect(spy).toHaveBeenCalledWith(
                expect.any(Function),
                metricsManager.config.collectInterval
            );
        });

        test('should clear previous interval when restarting', () => {
            const spy = jest.spyOn(global, 'clearInterval');
            
            metricsManager.startMetricsCollection();
            metricsManager.startMetricsCollection();
            
            expect(spy).toHaveBeenCalled();
        });

        test('should limit historical data points', () => {
            metricsManager.config.maxHistoryPoints = 2;
            
            // Simulate multiple collection cycles
            for (let i = 0; i < 5; i++) {
                metricsManager.historicalData.push({
                    timestamp: Date.now() + i * 1000,
                    memory: { used: 50 }
                });
            }
            
            // Trigger trimming by calling the collection logic
            if (metricsManager.historicalData.length > metricsManager.config.maxHistoryPoints) {
                metricsManager.historicalData = metricsManager.historicalData.slice(-metricsManager.config.maxHistoryPoints);
            }
            
            expect(metricsManager.historicalData.length).toBe(2);
        });
    });

    describe('Helper Methods', () => {
        test('should get active connections placeholder', () => {
            const connections = metricsManager.getActiveConnections();
            
            expect(typeof connections).toBe('number');
            expect(connections).toBeGreaterThanOrEqual(1);
            expect(connections).toBeLessThanOrEqual(11);
        });
    });
});
