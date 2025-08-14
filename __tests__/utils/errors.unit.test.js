// Consolidated error class tests (merged from root-level duplicates)
const { ApiError, NotFoundError } = require('../../errors');

describe('Error Classes (consolidated)', () => {
	test('ApiError stores status code', () => { expect(new ApiError(400,'').statusCode).toBe(400); });
	test('ApiError serializes to JSON', () => {
		const e = new ApiError(422,'Validation');
		const parsed = JSON.parse(JSON.stringify(e));
		expect(parsed.name).toBe('ApiError');
		expect(parsed.message).toBe('Validation');
	});
	test('NotFoundError default & custom', () => {
		const d = new NotFoundError();
		const c = new NotFoundError('X');
		expect(d.statusCode).toBe(404); expect(c.message).toBe('X');
	});
	test('NotFoundError prototype chain', () => {
		const n = new NotFoundError();
		expect(n instanceof ApiError).toBe(true);
	});
});
