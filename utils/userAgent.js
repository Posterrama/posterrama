/**
 * Centralized User-Agent Builder for HTTP Clients
 *
 * Provides consistent User-Agent headers across all external API clients
 * for better tracking, debugging, and API usage analytics.
 *
 * Format: Posterrama/VERSION (SERVICE) Node.js/VERSION platform/release [Host/HOSTNAME]
 *
 * @module utils/userAgent
 */

const os = require('os');
const pkg = require('../package.json');

/**
 * User-Agent builder class
 */
class UserAgentBuilder {
    /**
     * Build a User-Agent string with customizable components
     *
     * @param {string} [service='default'] - Service identifier (e.g., 'Plex-Client')
     * @param {Object} [options={}] - Configuration options
     * @param {boolean} [options.includeHostname=false] - Include hostname in UA
     * @param {boolean} [options.includeNodeVersion=true] - Include Node.js version
     * @param {boolean} [options.includeOS=true] - Include OS platform/release
     * @returns {string} Formatted User-Agent string
     *
     * @example
     * UserAgentBuilder.build('Plex-Client', { includeHostname: true });
     * // Returns: "Posterrama/2.9.4 (Plex-Client) Node.js/18.20.0 linux/5.15.0 Host/media-server"
     */
    static build(service = 'default', options = {}) {
        const {
            includeHostname = false,
            includeNodeVersion = true,
            includeOS = true,
        } = options || {};

        // Base: Posterrama/VERSION
        const parts = [`Posterrama/${pkg.version}`];

        // Service identifier
        if (service !== 'default') {
            parts.push(`(${service})`);
        }

        // Node.js version
        if (includeNodeVersion) {
            parts.push(`Node.js/${process.version}`);
        }

        // Operating system
        if (includeOS) {
            parts.push(`${os.platform()}/${os.release()}`);
        }

        // Hostname (useful for multi-instance deployments)
        if (includeHostname) {
            parts.push(`Host/${os.hostname()}`);
        }

        return parts.join(' ');
    }

    /**
     * Build User-Agent for Plex API client
     *
     * @returns {string} Plex-specific User-Agent
     *
     * @example
     * UserAgentBuilder.forPlex();
     * // Returns: "Posterrama/2.9.4 (Plex-Client) Node.js/18.20.0 linux/5.15.0 Host/media-server"
     */
    static forPlex() {
        return this.build('Plex-Client', {
            includeHostname: true,
            includeNodeVersion: true,
            includeOS: true,
        });
    }

    /**
     * Build User-Agent for Jellyfin API client
     *
     * @returns {string} Jellyfin-specific User-Agent
     *
     * @example
     * UserAgentBuilder.forJellyfin();
     * // Returns: "Posterrama/2.9.4 (Jellyfin-Client) Node.js/18.20.0 linux/5.15.0 Host/media-server"
     */
    static forJellyfin() {
        return this.build('Jellyfin-Client', {
            includeHostname: true,
            includeNodeVersion: true,
            includeOS: true,
        });
    }

    /**
     * Build User-Agent for TMDB API client
     *
     * @returns {string} TMDB-specific User-Agent
     *
     * @example
     * UserAgentBuilder.forTMDB();
     * // Returns: "Posterrama/2.9.4 (TMDB-Client) Node.js/18.20.0 linux/5.15.0"
     */
    static forTMDB() {
        return this.build('TMDB-Client', {
            includeHostname: false, // Don't expose hostname to public APIs
            includeNodeVersion: true,
            includeOS: true,
        });
    }

    /**
     * Build User-Agent for RomM API client
     *
     * @returns {string} RomM-specific User-Agent
     *
     * @example
     * UserAgentBuilder.forRomM();
     * // Returns: "Posterrama/2.9.4 (RomM-Client) Node.js/18.20.0 linux/5.15.0 Host/media-server"
     */
    static forRomM() {
        return this.build('RomM-Client', {
            includeHostname: true,
            includeNodeVersion: true,
            includeOS: true,
        });
    }

    /**
     * Build minimal User-Agent (version only)
     * Useful for internal requests or when minimal identification needed
     *
     * @returns {string} Minimal User-Agent
     *
     * @example
     * UserAgentBuilder.minimal();
     * // Returns: "Posterrama/2.9.4"
     */
    static minimal() {
        return `Posterrama/${pkg.version}`;
    }

    /**
     * Get current application version
     *
     * @returns {string} Application version from package.json
     */
    static getVersion() {
        return pkg.version;
    }
}

module.exports = UserAgentBuilder;
