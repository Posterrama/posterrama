// We rely on the original module implementation (no rewire). Because performHealthChecks
// closes over its internal function definitions, we cannot simply override the exported
// members to influence behavior. Instead we induce a natural warning by making the
// media cache check fail while keeping others successful.

describe('healthCheck degraded overall status', () => {
    let healthCheck;
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        // Ensure a clean module instance each run
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV }; // restore env
        healthCheck = require('../../utils/healthCheck');
        if (healthCheck.__resetCache) healthCheck.__resetCache();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('aggregates to warning when media cache emits warning but others ok', async () => {
        // Mock fs layer used inside healthCheck AFTER requiring module
        const fsPromises = require('fs').promises;
        const origStat = fsPromises.stat;
        const origReaddir = fsPromises.readdir;
        const origAccess = fsPromises.access;
        try {
            // Filesystem check should pass: access resolves
            fsPromises.access = jest.fn().mockResolvedValue();
            // Media cache check: stat or readdir rejection triggers warning branch
            fsPromises.stat = jest.fn().mockRejectedValue(new Error('ENOENT: image_cache missing'));
            fsPromises.readdir = jest
                .fn()
                .mockRejectedValue(new Error('ENOENT: image_cache missing'));

            const result = await healthCheck.__performHealthChecks();
            expect(result.status).toBe('warning');
            const cacheCheck = result.checks.find(c => c.name === 'cache');
            expect(cacheCheck).toBeDefined();
            expect(cacheCheck.status).toBe('warning');
            // Ensure no error level checks present to confirm degraded (not failed)
            expect(result.checks.some(c => c.status === 'error')).toBe(false);
        } finally {
            fsPromises.stat = origStat;
            fsPromises.readdir = origReaddir;
            fsPromises.access = origAccess;
        }
    });
});
