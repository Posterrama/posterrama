/**
 * Tests specifically for the createTestLogger factory ensuring isolation
 * from the default singleton and proper memory log handling.
 */

const loggerModule = require('../../utils/logger');

describe('createTestLogger factory', () => {
    test('creates isolated logger instances', async () => {
        const a = loggerModule.createTestLogger({ level: 'debug' });
        const b = loggerModule.createTestLogger({ level: 'error' });
        expect(a).not.toBe(b);
        a.__resetMemory();
        b.__resetMemory();
        a.info('[TEST-LOG] A1');
        b.error('[TEST-LOG] B1');
        // Poll a few times because Winston stream write can be async
        for (let i = 0; i < 10 && a.memoryLogs.length === 0; i++) {
            await new Promise(r => setTimeout(r, 5));
        }
        expect(a.memoryLogs.some(l => l.message.includes('A1'))).toBe(true);
        expect(a.memoryLogs.some(l => l.message.includes('B1'))).toBe(false);
        expect(b.memoryLogs.some(l => l.message.includes('B1'))).toBe(true);
    });

    test('respects silent option', async () => {
        const silentLogger = loggerModule.createTestLogger({ silent: true, level: 'info' });
        silentLogger.__resetMemory();
        silentLogger.info(
            'Should still appear in memory despite silent (silent only suppresses output)'
        );
        for (let i = 0; i < 10 && silentLogger.memoryLogs.length === 0; i++) {
            await new Promise(r => setTimeout(r, 5));
        }
        expect(silentLogger.memoryLogs.length).toBeGreaterThanOrEqual(1);
    });
});
