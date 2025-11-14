/**
 * Tests for WebSocket Message Validator (Issue #5)
 */

const {
    validateMessage,
    MessageRateLimiter,
    MAX_MESSAGE_SIZE,
    RATE_LIMIT_PER_SECOND,
} = require('../../utils/wsMessageValidator');

describe('wsMessageValidator', () => {
    describe('validateMessage', () => {
        describe('hello messages', () => {
            it('should validate valid hello message', () => {
                const message = {
                    kind: 'hello',
                    deviceId: '550e8400-e29b-41d4-a716-446655440000',
                    secret: 'a'.repeat(32),
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(true);
                expect(result.value).toMatchObject(message);
            });

            it('should reject hello with invalid UUID', () => {
                const message = {
                    kind: 'hello',
                    deviceId: 'not-a-valid-uuid',
                    secret: 'a'.repeat(32),
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('UUID');
            });

            it('should reject hello with short secret', () => {
                const message = {
                    kind: 'hello',
                    deviceId: '550e8400-e29b-41d4-a716-446655440000',
                    secret: 'short',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('at least 32 characters');
            });

            it('should reject hello with missing deviceId', () => {
                const message = {
                    kind: 'hello',
                    secret: 'a'.repeat(32),
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('deviceId');
            });

            it('should reject hello with missing secret', () => {
                const message = {
                    kind: 'hello',
                    deviceId: '550e8400-e29b-41d4-a716-446655440000',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('secret');
            });

            it('should strip unknown fields from hello message', () => {
                const message = {
                    kind: 'hello',
                    deviceId: '550e8400-e29b-41d4-a716-446655440000',
                    secret: 'a'.repeat(32),
                    unknownField: 'should be removed',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(true);
                expect(result.value.unknownField).toBeUndefined();
            });
        });

        describe('ack messages', () => {
            it('should validate valid ack message with ok status', () => {
                const message = {
                    kind: 'ack',
                    id: 'msg-123',
                    status: 'ok',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(true);
                expect(result.value).toMatchObject(message);
            });

            it('should validate valid ack message with error status', () => {
                const message = {
                    kind: 'ack',
                    id: 'msg-456',
                    status: 'error',
                    error: 'Something went wrong',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(true);
                expect(result.value).toMatchObject(message);
            });

            it('should allow optional info field', () => {
                const message = {
                    kind: 'ack',
                    id: 'msg-789',
                    status: 'ok',
                    info: { details: 'some data' },
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(true);
                expect(result.value.info).toEqual({ details: 'some data' });
            });

            it('should reject ack with invalid status', () => {
                const message = {
                    kind: 'ack',
                    id: 'msg-123',
                    status: 'unknown',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('status');
            });

            it('should reject ack with missing id', () => {
                const message = {
                    kind: 'ack',
                    status: 'ok',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('id');
            });

            it('should reject ack with invalid id format', () => {
                const message = {
                    kind: 'ack',
                    id: 'invalid@id!',
                    status: 'ok',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('alphanumeric');
            });
        });

        describe('ping messages', () => {
            it('should validate ping message without timestamp', () => {
                const message = {
                    kind: 'ping',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(true);
                expect(result.value.kind).toBe('ping');
            });

            it('should validate ping message with timestamp', () => {
                const message = {
                    kind: 'ping',
                    timestamp: Date.now(),
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(true);
                expect(result.value.timestamp).toBe(message.timestamp);
            });

            it('should reject ping with negative timestamp', () => {
                const message = {
                    kind: 'ping',
                    timestamp: -1,
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('positive');
            });
        });

        describe('general validation', () => {
            it('should reject non-object messages', () => {
                const result = validateMessage('not an object');

                expect(result.valid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject null messages', () => {
                const result = validateMessage(null);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject messages without kind field', () => {
                const message = {
                    deviceId: '550e8400-e29b-41d4-a716-446655440000',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('kind');
            });

            it('should reject messages with non-string kind', () => {
                const message = {
                    kind: 123,
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('kind');
            });

            it('should reject unknown message kinds', () => {
                const message = {
                    kind: 'unknown',
                };

                const result = validateMessage(message);

                expect(result.valid).toBe(false);
                expect(result.error).toContain('Unknown message kind');
                expect(result.error).toContain('hello');
                expect(result.error).toContain('ack');
                expect(result.error).toContain('ping');
            });
        });
    });

    describe('MessageRateLimiter', () => {
        let rateLimiter;

        beforeEach(() => {
            rateLimiter = new MessageRateLimiter();
        });

        afterEach(() => {
            rateLimiter.reset();
        });

        it('should allow messages within rate limit', () => {
            const deviceId = 'device-123';

            for (let i = 0; i < RATE_LIMIT_PER_SECOND; i++) {
                expect(rateLimiter.checkRateLimit(deviceId)).toBe(true);
            }
        });

        it('should reject messages exceeding rate limit', () => {
            const deviceId = 'device-123';

            // Fill up the rate limit
            for (let i = 0; i < RATE_LIMIT_PER_SECOND; i++) {
                rateLimiter.checkRateLimit(deviceId);
            }

            // Next message should be rejected
            expect(rateLimiter.checkRateLimit(deviceId)).toBe(false);
        });

        it('should track violations', () => {
            const deviceId = 'device-123';

            // Fill up the rate limit
            for (let i = 0; i < RATE_LIMIT_PER_SECOND; i++) {
                rateLimiter.checkRateLimit(deviceId);
            }

            // Exceed limit twice
            rateLimiter.checkRateLimit(deviceId);
            rateLimiter.checkRateLimit(deviceId);

            const stats = rateLimiter.getStats(deviceId);
            expect(stats.violations).toBe(2);
        });

        it('should reset after time window', async () => {
            const deviceId = 'device-123';

            // Fill up the rate limit
            for (let i = 0; i < RATE_LIMIT_PER_SECOND; i++) {
                rateLimiter.checkRateLimit(deviceId);
            }

            // Wait for reset (1 second + buffer)
            await new Promise(resolve => setTimeout(resolve, 1100));

            // Should be allowed again
            expect(rateLimiter.checkRateLimit(deviceId)).toBe(true);
        });

        it('should track multiple devices independently', () => {
            const device1 = 'device-1';
            const device2 = 'device-2';

            // Fill up device1
            for (let i = 0; i < RATE_LIMIT_PER_SECOND; i++) {
                rateLimiter.checkRateLimit(device1);
            }

            // Device1 should be rate limited
            expect(rateLimiter.checkRateLimit(device1)).toBe(false);

            // Device2 should still be allowed
            expect(rateLimiter.checkRateLimit(device2)).toBe(true);
        });

        it('should return null stats for unknown device', () => {
            const stats = rateLimiter.getStats('unknown-device');
            expect(stats).toBeNull();
        });

        it('should return valid stats for tracked device', () => {
            const deviceId = 'device-123';

            rateLimiter.checkRateLimit(deviceId);
            rateLimiter.checkRateLimit(deviceId);

            const stats = rateLimiter.getStats(deviceId);

            expect(stats).toMatchObject({
                count: 2,
                limit: RATE_LIMIT_PER_SECOND,
                violations: 0,
            });
            expect(stats.resetAt).toBeGreaterThan(Date.now());
        });

        it('should cleanup device tracking', () => {
            const deviceId = 'device-123';

            rateLimiter.checkRateLimit(deviceId);
            expect(rateLimiter.getStats(deviceId)).not.toBeNull();

            rateLimiter.cleanup(deviceId);
            expect(rateLimiter.getStats(deviceId)).toBeNull();
        });

        it('should list tracked devices', () => {
            rateLimiter.checkRateLimit('device-1');
            rateLimiter.checkRateLimit('device-2');
            rateLimiter.checkRateLimit('device-3');

            const devices = rateLimiter.getTrackedDevices();

            expect(devices).toHaveLength(3);
            expect(devices).toContain('device-1');
            expect(devices).toContain('device-2');
            expect(devices).toContain('device-3');
        });

        it('should reset all tracking', () => {
            rateLimiter.checkRateLimit('device-1');
            rateLimiter.checkRateLimit('device-2');

            expect(rateLimiter.getTrackedDevices()).toHaveLength(2);

            rateLimiter.reset();

            expect(rateLimiter.getTrackedDevices()).toHaveLength(0);
        });
    });

    describe('constants', () => {
        it('should export MAX_MESSAGE_SIZE', () => {
            expect(MAX_MESSAGE_SIZE).toBe(1024 * 1024); // 1MB
            expect(typeof MAX_MESSAGE_SIZE).toBe('number');
        });

        it('should export RATE_LIMIT_PER_SECOND', () => {
            expect(RATE_LIMIT_PER_SECOND).toBe(10);
            expect(typeof RATE_LIMIT_PER_SECOND).toBe('number');
        });
    });
});
