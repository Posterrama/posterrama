// Consolidated error class tests (merged from root-level duplicates)
const { ApiError, NotFoundError } = require('../../utils/errors');

describe('Error Classes (consolidated)', () => {
    test('ApiError stores status code', () => {
        expect(new ApiError(400, '').statusCode).toBe(400);
    });
    test('ApiError serializes to JSON', () => {
        const e = new ApiError(422, 'Validation');
        const parsed = JSON.parse(JSON.stringify(e));
        expect(parsed.name).toBe('ApiError');
        expect(parsed.message).toBe('Validation');
        expect(parsed.statusCode).toBe(422);
        expect(parsed.stack).toBeDefined();
    });
    test('NotFoundError default & custom', () => {
        const d = new NotFoundError();
        const c = new NotFoundError('X');
        expect(d.statusCode).toBe(404);
        expect(c.message).toBe('X');
    });
    test('NotFoundError prototype chain', () => {
        const n = new NotFoundError();
        expect(n instanceof ApiError).toBe(true);
    });
    test('NotFoundError serializes to JSON', () => {
        const n = new NotFoundError('Custom not found');
        const parsed = JSON.parse(JSON.stringify(n));
        expect(parsed.name).toBe('NotFoundError');
        expect(parsed.message).toBe('Custom not found');
        expect(parsed.statusCode).toBe(404);
        expect(parsed.stack).toBeDefined();
    });
    test('ApiError toJSON method directly', () => {
        const e = new ApiError(500, 'Server error');
        const json = e.toJSON();
        expect(json.name).toBe('ApiError');
        expect(json.message).toBe('Server error');
        expect(json.statusCode).toBe(500);
        expect(json.stack).toBeDefined();
    });
    test('NotFoundError toJSON method directly', () => {
        const n = new NotFoundError('Direct test');
        const json = n.toJSON();
        expect(json.name).toBe('NotFoundError');
        expect(json.message).toBe('Direct test');
        expect(json.statusCode).toBe(404);
        expect(json.stack).toBeDefined();
    });
    test('ApiError name property', () => {
        const e = new ApiError(400, 'Bad request');
        expect(e.name).toBe('ApiError');
    });
    test('NotFoundError name property', () => {
        const n = new NotFoundError('Missing resource');
        expect(n.name).toBe('NotFoundError');
    });
});
