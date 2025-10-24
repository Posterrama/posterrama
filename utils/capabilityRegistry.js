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
     * Get device mode consistently
     * @param {object} device - Device object
     * @returns {string} Current mode
     */
    getDeviceMode(device) {
        return device.clientInfo?.mode || device.currentState?.mode || 'screensaver';
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
        this.registerMediaSensors();
        this.registerDeviceSensors();
        this.registerAdditionalSwitches();

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
     * Get all capabilities (regardless of availability)
     * @returns {Array} All capability specs with IDs
     */
    getAllCapabilities() {
        const all = [];
        for (const [id, spec] of this.capabilities) {
            all.push({ id, ...spec });
        }
        return all;
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
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.pause' });
            },
        });

        this.register('playback.resume', {
            name: 'Resume',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:play',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.resume' });
            },
        });

        this.register('playback.next', {
            name: 'Next',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:skip-next',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.next' });
            },
        });

        this.register('playback.previous', {
            name: 'Previous',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:skip-previous',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.previous' });
            },
        });

        this.register('playback.toggle', {
            name: 'Play/Pause',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:play-pause',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
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
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.pin' });
            },
        });

        this.register('pin.unpin', {
            name: 'Unpin',
            category: 'navigation',
            entityType: 'button',
            icon: 'mdi:pin-off',
            availableWhen: device => {
                return (
                    this.getDeviceMode(device) === 'screensaver' &&
                    device.currentState?.pinned === true
                );
            },
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
            entityType: 'switch',
            icon: 'mdi:refresh',
            commandHandler: async (deviceId, value) => {
                // For momentary switch: only act on ON, then auto-reset to OFF
                if (value === 'ON' || value === true) {
                    await wsHub.sendCommand(deviceId, { type: 'core.mgmt.reload' });
                }
                return true;
            },
            stateGetter: () => false, // Always OFF (momentary switch)
        });

        this.register('mgmt.reset', {
            name: 'Reset',
            category: 'management',
            entityType: 'switch',
            icon: 'mdi:restore',
            commandHandler: async (deviceId, value) => {
                // For momentary switch: only act on ON, then auto-reset to OFF
                if (value === 'ON' || value === true) {
                    await wsHub.sendCommand(deviceId, { type: 'core.mgmt.reset' });
                }
                return true;
            },
            stateGetter: () => false, // Always OFF (momentary switch)
        });
    }

    /**
     * Register mode selection capabilities
     */
    registerModeCapabilities() {
        this.register('mode.select', {
            name: 'Display Mode',
            category: 'mode',
            entityType: 'select',
            icon: 'mdi:view-dashboard',
            options: ['screensaver', 'wallart', 'cinema'],
            commandHandler: async (deviceId, mode) => {
                const logger = require('./logger');

                logger.info('🔧 Mode select command handler', { deviceId, mode });

                // Get the writeConfig function from server.js global scope
                // This is defined in server.js and available in the Node.js runtime
                const writeConfig = global.writeConfig;
                if (!writeConfig) {
                    throw new Error('writeConfig function not available');
                }

                // Get current config
                const config = require('../config.json');

                // Map mode to config flags
                const updatedConfig = { ...config };

                if (mode === 'cinema') {
                    updatedConfig.cinemaMode = true;
                    updatedConfig.wallartMode = updatedConfig.wallartMode || {};
                    updatedConfig.wallartMode.enabled = false;
                } else if (mode === 'wallart') {
                    updatedConfig.cinemaMode = false;
                    updatedConfig.wallartMode = updatedConfig.wallartMode || {};
                    updatedConfig.wallartMode.enabled = true;
                } else {
                    // screensaver
                    updatedConfig.cinemaMode = false;
                    updatedConfig.wallartMode = updatedConfig.wallartMode || {};
                    updatedConfig.wallartMode.enabled = false;
                }

                logger.info('🔧 Updating global config', {
                    mode,
                    cinemaMode: updatedConfig.cinemaMode,
                    wallartEnabled: updatedConfig.wallartMode.enabled,
                });

                // Update global config (this will trigger BroadcastChannel updates to all devices)
                try {
                    await writeConfig(updatedConfig);
                    logger.info('🔧 Global config updated successfully', { mode });
                    return true;
                } catch (err) {
                    logger.error('🔧 Failed to update global config', { error: err.message });
                    throw err;
                }
            },
            stateGetter: device => {
                return device.clientInfo?.mode || device.currentState?.mode || 'screensaver';
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
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
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
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
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
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, { transitionEffect: value });
            },
            stateGetter: device => {
                return device.settingsOverride?.transitionEffect || null;
            },
        });

        // Clock format - only for screensaver mode (when clock can be shown)
        this.register('settings.clockFormat', {
            name: 'Clock Format',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:clock-time-four-outline',
            options: ['12h', '24h'],
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, { clockFormat: value });
            },
            stateGetter: device => {
                return device.settingsOverride?.clockFormat || null;
            },
        });

        // UI Scaling - Global (screensaver only)
        this.register('settings.uiScaling.global', {
            name: 'UI Scale',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:magnify',
            unit: '%',
            min: 50,
            max: 200,
            step: 10,
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    uiScaling: { global: parseInt(value) },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.uiScaling?.global || null;
            },
        });

        // UI Scaling - Content (screensaver only)
        this.register('settings.uiScaling.content', {
            name: 'Content Scale',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:format-size',
            unit: '%',
            min: 50,
            max: 200,
            step: 10,
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
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
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { density: value },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.density || null;
            },
        });

        // Wallart poster refresh rate (seconds)
        this.register('settings.wallartMode.posterRefreshRate', {
            name: 'Poster Refresh Rate',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:timer-outline',
            unit: 's',
            min: 1,
            max: 60,
            step: 1,
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { posterRefreshRate: parseInt(value) },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.posterRefreshRate || null;
            },
        });

        // Wallart timing randomness
        this.register('settings.wallartMode.timingRandomness', {
            name: 'Timing Randomness',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:dice-multiple',
            unit: '%',
            min: 0,
            max: 100,
            step: 5,
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { timingRandomness: parseInt(value) },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.timingRandomness || null;
            },
        });

        // Wallart animation type
        this.register('settings.wallartMode.animationType', {
            name: 'Wallart Animation',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:animation',
            options: [
                'fade',
                'crossfade',
                'slide-left',
                'slide-right',
                'slide-up',
                'slide-down',
                'zoom-in',
                'zoom-out',
                'flip-horizontal',
                'flip-vertical',
                'rotate',
                'none',
            ],
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { animationType: value },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.animationType || null;
            },
        });

        // Wallart ambiance
        this.register('settings.wallartMode.ambiance', {
            name: 'Ambiance',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:lightbulb-on',
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { ambiance: boolValue },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.ambiance ?? false;
            },
        });

        // Wallart bias to ambiance
        this.register('settings.wallartMode.biasToAmbiance', {
            name: 'Bias to Ambiance',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:tune',
            unit: '%',
            min: 0,
            max: 100,
            step: 10,
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { biasToAmbiance: parseInt(value) },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.biasToAmbiance || null;
            },
        });

        // Wallart layout
        this.register('settings.wallartMode.layout', {
            name: 'Layout',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:view-dashboard',
            options: ['classic', 'hero-grid'],
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { layout: value },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.layout || null;
            },
        });

        // Wallart hero side
        this.register('settings.wallartMode.heroSide', {
            name: 'Hero Side',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:page-layout-sidebar-left',
            options: ['left', 'right'],
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { heroSide: value },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.heroSide || null;
            },
        });

        // Wallart hero rotation
        this.register('settings.wallartMode.heroRotation', {
            name: 'Hero Rotation',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:rotate-3d-variant',
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return wsHub.sendApplySettings(deviceId, {
                    wallartMode: { heroRotation: boolValue },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.wallartMode?.heroRotation ?? false;
            },
        });

        // Cinema orientation
        this.register('settings.cinema.orientation', {
            name: 'Orientation',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:phone-rotate-portrait',
            options: ['auto', 'portrait', 'portrait-flipped'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { orientation: value },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.orientation || null;
            },
        });

        // Cinema header enabled
        this.register('settings.cinema.header.enabled', {
            name: 'Cinema Header',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:page-layout-header',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await wsHub.sendApplySettings(deviceId, {
                    cinema: { header: { enabled: boolValue } },
                });
                return true;
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.header?.enabled;
                return val !== undefined ? val : true;
            },
        });

        // Cinema header text
        this.register('settings.cinema.header.text', {
            name: 'Cinema Header Text',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-title',
            options: ['None', 'Now Playing', 'Feature Presentation', 'Coming Soon'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { header: { text: value === 'None' ? '' : value } },
                });
            },
            stateGetter: device => {
                const text = device.settingsOverride?.cinema?.header?.text;
                return text === '' || text === undefined ? 'None' : text;
            },
        });

        // Cinema header style
        this.register('settings.cinema.header.style', {
            name: 'Header Marquee Style',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:palette',
            options: ['classic', 'neon', 'minimal', 'theatre'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { header: { style: value } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.header?.style || null;
            },
        });

        // Cinema ambilight enabled
        this.register('settings.cinema.ambilight.enabled', {
            name: 'Cinema Ambilight',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:lightbulb-on',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await wsHub.sendApplySettings(deviceId, {
                    cinema: { ambilight: { enabled: boolValue } },
                });
                return true;
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.ambilight?.enabled;
                return val !== undefined ? val : true;
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
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { ambilight: { strength: parseInt(value) } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.ambilight?.strength || null;
            },
        });

        // Cinema footer enabled
        this.register('settings.cinema.footer.enabled', {
            name: 'Cinema Footer',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:page-layout-footer',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { enabled: boolValue } },
                });
                return true;
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.footer?.enabled;
                return val !== undefined ? val : true;
            },
        });

        // Cinema footer type
        this.register('settings.cinema.footer.type', {
            name: 'Cinema Footer Type',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:view-split-horizontal',
            options: ['marquee', 'specs'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { type: value } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.footer?.type || null;
            },
        });

        // Cinema footer marquee text
        this.register('settings.cinema.footer.marqueeText', {
            name: 'Cinema Footer Text',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-text',
            options: ['None', 'Feature Presentation', 'Now Showing', 'Coming Attractions'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { marqueeText: value === 'None' ? '' : value } },
                });
            },
            stateGetter: device => {
                const text = device.settingsOverride?.cinema?.footer?.marqueeText;
                return text === '' || text === undefined ? 'None' : text;
            },
        });

        // Cinema footer marquee style
        this.register('settings.cinema.footer.marqueeStyle', {
            name: 'Cinema Footer Style',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:palette',
            options: ['classic', 'neon', 'minimal', 'theatre'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { marqueeStyle: value } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.footer?.marqueeStyle || null;
            },
        });

        // Cinema footer specs style
        this.register('settings.cinema.footer.specs.style', {
            name: 'Cinema Footer Icons',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:shape',
            options: ['subtle', 'filled', 'outline'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { specs: { style: value } } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.footer?.specs?.style || null;
            },
        });

        // Cinema footer specs icon set
        this.register('settings.cinema.footer.specs.iconSet', {
            name: 'Cinema Footer Icon Set',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:image-filter-none',
            options: ['filled', 'line'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { specs: { iconSet: value } } },
                });
            },
            stateGetter: device => {
                return device.settingsOverride?.cinema?.footer?.specs?.iconSet || null;
            },
        });

        // Cinema footer specs - show resolution
        this.register('settings.cinema.footer.specs.showResolution', {
            name: 'Show Resolution',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:monitor',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { specs: { showResolution: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.footer?.specs?.showResolution;
                return val !== undefined ? val : true;
            },
        });

        // Cinema footer specs - show audio
        this.register('settings.cinema.footer.specs.showAudio', {
            name: 'Show Audio',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:speaker',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { specs: { showAudio: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.footer?.specs?.showAudio;
                return val !== undefined ? val : true;
            },
        });

        // Cinema footer specs - show aspect ratio
        this.register('settings.cinema.footer.specs.showAspectRatio', {
            name: 'Show Aspect Ratio',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:aspect-ratio',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { specs: { showAspectRatio: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.footer?.specs?.showAspectRatio;
                return val !== undefined ? val : true;
            },
        });

        // Cinema footer specs - show flags
        this.register('settings.cinema.footer.specs.showFlags', {
            name: 'Show Flags',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:flag',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await wsHub.sendApplySettings(deviceId, {
                    cinema: { footer: { specs: { showFlags: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                const val = device.settingsOverride?.cinema?.footer?.specs?.showFlags;
                return val !== undefined ? val : false;
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

    /**
     * Register media metadata sensors
     */
    registerMediaSensors() {
        // Title
        this.register('media.title', {
            name: 'Title',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:text',
            stateGetter: device => device.currentState?.title || 'Unknown',
        });

        // Year
        this.register('media.year', {
            name: 'Year',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:calendar',
            stateGetter: device => device.currentState?.year || null,
        });

        // Rating
        this.register('media.rating', {
            name: 'Rating',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:star',
            stateGetter: device => device.currentState?.rating || null,
        });

        // Runtime
        this.register('media.runtime', {
            name: 'Runtime',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:clock-outline',
            unitOfMeasurement: 'min',
            stateGetter: device => device.currentState?.runtime || null,
        });

        // Genres
        this.register('media.genres', {
            name: 'Genres',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:tag-multiple',
            stateGetter: device => {
                const genres = device.currentState?.genres;
                return Array.isArray(genres) ? genres.join(', ') : null;
            },
        });

        // Content Rating
        this.register('media.contentRating', {
            name: 'Content Rating',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:shield-alert',
            stateGetter: device => device.currentState?.contentRating || null,
        });

        // Tagline
        this.register('media.tagline', {
            name: 'Tagline',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:format-quote-close',
            stateGetter: device => device.currentState?.tagline || null,
        });
    }

    /**
     * Register device status sensors
     */
    registerDeviceSensors() {
        // WebSocket Status
        this.register('device.wsStatus', {
            name: 'WebSocket Status',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:lan-connect',
            stateGetter: device => {
                const wsHub = require('./wsHub');
                return wsHub.isConnected(device.id) ? 'connected' : 'disconnected';
            },
        });

        // Device ID
        this.register('device.id', {
            name: 'Device ID',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:identifier',
            stateGetter: device => device.id,
        });

        // Resolution
        this.register('device.resolution', {
            name: 'Resolution',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:monitor-screenshot',
            stateGetter: device => {
                const screen = device.clientInfo?.screen;
                if (screen?.w && screen?.h) {
                    return `${screen.w}×${screen.h}`;
                }
                // Fallback: check if screen info is stored differently
                if (screen?.width && screen?.height) {
                    return `${screen.width}×${screen.height}`;
                }
                if (device.screen?.w && device.screen?.h) {
                    return `${device.screen.w}×${device.screen.h}`;
                }
                if (device.screen?.width && device.screen?.height) {
                    return `${device.screen.width}×${device.screen.height}`;
                }
                return 'Unknown';
            },
        });

        // Mode
        this.register('device.mode', {
            name: 'Mode',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:view-dashboard',
            stateGetter: device =>
                device.clientInfo?.mode || device.currentState?.mode || 'screensaver',
        });

        // User Agent
        this.register('device.userAgent', {
            name: 'User Agent',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:information',
            stateGetter: device => device.clientInfo?.userAgent || null,
        });

        // Client Type (parsed from user agent)
        this.register('device.clientType', {
            name: 'Client',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:devices',
            stateGetter: device => {
                const ua = device.clientInfo?.userAgent || '';
                if (ua.includes('AppleTV')) return 'Apple TV';
                if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
                if (ua.includes('Chrome')) return 'Chrome';
                if (ua.includes('Safari')) return 'Safari';
                if (ua.includes('Firefox')) return 'Firefox';
                if (ua.includes('Edge')) return 'Edge';
                return 'Unknown';
            },
        });

        // Status
        this.register('device.status', {
            name: 'Status',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:information-outline',
            stateGetter: device => {
                const wsHub = require('./wsHub');
                const isConnected = wsHub.isConnected(device.id);
                const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
                const now = new Date();

                if (isConnected) return 'live';
                if (lastSeen && (now - lastSeen) / 1000 < 60) return 'online';
                return 'offline';
            },
        });

        // Groups
        this.register('device.groups', {
            name: 'Groups',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:folder-multiple',
            stateGetter: device => {
                const groups = device.groups;
                return Array.isArray(groups) && groups.length > 0 ? groups.join(', ') : 'None';
            },
        });

        // Preset
        this.register('device.preset', {
            name: 'Preset',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:palette',
            stateGetter: device => device.preset || 'Default',
        });

        // Location
        this.register('device.location', {
            name: 'Location',
            category: 'sensor',
            entityType: 'sensor',
            icon: 'mdi:map-marker',
            stateGetter: device => device.location || 'Not set',
        });
    }

    /**
     * Register additional switch capabilities
     */
    registerAdditionalSwitches() {
        const wsHub = require('./wsHub');

        // Show Clock - only for screensaver mode
        this.register('settings.showClock', {
            name: 'Show Clock',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:clock-outline',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: async (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    clockWidget: value === 'ON',
                });
            },
            stateGetter: device => device.settingsOverride?.clockWidget ?? false,
        });

        // Show Logo - only for screensaver mode
        this.register('settings.showLogo', {
            name: 'Show Logo',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:image-area',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: async (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    showClearLogo: value === 'ON',
                });
            },
            stateGetter: device => device.settingsOverride?.showClearLogo ?? false,
        });

        // Show Metadata - only for screensaver mode
        this.register('settings.showMetadata', {
            name: 'Show Metadata',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:information',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: async (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    showMetadata: value === 'ON',
                });
            },
            stateGetter: device => device.settingsOverride?.showMetadata ?? false,
        });

        // Show Rotten Tomatoes - only for screensaver mode
        this.register('settings.showRottenTomatoes', {
            name: 'Show Rotten Tomatoes',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:tomato',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: async (deviceId, value) => {
                return wsHub.sendApplySettings(deviceId, {
                    showRottenTomatoes: value === 'ON',
                });
            },
            stateGetter: device => device.settingsOverride?.showRottenTomatoes ?? false,
        });
    }
}

// Export singleton instance
const registry = new CapabilityRegistry();
module.exports = registry;
