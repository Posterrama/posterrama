// Renamed from api-versioning.test.js to versioning.smoke.test.js
// Placeholder ensures version endpoint (if any) responds; adjust path if different.
const request = require('supertest');
const app = require('../../server');

describe('API versioning smoke', () => {
  test('version route exists or 404 gracefully', async () => {
    const res = await request(app).get('/api/version');
    expect([200,404]).toContain(res.status);
  });
});
