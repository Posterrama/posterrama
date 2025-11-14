/**
 * Tests for POST /api/admin/2fa/disable endpoint
 *
 * Issue #3: Verify unsafe environment variable deletion is fixed
 *
 * The 2FA disable endpoint should follow the proper env update pattern:
 * 1. Use writeEnvFile() to update .env file (NOT direct process.env mutation)
 * 2. writeEnvFile() internally updates process.env
 * 3. Call restartPM2ForEnvUpdate() for PM2 env sync
 * 4. Send response BEFORE PM2 restart (non-blocking)
 *
 * This test uses static code analysis to verify the pattern is followed.
 */

const fs = require('fs');
const path = require('path');

describe('POST /api/admin/2fa/disable - Code Pattern Verification (Issue #3)', () => {
    let routeCode;
    let disableEndpointStartLine;
    let disableEndpointCode;

    beforeAll(() => {
        // Read the auth.js route file
        const routePath = path.join(__dirname, '../../routes/auth.js');
        routeCode = fs.readFileSync(routePath, 'utf8');

        // Find the start of the 2FA disable endpoint
        disableEndpointStartLine = routeCode.indexOf("'/api/admin/2fa/disable'");

        // Find the end of this endpoint (next router. call or return statement)
        const endPattern = /\n\s{4}(router\.|return router)/;
        const searchStart = disableEndpointStartLine;
        const endMatch = routeCode.substring(searchStart).match(endPattern);
        const endLine = endMatch ? searchStart + endMatch.index : searchStart + 2000;

        // Extract the full endpoint code
        disableEndpointCode = routeCode.substring(disableEndpointStartLine, endLine);
    });

    test('should find the 2FA disable endpoint in auth.js', () => {
        expect(disableEndpointStartLine).toBeGreaterThan(-1);
        expect(disableEndpointCode).toBeTruthy();
        expect(disableEndpointCode.length).toBeGreaterThan(100);
    });

    test('should use writeEnvFile() to update environment', () => {
        // Verify writeEnvFile is called
        expect(disableEndpointCode).toMatch(/await\s+writeEnvFile/);

        // Verify it's called with ADMIN_2FA_SECRET
        expect(disableEndpointCode).toMatch(/ADMIN_2FA_SECRET/);
    });

    test('should call restartPM2ForEnvUpdate() for PM2 env sync', () => {
        // Verify PM2 restart is called
        expect(disableEndpointCode).toMatch(/await\s+restartPM2ForEnvUpdate/);
        expect(disableEndpointCode).toMatch(/restartPM2ForEnvUpdate\(['"]/);
    });

    test('should NOT directly mutate process.env (Issue #3 fix)', () => {
        // This is the core fix for Issue #3:
        // The endpoint should NOT do: delete process.env.ADMIN_2FA_SECRET
        // Instead, writeEnvFile() handles process.env updates internally

        expect(disableEndpointCode).not.toMatch(/delete\s+process\.env\.ADMIN_2FA_SECRET/);
    });

    test('should send response before PM2 restart', () => {
        // Response should be sent BEFORE the PM2 restart call
        // This ensures the client gets a response even if restart takes time

        const lines = disableEndpointCode.split('\n');
        let resJsonIndex = -1;
        let restartIndex = -1;

        lines.forEach((line, index) => {
            if (line.match(/res\.json\(/)) {
                resJsonIndex = index;
            }
            if (line.match(/await\s+restartPM2ForEnvUpdate/)) {
                restartIndex = index;
            }
        });

        expect(resJsonIndex).toBeGreaterThan(-1);
        expect(restartIndex).toBeGreaterThan(-1);
        expect(resJsonIndex).toBeLessThan(restartIndex);
    });

    test('should inform user that server will restart', () => {
        // Response message should mention server restart
        const responseMatch = disableEndpointCode.match(/res\.json\(\{[\s\S]*?\}\)/);
        expect(responseMatch).toBeTruthy();

        const responseCode = responseMatch[0];
        expect(responseCode).toMatch(/restart/i);
    });

    test('should clear session twoFactorVerified flag', () => {
        // Session should be cleared to prevent re-verification
        expect(disableEndpointCode).toMatch(/req\.session/);
        expect(disableEndpointCode).toMatch(/twoFactorVerified/);
    });

    test('should log the 2FA disable action', () => {
        // Should log the action for audit trail
        expect(disableEndpointCode).toMatch(/logger\.info/);
        expect(disableEndpointCode).toMatch(/2FA disabled/i);
    });

    describe('Pattern compliance summary', () => {
        test('follows all Issue #3 requirements', () => {
            // Comprehensive check that all requirements are met:
            const requirements = {
                usesWriteEnvFile: disableEndpointCode.match(/await\s+writeEnvFile/),
                callsRestartPM2: disableEndpointCode.match(/await\s+restartPM2ForEnvUpdate/),
                noDirectEnvMutation: !disableEndpointCode.match(
                    /delete\s+process\.env\.ADMIN_2FA_SECRET/
                ),
                sendsResponse: disableEndpointCode.match(/res\.json/),
                clearsSession: disableEndpointCode.match(/twoFactorVerified/),
                logsAction: disableEndpointCode.match(/logger\.info/),
            };

            expect(requirements.usesWriteEnvFile).toBeTruthy();
            expect(requirements.callsRestartPM2).toBeTruthy();
            expect(requirements.noDirectEnvMutation).toBe(true);
            expect(requirements.sendsResponse).toBeTruthy();
            expect(requirements.clearsSession).toBeTruthy();
            expect(requirements.logsAction).toBeTruthy();
        });
    });
});
