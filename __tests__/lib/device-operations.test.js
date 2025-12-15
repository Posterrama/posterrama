/**
 * Tests for lib/device-operations.js
 * Business logic for device management operations
 */

const deviceOps = require('../../lib/device-operations');

describe('device-operations', () => {
    describe('parseCookies', () => {
        it('should parse cookie header string', () => {
            const header = 'pr_iid=abc123; session=xyz789; foo=bar';
            const result = deviceOps.parseCookies(header);

            expect(result).toEqual({
                pr_iid: 'abc123',
                session: 'xyz789',
                foo: 'bar',
            });
        });

        it('should handle empty cookie header', () => {
            const result = deviceOps.parseCookies('');
            expect(result).toEqual({});
        });

        it('should handle null cookie header', () => {
            const result = deviceOps.parseCookies(null);
            expect(result).toEqual({});
        });

        it('should handle malformed cookies gracefully', () => {
            const header = 'pr_iid=abc123; invalid; foo=bar';
            const result = deviceOps.parseCookies(header);

            expect(result).toEqual({
                pr_iid: 'abc123',
                foo: 'bar',
            });
        });
    });

    describe('processDeviceRegistration', () => {
        let mockDeviceStore;

        beforeEach(() => {
            mockDeviceStore = {
                registerDevice: jest.fn().mockResolvedValue({
                    device: { id: 'device-123', name: 'Test Device' },
                    secret: 'secret-456',
                }),
            };
        });

        it('should register device with provided name and location', async () => {
            const params = {
                body: { name: 'Living Room TV', location: 'living-room' },
                headers: {},
                ip: '192.168.1.100',
                deviceBypass: false,
            };

            const result = await deviceOps.processDeviceRegistration(mockDeviceStore, params);

            expect(result.device.id).toBe('device-123');
            expect(result.secret).toBe('secret-456');
            expect(mockDeviceStore.registerDevice).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Living Room TV',
                    location: 'living-room',
                })
            );
        });

        it('should generate default name if not provided', async () => {
            const params = {
                body: {},
                headers: {},
                ip: '192.168.1.100',
                deviceBypass: false,
            };

            await deviceOps.processDeviceRegistration(mockDeviceStore, params);

            expect(mockDeviceStore.registerDevice).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: expect.stringMatching(/^Device \d{4}-\d{2}-\d{2}$/),
                })
            );
        });

        it('should prefer cookie install ID over header', async () => {
            const params = {
                body: { installId: 'body-id' },
                headers: {
                    cookie: 'pr_iid=cookie-id',
                    'x-install-id': 'header-id',
                },
                ip: '192.168.1.100',
                deviceBypass: false,
            };

            await deviceOps.processDeviceRegistration(mockDeviceStore, params);

            expect(mockDeviceStore.registerDevice).toHaveBeenCalledWith(
                expect.objectContaining({
                    installId: 'cookie-id',
                })
            );
        });

        it('should extract hardware ID from headers', async () => {
            const params = {
                body: {},
                headers: { 'x-hardware-id': 'hw-abc123' },
                ip: '192.168.1.100',
                deviceBypass: false,
            };

            await deviceOps.processDeviceRegistration(mockDeviceStore, params);

            expect(mockDeviceStore.registerDevice).toHaveBeenCalledWith(
                expect.objectContaining({
                    hardwareId: 'hw-abc123',
                })
            );
        });

        it('should skip logging when device bypass is active', async () => {
            const params = {
                body: { name: 'Admin Device' },
                headers: {},
                ip: '192.168.1.1',
                deviceBypass: true, // Whitelisted admin IP
            };

            // Should not throw, just skip logging
            const result = await deviceOps.processDeviceRegistration(mockDeviceStore, params);
            expect(result.device.id).toBe('device-123');
        });
    });

    describe('checkDeviceStatus', () => {
        let mockDeviceStore;

        beforeEach(() => {
            mockDeviceStore = {
                getById: jest.fn(),
                getAll: jest.fn(),
                verifyDevice: jest.fn(),
                patchDevice: jest.fn(),
            };
        });

        it('should throw error if no identifiers provided', async () => {
            await expect(deviceOps.checkDeviceStatus(mockDeviceStore, {})).rejects.toThrow(
                'missing_device_identifier'
            );
        });

        it('should return device_not_found if device does not exist', async () => {
            mockDeviceStore.getById.mockResolvedValue(null);
            mockDeviceStore.getAll.mockResolvedValue([]);

            const result = await deviceOps.checkDeviceStatus(mockDeviceStore, {
                deviceId: 'unknown-id',
            });

            expect(result).toEqual({
                valid: false,
                isRegistered: false,
                reason: 'device_not_found',
            });
        });

        it('should return secret_required if device exists but no secret provided', async () => {
            mockDeviceStore.getById.mockResolvedValue({ id: 'device-123' });

            const result = await deviceOps.checkDeviceStatus(mockDeviceStore, {
                deviceId: 'device-123',
            });

            expect(result).toEqual({
                valid: false,
                isRegistered: true,
                deviceId: 'device-123',
                reason: 'secret_required',
            });
        });

        it('should return invalid_secret if secret is wrong', async () => {
            mockDeviceStore.getById.mockResolvedValue({ id: 'device-123' });
            mockDeviceStore.verifyDevice.mockResolvedValue(false);

            const result = await deviceOps.checkDeviceStatus(mockDeviceStore, {
                deviceId: 'device-123',
                secret: 'wrong-secret',
            });

            expect(result).toEqual({
                valid: false,
                isRegistered: true,
                deviceId: 'device-123',
                error: 'invalid_secret',
            });
        });

        it('should return valid:true if credentials are correct', async () => {
            mockDeviceStore.getById.mockResolvedValue({ id: 'device-123' });
            mockDeviceStore.verifyDevice.mockResolvedValue(true);
            mockDeviceStore.patchDevice.mockResolvedValue();

            const result = await deviceOps.checkDeviceStatus(mockDeviceStore, {
                deviceId: 'device-123',
                secret: 'correct-secret',
            });

            expect(result).toEqual({
                valid: true,
                isRegistered: true,
                deviceId: 'device-123',
            });

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith(
                'device-123',
                expect.objectContaining({
                    lastSeenAt: expect.any(String),
                })
            );
        });

        it('should find device by hardware ID if device ID not found', async () => {
            mockDeviceStore.getById.mockResolvedValue(null);
            mockDeviceStore.getAll.mockResolvedValue([
                { id: 'device-123', hardwareId: 'hw-abc123' },
            ]);
            mockDeviceStore.verifyDevice.mockResolvedValue(true);
            mockDeviceStore.patchDevice.mockResolvedValue();

            const result = await deviceOps.checkDeviceStatus(mockDeviceStore, {
                deviceId: null,
                hardwareId: 'hw-abc123',
                secret: 'correct-secret',
            });

            expect(result.valid).toBe(true);
            expect(result.deviceId).toBe('device-123');
        });
    });

    describe('processDeviceHeartbeat', () => {
        let mockDeviceStore;

        beforeEach(() => {
            mockDeviceStore = {
                getById: jest.fn(),
                verifyDevice: jest.fn(),
                popCommands: jest.fn().mockReturnValue([]),
                updateHeartbeat: jest.fn(),
                patchDevice: jest.fn(),
            };
        });

        it('should throw error if credentials missing', async () => {
            await expect(deviceOps.processDeviceHeartbeat(mockDeviceStore, {})).rejects.toThrow(
                'missing_credentials'
            );
        });

        it('should throw error if device not found', async () => {
            mockDeviceStore.getById.mockResolvedValue(null);

            await expect(
                deviceOps.processDeviceHeartbeat(mockDeviceStore, {
                    deviceId: 'unknown',
                    secret: 'secret',
                })
            ).rejects.toThrow('device_not_found');
        });

        it('should throw error if secret invalid', async () => {
            mockDeviceStore.getById.mockResolvedValue({ id: 'device-123' });
            mockDeviceStore.verifyDevice.mockResolvedValue(false);

            await expect(
                deviceOps.processDeviceHeartbeat(mockDeviceStore, {
                    deviceId: 'device-123',
                    secret: 'wrong',
                })
            ).rejects.toThrow('invalid_secret');
        });

        it('should process heartbeat and return queued commands', async () => {
            mockDeviceStore.getById.mockResolvedValue({ id: 'device-123', reload: false });
            mockDeviceStore.verifyDevice.mockResolvedValue(true);
            mockDeviceStore.popCommands.mockReturnValue([{ type: 'refresh' }]);

            const result = await deviceOps.processDeviceHeartbeat(mockDeviceStore, {
                deviceId: 'device-123',
                secret: 'correct-secret',
                userAgent: 'TestClient/1.0',
                screen: { width: 1920, height: 1080 },
            });

            expect(result).toEqual({
                ok: true,
                reload: false,
                queuedCommands: [{ type: 'refresh' }],
            });

            expect(mockDeviceStore.updateHeartbeat).toHaveBeenCalledWith(
                'device-123',
                expect.objectContaining({
                    clientInfo: expect.objectContaining({
                        userAgent: 'TestClient/1.0',
                        screen: { width: 1920, height: 1080 },
                    }),
                })
            );
        });

        it('should clear reload flag if set', async () => {
            mockDeviceStore.getById.mockResolvedValue({ id: 'device-123', reload: true });
            mockDeviceStore.verifyDevice.mockResolvedValue(true);

            const result = await deviceOps.processDeviceHeartbeat(mockDeviceStore, {
                deviceId: 'device-123',
                secret: 'correct-secret',
            });

            expect(result.reload).toBe(true);
            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith('device-123', {
                reload: false,
            });
        });
    });

    describe('processDeviceUpdate', () => {
        let mockDeviceStore;

        beforeEach(() => {
            mockDeviceStore = {
                getById: jest.fn(),
                patchDevice: jest.fn(),
            };
        });

        it('should throw error if device not found', async () => {
            mockDeviceStore.getById.mockResolvedValueOnce(null);

            await expect(
                deviceOps.processDeviceUpdate(mockDeviceStore, 'unknown-id', {})
            ).rejects.toThrow('device_not_found');
        });

        it('should reject legacy groups field', async () => {
            mockDeviceStore.getById.mockResolvedValueOnce({ id: 'device-123' });

            await expect(
                deviceOps.processDeviceUpdate(mockDeviceStore, 'device-123', { groups: ['x'] })
            ).rejects.toThrow('groups_not_supported');

            expect(mockDeviceStore.patchDevice).not.toHaveBeenCalled();
        });

        it('should update allowed fields only', async () => {
            mockDeviceStore.getById
                .mockResolvedValueOnce({ id: 'device-123', name: 'Old Name' })
                .mockResolvedValueOnce({ id: 'device-123', name: 'New Name' });

            const updates = {
                name: 'New Name',
                location: 'new-location',
                invalidField: 'should-be-ignored',
            };

            await deviceOps.processDeviceUpdate(mockDeviceStore, 'device-123', updates);

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith('device-123', {
                name: 'New Name',
                location: 'new-location',
            });
        });

        it('should handle preset assignment', async () => {
            mockDeviceStore.getById
                .mockResolvedValueOnce({ id: 'device-123' })
                .mockResolvedValueOnce({ id: 'device-123', preset: 'cinema-4k' });

            await deviceOps.processDeviceUpdate(mockDeviceStore, 'device-123', {
                preset: 'cinema-4k',
            });

            expect(mockDeviceStore.patchDevice).toHaveBeenCalledWith('device-123', {
                preset: 'cinema-4k',
            });
        });

        it('should return updated device', async () => {
            const updatedDevice = { id: 'device-123', name: 'Updated' };
            mockDeviceStore.getById
                .mockResolvedValueOnce({ id: 'device-123', name: 'Old' })
                .mockResolvedValueOnce(updatedDevice);

            const result = await deviceOps.processDeviceUpdate(mockDeviceStore, 'device-123', {
                name: 'Updated',
            });

            expect(result).toEqual(updatedDevice);
        });
    });
});
