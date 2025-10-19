/**
 * Capability Registry
 *
 * Central registry for all Posterrama device capabilities.
 * Automatically discovers and publishes capabilities to MQTT/Home Assistant.
 *
 * When adding a new feature, simply register it here and it will:
 * - Auto-publish to Home Assistant Discovery
 * - Auto-create entities in Home Assistant
 * - Auto-route commands from MQTT
 * - Auto-update state publishing
 */

const logger = require('./logger');

class CapabilityRegistry {
    constructor() {
        this.capabilities = new Map();
        this.initialized = false;
    }

    /**
     * Initialize and register all core capabilities
     */
    init() {
        if (this.initialized) {
            logger.warn('CapabilityRegistry already initialized');
            return;
        }

        this.registerPlaybackCapabilities();
        this.registerPowerCapabilities();
        this.registerNavigationCapabilities();
        this.registerManagementCapabilities();
        this.registerModeCapabilities();

        this.initialized = true;
        logger.info(
            `✅ Capability Registry initialized with ${this.capabilities.size} capabilities`
        );
    }

    /**
     * Register a capability
     * @param {string} id - Unique capability ID (e.g., 'playback.pause')
     * @param {object} spec - Capability specification
     */
    register(id, spec) {
        if (this.capabilities.has(id)) {
            logger.warn(`Capability ${id} already registered, overwriting`);
        }

        this.capabilities.set(id, {
            id,
            name: spec.name || id,
            category: spec.category || 'general',
            entityType: spec.entityType || 'button',
            icon: spec.icon || 'mdi:help',
            availableWhen: spec.availableWhen || (() => true),
            commandHandler: spec.commandHandler || (() => Promise.resolve()),
            stateGetter: spec.stateGetter || null,
            min: spec.min,
            max: spec.max,
            step: spec.step,
            unit: spec.unit,
            options: spec.options,
        });

        logger.debug(`Registered capability: ${id}`, {
            category: spec.category,
            type: spec.entityType,
        });
    }

    /**
     * Get all capabilities available for a specific device
     * @param {object} device - Device object from deviceStore
     * @returns {Array} Array of available capability specs
     */
    getAvailableCapabilities(device) {
        const available = [];

        for (const [id, spec] of this.capabilities) {
            try {
                if (!spec.availableWhen || spec.availableWhen(device)) {
                    available.push({ id, ...spec });
                }
            } catch (error) {
                logger.error(`Error checking availability for ${id}:`, error);
            }
        }

        return available;
    }

    /**
     * Get a specific capability by ID
     * @param {string} id - Capability ID
     * @returns {object|null} Capability spec or null
     */
    get(id) {
        return this.capabilities.get(id) || null;
    }

    /**
     * Check if a capability exists
     * @param {string} id - Capability ID
     * @returns {boolean}
     */
    has(id) {
        return this.capabilities.has(id);
    }

    /**
     * Register playback control capabilities
     */
    registerPlaybackCapabilities() {
        const wsHub = require('./wsHub');

        this.register('playback.pause', {
            name: 'Pause',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:pause',
            availableWhen: device => device.currentState?.mode === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.pause' });
            },
        });

        this.register('playback.resume', {
            name: 'Resume',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:play',
            availableWhen: device => device.currentState?.mode === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.resume' });
            },
        });

        this.register('playback.next', {
            name: 'Next',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:skip-next',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.next' });
            },
        });

        this.register('playback.previous', {
            name: 'Previous',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:skip-previous',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.previous' });
            },
        });

        this.register('playback.toggle', {
            name: 'Play/Pause',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:play-pause',
            availableWhen: device => device.currentState?.mode === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.toggle' });
            },
        });
    }

    /**
     * Register power control capabilities
     */
    registerPowerCapabilities() {
        const wsHub = require('./wsHub');

        this.register('power.toggle', {
            name: 'Power',
            category: 'power',
            entityType: 'switch',
            icon: 'mdi:power',
            commandHandler: (deviceId, value) => {
                // For switches, value is 'ON' or 'OFF'
                const type = value === 'OFF' ? 'power.off' : 'power.on';
                return wsHub.sendCommand(deviceId, { type });
            },
            stateGetter: device => {
                // Switch state: true = ON (powered on), false = OFF (powered off)
                return !device.currentState?.poweredOff;
            },
        });

        this.register('power.on', {
            name: 'Power On',
            category: 'power',
            entityType: 'button',
            icon: 'mdi:power-on',
            availableWhen: device => device.currentState?.poweredOff === true,
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'power.on' });
            },
        });

        this.register('power.off', {
            name: 'Power Off',
            category: 'power',
            entityType: 'button',
            icon: 'mdi:power-off',
            availableWhen: device => device.currentState?.poweredOff !== true,
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'power.off' });
            },
        });
    }

    /**
     * Register navigation capabilities
     */
    registerNavigationCapabilities() {
        const wsHub = require('./wsHub');

        this.register('pin.current', {
            name: 'Pin Current Poster',
            category: 'navigation',
            entityType: 'button',
            icon: 'mdi:pin',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.pin' });
            },
        });

        this.register('pin.unpin', {
            name: 'Unpin',
            category: 'navigation',
            entityType: 'button',
            icon: 'mdi:pin-off',
            availableWhen: device => device.currentState?.pinned === true,
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.unpin' });
            },
        });
    }

    /**
     * Register management capabilities
     */
    registerManagementCapabilities() {
        const wsHub = require('./wsHub');

        this.register('mgmt.reload', {
            name: 'Reload',
            category: 'management',
            entityType: 'button',
            icon: 'mdi:refresh',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'core.mgmt.reload' });
            },
        });

        this.register('mgmt.reset', {
            name: 'Reset',
            category: 'management',
            entityType: 'button',
            icon: 'mdi:restore',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'core.mgmt.reset' });
            },
        });
    }

    /**
     * Register mode selection capabilities
     */
    registerModeCapabilities() {
        const wsHub = require('./wsHub');

        this.register('mode.select', {
            name: 'Display Mode',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:view-dashboard',
            options: ['screensaver', 'wallart', 'cinema'],
            commandHandler: (deviceId, mode) => {
                return wsHub.sendApplySettings(deviceId, { mode });
            },
            stateGetter: device => {
                return device.currentState?.mode || 'screensaver';
            },
        });
    }
}

// Export singleton instance
const registry = new CapabilityRegistry();
module.exports = registry;
