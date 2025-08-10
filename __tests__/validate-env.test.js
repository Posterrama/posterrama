const fs = require('fs');
const path = require('path');

describe('Environment Validator (validate-env.js)', () => {
    let originalProcessExit;
    let originalConsoleError;
    let originalConsoleWarn;
    let originalFsReadFileSync;
    let mockExit;
    let mockConsoleError;
    let mockConsoleWarn;

    beforeEach(() => {
        // Store original functions
        originalProcessExit = process.exit;
        originalConsoleError = console.error;
        originalConsoleWarn = console.warn;
        originalFsReadFileSync = fs.readFileSync;

        // Mock functions
        mockExit = jest.fn((code) => {
            // Simulate actual exit by throwing an error to stop execution
            if (code === 1) {
                throw new Error('Process exit with code 1');
            }
        });
        mockConsoleError = jest.fn();
        mockConsoleWarn = jest.fn();
        
        process.exit = mockExit;
        console.error = mockConsoleError;
        console.warn = mockConsoleWarn;

        // Reset modules
        jest.resetModules();
        
        // Clear environment variables
        delete process.env.ADMIN_USERNAME;
        delete process.env.ADMIN_PASSWORD_HASH; 
        delete process.env.SESSION_SECRET;
        delete process.env.PLEX_HOSTNAME;
        delete process.env.PLEX_PORT;
        delete process.env.PLEX_TOKEN;
    });

    afterEach(() => {
        // Restore original functions
        process.exit = originalProcessExit;
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        fs.readFileSync = originalFsReadFileSync;
    });

    const validConfig = {
        transitionIntervalSeconds: 15,
        backgroundRefreshMinutes: 30,
        showClearLogo: true,
        showRottenTomatoes: true,
        rottenTomatoesMinimumScore: 0,
        showPoster: true,
        showMetadata: true,
        clockWidget: false,
        kenBurnsEffect: {
            enabled: true,
            durationSeconds: 15
        },
        mediaServers: [
            {
                name: "Test Server",
                type: "plex",
                enabled: true,
                hostnameEnvVar: "PLEX_HOSTNAME",
                portEnvVar: "PLEX_PORT", 
                tokenEnvVar: "PLEX_TOKEN"
            }
        ]
    };

    test('should pass validation when config is valid', () => {
        // Mock successful file read
        fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(validConfig));
        
        // Set required environment variables
        process.env.PLEX_HOSTNAME = 'localhost';
        process.env.PLEX_PORT = '32400';
        process.env.PLEX_TOKEN = 'test-token';

        try {
            // Clear module cache and require the validator
            delete require.cache[require.resolve('../validate-env')];
            require('../validate-env');
            
            // Should not exit with error
            expect(mockExit).not.toHaveBeenCalledWith(1);
            expect(mockConsoleError).not.toHaveBeenCalled();
        } catch (error) {
            // Ignore expected exit errors
            if (error.message !== 'Process exit with code 1') {
                throw error;
            }
        }
    });

    test('should exit with error if config.json cannot be read', () => {
        // Mock file read error
        fs.readFileSync = jest.fn().mockImplementation(() => {
            throw new Error('File not found');
        });

        try {
            // Clear module cache and require the validator
            delete require.cache[require.resolve('../validate-env')];
            require('../validate-env.js');
        } catch (error) {
            // Expected to throw due to mocked exit
        }

        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockConsoleError).toHaveBeenCalledWith(
            '\x1b[31m%s\x1b[0m', 'FATAL ERROR: Could not read or parse config.json.'
        );
    });

    test('should exit with error if config.json has invalid JSON', () => {
        // Mock invalid JSON
        fs.readFileSync = jest.fn().mockReturnValue('{ invalid json }');

        try {
            // Clear module cache and require the validator
            delete require.cache[require.resolve('../validate-env')];
            require('../validate-env.js');
        } catch (error) {
            // Expected to throw due to mocked exit
        }

        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockConsoleError).toHaveBeenCalledWith(
            '\x1b[31m%s\x1b[0m', 'FATAL ERROR: Could not read or parse config.json.'
        );
    });

    test('should exit with error if config.json fails schema validation', () => {
        const invalidConfig = {
            // Missing required transitionIntervalSeconds
            showRottenTomatoes: true
        };

        fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(invalidConfig));

        try {
            // Clear module cache and require the validator
            delete require.cache[require.resolve('../validate-env')];
            require('../validate-env.js');
        } catch (error) {
            // Expected to throw due to mocked exit
        }

        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockConsoleError).toHaveBeenCalledWith(
            '\x1b[31m%s\x1b[0m', 'FATAL ERROR: config.json is invalid. Please correct the following errors:'
        );
    });

    test('should warn but not exit if no media servers are enabled', () => {
        const configWithNoServers = {
            ...validConfig,
            mediaServers: []
        };

        fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(configWithNoServers));

        try {
            // Clear module cache and require the validator
            delete require.cache[require.resolve('../validate-env')];
            require('../validate-env.js');
        } catch (error) {
            // Ignore expected exit errors
            if (error.message !== 'Process exit with code 1') {
                throw error;
            }
        }

        // Should warn but not exit
        expect(mockConsoleWarn).toHaveBeenCalledWith(
            '\x1b[33m%s\x1b[0m', 'WARNING: No media servers are enabled in config.json. The application will run but will not display any media.'
        );
        expect(mockExit).not.toHaveBeenCalledWith(1);
    });

    test('should require SESSION_SECRET when admin credentials are set', () => {
        const configWithDisabledServers = {
            ...validConfig,
            mediaServers: []
        };
        
        fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(configWithDisabledServers));
        
        // Set admin credentials but not session secret
        process.env.ADMIN_USERNAME = 'admin';
        process.env.ADMIN_PASSWORD_HASH = 'hash123';
        // Don't set SESSION_SECRET

        try {
            // Clear module cache and require the validator
            delete require.cache[require.resolve('../validate-env')];
            require('../validate-env.js');
        } catch (error) {
            // Expected to throw due to mocked exit
        }

        // Should exit due to missing SESSION_SECRET
        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockConsoleError).toHaveBeenCalledWith(
            '\x1b[31m%s\x1b[0m', 'FATAL ERROR: Missing required environment variables.'
        );
    });
});