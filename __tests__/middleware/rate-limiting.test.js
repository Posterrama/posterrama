const rl = require('../../middleware/rateLimiter');
describe('Rate Limiter (migrated smoke)', () => {
	test('exports factory createRateLimiter', () => {
		expect(typeof rl.createRateLimiter).toBe('function');
		// quick instantiate to ensure returns a middleware fn
		const mw = rl.createRateLimiter(1000, 5, 'Too many');
		expect(typeof mw).toBe('function');
	});
});
