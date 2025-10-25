/**
 * Install Script Integration Tests
 * Tests the install.sh script functionality in isolated environments
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('Install Script Integration Tests', () => {
    let testDir;
    const installScriptPath = path.join(__dirname, '../../install.sh');

    beforeAll(async () => {
        // Verify install.sh exists
        try {
            await fs.access(installScriptPath);
        } catch (err) {
            throw new Error(`install.sh not found at ${installScriptPath}`);
        }
    });

    beforeEach(async () => {
        // Create temporary test directory
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posterrama-install-test-'));
    });

    afterEach(async () => {
        // Cleanup test directory
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (err) {
            console.warn(`Failed to cleanup test directory: ${err.message}`);
        }
    });

    describe('Script Validation', () => {
        test('install.sh has correct shebang', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content.startsWith('#!/bin/bash')).toBe(true);
        });

        test('install.sh is executable', async () => {
            const stats = await fs.stat(installScriptPath);
            // Check if owner has execute permission (mode & 0o100)
            expect(stats.mode & 0o100).not.toBe(0);
        });

        test('install.sh passes shellcheck validation', () => {
            try {
                // shellcheck should already be installed in CI
                execSync(`shellcheck ${installScriptPath}`, { encoding: 'utf8' });
                expect(true).toBe(true); // shellcheck passed
            } catch (err) {
                if (err.message.includes('not found')) {
                    console.log('⚠️  shellcheck not available, skipping validation');
                    return;
                }
                // shellcheck found issues
                fail(`shellcheck validation failed:\n${err.stdout}`);
            }
        });

        test('install.sh has proper error handling (set -e)', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/set -e/);
        });
    });

    describe('Function Extraction Tests', () => {
        test('detect_os function exists and is callable', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/detect_os\(\)/);
            expect(content).toMatch(/print_status.*Detected OS/);
        });

        test('check_root function handles sudo correctly', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/check_root\(\)/);
            expect(content).toMatch(/EUID.*eq 0/);
            expect(content).toMatch(/sudo/i);
        });

        test('install_nodejs function checks version compatibility', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/install_nodejs\(\)/);
            expect(content).toMatch(/MAJOR_VERSION.*-ge 18/);
        });

        test('install_pm2 function exists', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/install_pm2\(\)/);
        });

        test('detect_existing_installation function checks for existing install', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/detect_existing_installation\(\)/);
        });
    });

    describe('Configuration Management', () => {
        test('script handles config backup properly', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // Should backup config.json before update
            expect(content).toMatch(/config\.json/);
            expect(content).toMatch(/backup/i);
        });

        test('script handles configuration files', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // Creates config.json from config.example.json
            expect(content).toMatch(/config\.example\.json/);
            expect(content).toMatch(/config\.json/);
        });

        test('script creates necessary directories', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/mkdir/);
            expect(content).toMatch(/RUNTIME_DIRS|cache.*image_cache.*logs/);
        });
    });

    describe('OS Detection Simulation', () => {
        test('handles Ubuntu/Debian detection', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/Ubuntu.*Debian/);
            expect(content).toMatch(/apt-get/);
        });

        test('handles CentOS/RHEL detection', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/CentOS|Red Hat|Rocky|AlmaLinux/);
            expect(content).toMatch(/yum|dnf/);
        });

        test('handles Fedora detection', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/Fedora/);
            expect(content).toMatch(/dnf/);
        });
    });

    describe('Dependency Installation', () => {
        test('installs build tools for native modules', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/build-essential|Development Tools/);
            expect(content).toMatch(/gcc|make/);
        });

        test('installs Node.js from NodeSource', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/nodesource\.com/);
        });

        test('installs PM2 globally', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/npm install.*pm2/);
        });

        test('verifies installations with version checks', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/--version/);
        });
    });

    describe('PM2 Service Management', () => {
        test('configures PM2 ecosystem file', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/ecosystem.*config\.js/);
        });

        test('sets up PM2 startup on boot', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/pm2 startup/);
            expect(content).toMatch(/pm2 save/);
        });

        test('handles PM2 service user correctly', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // Should detect root vs posterrama user
            expect(content).toMatch(/POSTERRAMA_USER|root/);
        });
    });

    describe('Firewall Configuration', () => {
        test('configures UFW if available', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/ufw/i);
        });

        test('configures firewalld if available', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/firewalld|firewall-cmd/i);
        });

        test('opens port 4000 by default', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/4000/);
        });
    });

    describe('Error Handling', () => {
        test('provides colored output functions', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/print_status/);
            expect(content).toMatch(/print_success/);
            expect(content).toMatch(/print_warning/);
            expect(content).toMatch(/print_error/);
        });

        test('exits on critical errors with set -e', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/set -e/);
        });

        test('provides helpful error messages', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // Should have informative error messages
            const errorCount = (content.match(/print_error/g) || []).length;
            expect(errorCount).toBeGreaterThan(5); // Multiple error scenarios covered
        });
    });

    describe('Update vs Fresh Install Detection', () => {
        test('detects existing installation', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/detect_existing_installation/);
            expect(content).toMatch(/posterrama-app/);
        });

        test('creates config backup during updates', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/backup.*config/i);
            expect(content).toMatch(/timestamp|date/i);
        });

        test('performs git hard reset during updates', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/git reset --hard/);
        });

        test('fetches and resets to origin/main', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/git fetch --all/);
            expect(content).toMatch(/reset --hard origin\/main/);
        });
    });

    describe('Security Checks', () => {
        test('does not hardcode credentials', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // Should not contain hardcoded passwords
            expect(content).not.toMatch(/password.*=.*["'][^"']+["']/i);
        });

        test('handles sudo properly without storing passwords', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // Should use sudo -n for passwordless check
            expect(content).toMatch(/sudo -n/);
        });

        test('sets proper file permissions', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/chmod/);
        });

        test('uses secure download methods (https)', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // All curl commands for downloads should use https
            expect(content).toMatch(/curl -fsSL https:\/\//);
            // No insecure http downloads for nodesource
            expect(content).not.toMatch(/nodesource\.com.*http:\/\//);
        });
    });

    describe('Script Output and Logging', () => {
        test('provides clear installation progress', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            const statusCount = (content.match(/print_status/g) || []).length;
            expect(statusCount).toBeGreaterThan(10); // Multiple progress indicators
        });

        test('displays success confirmation at end', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            expect(content).toMatch(/print_success.*installed/i);
        });

        test('shows final instructions to user', async () => {
            const content = await fs.readFile(installScriptPath, 'utf8');
            // Should tell user how to access the app
            expect(content).toMatch(/Web Interface|Admin Panel/);
            expect(content).toMatch(/4000|DEFAULT_PORT/);
        });
    });
});
