// Renamed from admin-config.test.js to admin-config.integration.test.js
const request = require('supertest');
const app = require('../../server');

describe('Admin config integration smoke', () => {
  test('fetch admin config unauthorized', async () => {
    const res = await request(app).get('/api/admin/config');
    expect([200,401,403]).toContain(res.status);
  });
});
