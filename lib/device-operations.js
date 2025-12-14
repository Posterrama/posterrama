/**
 * Device Operations Library
 *
 * Business logic for device management operations.
 * Extracted from routes/devices.js to improve maintainability and testability.
 */

const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Parse cookies from cookie header string
 * @param {string} cookieHeader - Raw cookie header value
 * @returns {Object} Parsed cookies as key-value pairs
 */
function parseCookies(cookieHeader) {
    if (!cookieHeader) return {};
    return Object.fromEntries(
        cookieHeader
            .split(';')
            .map(c => c.trim().split('='))
            .filter(pair => pair.length === 2)
    );
}

/**
 * Process device registration request
 * @param {Object} params - Registration parameters
 * @param {Object} params.body - Request body
 * @param {Object} params.headers - Request headers
 * @param {string} params.ip - Client IP address
 * @param {boolean} params.deviceBypass - Whether device bypass is active
 * @returns {Promise<Object>} Registration result with device and secret
 */
async function processDeviceRegistration(deviceStore, { body, headers, ip, deviceBypass }) {
    const { name = '', location = '', installId = null, hardwareId: bodyHw = null } = body || {};

    // Log registration attempt unless from whitelisted admin IP
    if (!deviceBypass) {
        const userAgent = headers['user-agent'] || 'Unknown';
        const deviceName = name?.substring(0, 30) || 'unnamed';
        const deviceLocation = location?.substring(0, 30) || '';

        logger.info(
            `[Device] Registration: ${ip} (${userAgent.substring(0, 40)}) - "${deviceName}"${deviceLocation ? ' in ' + deviceLocation : ''}`,
            {
                name: name?.substring(0, 50) || 'unnamed',
                location: location?.substring(0, 50) || '',
                installId: installId?.substring(0, 20) || 'none',
                hardwareId:
                    (bodyHw || headers['x-hardware-id'] || '')?.toString().substring(0, 20) ||
                    'none',
                ip,
                userAgent: userAgent.substring(0, 100),
                timestamp: new Date().toISOString(),
            }
        );
    }

    // Extract identifiers from multiple sources (cookie, header, body)
    const cookies = parseCookies(headers['cookie']);
    const hdrIid = headers['x-install-id'] || null;
    const hdrHw = headers['x-hardware-id'] || null;
    const cookieIid = cookies['pr_iid'] || null;

    // Prefer cookie over header/body to keep identity stable across concurrent tabs
    const stableInstallId = cookieIid || hdrIid || installId || crypto.randomUUID();
    const hardwareId = (hdrHw || bodyHw || '').toString().slice(0, 256) || null;

    // Generate default name if not provided
    let finalName = (name || '').trim();
    if (!finalName) {
        finalName = `Device ${new Date().toISOString().slice(0, 10)}`;
    }

    // Register device (handles re-registration automatically)
    const { device, secret } = await deviceStore.registerDevice({
        name: finalName,
        location: location || '',
        installId: stableInstallId,
        hardwareId: hardwareId || null,
    });

    logger.debug(`[Device] New device registered: ${device.id} (installId: ${stableInstallId})`);

    return { device, secret, stableInstallId };
}

/**
 * Check device authentication and registration status
 * @param {Object} deviceStore - Device store instance
 * @param {Object} params - Check parameters
 * @param {string} params.deviceId - Device ID
 * @param {string} params.secret - Device secret
 * @param {string} params.hardwareId - Hardware ID from headers
 * @param {string} params.installId - Install ID from headers
 * @returns {Promise<Object>} Check result with validity and registration status
 */
