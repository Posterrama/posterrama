const { validate } = require('./validate-env');

class Config {
    constructor() {
        // Set env first to avoid circular dependency issues
        this.env = process.env;

        // Validate environment variables
        validate();

        // Then load config
        this.loadConfig();

        // Set default values
        this.defaults = {
            serverPort: 4000,
            logLevel: 'info',
            backgroundRefreshMinutes: 60,
            maxLogLines: 200,
        };

        // Timeout constants (in milliseconds)
        this.timeouts = {
            // HTTP client timeouts
            httpDefault: 30000, // Default HTTP request timeout (Jellyfin, ROMM clients) - increased for large libraries
            httpHealthCheck: 5000, // Health check requests (TMDB, upstream servers)

            // External API timeouts (Issue #3 fix: standardized configuration)
            externalApiBase: 30000, // Base timeout for all external API calls - increased for large libraries
            externalApiPlex: 15000, // Plex API timeout
            externalApiJellyfin: 30000, // Jellyfin API timeout - increased for VirtualFolders + count fetching
            externalApiTmdb: 10000, // TMDB API timeout (usually faster)
            externalApiRomm: 15000, // ROMM API timeout
            externalApiTestConnection: 8000, // Connection test timeout
            externalApiQuickTest: 5000, // Quick test timeout
            externalApiMaxRetries: 2, // Max retry attempts for external APIs
            externalApiRetryDelay: 1000, // Base delay between retries (ms)

            // WebSocket timeouts
            wsCommandAck: 3000, // WebSocket command acknowledgement timeout
            wsCommandAckMin: 500, // Minimum enforced WebSocket ack timeout

            // Process management
            processGracefulShutdown: 250, // Delay before process.exit() for cleanup
            serviceStop: 2000, // Wait for PM2 services to stop gracefully
            serviceStart: 3000, // Wait for PM2 services to start
            serviceStartRace: 5000, // Max wait for service start before continuing

            // Job queue
            jobQueueNext: 100, // Delay before processing next queued job

            // MQTT/Device management
            mqttRepublish: 500, // Wait before republishing MQTT discovery
            deviceStateSync: 100, // Wait for device state persistence
        };
    }

    /**
     * Load or reload config.json, bypassing Node's require cache
     */
    loadConfig() {
        const configPath = require.resolve('../config.json');
        delete require.cache[configPath];
        this.config = require('../config.json');

        // Validate config against schema at runtime
        this.validateConfig();

        // CRITICAL FIX: Copy all config.json properties to private backing fields
        // This ensures config.wallartMode, config.mediaServers etc. work correctly
        // without needing to access config.config.xxx
        if (this.config && typeof this.config === 'object') {
            // Store direct references to avoid double-nesting issues
            this._wallartMode = this.config.wallartMode;
            this._cinemaMode = this.config.cinemaMode;
            this._cinemaOrientation = this.config.cinemaOrientation;
            this._cinema = this.config.cinema;
            this._mediaServers = this.config.mediaServers;
            this._localDirectory = this.config.localDirectory;
            this._tmdbSource = this.config.tmdbSource;
            this._streamingSources = this.config.streamingSources;
            this._mqtt = this.config.mqtt;
            this._clientDebugViewer = this.config.clientDebugViewer;
            this._siteServer = this.config.siteServer;
            this._burnInPrevention = this.config.burnInPrevention;
            this._pauseIndicator = this.config.pauseIndicator;
        }
    }

    /**
     * Validate config.json against schema at runtime
     * Logs warnings for validation errors but doesn't block startup
     */
    validateConfig() {
        try {
            const Ajv = require('ajv');
            const schema = require('../config.schema.json');
            // @ts-ignore - Ajv constructor is valid but TypeScript doesn't recognize it from require()
            const ajv = new Ajv({
                allErrors: true,
                allowUnionTypes: true,
                strict: false, // Disable strict mode to allow union types without warnings
            });
            const validate = ajv.compile(schema);
            const valid = validate(this.config);

            if (!valid) {
                console.warn('⚠️  Config validation warnings:');
                validate.errors.forEach(err => {
                    const path = err.instancePath || 'root';
                    const msg = err.message || 'validation error';
                    console.warn(`   ${path}: ${msg}`);
                    if (err.params?.allowedValues) {
                        console.warn(`   Allowed: ${err.params.allowedValues.join(', ')}`);
                    }
                });
                console.warn('   Run "npm run config:validate" for details');
            }
        } catch (err) {
            // Don't crash if validation fails - just log warning
            console.warn('⚠️  Could not validate config:', err.message);
        }
    }

    /**
     * Reload configuration from disk (for runtime updates)
     */
    reload() {
        this.loadConfig();
        this.env = process.env;
    }

