/**
 * Build and deployment helper functions
 * Extracted from server.js (Issue #84)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Calculate a hash of a directory's contents based on file paths and modification times
 * Used for auto-building frontend in production when source files change
 * @param {string} dir - Directory path to hash
 * @returns {string} SHA-256 hash of directory contents
 */
function calculateDirectoryHash(dir) {
    const files = [];

    function walkDir(currentPath) {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                // Skip dist and node_modules directories
                if (entry.name !== 'dist' && entry.name !== 'node_modules') {
                    walkDir(fullPath);
                }
            } else {
                // Include file path and mtime for hash
                const stat = fs.statSync(fullPath);
                files.push(`${fullPath}:${stat.mtimeMs}`);
            }
        }
    }

    walkDir(dir);
    files.sort();
    return crypto.createHash('sha256').update(files.join('|')).digest('hex');
}

module.exports = {
    calculateDirectoryHash,
};
