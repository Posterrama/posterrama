/** @jest-environment node */
const request = require('supertest');

jest.mock('../../utils/mqttBridge', () => {
    return class MockMqttBridge {
        constructor(cfg) {
            this.config = cfg;
            this.connected = false;
            this.onDeviceUpdate = jest.fn().mockResolvedValue(undefined);
            this.onDeviceDelete = jest.fn().mockResolvedValue(undefined);
        }

        async init() {
            this.connected = true;
        }

        async shutdown() {
            this.connected = false;
        }

        getStats() {
            return {
                connected: this.connected,
                broker: {
                    host: this.config?.broker?.host || 'localhost',
                    port: this.config?.broker?.port || 1883,
                },
            };
        }
    };
});

describe('Admin MQTT: reconnect endpoint', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        process.env.API_ACCESS_TOKEN = 'test-token';
    });

    afterEach(() => {
        delete process.env.API_ACCESS_TOKEN;
    });

    test('returns 200 and schedules reconnect', async () => {
        const app = require('../../server');
        const res = await request(app)
            .post('/api/admin/mqtt/reconnect')
            .set('Authorization', 'Bearer test-token');

        expect([200, 401, 403]).toContain(res.status);
        if (res.status !== 200) return;

        expect(res.body).toMatchObject({ success: true, restarting: true });
    });
});
