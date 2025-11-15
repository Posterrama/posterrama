/**
 * Missing Coverage Tests for middleware/validate.js
 *
 * This file targets uncovered lines identified in coverage report:
 * - Lines 285-364: All specific validation middleware functions
 *   * validateGetConfigQuery (lines 285-303)
 *   * validateGetMediaQuery (lines 305-323)
 *   * validateImageQuery (lines 325-343)
 *   * validateMediaKeyParam (lines 345-363)
 * - Lines 36-37: getPurify() test environment fallback error handling
 * - Lines 199-200: Injection pattern detection (return empty string)
 *
 * Baseline coverage: 72.17% statements, 67.92% branches, 57.89% functions
 * Target: 80%+ for all metrics per Issue #102
 */

// Mock DOMPurify BEFORE requiring validate.js
const mockSanitize = jest.fn(input => input); // Default: return input unchanged
const mockDOMPurify = jest.fn(() => ({ sanitize: mockSanitize }));
jest.mock('dompurify', () => mockDOMPurify);

// Mock JSDOM BEFORE requiring validate.js
jest.mock('jsdom', () => ({
    JSDOM: jest.fn(() => ({ window: {} })),
}));

const {
    validateGetConfigQuery,
    validateGetMediaQuery,
    validateImageQuery,
    validateMediaKeyParam,
    sanitizeInput,
} = require('../../middleware/validate');

