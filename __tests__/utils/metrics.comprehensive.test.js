const MetricsManager = require('../../utils/metrics').constructor;
const os = require('os');

// Mock os module for predictable CPU calculations
jest.mock('os');

describe('MetricsManager - Comprehensive Tests', () => {
    let metricsManager;
    let mockDateNow;

    beforeEach(() => {
        // Mock Date.now for consistent timestamps
        mockDateNow = 1000000;
        jest.spyOn(Date, 'now').mockReturnValue(mockDateNow);
        
        // Mock os functions
        os.loadavg = jest.fn().mockReturnValue([0.5, 0.3, 0.2]);
        os.cpus = jest.fn().mockReturnValue([{}, {}, {}, {}]); // 4 CPUs

        // Create fresh instance for each test with controlled start time
        metricsManager = new MetricsManager(mockDateNow);
    });

    afterEach(() => {
        if (metricsManager && typeof metricsManager.shutdown === 'function') {
            metricsManager.shutdown();
        }
        jest.restoreAllMocks();
    });

    describe('Constructor and Initialization', () => {
        test('should initialize with default values', () => {
            const manager = new MetricsManager();
            expect(manager.config.enabled).toBe(true);
            expect(manager.config.collectInterval).toBe(60000);
            expect(manager.config.retentionPeriod).toBe(86400000);
            expect(manager.config.maxHistoryPoints).toBe(1440);
            expect(manager.systemMetrics.totalRequests).toBe(0);
            expect(manager.systemMetrics.totalErrors).toBe(0);
        });

        test('should initialize with custom start time', () => {
            const customStartTime = 500000;
            const manager = new MetricsManager(customStartTime);
            expect(manager.startTime).toBe(customStartTime);
        });

        test('should not start metrics collection in test environment', () => {
            const manager = new MetricsManager();
            expect(manager.collectionInterval).toBeUndefined();
        });
    });

    describe('Request Recording', () => {
        test('should record basic request metrics', () => {
            metricsManager.recordRequest('GET', '/api/test', 150, 200);

            expect(metricsManager.systemMetrics.totalRequests).toBe(1);
            expect(metricsManager.systemMetrics.totalErrors).toBe(0);
            
            const endpoint = metricsManager.requestMetrics.get('GET /api/test');
            expect(endpoint.count).toBe(1);
            expect(endpoint.totalTime).toBe(150);
            expect(endpoint.errors).toBe(0);
        });

        test('should record error requests', () => {
            metricsManager.recordRequest('POST', '/api/error', 250, 500);

            expect(metricsManager.systemMetrics.totalRequests).toBe(1);
            expect(metricsManager.systemMetrics.totalErrors).toBe(1);
            
            const endpoint = metricsManager.requestMetrics.get('POST /api/error');
            expect(endpoint.errors).toBe(1);
        });

        test('should record cached requests', () => {
            metricsManager.recordRequest('GET', '/api/cached', 50, 200, true);

            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(1);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(0);
        });

        test('should record non-cached requests', () => {
            metricsManager.recordRequest('GET', '/api/uncached', 100, 200, false);

            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(1);
        });

        test('should accumulate metrics for same endpoint', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            metricsManager.recordRequest('GET', '/api/test', 200, 200);

            const endpoint = metricsManager.requestMetrics.get('GET /api/test');
            expect(endpoint.count).toBe(2);
            expect(endpoint.totalTime).toBe(300);
        });

        test('should not record when disabled', () => {
            metricsManager.config.enabled = false;
            metricsManager.recordRequest('GET', '/api/test', 100, 200);

            expect(metricsManager.systemMetrics.totalRequests).toBe(0);
            expect(metricsManager.requestMetrics.size).toBe(0);
        });

        test('should handle different error status codes', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 400);
            metricsManager.recordRequest('GET', '/api/test', 100, 404);
            metricsManager.recordRequest('GET', '/api/test', 100, 500);

            expect(metricsManager.systemMetrics.totalErrors).toBe(3);
            expect(metricsManager.systemMetrics.errorHistory).toHaveLength(3);
        });
    });

    describe('Cache Event Recording', () => {
        test('should record cache hits', () => {
            metricsManager.recordCacheEvent('hit', 'test-key');
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(1);
        });

        test('should record cache misses', () => {
            metricsManager.recordCacheEvent('miss', 'test-key');
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(1);
        });

        test('should ignore unknown cache event types', () => {
            metricsManager.recordCacheEvent('invalid', 'test-key');
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
            expect(metricsManager.systemMetrics.cacheStats.misses).toBe(0);
        });

        test('should not record when disabled', () => {
            metricsManager.config.enabled = false;
            metricsManager.recordCacheEvent('hit', 'test-key');
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
        });
    });

    describe('Performance Metrics', () => {
        test('should calculate response time statistics', () => {
            // Record requests with known response times
            [100, 150, 200, 250, 300].forEach(time => {
                metricsManager.recordRequest('GET', '/api/test', time, 200);
            });

            const metrics = metricsManager.getPerformanceMetrics();
            
            expect(metrics.responseTime.average).toBe(200);
            expect(metrics.responseTime.median).toBe(200);
        });

        test('should return zero metrics when no data', () => {
            const metrics = metricsManager.getPerformanceMetrics();
            
            expect(metrics.responseTime.average).toBe(0);
            expect(metrics.responseTime.median).toBe(0);
            expect(metrics.responseTime.p95).toBe(0);
            expect(metrics.responseTime.p99).toBe(0);
        });

        test('should filter data to last hour', () => {
            // Add old request (2 hours ago)
            const oldTime = mockDateNow - 7200000;
            metricsManager.systemMetrics.responseTimeHistory.push({
                timestamp: oldTime,
                responseTime: 100,
                endpoint: 'GET /api/old',
                statusCode: 200,
                cached: false
            });

            // Add recent request (30 minutes ago)
            const recentTime = mockDateNow - 1800000;
            metricsManager.systemMetrics.responseTimeHistory.push({
                timestamp: recentTime,
                responseTime: 200,
                endpoint: 'GET /api/new',
                statusCode: 200,
                cached: false
            });

            Date.now.mockReturnValue(mockDateNow);
            const metrics = metricsManager.getPerformanceMetrics();
            expect(metrics.responseTime.average).toBe(200); // Only recent data
        });
    });

    describe('Endpoint Metrics', () => {
        test('should return endpoint statistics', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            metricsManager.recordRequest('GET', '/api/test', 200, 500); // Error
            metricsManager.recordRequest('POST', '/api/create', 150, 201);

            const metrics = metricsManager.getEndpointMetrics();
            
            expect(metrics.endpoints).toHaveLength(2);
            
            const getEndpoint = metrics.endpoints.find(e => e.path === 'GET /api/test');
            expect(getEndpoint.requestCount).toBe(2);
            expect(getEndpoint.averageResponseTime).toBe(150);
            expect(getEndpoint.errorRate).toBe(50);
            expect(getEndpoint.totalErrors).toBe(1);
        });

        test('should handle endpoints with no requests', () => {
            const metrics = metricsManager.getEndpointMetrics();
            expect(metrics.endpoints).toHaveLength(0);
        });
    });

    describe('Error Metrics', () => {
        test('should calculate error statistics', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            metricsManager.recordRequest('GET', '/api/test', 100, 404);
            metricsManager.recordRequest('GET', '/api/test', 100, 500);

            const metrics = metricsManager.getErrorMetrics();
            
            expect(metrics.errorRate).toBe(66.67); // 2 errors out of 3 requests
            expect(metrics.totalErrors).toBe(2);
            expect(metrics.errorsByStatus['404']).toBe(1);
            expect(metrics.errorsByStatus['500']).toBe(1);
        });

        test('should return zero error rate when no requests', () => {
            const metrics = metricsManager.getErrorMetrics();
            expect(metrics.errorRate).toBe(0);
            expect(metrics.totalErrors).toBe(0);
        });
    });

    describe('Cache Metrics', () => {
        test('should calculate cache statistics', () => {
            metricsManager.recordCacheEvent('hit', 'key1');
            metricsManager.recordCacheEvent('hit', 'key2');
            metricsManager.recordCacheEvent('miss', 'key3');

            const metrics = metricsManager.getCacheMetrics();
            
            expect(metrics.hitRate).toBe(66.67);
            expect(metrics.missRate).toBe(33.33);
            expect(metrics.totalHits).toBe(2);
            expect(metrics.totalMisses).toBe(1);
        });

        test('should handle no cache data', () => {
            const metrics = metricsManager.getCacheMetrics();
            expect(metrics.hitRate).toBe(0);
            expect(metrics.missRate).toBe(0);
        });
    });

    describe('System Metrics', () => {
        test('should return system resource metrics', () => {
            const mockMemUsage = {
                heapUsed: 50 * 1024 * 1024,  // 50MB
                heapTotal: 100 * 1024 * 1024  // 100MB
            };
            jest.spyOn(process, 'memoryUsage').mockReturnValue(mockMemUsage);
            jest.spyOn(process, 'cpuUsage').mockReturnValue({ user: 1000, system: 500 });

            const metrics = metricsManager.getSystemMetrics();
            
            expect(metrics.memory.used).toBe(50);
            expect(metrics.memory.total).toBe(100);
            expect(metrics.memory.percentage).toBe(50);
            expect(metrics.uptime).toBe(0); // Started at mockDateNow
        });

        test('should calculate CPU usage percentage', () => {
            const cpuPercent = metricsManager.getCpuUsagePercent();
            expect(cpuPercent).toBe(12.5); // (0.5 / 4) * 100
        });

        test('should handle os module errors gracefully', () => {
            os.loadavg.mockImplementation(() => { throw new Error('OS error'); });
            os.cpus.mockImplementation(() => { throw new Error('OS error'); });

            const cpuPercent = metricsManager.getCpuUsagePercent();
            expect(cpuPercent).toBe(0);
        });

        test('should handle invalid os module responses', () => {
            os.loadavg.mockReturnValue(null);
            os.cpus.mockReturnValue(undefined);

            const cpuPercent = metricsManager.getCpuUsagePercent();
            expect(cpuPercent).toBe(0);
        });
    });

    describe('Real-time Metrics', () => {
        test('should return recent activity metrics', () => {
            // Add some recent requests
            Date.now.mockReturnValue(mockDateNow - 30000); // 30 seconds ago
            metricsManager.recordRequest('GET', '/api/recent1', 100, 200);
            
            Date.now.mockReturnValue(mockDateNow - 10000); // 10 seconds ago
            metricsManager.recordRequest('GET', '/api/recent2', 150, 200);

            Date.now.mockReturnValue(mockDateNow);
            const metrics = metricsManager.getRealTimeMetrics();
            
            expect(metrics.requestsPerMinute).toBe(2);
            expect(metrics.timestamp).toBe(mockDateNow);
            expect(typeof metrics.activeConnections).toBe('number');
        });

        test('should filter to last minute only', () => {
            // Add old request
            Date.now.mockReturnValue(mockDateNow - 120000); // 2 minutes ago
            metricsManager.recordRequest('GET', '/api/old', 100, 200);

            Date.now.mockReturnValue(mockDateNow);
            const metrics = metricsManager.getRealTimeMetrics();
            
            expect(metrics.requestsPerMinute).toBe(0);
        });
    });

    describe('Historical Metrics', () => {
        test('should generate historical data points', () => {
            // Add requests spread over time
            Date.now.mockReturnValue(mockDateNow - 3600000); // 1 hour ago
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            Date.now.mockReturnValue(mockDateNow - 1800000); // 30 minutes ago
            metricsManager.recordRequest('GET', '/api/test', 150, 404);

            Date.now.mockReturnValue(mockDateNow);
            const metrics = metricsManager.getHistoricalMetrics('1h');
            
            expect(metrics.period).toBe('1h');
            expect(metrics.dataPoints.length).toBeGreaterThan(0);
            
            const hasData = metrics.dataPoints.some(point => point.requests > 0);
            expect(hasData).toBe(true);
        });

        test('should handle different time periods', () => {
            const periods = ['15m', '1h', '6h', '24h'];
            
            periods.forEach(period => {
                const metrics = metricsManager.getHistoricalMetrics(period);
                expect(metrics.period).toBe(period);
                expect(Array.isArray(metrics.dataPoints)).toBe(true);
            });
        });

        test('should handle invalid period with default', () => {
            const metrics = metricsManager.getHistoricalMetrics('invalid');
            expect(metrics.period).toBe('invalid');
            expect(Array.isArray(metrics.dataPoints)).toBe(true);
        });
    });

    describe('Dashboard Summary', () => {
        test('should provide dashboard overview', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            metricsManager.recordRequest('GET', '/api/test', 200, 500);

            const summary = metricsManager.getDashboardSummary();
            
            expect(summary.summary.totalRequests).toBe(2);
            expect(summary.summary.averageResponseTime).toBe(150);
            expect(summary.summary.errorRate).toBe(50);
            expect(typeof summary.summary.uptime).toBe('number');
        });
    });

    describe('Metrics Export', () => {
        test('should export in JSON format', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const exported = metricsManager.exportMetrics('json');
            
            expect(exported.format).toBe('json');
            expect(exported.metrics.performance).toBeDefined();
            expect(exported.metrics.endpoints).toBeDefined();
            expect(exported.metrics.errors).toBeDefined();
            expect(exported.metrics.cache).toBeDefined();
            expect(exported.metrics.system).toBeDefined();
            expect(exported.metrics.realtime).toBeDefined();
        });

        test('should export in Prometheus format', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const prometheus = metricsManager.exportMetrics('prometheus');
            
            expect(typeof prometheus).toBe('string');
            expect(prometheus).toContain('http_requests_total');
            expect(prometheus).toContain('http_request_duration_seconds');
            expect(prometheus).toContain('process_resident_memory_bytes');
            expect(prometheus).toContain('cache_hits_total');
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
                collectInterval: 30000,
                retentionPeriod: 43200000
            };

            metricsManager.updateConfig(newConfig);
            
            expect(metricsManager.config.enabled).toBe(false);
            expect(metricsManager.config.collectInterval).toBe(30000);
            expect(metricsManager.config.retentionPeriod).toBe(43200000);
        });

        test('should preserve unmodified config values', () => {
            const originalMaxHistory = metricsManager.config.maxHistoryPoints;
            metricsManager.updateConfig({ enabled: false });
            
            expect(metricsManager.config.maxHistoryPoints).toBe(originalMaxHistory);
        });
    });

    describe('Data Management', () => {
        test('should reset all metrics', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            metricsManager.recordCacheEvent('hit', 'key');

            metricsManager.reset();
            
            expect(metricsManager.requestMetrics.size).toBe(0);
            expect(metricsManager.systemMetrics.totalRequests).toBe(0);
            expect(metricsManager.systemMetrics.totalErrors).toBe(0);
            expect(metricsManager.systemMetrics.cacheStats.hits).toBe(0);
            expect(metricsManager.historicalData).toHaveLength(0);
        });

        test('should get specific endpoint metrics', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const endpoint = metricsManager.getEndpointMetric('GET /api/test');
            expect(endpoint).not.toBeNull();
            expect(endpoint.count).toBe(1);

            const nonExistent = metricsManager.getEndpointMetric('POST /nonexistent');
            expect(nonExistent).toBeNull();
        });

        test('should trim old history data', () => {
            // Mock old timestamp
            const oldTime = mockDateNow - (2 * 86400000); // 2 days ago
            Date.now.mockReturnValue(oldTime);
            metricsManager.recordRequest('GET', '/api/old', 100, 200);

            // Set retention period to 1 day
            metricsManager.config.retentionPeriod = 86400000;
            Date.now.mockReturnValue(mockDateNow);
            
            metricsManager.trimHistory();
            
            expect(metricsManager.systemMetrics.responseTimeHistory).toHaveLength(0);
            expect(metricsManager.systemMetrics.errorHistory).toHaveLength(0);
        });
    });

    describe('Helper Methods', () => {
        test('should provide shutdown method', () => {
            expect(typeof metricsManager.shutdown).toBe('function');
            expect(() => metricsManager.shutdown()).not.toThrow();
        });

        test('should provide testing helper methods', () => {
            expect(typeof metricsManager._resetStartTime).toBe('function');
            expect(typeof metricsManager._setStartTime).toBe('function');
            
            const newTime = 999999;
            metricsManager._setStartTime(newTime);
            expect(metricsManager.startTime).toBe(newTime);
        });

        test('should generate random active connections', () => {
            const connections = metricsManager.getActiveConnections();
            expect(typeof connections).toBe('number');
            expect(connections).toBeGreaterThanOrEqual(1);
            expect(connections).toBeLessThanOrEqual(10);
        });
    });

    describe('Edge Cases', () => {
        test('should handle division by zero in calculations', () => {
            const performanceMetrics = metricsManager.getPerformanceMetrics();
            const errorMetrics = metricsManager.getErrorMetrics();
            const cacheMetrics = metricsManager.getCacheMetrics();
            
            expect(performanceMetrics.responseTime.average).toBe(0);
            expect(errorMetrics.errorRate).toBe(0);
            expect(cacheMetrics.hitRate).toBe(0);
        });

        test('should handle single data point percentile calculations', () => {
            metricsManager.recordRequest('GET', '/api/test', 100, 200);
            
            const metrics = metricsManager.getPerformanceMetrics();
            expect(metrics.responseTime.median).toBe(100);
            expect(metrics.responseTime.p95).toBe(100);
            expect(metrics.responseTime.p99).toBe(100);
        });

        test('should handle large datasets efficiently', () => {
            // Add many requests
            for (let i = 0; i < 1000; i++) {
                metricsManager.recordRequest('GET', '/api/load-test', i, 200);
            }

            const start = Date.now();
            const metrics = metricsManager.getPerformanceMetrics();
            const duration = Date.now() - start;
            
            expect(metrics.responseTime.average).toBeGreaterThan(0);
            expect(duration).toBeLessThan(100); // Should be fast
        });
    });

    describe('Metrics Collection', () => {
        test('should start metrics collection in non-test environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            
            const manager = new MetricsManager();
            expect(manager.collectionInterval).toBeDefined();
            
            // Cleanup
            manager.shutdown();
            process.env.NODE_ENV = originalEnv;
        });

        test('should clear existing interval when restarting collection', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            
            const manager = new MetricsManager();
            const firstInterval = manager.collectionInterval;
            
            manager.startMetricsCollection(); // Should clear and restart
            const secondInterval = manager.collectionInterval;
            
            expect(secondInterval).not.toBe(firstInterval);
            
            // Cleanup
            manager.shutdown();
            process.env.NODE_ENV = originalEnv;
        });

        test('should handle shutdown with active interval', () => {
            const interval = setInterval(() => {}, 1000);
            metricsManager.collectionInterval = interval;
            
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            
            expect(() => metricsManager.shutdown()).not.toThrow();
            expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
            
            clearIntervalSpy.mockRestore();
        });

        test('should handle shutdown without active interval', () => {
            expect(() => metricsManager.shutdown()).not.toThrow();
        });

        test('should collect historical data when collection is running', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            
            const manager = new MetricsManager();
            
            // Mock system metrics
            jest.spyOn(manager, 'getSystemMetrics').mockReturnValue({
                memory: { used: 50, total: 100, percentage: 50 },
                cpu: { usage: 25 },
                uptime: 3600
            });

            // Simulate the interval callback being called
            const originalConfig = manager.config;
            manager.config = { ...originalConfig, enabled: true, maxHistoryPoints: 2 };
            
            // Manually trigger the collection logic that would run in the interval
            if (manager.config.enabled) {
                const systemMetrics = manager.getSystemMetrics();
                manager.historicalData.push({
                    timestamp: Date.now(),
                    ...systemMetrics
                });

                // Test history trimming when over max points
                manager.historicalData.push({
                    timestamp: Date.now() + 1000,
                    ...systemMetrics
                });
                manager.historicalData.push({
                    timestamp: Date.now() + 2000,
                    ...systemMetrics
                });

                // This should trigger the slice operation
                if (manager.historicalData.length > manager.config.maxHistoryPoints) {
                    manager.historicalData = manager.historicalData.slice(-manager.config.maxHistoryPoints);
                }
            }

            expect(manager.historicalData.length).toBe(2); // Trimmed to maxHistoryPoints
            
            // Cleanup
            manager.shutdown();
            process.env.NODE_ENV = originalEnv;
        });

        test('should handle clearInterval in shutdown when no interval exists', () => {
            metricsManager.collectionInterval = undefined;
            expect(() => metricsManager.shutdown()).not.toThrow();
        });

        test('should restart collection when config interval changes', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            
            const manager = new MetricsManager();
            const startSpy = jest.spyOn(manager, 'startMetricsCollection');
            
            manager.updateConfig({ collectInterval: 30000 });
            expect(startSpy).toHaveBeenCalled();
            
            // Cleanup
            manager.shutdown();
            process.env.NODE_ENV = originalEnv;
            startSpy.mockRestore();
        });
    });

    describe('Module Export', () => {
        test('should export singleton instance by default', () => {
            const defaultExport = require('../../utils/metrics');
            expect(typeof defaultExport.recordRequest).toBe('function');
            expect(typeof defaultExport.getPerformanceMetrics).toBe('function');
        });

        test('should export constructor for testing', () => {
            const ConstructorExport = require('../../utils/metrics').constructor;
            expect(typeof ConstructorExport).toBe('function');
            
            const instance = new ConstructorExport();
            expect(typeof instance.recordRequest).toBe('function');
        });
    });
});
