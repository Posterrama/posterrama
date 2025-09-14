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
}

module.exports = new Config();
