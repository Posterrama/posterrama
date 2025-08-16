// Mock logger
const mockLogger = {
    error: jest.fn(),
    warn: jest.fn()
};
jest.mock('../../logger', () => mockLogger);

const { AppError, errorHandler, notFoundHandler, findSimilarEndpoints } = require('../../middleware/errorHandler');

describe('ErrorHandler Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        
        req = {
            method: 'GET',
            path: '/api/test',
            ip: '127.0.0.1',
            requestId: 'test-request-id',
            get: jest.fn().mockReturnValue('Test User Agent')
        };
        
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            locals: {}
        };
        
        next = jest.fn();

        // Reset environment
        delete process.env.NODE_ENV;
    });

    describe('AppError class', () => {
        test('should create AppError with all properties', () => {
            const error = new AppError('Test error', 400, { detail: 'test' });
            
            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(400);
            expect(error.details).toEqual({ detail: 'test' });
            expect(error.isOperational).toBe(true);
            expect(error.name).toBe('AppError');
            expect(error.timestamp).toBeDefined();
            expect(error.stack).toBeDefined();
        });

        test('should create AppError with minimal properties', () => {
            const error = new AppError('Simple error', 500);
            
            expect(error.message).toBe('Simple error');
            expect(error.statusCode).toBe(500);
            expect(error.details).toBe(null);
            expect(error.isOperational).toBe(true);
            expect(error.name).toBe('AppError');
        });

        test('should capture stack trace', () => {
            const error = new AppError('Stack test', 400);
            expect(error.stack).toContain('AppError');
            expect(error.stack).toContain('Stack test');
        });
    });

    describe('findSimilarEndpoints function', () => {
        test('should suggest similar endpoints', () => {
            const suggestions = findSimilarEndpoints('/api/v1/confi');
            expect(suggestions).toContain('/api/v1/config');
        });

        test('should return special handling for get-config', () => {
            const suggestions = findSimilarEndpoints('/api/get-config');
            expect(suggestions).toContain('/api/v1/config');
            expect(suggestions).toContain('/get-config');
        });

        test('should return special handling for get-media', () => {
            const suggestions = findSimilarEndpoints('/api/get-media');
            expect(suggestions).toContain('/api/v1/media');
            expect(suggestions).toContain('/get-media');
        });

        test('should limit suggestions to max 3', () => {
            const suggestions = findSimilarEndpoints('/api');
            expect(suggestions.length).toBeLessThanOrEqual(3);
        });

        test('should return empty array for very different paths', () => {
            const suggestions = findSimilarEndpoints('/completely/different/path/that/is/very/long');
            expect(suggestions).toEqual([]);
        });

        test('should handle empty endpoint for findSimilarEndpoints', () => {
            const suggestions = findSimilarEndpoints('');
            expect(Array.isArray(suggestions)).toBe(true);
        });

        test('should handle exact matches', () => {
            const suggestions = findSimilarEndpoints('/api/v1/config');
            expect(suggestions).toContain('/api/v1/config');
        });
    });

    describe('errorHandler middleware', () => {
        test('should handle basic error in development', () => {
            process.env.NODE_ENV = 'development';
            const error = new Error('Test error');
            error.statusCode = 400;
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Test error',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
            expect(mockLogger.error).toHaveBeenCalled();
        });

        test('should handle error in production mode', () => {
            process.env.NODE_ENV = 'production';
            const error = new Error('Internal error details');
            error.statusCode = 500;
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Internal Server Error',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
        });

        test('should handle null/undefined error', () => {
            process.env.NODE_ENV = 'development';
            
            errorHandler(null, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Unknown error occurred',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id',
                stack: expect.any(String)
            });
        });

        test('should handle error without message property', () => {
            const error = { statusCode: 400 };
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: '',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
        });

        test('should handle error without message for server errors', () => {
            const error = { statusCode: 500 };
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Unknown error occurred',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
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

        test('should use error.status when no statusCode', () => {
            const error = new Error('Status error');
            error.status = 418;
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(418);
        });

        test('should default to 500 when no status information', () => {
            const error = new Error('No status error');
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(500);
        });

        test('should add stack trace in development for server errors', () => {
            process.env.NODE_ENV = 'development';
            const error = new Error('Server error');
            error.statusCode = 500;
            error.stack = 'Error stack trace';
            
            errorHandler(error, req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs).toHaveProperty('stack', 'Error stack trace');
        });

        test('should not add stack trace in production', () => {
            process.env.NODE_ENV = 'production';
            const error = new Error('Server error');
            error.statusCode = 500;
            error.stack = 'Error stack trace';
            
            errorHandler(error, req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('stack');
        });

        test('should not add stack trace for client errors', () => {
            process.env.NODE_ENV = 'development';
            const error = new Error('Client error');
            error.statusCode = 400;
            error.stack = 'Error stack trace';
            
            errorHandler(error, req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('stack');
        });

        test('should use requestId from res.locals when req.requestId not available', () => {
            delete req.requestId;
            res.locals.requestId = 'locals-request-id';
            const error = new Error('Test error');
            
            errorHandler(error, req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs.requestId).toBe('locals-request-id');
        });

        test('should use "unknown" when no requestId available', () => {
            delete req.requestId;
            const error = new Error('Test error');
            
            errorHandler(error, req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs.requestId).toBe('unknown');
        });

        test('should handle production server error with "Unknown error occurred" message', () => {
            process.env.NODE_ENV = 'production';
            const error = new Error('Unknown error occurred');
            error.statusCode = 500;
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Unknown error occurred',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
        });
    });

    describe('notFoundHandler middleware', () => {
        test('should handle 404 with suggestions', () => {
            req.path = '/api/v1/confi';
            
            notFoundHandler(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Not Found',
                timestamp: expect.any(String),
                path: '/api/v1/confi',
                method: 'GET',
                requestId: 'test-request-id',
                suggestions: expect.arrayContaining(['/api/v1/config'])
            });
            expect(mockLogger.warn).toHaveBeenCalledWith(
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
        });

        test('should handle 404 without suggestions', () => {
            req.path = '/completely/unknown/path';
            
            notFoundHandler(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(404);
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('suggestions');
        });

        test('should use requestId from res.locals when req.requestId not available', () => {
            delete req.requestId;
            res.locals.requestId = 'locals-404-id';
            req.path = '/unknown';
            
            notFoundHandler(req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs.requestId).toBe('locals-404-id');
        });

        test('should use "unknown" when no requestId available', () => {
            delete req.requestId;
            req.path = '/unknown';
            
            notFoundHandler(req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs.requestId).toBe('unknown');
        });

        test('should log complete 404 information', () => {
            req.path = '/missing';
            
            notFoundHandler(req, res, next);
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Route GET /missing not found',
                expect.objectContaining({
                    ip: '127.0.0.1',
                    method: 'GET',
                    path: '/missing',
                    requestId: 'test-request-id',
                    stack: expect.stringContaining('Route GET /missing not found'),
                    statusCode: 404,
                    timestamp: expect.any(String),
                    userAgent: 'Test User Agent'
                })
            );
        });
    });

    describe('Edge cases and integration', () => {
        test('should handle error with empty string message', () => {
            const error = new Error('');
            error.statusCode = 400;
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: '',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
        });

        test('should handle error without stack property', () => {
            process.env.NODE_ENV = 'development';
            const error = { message: 'No stack error', statusCode: 500 };
            
            errorHandler(error, req, res, next);
            
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('stack');
        });

        test('should handle AppError instance', () => {
            const error = new AppError('Custom app error', 422, { field: 'invalid' });
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(422);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Custom app error',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id'
            });
        });

        test('should handle complex error scenarios', () => {
            process.env.NODE_ENV = 'development';
            const error = new Error('Complex error');
            error.statusCode = 503;
            error.stack = 'Complex stack trace';
            
            errorHandler(error, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Complex error',
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'test-request-id',
                stack: 'Complex stack trace'
            });
        });
    });

    describe('Module exports', () => {
        test('should export all required functions and classes', () => {
            expect(typeof AppError).toBe('function');
            expect(typeof errorHandler).toBe('function');
            expect(typeof notFoundHandler).toBe('function');
            expect(typeof findSimilarEndpoints).toBe('function');
        });
    });
});
