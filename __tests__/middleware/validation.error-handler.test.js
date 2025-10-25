/**
 * Tests for handleValidationErrors middleware
 * Covers the error handling path in validation middleware
 */

// Mock logger first before any other imports
jest.mock('../../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

// Mock express-validator with chainable methods
const mockChain = {
    optional: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    isAlphanumeric: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isBoolean: jest.fn().mockReturnThis(),
    isURL: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    trim: jest.fn().mockReturnThis(),
    escape: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
};

jest.mock('express-validator', () => ({
    validationResult: jest.fn(),
    body: jest.fn(() => mockChain),
    query: jest.fn(() => mockChain),
    param: jest.fn(() => mockChain),
}));

const { handleValidationErrors } = require('../../middleware/validation');
const { validationResult } = require('express-validator');
const logger = require('../../utils/logger');

describe('Validation Error Handler', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            url: '/test-url',
            method: 'POST',
            ip: '127.0.0.1',
            body: {},
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };

        next = jest.fn();

        jest.clearAllMocks();
    });

    describe('when no validation errors exist', () => {
        it('should call next() and not send response', () => {
            validationResult.mockReturnValue({
                isEmpty: () => true,
                array: () => [],
            });

            handleValidationErrors(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });
    });

    describe('when validation errors exist', () => {
        it('should return 400 with error details', () => {
            const mockErrors = [
                {
                    path: 'username',
                    msg: 'Username is required',
                    value: '',
                },
                {
                    path: 'email',
                    msg: 'Invalid email format',
                    value: 'bad-email',
                },
            ];

            validationResult.mockReturnValue({
                isEmpty: () => false,
                array: () => mockErrors,
            });

            handleValidationErrors(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: {
                    message: 'Validation failed',
                    code: 400,
                    details: [
                        {
                            field: 'username',
                            message: 'Username is required',
                            value: '',
                        },
                        {
                            field: 'email',
                            message: 'Invalid email format',
                            value: 'bad-email',
                        },
                    ],
                },
            });

            expect(next).not.toHaveBeenCalled();
        });

        it('should log validation failures with context', () => {
            const mockErrors = [
                {
                    path: 'password',
                    msg: 'Password too short',
                    value: '123',
                },
            ];

            validationResult.mockReturnValue({
                isEmpty: () => false,
                array: () => mockErrors,
            });

            handleValidationErrors(req, res, next);

            expect(logger.warn).toHaveBeenCalledWith('Validation failed', {
                url: '/test-url',
                method: 'POST',
                errors: [
                    {
                        field: 'password',
                        message: 'Password too short',
                        value: '123',
                    },
                ],
                ip: '127.0.0.1',
            });
        });

        it('should handle errors with param instead of path', () => {
            const mockErrors = [
                {
                    param: 'userId',
                    msg: 'Invalid user ID',
                    value: 'abc',
                },
            ];

            validationResult.mockReturnValue({
                isEmpty: () => false,
                array: () => mockErrors,
            });

            handleValidationErrors(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: {
                    message: 'Validation failed',
                    code: 400,
                    details: [
                        {
                            field: 'userId',
                            message: 'Invalid user ID',
                            value: 'abc',
                        },
                    ],
                },
            });
        });

        it('should handle multiple validation errors', () => {
            const mockErrors = [
                { path: 'field1', msg: 'Error 1', value: 'val1' },
                { path: 'field2', msg: 'Error 2', value: 'val2' },
                { path: 'field3', msg: 'Error 3', value: 'val3' },
            ];

            validationResult.mockReturnValue({
                isEmpty: () => false,
                array: () => mockErrors,
            });

            handleValidationErrors(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: {
                    message: 'Validation failed',
                    code: 400,
                    details: expect.arrayContaining([
                        expect.objectContaining({ field: 'field1' }),
                        expect.objectContaining({ field: 'field2' }),
                        expect.objectContaining({ field: 'field3' }),
                    ]),
                },
            });
        });

        it('should handle errors with missing values', () => {
            const mockErrors = [
                {
                    path: 'requiredField',
                    msg: 'Field is required',
                    value: undefined,
                },
            ];

            validationResult.mockReturnValue({
                isEmpty: () => false,
                array: () => mockErrors,
            });

            handleValidationErrors(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('edge cases', () => {
        it('should handle request without IP address', () => {
            delete req.ip;

            const mockErrors = [{ path: 'test', msg: 'Test error', value: 'test' }];

            validationResult.mockReturnValue({
                isEmpty: () => false,
                array: () => mockErrors,
            });

            handleValidationErrors(req, res, next);

            expect(logger.warn).toHaveBeenCalledWith('Validation failed', expect.any(Object));
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should handle request with different methods', () => {
            req.method = 'GET';
            req.url = '/api/users?invalid=param';

            const mockErrors = [{ path: 'invalid', msg: 'Invalid param', value: 'param' }];

            validationResult.mockReturnValue({
                isEmpty: () => false,
                array: () => mockErrors,
            });

            handleValidationErrors(req, res, next);

            expect(logger.warn).toHaveBeenCalledWith(
                'Validation failed',
                expect.objectContaining({
                    method: 'GET',
                    url: '/api/users?invalid=param',
                })
            );
        });
    });
});
