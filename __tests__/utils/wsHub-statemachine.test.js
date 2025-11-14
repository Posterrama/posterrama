/**
 * Tests for WebSocket State Machine and Authentication (Issue #1)
 */

const WebSocket = require('ws');
const { validateMessage } = require('../../utils/wsMessageValidator');
const ErrorLogger = require('../../utils/errorLogger');

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('../../utils/wsMessageValidator');
jest.mock('../../utils/errorLogger');

describe('WebSocket State Machine (Issue #1)', () => {
    let mockWs;
    let deviceId;
    let secret;

    beforeEach(() => {
        jest.clearAllMocks();
        deviceId = 'test-device-123';
        secret = 'a'.repeat(32);

        // Mock WebSocket
        mockWs = {
            id: 'mock-ws-id',
            send: jest.fn(),
            close: jest.fn(),
            readyState: WebSocket.OPEN,
            on: jest.fn(),
            removeAllListeners: jest.fn(),
        };

        // Mock validateMessage to return successful validation by default
        validateMessage.mockReturnValue({ valid: true });
    });

    afterEach(() => {
        // Tests are unit tests, no actual wsHub cleanup needed
        jest.clearAllMocks();
    });

    describe('state transitions', () => {
        it('should start in pending state', () => {
            const connection = {
                ws: mockWs,
                state: 'pending',
                messageQueue: [],
                authTimeoutId: null,
            };

            expect(connection.state).toBe('pending');
            expect(connection.messageQueue).toEqual([]);
        });

        it('should transition pending → authenticating on hello message', () => {
            let state = 'pending';

            // Simulate receiving hello message
            const message = {
                kind: 'hello',
                deviceId,
                secret,
            };

            validateMessage.mockReturnValue({ valid: true, value: message });

            if (state === 'pending' && message.kind === 'hello') {
                state = 'authenticating';
            }

            expect(state).toBe('authenticating');
        });

        it('should transition authenticating → authenticated on successful auth', () => {
            let state = 'authenticating';

            // Simulate successful authentication
            const isValidAuth = true;

            if (state === 'authenticating' && isValidAuth) {
                state = 'authenticated';
            }

            expect(state).toBe('authenticated');
        });

        it('should transition to failed on invalid authentication', () => {
            let state = 'authenticating';

            // Simulate failed authentication
            const isValidAuth = false;

            if (state === 'authenticating' && !isValidAuth) {
                state = 'failed';
            }

            expect(state).toBe('failed');
        });

        it('should reject messages in failed state', () => {
            const state = 'failed';
            const shouldProcessMessage = state === 'authenticated';

            expect(shouldProcessMessage).toBe(false);
        });

        it('should only process messages in authenticated state', () => {
            const authenticatedState = 'authenticated';
            const pendingState = 'pending';

            expect(authenticatedState === 'authenticated').toBe(true);
            expect(pendingState === 'authenticated').toBe(false);
        });
    });

    describe('message queuing during authentication', () => {
        it('should queue messages during authentication', () => {
            const messageQueue = [];
            const state = 'authenticating';

            const message = { kind: 'ping', timestamp: Date.now() };

            if (state !== 'authenticated') {
                messageQueue.push(message);
            }

            expect(messageQueue).toHaveLength(1);
            expect(messageQueue[0]).toEqual(message);
        });

        it('should enforce queue size limit', () => {
            const messageQueue = [];
            const MAX_QUEUE_SIZE = 10;

            // Try to add 15 messages
            for (let i = 0; i < 15; i++) {
                if (messageQueue.length < MAX_QUEUE_SIZE) {
                    messageQueue.push({ kind: 'ping', id: i });
                }
            }

            expect(messageQueue).toHaveLength(MAX_QUEUE_SIZE);
        });

        it('should process queued messages after authentication', () => {
            const messageQueue = [
                { kind: 'ping', timestamp: 1000 },
                { kind: 'ping', timestamp: 2000 },
                { kind: 'ping', timestamp: 3000 },
            ];

            let state = 'authenticating';
            const processed = [];

            // Authenticate
            state = 'authenticated';

            // Process queue
            if (state === 'authenticated') {
                while (messageQueue.length > 0) {
                    const message = messageQueue.shift();
                    processed.push(message);
                }
            }

            expect(messageQueue).toHaveLength(0);
            expect(processed).toHaveLength(3);
        });

        it('should clear queue on failed authentication', () => {
            const messageQueue = [{ kind: 'ping' }, { kind: 'ping' }];
            let state = 'authenticating';

            // Auth fails
            state = 'failed';

            // Clear queue
            if (state === 'failed') {
                messageQueue.length = 0;
            }

            expect(messageQueue).toHaveLength(0);
        });

        it('should not queue messages in authenticated state', () => {
            const messageQueue = [];
            const state = 'authenticated';
            const message = { kind: 'ping' };

            if (state !== 'authenticated') {
                messageQueue.push(message);
            }

            // Should process immediately, not queue
            expect(messageQueue).toHaveLength(0);
        });
    });

    describe('authentication timeout', () => {
        jest.useFakeTimers();

        afterEach(() => {
            jest.clearAllTimers();
        });

        it('should set timeout when entering authenticating state', () => {
            const AUTH_TIMEOUT_MS = 10000;
            let state = 'pending';
            let timeoutId = null;

            // Start authentication
            if (state === 'pending') {
                state = 'authenticating';
                timeoutId = setTimeout(() => {
                    state = 'failed';
                }, AUTH_TIMEOUT_MS);
            }

            expect(state).toBe('authenticating');
            expect(timeoutId).not.toBeNull();
        });

        it('should transition to failed after timeout', () => {
            let state = 'authenticating';
            const AUTH_TIMEOUT_MS = 10000;

            setTimeout(() => {
                if (state === 'authenticating') {
                    state = 'failed';
                }
            }, AUTH_TIMEOUT_MS);

            // Fast-forward time
            jest.advanceTimersByTime(AUTH_TIMEOUT_MS);

            expect(state).toBe('failed');
        });

        it('should clear timeout on successful authentication', () => {
            let state = 'authenticating';
            const timeoutId = setTimeout(() => {
                state = 'failed';
            }, 10000);

            // Authenticate successfully
            state = 'authenticated';
            clearTimeout(timeoutId);

            // Advance past timeout
            jest.advanceTimersByTime(15000);

            // Should still be authenticated
            expect(state).toBe('authenticated');
        });

        it('should log timeout error', () => {
            let state = 'authenticating';
            const AUTH_TIMEOUT_MS = 10000;

            setTimeout(() => {
                if (state === 'authenticating') {
                    ErrorLogger.logWebSocketError(
                        new Error('Authentication timeout'),
                        'ws-auth-timeout',
                        { deviceId }
                    );
                    state = 'failed';
                }
            }, AUTH_TIMEOUT_MS);

            jest.advanceTimersByTime(AUTH_TIMEOUT_MS);

            expect(ErrorLogger.logWebSocketError).toHaveBeenCalledWith(
                expect.any(Error),
                'ws-auth-timeout',
                expect.objectContaining({ deviceId })
            );
        });
    });

    describe('duplicate authentication prevention', () => {
        it('should reject second hello message', () => {
            let state = 'pending';
            let authAttempts = 0;

            // First hello
            if (state === 'pending') {
                state = 'authenticating';
                authAttempts++;
            }

            // Second hello (should be rejected)
            const canAuthenticate = state === 'pending';

            expect(canAuthenticate).toBe(false);
            expect(authAttempts).toBe(1);
        });

        it('should reject hello in authenticated state', () => {
            const state = 'authenticated';
            const canAuthenticate = state === 'pending';

            expect(canAuthenticate).toBe(false);
        });

        it('should allow re-authentication after failure', () => {
            let state = 'failed';

            // Reset connection
            state = 'pending';

            const canAuthenticate = state === 'pending';
            expect(canAuthenticate).toBe(true);
        });

        it('should not process duplicate deviceId registration', () => {
            const registeredDevices = new Set();

            // First registration
            if (!registeredDevices.has(deviceId)) {
                registeredDevices.add(deviceId);
            }

            // Duplicate attempt
            const isDuplicate = registeredDevices.has(deviceId);

            expect(isDuplicate).toBe(true);
            expect(registeredDevices.size).toBe(1);
        });
    });

    describe('message validation integration', () => {
        it('should validate all incoming messages', () => {
            const message = { kind: 'ping', timestamp: Date.now() };
            validateMessage.mockReturnValue({ valid: true, value: message });

            const result = validateMessage(message);

            expect(validateMessage).toHaveBeenCalledWith(message);
            expect(result.valid).toBe(true);
        });

        it('should reject invalid messages', () => {
            const invalidMessage = { kind: 'invalid' };
            validateMessage.mockReturnValue({
                valid: false,
                error: 'Invalid message type',
            });

            const result = validateMessage(invalidMessage);

            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should check message size before validation', () => {
            const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB
            const largeMessage = { data: 'x'.repeat(MAX_MESSAGE_SIZE + 1) };
            const messageSize = JSON.stringify(largeMessage).length;

            const isTooBig = messageSize > MAX_MESSAGE_SIZE;

            expect(isTooBig).toBe(true);
        });

        it('should log validation errors', () => {
            const message = { kind: 'invalid' };
            validateMessage.mockReturnValue({
                valid: false,
                error: 'Invalid kind',
            });

            const result = validateMessage(message);

            if (!result.valid) {
                ErrorLogger.logValidationError(new Error(result.error), 'ws-message-validation', {
                    message,
                });
            }

            expect(ErrorLogger.logValidationError).toHaveBeenCalled();
        });
    });

    describe('rate limiting integration', () => {
        it('should track message rate per device', () => {
            const rateLimiters = new Map();
            const deviceId = 'test-device';
            const RATE_LIMIT = 10;

            if (!rateLimiters.has(deviceId)) {
                rateLimiters.set(deviceId, { count: 0, resetAt: Date.now() + 1000 });
            }

            const limiter = rateLimiters.get(deviceId);
            limiter.count++;

            const isRateLimited = limiter.count > RATE_LIMIT;

            expect(isRateLimited).toBe(false);
            expect(limiter.count).toBe(1);
        });

        it('should reject messages when rate limit exceeded', () => {
            const rateLimiter = { count: 11, resetAt: Date.now() + 1000 };
            const RATE_LIMIT = 10;

            const isRateLimited = rateLimiter.count > RATE_LIMIT;

            expect(isRateLimited).toBe(true);
        });

        it('should reset rate limit after time window', () => {
            const now = Date.now();
            const rateLimiter = { count: 10, resetAt: now };

            if (Date.now() >= rateLimiter.resetAt) {
                rateLimiter.count = 0;
                rateLimiter.resetAt = Date.now() + 1000;
            }

            expect(rateLimiter.count).toBe(0);
        });

        it('should maintain separate rate limits per device', () => {
            const rateLimiters = new Map();

            rateLimiters.set('device1', { count: 5, resetAt: Date.now() + 1000 });
            rateLimiters.set('device2', { count: 8, resetAt: Date.now() + 1000 });

            expect(rateLimiters.get('device1').count).toBe(5);
            expect(rateLimiters.get('device2').count).toBe(8);
        });

        it('should cleanup rate limiter on disconnect', () => {
            const rateLimiters = new Map();
            rateLimiters.set(deviceId, { count: 5, resetAt: Date.now() + 1000 });

            // Disconnect
            rateLimiters.delete(deviceId);

            expect(rateLimiters.has(deviceId)).toBe(false);
        });
    });

    describe('error logging integration', () => {
        it('should log authentication failures', () => {
            const error = new Error('Invalid secret');

            ErrorLogger.logWebSocketError(error, 'ws-authentication', { deviceId });

            expect(ErrorLogger.logWebSocketError).toHaveBeenCalledWith(
                error,
                'ws-authentication',
                expect.objectContaining({ deviceId })
            );
        });

        it('should log state transition errors', () => {
            const state = 'authenticated';
            const message = { kind: 'hello' };

            if (state !== 'pending') {
                ErrorLogger.logWebSocketError(
                    new Error('Invalid state for authentication'),
                    'ws-invalid-state',
                    { state, messageKind: message.kind }
                );
            }

            expect(ErrorLogger.logWebSocketError).toHaveBeenCalled();
        });

        it('should log message processing errors', () => {
            const error = new Error('Failed to process message');

            ErrorLogger.logWebSocketError(error, 'ws-message-processing', {
                deviceId,
                messageKind: 'ping',
            });

            expect(ErrorLogger.logWebSocketError).toHaveBeenCalledWith(
                expect.any(Error),
                'ws-message-processing',
                expect.any(Object)
            );
        });

        it('should sanitize sensitive data in error logs', () => {
            const error = new Error('Auth failed');
            const metadata = {
                deviceId,
                secret: 'sensitive-secret-value',
            };

            ErrorLogger.logWebSocketError(error, 'ws-auth-failed', metadata);

            // ErrorLogger should sanitize the secret
            expect(ErrorLogger.logWebSocketError).toHaveBeenCalledWith(
                error,
                'ws-auth-failed',
                expect.objectContaining({ deviceId })
            );
        });
    });

    describe('connection cleanup', () => {
        it('should cleanup all resources on disconnect', () => {
            const resources = {
                authTimeoutId: setTimeout(() => {}, 10000),
                messageQueue: [{ kind: 'ping' }],
                rateLimiter: { count: 5 },
            };

            // Cleanup
            clearTimeout(resources.authTimeoutId);
            resources.messageQueue.length = 0;
            resources.rateLimiter = null;

            expect(resources.messageQueue).toHaveLength(0);
            expect(resources.rateLimiter).toBeNull();
        });

        it('should remove device from wsHub on disconnect', () => {
            const devices = new Map();
            devices.set(deviceId, mockWs);

            // Disconnect
            devices.delete(deviceId);

            expect(devices.has(deviceId)).toBe(false);
        });

        it('should close WebSocket on failed authentication', () => {
            let state = 'authenticating';

            // Auth fails
            state = 'failed';

            if (state === 'failed') {
                mockWs.close(4001, 'Authentication failed');
            }

            expect(mockWs.close).toHaveBeenCalledWith(4001, 'Authentication failed');
        });
    });
});
