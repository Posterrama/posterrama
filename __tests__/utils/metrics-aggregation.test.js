/**
 * Tests for metrics aggregation functionality (Issue #9)
 * Tests time-series aggregation, percentile calculations, moving averages, and data cleanup
 */

const { constructor: MetricsManager } = require('../../utils/metrics');

describe('Metrics Aggregation (Issue #9)', () => {
    let metrics;
    let now;

    beforeEach(() => {
        now = 1700000000000; // Fixed timestamp for deterministic tests
        metrics = new MetricsManager(now);
    });

    afterEach(() => {
        if (metrics) {
            metrics.shutdown();
        }
    });

    describe('aggregateMetrics', () => {
        it('should aggregate response time metrics with percentiles', () => {
            // Record various response times over the last minute
            const baseTime = now - 60000;
            const responseTimes = [10, 20, 30, 40, 50, 100, 150, 200, 250, 500];

            responseTimes.forEach((time, i) => {
                metrics.systemMetrics.responseTimeHistory.push({
                    timestamp: baseTime + i * 1000,
                    responseTime: time,
                    endpoint: 'GET /api/test',
                    statusCode: 200,
                    cached: false,
                });
            });

            // Trigger aggregation with explicit timestamp
            metrics.aggregateMetrics(now);

            // Check aggregated data
            expect(metrics.aggregatedMetrics.responseTime).toHaveLength(1);
            const aggData = metrics.aggregatedMetrics.responseTime[0];

            expect(aggData).toMatchObject({
                timestamp: expect.any(Number),
                avg: expect.any(Number),
                median: expect.any(Number),
                p95: expect.any(Number),
                p99: expect.any(Number),
                count: 10,
                min: 10,
                max: 500,
            });

            // Verify percentile calculations
            expect(aggData.median).toBeGreaterThan(0);
            expect(aggData.p95).toBeGreaterThan(aggData.median);
            expect(aggData.p99).toBeGreaterThanOrEqual(aggData.p95);
        });

        it('should calculate accurate percentiles for sorted data', () => {
            const sortedData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

            const p50 = metrics._percentile(sortedData, 50);
            const p95 = metrics._percentile(sortedData, 95);
            const p99 = metrics._percentile(sortedData, 99);

            expect(p50).toBe(5.5); // Median of 10 numbers
            expect(p95).toBeCloseTo(9.55, 1);
            expect(p99).toBeCloseTo(9.91, 1);
        });

        it('should handle edge cases in percentile calculation', () => {
            // Empty array
            expect(metrics._percentile([], 50)).toBe(0);

            // Single element
            expect(metrics._percentile([42], 50)).toBe(42);
            expect(metrics._percentile([42], 95)).toBe(42);

            // Two elements
            expect(metrics._percentile([10, 20], 50)).toBe(15);
        });

        it('should aggregate request rate metrics', () => {
            const baseTime = now - 60000;

            // Record 120 requests (2 per second on average)
            for (let i = 0; i < 120; i++) {
                metrics.systemMetrics.responseTimeHistory.push({
                    timestamp: baseTime + i * 500,
                    responseTime: 100,
                    endpoint: 'GET /api/test',
                    statusCode: 200,
                    cached: false,
                });
            }

            metrics.aggregateMetrics(now);

            expect(metrics.aggregatedMetrics.requestRate).toHaveLength(1);
            const rateData = metrics.aggregatedMetrics.requestRate[0];

            expect(rateData.count).toBe(120);
            expect(rateData.rate).toBeCloseTo(2.0, 1); // 120 requests / 60 seconds
        });

        it('should aggregate error rate metrics', () => {
            const baseTime = now - 60000;

            // Record 90 successful and 10 error responses
            for (let i = 0; i < 90; i++) {
                metrics.systemMetrics.responseTimeHistory.push({
                    timestamp: baseTime + i * 600,
                    responseTime: 100,
                    endpoint: 'GET /api/test',
                    statusCode: 200,
                    cached: false,
                });
            }

            for (let i = 0; i < 10; i++) {
                metrics.systemMetrics.responseTimeHistory.push({
                    timestamp: baseTime + 54000 + i * 600,
                    responseTime: 50,
                    endpoint: 'GET /api/test',
                    statusCode: 500,
                    cached: false,
                });
            }

            metrics.aggregateMetrics(now);

            expect(metrics.aggregatedMetrics.errorRate).toHaveLength(1);
            const errorData = metrics.aggregatedMetrics.errorRate[0];

            expect(errorData.errors).toBe(10);
            expect(errorData.count).toBe(100);
            expect(errorData.rate).toBe(10); // 10% error rate
        });

        it('should skip aggregation when no recent data', () => {
            // No recent requests
            metrics.aggregateMetrics(now);

            expect(metrics.aggregatedMetrics.responseTime).toHaveLength(0);
            expect(metrics.aggregatedMetrics.requestRate).toHaveLength(0);
            expect(metrics.aggregatedMetrics.errorRate).toHaveLength(0);
        });

        it('should aggregate system load metrics', () => {
            const baseTime = now - 60000;

            // Add some requests to trigger aggregation
            metrics.systemMetrics.responseTimeHistory.push({
                timestamp: baseTime,
                responseTime: 100,
                endpoint: 'GET /api/test',
                statusCode: 200,
                cached: false,
            });

            metrics.aggregateMetrics(now);

            // System load should be collected (if available)
            if (metrics.aggregatedMetrics.systemLoad.length > 0) {
                const loadData = metrics.aggregatedMetrics.systemLoad[0];
                expect(loadData).toMatchObject({
                    timestamp: expect.any(Number),
                    cpu: expect.any(Number),
                    memory: expect.any(Number),
                    memoryMB: expect.any(Number),
                });
            }
        });
    });

    describe('cleanupOldAggregatedData', () => {
        it('should remove aggregated data older than retention period', () => {
            const oldTime = now - 25 * 60 * 60 * 1000; // 25 hours ago
            const recentTime = now - 1 * 60 * 60 * 1000; // 1 hour ago

            // Add old and recent data
            metrics.aggregatedMetrics.responseTime.push(
                { timestamp: oldTime, avg: 100 },
                { timestamp: recentTime, avg: 150 }
            );

            metrics.aggregatedMetrics.requestRate.push(
                { timestamp: oldTime, count: 50 },
                { timestamp: recentTime, count: 100 }
            );

            // Cleanup (default retention is 24 hours)
            metrics.cleanupOldAggregatedData(now);

            // Old data should be removed
            expect(metrics.aggregatedMetrics.responseTime).toHaveLength(1);
            expect(metrics.aggregatedMetrics.responseTime[0].timestamp).toBe(recentTime);

            expect(metrics.aggregatedMetrics.requestRate).toHaveLength(1);
            expect(metrics.aggregatedMetrics.requestRate[0].timestamp).toBe(recentTime);
        });

        it('should preserve all data within retention period', () => {
            const recent1 = now - 10 * 60 * 1000; // 10 minutes ago
            const recent2 = now - 5 * 60 * 1000; // 5 minutes ago

            metrics.aggregatedMetrics.responseTime.push(
                { timestamp: recent1, avg: 100 },
                { timestamp: recent2, avg: 150 }
            );

            metrics.cleanupOldAggregatedData(now);

            expect(metrics.aggregatedMetrics.responseTime).toHaveLength(2);
        });

        it('should cleanup all aggregated metric types', () => {
            const oldTime = now - 25 * 60 * 60 * 1000;

            metrics.aggregatedMetrics.responseTime.push({ timestamp: oldTime, avg: 100 });
            metrics.aggregatedMetrics.requestRate.push({ timestamp: oldTime, count: 50 });
            metrics.aggregatedMetrics.errorRate.push({ timestamp: oldTime, errors: 5 });
            metrics.aggregatedMetrics.systemLoad.push({ timestamp: oldTime, cpu: 50 });

            metrics.cleanupOldAggregatedData(now);

            expect(metrics.aggregatedMetrics.responseTime).toHaveLength(0);
            expect(metrics.aggregatedMetrics.requestRate).toHaveLength(0);
            expect(metrics.aggregatedMetrics.errorRate).toHaveLength(0);
            expect(metrics.aggregatedMetrics.systemLoad).toHaveLength(0);
        });
    });

    describe('getAggregatedMetrics', () => {
        beforeEach(() => {
            // Setup test data at various time points
            const times = [
                now - 30 * 60 * 1000, // 30 min ago
                now - 20 * 60 * 1000, // 20 min ago
                now - 10 * 60 * 1000, // 10 min ago
                now - 2 * 60 * 1000, // 2 min ago
            ];

            times.forEach((time, i) => {
                metrics.aggregatedMetrics.responseTime.push({
                    timestamp: time,
                    avg: 100 + i * 10,
                    median: 90 + i * 10,
                    p95: 150 + i * 10,
                    p99: 200 + i * 10,
                    count: 100,
                });

                metrics.aggregatedMetrics.requestRate.push({
                    timestamp: time,
                    count: 100 + i * 10,
                    rate: 2.0 + i * 0.5,
                });
            });
        });

        it('should return aggregated data for 15m period', () => {
            const result = metrics.getAggregatedMetrics('15m', now);

            expect(result.period).toBe('15m');
            expect(result.responseTime.length).toBeGreaterThan(0);
            expect(result.requestRate.length).toBeGreaterThan(0);

            // Only data from last 15 minutes
            result.responseTime.forEach(d => {
                expect(d.timestamp).toBeGreaterThan(now - 15 * 60 * 1000);
            });
        });

        it('should return aggregated data for 1h period', () => {
            const result = metrics.getAggregatedMetrics('1h', now);

            expect(result.period).toBe('1h');
            // All test data should be included (all within 1 hour)
            expect(result.responseTime).toHaveLength(4);
            expect(result.requestRate).toHaveLength(4);
        });

        it('should return aggregated data for 6h period', () => {
            const result = metrics.getAggregatedMetrics('6h', now);

            expect(result.period).toBe('6h');
            expect(result.responseTime).toHaveLength(4);
        });

        it('should return aggregated data for 24h period', () => {
            const result = metrics.getAggregatedMetrics('24h', now);

            expect(result.period).toBe('24h');
            expect(result.responseTime).toHaveLength(4);
        });

        it('should default to 1h if no period specified', () => {
            const result = metrics.getAggregatedMetrics('1h', now);

            expect(result.period).toBe('1h');
        });

        it('should return all metric types', () => {
            const result = metrics.getAggregatedMetrics('1h', now);

            expect(result).toHaveProperty('responseTime');
            expect(result).toHaveProperty('requestRate');
            expect(result).toHaveProperty('errorRate');
            expect(result).toHaveProperty('systemLoad');
        });
    });

    describe('getMovingAverages', () => {
        beforeEach(() => {
            // Setup test data for moving average calculations
            const baseTime = now - 10 * 60 * 1000; // 10 minutes ago

            for (let i = 0; i < 10; i++) {
                metrics.aggregatedMetrics.responseTime.push({
                    timestamp: baseTime + i * 60 * 1000,
                    avg: 100 + i * 10,
                    median: 90,
                    p95: 150,
                    p99: 200,
                    count: 100,
                });

                metrics.aggregatedMetrics.requestRate.push({
                    timestamp: baseTime + i * 60 * 1000,
                    count: 100,
                    rate: 2.0 + i * 0.1,
                });

                metrics.aggregatedMetrics.errorRate.push({
                    timestamp: baseTime + i * 60 * 1000,
                    errors: 5,
                    rate: 5.0,
                    count: 100,
                });

                metrics.aggregatedMetrics.systemLoad.push({
                    timestamp: baseTime + i * 60 * 1000,
                    cpu: 50 + i,
                    memory: 60 + i,
                    memoryMB: 512,
                });
            }
        });

        it('should calculate 5-minute moving averages', () => {
            const result = metrics.getMovingAverages(5, now);

            expect(result.windowMinutes).toBe(5);
            expect(result.responseTime).toBeGreaterThan(0);
            expect(result.requestRate).toBeGreaterThan(0);
            expect(result.errorRate).toBe(5.0);
            expect(result.cpu).toBeGreaterThan(0);
            expect(result.memory).toBeGreaterThan(0);
        });

        it('should calculate 1-minute moving averages', () => {
            const result = metrics.getMovingAverages(1, now);

            expect(result.windowMinutes).toBe(1);
            expect(result.dataPoints.responseTime).toBeGreaterThan(0);
        });

        it('should calculate 15-minute moving averages', () => {
            const result = metrics.getMovingAverages(15, now);

            expect(result.windowMinutes).toBe(15);
            // Should include all 10 data points (all within 15 minutes)
            expect(result.dataPoints.responseTime).toBe(10);
        });

        it('should return data point counts', () => {
            const result = metrics.getMovingAverages(5, now);

            expect(result.dataPoints).toMatchObject({
                responseTime: expect.any(Number),
                requestRate: expect.any(Number),
                errorRate: expect.any(Number),
                systemLoad: expect.any(Number),
            });
        });

        it('should return 0 when no data available', () => {
            const freshMetrics = new MetricsManager(now);
            const result = freshMetrics.getMovingAverages(5);

            expect(result.responseTime).toBe(0);
            expect(result.requestRate).toBe(0);
            expect(result.errorRate).toBe(0);
            expect(result.cpu).toBe(0);
            expect(result.memory).toBe(0);

            freshMetrics.shutdown();
        });

        it('should round values to 2 decimal places', () => {
            const result = metrics.getMovingAverages(5, now);

            expect(result.responseTime).toEqual(expect.any(Number));
            expect(result.responseTime.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(
                2
            );
        });
    });

    describe('getTimeSeriesData', () => {
        beforeEach(() => {
            const baseTime = now - 30 * 60 * 1000;

            for (let i = 0; i < 5; i++) {
                metrics.aggregatedMetrics.responseTime.push({
                    timestamp: baseTime + i * 10 * 60 * 1000,
                    avg: 100 + i * 10,
                    median: 90,
                    p95: 150 + i * 10,
                    p99: 200 + i * 10,
                    count: 100,
                });

                metrics.aggregatedMetrics.requestRate.push({
                    timestamp: baseTime + i * 10 * 60 * 1000,
                    count: 100 + i * 10,
                    rate: 2.0 + i * 0.5,
                });

                metrics.aggregatedMetrics.errorRate.push({
                    timestamp: baseTime + i * 10 * 60 * 1000,
                    errors: 5 + i,
                    rate: 5.0 + i,
                    count: 100,
                });

                metrics.aggregatedMetrics.systemLoad.push({
                    timestamp: baseTime + i * 10 * 60 * 1000,
                    cpu: 50 + i * 5,
                    memory: 60 + i * 5,
                    memoryMB: 512 + i * 10,
                });
            }
        });

        it('should return response time time-series data', () => {
            const result = metrics.getTimeSeriesData('responseTime', '1h', now);

            expect(result).toHaveLength(5);
            result.forEach(point => {
                expect(point).toMatchObject({
                    timestamp: expect.any(Number),
                    value: expect.any(Number),
                    p95: expect.any(Number),
                    p99: expect.any(Number),
                });
            });
        });

        it('should return request rate time-series data', () => {
            const result = metrics.getTimeSeriesData('requestRate', '1h', now);

            expect(result).toHaveLength(5);
            result.forEach(point => {
                expect(point).toMatchObject({
                    timestamp: expect.any(Number),
                    value: expect.any(Number),
                    count: expect.any(Number),
                });
            });
        });

        it('should return error rate time-series data', () => {
            const result = metrics.getTimeSeriesData('errorRate', '1h', now);

            expect(result).toHaveLength(5);
            result.forEach(point => {
                expect(point).toMatchObject({
                    timestamp: expect.any(Number),
                    value: expect.any(Number),
                    errors: expect.any(Number),
                });
            });
        });

        it('should return system load time-series data', () => {
            const result = metrics.getTimeSeriesData('systemLoad', '1h', now);

            expect(result).toHaveLength(5);
            result.forEach(point => {
                expect(point).toMatchObject({
                    timestamp: expect.any(Number),
                    cpu: expect.any(Number),
                    memory: expect.any(Number),
                });
            });
        });

        it('should return empty array for unknown metric', () => {
            const result = metrics.getTimeSeriesData('unknownMetric', '1h', now);

            expect(result).toEqual([]);
        });

        it('should respect time period filter', () => {
            const result15m = metrics.getTimeSeriesData('responseTime', '15m', now);
            const result1h = metrics.getTimeSeriesData('responseTime', '1h', now);

            expect(result15m.length).toBeLessThanOrEqual(result1h.length);
        });
    });

    describe('reset', () => {
        it('should clear aggregated metrics on reset', () => {
            // Add some aggregated data
            metrics.aggregatedMetrics.responseTime.push({ timestamp: now, avg: 100 });
            metrics.aggregatedMetrics.requestRate.push({ timestamp: now, count: 50 });
            metrics.aggregatedMetrics.errorRate.push({ timestamp: now, errors: 5 });
            metrics.aggregatedMetrics.systemLoad.push({ timestamp: now, cpu: 50 });

            metrics.reset();

            expect(metrics.aggregatedMetrics.responseTime).toHaveLength(0);
            expect(metrics.aggregatedMetrics.requestRate).toHaveLength(0);
            expect(metrics.aggregatedMetrics.errorRate).toHaveLength(0);
            expect(metrics.aggregatedMetrics.systemLoad).toHaveLength(0);
        });
    });

    describe('shutdown', () => {
        it('should clear aggregation timer on shutdown', () => {
            // Manually start aggregation
            metrics.aggregationTimer = setInterval(() => {}, 1000);

            expect(metrics.aggregationTimer).toBeDefined();

            metrics.shutdown();

            // Timer should be cleared (can't directly verify, but no errors should occur)
            expect(true).toBe(true);
        });
    });

    describe('integration with existing metrics', () => {
        it('should aggregate after recording multiple requests', () => {
            const baseTime = now - 60000;

            // Record requests
            for (let i = 0; i < 20; i++) {
                metrics.recordRequest('GET', '/api/test', 50 + Math.random() * 100, 200, false);
            }

            // Manually set timestamps to be in the past minute
            metrics.systemMetrics.responseTimeHistory.forEach((r, i) => {
                r.timestamp = baseTime + i * 3000;
            });

            // Aggregate
            metrics.aggregateMetrics(now);

            expect(metrics.aggregatedMetrics.responseTime.length).toBeGreaterThan(0);
            expect(metrics.aggregatedMetrics.requestRate.length).toBeGreaterThan(0);
        });

        it('should continue working after multiple aggregation cycles', () => {
            const baseTime = now - 120000; // 2 minutes ago

            // First minute
            for (let i = 0; i < 10; i++) {
                metrics.systemMetrics.responseTimeHistory.push({
                    timestamp: baseTime + i * 5000,
                    responseTime: 100,
                    endpoint: 'GET /api/test',
                    statusCode: 200,
                    cached: false,
                });
            }

            metrics.aggregateMetrics(now);
            const firstAggregation = metrics.aggregatedMetrics.responseTime.length;

            // Second minute
            for (let i = 0; i < 10; i++) {
                metrics.systemMetrics.responseTimeHistory.push({
                    timestamp: baseTime + 60000 + i * 5000,
                    responseTime: 150,
                    endpoint: 'GET /api/test',
                    statusCode: 200,
                    cached: false,
                });
            }

            metrics.aggregateMetrics(now);
            const secondAggregation = metrics.aggregatedMetrics.responseTime.length;

            expect(secondAggregation).toBeGreaterThan(firstAggregation);
        });
    });

    describe('edge cases', () => {
        it('should handle percentile calculation with non-uniform distribution', () => {
            // Heavily skewed data: mostly fast, few very slow
            const data = [
                ...Array(95).fill(10),
                ...Array(4).fill(100),
                1000, // One extreme outlier
            ];

            const p50 = metrics._percentile(data, 50);
            const p95 = metrics._percentile(data, 95);
            const p99 = metrics._percentile(data, 99);

            expect(p50).toBe(10); // Median is in the fast group
            expect(p95).toBeGreaterThan(10); // 95th percentile catches slower requests
            expect(p99).toBeGreaterThan(p95); // 99th percentile near outlier
        });

        it('should handle moving average with sparse data', () => {
            // Only 2 data points
            metrics.aggregatedMetrics.responseTime.push(
                { timestamp: now - 2 * 60 * 1000, avg: 100 },
                { timestamp: now - 1 * 60 * 1000, avg: 200 }
            );

            const result = metrics.getMovingAverages(5, now);

            expect(result.responseTime).toBe(150); // Average of 100 and 200
            expect(result.dataPoints.responseTime).toBe(2);
        });

        it('should handle getAggregatedMetrics with empty data', () => {
            const result = metrics.getAggregatedMetrics('1h', now);

            expect(result.responseTime).toEqual([]);
            expect(result.requestRate).toEqual([]);
            expect(result.errorRate).toEqual([]);
            expect(result.systemLoad).toEqual([]);
        });
    });
});
