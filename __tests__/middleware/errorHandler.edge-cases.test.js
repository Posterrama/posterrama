/**
 * Edge case tests for errorHandler middleware
 * Covers production-specific paths and error scenarios
 */

const { errorHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');

describe('Error Handler Edge Cases', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            method: 'GET',
            path: '/test',
            url: '/test',
            requestId: 'test-123',
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            headersSent: false,
            locals: {},
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('Production mode error logging', () => {
        const originalEnv = process.env.NODE_ENV;

        afterEach(() => {
            process.env.NODE_ENV = originalEnv;
        });

        it('should log client errors as warn in production (line 72)', () => {
            process.env.NODE_ENV = 'production';
            const logWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();
            const error = new Error('Client error');
            error.statusCode = 400;

            errorHandler(error, req, res, next);

            expect(logWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Error Handler] Caught error'),
                expect.objectContaining({
                    stack: error.stack,
                    timestamp: expect.any(String),
                })
            );
            expect(res.status).toHaveBeenCalledWith(400);
            logWarnSpy.mockRestore();
        });

        it('should log server errors as error in production (line 111)', () => {
            process.env.NODE_ENV = 'production';
            const logErrorSpy = jest.spyOn(logger, 'error').mockImplementation();
            const error = new Error('Server error');
            error.statusCode = 500;

            errorHandler(error, req, res, next);

            expect(logErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Error Handler] Caught error'),
                expect.objectContaining({
                    stack: error.stack,
                    timestamp: expect.any(String),
                })
            );
            expect(res.status).toHaveBeenCalledWith(500);
            logErrorSpy.mockRestore();
        });
    });

    describe('Headers already sent scenario', () => {
        it('should log debug and return early when headers already sent (lines 132-137)', () => {
            res.headersSent = true;
            const logDebugSpy = jest.spyOn(logger, 'debug').mockImplementation();
            const error = new Error('Test error');

            errorHandler(error, req, res, next);

            expect(logDebugSpy).toHaveBeenCalledWith(
                '[Error Handler] Response headers already sent; logging only',
                {
                    path: req.path,
                    method: req.method,
                    statusCode: 500,
                }
            );
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
            logDebugSpy.mockRestore();
        });

        it('should not attempt to send response when headers already sent', () => {
            res.headersSent = true;
            const error = new Error('Another error');
            error.statusCode = 400;

            errorHandler(error, req, res, next);

            expect(res.json).not.toHaveBeenCalled();
        });
    });

    describe('Error without request ID', () => {
        it('should handle errors when requestId is missing', () => {
            delete req.requestId;
            delete res.locals.requestId;
            const error = new Error('Error without ID');

            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'unknown',
                    error: 'Error without ID',
                })
            );
        });
    });

    describe('Session ENOENT errors', () => {
        it('should log session ENOENT as warning', () => {
            const logWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();
            const error = new Error(
                'ENOENT: no such file or directory, open /sessions/abc123.json'
            );
            error.code = 'ENOENT';

            errorHandler(error, req, res, next);

            expect(logWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('session ENOENT'),
                expect.any(Object)
            );
            logWarnSpy.mockRestore();
        });
    });
});
