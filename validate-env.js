/**
 * Script to validate that required environment variables are set.
 * This script is run before starting the server to ensure a valid configuration.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

let config;
try {
    const configPath = path.join(__dirname, 'config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (error) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: Could not read or parse config.json.');
    console.error(error.message);
    process.exit(1);
}

const requiredVarsSet = new Set();
const tokenVars = [];

const enabledServers = config.mediaServers.filter(s => s.enabled);

if (enabledServers.length === 0) {
    console.warn('\x1b[33m%s\x1b[0m', 'WARNING: No media servers are enabled in config.json. The application will run but will not display any media.');
}

for (const server of enabledServers) {
    if (server.type === 'plex') {
        if (server.hostnameEnvVar) requiredVarsSet.add(server.hostnameEnvVar);
        if (server.portEnvVar) requiredVarsSet.add(server.portEnvVar);
        if (server.tokenEnvVar) {
            requiredVarsSet.add(server.tokenEnvVar);
            tokenVars.push(server.tokenEnvVar);
        }
    } else if (server.type === 'jellyfin') {
        if (server.urlEnvVar) requiredVarsSet.add(server.urlEnvVar);
        if (server.apiKeyEnvVar) requiredVarsSet.add(server.apiKeyEnvVar);
        if (server.userIdEnvVar) requiredVarsSet.add(server.userIdEnvVar);
    }
}

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