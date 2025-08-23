/**
 * PM2 configuration for the detached update runner
 */
const path = require('path');

module.exports = {
    apps: [
        {
            name: 'posterrama-updater',
            script: path.resolve(__dirname, 'utils', 'update-runner.js'),
            node_args: [],
            autorestart: false,
            watch: false,
            time: true,
            interpreter: process.execPath,
            env: {
                NODE_ENV: 'production',
            },
            error_file: path.resolve(__dirname, 'logs', 'updater-error.log'),
            out_file: path.resolve(__dirname, 'logs', 'updater-out.log'),
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
    ],
};
