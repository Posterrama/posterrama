/**
 * Custom error classes for the application.
 */

class ApiError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ApiError';
    }
}

class NotFoundError extends ApiError {
    constructor(message = 'Resource not found') {
        super(404, message);
        this.name = 'NotFoundError';
    }
}

module.exports = { ApiError, NotFoundError };