const request = require('supertest');
// We importeren de app uit server.js, die we zojuist hebben geëxporteerd.
// Het pad is '../server' omdat dit testbestand in de __tests__ map staat.
const app = require('../server');

describe('API Endpoints', () => {
  // Test of de hoofdpagina correct laadt
  it('GET / - should return 200 OK for the homepage', async () => {
    const response = await request(app).get('/');
    expect(response.statusCode).toBe(200);
    // Controleer of de response HTML is
    expect(response.headers['content-type']).toMatch(/html/);
  });

  // Test if the admin page gives a redirect (because we're not logged in)
  it('GET /admin - should redirect to login page when not authenticated', async () => {
    const response = await request(app).get('/admin');
    expect(response.statusCode).toBe(302); // 302 is de statuscode voor een redirect
    expect(response.headers.location).toBe('/admin/setup');
  });

  it('GET /non-existent-page - should return 404 Not Found', async () => {
    const response = await request(app).get('/a-random-page-that-does-not-exist');
    expect(response.statusCode).toBe(404);
  });
});