/**
 * Device Preset Helpers
 *
 * Provides utilities for managing device presets:
 * - readPresets() - Read presets from device-presets.json
 * - writePresets() - Write presets with atomic file operations
 */

const fs = require('fs');
const path = require('path');

/**
 * Read device presets from JSON file
 * @param {string} rootDir - Application root directory
 * @returns {Promise<Array>} Array of preset objects, or empty array if file doesn't exist
 */
async function readPresets(rootDir) {
    const presetsFile = path.join(rootDir, 'device-presets.json');
    try {
        const raw = await fs.promises.readFile(presetsFile, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}

/**
 * Write device presets to JSON file with atomic operations
 * @param {Array} presets - Array of preset objects to save
 * @param {string} rootDir - Application root directory
 * @returns {Promise<void>}
 */
async function writePresets(presets, rootDir) {
    const presetsFile = path.join(rootDir, 'device-presets.json');
    const arr = Array.isArray(presets) ? presets : [];
    const tmp = presetsFile + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf8');
    await fs.promises.rename(tmp, presetsFile);
}

module.exports = {
    readPresets,
    writePresets,
};
