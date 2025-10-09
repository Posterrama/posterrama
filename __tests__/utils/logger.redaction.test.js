const logger = require('../../utils/logger');

beforeAll(() => {
    logger.level = 'debug';
    logger.silent = false; // force logging even if TESTS_SILENT
});

beforeEach(() => {
    // reset memory logs to simplify assertions order
    logger.memoryLogs.length = 0;
});

describe('Logger token redaction', () => {
    test('redacts plex token in query string', done => {
        const msg = 'Fetching /library?X-Plex-Token=ABC123XYZ';
        const handler = log => {
            if (!log.message.includes('Fetching')) return; // ensure matching log
            try {
                expect(log.message).not.toContain('ABC123XYZ');
                expect(log.message).toContain('***REDACTED***');
                done();
            } finally {
                logger.events.removeListener('log', handler);
            }
        };
        logger.events.on('log', handler);
        logger.info(msg);
    });

    test('redacts bearer token header', done => {
        const msg = 'Authorization: Bearer verySecretTOKEN-_123';
        const handler = log => {
            if (!log.message.includes('Authorization: Bearer')) return;
            try {
                expect(/verySecretTOKEN-_123/.test(log.message)).toBe(false);
                expect(log.message).toMatch(/Bearer\s+\*\*\*REDACTED\*\*\*/);
                done();
            } finally {
                logger.events.removeListener('log', handler);
            }
        };
        logger.events.on('log', handler);
        logger.info(msg);
    });

    test('redacts multiple tokens in mixed string', done => {
        const msg = 'X_PLEX_TOKEN=AAA111 BBB JELLYFIN_API_KEY=BBB222';
        const handler = log => {
            if (!log.message.includes('X_PLEX_TOKEN')) return;
            try {
                expect(log.message).not.toMatch(/AAA111|BBB222/);
                const redactedCount = (log.message.match(/\*\*\*REDACTED\*\*\*/g) || []).length;
                expect(redactedCount).toBeGreaterThanOrEqual(2);
                done();
            } finally {
                logger.events.removeListener('log', handler);
            }
        };
        logger.events.on('log', handler);
        logger.info(msg);
    });
});
