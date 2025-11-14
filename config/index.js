const { validate } = require('./validate-env');

class Config {
    constructor() {
        this.config = require('../config.json');
        this.env = process.env;

        // Validate environment variables
        validate();

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
            httpDefault: 15000, // Default HTTP request timeout (Jellyfin, ROMM clients)
            httpHealthCheck: 5000, // Health check requests (TMDB, upstream servers)

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
        return this.getBool('DEBUG');
    }

    get logLevel() {
        return this.get('LOG_LEVEL') || this.defaults.logLevel;
    }

    // Media server settings
    get mediaServers() {
        return this.config.mediaServers || [];
    }

    get enabledMediaServers() {
        return this.mediaServers.filter(s => s.enabled);
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
