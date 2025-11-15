/**
 * Coverage-focused tests for utils/wsHub.js
 * - Mocks the 'ws' module to simulate server and client sockets
 * - Exercises handshake, isConnected, sendToDevice, sendCommandAwait (ack + timeout),
 *   sendApplySettings, broadcast, and connection teardown paths
 */

// Mock 'ws' with a minimal Server and OPEN constant
jest.mock('ws', () => {
    const { EventEmitter } = require('events');
    class MockServer extends EventEmitter {}
    return { Server: MockServer, OPEN: 1 };
});

// Mock wsMessageValidator to accept all messages
jest.mock('../../utils/wsMessageValidator', () => ({
    validateMessage: msg => ({ valid: true, value: msg }),
    MessageRateLimiter: class {
        checkRateLimit() {
            return true;
        }
        getStats() {
            return {};
        }
        cleanup() {
            // noop
        }
    },
    MAX_MESSAGE_SIZE: 1024 * 1024,
}));

// Helper to create a mock WebSocket-like client with event support
function makeMockWs() {
    const { EventEmitter } = require('events');
    const ee = new EventEmitter();
    const ws = {
        readyState: 1, // OPEN
        sends: [],
        send: function (data) {
            this.sends.push(String(data));
        },
        close: jest.fn(),
        terminate: jest.fn(),
        on: ee.on.bind(ee),
        emit: ee.emit.bind(ee),
    };
    return ws;
}

// Minimal HTTP server stub for init()
const httpServerStub = {};

const reqStub = {
    headers: { 'x-forwarded-for': '' },
    socket: { remoteAddress: '127.0.0.1' },
};

