/**
 * Tests for source-error-context utility
 * @jest-environment node
 */
const {
    createSourceErrorContext,
    logSourceError,
    createEnhancedError,
    metadataExtractors,
    sanitizeUrl,
} = require('../../utils/source-error-context');

describe('source-error-context', () => {
    describe('sanitizeUrl', () => {
        it('should remove api_key query parameter', () => {
            const url = 'https://api.example.com/data?api_key=secret123&other=value';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).toContain('other=value');
            expect(sanitized).not.toContain('secret123');
        });

        it('should remove apikey query parameter', () => {
            const url = 'https://api.example.com/data?apikey=secret123';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).not.toContain('secret123');
            expect(sanitized).toBe('https://api.example.com/data');
        });

        it('should remove X-Plex-Token query parameter', () => {
            const url = 'http://plex.local:32400/library?X-Plex-Token=abc123';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).not.toContain('abc123');
            expect(sanitized).toBe('http://plex.local:32400/library');
        });

        it('should mask username and password in URL credentials', () => {
            const url = 'http://user:pass@example.com/path';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).toContain('***');
            expect(sanitized).not.toContain('user');
            expect(sanitized).not.toContain('pass');
        });

        it('should handle multiple sensitive parameters', () => {
            const url = 'https://api.example.com/data?api_key=secret&token=abc&apikey=xyz';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).not.toContain('secret');
            expect(sanitized).not.toContain('abc');
            expect(sanitized).not.toContain('xyz');
        });

        it('should handle URLs without sensitive data', () => {
            const url = 'https://api.example.com/data?page=1&limit=10';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).toContain('page=1');
            expect(sanitized).toContain('limit=10');
        });

        it('should handle non-URL strings gracefully', () => {
            const result = sanitizeUrl('not a url string');
            // Non-URL strings that don't have sensitive patterns are returned as-is
            expect(result).toBe('not a url string');
        });

        it('should return "unknown" for empty or null values', () => {
            expect(sanitizeUrl('')).toBe('unknown');
            expect(sanitizeUrl(null)).toBe('unknown');
        });
    });

    describe('createSourceErrorContext', () => {
        it('should create basic error context', () => {
            const error = new Error('Test error');
            const context = createSourceErrorContext({
                source: 'plex:myserver',
                operation: 'fetchMedia',
                error,
            });

            expect(context).toMatchObject({
                source: 'plex:myserver',
                operation: 'fetchMedia',
                error: {
                    message: 'Test error',
                    name: 'Error',
                },
            });
            expect(context.timestamp).toBeDefined();
            // Note: stack is NOT included in context, only in logSourceError output
        });

        it('should include metadata when provided', () => {
            const error = new Error('Test error');
            const metadata = { libraryNames: ['Movies'], count: 50 };
            const context = createSourceErrorContext({
                source: 'plex:myserver',
                operation: 'fetchMedia',
                error,
                metadata,
            });

            expect(context.metadata).toEqual(metadata);
        });

        it('should include metadata as-is (sanitization done by extractors)', () => {
            const error = new Error('Test error');
            const metadata = {
                url: 'https://api.example.com/data?api_key=secret123',
            };
            const context = createSourceErrorContext({
                source: 'tmdb:main',
                operation: 'cachedApiRequest',
                error,
                metadata,
            });

            // Context includes metadata as-is; sanitization is responsibility of metadata extractors
            expect(context.metadata.url).toBe('https://api.example.com/data?api_key=secret123');
        });

        it('should not include stack in context (only in logSourceError)', () => {
            const error = new Error('Test error');
            // Add a realistic stack trace
            error.stack = `Error: Test error
    at Object.<anonymous> (/path/to/file.js:10:15)
    at Module._compile (internal/modules/cjs/loader.js:1063:30)`;

            const context = createSourceErrorContext({
                source: 'test',
                operation: 'test',
                error,
            });

            // Context does NOT include stack - that's added by logSourceError
            expect(context.error.stack).toBeUndefined();
            expect(context.error.stackLines).toBeUndefined();
        });
    });

    describe('logSourceError', () => {
        let mockLogger;

        beforeEach(() => {
            mockLogger = {
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
            };
        });

        it('should log error with default level', () => {
            const error = new Error('Test error');
            logSourceError(mockLogger, {
                source: 'plex:myserver',
                operation: 'fetchMedia',
                error,
            });

            expect(mockLogger.error).toHaveBeenCalledTimes(1);
            const logCall = mockLogger.error.mock.calls[0];
            expect(logCall[0]).toContain('[plex:myserver]');
            expect(logCall[0]).toContain('fetchMedia');
            expect(logCall[0]).toContain('failed');
            expect(logCall[1]).toMatchObject({
                error: expect.objectContaining({
                    message: 'Test error',
                    name: 'Error',
                }),
            });
        });

        it('should log with specified level', () => {
            const error = new Error('Test warning');
            logSourceError(mockLogger, {
                source: 'jellyfin:myserver',
                operation: 'getServerInfo',
                error,
                level: 'warn',
            });

            expect(mockLogger.warn).toHaveBeenCalledTimes(1);
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        it('should include metadata in log', () => {
            const error = new Error('Test error');
            const metadata = { libraryNames: ['Movies', 'TV Shows'], count: 100 };
            logSourceError(mockLogger, {
                source: 'plex:myserver',
                operation: 'fetchMedia',
                error,
                metadata,
            });

            const logCall = mockLogger.error.mock.calls[0];
            expect(logCall[1]).toMatchObject({
                metadata: {
                    libraryNames: ['Movies', 'TV Shows'],
                    count: 100,
                },
            });
        });

        it('should work without metadata', () => {
            const error = new Error('Test error');
            logSourceError(mockLogger, {
                source: 'tmdb:main',
                operation: 'loadGenres',
                error,
            });

            expect(mockLogger.error).toHaveBeenCalledTimes(1);
            const logCall = mockLogger.error.mock.calls[0];
            // Metadata defaults to empty object
            expect(logCall[1].metadata).toEqual({});
        });
    });

    describe('createEnhancedError', () => {
        it('should wrap error with context', () => {
            const originalError = new Error('Original error');
            const enhanced = createEnhancedError({
                source: 'plex:myserver',
                operation: 'fetchMedia',
                originalError,
            });

            expect(enhanced.message).toContain('plex:myserver');
            expect(enhanced.message).toContain('fetchMedia');
            expect(enhanced.message).toContain('Original error');
            expect(enhanced.originalError).toBe(originalError);
            expect(enhanced.source).toBe('plex:myserver');
            expect(enhanced.operation).toBe('fetchMedia');
        });

        it('should include metadata in enhanced error', () => {
            const originalError = new Error('Original error');
            const metadata = { count: 50, type: 'movie' };
            const enhanced = createEnhancedError({
                source: 'tmdb:main',
                operation: 'fetchMedia',
                originalError,
                metadata,
            });

            expect(enhanced.metadata).toEqual(metadata);
        });

        it('should preserve original stack trace', () => {
            const originalError = new Error('Original error');
            const originalStack = originalError.stack;
            const enhanced = createEnhancedError({
                source: 'jellyfin:myserver',
                operation: 'getServerInfo',
                originalError,
            });

            expect(enhanced.stack).toContain(originalStack);
        });
    });

    describe('metadataExtractors', () => {
        describe('fetchMedia', () => {
            it('should extract fetchMedia parameters with filter keys', () => {
                const params = {
                    libraryNames: ['Movies', 'TV Shows'],
                    type: 'movie',
                    count: 50,
                    filters: { genre: 'Action', year: 2023 },
                };
                const metadata = metadataExtractors.fetchMedia(params);

                expect(metadata).toEqual({
                    libraryNames: ['Movies', 'TV Shows'],
                    type: 'movie',
                    count: 50,
                    filters: ['genre', 'year'], // Extracts keys, not values
                });
            });

            it('should handle missing parameters', () => {
                const metadata = metadataExtractors.fetchMedia({});
                expect(metadata).toEqual({
                    libraryNames: undefined,
                    type: undefined,
                    count: undefined,
                    filters: [], // Empty array when no filters
                });
            });
        });

        describe('httpRequest', () => {
            it('should extract and sanitize HTTP request details', () => {
                const request = {
                    url: 'https://api.example.com/data?api_key=secret123',
                    method: 'GET',
                    params: { page: 1, limit: 10 },
                };
                const metadata = metadataExtractors.httpRequest(request);

                // URL should be sanitized
                expect(metadata.url).not.toContain('secret123');
                expect(metadata.method).toBe('GET');
                expect(metadata.params).toEqual(['page', 'limit']); // Extracts keys, not values
            });

            it('should handle requests without params', () => {
                const request = {
                    url: 'https://api.example.com/data',
                    method: 'POST',
                };
                const metadata = metadataExtractors.httpRequest(request);

                expect(metadata.params).toEqual([]); // Empty array when no params
            });
        });

        describe('connection', () => {
            it('should extract server connection details with credential masking', () => {
                const server = {
                    name: 'MyServer',
                    host: 'http://user:pass@plex.local:32400',
                    port: 32400,
                };
                const metadata = metadataExtractors.connection(server);

                expect(metadata.serverName).toBe('MyServer');
                expect(metadata.host).toContain('***'); // Credentials should be masked
                expect(metadata.host).not.toContain('user');
                expect(metadata.host).not.toContain('pass');
                expect(metadata.port).toBe(32400);
            });

            it('should handle server without port', () => {
                const server = {
                    name: 'MyServer',
                    host: 'https://jellyfin.example.com',
                };
                const metadata = metadataExtractors.connection(server);

                expect(metadata.serverName).toBe('MyServer');
                expect(metadata.host).toContain('jellyfin.example.com');
                expect(metadata.port).toBeUndefined();
            });

            it('should handle minimal server config', () => {
                const server = {
                    host: 'http://localhost',
                };
                const metadata = metadataExtractors.connection(server);

                expect(metadata.serverName).toBeUndefined();
                expect(metadata.host).toContain('localhost');
            });
        });
    });
});
