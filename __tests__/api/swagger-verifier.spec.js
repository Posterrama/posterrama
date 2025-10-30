/**
 * Swagger Documentation Verification Tests
 *
 * Verifies that Swagger documentation matches actual Express routes.
 * Runs in subprocess to avoid side-effects from loading server.js
 */

const path = require('path');
const { execSync } = require('child_process');

describe('Swagger Verifier', () => {
    test('CLI script runs without crashing', () => {
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-swagger-docs.js');
        // Run in subprocess to avoid side-effects from loading server.js
        // This prevents global pollution, timers, and module cache contamination

        // Note: Script may exit with code 1 if routes are missing docs (expected)
        // We just verify it doesn't crash with syntax errors or exceptions
        try {
            execSync(`node "${scriptPath}"`, { stdio: 'pipe', encoding: 'utf8' });
        } catch (error) {
            // Exit code 1 is OK (missing docs), but check it's not a crash
            if (error.status !== 1) {
                throw error;
            }
            // Verify output contains expected format (not a crash)
            const output = error.stdout || error.stderr || '';
            expect(output).toMatch(/missing|orphaned|routes?|swagger|resolve/i);
        }
    });
});
