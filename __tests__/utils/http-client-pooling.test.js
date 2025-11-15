/**
 * Tests for HTTP client connection pooling configuration
 * Verifies that all HTTP clients are configured with connection pooling and keep-alive
 * @jest-environment node
 */

const { JellyfinHttpClient } = require('../../utils/jellyfin-http-client');
const RommHttpClient = require('../../utils/romm-http-client');

describe('HTTP Client Connection Pooling', () => {
    describe('JellyfinHttpClient', () => {
        it('should configure HTTP agent with connection pooling', () => {
            const client = new JellyfinHttpClient({
                hostname: 'test.jellyfin.com',
                port: 8096,
                apiKey: 'test-key',
            });

            expect(client.http.defaults.httpAgent).toBeDefined();
            expect(client.http.defaults.httpAgent.keepAlive).toBe(true);
            expect(client.http.defaults.httpAgent.keepAliveMsecs).toBe(30000);
            expect(client.http.defaults.httpAgent.maxSockets).toBe(10);
            expect(client.http.defaults.httpAgent.maxFreeSockets).toBe(5);
        });

        it('should configure HTTPS agent with connection pooling', () => {
            const client = new JellyfinHttpClient({
                hostname: 'test.jellyfin.com',
                port: 8920,
                apiKey: 'test-key',
            });

            expect(client.http.defaults.httpsAgent).toBeDefined();
            expect(client.http.defaults.httpsAgent.keepAlive).toBe(true);
            expect(client.http.defaults.httpsAgent.keepAliveMsecs).toBe(30000);
            expect(client.http.defaults.httpsAgent.maxSockets).toBe(10);
            expect(client.http.defaults.httpsAgent.maxFreeSockets).toBe(5);
        });

        it('should configure HTTPS agent with insecure mode when requested', () => {
            const client = new JellyfinHttpClient({
                hostname: 'test.jellyfin.com',
                port: 8920,
                apiKey: 'test-key',
                insecureHttps: true,
            });

            expect(client.http.defaults.httpsAgent).toBeDefined();
            expect(client.http.defaults.httpsAgent.options.rejectUnauthorized).toBe(false);
        });

        it('should respect timeout configuration in agent', () => {
            const client = new JellyfinHttpClient({
                hostname: 'test.jellyfin.com',
                port: 8096,
                apiKey: 'test-key',
                timeout: 15000,
            });

            expect(client.http.defaults.httpAgent.options.timeout).toBe(15000);
            expect(client.http.defaults.httpsAgent.options.timeout).toBe(15000);
        });
    });

    describe('RommHttpClient', () => {
        it('should configure HTTP agent with connection pooling', () => {
            const client = new RommHttpClient({
                hostname: 'test.romm.com',
                port: 8080,
                username: 'test',
                password: 'pass',
            });

            expect(client.httpAgent).toBeDefined();
            expect(client.httpAgent.keepAlive).toBe(true);
            expect(client.httpAgent.keepAliveMsecs).toBe(30000);
            expect(client.httpAgent.maxSockets).toBe(10);
            expect(client.httpAgent.maxFreeSockets).toBe(5);
        });

        it('should configure HTTPS agent with connection pooling', () => {
            const client = new RommHttpClient({
                hostname: 'test.romm.com',
                port: 443,
                username: 'test',
                password: 'pass',
            });

            expect(client.httpsAgent).toBeDefined();
            expect(client.httpsAgent.keepAlive).toBe(true);
            expect(client.httpsAgent.keepAliveMsecs).toBe(30000);
            expect(client.httpsAgent.maxSockets).toBe(10);
            expect(client.httpsAgent.maxFreeSockets).toBe(5);
        });

        it('should configure HTTPS agent with insecure mode when requested', () => {
            const client = new RommHttpClient({
                hostname: 'test.romm.com',
                port: 443,
                username: 'test',
                password: 'pass',
                insecureHttps: true,
            });

            expect(client.httpsAgent).toBeDefined();
            expect(client.httpsAgent.options.rejectUnauthorized).toBe(false);
        });

        it('should respect timeout configuration in agents', () => {
            const client = new RommHttpClient({
                hostname: 'test.romm.com',
                port: 8080,
                username: 'test',
                password: 'pass',
                timeout: 20000,
            });

            expect(client.httpAgent.options.timeout).toBe(20000);
            expect(client.httpsAgent.options.timeout).toBe(20000);
        });
    });

    describe('Connection Pooling Benefits', () => {
        it('should reuse connections for multiple requests (Jellyfin)', async () => {
            const client = new JellyfinHttpClient({
                hostname: 'test.jellyfin.com',
                port: 8096,
                apiKey: 'test-key',
            });

            // Verify agent is shared across requests
            const agent1 = client.http.defaults.httpAgent;
            const agent2 = client.http.defaults.httpAgent;
            expect(agent1).toBe(agent2);
        });

        it('should reuse connections for multiple requests (ROMM)', () => {
            const client = new RommHttpClient({
                hostname: 'test.romm.com',
                port: 8080,
                username: 'test',
                password: 'pass',
            });

            // Verify agents are stable instances
            const httpAgent1 = client.httpAgent;
            const httpAgent2 = client.httpAgent;
            const httpsAgent1 = client.httpsAgent;
            const httpsAgent2 = client.httpsAgent;

            expect(httpAgent1).toBe(httpAgent2);
            expect(httpsAgent1).toBe(httpsAgent2);
        });
    });

    describe('Connection Pooling Configuration', () => {
        it('should have reasonable default pooling settings', () => {
            const client = new JellyfinHttpClient({
                hostname: 'test.jellyfin.com',
                port: 8096,
                apiKey: 'test-key',
            });

            const agent = client.http.defaults.httpAgent;

            // Verify settings are optimized for external API calls
            expect(agent.keepAlive).toBe(true); // Reuse connections
            expect(agent.keepAliveMsecs).toBeGreaterThanOrEqual(30000); // Keep connections alive
            expect(agent.maxSockets).toBeGreaterThanOrEqual(5); // Allow concurrent requests
            expect(agent.maxFreeSockets).toBeGreaterThan(0); // Keep some connections ready
        });

        it('should configure timeout to prevent hung connections', () => {
            const client = new JellyfinHttpClient({
                hostname: 'test.jellyfin.com',
                port: 8096,
                apiKey: 'test-key',
                timeout: 10000,
            });

            const agent = client.http.defaults.httpAgent;
            expect(agent.options.timeout).toBe(10000);
        });
    });
});
