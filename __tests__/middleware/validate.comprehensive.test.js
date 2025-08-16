const {
    createValidationMiddleware,
    validateQueryParams,
    sanitizeInput,
    validateRequest,
    schemas
} = require('../../middleware/validate');

// Mock DOMPurify
const mockSanitize = jest.fn();
jest.mock('dompurify', () => jest.fn(() => ({ sanitize: mockSanitize })));

// Mock JSDOM
jest.mock('jsdom', () => ({
    JSDOM: jest.fn(() => ({ window: {} }))
}));

// Mock validators module
const mockValidate = jest.fn();
jest.mock('../../validators', () => ({ validate: mockValidate }));

// Mock errors module
const mockApiError = jest.fn().mockImplementation((status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
});
jest.mock('../../errors', () => ({ ApiError: mockApiError }));

describe('Validate Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSanitize.mockReturnValue('sanitized');
        
        req = {
            body: {},
            query: {},
            path: '/api/test',
            method: 'POST',
            id: 'test-request-id'
        };
        
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        
        next = jest.fn();

        // Reset NODE_ENV
        delete process.env.NODE_ENV;
    });

    describe('sanitizeInput function', () => {
        test('should handle string input correctly', () => {
            mockSanitize.mockReturnValue('clean string');
            
            const result = sanitizeInput('<script>alert("xss")</script>');
            
            // The function should attempt to sanitize strings
            expect(typeof result).toBe('string');
        });

        test('should handle sanitization errors gracefully', () => {
            mockSanitize.mockImplementation(() => {
                throw new Error('Sanitization failed');
            });
            
            const result = sanitizeInput('test string');
            
            expect(result).toBe('test string');
        });

        test('should handle arrays correctly', () => {
            const result = sanitizeInput(['script', 'normal', 'img']);
            
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(3);
        });

        test('should handle objects correctly', () => {
            const input = {
                name: 'script',
                nested: {
                    value: 'img'
                }
            };
            
            const result = sanitizeInput(input);
            
            expect(typeof result).toBe('object');
            expect(result.name).toBeDefined();
            expect(result.nested.value).toBeDefined();
        });

        test('should handle circular references', () => {
            const obj = { name: 'test' };
            obj.self = obj;
            
            const result = sanitizeInput(obj);
            
            expect(result).toEqual(obj);
        });

        test('should return non-string/object/array values unchanged', () => {
            expect(sanitizeInput(42)).toBe(42);
            expect(sanitizeInput(true)).toBe(true);
            expect(sanitizeInput(null)).toBe(null);
            expect(sanitizeInput(undefined)).toBe(undefined);
        });

        test('should handle environment correctly', () => {
            process.env.NODE_ENV = 'test';
            
            const result = sanitizeInput('test');
            
            expect(typeof result).toBe('string');
        });
    });

    describe('createValidationMiddleware', () => {
        let validationMiddleware;

        beforeEach(() => {
            validationMiddleware = createValidationMiddleware(schemas.config, 'body');
        });

        test('should validate valid config successfully', () => {
            req.body = {
                config: {
                    clockWidget: true,
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7
                }
            };
            mockSanitize.mockImplementation(val => val);

            validationMiddleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('should reject invalid config', () => {
            req.body = {
                config: {
                    clockWidget: 'invalid',
                    transitionIntervalSeconds: -1
                }
            };
            mockSanitize.mockImplementation(val => val);

            validationMiddleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Validation failed',
                details: expect.arrayContaining([
                    expect.objectContaining({
                        field: 'config.clockWidget',
                        message: expect.any(String)
                    })
                ]),
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'POST',
                requestId: 'test-request-id'
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('should handle missing request property', () => {
            delete req.body;

            validationMiddleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: "Validation failed: request property 'body' is missing",
                details: [],
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'POST',
                requestId: 'test-request-id'
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('should use "unknown" requestId when req.id is missing', () => {
            delete req.id;
            delete req.body;

            validationMiddleware(req, res, next);

            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs.requestId).toBe('unknown');
        });

        test('should process input correctly', () => {
            req.body = {
                config: {
                    clockWidget: true,
                    customMessage: 'test_message',
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7
                }
            };

            validationMiddleware(req, res, next);

            expect(req.body.config.customMessage).toBeDefined();
            expect(next).toHaveBeenCalled();
        });

        test('should work with different request properties', () => {
            const queryValidation = createValidationMiddleware(schemas.queryParams, 'query');
            req.query = { limit: 10, offset: 0 };
            mockSanitize.mockImplementation(val => val);

            queryValidation(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('validateQueryParams middleware', () => {
        test('should validate valid query parameters', () => {
            req.query = { limit: '10', offset: '0' };

            validateQueryParams(req, res, next);

            expect(req.query).toEqual({ limit: '10', offset: '0' });
            expect(next).toHaveBeenCalled();
        });

        test('should strip unknown query parameters', () => {
            req.query = { limit: '10', offset: '0', unknown: 'value' };

            validateQueryParams(req, res, next);

            expect(req.query).toEqual({ limit: '10', offset: '0' });
            expect(next).toHaveBeenCalled();
        });

        test('should reject invalid query parameters', () => {
            req.query = { limit: 'invalid', offset: -1 };

            validateQueryParams(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Invalid query parameters',
                details: expect.arrayContaining([
                    expect.any(String)
                ])
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('should handle empty query parameters', () => {
            req.query = {};

            validateQueryParams(req, res, next);

            expect(req.query).toEqual({});
            expect(next).toHaveBeenCalled();
        });

        test('should preserve original string representations', () => {
            req.query = { limit: '10' };

            validateQueryParams(req, res, next);

            expect(req.query.limit).toBe('10');
            expect(typeof req.query.limit).toBe('string');
        });
    });

    describe('validateRequest legacy function', () => {
        test('should validate GET request with query params', () => {
            req.method = 'GET';
            req.query = { test: 'value' };
            mockValidate.mockReturnValue({ validated: 'data' });
            
            const middleware = validateRequest('testSchema');
            middleware(req, res, next);

            expect(mockValidate).toHaveBeenCalledWith('testSchema', { test: 'value' });
            expect(req.validatedData).toEqual({ validated: 'data' });
            expect(next).toHaveBeenCalled();
        });

        test('should validate POST request with body', () => {
            req.method = 'POST';
            req.body = { test: 'value' };
            mockValidate.mockReturnValue({ validated: 'data' });
            
            const middleware = validateRequest('testSchema');
            middleware(req, res, next);

            expect(mockValidate).toHaveBeenCalledWith('testSchema', { test: 'value' });
            expect(req.validatedData).toEqual({ validated: 'data' });
            expect(next).toHaveBeenCalled();
        });

        test('should handle validation errors', () => {
            req.method = 'POST';
            req.body = { invalid: 'data' };
            mockValidate.mockImplementation(() => {
                throw new Error('Validation error: Invalid field');
            });
            
            const middleware = validateRequest('testSchema');
            middleware(req, res, next);

            expect(mockApiError).toHaveBeenCalledWith(400, 'Invalid field');
            expect(next).toHaveBeenCalled();
        });

        test('should strip "Validation error:" prefix from error messages', () => {
            req.method = 'POST';
            req.body = { invalid: 'data' };
            mockValidate.mockImplementation(() => {
                throw new Error('Validation error: Field is required');
            });
            
            const middleware = validateRequest('testSchema');
            middleware(req, res, next);

            expect(mockApiError).toHaveBeenCalledWith(400, 'Field is required');
        });

        test('should handle errors without validation prefix', () => {
            req.method = 'POST';
            req.body = { invalid: 'data' };
            mockValidate.mockImplementation(() => {
                throw new Error('Simple error');
            });
            
            const middleware = validateRequest('testSchema');
            middleware(req, res, next);

            expect(mockApiError).toHaveBeenCalledWith(400, 'Simple error');
        });
    });

    describe('schemas', () => {
        test('should export config schema', () => {
            expect(schemas.config).toBeDefined();
            expect(typeof schemas.config.validate).toBe('function');
        });

        test('should export plexConnection schema', () => {
            expect(schemas.plexConnection).toBeDefined();
            expect(typeof schemas.plexConnection.validate).toBe('function');
        });

        test('should export queryParams schema', () => {
            expect(schemas.queryParams).toBeDefined();
            expect(typeof schemas.queryParams.validate).toBe('function');
        });

        test('should validate plex connection with valid hostname', () => {
            const validData = {
                hostname: 'plex.example.com',
                port: 32400,
                token: 'abc123'
            };

            const { error } = schemas.plexConnection.validate(validData);
            expect(error).toBeUndefined();
        });

        test('should validate plex connection with IP address', () => {
            const validData = {
                hostname: '192.168.1.100',
                port: 32400
            };

            const { error } = schemas.plexConnection.validate(validData);
            expect(error).toBeUndefined();
        });

        test('should reject invalid plex hostname', () => {
            const invalidData = {
                hostname: 'invalid..hostname',
                port: 32400
            };

            const { error } = schemas.plexConnection.validate(invalidData);
            expect(error).toBeDefined();
        });

        test('should validate complete config schema', () => {
            const validConfig = {
                config: {
                    clockWidget: true,
                    clockTimezone: 'America/New_York',
                    clockFormat: '12h',
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7.5,
                    kenBurnsEffect: {
                        enabled: true,
                        durationSeconds: 30
                    },
                    mediaServers: {
                        plex: {
                            hostname: 'plex.local',
                            port: 32400,
                            token: 'abc123',
                            ssl: true
                        }
                    },
                    customMessage: 'Welcome to Posterrama'
                }
            };

            const { error } = schemas.config.validate(validConfig);
            expect(error).toBeUndefined();
        });
    });

    describe('Edge cases and integration', () => {
        test('should handle validation with complex nested objects', () => {
            const middleware = createValidationMiddleware(schemas.config);
            req.body = {
                config: {
                    clockWidget: true,
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7,
                    kenBurnsEffect: {
                        enabled: true,
                        durationSeconds: 45
                    }
                }
            };
            mockSanitize.mockImplementation(val => val);

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should handle multiple validation errors', () => {
            const middleware = createValidationMiddleware(schemas.config);
            req.body = {
                config: {
                    clockWidget: 'not_boolean',
                    transitionIntervalSeconds: -5,
                    backgroundRefreshMinutes: 2000,
                    showClearLogo: 'not_boolean'
                }
            };
            mockSanitize.mockImplementation(val => val);

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs.details.length).toBeGreaterThan(1);
        });

        test('should handle custom validation messages for plex connection', () => {
            const middleware = createValidationMiddleware(schemas.plexConnection);
            req.body = {
                hostname: 'invalid..hostname',
                port: 32400
            };
            mockSanitize.mockImplementation(val => val);

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            const callArgs = res.json.mock.calls[0][0];
            expect(callArgs.details.some(d => d.message.includes('Invalid hostname format'))).toBe(true);
        });
    });

    describe('Module exports', () => {
        test('should export all required functions and schemas', () => {
            expect(typeof createValidationMiddleware).toBe('function');
            expect(typeof validateQueryParams).toBe('function');
            expect(typeof sanitizeInput).toBe('function');
            expect(typeof validateRequest).toBe('function');
            expect(typeof schemas).toBe('object');
            expect(schemas.config).toBeDefined();
            expect(schemas.plexConnection).toBeDefined();
            expect(schemas.queryParams).toBeDefined();
        });
    });
});