    get(key) {
        return this.env[key] || this.config[key] || this.defaults[key];
    }

    getInt(key) {
        const value = this.get(key);
        return value ? parseInt(value, 10) : null;
    }

    getBool(key) {
        const value = this.get(key);
        return value === 'true' || value === true;
    }

    // Server settings
    get port() {
        return this.getInt('SERVER_PORT') || this.defaults.serverPort;
    }

    get isDebug() {
        // Default to true for better diagnostics
        const value = this.get('DEBUG');
        return value === undefined || value === null ? true : this.getBool('DEBUG');
    }

    get logLevel() {
        return this.get('LOG_LEVEL') || this.defaults.logLevel;
    }

    // Media server settings
    get mediaServers() {
        // Check both direct property (from proxy) and config object
        return this._mediaServers || this.config?.mediaServers || [];
    }
    set mediaServers(value) {
        this._mediaServers = value;
        if (this.config) this.config.mediaServers = value;
    }

    get enabledMediaServers() {
        return this.mediaServers.filter(s => s.enabled);
    }

    // Local directory settings
    get localDirectory() {
        return this._localDirectory || this.config?.localDirectory || null;
    }
    set localDirectory(value) {
        this._localDirectory = value;
        if (this.config) this.config.localDirectory = value;
    }

    // TMDB settings
    get tmdbSource() {
        return this._tmdbSource || this.config?.tmdbSource || null;
    }
    set tmdbSource(value) {
        this._tmdbSource = value;
        if (this.config) this.config.tmdbSource = value;
    }

    // Streaming sources
    get streamingSources() {
        return this._streamingSources || this.config?.streamingSources || [];
    }
    set streamingSources(value) {
        this._streamingSources = value;
        if (this.config) this.config.streamingSources = value;
    }

    // MQTT settings
    get mqtt() {
        return this._mqtt || this.config?.mqtt || null;
    }
    set mqtt(value) {
        this._mqtt = value;
        if (this.config) this.config.mqtt = value;
    }

    // Site server settings
    get siteServer() {
        return this._siteServer || this.config?.siteServer || null;
    }
    set siteServer(value) {
        this._siteServer = value;
        if (this.config) this.config.siteServer = value;
    }

    // Wallart mode settings
    get wallartMode() {
        return this._wallartMode || this.config?.wallartMode || { enabled: false };
    }
    set wallartMode(value) {
        this._wallartMode = value;
        if (this.config) this.config.wallartMode = value;
    }

    // Cinema mode settings
    get cinemaMode() {
        return this._cinemaMode !== undefined ? this._cinemaMode : this.config?.cinemaMode || false;
    }
    set cinemaMode(value) {
        this._cinemaMode = value;
        if (this.config) this.config.cinemaMode = value;
    }

    // Cinema orientation
    get cinemaOrientation() {
        return this._cinemaOrientation || this.config?.cinemaOrientation || 'auto';
    }
    set cinemaOrientation(value) {
        this._cinemaOrientation = value;
        if (this.config) this.config.cinemaOrientation = value;
    }

    // Cinema config object
    get cinema() {
        return this._cinema || this.config?.cinema || {};
    }
    set cinema(value) {
        this._cinema = value;
        if (this.config) this.config.cinema = value;
    }

    // Client debug viewer settings
    get clientDebugViewer() {
        return this._clientDebugViewer || this.config?.clientDebugViewer || { enabled: false };
    }
    set clientDebugViewer(value) {
        this._clientDebugViewer = value;
        if (this.config) this.config.clientDebugViewer = value;
    }

    // Burn-in prevention settings for OLED/Plasma displays
    get burnInPrevention() {
        return this._burnInPrevention || this.config?.burnInPrevention || null;
    }
    set burnInPrevention(value) {
        this._burnInPrevention = value;
        if (this.config) this.config.burnInPrevention = value;
    }

    // Pause indicator settings (shown when playback is paused)
    get pauseIndicator() {
        return this._pauseIndicator || this.config?.pauseIndicator || { enabled: true };
    }
    set pauseIndicator(value) {
        this._pauseIndicator = value;
        if (this.config) this.config.pauseIndicator = value;
    }

    // Security settings
    get sessionSecret() {
        return this.get('SESSION_SECRET');
    }

    get adminUsername() {
        return this.get('ADMIN_USERNAME');
    }

    get adminPasswordHash() {
        return this.get('ADMIN_PASSWORD_HASH');
    }

    get admin2FASecret() {
        return this.get('ADMIN_2FA_SECRET');
    }

    // Timeout getters
    getTimeout(key) {
        // Allow environment override: TIMEOUT_<KEY_UPPER>=value
        const envKey = `TIMEOUT_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
        const envValue = this.getInt(envKey);
        return envValue || this.timeouts[key];
    }
}

module.exports = new Config();