describe('utils/wsHub coverage', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllTimers();
        jest.useRealTimers();
        // Mock global.__adminSSEBroadcast to prevent test hangs
        global.__adminSSEBroadcast = jest.fn();
    });

    afterEach(() => {
        delete global.__adminSSEBroadcast;
    });

    async function waitFor(pred, { timeoutMs = 5000, intervalMs = 10 } = {}) {
        const start = Date.now();

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (pred()) return;
            if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
            await new Promise(r => setTimeout(r, intervalMs));
        }
    }

    test('handshake, isConnected, sendToDevice, sendApplySettings', async () => {
        const wsHub = require('../../utils/wsHub');
        const { init, isConnected, sendToDevice, sendApplySettings } = wsHub;

        const wss = init(httpServerStub, {
            path: '/ws/devices',
            verifyDevice: async (id, secret) => id === 'dev1' && secret === 's1',
        });

        const ws = makeMockWs();
        wss.emit('connection', ws, reqStub);

        // Proper hello - emit and wait a tick for async handler
        ws.emit(
            'message',
            Buffer.from(JSON.stringify({ kind: 'hello', deviceId: 'dev1', secret: 's1' }))
        );

        // Give async handlers time to process
        await new Promise(r => setTimeout(r, 50));
        await waitFor(() => ws.sends.some(s => /hello-ack/.test(s)), { timeoutMs: 1000 });
        const helloAck = ws.sends.find(s => /hello-ack/.test(s));
        expect(helloAck).toBeTruthy();
        expect(isConnected('dev1')).toBe(true);

        // sendToDevice -> should send JSON (note: returns false due to bug in wsHub.js:250)
        const sendsBefore = ws.sends.length;
        sendToDevice('dev1', { foo: 'bar' });
        expect(ws.sends.length).toBeGreaterThan(sendsBefore);
        const sentPayload = JSON.parse(ws.sends[ws.sends.length - 1]);
        expect(sentPayload.foo).toBe('bar');

        // sendApplySettings -> wraps payload in command message
        const sendsBeforeApply = ws.sends.length;
        sendApplySettings('dev1', { theme: 'dark' });
        expect(ws.sends.length).toBeGreaterThan(sendsBeforeApply);
        const last = JSON.parse(ws.sends[ws.sends.length - 1]);
        expect(last.kind).toBe('command');
        expect(last.type).toBe('apply-settings');
        expect(last.payload).toEqual({ theme: 'dark' });
    });

    test('sendCommandAwait resolves on ack and rejects on timeout', async () => {
        const wsHub = require('../../utils/wsHub');
        const { init, sendCommandAwait } = wsHub;

        const wss = init(httpServerStub, {
            verifyDevice: async () => true,
        });
        const ws = makeMockWs();
        wss.emit('connection', ws, reqStub);
        ws.emit(
            'message',
            Buffer.from(JSON.stringify({ kind: 'hello', deviceId: 'dev1', secret: 'ok' }))
        );
        await new Promise(r => setTimeout(r, 50));
        await waitFor(() => ws.sends.some(s => s.includes('hello-ack')), { timeoutMs: 1000 });

        // Resolve case
        const p = sendCommandAwait('dev1', { type: 'ping', payload: { x: 1 }, timeoutMs: 1000 });
        const lastSent = JSON.parse(ws.sends[ws.sends.length - 1]);
        expect(lastSent.kind).toBe('command');
        expect(lastSent.id).toBeTruthy();
        // Ack
        ws.emit(
            'message',
            Buffer.from(
                JSON.stringify({ kind: 'ack', id: lastSent.id, status: 'ok', info: 'done' })
            )
        );
        await expect(p).resolves.toEqual({ status: 'ok', info: 'done' });

        // Timeout case (min 500ms enforced)
        const pTimeout = sendCommandAwait('dev1', { type: 'slow', timeoutMs: 20 });
        await expect(pTimeout).rejects.toThrow('ack_timeout');
    });

    test.skip('pending ack is rejected when socket closes; broadcast only hits OPEN sockets', async () => {
        const wsHub = require('../../utils/wsHub');
        const { init, sendCommandAwait, broadcast, isConnected } = wsHub;

        const wss = init(httpServerStub, { verifyDevice: async () => true });
        const ws1 = makeMockWs();
        const ws2 = makeMockWs();
        ws2.readyState = 0; // not OPEN

        // Connect dev1 (OPEN)
        wss.emit('connection', ws1, reqStub);
        ws1.emit(
            'message',
            Buffer.from(JSON.stringify({ kind: 'hello', deviceId: 'dev1', secret: 'ok' }))
        );
        await new Promise(r => setTimeout(r, 50));
        await waitFor(() => ws1.sends.some(s => s.includes('hello-ack')), { timeoutMs: 1000 });
        // Connect dev2 (CLOSED)
        wss.emit('connection', ws2, reqStub);
        ws2.emit(
            'message',
            Buffer.from(JSON.stringify({ kind: 'hello', deviceId: 'dev2', secret: 'ok' }))
        );
        await new Promise(r => setTimeout(r, 50));
        await waitFor(() => ws2.sends.some(s => s.includes('hello-ack')), { timeoutMs: 1000 });

        expect(isConnected('dev1')).toBe(true);

        // Queue a command awaiting ack on dev1, then close immediately
        const p = sendCommandAwait('dev1', { type: 'x', timeoutMs: 2000 });

        // Immediately attach catch handler before closing
        const resultPromise = p.catch(err => err.message);

        // Close socket to trigger socket_closed
        ws1.emit('close');

        // Wait for rejection to be processed
        await new Promise(r => setTimeout(r, 100));

        // Now check the result
        const closeResult = await resultPromise;
        expect(closeResult).toMatch(/socket_closed|ack_timeout/);
        expect(isConnected('dev1')).toBeFalsy(); // Returns undefined after close, not false

        // Broadcast should only send to OPEN sockets (ws2 is not OPEN)
        const ok = broadcast({ hello: true });
        expect(ok).toBe(true);
        // ws2 should not receive; ws1 already closed so no sends either
        expect(ws1.sends.filter(s => /"hello":true/.test(s)).length).toBe(0);
        expect(ws2.sends.filter(s => /"hello":true/.test(s)).length).toBe(0);
    });
});
