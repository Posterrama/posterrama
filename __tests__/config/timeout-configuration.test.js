/**
 * Tests for centralized timeout configuration (Issue #7)
 *
 * Verifies that production code uses config timeout constants
 * instead of hardcoded magic numbers.
 */

const fs = require('fs');
const path = require('path');

describe('Timeout Configuration (Issue #7)', () => {
    describe('Config module structure', () => {
        test('should define timeout constants in config/index.js', () => {
            const configSource = fs.readFileSync(
                path.join(__dirname, '../../config/index.js'),
                'utf8'
            );

            // Verify timeouts object exists with all expected constants
            expect(configSource).toMatch(/this\.timeouts\s*=\s*{/);

            const expectedTimeouts = [
                'httpDefault: 15000',
                'httpHealthCheck: 5000',
                'wsCommandAck: 3000',
                'wsCommandAckMin: 500',
                'processGracefulShutdown: 250',
                'serviceStop: 2000',
                'serviceStart: 3000',
                'serviceStartRace: 5000',
                'jobQueueNext: 100',
                'mqttRepublish: 500',
                'deviceStateSync: 100',
            ];

            expectedTimeouts.forEach(timeout => {
                expect(configSource).toContain(timeout);
            });
        });

        test('should have getTimeout method with env override support', () => {
            const configSource = fs.readFileSync(
                path.join(__dirname, '../../config/index.js'),
                'utf8'
            );

            expect(configSource).toMatch(/getTimeout\s*\(\s*key\s*\)/);
            expect(configSource).toMatch(/TIMEOUT_/);
            expect(configSource).toMatch(/toUpperCase/);
            expect(configSource).toMatch(/this\.timeouts\[key\]/);
        });

        test('should have timeout category documentation', () => {
            const configSource = fs.readFileSync(
                path.join(__dirname, '../../config/index.js'),
                'utf8'
            );

            expect(configSource).toMatch(/HTTP client timeouts/i);
            expect(configSource).toMatch(/WebSocket timeouts/i);
            expect(configSource).toMatch(/Process management/i);
            expect(configSource).toMatch(/Job queue/i);
            expect(configSource).toMatch(/MQTT.*Device/i);
        });
    });

    describe('Production code usage', () => {
        test('healthCheck.js should use config timeout instead of hardcoded 5000', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../utils/healthCheck.js'),
                'utf8'
            );

            // Should require config/ (inline or at top)
            expect(content).toMatch(/require\(['"].*config.*['"]\)/);

            // Should use getTimeout
            expect(content).toMatch(/getTimeout\(['"]httpHealthCheck['"]\)/);

            // Should NOT have hardcoded setTimeout with 5000 for abort
            const lines = content.split('\n');
            const abortLines = lines.filter(line => line.includes('abort()'));
            abortLines.forEach(line => {
                if (line.includes('setTimeout')) {
                    expect(line).not.toMatch(/setTimeout\([^)]+,\s*5000\s*\)/);
                }
            });
        });

        test('wsHub.js should use config timeouts instead of hardcoded values', () => {
            const content = fs.readFileSync(path.join(__dirname, '../../utils/wsHub.js'), 'utf8');

            // Should require config/ (inline or at top)
            expect(content).toMatch(/require\(['"].*config.*['"]\)/);

            // Should use both wsCommandAck and wsCommandAckMin
            expect(content).toMatch(/getTimeout\(['"]wsCommandAck['"]\)/);
            expect(content).toMatch(/getTimeout\(['"]wsCommandAckMin['"]\)/);

            // Should NOT have hardcoded default of 3000 or min of 500
            expect(content).not.toMatch(/timeoutMs\s*=\s*3000/);
            expect(content).not.toMatch(/Math\.max\(\s*500\s*,/);
        });

        test('server.js should use config timeout for process shutdown', () => {
            const content = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

            // Should require config/ (inline or at top)
            expect(content).toMatch(/require\(['"].*config.*['"]\)/);

            // Should use getTimeout for process shutdown
            expect(content).toMatch(/getTimeout\(['"]processGracefulShutdown['"]\)/);
        });

        test('updater.js should use config timeouts for service management', () => {
            const content = fs.readFileSync(path.join(__dirname, '../../utils/updater.js'), 'utf8');

            // Should use all three service management timeouts
            expect(content).toMatch(/getTimeout\(['"]serviceStop['"]\)/);
            expect(content).toMatch(/getTimeout\(['"]serviceStart['"]\)/);
            expect(content).toMatch(/getTimeout\(['"]serviceStartRace['"]\)/);

            // Should NOT have hardcoded values in service methods
            const stopSection = content.match(/stop.*gracefully[\s\S]{0,200}setTimeout/i);
            if (stopSection) {
                expect(stopSection[0]).not.toMatch(/setTimeout\([^)]+,\s*2000\s*\)/);
            }
        });

        test('job-queue.js should use config timeout', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../utils/job-queue.js'),
                'utf8'
            );

            expect(content).toMatch(/getTimeout\(['"]jobQueueNext['"]\)/);

            // Should NOT have hardcoded 100 in processNextJob call
            const processNextSection = content.match(/processNextJob\(\)[^}]{0,100}/);
            if (processNextSection) {
                expect(processNextSection[0]).not.toMatch(/\b100\b/);
            }
        });

        test('mqttBridge.js should use config timeout', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../utils/mqttBridge.js'),
                'utf8'
            );

            expect(content).toMatch(/getTimeout\(['"]mqttRepublish['"]\)/);
        });

        test('capabilityRegistry.js should use config timeout', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../utils/capabilityRegistry.js'),
                'utf8'
            );

            expect(content).toMatch(/getTimeout\(['"]deviceStateSync['"]\)/);
        });
    });

    describe('Timeout value rationale', () => {
        test('should have reasonable HTTP timeout values', () => {
            const configSource = fs.readFileSync(
                path.join(__dirname, '../../config/index.js'),
                'utf8'
            );

            // Extract timeout values
            const httpDefaultMatch = configSource.match(/httpDefault:\s*(\d+)/);
            const httpHealthCheckMatch = configSource.match(/httpHealthCheck:\s*(\d+)/);

            expect(httpDefaultMatch).toBeTruthy();
            expect(httpHealthCheckMatch).toBeTruthy();

            const httpDefault = parseInt(httpDefaultMatch[1], 10);
            const httpHealthCheck = parseInt(httpHealthCheckMatch[1], 10);

            // Health checks should be shorter than default
            expect(httpHealthCheck).toBeLessThan(httpDefault);

            // Both should be in reasonable range
            expect(httpHealthCheck).toBeGreaterThanOrEqual(5000);
            expect(httpHealthCheck).toBeLessThanOrEqual(30000);
            expect(httpDefault).toBeGreaterThanOrEqual(5000);
            expect(httpDefault).toBeLessThanOrEqual(30000);
        });

        test('should maintain backward compatibility with original values', () => {
            const configSource = fs.readFileSync(
                path.join(__dirname, '../../config/index.js'),
                'utf8'
            );

            // Verify original hardcoded values are preserved as defaults
            expect(configSource).toContain('httpHealthCheck: 5000');
            expect(configSource).toContain('wsCommandAck: 3000');
            expect(configSource).toContain('wsCommandAckMin: 500');
            expect(configSource).toContain('processGracefulShutdown: 250');
            expect(configSource).toContain('serviceStop: 2000');
            expect(configSource).toContain('serviceStart: 3000');
            expect(configSource).toContain('serviceStartRace: 5000');
            expect(configSource).toContain('jobQueueNext: 100');
            expect(configSource).toContain('mqttRepublish: 500');
            expect(configSource).toContain('deviceStateSync: 100');
        });
    });

    describe('No hardcoded timeouts remaining', () => {
        test('production files should not have magic timeout numbers', () => {
            const filesToCheck = [
                'utils/healthCheck.js',
                'utils/wsHub.js',
                'server.js',
                'utils/updater.js',
                'utils/job-queue.js',
                'utils/mqttBridge.js',
                'utils/capabilityRegistry.js',
            ];

            filesToCheck.forEach(file => {
                const content = fs.readFileSync(path.join(__dirname, '../../', file), 'utf8');

                // Count getTimeout usage
                const getTimeoutMatches = content.match(/getTimeout\(/g) || [];

                // File should use getTimeout at least once if it has timeouts
                if (
                    content.includes('setTimeout') &&
                    !file.includes('server.js') // server.js has many other setTimeout calls
                ) {
                    expect(getTimeoutMatches.length).toBeGreaterThan(0);
                }
            });
        });
    });
});
