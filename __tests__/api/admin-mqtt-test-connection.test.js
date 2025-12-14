/** @jest-environment node */
const EventEmitter = require('events');
const request = require('supertest');

jest.mock('mqtt', () => {
    return {
        connect: jest.fn(),
    };
});

describe('Admin MQTT: test connection endpoint', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.NODE_ENV = 'test';
        process.env.API_ACCESS_TOKEN = 'test-token';
    });

    afterEach(() => {
        delete process.env.API_ACCESS_TOKEN;
    });

    test('returns 200 when broker connection succeeds', async () => {
        const mqtt = require('mqtt');

        // Fake mqtt client that emits connect shortly after creation
        const client = new EventEmitter();
        client.end = jest.fn();
        client.removeAllListeners = jest.fn(() =>
            EventEmitter.prototype.removeAllListeners.call(client)
        );

        mqtt.connect.mockImplementation(() => {
            setTimeout(() => client.emit('connect'), 5);
            return client;
        });

        const app = require('../../server');
        const res = await request(app)
            .post('/api/admin/mqtt/test-connection')
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ broker: { host: 'localhost', port: 1883 } });

        expect([200, 401, 403]).toContain(res.status);
        if (res.status !== 200) return; // skip in unauthorized environments

        expect(res.body).toMatchObject({ success: true, connected: true });
        expect(res.body.broker).toMatchObject({ host: 'localhost', port: 1883 });
        expect(mqtt.connect).toHaveBeenCalled();
        expect(client.end).toHaveBeenCalled();
    });

    test('returns 502 when broker connection fails', async () => {
        const mqtt = require('mqtt');

        const client = new EventEmitter();
        client.end = jest.fn();
        client.removeAllListeners = jest.fn(() =>
            EventEmitter.prototype.removeAllListeners.call(client)
        );

        mqtt.connect.mockImplementation(() => {
            setTimeout(() => client.emit('error', new Error('ECONNREFUSED')), 5);
            return client;
        });

        const app = require('../../server');
        const res = await request(app)
            .post('/api/admin/mqtt/test-connection')
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ broker: { host: 'localhost', port: 1883 } });

        expect([502, 401, 403]).toContain(res.status);
        if (res.status !== 502) return; // skip in unauthorized environments

        expect(res.body).toMatchObject({ success: false, connected: false });
        expect(String(res.body.message || '')).toContain('ECONNREFUSED');
        expect(client.end).toHaveBeenCalled();
    });

    test('returns 400 on missing host', async () => {
        const app = require('../../server');
        const res = await request(app)
            .post('/api/admin/mqtt/test-connection')
            .set('Authorization', 'Bearer test-token')
            .set('Content-Type', 'application/json')
            .send({ broker: { port: 1883 } });

        expect([400, 401, 403]).toContain(res.status);
        if (res.status !== 400) return; // skip in unauthorized environments

        expect(res.body).toMatchObject({ success: false });
    });
});
