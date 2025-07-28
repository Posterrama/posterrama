/**
 * Script to validate that required environment variables are set.
 * This script is run before starting the server to ensure a valid configuration.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
require('dotenv').config();

// --- Schema Validation ---
const ajv = new Ajv({ allErrors: true }); // Show all errors, not just the first
const configSchema = require('./config.schema.json');
const validate = ajv.compile(configSchema);

let config;
try {
    const configPath = path.join(__dirname, 'config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (error) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: Could not read or parse config.json.');
    console.error(error.message);
    process.exit(1);
}

// Validate the loaded config against the schema
const isConfigValid = validate(config);
if (!isConfigValid) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: config.json is invalid. Please correct the following errors:');
    validate.errors.forEach(error => {
        const instancePath = error.instancePath || 'root';
        // Use a more readable format for the error path
        const readablePath = instancePath.replace(/\//g, ' -> ').substring(3) || 'root';
        console.error(`  - Path: \x1b[33m${readablePath}\x1b[0m`);
        console.error(`    Message: ${error.message}`);
        if (error.params) {
            console.error(`    Details: ${JSON.stringify(error.params)}`);
        }
    });
    process.exit(1);
}

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
        console.warn('\x1b[33m%s\x1b[0m', 'WARNING: No media servers are enabled in config.json. The application will run but will not display any media.');
    }

    for (const server of enabledServers) {
        if (server.type === 'plex') {
            if (server.hostnameEnvVar) required.add(server.hostnameEnvVar);
            if (server.portEnvVar) required.add(server.portEnvVar);
            if (server.tokenEnvVar) {
                required.add(server.tokenEnvVar);
                tokens.push(server.tokenEnvVar);
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
  console.error('\nPlease copy `config.example.env` to a new file named `.env` and fill in the required values.');
  process.exit(1); // Exit with an error code to prevent server from starting
}

tokenVars.forEach(tokenVar => {
    if (process.env[tokenVar] === 'YourPlexTokenHere') {
        console.warn('\x1b[33m%s\x1b[0m', `WARNING: The environment variable ${tokenVar} seems to be a placeholder value.`);
        console.warn('Please replace "YourPlexTokenHere" with your actual token in the .env file.');
    }
});