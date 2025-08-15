/**
 * PM2 Configuration for posterrama.app
 * This file defines how the application should be run and managed by PM2.
 */
const pkg = require('./package.json');

module.exports = {
  apps: [{
    name: 'posterrama',
    script: 'npm',
    args: 'start',
    version: pkg.version,
    watch: false, // Disabled auto-restart to prevent conflicts during config saves
    ignore_watch: ['node_modules', 'public', 'README.md', 'sessions', '.env', 'logs'],
    env: {
      NODE_ENV: 'production',
      APP_VERSION: pkg.version
    },
  }],
};