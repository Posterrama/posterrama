/**
 * Coverage for wsHub sendCommandAwait timeout path.
 */
const http = require('http');
const wsHub = require('../../utils/wsHub');

describe('wsHub sendCommandAwait timeout', () => {
    test('rejects with ack_timeout when device never connects', async () => {
        const server = http.createServer((_, res) => res.end('ok'));
        await new Promise(resolve => server.listen(0, resolve));
        wsHub.init(server, { verifyDevice: () => true });
        await expect(
            wsHub.sendCommandAwait('missing-device', { type: 'ping', timeoutMs: 600 })
        ).rejects.toThrow('not_connected');
        server.close();
    });
});
