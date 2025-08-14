// Renamed from api.test.js to root.smoke.test.js
const request = require('supertest');
const app = require('../../server');

describe('API root smoke', () => {
  test('root path returns html or redirect', async () => {
    const res = await request(app).get('/');
    expect([200,302]).toContain(res.status);
  });
});
