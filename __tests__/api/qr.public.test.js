const request = require('supertest');
const app = require('../../server');

jest.mock('../../utils/logger');

describe('Public QR endpoint', () => {
    test('returns SVG by default', async () => {
        const res = await request(app).get('/api/qr?text=https%3A%2F%2Fexample.com');
        expect([200, 429]).toContain(res.status);
        if (res.status === 200) {
            expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
            const body = res.text || (res.body && res.body.toString('utf8')) || '';
            expect(typeof body).toBe('string');
            expect(body).toContain('<svg');
        }
    });

    test('returns PNG when requested', async () => {
        const res = await request(app).get('/api/qr?format=png&text=hello');
        expect([200, 429]).toContain(res.status);
        if (res.status === 200) {
            expect(res.headers['content-type']).toMatch(/image\/png/);
            expect(res.body).toBeInstanceOf(Buffer);
        }
    });

    test('validates required text', async () => {
        const res = await request(app).get('/api/qr');
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'text_required');
    });

    test('limits overly long text', async () => {
        const long = 'a'.repeat(4096);
        const res = await request(app).get('/api/qr?text=' + long);
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'text_too_long');
    });
});
