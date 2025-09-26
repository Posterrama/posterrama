const logger = require('../../utils/logger');
function loadFresh() {
    delete require.cache[require.resolve('../../middleware/deviceBypass')];
    return require('../../middleware/deviceBypass');
}

beforeAll(() => {
    process.env.DEBUG = 'true';
    logger.updateLogLevelFromDebug();
});

afterAll(() => {});

beforeEach(() => {
    logger.__resetMemory();
    global.__capturedInfo = [];
    logger.__origInfo = logger.info;
    logger.info = (msg, meta) => {
        global.__capturedInfo.push({ msg, meta });
        logger.__origInfo(msg, meta);
    };
});

afterEach(() => {
    if (logger.__origInfo) logger.info = logger.__origInfo;
});

function buildReq({ ip = '10.0.0.5', url = '/stream', method = 'GET', headers = {} } = {}) {
    return {
        ip,
        url,
        method,
        headers,
        connection: { remoteAddress: ip },
    };
}

function run(mw, req) {
    return new Promise(resolve => mw(req, {}, resolve));
}

describe('deviceBypass middleware coverage', () => {
    test('no allowlist yields no bypass flag', async () => {
        const { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList([]);
        const req = buildReq();
        await run(deviceBypassMiddleware, req);
        expect(req.deviceBypass).toBeUndefined();
    });

    test('single IP allow match sets bypass and logs once', async () => {
        const { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList(['10.0.0.5']);
        const req1 = buildReq({ ip: '10.0.0.5' });
        await run(deviceBypassMiddleware, req1);
        expect(req1.deviceBypass).toBe(true);
        const firstLogCount = global.__capturedInfo.filter(l =>
            l.msg.includes('Device whitelisted')
        ).length;
        expect(firstLogCount).toBe(1);
        const req2 = buildReq({ ip: '10.0.0.5' });
        await run(deviceBypassMiddleware, req2);
        const secondLogCount = global.__capturedInfo.filter(l =>
            l.msg.includes('Device whitelisted')
        ).length;
        expect(secondLogCount).toBe(1);
    });

    test('CIDR range match works', async () => {
        const { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList(['192.168.0.0/16']);
        const req = buildReq({ ip: '192.168.50.77' });
        await run(deviceBypassMiddleware, req);
        expect(req.deviceBypass).toBe(true);
    });

    test('invalid entries are ignored without crash', async () => {
        const { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList(['not-an-ip', '300.300.300.300', '2001:db8::/129']);
        const req = buildReq({ ip: '203.0.113.10' });
        await run(deviceBypassMiddleware, req);
        expect(req.deviceBypass).toBeUndefined();
    });

    test('X-Forwarded-For header takes precedence', async () => {
        const { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList(['203.0.113.42']);
        const req = buildReq({
            ip: '10.1.1.1',
            headers: { 'x-forwarded-for': '203.0.113.42, 1.2.3.4' },
        });
        await run(deviceBypassMiddleware, req);
        expect(req.deviceBypass).toBe(true);
    });

    test('admin/asset requests do not log even if bypassed', async () => {
        const { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList(['10.0.0.5']);
        const req = buildReq({ ip: '10.0.0.5', url: '/admin/dashboard' });
        await run(deviceBypassMiddleware, req);
        const logs = global.__capturedInfo.filter(l => l.msg.includes('Device whitelisted'));
        expect(logs.length).toBe(0);
    });

    test('reloading module with different allowlist logs again (simulated refresh)', async () => {
        let { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList(['10.0.0.5']);
        const req1 = buildReq({ ip: '10.0.0.5' });
        await run(deviceBypassMiddleware, req1);
        expect(global.__capturedInfo.filter(l => l.msg.includes('Device whitelisted')).length).toBe(
            1
        );
        // Reset captured logs so we only count logs from the reloaded module
        global.__capturedInfo = [];
        logger.__resetMemory();
        ({ deviceBypassMiddleware, __testSetAllowList } = loadFresh());
        __testSetAllowList(['10.0.0.5', '10.0.0.6']);
        const req2 = buildReq({ ip: '10.0.0.5' });
        await run(deviceBypassMiddleware, req2);
        expect(global.__capturedInfo.filter(l => l.msg.includes('Device whitelisted')).length).toBe(
            1
        );
    });

    test('IPv6 single and CIDR matching', async () => {
        const { deviceBypassMiddleware, __testSetAllowList } = loadFresh();
        __testSetAllowList(['2001:db8::1', '2001:db8:abcd::/48']);
        const req1 = buildReq({ ip: '2001:db8::1' });
        await run(deviceBypassMiddleware, req1);
        expect(req1.deviceBypass).toBe(true);
        const req2 = buildReq({ ip: '2001:db8:abcd:0:0:0:1:5' });
        await run(deviceBypassMiddleware, req2);
        expect(req2.deviceBypass).toBe(true);
    });
});
