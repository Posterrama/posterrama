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
     * Get cinema setting value with fallback chain:
     * 1. Device settingsOverride (MQTT commands)
     * 2. Global config.json
     * 3. Default value
     */
    getCinemaSetting(device, path, defaultValue) {
        return this.getModeSetting(device, 'cinema', path, defaultValue);
    }

    /**
     * Get screensaver setting value with fallback chain
     */
    getScreensaverSetting(device, path, defaultValue) {
        return this.getModeSetting(device, 'screensaver', path, defaultValue);
    }

    /**
     * Get wallart setting value with fallback chain
     */
    getWallartSetting(device, path, defaultValue) {
        return this.getModeSetting(device, 'wallart', path, defaultValue);
    }

    /**
     * Generic getter for any mode setting with fallback chain:
     * 1. Device settingsOverride (MQTT commands)
     * 2. Global config.json
     * 3. Default value
     */
    getModeSetting(device, mode, path, defaultValue) {
        // Try device override first
        const parts = path.split('.');
        let override = device.settingsOverride?.[mode];
        for (const part of parts) {
            if (override === undefined) break;
            override = override[part];
        }
        if (override !== undefined) return override;

        // Try global config
        try {
            const config = require('../config.json');
            let globalVal = config[mode];
            for (const part of parts) {
                if (globalVal === undefined) break;
                globalVal = globalVal[part];
            }
            if (globalVal !== undefined) return globalVal;
        } catch (_) {
            // config not available
        }

        // Return default
        return defaultValue;
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
        const deviceStore = require('./deviceStore');

        this.register('mode.select', {
            name: 'Display Mode',
            category: 'mode',
            entityType: 'select',
            icon: 'mdi:view-dashboard',
            options: ['screensaver', 'wallart', 'cinema'],
            commandHandler: async (deviceId, mode) => {
                const logger = require('./logger');

                logger.info('🔧 Mode select command handler (device override)', { deviceId, mode });

                // Get current device
                const device = await deviceStore.getById(deviceId);
                if (!device) {
                    throw new Error(`Device not found: ${deviceId}`);
                }

                // Store mode in device.settingsOverride (per-device mode)
                const currentOverride = device.settingsOverride || {};

                // Build settings override that explicitly sets the mode AND disables conflicting legacy flags
                // This ensures the device override takes precedence over global admin settings
                const updatedOverride = {
                    ...currentOverride,
                    mode,
                    // Explicitly override legacy boolean flags to prevent conflicts
                    cinemaMode: mode === 'cinema',
                    wallartMode: {
                        ...(currentOverride.wallartMode || {}),
                        enabled: mode === 'wallart',
                    },
                };

                // Persist to devices.json
                await deviceStore.patchDevice(deviceId, {
                    settingsOverride: updatedOverride,
                });

                logger.info('✅ Device mode override saved', {
                    deviceId,
                    mode,
                    override: updatedOverride,
                });

                // Send mode navigation command to device via WebSocket
                await wsHub.sendCommand(deviceId, {
                    type: 'mode.navigate',
                    payload: { mode },
                });

                logger.info('✅ Mode navigation command sent to device', { deviceId, mode });

                return true;
            },
            stateGetter: device => {
                // Check device override first, then clientInfo, then currentState
                return (
                    device.settingsOverride?.mode ||
                    device.clientInfo?.mode ||
                    device.currentState?.mode ||
                    'screensaver'
                );
            },
        });
    }

    /**
     * Register display settings capabilities
     * These settings can be controlled per-device via MQTT/Home Assistant
     */
    registerDisplaySettingsCapabilities() {
        const wsHub = require('./wsHub');
        const deviceStore = require('./deviceStore');

        /**
         * Helper to persist settings to device override and send to device
         * @param {string} deviceId - Device ID
         * @param {object} settingsUpdate - Settings to apply
         */
        const applyAndPersistSettings = async (deviceId, settingsUpdate) => {
            // Get current device
            const device = await deviceStore.getById(deviceId);
            if (!device) {
                throw new Error(`Device not found: ${deviceId}`);
            }

            // Deep merge settings into device.settingsOverride
            const currentOverride = device.settingsOverride || {};
            const mergedOverride = deepMergeSettings(currentOverride, settingsUpdate);

            // Persist to devices.json
            await deviceStore.patchDevice(deviceId, {
                settingsOverride: mergedOverride,
            });

            // Send to device via WebSocket
            await wsHub.sendApplySettings(deviceId, settingsUpdate);
        };

        /**
         * Deep merge settings objects (handles nested objects like uiScaling, wallartMode, cinema)
         */
        const deepMergeSettings = (target, source) => {
            const result = { ...target };
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = deepMergeSettings(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        };

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
                return applyAndPersistSettings(deviceId, {
                    transitionIntervalSeconds: parseInt(value),
                });
            },
            stateGetter: device => {
                // Check device override
                if (device.settingsOverride?.transitionIntervalSeconds !== undefined) {
                    return device.settingsOverride.transitionIntervalSeconds;
                }
                // Check global config
                try {
                    const config = require('../config.json');
                    if (config.transitionIntervalSeconds !== undefined) {
                        return config.transitionIntervalSeconds;
                    }
                } catch (_) {
                    // Config not available
                }
                // Return default
                return 10;
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
                return applyAndPersistSettings(deviceId, { effectPauseTime: parseInt(value) });
            },
            stateGetter: device => {
                if (device.settingsOverride?.effectPauseTime !== undefined) {
                    return device.settingsOverride.effectPauseTime;
                }
                try {
                    const config = require('../config.json');
                    if (config.effectPauseTime !== undefined) {
                        return config.effectPauseTime;
                    }
                } catch (_) {
                    // Config not available
                }
                return 2;
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
                return applyAndPersistSettings(deviceId, { transitionEffect: value });
            },
            stateGetter: device => {
                if (device.settingsOverride?.transitionEffect !== undefined) {
                    return device.settingsOverride.transitionEffect;
                }
                try {
                    const config = require('../config.json');
                    if (config.transitionEffect !== undefined) {
                        return config.transitionEffect;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'kenburns';
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
                return applyAndPersistSettings(deviceId, { clockFormat: value });
            },
            stateGetter: device => {
                if (device.settingsOverride?.clockFormat !== undefined) {
                    return device.settingsOverride.clockFormat;
                }
                try {
                    const config = require('../config.json');
                    if (config.clockFormat !== undefined) {
                        return config.clockFormat;
                    }
                } catch (_) {
                    // Config not available
                }
                return '24h';
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
                return applyAndPersistSettings(deviceId, {
                    uiScaling: { global: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.uiScaling?.global !== undefined) {
                    return device.settingsOverride.uiScaling.global;
                }
                try {
                    const config = require('../config.json');
                    if (config.uiScaling?.global !== undefined) {
                        return config.uiScaling.global;
                    }
                } catch (_) {
                    // Config not available
                }
                return 100;
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
                return applyAndPersistSettings(deviceId, {
                    uiScaling: { content: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.uiScaling?.content !== undefined) {
                    return device.settingsOverride.uiScaling.content;
                }
                try {
                    const config = require('../config.json');
                    if (config.uiScaling?.content !== undefined) {
                        return config.uiScaling.content;
                    }
                } catch (_) {
                    // Config not available
                }
                return 100;
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
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { density: value },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.density !== undefined) {
                    return device.settingsOverride.wallartMode.density;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.density !== undefined) {
                        return config.wallartMode.density;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'medium';
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
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { posterRefreshRate: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.posterRefreshRate !== undefined) {
                    return device.settingsOverride.wallartMode.posterRefreshRate;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.refreshRate !== undefined) {
                        return config.wallartMode.refreshRate;
                    }
                } catch (_) {
                    // Config not available
                }
                return 4;
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
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { timingRandomness: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.timingRandomness !== undefined) {
                    return device.settingsOverride.wallartMode.timingRandomness;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.randomness !== undefined) {
                        return config.wallartMode.randomness;
                    }
                } catch (_) {
                    // Config not available
                }
                return 2;
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
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { animationType: value },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.animationType !== undefined) {
                    return device.settingsOverride.wallartMode.animationType;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.animationType !== undefined) {
                        return config.wallartMode.animationType;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'fade';
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
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { ambiance: boolValue },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.ambiance !== undefined) {
                    return device.settingsOverride.wallartMode.ambiance;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.ambientGradient !== undefined) {
                        return config.wallartMode.ambientGradient;
                    }
                } catch (_) {
                    // Config not available
                }
                return false;
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
                const percentage = parseInt(value);
                // Convert percentage to boolean: >50% means bias to hero poster
                const biasToHero = percentage > 50;

                return applyAndPersistSettings(deviceId, {
                    wallartMode: {
                        layoutSettings: {
                            heroGrid: {
                                biasAmbientToHero: biasToHero,
                            },
                        },
                    },
                });
            },
            stateGetter: device => {
                // Check device override first
                if (
                    device.settingsOverride?.wallartMode?.layoutSettings?.heroGrid
                        ?.biasAmbientToHero !== undefined
                ) {
                    return device.settingsOverride.wallartMode.layoutSettings.heroGrid
                        .biasAmbientToHero
                        ? 100
                        : 0;
                }
                if (device.settingsOverride?.wallartMode?.biasToAmbiance !== undefined) {
                    return device.settingsOverride.wallartMode.biasToAmbiance;
                }
                try {
                    const config = require('../config.json');
                    if (
                        config.wallartMode?.layoutSettings?.heroGrid?.biasAmbientToHero !==
                        undefined
                    ) {
                        return config.wallartMode.layoutSettings.heroGrid.biasAmbientToHero
                            ? 100
                            : 0;
                    }
                } catch (_) {
                    // Config not available
                }
                return 0;
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
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { layout: value },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.layout !== undefined) {
                    return device.settingsOverride.wallartMode.layout;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.layoutVariant !== undefined) {
                        // Convert camelCase to kebab-case
                        return config.wallartMode.layoutVariant === 'heroGrid'
                            ? 'hero-grid'
                            : config.wallartMode.layoutVariant;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'classic';
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
                return applyAndPersistSettings(deviceId, {
                    wallartMode: {
                        layoutSettings: {
                            heroGrid: {
                                heroSide: value,
                            },
                        },
                    },
                });
            },
            stateGetter: device => {
                // Check device override first (may be at either path for backward compat)
                if (
                    device.settingsOverride?.wallartMode?.layoutSettings?.heroGrid?.heroSide !==
                    undefined
                ) {
                    return device.settingsOverride.wallartMode.layoutSettings.heroGrid.heroSide;
                }
                if (device.settingsOverride?.wallartMode?.heroSide !== undefined) {
                    return device.settingsOverride.wallartMode.heroSide;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.layoutSettings?.heroGrid?.heroSide !== undefined) {
                        return config.wallartMode.layoutSettings.heroGrid.heroSide;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'left';
            },
        });

        // Wallart hero rotation (minutes)
        this.register('settings.wallartMode.heroRotation', {
            name: 'Hero Rotation',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:rotate-3d-variant',
            unit: 'min',
            min: 1,
            max: 60,
            step: 1,
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    wallartMode: {
                        layoutSettings: {
                            heroGrid: {
                                heroRotationMinutes: parseInt(value),
                            },
                        },
                    },
                });
            },
            stateGetter: device => {
                // Check device override first (may be at either path for backward compat)
                if (
                    device.settingsOverride?.wallartMode?.layoutSettings?.heroGrid
                        ?.heroRotationMinutes !== undefined
                ) {
                    return device.settingsOverride.wallartMode.layoutSettings.heroGrid
                        .heroRotationMinutes;
                }
                if (device.settingsOverride?.wallartMode?.heroRotation !== undefined) {
                    return device.settingsOverride.wallartMode.heroRotation;
                }
                try {
                    const config = require('../config.json');
                    if (
                        config.wallartMode?.layoutSettings?.heroGrid?.heroRotationMinutes !==
                        undefined
                    ) {
                        return config.wallartMode.layoutSettings.heroGrid.heroRotationMinutes;
                    }
                } catch (_) {
                    // Config not available
                }
                return 8;
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { orientation: value },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'orientation', 'auto');
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
                await applyAndPersistSettings(deviceId, {
                    cinema: { header: { enabled: boolValue } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.enabled', true);
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { text: value === 'None' ? '' : value } },
                });
            },
            stateGetter: device => {
                const text = this.getCinemaSetting(device, 'header.text', 'Now Playing');
                return text === '' ? 'None' : text;
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { style: value } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.style', 'classic');
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
                await applyAndPersistSettings(deviceId, {
                    cinema: { ambilight: { enabled: boolValue } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'ambilight.enabled', true);
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { ambilight: { strength: parseInt(value) } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'ambilight.strength', 60);
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
                await applyAndPersistSettings(deviceId, {
                    cinema: { footer: { enabled: boolValue } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.enabled', true);
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { type: value } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.type', 'specs');
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { marqueeText: value === 'None' ? '' : value } },
                });
            },
            stateGetter: device => {
                const text = this.getCinemaSetting(
                    device,
                    'footer.marqueeText',
                    'Feature Presentation'
                );
                return text === '' ? 'None' : text;
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { marqueeStyle: value } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.marqueeStyle', 'classic');
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { specs: { style: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.specs.style', 'subtle');
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
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { specs: { iconSet: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.specs.iconSet', 'filled');
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
                await applyAndPersistSettings(deviceId, {
                    cinema: { footer: { specs: { showResolution: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.specs.showResolution', true);
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
                await applyAndPersistSettings(deviceId, {
                    cinema: { footer: { specs: { showAudio: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.specs.showAudio', true);
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
                await applyAndPersistSettings(deviceId, {
                    cinema: { footer: { specs: { showAspectRatio: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.specs.showAspectRatio', true);
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
                await applyAndPersistSettings(deviceId, {
                    cinema: { footer: { specs: { showFlags: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.specs.showFlags', false);
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
            stateGetter: device => {
                if (device.settingsOverride?.clockWidget !== undefined) {
                    return device.settingsOverride.clockWidget;
                }
                try {
                    const config = require('../config.json');
                    if (config.clockWidget !== undefined) {
                        return config.clockWidget;
                    }
                } catch (_) {
                    // Config not available
                }
                return true;
            },
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
            stateGetter: device => {
                if (device.settingsOverride?.showClearLogo !== undefined) {
                    return device.settingsOverride.showClearLogo;
                }
                try {
                    const config = require('../config.json');
                    if (config.showClearLogo !== undefined) {
                        return config.showClearLogo;
                    }
                } catch (_) {
                    // Config not available
                }
                return true;
            },
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
            stateGetter: device => {
                if (device.settingsOverride?.showMetadata !== undefined) {
                    return device.settingsOverride.showMetadata;
                }
                try {
                    const config = require('../config.json');
                    if (config.showMetadata !== undefined) {
                        return config.showMetadata;
                    }
                } catch (_) {
                    // Config not available
                }
                return true;
            },
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
            stateGetter: device => {
                if (device.settingsOverride?.showRottenTomatoes !== undefined) {
                    return device.settingsOverride.showRottenTomatoes;
                }
                try {
                    const config = require('../config.json');
                    if (config.showRottenTomatoes !== undefined) {
                        return config.showRottenTomatoes;
                    }
                } catch (_) {
                    // Config not available
                }
                return true;
            },
        });
    }
}

// Export singleton instance
const registry = new CapabilityRegistry();
module.exports = registry;
