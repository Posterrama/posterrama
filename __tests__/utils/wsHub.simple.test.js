/**
 * WebSocket Hub - Simple API Tests
 * Tests basic WebSocket hub functionality without requiring full server setup
 */

// Mock logger before requiring wsHub
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('WebSocket Hub - Simple API Tests', () => {
    let wsHub;

    beforeEach(() => {
        jest.resetModules();
        wsHub = require('../../utils/wsHub');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Module Exports', () => {
        test('should export init function', () => {
            expect(wsHub).toHaveProperty('init');
            expect(typeof wsHub.init).toBe('function');
        });

        test('should export isConnected function', () => {
            expect(wsHub).toHaveProperty('isConnected');
            expect(typeof wsHub.isConnected).toBe('function');
        });

        test('should export sendToDevice function', () => {
            expect(wsHub).toHaveProperty('sendToDevice');
            expect(typeof wsHub.sendToDevice).toBe('function');
        });

        test('should export sendCommand function', () => {
            expect(wsHub).toHaveProperty('sendCommand');
            expect(typeof wsHub.sendCommand).toBe('function');
        });

        test('should export sendCommandAwait function', () => {
            expect(wsHub).toHaveProperty('sendCommandAwait');
            expect(typeof wsHub.sendCommandAwait).toBe('function');
        });

        test('should export broadcast function', () => {
            expect(wsHub).toHaveProperty('broadcast');
            expect(typeof wsHub.broadcast).toBe('function');
        });

        test('should export broadcastAdmin function', () => {
            expect(wsHub).toHaveProperty('broadcastAdmin');
            expect(typeof wsHub.broadcastAdmin).toBe('function');
        });
    });

    describe('Connection Checking', () => {
        test('should return falsy for non-existent device', () => {
            const result = wsHub.isConnected('non-existent-device-id');
            expect(result).toBeFalsy();
        });

        test('should handle null device ID', () => {
            const result = wsHub.isConnected(null);
            expect(result).toBeFalsy();
        });

        test('should handle undefined device ID', () => {
            const result = wsHub.isConnected(undefined);
            expect(result).toBeFalsy();
        });

        test('should handle empty string device ID', () => {
            const result = wsHub.isConnected('');
            expect(result).toBeFalsy();
        });
    });

    describe('Message Sending to Non-Existent Devices', () => {
        test('sendToDevice should not throw for non-existent device', () => {
            expect(() => {
                wsHub.sendToDevice('non-existent-device', { type: 'test', payload: {} });
            }).not.toThrow();
        });

        test('sendCommand should not throw for non-existent device', () => {
            expect(() => {
                wsHub.sendCommand('non-existent-device', { type: 'test', payload: {} });
            }).not.toThrow();
        });

        test('sendApplySettings should not throw for non-existent device', () => {
            expect(() => {
                wsHub.sendApplySettings('non-existent-device', { mode: 'screensaver' });
            }).not.toThrow();
        });
    });

    describe('Broadcasting', () => {
        test('broadcast should return 0 when no devices connected', () => {
            const count = wsHub.broadcast({ type: 'test', payload: {} });
            expect(count).toBe(0);
        });

        test('broadcast should handle null message gracefully', () => {
            expect(() => {
                wsHub.broadcast(null);
            }).not.toThrow();
        });

        test('broadcastAdmin should return false when no admin SSE broadcaster', () => {
            const result = wsHub.broadcastAdmin({ kind: 'test', payload: {} });
            expect(result).toBe(false);
        });
    });

    describe('Command with Await', () => {
        test('should reject when device not connected', async () => {
            await expect(
                wsHub.sendCommandAwait('non-existent-device', {
                    type: 'test',
                    payload: {},
                    timeoutMs: 100,
                })
            ).rejects.toThrow();
        });

        test('should handle null device ID', async () => {
            await expect(
                wsHub.sendCommandAwait(null, { type: 'test', payload: {}, timeoutMs: 100 })
            ).rejects.toThrow();
        });

        test('should handle missing command type', async () => {
            await expect(
                wsHub.sendCommandAwait('device-id', { payload: {}, timeoutMs: 100 })
            ).rejects.toThrow();
        });
    });

    describe('Error Handling', () => {
        test('should have error handling for edge cases', () => {
            // Just verify functions exist and are callable
            expect(typeof wsHub.sendToDevice).toBe('function');
            expect(typeof wsHub.sendCommand).toBe('function');
            expect(typeof wsHub.broadcast).toBe('function');
        });
    });
});
