const {
    userContextMiddleware,
    loginSuccessMiddleware,
    logoutMiddleware,
} = require('../../middleware/user-context');
const logger = require('../../utils/logger');

// Silence actual logger transports; we'll inspect memory logs
beforeAll(() => {
    process.env.DEBUG = 'true';
    logger.updateLogLevelFromDebug();
    logger.__resetMemory();
});

beforeEach(() => {
    logger.__resetMemory();
    global.__captured = { debug: [], info: [] };
    logger.__origDebug = logger.debug;
    logger.__origInfo = logger.info;
    logger.debug = (msg, meta) => {
        global.__captured.debug.push({ msg, meta });
        logger.__origDebug(msg, meta);
    };
    logger.info = (msg, meta) => {
        global.__captured.info.push({ msg, meta });
        logger.__origInfo(msg, meta);
    };
});

afterEach(() => {
    if (logger.__origDebug) logger.debug = logger.__origDebug;
    if (logger.__origInfo) logger.info = logger.__origInfo;
});

function buildReq(opts = {}) {
    return {
        method: opts.method || 'GET',
        path: opts.path || '/',
        ip: opts.ip || '127.0.0.1',
        session: opts.session || {},
        sessionID: opts.sessionID || 'sess123',
        headers: opts.headers || {},
        query: opts.query || {},
        get(h) {
            return this.headers[h.toLowerCase()];
        },
    };
}

function run(mw, req, res = {}, next = () => {}) {
    mw(req, res, next);
}

describe('user-context middleware coverage', () => {
    test('classifies api_access and logs non-noisy endpoint', () => {
        const req = buildReq({ path: '/api/movies', method: 'GET' });
        run(userContextMiddleware, req, {});
        const entry = global.__captured.debug.find(e => e.msg.includes('API access'));
        expect(entry).toBeTruthy();
        expect(req.userContext).toBeDefined();
        expect(req.userContext.method).toBe('GET');
    });

    test('skips logging for noisy metrics endpoint', () => {
        const req = buildReq({ path: '/api/admin/metrics', method: 'GET' });
        run(userContextMiddleware, req, {});
        // ensure no new memory log referencing this exact path
        const match = logger.memoryLogs.filter(l => l.meta?.endpoint === '/api/admin/metrics');
        expect(match.length).toBe(0);
    });

    test('auth_action classification logs authentication action', () => {
        const req = buildReq({ path: '/login', method: 'POST' });
        run(userContextMiddleware, req, {});
        const authLog = global.__captured.info.find(e => e.msg.includes('Authentication action'));
        expect(authLog).toBeTruthy();
    });

    test('loginSuccessMiddleware logs when session user present', () => {
        const req = buildReq({ session: { user: { username: 'admin' } }, path: '/admin' });
        run(
            (rq, rs, nx) => userContextMiddleware(rq, rs, () => loginSuccessMiddleware(rq, rs, nx)),
            req,
            {}
        );
        const loginLog = global.__captured.info.find(e => e.msg.includes('Admin login successful'));
        expect(loginLog).toBeTruthy();
    });

    test('logoutMiddleware logs when session user present', () => {
        const req = buildReq({
            session: {
                user: { username: 'admin' },
                cookie: { maxAge: 60000, originalMaxAge: 60000 },
            },
            path: '/logout',
        });
        run(
            (rq, rs, nx) => userContextMiddleware(rq, rs, () => logoutMiddleware(rq, rs, nx)),
            req,
            {}
        );
        const logoutLog = global.__captured.info.find(e => e.msg.includes('Admin logout'));
        expect(logoutLog).toBeTruthy();
    });
});
