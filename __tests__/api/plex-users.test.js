const request = require('supertest');

describe('GET /api/plex/users', () => {
    beforeEach(() => {
        jest.resetModules();
        // Ensure test-mode auth bypass is active
        process.env.NODE_ENV = 'test';
    });

    test('returns all Plex accounts from PMS /accounts', async () => {
        jest.doMock('../../config.json', () => ({
            mediaServers: [
                {
                    enabled: true,
                    type: 'plex',
                    name: 'Test Plex',
                    hostname: '127.0.0.1',
                    port: 32400,
                    token: 'test-token',
                },
            ],
        }));

        const fakePlexClient = {
            query: jest.fn(async path => {
                if (path === '/accounts') {
                    return {
                        MediaContainer: {
                            Account: [
                                { id: 1, name: 'Alice' },
                                { id: 2, name: 'Bob' },
                            ],
                        },
                    };
                }
                if (path.startsWith('/status/sessions')) {
                    return { MediaContainer: { Metadata: [] } };
                }
                return { MediaContainer: {} };
            }),
        };

        jest.doMock('../../lib/plex-helpers', () => {
            const actual = jest.requireActual('../../lib/plex-helpers');
            return {
                ...actual,
                getPlexClient: jest.fn(async () => fakePlexClient),
            };
        });

        const app = require('../../server');

        const res = await request(app)
            .get('/api/plex/users')
            .set('Authorization', 'Bearer test')
            .expect(200);

        expect(res.body).toMatchObject({
            success: true,
            users: [
                { id: 1, username: 'Alice', title: 'Alice' },
                { id: 2, username: 'Bob', title: 'Bob' },
            ],
        });

        expect(fakePlexClient.query).toHaveBeenCalledWith('/accounts');
    });

    test('falls back to session-derived users when /accounts fails', async () => {
        jest.doMock('../../config.json', () => ({
            mediaServers: [
                {
                    enabled: true,
                    type: 'plex',
                    name: 'Test Plex',
                    hostname: '127.0.0.1',
                    port: 32400,
                    token: 'test-token',
                },
            ],
        }));

        const fakePlexClient = {
            query: jest.fn(async path => {
                if (path === '/accounts') {
                    throw new Error('Forbidden');
                }
                if (path.startsWith('/status/sessions')) {
                    return { MediaContainer: { Metadata: [] } };
                }
                return { MediaContainer: {} };
            }),
        };

        jest.doMock('../../lib/plex-helpers', () => {
            const actual = jest.requireActual('../../lib/plex-helpers');
            return {
                ...actual,
                getPlexClient: jest.fn(async () => fakePlexClient),
            };
        });

        const app = require('../../server');

        // Override poller with deterministic session data
        global.__posterramaSessionsPoller = {
            getSessions: () => ({
                sessions: [
                    { User: { id: 99, title: 'Carol', thumb: '/u/carol' } },
                    { User: { id: 99, title: 'Carol', thumb: '/u/carol' } },
                ],
            }),
        };

        const res = await request(app)
            .get('/api/plex/users')
            .set('Authorization', 'Bearer test')
            .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.users).toEqual([
            { id: 99, username: 'Carol', title: 'Carol', email: null, thumb: '/u/carol' },
        ]);
    });
});
