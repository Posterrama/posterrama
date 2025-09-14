/**
 * Tests for Swagger x-internal filtering and Testing tag pruning
 */

const path = require('path');

// Helper to require swagger.js fresh with a mocked swagger-jsdoc return value
function loadSwaggerWithSpec(mockSpec) {
    jest.resetModules();
    jest.doMock('swagger-jsdoc', () => jest.fn(() => mockSpec));
    const swaggerPath = path.join(process.cwd(), 'swagger.js');
    delete require.cache[swaggerPath];
    // eslint-disable-next-line global-require
    return require('../../swagger.js');
}

describe('swagger.js x-internal filter and tag pruning', () => {
    afterEach(() => {
        jest.resetModules();
        jest.dontMock('swagger-jsdoc');
    });

    test('removes operations marked x-internal and prunes empty paths', () => {
        const mockSpec = {
            openapi: '3.0.0',
            tags: [{ name: 'Public API' }, { name: 'Testing' }],
            paths: {
                '/public': {
                    get: { summary: 'public', 'x-internal': false, tags: ['Public API'] },
                    post: { summary: 'internal', 'x-internal': true, tags: ['Testing'] },
                },
                '/internal-only': {
                    post: { summary: 'internal-only', 'x-internal': true, tags: ['Testing'] },
                },
            },
        };

        const spec = loadSwaggerWithSpec(mockSpec);

        // internal-only path removed entirely
        expect(spec.paths['/internal-only']).toBeUndefined();
        // public path kept with only the non-internal operation
        expect(spec.paths['/public']).toBeDefined();
        expect(spec.paths['/public'].get).toBeDefined();
        expect(spec.paths['/public'].post).toBeUndefined();
    });

    test('removes Testing tag when no remaining ops reference it', () => {
        const mockSpec = {
            openapi: '3.0.0',
            tags: [{ name: 'Public API' }, { name: 'Testing' }],
            paths: {
                '/public': {
                    get: { summary: 'public', 'x-internal': false, tags: ['Public API'] },
                },
                '/test-internal': {
                    get: { summary: 'internal', 'x-internal': true, tags: ['Testing'] },
                },
            },
        };

        const spec = loadSwaggerWithSpec(mockSpec);

        const tagNames = (spec.tags || []).map(t => t.name);
        expect(tagNames).toContain('Public API');
        expect(tagNames).not.toContain('Testing');
    });

    test('keeps Testing tag when at least one op still references it', () => {
        const mockSpec = {
            openapi: '3.0.0',
            tags: [{ name: 'Public API' }, { name: 'Testing' }],
            paths: {
                '/public': {
                    get: { summary: 'public', 'x-internal': false, tags: ['Public API'] },
                },
                '/still-testing': {
                    get: { summary: 'public test', 'x-internal': false, tags: ['Testing'] },
                },
            },
        };

        const spec = loadSwaggerWithSpec(mockSpec);

        const tagNames = (spec.tags || []).map(t => t.name);
        expect(tagNames).toContain('Testing');
    });
});
