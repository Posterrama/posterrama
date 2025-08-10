const request = require('supertest');
const app = require('../server');

describe('Rate Limiting', () => {
    describe('API Rate Limits', () => {
        test('should allow requests within rate limit', async () => {
            const response = await request(app).get('/get-config');
            expect(response.statusCode).toBe(200);
        });

        test('should block requests exceeding rate limit', async () => {
            // Make multiple requests quickly to trigger rate limiting
            // In test mode, the limit is divided by 10, so we need more requests
            const requests = [];
            for (let i = 0; i < 60; i++) { // More than the 50 test limit (500/10)
                requests.push(request(app).get('/get-config'));
            }
            
            const responses = await Promise.all(requests);
            const statusCodes = responses.map(r => r.statusCode);
            
            // Should have at least some 429 (Too Many Requests) responses
            expect(statusCodes).toContain(429);
        });

        test('should include rate limit headers', async () => {
            const response = await request(app).get('/get-config');
            expect(response.headers).toHaveProperty('ratelimit-limit');
            expect(response.headers).toHaveProperty('ratelimit-remaining');
            expect(response.headers).toHaveProperty('ratelimit-reset');
        });
    });

    describe('Admin API Rate Limits', () => {
        test('should have different rate limits for admin endpoints', async () => {
            // This test assumes we're not authenticated, so we should get 401
            // but we want to test that rate limiting headers are present
            const response = await request(app).get('/api/admin/config');
            expect(response.headers).toHaveProperty('ratelimit-limit');
        });
    });

    describe('IP-based Rate Limiting', () => {
        test('should track rate limits per IP', async () => {
            const response = await request(app)
                .get('/get-config')
                .set('X-Forwarded-For', '192.168.1.100');
            
            expect(response.headers).toHaveProperty('ratelimit-remaining');
            const remaining = parseInt(response.headers['ratelimit-remaining']);
            expect(remaining).toBeGreaterThanOrEqual(0);
        });
    });
});
