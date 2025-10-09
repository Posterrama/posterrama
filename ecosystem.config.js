/**
 * PM2 Configuration for posterrama.app
 * This file defines how the application should be run and managed by PM2.
 */
const pkg = require('./package.json');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    const envVars = {};

    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                let value = valueParts.join('=');

                // Remove quotes if present
                if (
                    (value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))
                ) {
                    value = value.slice(1, -1);
                }

                envVars[key.trim()] = value;
            }
        }
    }

    return envVars;
}

module.exports = {
    apps: [
        {
            name: 'posterrama',
            script: 'npm',
            args: 'start',
            version: pkg.version,
            watch: false, // Disabled auto-restart to prevent conflicts during config saves
            ignore_watch: ['node_modules', 'public', 'README.md', 'sessions', '.env', 'logs'],
            env: {
                NODE_ENV: 'production',
                APP_VERSION: pkg.version,
                NODE_OPTIONS: '--max-old-space-size=8192', // 8GB heap limit
                ...loadEnvFile(), // Always load fresh .env values
            },
            // Force environment update on restart
            restart_delay: 1000,
            max_memory_restart: '8192M', // Restart if memory exceeds 8GB
        },
    ],
};
