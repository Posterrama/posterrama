/**
 * Error Handler Middleware - Practical Tests
 * Tests core error handling functionality with realistic expectations
 */

const { errorHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');

// Mock logger
jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

describe('Error Handler Middleware - Practical Tests', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        jest.clearAllMocks();

        mockReq = {
            method: 'GET',
            url: '/api/test',
            path: '/api/test',
            headers: {
                'user-agent': 'test-agent',
                'x-request-id': 'test-req-123',
            },
            ip: '127.0.0.1',
            get: jest.fn(header => {
                if (header === 'User-Agent') return 'test-agent';
                return null;
            }),
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            headersSent: false,
            locals: {},
        };

        mockNext = jest.fn();
    });

    describe('Basic Error Handling', () => {
        test('should handle errors with statusCode', () => {
            const error = new Error('Test error');
            error.statusCode = 400;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Test error',
                })
            );
        });

        test('should default to 500 for errors without statusCode', () => {
            const error = new Error('Unknown error');

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(500);
        });

        test('should include error message in response', () => {
            const error = new Error('Something went wrong');
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.any(String),
                })
            );
        });

        test('should include request method and path', () => {
            const error = new Error('Test error');
            error.statusCode = 400;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET',
                    path: '/api/test',
                })
            );
        });
    });

    describe('HTTP Status Codes', () => {
        test('should handle 401 Unauthorized', () => {
            const error = new Error('Unauthorized');
            error.statusCode = 401;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(401);
        });

        test('should handle 403 Forbidden', () => {
            const error = new Error('Forbidden');
            error.statusCode = 403;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('should handle 404 Not Found', () => {
            const error = new Error('Not Found');
            error.statusCode = 404;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(404);
        });

        test('should handle 429 Too Many Requests', () => {
            const error = new Error('Rate limited');
            error.statusCode = 429;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(429);
        });

        test('should handle 500 Internal Server Error', () => {
            const error = new Error('Server error');
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(500);
        });

        test('should handle 503 Service Unavailable', () => {
            const error = new Error('Service unavailable');
            error.statusCode = 503;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(503);
        });
    });

    describe('Error Logging', () => {
        test('should log client errors at appropriate level', () => {
            const error = new Error('Bad request');
            error.statusCode = 400;

            errorHandler(error, mockReq, mockRes, mockNext);

            // Client errors logged (either error or warn level depending on NODE_ENV)
            expect(logger.error.mock.calls.length + logger.warn.mock.calls.length).toBeGreaterThan(
                0
            );
        });

        test('should log server errors', () => {
            const error = new Error('Server crashed');
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(logger.error).toHaveBeenCalled();
        });

        test('should include error message in logs', () => {
            const error = new Error('Test error message');
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Test error message'),
                expect.any(Object)
            );
        });
    });

    describe('Headers Already Sent', () => {
        test('should not send response if headers already sent', () => {
            mockRes.headersSent = true;

            const error = new Error('Test error');

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockRes.json).not.toHaveBeenCalled();
        });

        test('should still log error if headers already sent', () => {
            mockRes.headersSent = true;

            const error = new Error('Test error');
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('Error Types', () => {
        test('should handle ValidationError', () => {
            const error = new Error('Validation failed');
            error.name = 'ValidationError';

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('should handle UnauthorizedError', () => {
            const error = new Error('Unauthorized');
            error.name = 'UnauthorizedError';

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(401);
        });

        test('should handle ForbiddenError', () => {
            const error = new Error('Forbidden');
            error.name = 'ForbiddenError';

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('Edge Cases', () => {
        test('should handle null or undefined errors', () => {
            errorHandler(null, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalled();
        });

        test('should handle errors without message', () => {
            const error = new Error();
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalled();
        });

        test('should handle non-Error objects', () => {
            const error = { message: 'Plain object error', statusCode: 400 };

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('should include timestamp in response', () => {
            const error = new Error('Test error');
            error.statusCode = 400;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    timestamp: expect.any(String),
                })
            );
        });

        test('should include requestId in response', () => {
            const error = new Error('Test error');
            error.statusCode = 400;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: expect.any(String),
                })
            );
        });
    });

    describe('Production vs Development', () => {
        test('should sanitize 500 errors in production', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const error = new Error('Internal database error with sensitive info');
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Internal Server Error',
                })
            );

            process.env.NODE_ENV = originalEnv;
        });

        test('should show real 500 errors in development', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const error = new Error('Detailed error message');
            error.statusCode = 500;

            errorHandler(error, mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('error'),
                })
            );

            process.env.NODE_ENV = originalEnv;
        });
    });
});
