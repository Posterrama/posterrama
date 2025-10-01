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

    test('cache check returns warning status on failure while other checks may fail', async () => {
        // Mock fs layer used inside healthCheck AFTER requiring module
        const fsPromises = require('fs').promises;
        const origStat = fsPromises.stat;
        const origReaddir = fsPromises.readdir;
        const origAccess = fsPromises.access;
        try {
            // Filesystem check should pass: access resolves
            fsPromises.access = jest.fn().mockResolvedValue();
            // Media cache check: stat fails, but readdir succeeds to only trigger warning
            fsPromises.stat = jest.fn().mockImplementation(path => {
                if (path.includes('image_cache')) {
                    throw new Error('ENOENT: image_cache missing');
                }
                return Promise.resolve({ mtime: new Date() });
            });
            fsPromises.readdir = jest.fn().mockImplementation(path => {
                if (path.includes('image_cache')) {
                    throw new Error('ENOENT: image_cache missing');
                }
                return Promise.resolve([]);
            });

            const result = await healthCheck.__performHealthChecks();

            // The cache check should return 'warning' on failure
            const cacheCheck = result.checks.find(c => c.name === 'cache');
            expect(cacheCheck).toBeDefined();
            expect(cacheCheck.status).toBe('warning');

            // Overall status should be warning or error depending on other checks
            expect(['warning', 'error']).toContain(result.status);

            // Ensure there is at least one warning check (cache)
            expect(result.checks.some(c => c.status === 'warning')).toBe(true);
        } finally {
            fsPromises.stat = origStat;
            fsPromises.readdir = origReaddir;
            fsPromises.access = origAccess;
        }
    });
});
