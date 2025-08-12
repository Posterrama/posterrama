const { createValidationMiddleware, validateQueryParams, sanitizeInput, validateRequest, schemas } = require('../middleware/validate');
const DOMPurify = require('dompurify');
const { ApiError } = require('../errors');
const { validate } = require('../validators');

// Mock dependencies
jest.mock('dompurify');
jest.mock('../errors');
jest.mock('../validators');

describe('Validation Middleware - Comprehensive Tests', () => {
    let req, res, next;
    let mockPurify;

    beforeEach(() => {
        jest.clearAllMocks();
        
        req = {
            method: 'POST',
            path: '/api/test',
            body: {},
            query: {},
            id: 'test-request-id'
        };
        
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        
        next = jest.fn();
        
        // Setup DOMPurify mock
        mockPurify = {
            sanitize: jest.fn(input => input) // Return input unchanged by default
        };
        DOMPurify.mockReturnValue(mockPurify);
        
        // Mock Date.now for consistent timestamps
        jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T00:00:00.000Z');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Sanitization Function', () => {
        test('should sanitize string input', () => {
            mockPurify.sanitize.mockReturnValue('clean string');
            
            const result = sanitizeInput('<script>alert("xss")</script>');
            
            expect(mockPurify.sanitize).toHaveBeenCalledWith('<script>alert("xss")</script>');
            expect(result).toBe('clean string');
        });

        test('should sanitize array of strings', () => {
            mockPurify.sanitize.mockImplementation(input => `clean_${input}`);
            
            const result = sanitizeInput(['<script>evil</script>', 'normal text']);
            
            expect(result).toEqual(['clean_<script>evil</script>', 'clean_normal text']);
        });

        test('should sanitize object properties', () => {
            mockPurify.sanitize.mockImplementation(input => `clean_${input}`);
            
            const result = sanitizeInput({
                name: '<script>evil</script>',
                description: 'normal text',
                nested: {
                    field: '<img onerror="alert(1)" src=x>'
                }
            });
            
            expect(result).toEqual({
                name: 'clean_<script>evil</script>',
                description: 'clean_normal text',
                nested: {
                    field: 'clean_<img onerror="alert(1)" src=x>'
                }
            });
        });

        test('should handle non-string primitives', () => {
            const result = sanitizeInput({
                number: 42,
                boolean: true,
                null: null,
                undefined: undefined
            });
            
            expect(result).toEqual({
                number: 42,
                boolean: true,
                null: null,
                undefined: undefined
            });
            expect(mockPurify.sanitize).not.toHaveBeenCalled();
        });

        test('should handle null and undefined input', () => {
            expect(sanitizeInput(null)).toBe(null);
            expect(sanitizeInput(undefined)).toBe(undefined);
        });

        test('should handle empty array', () => {
            const result = sanitizeInput([]);
            expect(result).toEqual([]);
        });

        test('should handle empty object', () => {
            const result = sanitizeInput({});
            expect(result).toEqual({});
        });
    });

    describe('Config Schema Validation', () => {
        const configMiddleware = createValidationMiddleware(schemas.config);
        
        test('should pass valid config', () => {
            req.body = {
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
                    rottenTomatoesMinimumScore: 7.0
                }
            };
            
            configMiddleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('should fail with missing required fields', () => {
            req.body = {
                config: {
                    clockWidget: true
                    // Missing other required fields
                }
            };
            
            configMiddleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: 'Validation failed',
                details: expect.arrayContaining([
                    expect.objectContaining({
                        field: 'config.transitionIntervalSeconds',
                        message: expect.stringContaining('required')
                    })
                ]),
                timestamp: '2023-01-01T00:00:00.000Z',
                path: '/api/test',
                method: 'POST',
                requestId: 'test-request-id'
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('should fail with invalid clockFormat', () => {
            req.body = {
                config: {
                    clockWidget: true,
                    clockFormat: 'invalid',
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7.0
                }
            };
            
            configMiddleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            field: 'config.clockFormat',
                            message: expect.stringContaining('must be one of')
                        })
                    ])
                })
            );
        });

        test('should fail with out-of-range values', () => {
            req.body = {
                config: {
                    clockWidget: true,
                    transitionIntervalSeconds: 500, // Too high
                    backgroundRefreshMinutes: -5,   // Too low
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 15  // Too high
                }
            };
            
            configMiddleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            field: 'config.transitionIntervalSeconds',
                            message: expect.stringContaining('less than or equal to')
                        }),
                        expect.objectContaining({
                            field: 'config.backgroundRefreshMinutes',
                            message: expect.stringContaining('greater than or equal to')
                        }),
                        expect.objectContaining({
                            field: 'config.rottenTomatoesMinimumScore',
                            message: expect.stringContaining('less than or equal to')
                        })
                    ])
                })
            );
        });

        test('should handle optional kenBurnsEffect', () => {
            req.body = {
                config: {
                    clockWidget: true,
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7.0,
                    kenBurnsEffect: {
                        enabled: true,
                        durationSeconds: 30
                    }
                }
            };
            
            configMiddleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
        });

        test('should handle optional mediaServers config', () => {
            req.body = {
                config: {
                    clockWidget: true,
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7.0,
                    mediaServers: {
                        plex: {
                            hostname: 'localhost',
                            port: 32400,
                            token: 'test-token',
                            ssl: true
                        }
                    }
                }
            };
            
            configMiddleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
        });
    });

    describe('Plex Connection Schema Validation', () => {
        const plexMiddleware = createValidationMiddleware(schemas.plexConnection);
        
        test('should pass valid hostname and port', () => {
            req.body = {
                hostname: 'plex.example.com',
                port: 32400,
                token: 'test-token'
            };
            
            plexMiddleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
        });

        test('should pass valid IP address', () => {
            req.body = {
                hostname: '192.168.1.100',
                port: 32400
            };
            
            plexMiddleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
        });

        test('should fail with invalid hostname', () => {
            req.body = {
                hostname: 'invalid..hostname',
                port: 32400
            };
            
            plexMiddleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            field: 'hostname',
                            message: 'Invalid hostname format'
                        })
                    ])
                })
            );
        });

        test('should fail with invalid port range', () => {
            req.body = {
                hostname: 'localhost',
                port: 70000 // Too high
            };
            
            plexMiddleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should allow missing optional token', () => {
            req.body = {
                hostname: 'plex.example.com',
                port: 32400
            };
            
            plexMiddleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
        });
    });

    describe('Query Parameters Validation', () => {
        test('should pass valid query parameters', () => {
            req.query = {
                limit: '10',
                offset: '0'
            };
            
            validateQueryParams(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
        });

        test('should strip unknown query parameters', () => {
            req.query = {
                limit: '10',
                offset: '0',
                unknown: 'value',
                another: 'param'
            };
            
            validateQueryParams(req, res, next);
            
            expect(req.query).toEqual({
                limit: '10',
                offset: '0'
            });
            expect(next).toHaveBeenCalledWith();
        });

        test('should fail with invalid limit', () => {
            req.query = {
                limit: '5000' // Too high
            };
            
            validateQueryParams(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Invalid query parameters',
                details: expect.arrayContaining([
                    expect.stringContaining('less than or equal to')
                ])
            });
        });

        test('should fail with negative offset', () => {
            req.query = {
                offset: '-5'
            };
            
            validateQueryParams(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('Validation Middleware Factory', () => {
        test('should validate different request properties', () => {
            const queryMiddleware = createValidationMiddleware(schemas.queryParams, 'query');
            
            req.query = {
                limit: '10'
            };
            
            queryMiddleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith();
        });

        test('should sanitize input before validation', () => {
            mockPurify.sanitize.mockReturnValue('sanitized');
            const middleware = createValidationMiddleware(schemas.plexConnection);
            
            req.body = {
                hostname: '<script>evil</script>localhost',
                port: 32400
            };
            
            middleware(req, res, next);
            
            expect(mockPurify.sanitize).toHaveBeenCalledWith('<script>evil</script>localhost');
        });

        test('should use unknown request ID when not provided', () => {
            req.id = undefined;
            req.body = {}; // Invalid data
            
            const middleware = createValidationMiddleware(schemas.config);
            middleware(req, res, next);
            
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'unknown'
                })
            );
        });

        test('should preserve valid data after validation', () => {
            const middleware = createValidationMiddleware(schemas.plexConnection);
            
            req.body = {
                hostname: 'localhost',
                port: 32400,
                token: 'test-token'
            };
            
            middleware(req, res, next);
            
            expect(req.body).toEqual({
                hostname: 'localhost',
                port: 32400,
                token: 'test-token'
            });
        });
    });

    describe('Legacy Validation Function', () => {
        beforeEach(() => {
            validate.mockReturnValue({ valid: 'data' });
            ApiError.mockImplementation((status, message) => {
                const error = new Error(message);
                error.status = status;
                return error;
            });
        });

        test('should validate POST request body', () => {
            const schema = 'testSchema';
            const middleware = validateRequest(schema);
            
            req.method = 'POST';
            req.body = { test: 'data' };
            
            middleware(req, res, next);
            
            expect(validate).toHaveBeenCalledWith(schema, { test: 'data' });
            expect(req.validatedData).toEqual({ valid: 'data' });
            expect(next).toHaveBeenCalledWith();
        });

        test('should validate GET request query', () => {
            const schema = 'testSchema';
            const middleware = validateRequest(schema);
            
            req.method = 'GET';
            req.query = { param: 'value' };
            
            middleware(req, res, next);
            
            expect(validate).toHaveBeenCalledWith(schema, { param: 'value' });
            expect(req.validatedData).toEqual({ valid: 'data' });
            expect(next).toHaveBeenCalledWith();
        });

        test('should handle validation errors', () => {
            const schema = 'testSchema';
            const middleware = validateRequest(schema);
            
            validate.mockImplementation(() => {
                throw new Error('Validation failed');
            });
            
            req.body = { invalid: 'data' };
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 400,
                    message: 'Validation failed'
                })
            );
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('should handle missing request property', () => {
            const middleware = createValidationMiddleware(schemas.config, 'nonexistent');
            
            middleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should handle circular references in input', () => {
            const circular = {};
            circular.self = circular;
            
            req.body = {
                config: {
                    clockWidget: true,
                    circular: circular,
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7.0
                }
            };
            
            const middleware = createValidationMiddleware(schemas.config);
            
            expect(() => middleware(req, res, next)).not.toThrow();
        });

        test('should handle DOMPurify errors gracefully', () => {
            mockPurify.sanitize.mockImplementation(() => {
                throw new Error('DOMPurify error');
            });
            
            req.body = {
                hostname: 'test',
                port: 32400
            };
            
            const middleware = createValidationMiddleware(schemas.plexConnection);
            
            expect(() => middleware(req, res, next)).not.toThrow();
        });

        test('should handle very large input', () => {
            const largeString = 'x'.repeat(10000);
            req.body = {
                config: {
                    customMessage: largeString,
                    clockWidget: true,
                    transitionIntervalSeconds: 30,
                    backgroundRefreshMinutes: 60,
                    showClearLogo: true,
                    showPoster: true,
                    showMetadata: true,
                    showRottenTomatoes: true,
                    rottenTomatoesMinimumScore: 7.0
                }
            };
            
            const middleware = createValidationMiddleware(schemas.config);
            middleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            field: 'config.customMessage',
                            message: expect.stringContaining('length must be less than')
                        })
                    ])
                })
            );
        });
    });

    describe('Schema Exports', () => {
        test('should export all required schemas', () => {
            expect(schemas).toHaveProperty('config');
            expect(schemas).toHaveProperty('plexConnection');
            expect(schemas).toHaveProperty('queryParams');
            
            expect(schemas.config).toBeDefined();
            expect(schemas.plexConnection).toBeDefined();
            expect(schemas.queryParams).toBeDefined();
        });
    });
});
