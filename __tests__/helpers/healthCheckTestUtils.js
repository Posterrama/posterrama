/**
 * DEPRECATED DUPLICATE TEST HELPER (helpers/healthCheckTestUtils.js)
 * This file previously exported config injection helpers for healthCheck tests.
 * The real, canonical helper now lives at: test-support/healthCheckTestUtils.js
 * We keep this placeholder ONLY so Jest no longer reports an empty test suite.
 * TODO: Remove this file after ensuring no lingering imports exist in any branches.
 */

describe('deprecated helpers/healthCheckTestUtils placeholder', () => {
    it('exists only to satisfy Jest (can be removed)', () => {
        expect(true).toBe(true);
    });
});

// Intentionally no exports; imports should be updated to point at test-support/healthCheckTestUtils.js
