const { metricsMiddleware, connectionTracker } = require('../../middleware/metrics');
const metricsManager = require('../../utils/metrics');
const logger = require('../../logger');

// Mock dependencies
jest.mock('../../utils/metrics');
jest.mock('../../logger');

describe('Metrics Middleware - Comprehensive Tests', () => {
    let req, res, next, originalEnd;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock request object
        req = {
            method: 'GET',
            path: '/test',
            route: {
                path: '/test/:id'
            }
        };

        // Mock response object
        originalEnd = jest.fn();
        res = {
            statusCode: 200,
            get: jest.fn(),
            end: originalEnd
        };

        // Mock next function
        next = jest.fn();

        // Mock Date.now for consistent timing tests
        Date.now = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('metricsMiddleware', () => {
        test('should wrap response.end to collect metrics', () => {
            metricsMiddleware(req, res, next);

            // Verify middleware called next
            expect(next).toHaveBeenCalledTimes(1);

            // Verify original end function was stored
            expect(res.end).not.toBe(originalEnd);
            expect(typeof res.end).toBe('function');
        });

        test('should record request metrics when response ends', () => {
            const mockDate = 1000;
            Date.now.mockReturnValueOnce(mockDate).mockReturnValueOnce(mockDate + 100);
            
            metricsMiddleware(req, res, next);

            // Simulate response ending
            res.end('response body', undefined);

            // Verify metrics were recorded
            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'GET',
                '/test/:id',
                100, // responseTime (mockDate + 100 - mockDate)
                200, // statusCode
                false // cached (no X-Cache header)
            );

            // Verify original end was called
            expect(originalEnd).toHaveBeenCalledWith('response body', undefined);
        });

        test('should use req.path when req.route is undefined', () => {
            req.route = undefined;
            Date.now.mockReturnValueOnce(1000).mockReturnValueOnce(1100);
            
            metricsMiddleware(req, res, next);

            res.end();

            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'GET',
                '/test',
                100,
                200,
                false
            );
        });

        test('should detect cached responses', () => {
            res.get.mockReturnValue('HIT');
            Date.now.mockReturnValueOnce(2000).mockReturnValueOnce(2150);
            
            metricsMiddleware(req, res, next);

            res.end();

            expect(res.get).toHaveBeenCalledWith('X-Cache');
            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'GET',
                '/test/:id',
                150,
                200,
                true // cached = true
            );
        });

        test('should handle different HTTP methods', () => {
            req.method = 'POST';
            Date.now.mockReturnValueOnce(3000).mockReturnValueOnce(3200);
            
            metricsMiddleware(req, res, next);

            res.end();

            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'POST',
                '/test/:id',
                200,
                200,
                false
            );
        });

        test('should handle different status codes', () => {
            res.statusCode = 404;
            Date.now.mockReturnValueOnce(4000).mockReturnValueOnce(4300);
            
            metricsMiddleware(req, res, next);

            res.end();

            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'GET',
                '/test/:id',
                300,
                404,
                false
            );
        });

        test('should handle errors in metrics recording gracefully', () => {
            const error = new Error('Metrics error');
            metricsManager.recordRequest.mockImplementation(() => {
                throw error;
            });
            Date.now.mockReturnValueOnce(5000).mockReturnValueOnce(5100);

            metricsMiddleware(req, res, next);
            res.end();

            expect(logger.error).toHaveBeenCalledWith('Error recording metrics:', error);
            expect(originalEnd).toHaveBeenCalled();
        });

        test('should pass chunk and encoding to original end function', () => {
            Date.now.mockReturnValueOnce(6000).mockReturnValueOnce(6050);
            
            metricsMiddleware(req, res, next);

            const chunk = 'test response';
            const encoding = 'utf8';
            res.end(chunk, encoding);

            expect(originalEnd).toHaveBeenCalledWith(chunk, encoding);
        });

        test('should calculate correct response time', () => {
            const startTime = 1000;
            const endTime = 1500;
            
            Date.now
                .mockReturnValueOnce(startTime)
                .mockReturnValueOnce(endTime);

            metricsMiddleware(req, res, next);
            res.end();

            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'GET',
                '/test/:id',
                500, // endTime - startTime
                200,
                false
            );
        });

        test('should preserve res.end context when called', () => {
            Date.now.mockReturnValueOnce(7000).mockReturnValueOnce(7100);
            
            metricsMiddleware(req, res, next);

            // Add property to res to verify context
            res.testProperty = 'test';

            // Mock original end to check context
            originalEnd.mockImplementation(function() {
                expect(this).toBe(res);
                expect(this.testProperty).toBe('test');
            });

            res.end();
        });

        test('should handle null/undefined cache header', () => {
            res.get.mockReturnValue(undefined);
            Date.now.mockReturnValueOnce(8000).mockReturnValueOnce(8200);
            
            metricsMiddleware(req, res, next);

            res.end();

            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'GET',
                '/test/:id',
                200,
                200,
                false
            );
        });

        test('should handle MISS cache header', () => {
            res.get.mockReturnValue('MISS');
            Date.now.mockReturnValueOnce(9000).mockReturnValueOnce(9400);
            
            metricsMiddleware(req, res, next);

            res.end();

            expect(metricsManager.recordRequest).toHaveBeenCalledWith(
                'GET',
                '/test/:id',
                400,
                200,
                false
            );
        });
    });

    describe('connectionTracker', () => {
        test('should call next immediately', () => {
            connectionTracker(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith();
        });

        test('should not modify request or response objects', () => {
            const originalReq = { ...req };
            const originalRes = { ...res };

            connectionTracker(req, res, next);

            expect(req).toEqual(originalReq);
            expect(res).toEqual(originalRes);
        });

        test('should be a valid middleware function', () => {
            expect(typeof connectionTracker).toBe('function');
            expect(connectionTracker.length).toBe(3); // req, res, next parameters
        });
    });

    describe('Module exports', () => {
        test('should export metricsMiddleware function', () => {
            const metrics = require('../../middleware/metrics');
            expect(typeof metrics.metricsMiddleware).toBe('function');
            expect(metrics.metricsMiddleware.length).toBe(3);
        });

        test('should export connectionTracker function', () => {
            const metrics = require('../../middleware/metrics');
            expect(typeof metrics.connectionTracker).toBe('function');
            expect(metrics.connectionTracker.length).toBe(3);
        });

        test('should not export unexpected properties', () => {
            const metrics = require('../../middleware/metrics');
            const exportedKeys = Object.keys(metrics);
            
            expect(exportedKeys).toEqual(['metricsMiddleware', 'connectionTracker']);
        });
    });

    describe('Integration scenarios', () => {
        test('should work with Express-like middleware chain', () => {
            const middlewares = [metricsMiddleware, connectionTracker];
            let callOrder = [];

            const mockNext = () => callOrder.push('next');
            
            middlewares.forEach((middleware, index) => {
                const nextFn = index === middlewares.length - 1 ? mockNext : jest.fn(() => callOrder.push(`middleware-${index}-next`));
                middleware(req, res, nextFn);
            });

            expect(callOrder).toContain('middleware-0-next');
        });

        test('should handle multiple simultaneous requests', () => {
            const req1 = { ...req, path: '/test1' };
            const req2 = { ...req, path: '/test2' };
            const res1 = { ...res, statusCode: 200, get: jest.fn().mockReturnValue(undefined) };
            const res2 = { ...res, statusCode: 404, get: jest.fn().mockReturnValue(undefined) };

            // Setup different timing for each request
            Date.now
                .mockReturnValueOnce(1000) // req1 start
                .mockReturnValueOnce(1100) // req2 start  
                .mockReturnValueOnce(1200) // req1 end
                .mockReturnValueOnce(1300); // req2 end

            metricsMiddleware(req1, res1, next);
            metricsMiddleware(req2, res2, next);

            res1.end();
            res2.end();

            expect(metricsManager.recordRequest).toHaveBeenNthCalledWith(1,
                'GET', '/test/:id', 200, 200, false
            );
            expect(metricsManager.recordRequest).toHaveBeenNthCalledWith(2,
                'GET', '/test/:id', 200, 404, false
            );
        });
    });
});
