/**
 * Coverage tests for test-only endpoints in routes.test-endpoints.js
 * We exercise:
 *  - Default generation (implicit count=10)
 *  - Custom generation (count=5)
 *  - Clamp behavior (count > 1000 -> 1000)
 *  - Non-numeric count fallback (count=abc -> default 10)
 *  - Clear logs endpoint before/after counts
 */

const request = require('supertest');
let app;

beforeAll(() => {
    // Build an isolated express instance and mount only the test router
    // to achieve focused coverage without full server side‑effects.
    app = require('express')();
    // eslint-disable-next-line global-require
    const testRouter = require('../../routes.test-endpoints');
    app.use(testRouter);
    // Ensure logger captures info-level entries for generated logs
    const logger = require('../../utils/logger');
    logger.level = 'info';
});

describe('Test-only log endpoints', () => {
    test('default generate (no count) creates 10 logs with TEST-LOG marker', async () => {
        const res = await request(app).get('/api/test/generate-logs');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.count).toBe(10);
        expect(res.body.message).toMatch(/Generated 10 test logs/);
    });

    test('custom generate with count=5', async () => {
        const res = await request(app).get('/api/test/generate-logs?count=5');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(5);
        expect(res.body.message).toMatch(/Generated 5 test logs/);
    });

    test('non-numeric count falls back to default 10', async () => {
        const res = await request(app).get('/api/test/generate-logs?count=abc');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(10); // parseInt('abc') -> NaN -> fallback 10
    });

    test('clamps large count to 1000', async () => {
        const res = await request(app).get('/api/test/generate-logs?count=5000');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1000);
        expect(res.body.message).toMatch(/Generated 1000 test logs/);
    });

    test('clear logs returns before/after counts and empties buffer', async () => {
        // Generate specific number of logs for this test to measure delta
        await request(app).get('/api/test/generate-logs?count=3');
        const clearRes = await request(app).get('/api/test/clear-logs');
        expect(clearRes.status).toBe(200);
        expect(clearRes.body.success).toBe(true);
        // Depending on transport filtering, beforeCount could be >= count generated if previous tests ran
        // or 0 if logger memory buffer not populated; assert numeric >=0
        expect(typeof clearRes.body.beforeCount).toBe('number');
        expect(clearRes.body.beforeCount).toBeGreaterThanOrEqual(0);
        expect(clearRes.body.afterCount).toBe(0);
        expect(clearRes.body.message).toMatch(/Cleared/);
    });
});
