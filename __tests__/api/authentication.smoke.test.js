// Renamed from api-authentication.test.js to authentication.smoke.test.js
const request = require('supertest');
const app = require('../../server');

describe('API authentication smoke', () => {
  test('login failure returns error', async () => {
    // The application exposes the login endpoint at /admin/login (not /api/admin/login)
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ username: 'invalid', password: 'invalid' });
    // Expect one of the auth failure status codes (rate limiting could also appear) 
    // or a redirect to error page (302)
    expect([302,400,401,403,429]).toContain(res.status);
  });
});
