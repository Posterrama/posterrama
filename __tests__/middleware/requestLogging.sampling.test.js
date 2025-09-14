/**
 * Tests for requestLoggingMiddleware sampling and NODE_ENV behavior
 */

const http = require('http');
const events = require('events');

describe('middleware.requestLoggingMiddleware', () => {
    const ORIGINAL_ENV = { ...process.env };

    // Helper to create a fake req/res pair and invoke the middleware
    function makeReqRes(url = '/api/test', method = 'GET') {
        const req = new http.IncomingMessage();
        req.method = method;
        req.url = url;
        req.headers = {};
        req.get = h => req.headers[h.toLowerCase()];
        req.ip = '127.0.0.1';

        const res = new http.ServerResponse(req);
        res.statusCode = 200;
        res.locals = {};
        // Monkey-patch json to immediately emit finish after sending
        res.json = function json(data) {
            // simulate express behavior then finish
            process.nextTick(() => res.emit('finish'));
            return data;
        };

        return { req, res };
    }

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
        jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        jest.restoreAllMocks();
    });

    test('logs with info in NODE_ENV=test (no sampling)', async () => {
        process.env.NODE_ENV = 'test';
        const logger = require('../../utils/logger');
        const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

        const { requestLoggingMiddleware } = require('../../middleware');
        const mw = requestLoggingMiddleware();
        const { req, res } = makeReqRes('/api/devices');

        const next = jest.fn();
        mw(req, res, next);
        // Finish a normal json response
        res.json({ ok: true });

        // Wait for finish event to propagate
        await events.once(res, 'finish');

        expect(infoSpy).toHaveBeenCalledWith(
            'API request completed',
            expect.objectContaining({ url: '/api/devices', method: 'GET', statusCode: 200 })
        );
    });

    test('respects API_REQUEST_LOG_SAMPLE sampling in non-test env', async () => {
        process.env.NODE_ENV = 'production';
        process.env.API_REQUEST_LOG_LEVEL = 'debug';
        process.env.API_REQUEST_LOG_SAMPLE = '1'; // always log, but through sampling branch

        const logger = require('../../utils/logger');
        const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});

        const { requestLoggingMiddleware } = require('../../middleware');
        const mw = requestLoggingMiddleware();
        const { req, res } = makeReqRes('/api/admin/config');

        const next = jest.fn();
        mw(req, res, next);
        res.json({ ok: true });

        await events.once(res, 'finish');

        expect(debugSpy).toHaveBeenCalledWith(
            'API request completed',
            expect.objectContaining({ url: '/api/admin/config' })
        );
    });

    test('skips logging for excluded noisy endpoints', async () => {
        process.env.NODE_ENV = 'production';
        const logger = require('../../utils/logger');
        const anySpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
        jest.spyOn(logger, 'debug').mockImplementation(() => {});

        const { requestLoggingMiddleware } = require('../../middleware');
        const mw = requestLoggingMiddleware();

        const excluded = ['/api/admin/events', '/api/admin/logs', '/api/devices/heartbeat'];
        for (const url of excluded) {
            const { req, res } = makeReqRes(url);
            const next = jest.fn();
            mw(req, res, next);
            res.json({ ok: true });
            await events.once(res, 'finish');
        }

        expect(anySpy).not.toHaveBeenCalled();
    });
});
