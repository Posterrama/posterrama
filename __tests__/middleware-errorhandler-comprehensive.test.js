const { AppError, errorHandler, notFoundHandler, findSimilarEndpoints } = require('../middleware/errorHandler');
const logger = require('../logger');

// Mock logger
jest.mock('../logger');

describe('ErrorHandler Middleware - Comprehensive Tests', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        
        req = {
            method: 'GET',
            path: '/api/test',
            ip: '127.0.0.1',
            requestId: 'test-request-id',
            get: jest.fn()
        };
        
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            locals: {}
        };
        
        next = jest.fn();
        
        // Setup common mocks
        req.get.mockReturnValue('Test User Agent');
        
        // Mock Date to have consistent timestamps
        jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T00:00:00.000Z');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('AppError Class', () => {
        test('should create error with all properties', () => {
            const error = new AppError('Test error', 400, { field: 'test' });
            
            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(400);
            expect(error.details).toEqual({ field: 'test' });
            expect(error.isOperational).toBe(true);
            expect(error.timestamp).toBe('2023-01-01T00:00:00.000Z');
        });

        test('should create error without details', () => {
            const error = new AppError('Simple error', 500);
            
            expect(error.details).toBe(null);
            expect(error.statusCode).toBe(500);
        });

        test('should capture stack trace', () => {
            const error = new AppError('Stack test', 400);
            
            expect(error.stack).toBeDefined();
            expect(error.stack).toContain('AppError');
        });
    });

    describe('Error Handler', () => {
        test('should handle operational errors correctly', () => {
            const error = new AppError('Test error', 400);
            
            errorHandler(error, req, res, next);
            
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Caught error for GET /api/test: Test error'),
                expect.objectContaining({
                    stack: error.stack,
                    timestamp: '2023-01-01T00:00:00.000Z'
                })
            );
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Test error',
                timestamp: '2023-01-01T00:00:00.000Z',
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
        });

        test('should handle errors without status code', () => {
            const error = new Error('Generic error');
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(500);
        });

        test('should handle ValidationError', () => {
            const error = new Error('Validation failed');
            error.name = 'ValidationError';
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should handle UnauthorizedError', () => {
            const error = new Error('Unauthorized');
            error.name = 'UnauthorizedError';
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('should handle ForbiddenError', () => {
            const error = new Error('Forbidden');
            error.name = 'ForbiddenError';
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(403);
        });

        test('should handle error with status property', () => {
            const error = new Error('Custom status');
            error.status = 418; // I'm a teapot
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(418);
        });

        test('should use fallback request ID from res.locals', () => {
            req.requestId = undefined;
            res.locals.requestId = 'fallback-id';
            
            const error = new AppError('Test error', 400);
            errorHandler(error, req, res, next);
            
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'fallback-id'
                })
            );
        });

        test('should use unknown request ID when none available', () => {
            req.requestId = undefined;
            res.locals.requestId = undefined;
            
            const error = new AppError('Test error', 400);
            errorHandler(error, req, res, next);
            
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'unknown'
                })
            );
        });

        describe('Production vs Development Mode', () => {
            const originalEnv = process.env.NODE_ENV;

            afterEach(() => {
                process.env.NODE_ENV = originalEnv;
            });

            test('should hide stack trace in production for 500 errors', () => {
                process.env.NODE_ENV = 'production';
                
                const error = new Error('Internal error');
                errorHandler(error, req, res, next);
                
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        error: 'Internal Server Error'
                    })
                );
                expect(res.json).toHaveBeenCalledWith(
                    expect.not.objectContaining({
                        stack: expect.anything()
                    })
                );
            });

            test('should show actual error message in production for non-500 errors', () => {
                process.env.NODE_ENV = 'production';
                
                const error = new AppError('Client error', 400);
                errorHandler(error, req, res, next);
                
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        error: 'Client error'
                    })
                );
            });

            test('should show stack trace in development', () => {
                process.env.NODE_ENV = 'development';
                
                const error = new Error('Test error');
                errorHandler(error, req, res, next);
                
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        stack: error.stack
                    })
                );
            });

            test('should show actual error message in development', () => {
                process.env.NODE_ENV = 'development';
                
                const error = new Error('Detailed error');
                errorHandler(error, req, res, next);
                
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        error: 'Detailed error'
                    })
                );
            });
        });
    });

    describe('Not Found Handler', () => {
        test('should handle 404 with suggestions', () => {
            req.path = '/api/v1/confi'; // Typo in config
            
            notFoundHandler(req, res, next);
            
            expect(logger.warn).toHaveBeenCalledWith(
                'Route GET /api/v1/confi not found',
                expect.objectContaining({
                    ip: '127.0.0.1',
                    method: 'GET',
                    path: '/api/v1/confi',
                    requestId: 'test-request-id',
                    statusCode: 404,
                    userAgent: 'Test User Agent'
                })
            );
            
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Not Found',
                timestamp: '2023-01-01T00:00:00.000Z',
                path: '/api/v1/confi',
                method: 'GET',
                requestId: 'test-request-id',
                suggestions: expect.arrayContaining(['/api/v1/config'])
            });
        });

        test('should handle 404 without suggestions for very different path', () => {
            req.path = '/completely/different/path';
            
            notFoundHandler(req, res, next);
            
            expect(res.json).toHaveBeenCalledWith({
                error: 'Not Found',
                timestamp: '2023-01-01T00:00:00.000Z',
                path: '/completely/different/path',
                method: 'GET',
                requestId: 'test-request-id'
            });
        });

        test('should use fallback request ID', () => {
            req.requestId = undefined;
            res.locals.requestId = 'fallback-id';
            req.path = '/test';
            
            notFoundHandler(req, res, next);
            
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'fallback-id'
                })
            );
        });

        test('should use unknown request ID when none available', () => {
            req.requestId = undefined;
            res.locals.requestId = undefined;
            req.path = '/test';
            
            notFoundHandler(req, res, next);
            
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'unknown'
                })
            );
        });

        test('should include stack trace in warning log', () => {
            req.path = '/test';
            
            notFoundHandler(req, res, next);
            
            expect(logger.warn).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    stack: expect.stringContaining('Error: Route GET /test not found')
                })
            );
        });
    });

    describe('Find Similar Endpoints', () => {
        test('should find suggestions for typos in known endpoints', () => {
            const suggestions = findSimilarEndpoints('/api/v1/confi');
            
            expect(suggestions).toContain('/api/v1/config');
        });

        test('should handle get-config variants', () => {
            const suggestions1 = findSimilarEndpoints('/get-config-test');
            const suggestions2 = findSimilarEndpoints('/api/get-config');
            
            expect(suggestions1).toContain('/get-config');
            expect(suggestions1).toContain('/api/v1/config');
            expect(suggestions2).toContain('/get-config');
            expect(suggestions2).toContain('/api/v1/config');
        });

        test('should handle get-media variants', () => {
            const suggestions1 = findSimilarEndpoints('/get-media-test');
            const suggestions2 = findSimilarEndpoints('/api/get-media');
            
            expect(suggestions1).toContain('/get-media');
            expect(suggestions1).toContain('/api/v1/media');
            expect(suggestions2).toContain('/get-media');
            expect(suggestions2).toContain('/api/v1/media');
        });

        test('should return empty array for very different paths', () => {
            const suggestions = findSimilarEndpoints('/completely/different/and/long/path');
            
            expect(suggestions).toEqual([]);
        });

        test('should limit to maximum 3 suggestions', () => {
            const suggestions = findSimilarEndpoints('/api');
            
            expect(suggestions.length).toBeLessThanOrEqual(3);
        });

        test('should sort suggestions by similarity', () => {
            const suggestions = findSimilarEndpoints('/api/v1/medi');
            
            // Should prefer exact matches or closer matches first
            if (suggestions.length > 1) {
                expect(suggestions[0]).toBe('/api/v1/media');
            }
        });
    });

    describe('Levenshtein Distance Algorithm', () => {
        // Test the distance calculation indirectly through findSimilarEndpoints
        test('should find close matches', () => {
            const suggestions = findSimilarEndpoints('/api/v1/confi'); // 1 char diff
            expect(suggestions).toContain('/api/v1/config');
        });

        test('should not suggest very different strings', () => {
            const suggestions = findSimilarEndpoints('/xyz123456789');
            expect(suggestions).toEqual([]);
        });

        test('should handle empty strings', () => {
            const suggestions = findSimilarEndpoints('');
            expect(Array.isArray(suggestions)).toBe(true);
        });

        test('should handle identical strings', () => {
            const suggestions = findSimilarEndpoints('/api/v1/config');
            expect(suggestions).toContain('/api/v1/config');
        });
    });

    describe('Error Response Structure', () => {
        test('should always include required fields', () => {
            const error = new AppError('Test', 400);
            errorHandler(error, req, res, next);
            
            const responseCall = res.json.mock.calls[0][0];
            
            expect(responseCall).toHaveProperty('error');
            expect(responseCall).toHaveProperty('timestamp');
            expect(responseCall).toHaveProperty('path');
            expect(responseCall).toHaveProperty('method');
            expect(responseCall).toHaveProperty('requestId');
        });

        test('should include stack trace only in development', () => {
            process.env.NODE_ENV = 'development';
            
            const error = new Error('Test error');
            errorHandler(error, req, res, next);
            
            const responseCall = res.json.mock.calls[0][0];
            expect(responseCall).toHaveProperty('stack');
        });

        test('should not include stack trace in production', () => {
            process.env.NODE_ENV = 'production';
            
            const error = new Error('Test error');
            errorHandler(error, req, res, next);
            
            const responseCall = res.json.mock.calls[0][0];
            expect(responseCall).not.toHaveProperty('stack');
        });
    });

    describe('Edge Cases', () => {
        test('should handle error without message', () => {
            const error = new Error();
            error.statusCode = 400;
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: ''
                })
            );
        });

        test('should handle null error gracefully', () => {
            const error = null;
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('Unknown error occurred')
                })
            );
        });

        test('should handle error with circular reference in details', () => {
            const circularObj = {};
            circularObj.self = circularObj;
            
            const error = new AppError('Circular error', 400, circularObj);
            
            expect(() => errorHandler(error, req, res, next)).not.toThrow();
        });

        test('should handle missing req properties', () => {
            req.method = undefined;
            req.path = undefined;
            
            const error = new AppError('Test', 400);
            
            expect(() => errorHandler(error, req, res, next)).not.toThrow();
        });
    });
});
