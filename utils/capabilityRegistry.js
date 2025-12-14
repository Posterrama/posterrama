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
            unitOfMeasurement: spec.unitOfMeasurement,
            deviceClass: spec.deviceClass,
            options: spec.options,
            optionsGetter: spec.optionsGetter,
            pattern: spec.pattern,
            affectsDiscovery: spec.affectsDiscovery === true,
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
                return wsHub.sendCommand(deviceId, { type: 'playback.pause', payload: {} });
            },
        });

        this.register('playback.resume', {
            name: 'Resume',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:play',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.resume', payload: {} });
            },
        });

        this.register('playback.next', {
            name: 'Next',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:skip-next',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.next', payload: {} });
            },
        });

        this.register('playback.previous', {
            name: 'Previous',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:skip-previous',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.previous', payload: {} });
            },
        });

        this.register('playback.toggle', {
            name: 'Play/Pause Toggle',
            category: 'playback',
            entityType: 'button',
            icon: 'mdi:play-pause',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'playback.toggle', payload: {} });
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
                return wsHub.sendCommand(deviceId, { type, payload: {} });
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
            availableWhen: device => {
                return device.currentState?.poweredOff === true;
            },
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'power.on', payload: {} });
            },
        });

        this.register('power.off', {
            name: 'Power Off',
            category: 'power',
            entityType: 'button',
            icon: 'mdi:power-off',
            availableWhen: device => {
                return device.currentState?.poweredOff !== true;
            },
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'power.off', payload: {} });
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
                return wsHub.sendCommand(deviceId, { type: 'playback.pin', payload: {} });
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
                return wsHub.sendCommand(deviceId, { type: 'playback.unpin', payload: {} });
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
                return wsHub.sendCommand(deviceId, { type: 'core.mgmt.reload', payload: {} });
            },
        });

        this.register('mgmt.reset', {
            name: 'Reset',
            category: 'management',
            entityType: 'button',
            icon: 'mdi:restore',
            commandHandler: deviceId => {
                return wsHub.sendCommand(deviceId, { type: 'core.mgmt.reset', payload: {} });
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

        const deprecated = () => false;

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
            const mergedOverride = this.deepMergeSettings(currentOverride, settingsUpdate);

            // Persist to devices.json
            await deviceStore.patchDevice(deviceId, {
                settingsOverride: mergedOverride,
            });

            // Send to device via WebSocket
            await wsHub.sendApplySettings(deviceId, settingsUpdate);
        };

        const deletePath = (obj, dottedPath) => {
            if (!obj || typeof obj !== 'object') return;
            const parts = String(dottedPath || '')
                .split('.')
                .filter(Boolean);
            if (!parts.length) return;
            let cur = obj;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!cur || typeof cur !== 'object') return;
                cur = cur[parts[i]];
            }
            if (cur && typeof cur === 'object') {
                delete cur[parts[parts.length - 1]];
            }
        };

        const cleanupEmpty = obj => {
            if (!obj || typeof obj !== 'object') return;
            for (const key of Object.keys(obj)) {
                const v = obj[key];
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    cleanupEmpty(v);
                    if (Object.keys(v).length === 0) delete obj[key];
                }
            }
        };

        const applyAndPersistSettingsWithDeletes = async (
            deviceId,
            settingsUpdate,
            deletePaths
        ) => {
            const device = await deviceStore.getById(deviceId);
            if (!device) {
                throw new Error(`Device not found: ${deviceId}`);
            }

            const currentOverride = device.settingsOverride || {};
            const nextOverride = this.deepMergeSettings(currentOverride, settingsUpdate || {});

            (Array.isArray(deletePaths) ? deletePaths : []).forEach(p =>
                deletePath(nextOverride, p)
            );
            cleanupEmpty(nextOverride);

            await deviceStore.patchDevice(deviceId, { settingsOverride: nextOverride });

            // Apply the settings update immediately.
            await wsHub.sendApplySettings(deviceId, settingsUpdate || {});

            // When deletions happen, force a reload so the client re-resolves effective config.
            if (Array.isArray(deletePaths) && deletePaths.length) {
                await wsHub.sendCommand(deviceId, { type: 'core.mgmt.reload', payload: {} });
            }
        };

        const getCinemaTextPresets = (kind, device) => {
            const SYSTEM_TEXT_PRESETS = [
                'Now Playing',
                'Coming Soon',
                'Certified Fresh',
                'Late Night Feature',
                'Weekend Matinee',
                'New Arrival',
                '4K Ultra HD',
                'Home Cinema',
                'Feature Presentation',
            ];
            try {
                const config = require('../config');
                const headerList = config?.config?.cinema?.presets?.headerTexts;
                const footerList = config?.config?.cinema?.presets?.footerTexts;
                const headerRaw = Array.isArray(headerList) ? headerList : [];
                const footerRaw = Array.isArray(footerList) ? footerList : [];
                const merged = [...SYSTEM_TEXT_PRESETS, ...headerRaw, ...footerRaw];
                const options = Array.from(
                    new Set(merged.map(v => (v == null ? '' : String(v)).trim()).filter(Boolean))
                );

                // Ensure current value remains selectable even if presets drift.
                const current =
                    kind === 'footer'
                        ? String(
                              this.getCinemaSetting(device, 'footer.marqueeText', '') || ''
                          ).trim()
                        : String(this.getCinemaSetting(device, 'header.text', '') || '').trim();
                if (current && !options.includes(current)) {
                    options.unshift(current);
                }

                return options;
            } catch (_) {
                return SYSTEM_TEXT_PRESETS;
            }
        };

        /**
         * Deep merge settings objects (handles nested objects like uiScaling, wallartMode, cinema)
         */
        this.deepMergeSettings = (target, source) => {
            const result = { ...target };
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this.deepMergeSettings(result[key] || {}, source[key]);
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
            name: 'Global Scale',
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

        // UI Scaling - Clearlogo (screensaver only)
        this.register('settings.uiScaling.clearlogo', {
            name: 'Clearlogo Scale',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:image-size-select-actual',
            unit: '%',
            min: 50,
            max: 200,
            step: 10,
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    uiScaling: { clearlogo: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.uiScaling?.clearlogo !== undefined) {
                    return device.settingsOverride.uiScaling.clearlogo;
                }
                try {
                    const config = require('../config.json');
                    if (config.uiScaling?.clearlogo !== undefined) {
                        return config.uiScaling.clearlogo;
                    }
                } catch (_) {
                    // Config not available
                }
                return 100;
            },
        });

        // UI Scaling - Clock (screensaver only)
        this.register('settings.uiScaling.clock', {
            name: 'Clock Scale',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:clock-outline',
            unit: '%',
            min: 50,
            max: 200,
            step: 10,
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    uiScaling: { clock: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.uiScaling?.clock !== undefined) {
                    return device.settingsOverride.uiScaling.clock;
                }
                try {
                    const config = require('../config.json');
                    if (config.uiScaling?.clock !== undefined) {
                        return config.uiScaling.clock;
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
            // Deprecated legacy capability (schema now uses wallartMode.refreshRate 1-10)
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });

        // Wallart refresh rate (relative tempo)
        this.register('settings.wallartMode.refreshRate', {
            name: 'Refresh Rate',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:timer-outline',
            min: 1,
            max: 10,
            step: 1,
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { refreshRate: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.refreshRate !== undefined) {
                    return device.settingsOverride.wallartMode.refreshRate;
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
            // Deprecated legacy capability (schema now uses wallartMode.randomness 0-10)
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });

        // Wallart randomness (0-10)
        this.register('settings.wallartMode.randomness', {
            name: 'Randomness',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:dice-multiple',
            min: 0,
            max: 10,
            step: 1,
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { randomness: parseInt(value) },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.randomness !== undefined) {
                    return device.settingsOverride.wallartMode.randomness;
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
                'random',
                'fade',
                'slideLeft',
                'slideUp',
                'zoom',
                'flip',
                'staggered',
                'ripple',
                'scanline',
                'parallax',
                'parallaxDepth',
                'neonPulse',
                'chromaticShift',
                'mosaicShatter',
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
            // Deprecated legacy capability (schema uses wallartMode.ambientGradient)
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });

        // Wallart ambient gradient
        this.register('settings.wallartMode.ambientGradient', {
            name: 'Ambient Gradient',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:gradient-horizontal',
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { ambientGradient: boolValue },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.ambientGradient !== undefined) {
                    return device.settingsOverride.wallartMode.ambientGradient;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.ambientGradient !== undefined) {
                        return config.wallartMode.ambientGradient;
                    }
                } catch (_) {
                    // Config not available
                }
                return true;
            },
        });

        // Wallart orientation
        this.register('settings.wallartMode.orientation', {
            name: 'Orientation',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:phone-rotate-portrait',
            options: ['auto', 'portrait', 'landscape', 'portrait-flipped', 'landscape-flipped'],
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { orientation: value },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.orientation !== undefined) {
                    return device.settingsOverride.wallartMode.orientation;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.orientation !== undefined) {
                        return config.wallartMode.orientation;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'auto';
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
            options: ['classic', 'hero-grid', 'film-cards'],
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                // Convert kebab-case to camelCase for internal use
                const layoutVariant =
                    value === 'hero-grid'
                        ? 'heroGrid'
                        : value === 'film-cards'
                          ? 'filmCards'
                          : value;
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { layoutVariant },
                });
            },
            stateGetter: device => {
                // Check device override - support both old 'layout' and new 'layoutVariant'
                if (device.settingsOverride?.wallartMode?.layoutVariant !== undefined) {
                    const variant = device.settingsOverride.wallartMode.layoutVariant;
                    return variant === 'heroGrid'
                        ? 'hero-grid'
                        : variant === 'filmCards'
                          ? 'film-cards'
                          : variant;
                }
                if (device.settingsOverride?.wallartMode?.layout !== undefined) {
                    return device.settingsOverride.wallartMode.layout;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.layoutVariant !== undefined) {
                        // Convert camelCase to kebab-case
                        return config.wallartMode.layoutVariant === 'heroGrid'
                            ? 'hero-grid'
                            : config.wallartMode.layoutVariant === 'filmCards'
                              ? 'film-cards'
                              : config.wallartMode.layoutVariant;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'classic';
            },
        });

        // Wallart games-only
        this.register('settings.wallartMode.gamesOnly', {
            name: 'Games Only',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:controller-classic',
            availableWhen: device => this.getDeviceMode(device) === 'wallart',
            commandHandler: (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                return applyAndPersistSettings(deviceId, {
                    wallartMode: { gamesOnly: boolValue },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.wallartMode?.gamesOnly !== undefined) {
                    return device.settingsOverride.wallartMode.gamesOnly;
                }
                try {
                    const config = require('../config.json');
                    if (config.wallartMode?.gamesOnly !== undefined) {
                        return config.wallartMode.gamesOnly;
                    }
                } catch (_) {
                    // Config not available
                }
                return false;
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
            options: ['auto', 'portrait', 'portrait-flipped', 'landscape', 'landscape-flipped'],
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

        // Screensaver orientation
        this.register('settings.screensaverMode.orientation', {
            name: 'Orientation',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:phone-rotate-portrait',
            options: ['auto', 'portrait', 'landscape', 'portrait-flipped', 'landscape-flipped'],
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    screensaverMode: { orientation: value },
                });
            },
            stateGetter: device => {
                if (device.settingsOverride?.screensaverMode?.orientation !== undefined) {
                    return device.settingsOverride.screensaverMode.orientation;
                }
                try {
                    const config = require('../config.json');
                    if (config.screensaverMode?.orientation !== undefined) {
                        return config.screensaverMode.orientation;
                    }
                } catch (_) {
                    // Config not available
                }
                return 'auto';
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
            optionsGetter: device => getCinemaTextPresets('header', device),
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { text: String(value || '').trim() } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.text', 'Now Playing');
            },
        });

        // Cinema header style (deprecated - modern schema uses header.typography.*)
        this.register('settings.cinema.header.style', {
            name: 'Header Marquee Style',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:palette',
            options: ['classic', 'neon', 'minimal', 'theatre'],
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });

        // Cinema header typography
        this.register('settings.cinema.header.typography.fontFamily', {
            name: 'Header Font Family',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-font',
            options: [
                'system',
                'cinematic',
                'classic',
                'modern',
                'elegant',
                'marquee',
                'retro',
                'neon',
                'scifi',
                'poster',
                'epic',
                'bold',
            ],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { fontFamily: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.fontFamily', 'cinematic');
            },
        });

        this.register('settings.cinema.header.typography.fontSize', {
            name: 'Header Font Size',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:format-size',
            unit: '%',
            min: 50,
            max: 200,
            step: 5,
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { fontSize: parseInt(value) } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.fontSize', 100);
            },
        });

        this.register('settings.cinema.header.typography.tonSurTon', {
            name: 'Header Auto Color (Ton-sur-ton)',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:invert-colors',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { tonSurTon: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.tonSurTon', false);
            },
        });

        this.register('settings.cinema.header.typography.tonSurTonIntensity', {
            name: 'Header Auto Color Intensity',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:contrast-circle',
            unit: '%',
            min: 10,
            max: 100,
            step: 5,
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { tonSurTonIntensity: parseInt(value) } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.tonSurTonIntensity', 45);
            },
        });

        this.register('settings.cinema.header.typography.color', {
            name: 'Header Text Color',
            category: 'settings',
            entityType: 'text',
            icon: 'mdi:palette',
            pattern: '^#[0-9A-Fa-f]{6}$',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { color: String(value || '').trim() } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.color', '#ffffff');
            },
        });

        this.register('settings.cinema.header.typography.shadow', {
            name: 'Header Shadow',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-color-text',
            options: ['none', 'subtle', 'dramatic', 'neon', 'glow'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { shadow: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.shadow', 'subtle');
            },
        });

        this.register('settings.cinema.header.typography.textEffect', {
            name: 'Header Text Effect',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-color-fill',
            options: [
                'none',
                'gradient',
                'gradient-rainbow',
                'gradient-gold',
                'gradient-silver',
                'outline',
                'outline-thick',
                'outline-double',
                'metallic',
                'chrome',
                'gold-metallic',
                'vintage',
                'retro',
                'fire',
                'ice',
                'pulse',
                'marquee',
            ],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { textEffect: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.textEffect', 'none');
            },
        });

        this.register('settings.cinema.header.typography.entranceAnimation', {
            name: 'Header Entrance Animation',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:animation',
            options: [
                'none',
                'typewriter',
                'fade-words',
                'slide-left',
                'slide-right',
                'slide-top',
                'slide-bottom',
                'zoom',
                'zoom-bounce',
                'blur-focus',
                'float',
                'letter-spread',
                'rotate-3d',
                'flip',
                'drop',
                'fade',
                'cinematic',
            ],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { entranceAnimation: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.entranceAnimation', 'none');
            },
        });

        this.register('settings.cinema.header.typography.decoration', {
            name: 'Header Decoration',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-underline',
            options: ['none', 'frame', 'underline'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { header: { typography: { decoration: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'header.typography.decoration', 'none');
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
            options: ['marquee', 'metadata', 'tagline'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { type: value } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.type', 'metadata');
            },
        });

        // Cinema footer tagline marquee
        this.register('settings.cinema.footer.taglineMarquee', {
            name: 'Footer Tagline Marquee',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:format-text-wrapping-wrap',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await applyAndPersistSettings(deviceId, {
                    cinema: { footer: { taglineMarquee: boolValue } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.taglineMarquee', false);
            },
        });

        // Cinema footer marquee text
        this.register('settings.cinema.footer.marqueeText', {
            name: 'Cinema Footer Text',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-text',
            optionsGetter: device => getCinemaTextPresets('footer', device),
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { marqueeText: String(value || '').trim() } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.marqueeText', 'Feature Presentation');
            },
        });

        // === Display Settings Override Modal parity (Cinema Now Playing + pin) ===
        this.register('settings.cinema.nowPlaying.priority', {
            name: 'Now Playing Priority',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:user-lock',
            options: ['global', 'first', 'random', 'user'],
            affectsDiscovery: true,
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const v = String(value || '').trim();
                if (!v || v === 'global') {
                    // Remove override keys so device inherits global config
                    await applyAndPersistSettingsWithDeletes(
                        deviceId,
                        { cinema: { nowPlaying: {} } },
                        ['cinema.nowPlaying.priority', 'cinema.nowPlaying.filterUser']
                    );
                    return true;
                }

                await applyAndPersistSettings(deviceId, {
                    cinema: { nowPlaying: { priority: v } },
                });
                return true;
            },
            stateGetter: device => {
                const p = this.getCinemaSetting(device, 'nowPlaying.priority', null);
                return p ? String(p) : 'global';
            },
        });

        this.register('settings.cinema.nowPlaying.filterUser', {
            name: 'Now Playing User',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:account',
            affectsDiscovery: true,
            optionsGetter: device => {
                const selected = String(
                    this.getCinemaSetting(device, 'nowPlaying.filterUser', '') || ''
                ).trim();
                const users = [];

                try {
                    const cached = global.__posterramaPlexUsersCache;
                    if (Array.isArray(cached)) {
                        cached.forEach(u => {
                            const username = u?.username || u?.title || u?.name;
                            if (username) users.push(String(username).trim());
                        });
                    }
                } catch (_) {
                    /* ignore */
                }

                try {
                    const poller = global.__posterramaSessionsPoller;
                    const sessions = poller?.getSessions?.()?.sessions || [];
                    sessions.forEach(s => {
                        const u = s?.User?.title || s?.username;
                        if (u) users.push(String(u).trim());
                    });
                } catch (_) {
                    /* ignore */
                }
                const uniq = Array.from(new Set(users.filter(Boolean))).sort((a, b) =>
                    a.localeCompare(b)
                );
                const list = selected && !uniq.includes(selected) ? [selected, ...uniq] : uniq;
                return list.length ? list : selected ? [selected] : [''];
            },
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const user = String(value || '').trim();
                if (!user) {
                    await applyAndPersistSettingsWithDeletes(
                        deviceId,
                        { cinema: { nowPlaying: {} } },
                        ['cinema.nowPlaying.filterUser']
                    );
                    return true;
                }
                await applyAndPersistSettings(deviceId, {
                    cinema: { nowPlaying: { filterUser: user } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'nowPlaying.filterUser', '') || '';
            },
        });

        this.register('settings.cinema.nowPlaying.sourcePreference', {
            name: 'Now Playing Source Preference',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:database-search',
            options: ['auto', 'plex', 'jellyfin'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                const v = String(value || '').trim() || 'auto';
                return applyAndPersistSettings(deviceId, {
                    cinema: { nowPlaying: { sourcePreference: v } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'nowPlaying.sourcePreference', 'auto');
            },
        });

        this.register('settings.cinema.pinnedMediaKey', {
            name: 'Pinned Media Key',
            category: 'settings',
            entityType: 'text',
            icon: 'mdi:pin',
            pattern: '.*',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const key = String(value || '').trim();
                if (!key) {
                    await applyAndPersistSettingsWithDeletes(deviceId, { cinema: {} }, [
                        'cinema.pinnedMediaKey',
                    ]);
                    return true;
                }
                await applyAndPersistSettings(deviceId, {
                    cinema: { pinnedMediaKey: key },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'pinnedMediaKey', '') || '';
            },
        });

        this.register('settings.cinema.pinnedMediaKey.clear', {
            name: 'Clear Pinned Media',
            category: 'settings',
            entityType: 'button',
            icon: 'mdi:pin-off',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async deviceId => {
                await applyAndPersistSettingsWithDeletes(deviceId, { cinema: {} }, [
                    'cinema.pinnedMediaKey',
                ]);
                return true;
            },
        });

        // Cinema footer marquee style (deprecated - modern schema uses footer.typography.*)
        this.register('settings.cinema.footer.marqueeStyle', {
            name: 'Cinema Footer Style',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:palette',
            options: ['classic', 'neon', 'minimal', 'theatre'],
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });

        // Deprecated legacy Cinema footer specs capabilities (replaced by cinema.metadata.specs.*)
        this.register('settings.cinema.footer.specs.style', {
            name: 'Cinema Footer Icons',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:shape',
            options: ['subtle', 'filled', 'outline'],
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });
        this.register('settings.cinema.footer.specs.iconSet', {
            name: 'Cinema Footer Icon Set',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:image-filter-none',
            options: ['filled', 'line'],
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });
        this.register('settings.cinema.footer.specs.showResolution', {
            name: 'Show Resolution',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:monitor',
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });
        this.register('settings.cinema.footer.specs.showAudio', {
            name: 'Show Audio',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:speaker',
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });
        this.register('settings.cinema.footer.specs.showAspectRatio', {
            name: 'Show Aspect Ratio',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:aspect-ratio',
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });
        this.register('settings.cinema.footer.specs.showFlags', {
            name: 'Show Flags',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:flag',
            availableWhen: deprecated,
            commandHandler: () => Promise.resolve(),
        });

        // Cinema metadata specs (modern)
        this.register('settings.cinema.metadata.specs.style', {
            name: 'Specs Style',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:shape',
            options: ['dark-glass', 'glass', 'icons-only', 'icons-text'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { metadata: { specs: { style: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'metadata.specs.style', 'icons-text');
            },
        });

        this.register('settings.cinema.metadata.specs.iconSet', {
            name: 'Specs Icon Set',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:image-filter-none',
            options: ['tabler', 'material'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { metadata: { specs: { iconSet: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'metadata.specs.iconSet', 'tabler');
            },
        });

        this.register('settings.cinema.metadata.specs.showResolution', {
            name: 'Show Resolution',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:monitor',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await applyAndPersistSettings(deviceId, {
                    cinema: { metadata: { specs: { showResolution: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'metadata.specs.showResolution', true);
            },
        });

        this.register('settings.cinema.metadata.specs.showAudio', {
            name: 'Show Audio',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:speaker',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await applyAndPersistSettings(deviceId, {
                    cinema: { metadata: { specs: { showAudio: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'metadata.specs.showAudio', true);
            },
        });

        this.register('settings.cinema.metadata.specs.showAspectRatio', {
            name: 'Show Aspect Ratio',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:aspect-ratio',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await applyAndPersistSettings(deviceId, {
                    cinema: { metadata: { specs: { showAspectRatio: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'metadata.specs.showAspectRatio', false);
            },
        });

        this.register('settings.cinema.metadata.specs.showHDR', {
            name: 'Show HDR',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:hdr',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await applyAndPersistSettings(deviceId, {
                    cinema: { metadata: { specs: { showHDR: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'metadata.specs.showHDR', true);
            },
        });

        // Cinema footer typography
        this.register('settings.cinema.footer.typography.fontFamily', {
            name: 'Footer Font Family',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-font',
            options: [
                'system',
                'cinematic',
                'classic',
                'modern',
                'elegant',
                'marquee',
                'retro',
                'neon',
                'scifi',
                'poster',
                'epic',
                'bold',
            ],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { typography: { fontFamily: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.typography.fontFamily', 'system');
            },
        });

        this.register('settings.cinema.footer.typography.fontSize', {
            name: 'Footer Font Size',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:format-size',
            unit: '%',
            min: 50,
            max: 200,
            step: 5,
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { typography: { fontSize: parseInt(value) } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.typography.fontSize', 100);
            },
        });

        this.register('settings.cinema.footer.typography.tonSurTon', {
            name: 'Footer Auto Color (Ton-sur-ton)',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:invert-colors',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: async (deviceId, value) => {
                const boolValue = value === true || value === 'ON' || value === 1;
                await applyAndPersistSettings(deviceId, {
                    cinema: { footer: { typography: { tonSurTon: boolValue } } },
                });
                return true;
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.typography.tonSurTon', false);
            },
        });

        this.register('settings.cinema.footer.typography.tonSurTonIntensity', {
            name: 'Footer Auto Color Intensity',
            category: 'settings',
            entityType: 'number',
            icon: 'mdi:contrast-circle',
            unit: '%',
            min: 10,
            max: 100,
            step: 5,
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { typography: { tonSurTonIntensity: parseInt(value) } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.typography.tonSurTonIntensity', 45);
            },
        });

        this.register('settings.cinema.footer.typography.color', {
            name: 'Footer Text Color',
            category: 'settings',
            entityType: 'text',
            icon: 'mdi:palette',
            pattern: '^#[0-9A-Fa-f]{6}$',
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { typography: { color: String(value || '').trim() } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.typography.color', '#cccccc');
            },
        });

        this.register('settings.cinema.footer.typography.shadow', {
            name: 'Footer Shadow',
            category: 'settings',
            entityType: 'select',
            icon: 'mdi:format-color-text',
            options: ['none', 'subtle', 'dramatic'],
            availableWhen: device => this.getDeviceMode(device) === 'cinema',
            commandHandler: (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
                    cinema: { footer: { typography: { shadow: value } } },
                });
            },
            stateGetter: device => {
                return this.getCinemaSetting(device, 'footer.typography.shadow', 'none');
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
            stateGetter: device => {
                const raw =
                    device.currentState?.runtime ??
                    device.currentState?.runtimeMs ??
                    device.currentState?.duration ??
                    null;
                if (raw == null) return null;
                const num = typeof raw === 'number' ? raw : Number(raw);
                if (!Number.isFinite(num) || num <= 0) return null;

                // Heuristic: values > 1000 are almost certainly milliseconds
                if (num > 1000) return Math.round(num / 60000);

                // Otherwise assume minutes
                return Math.round(num);
            },
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
                if (lastSeen && (now.getTime() - lastSeen.getTime()) / 1000 < 60) return 'online';
                return 'offline';
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
        // Local deepMerge helper for settings
        const deepMerge = (target, source) => {
            const result = { ...target };
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = deepMerge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        };

        const applyAndPersistSettings = async (deviceId, settings) => {
            const deviceStore = require('./deviceStore');
            const wsHub = require('./wsHub');

            try {
                // Get all devices and find ours
                const allDevices = await deviceStore.getAll();
                const device = allDevices.find(d => d.id === deviceId);

                if (!device) {
                    console.error('[applyAndPersistSettings] Device not found:', deviceId);
                    throw new Error(`Device ${deviceId} not found`);
                }

                // Deep merge settings into device override
                const currentOverride = device.settingsOverride || {};
                const updatedOverride = deepMerge(currentOverride, settings);

                // Persist to devices.json using patchDevice
                await deviceStore.patchDevice(deviceId, {
                    settingsOverride: updatedOverride,
                });

                // Then send WebSocket message to apply immediately
                await wsHub.sendApplySettings(deviceId, settings);

                // Small delay to ensure state is fully persisted before HA queries it
                const timeoutConfig = require('../config/');
                await new Promise(resolve =>
                    setTimeout(resolve, timeoutConfig.getTimeout('deviceStateSync'))
                );

                return true;
            } catch (error) {
                console.error('[applyAndPersistSettings] Error:', error);
                throw error;
            }
        };

        // Show Clock - only for screensaver mode
        this.register('settings.showClock', {
            name: 'Show Clock',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:clock-outline',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: async (deviceId, value) => {
                const result = await applyAndPersistSettings(deviceId, {
                    clockWidget: value === 'ON',
                });

                return result;
            },
            stateGetter: device => {
                const state =
                    device.settingsOverride?.clockWidget !== undefined
                        ? device.settingsOverride.clockWidget
                        : (() => {
                              try {
                                  const config = require('../config.json');
                                  return config.clockWidget !== undefined
                                      ? config.clockWidget
                                      : true;
                              } catch (_) {
                                  return true;
                              }
                          })();
                return state;
            },
        });

        // Show Clearlogo - only for screensaver mode
        this.register('settings.showLogo', {
            name: 'Show Clearlogo',
            category: 'settings',
            entityType: 'switch',
            icon: 'mdi:image-area',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: async (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
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
                return applyAndPersistSettings(deviceId, {
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
            icon: 'mdi:star-circle',
            availableWhen: device => this.getDeviceMode(device) === 'screensaver',
            commandHandler: async (deviceId, value) => {
                return applyAndPersistSettings(deviceId, {
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
