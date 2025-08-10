const { ApiError, NotFoundError } = require('../errors');

describe('Error Classes', () => {
    describe('ApiError', () => {
        it('should create an ApiError with status code and message', () => {
            const statusCode = 400;
            const message = 'Bad Request';
            
            const error = new ApiError(statusCode, message);
            
            expect(error.statusCode).toBe(statusCode);
            expect(error.message).toBe(message);
            expect(error.name).toBe('ApiError');
            expect(error instanceof Error).toBe(true);
            expect(error instanceof ApiError).toBe(true);
        });

        it('should have proper error stack trace', () => {
            const error = new ApiError(500, 'Internal Server Error');
            
            expect(error.stack).toBeDefined();
            expect(error.stack).toContain('ApiError');
        });

        it('should handle different status codes', () => {
            const error400 = new ApiError(400, 'Bad Request');
            const error401 = new ApiError(401, 'Unauthorized');
            const error500 = new ApiError(500, 'Internal Server Error');
            
            expect(error400.statusCode).toBe(400);
            expect(error401.statusCode).toBe(401);
            expect(error500.statusCode).toBe(500);
        });

        it('should handle empty message', () => {
            const error = new ApiError(400, '');
            
            expect(error.message).toBe('');
            expect(error.statusCode).toBe(400);
        });

        it('should be serializable to JSON', () => {
            const error = new ApiError(422, 'Validation Error');
            
            const serialized = JSON.stringify(error);
            const parsed = JSON.parse(serialized);
            
            expect(parsed.message).toBe('Validation Error');
            expect(parsed.name).toBe('ApiError');
        });
    });

    describe('NotFoundError', () => {
        it('should create a NotFoundError with default message', () => {
            const error = new NotFoundError();
            
            expect(error.statusCode).toBe(404);
            expect(error.message).toBe('Resource not found');
            expect(error.name).toBe('NotFoundError');
            expect(error instanceof Error).toBe(true);
            expect(error instanceof ApiError).toBe(true);
            expect(error instanceof NotFoundError).toBe(true);
        });

        it('should create a NotFoundError with custom message', () => {
            const customMessage = 'User not found';
            const error = new NotFoundError(customMessage);
            
            expect(error.statusCode).toBe(404);
            expect(error.message).toBe(customMessage);
            expect(error.name).toBe('NotFoundError');
        });

        it('should inherit from ApiError', () => {
            const error = new NotFoundError();
            
            expect(error instanceof ApiError).toBe(true);
            expect(error instanceof NotFoundError).toBe(true);
        });

        it('should have proper prototype chain', () => {
            const error = new NotFoundError();
            
            expect(Object.getPrototypeOf(error)).toBe(NotFoundError.prototype);
            expect(Object.getPrototypeOf(NotFoundError.prototype)).toBe(ApiError.prototype);
            expect(Object.getPrototypeOf(ApiError.prototype)).toBe(Error.prototype);
        });

        it('should handle different not found scenarios', () => {
            const userNotFound = new NotFoundError('User with ID 123 not found');
            const fileNotFound = new NotFoundError('File not found');
            const pageNotFound = new NotFoundError('Page not found');
            
            expect(userNotFound.message).toBe('User with ID 123 not found');
            expect(fileNotFound.message).toBe('File not found');
            expect(pageNotFound.message).toBe('Page not found');
            
            expect(userNotFound.statusCode).toBe(404);
            expect(fileNotFound.statusCode).toBe(404);
            expect(pageNotFound.statusCode).toBe(404);
        });

        it('should maintain stack trace', () => {
            function throwNotFoundError() {
                throw new NotFoundError('Test not found');
            }
            
            expect(() => throwNotFoundError()).toThrow();
            
            try {
                throwNotFoundError();
            } catch (error) {
                expect(error.stack).toBeDefined();
                expect(error.stack).toContain('throwNotFoundError');
            }
        });
    });

    describe('Error instanceof checks', () => {
        it('should properly identify error types', () => {
            const apiError = new ApiError(400, 'Bad Request');
            const notFoundError = new NotFoundError('Not Found');
            const regularError = new Error('Regular error');
            
            // ApiError checks
            expect(apiError instanceof Error).toBe(true);
            expect(apiError instanceof ApiError).toBe(true);
            expect(apiError instanceof NotFoundError).toBe(false);
            
            // NotFoundError checks
            expect(notFoundError instanceof Error).toBe(true);
            expect(notFoundError instanceof ApiError).toBe(true);
            expect(notFoundError instanceof NotFoundError).toBe(true);
            
            // Regular Error checks
            expect(regularError instanceof Error).toBe(true);
            expect(regularError instanceof ApiError).toBe(false);
            expect(regularError instanceof NotFoundError).toBe(false);
        });
    });
});
