const logger = require('../../utils/logger');

// Minimal active smoke to avoid overlap; use warn/error only (info is below test logger level)
describe('logger coverage (smoke active)', () => {
    // Ensure logger is not fully silenced by TEST_SILENT in this focused smoke
    beforeAll(() => {
        if (logger && typeof logger === 'object') {
            logger.silent = false;
        }
    });

    beforeEach(() => logger.__resetMemory());

    test('logs go to memory and events fire', async () => {
        const events = logger.events;
        const seen = [];
        const unsub = msg => seen.push(msg);
        events.on('log', unsub);

        logger.warn('careful');
        logger.error('boom');
        // allow async stream write
        await new Promise(r => setTimeout(r, 25));

        events.removeListener('log', unsub);
        const logs = logger.getRecentLogs();
        expect(logs.length).toBeGreaterThanOrEqual(2);
        expect(seen.some(m => m && (m.message || '').includes('boom'))).toBe(true);
    });

    test('admin exclusion filter', async () => {
        logger.__resetMemory();
        logger.warn('[Request Logger] Received: x'); // excluded
        logger.error('boom'); // included
        await new Promise(r => setTimeout(r, 15));
        const logs = logger.getRecentLogs();
        expect(logs.find(l => (l.message || '').includes('Received'))).toBeUndefined();
        expect(logs.find(l => (l.message || '').includes('boom'))).toBeTruthy();
    });

    test('getRecentLogs level filter', async () => {
        logger.__resetMemory();
        logger.warn('b');
        logger.error('c');
        await new Promise(r => setTimeout(r, 15));
        expect(logger.getRecentLogs('INFO').length).toBeGreaterThanOrEqual(2);
        expect(logger.getRecentLogs('WARN').length).toBeGreaterThanOrEqual(2);
        expect(logger.getRecentLogs('ERROR').length).toBeGreaterThanOrEqual(1);
    });
});
