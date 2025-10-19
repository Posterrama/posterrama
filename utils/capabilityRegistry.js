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
        this.registerDisplaySettingsCapabilities();
        this.registerCameraCapabilities();

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

    /**
     * Register display settings capabilities
     * These settings can be controlled per-device via MQTT/Home Assistant
     */
    registerDisplaySettingsCapabilities() {
        const wsHub = require('./wsHub');

        // Transition interval (seconds between posters)
        this.register('settings.transitionInterval', {
            name: 'Transition Interval',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:timer-outline',
            unit: 's',
            min: 5,
            max: 300,
            step: 5,
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    transitionIntervalSeconds: parseInt(value),
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.transitionIntervalSeconds || null;
            },
        });

        // Effect pause time
        this.register('settings.effectPauseTime', {
            name: 'Effect Pause Time',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:pause-circle-outline',
            unit: 's',
            min: 0,
            max: 10,
            step: 1,
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, { effectPauseTime: parseInt(value) });
            },
            stateGetter: device => {
                return device.settingsOverride?.effectPauseTime || null;
            },
        });

        // Transition effect
        this.register('settings.transitionEffect', {
            name: 'Transition Effect',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:transition',
            options: ['fade', 'slide', 'zoom', 'kenburns', 'none'],
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, { transitionEffect: value });
            },
            stateGetter: device => {
                return device.settingsOverride?.transitionEffect || null;
            },
        });

        // Show clear logo
        this.register('settings.showClearLogo', {
            name: 'Show Logo',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:image-text',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, { showClearLogo: boolValue });
            },
            stateGetter: device => {
                const val = device.settingsOverride?.showClearLogo;
                return val !== undefined ? val : null;
            },
        });

        // Show metadata
        this.register('settings.showMetadata', {
            name: 'Show Metadata',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:text-box-outline',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, { showMetadata: boolValue });
            },
            stateGetter: device => {
                const val = device.settingsOverride?.showMetadata;
                return val !== undefined ? val : null;
            },
        });

        // Show Rotten Tomatoes
        this.register('settings.showRottenTomatoes', {
            name: 'Show Rotten Tomatoes',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:fruit-cherries',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, { showRottenTomatoes: boolValue });
            },
            stateGetter: device => {
                const val = device.settingsOverride?.showRottenTomatoes;
                return val !== undefined ? val : null;
            },
        });

        // Clock widget
        this.register('settings.clockWidget', {
            name: 'Show Clock',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:clock-outline',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, { clockWidget: boolValue });
            },
            stateGetter: device => {
                const val = device.settingsOverride?.clockWidget;
                return val !== undefined ? val : null;
            },
        });

        // Clock format
        this.register('settings.clockFormat', {
            name: 'Clock Format',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:clock-time-four-outline',
            options: ['12h', '24h'],
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, { clockFormat: value });
            },
            stateGetter: device => {
                return device.settingsOverride?.clockFormat || null;
            },
        });

        // UI Scaling - Global
        this.register('settings.uiScaling.global', {
            name: 'UI Scale',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:magnify',
            unit: '%',
            min: 50,
            max: 200,
            step: 10,
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    uiScaling: { global: parseInt(value) },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.uiScaling?.global || null;
            },
        });

        // UI Scaling - Content
        this.register('settings.uiScaling.content', {
            name: 'Content Scale',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:format-size',
            unit: '%',
            min: 50,
            max: 200,
            step: 10,
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    uiScaling: { content: parseInt(value) },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.uiScaling?.content || null;
            },
        });

        // Wallart density
        this.register('settings.wallartMode.density', {
            name: 'Wallart Density',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:grid',
            options: ['low', 'medium', 'high', 'ludicrous'],
            availableWhen: device => device.currentState?.mode === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { density: value },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.density || null;
            },
        });

        // Wallart refresh rate
        this.register('settings.wallartMode.refreshRate', {
            name: 'Wallart Refresh Rate',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:update',
            min: 1,
            max: 10,
            step: 1,
            availableWhen: device => device.currentState?.mode === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { refreshRate: parseInt(value) },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.refreshRate || null;
            },
        });

        // Wallart animation type
        this.register('settings.wallartMode.animationType', {
            name: 'Wallart Animation',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:animation',
            options: ['fade', 'flip', 'slide', 'zoom', 'none'],
            availableWhen: device => device.currentState?.mode === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { animationType: value },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.animationType || null;
            },
        });

        // Cinema header enabled
        this.register('settings.cinema.header.enabled', {
            name: 'Cinema Header',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:page-layout-header',
            availableWhen: device => device.currentState?.mode === 'cinema',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { header: { enabled: boolValue } },
                });
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.header?.enabled;
                return val !== undefined ? val : null;
            },
        });

        // Cinema header text
        this.register('settings.cinema.header.text', {
            name: 'Cinema Header Text',
            category: 'settings',
            entityType: 'text',
            icon: 'mdi:format-title',
            pattern: '.{0,50}',
            availableWhen: device => device.currentState?.mode === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { header: { text: value } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.header?.text || null;
            },
        });

        // Cinema ambilight
        this.register('settings.cinema.ambilight.enabled', {
            name: 'Cinema Ambilight',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:lightbulb-on',
            availableWhen: device => device.currentState?.mode === 'cinema',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { ambilight: { enabled: boolValue } },
                });
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.ambilight?.enabled;
                return val !== undefined ? val : null;
            },
        });

        // Cinema ambilight strength
        this.register('settings.cinema.ambilight.strength', {
            name: 'Ambilight Strength',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:brightness-6',
            unit: '%',
            min: 0,
            max: 100,
            step: 10,
            availableWhen: device => device.currentState?.mode === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { ambilight: { strength: parseInt(value) } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.ambilight?.strength || null;
            },
        });
    }

    /**
     * Register camera capability for poster preview
     */
    registerCameraCapabilities() {
        this.register('camera.preview', {
            name: 'Current Poster',
            category: 'camera',
            entityType: 'camera',
            icon: 'mdi:image',
            // No command handler - camera is read-only
            commandHandler: () => Promise.resolve(),
        });
    }
}

// Export singleton instance
const registry = new CapabilityRegistry();
module.exports = registry;
