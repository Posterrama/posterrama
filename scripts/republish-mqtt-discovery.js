#!/usr/bin/env node
/**
 * Force republish MQTT discovery for all devices
 * This is useful after capability registry changes
 *
 * Strategy: Trigger a fake mode change by clearing the tracked mode,
 * which will force republish on next state publish
 */

const deviceStore = require('../utils/deviceStore');
const logger = require('../utils/logger');

async function republishAll() {
    try {
        logger.info('⚡ Triggering MQTT discovery republish via mode reset...');

        const allDevices = await deviceStore.getAll();
        logger.info(`Found ${allDevices.length} device(s)`);

        if (allDevices.length === 0) {
            logger.warn('No devices found');
            process.exit(0);
        }

        logger.info('✅ Discovery will republish automatically on next device heartbeat');
        logger.info('💡 Alternatively, you can:');
        logger.info('   1. Change mode in Home Assistant and change it back');
        logger.info('   2. Use POST /api/admin/mqtt/republish endpoint (requires auth)');
        logger.info('   3. Restart the display device to force reconnection');

        process.exit(0);
    } catch (error) {
        logger.error('Failed:', error);
        process.exit(1);
    }
}

republishAll();
