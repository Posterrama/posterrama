process.env.NODE_ENV = 'test';
process.env.DEVICE_MGMT_ENABLED = 'true';
process.env.API_ACCESS_TOKEN = 'test-token';

const request = require('supertest');
const app = require('../server');

(async () => {
    try {
        const reg = await request(app)
            .post('/api/devices/register')
            .set('Content-Type', 'application/json')
            .send({ installId: 'iid-debug', hardwareId: 'hw-debug' });
        console.log('Register status:', reg.status, reg.body);

        const id = reg.body.deviceId;
        const gen = await request(app)
            .post(`/api/devices/${encodeURIComponent(id)}/pairing-code`)
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ ttlMs: 120000 });
        console.log('Pairing status:', gen.status, gen.body, gen.headers);
    } catch (e) {
        console.error('Error during debug:', e);
    } finally {
        if (typeof app.cleanup === 'function') app.cleanup();
    }
})();