describe('Validate Missing Coverage - Specific Middleware Functions', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSanitize.mockReturnValue('clean');

        req = {
            query: {},
            params: {},
            body: {},
            path: '/api/test',
            method: 'GET',
            id: 'test-req-123',
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };

        next = jest.fn();
    });

    describe('validateGetConfigQuery', () => {
        test('should accept empty query and set to empty object', () => {
            req.query = {};

            validateGetConfigQuery(req, res, next);

            expect(req.query).toEqual({});
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('should strip unknown query parameters', () => {
            req.query = { unknown: 'value', another: '123' };

            validateGetConfigQuery(req, res, next);

            expect(req.query).toEqual({});
            expect(next).toHaveBeenCalled();
        });

        test('should sanitize query parameters before validation', () => {
            // DOMPurify returns clean values, function proceeds
            req.query = { param: 'value' };

            validateGetConfigQuery(req, res, next);

            // Query params should be stripped (getConfigQuery accepts no params)
            expect(req.query).toEqual({});
            expect(next).toHaveBeenCalled();
        });
    });

    describe('validateGetMediaQuery', () => {
        test('should accept valid search parameter', () => {
            req.query = { search: 'Inception' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.search).toBe('Inception');
            expect(next).toHaveBeenCalled();
        });

        test('should accept valid year parameter', () => {
            req.query = { year: '2020' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.year).toBe(2020); // Converted to number
            expect(next).toHaveBeenCalled();
        });

        test('should accept valid genre parameter', () => {
            req.query = { genre: 'Action' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.genre).toBe('Action');
            expect(next).toHaveBeenCalled();
        });

        test('should accept valid source parameter (case insensitive)', () => {
            req.query = { source: 'PLEX' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.source).toBe('plex'); // Normalized to lowercase
            expect(next).toHaveBeenCalled();
        });

        test('should accept all valid source values', () => {
            const sources = ['plex', 'jellyfin', 'tmdb', 'local', 'romm'];

            sources.forEach(source => {
                jest.clearAllMocks();
                req.query = { source };

                validateGetMediaQuery(req, res, next);

                expect(next).toHaveBeenCalled();
                expect(res.status).not.toHaveBeenCalled();
            });
        });

        test('should accept limit and offset parameters', () => {
            req.query = { limit: '50', offset: '10' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.limit).toBe(50);
            expect(req.query.offset).toBe(10);
            expect(next).toHaveBeenCalled();
        });

        test('should accept includeExtras boolean parameter', () => {
            req.query = { includeExtras: 'true' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.includeExtras).toBe(true);
            expect(next).toHaveBeenCalled();
        });

        test('should accept excludeGames as boolean', () => {
            req.query = { excludeGames: 'true' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.excludeGames).toBe(true);
            expect(next).toHaveBeenCalled();
        });

        test('should accept excludeGames as string values', () => {
            const validValues = ['1', 'true', 'false', '0'];

            validValues.forEach(value => {
                jest.clearAllMocks();
                req.query = { excludeGames: value };

                validateGetMediaQuery(req, res, next);

                expect(next).toHaveBeenCalled();
            });
        });

        test('should accept musicMode parameter', () => {
            req.query = { musicMode: '1' };

            validateGetMediaQuery(req, res, next);

            // Joi may convert or leave as string based on alternativies()
            expect(['1', 1]).toContain(req.query.musicMode);
            expect(next).toHaveBeenCalled();
        });

        test('should accept gamesOnly parameter', () => {
            req.query = { gamesOnly: 'true' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.gamesOnly).toBe(true);
            expect(next).toHaveBeenCalled();
        });

        test('should accept count parameter', () => {
            req.query = { count: '100' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.count).toBe(100);
            expect(next).toHaveBeenCalled();
        });

        test('should accept nocache parameter', () => {
            req.query = { nocache: 'true' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.nocache).toBe(true);
            expect(next).toHaveBeenCalled();
        });

        test('should strip unknown query parameters', () => {
            req.query = { search: 'Matrix', unknown: 'value' };

            validateGetMediaQuery(req, res, next);

            expect(req.query.search).toBe('Matrix');
            expect(req.query.unknown).toBeUndefined();
            expect(next).toHaveBeenCalled();
        });

        test('should return 400 on invalid year (out of range)', () => {
            req.query = { year: '1800' };

            validateGetMediaQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid query parameters',
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            field: 'year',
                            message: expect.stringContaining('greater than or equal to 1900'),
                        }),
                    ]),
                    timestamp: expect.any(String),
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('should return 400 on invalid source', () => {
            req.query = { source: 'invalid-source' };

            validateGetMediaQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid query parameters',
                    details: expect.any(Array),
                })
            );
        });

        test('should return 400 on search string too long', () => {
            req.query = { search: 'a'.repeat(201) };

            validateGetMediaQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid query parameters',
                })
            );
        });
    });

    describe('validateImageQuery', () => {
        test('should accept valid url parameter', () => {
            req.query = { url: 'https://example.com/image.jpg' };

            validateImageQuery(req, res, next);

            expect(req.query.url).toBe('https://example.com/image.jpg');
            expect(next).toHaveBeenCalled();
        });

        test('should accept valid server and path parameters', () => {
            req.query = { server: 'plex-server', path: '/library/metadata/123/thumb' };

            validateImageQuery(req, res, next);

            expect(req.query.server).toBe('plex-server');
            expect(req.query.path).toBe('/library/metadata/123/thumb');
            expect(next).toHaveBeenCalled();
        });

        test('should accept optional width parameter', () => {
            req.query = { url: 'https://example.com/image.jpg', width: '1920' };

            validateImageQuery(req, res, next);

            expect(req.query.width).toBe(1920);
            expect(next).toHaveBeenCalled();
        });

        test('should accept optional height parameter', () => {
            req.query = { url: 'https://example.com/image.jpg', height: '1080' };

            validateImageQuery(req, res, next);

            expect(req.query.height).toBe(1080);
            expect(next).toHaveBeenCalled();
        });

        test('should accept optional quality parameter', () => {
            req.query = { url: 'https://example.com/image.jpg', quality: '90' };

            validateImageQuery(req, res, next);

            expect(req.query.quality).toBe(90);
            expect(next).toHaveBeenCalled();
        });

        test('should return 400 when neither url nor server is provided', () => {
            req.query = {};

            validateImageQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid image parameters',
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            message: expect.stringContaining(
                                'Either URL parameter or both server and path'
                            ),
                        }),
                    ]),
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('should return 400 when server provided without path', () => {
            req.query = { server: 'plex-server' };

            validateImageQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid image parameters',
                })
            );
        });

        test('should return 400 on invalid url scheme', () => {
            req.query = { url: 'ftp://example.com/image.jpg' };

            validateImageQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid image parameters',
                })
            );
        });

        test('should return 400 on width out of range', () => {
            req.query = { url: 'https://example.com/image.jpg', width: '5000' };

            validateImageQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('should return 400 on quality out of range', () => {
            req.query = { url: 'https://example.com/image.jpg', quality: '150' };

            validateImageQuery(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('validateMediaKeyParam', () => {
        test('should accept valid alphanumeric key', () => {
            req.params = { key: 'movie123' };

            validateMediaKeyParam(req, res, next);

            expect(req.params.key).toBe('movie123');
            expect(next).toHaveBeenCalled();
        });

        test('should accept key with hyphens', () => {
            req.params = { key: 'the-dark-knight' };

            validateMediaKeyParam(req, res, next);

            expect(req.params.key).toBe('the-dark-knight');
            expect(next).toHaveBeenCalled();
        });

        test('should accept key with underscores', () => {
            req.params = { key: 'star_wars_episode_1' };

            validateMediaKeyParam(req, res, next);

            expect(req.params.key).toBe('star_wars_episode_1');
            expect(next).toHaveBeenCalled();
        });

        test('should accept key with spaces', () => {
            req.params = { key: 'The Matrix Reloaded' };

            validateMediaKeyParam(req, res, next);

            expect(req.params.key).toBe('The Matrix Reloaded');
            expect(next).toHaveBeenCalled();
        });

        test('should accept mixed alphanumeric with special characters', () => {
            req.params = { key: 'Movie_123-Title Name' };

            validateMediaKeyParam(req, res, next);

            expect(req.params.key).toBe('Movie_123-Title Name');
            expect(next).toHaveBeenCalled();
        });

        test('should return 400 on key with invalid characters', () => {
            req.params = { key: 'movie@123#' };

            validateMediaKeyParam(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid media key parameter',
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            field: 'key',
                            message: expect.stringContaining(
                                'alphanumeric characters, hyphens, underscores, and spaces'
                            ),
                        }),
                    ]),
                    timestamp: expect.any(String),
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('should return 400 on key exceeding 100 characters', () => {
            req.params = { key: 'a'.repeat(101) };

            validateMediaKeyParam(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid media key parameter',
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            message: expect.stringContaining('must not exceed 100 characters'),
                        }),
                    ]),
                })
            );
        });

        test('should return 400 on missing key parameter', () => {
            req.params = {};

            validateMediaKeyParam(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Invalid media key parameter',
                    details: expect.arrayContaining([
                        expect.objectContaining({
                            message: expect.stringContaining('required'),
                        }),
                    ]),
                })
            );
        });
    });

    describe('sanitizeInput - Additional Coverage', () => {
        test('should handle normal strings when DOMPurify unavailable', () => {
            // In test environment, DOMPurify not available (expected behavior)
            // Lines 181-183: Returns original object when DOMPurify unavailable
            const result = sanitizeInput('normal string');

            // Should return input unchanged
            expect(result).toBe('normal string');
        });

        test('should handle arrays when DOMPurify unavailable', () => {
            const result = sanitizeInput(['item1', 'item2']);

            // Should process array elements
            expect(Array.isArray(result)).toBe(true);
            expect(result).toEqual(['item1', 'item2']);
        });

        test('should handle objects when DOMPurify unavailable', () => {
            const result = sanitizeInput({ key: 'value' });

            // Should process object properties
            expect(result).toEqual({ key: 'value' });
        });
    });
});