async function checkDeviceStatus(deviceStore, { deviceId, secret, hardwareId, installId }) {
    // Require at least one identifier
    if (!deviceId && !hardwareId && !installId) {
        throw new Error('missing_device_identifier');
    }

    // Try to find device by multiple identifiers
    let device = null;

    if (deviceId) {
        device = await deviceStore.getById(deviceId);
    }

    if (!device && (hardwareId || installId)) {
        const allDevices = await deviceStore.getAll();

        if (hardwareId && !device) {
            device = allDevices.find(d => d.hardwareId === hardwareId);
        }

        if (installId && !device) {
            device = allDevices.find(d => d.installId === installId);
        }
    }

    // Device not found - not an error, just means device needs to register
    if (!device) {
        return {
            valid: false,
            isRegistered: false,
            reason: 'device_not_found',
        };
    }

    // Device exists but no secret provided - return registered status only
    if (!secret) {
        return {
            valid: false,
            isRegistered: true,
            deviceId: device.id,
            reason: 'secret_required',
        };
    }

    // Verify secret
    const isValid = await deviceStore.verifyDevice(device.id, secret);
    if (!isValid) {
        return {
            valid: false,
            isRegistered: true,
            deviceId: device.id,
            error: 'invalid_secret',
        };
    }

    // Update last seen timestamp
    await deviceStore.patchDevice(device.id, {
        lastSeenAt: new Date().toISOString(),
    });

    return {
        valid: true,
        isRegistered: true,
        deviceId: device.id,
    };
}

/**
 * Process device heartbeat
 * @param {Object} deviceStore - Device store instance
 * @param {Object} params - Heartbeat parameters
 * @returns {Promise<Object>} Heartbeat result with reload flag and queued commands
 */
async function processDeviceHeartbeat(deviceStore, params) {
    const { deviceId, secret, status = null, userAgent, hardwareId, screen, mode } = params;

    // Validate credentials
    if (!deviceId || !secret) {
        throw new Error('missing_credentials');
    }

    const device = await deviceStore.getById(deviceId);
    if (!device) {
        throw new Error('device_not_found');
    }

    const isValid = await deviceStore.verifyDevice(deviceId, secret);
    if (!isValid) {
        throw new Error('invalid_secret');
    }

    // Check reload flag
    const shouldReload = device.reload === true;

    // Retrieve and clear any queued commands
    const queuedCommands = deviceStore.popCommands(deviceId);

    // Extract clientInfo from payload
    // Support both formats: top-level screen/mode AND status.screen/status.mode
    const clientInfo = {};
    if (userAgent) clientInfo.userAgent = userAgent;
    if (status?.screen || screen) clientInfo.screen = status?.screen || screen;
    if (status?.mode || mode) clientInfo.mode = status?.mode || mode;

    // Update heartbeat with client info and current state
    await deviceStore.updateHeartbeat(deviceId, {
        clientInfo,
        currentState: status,
        hardwareId,
    });

    // Clear reload flag if needed
    if (shouldReload) {
        await deviceStore.patchDevice(device.id, { reload: false });
    }

    return {
        ok: true,
        reload: shouldReload,
        queuedCommands: queuedCommands || [],
    };
}

/**
 * Process device patch/update
 * @param {Object} deviceStore - Device store instance
 * @param {string} deviceId - Device ID to update
 * @param {Object} updates - Update payload
 * @returns {Promise<Object>} Updated device
 */
async function processDeviceUpdate(deviceStore, deviceId, updates) {
    const device = await deviceStore.getById(deviceId);

    if (!device) {
        throw new Error('device_not_found');
    }

    const patchData = {};

    // Handle allowed update fields
    const allowedFields = [
        'name',
        'location',
        'groups',
        'preset',
        'settingsOverride',
        'plexUsername',
        'profileId',
    ];

    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            patchData[field] = updates[field];
        }
    }

    // Log preset changes for debugging
    if (patchData.preset !== undefined) {
        logger.debug(`[Device PATCH] Applying preset '${patchData.preset}' to device ${deviceId}`);
    }

    // Update device in store
    await deviceStore.patchDevice(deviceId, patchData);

    // Get updated device
    const updatedDevice = await deviceStore.getById(deviceId);

    logger.debug(`[Device PATCH] Device ${deviceId} updated:`, patchData);

    return updatedDevice;
}

module.exports = {
    parseCookies,
    processDeviceRegistration,
    checkDeviceStatus,
    processDeviceHeartbeat,
    processDeviceUpdate,
};
