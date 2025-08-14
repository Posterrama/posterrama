const { createValidationMiddleware } = require('../../middleware/validate');
describe('Validate Middleware (migrated smoke)', () => {
	test('factory exports a function', () => {
		expect(typeof createValidationMiddleware).toBe('function');
	});
});
