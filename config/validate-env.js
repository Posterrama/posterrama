/**
 * Script to validate that required environment variables are set.
 * This script is run before starting the server to ensure a valid configuration.
 */

const fs = require('fs');
const path = require('path');
// --- Auto-create .env if missing ---
const envPath = path.join(__dirname, '..', '.env');
const exampleEnvPath = path.join(__dirname, '..', 'config.example.env');
if (!fs.existsSync(envPath)) {
    if (fs.existsSync(exampleEnvPath)) {
        fs.copyFileSync(exampleEnvPath, envPath);
        console.log('[Config] .env aangemaakt op basis van config.example.env');
    } else {
        console.error('[Config] config.example.env ontbreekt, kan geen .env aanmaken!');
        process.exit(1);
    }
}
// --- Auto-create config.json if missing ---
const configPath = path.join(__dirname, '..', 'config.json');
const exampleConfigPath = path.join(__dirname, '..', 'config.example.json');
if (!fs.existsSync(configPath)) {
    if (fs.existsSync(exampleConfigPath)) {
        fs.copyFileSync(exampleConfigPath, configPath);
        console.log('[Config] config.json aangemaakt op basis van config.example.json');
    } else {
        console.error('[Config] config.example.json ontbreekt, kan geen config.json aanmaken!');
        process.exit(1);
    }
}

const Ajv = require('ajv');
// Use example env during tests, real .env otherwise
const envFileToUse = process.env.NODE_ENV === 'test' ? exampleEnvPath : envPath;
require('dotenv').config({ path: envFileToUse });

// --- Schema Validation ---
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true }); // allowUnionTypes to support multi-type definitions
const schemaPath = path.join(__dirname, '..', 'config.schema.json');

// Create a local safe reader that doesn't globally monkey-patch fs, to avoid
// interfering with Jest/Babel internals. We prefer the Jest mock for config.json
// (so tests can inject content), and bypass the mock for other files like the schema.
function realReadFileSync(p, encoding = 'utf-8') {
    const fd = fs.openSync(p, 'r');
    try {
        const stat = fs.fstatSync(fd);
        const buf = Buffer.allocUnsafe(stat.size);
        fs.readSync(fd, buf, 0, stat.size, 0);
        return encoding ? buf.toString(encoding) : buf;
    } finally {
        try {
            fs.closeSync(fd);
        } catch (_) {
            // ignore
        }
    }
}

function safeReadFile(pathStr, { preferMockForConfig = false } = {}) {
    const isFsMocked = typeof fs.readFileSync === 'function' && fs.readFileSync._isMockFunction;
    if (preferMockForConfig && isFsMocked && pathStr === configPath) {
        // Let the test-provided mock supply config.json content
        return fs.readFileSync(pathStr, 'utf-8');
    }
    // For all other cases (schema and non-config), bypass the mock
    return realReadFileSync(pathStr, 'utf-8');
}

let configSchema;
try {
    configSchema = JSON.parse(safeReadFile(schemaPath));
} catch (e) {
    console.error('[Config] Failed to read config.schema.json:', e.message);
    process.exit(1);
}
const validate = ajv.compile(configSchema);

let config;
try {
    config = JSON.parse(safeReadFile(configPath, { preferMockForConfig: true }));
} catch (error) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: Could not read or parse config.json.');
    console.error(error.message);
    process.exit(1);
}

// Export the validation function for use by other modules
function validateEnvironment() {
    // Defer config schema validation error output until after env var checks to match test expectations
    const isConfigValid = validate(config);

    /**
     * Determines which environment variables are required based on the configuration.
     * @param {object} appConfig The application's config.json content.
     * @returns {{required: Set<string>, tokens: string[]}} An object containing a set of required variable names and an array of token variable names.
     */
    function getRequiredVars(appConfig) {
        const required = new Set();
        const tokens = [];

        // Session secret is needed if an admin user exists
        if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH) {
            required.add('SESSION_SECRET');
        }

        const enabledServers = (appConfig.mediaServers || []).filter(s => s.enabled);
        if (enabledServers.length === 0) {
            console.warn(
                '\x1b[33m%s\x1b[0m',
                'WARNING: No media servers are enabled in config.json. The application will run but will not display any media.'
            );
        }

        for (const server of enabledServers) {
            // Hostname/port now come strictly from config.json. Only token env var is required (unless direct token provided).
            if (server.tokenEnvVar && !server.token) {
                required.add(server.tokenEnvVar);
                tokens.push(server.tokenEnvVar);
            }

            // RomM uses 'url' field instead of hostname/port
            if (server.type === 'romm') {
                if (!server.url) {
                    console.warn(
                        `[Config] WARNING: Enabled RomM server "${server.name}" missing mandatory url - will be disabled at runtime`
                    );
                    // Don't exit - let the server start and disable this source
                }
            } else {
                // Plex and Jellyfin require hostname and port
                if (!server.hostname || !server.port) {
                    console.warn(
                        `[Config] WARNING: Enabled server "${server.name}" missing mandatory hostname/port - will be disabled at runtime`
                    );
                    // Don't exit - let the server start and disable this source
                }
            }
        }
        return { required, tokens };
    }

    const { required: requiredVarsSet, tokens: tokenVars } = getRequiredVars(config);

    const missingVars = [...requiredVarsSet].filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: Missing required environment variables.');
        console.error('The following variables are not set in your .env file:');
        missingVars.forEach(varName => console.error(`  - ${varName}`));
        console.error(
            '\nPlease copy `config.example.env` to a new file named `.env` and fill in the required values.'
        );
        process.exit(1); // Exit with an error code to prevent server from starting
    }

    // Only now report config schema validation errors (if any) after env var fatal checks
    if (!isConfigValid) {
        console.error(
            '\x1b[31m%s\x1b[0m',
            'FATAL ERROR: config.json is invalid. Please correct the following errors:'
        );
        validate.errors.forEach(error => {
            const instancePath = error.instancePath || 'root';
            const readablePath = instancePath.replace(/\//g, ' -> ').substring(3) || 'root';
            console.error(`  - Path: \x1b[33m${readablePath}\x1b[0m`);
            console.error(`    Message: ${error.message}`);
            if (error.params) {
                console.error(`    Details: ${JSON.stringify(error.params)}`);
            }
        });
        // Don't exit during tests, just log the error
        if (process.env.NODE_ENV !== 'test') {
            process.exit(1);
        } else {
            console.warn('[Test Mode] Config validation failed but continuing...');
            return false;
        }
    }

    tokenVars.forEach(tokenVar => {
        if (process.env[tokenVar] === 'YourPlexTokenHere') {
            console.warn(
                '\x1b[33m%s\x1b[0m',
                `WARNING: The environment variable ${tokenVar} seems to be a placeholder value.`
            );
            console.warn(
                'Please replace "YourPlexTokenHere" with your actual token in the .env file.'
            );
        }
    });
}

module.exports = { validate: validateEnvironment };
