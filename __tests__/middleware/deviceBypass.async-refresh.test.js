const fs = require('fs');
const path = require('path');

function setImmediateAsync() {
    return new Promise(resolve => setImmediate(resolve));
}

describe('deviceBypassMiddleware async refresh', () => {
    test('does not read config.json synchronously and updates allowlist asynchronously', async () => {
        jest.resetModules();
        let now = new Date('2020-01-01T00:00:00.000Z').getTime();
        const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

        // Seed from config.json module cache with an empty allow list (startup behavior)
        jest.doMock('../../config.json', () => ({
            deviceMgmt: { bypass: { ipAllowList: [] } },
        }));

        const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');
        const readFileAsyncSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(
            JSON.stringify({
                deviceMgmt: { bypass: { ipAllowList: ['10.0.0.1'] } },
            })
        );

        const { deviceBypassMiddleware } = require('../../middleware/deviceBypass');

        const req1 = {
            headers: {},
            ip: '10.0.0.1',
            url: '/wallart',
            method: 'GET',
        };

        deviceBypassMiddleware(req1, {}, () => {});
        expect(req1.deviceBypass).toBeUndefined();

        // Force refresh interval to elapse and allow the background refresh promise chain to settle.
        now += 31_000;
        await setImmediateAsync();
        await setImmediateAsync();

        const req2 = {
            headers: {},
            ip: '10.0.0.1',
            url: '/wallart',
            method: 'GET',
        };

        deviceBypassMiddleware(req2, {}, () => {});
        // Non-blocking refresh: the first request after the interval may still use the old list.
        expect(req2.deviceBypass).toBeUndefined();

        expect(readFileAsyncSpy).toHaveBeenCalled();

        await setImmediateAsync();
        await setImmediateAsync();

        const req3 = {
            headers: {},
            ip: '10.0.0.1',
            url: '/wallart',
            method: 'GET',
        };

        deviceBypassMiddleware(req3, {}, () => {});
        expect(req3.deviceBypass).toBe(true);

        const readConfigJsonSync = readFileSyncSpy.mock.calls.some(call =>
            String(call?.[0] || '').endsWith(`${path.sep}config.json`)
        );
        expect(readConfigJsonSync).toBe(false);

        readFileAsyncSpy.mockRestore();
        readFileSyncSpy.mockRestore();

        nowSpy.mockRestore();
    });
});
