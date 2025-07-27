const fs = require('fs');
const path = require('path');

describe('Environment Validator (validate-env.js)', () => {
    let originalEnv;
    let mockConsoleError;
    let mockConsoleWarn;
    let mockProcessExit;
    let mockReadFileSync;

    // Before each test, we set up a clean environment
    beforeEach(() => {
        // Store the original process.env
        originalEnv = { ...process.env };

        // Mock console and process methods to spy on them without polluting the output
        mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => { });
        mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => { });
        mockProcessExit = jest.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit() was called'); // Throw to stop execution
        });

        // Mock fs.readFileSync to control the config content for each test
        mockReadFileSync = jest.spyOn(fs, 'readFileSync');

        // Reset modules to ensure validate-env.js is re-evaluated with new mocks
        jest.resetModules();
    });

    // After each test, we restore the original environment
    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    const runValidator = () => {
        try {
            require('../validate-env.js');
        } catch (e) {
            // We expect the process.exit mock to throw, so we can catch it here.
            if (e.message !== 'process.exit() was called') {
                throw e;
            }
        }
    };

    const mockConfig = (configObject) => {
        mockReadFileSync.mockReturnValue(JSON.stringify(configObject));
    };

    it('should pass validation when all required variables are set', () => {
        mockConfig({
            mediaServers: [{
                enabled: true,
                type: 'plex',
                hostnameEnvVar: 'PLEX_HOST',
                portEnvVar: 'PLEX_PORT',
                tokenEnvVar: 'PLEX_TOKEN'
            }]
        });
        process.env.PLEX_HOST = 'localhost';
        process.env.PLEX_PORT = '32400';
        process.env.PLEX_TOKEN = 'valid-token';

        runValidator();

        expect(mockProcessExit).not.toHaveBeenCalled();
        expect(mockConsoleError).not.toHaveBeenCalled();
    });

    it('should exit with an error if a required environment variable is missing', () => {
        mockConfig({
            mediaServers: [{ enabled: true, type: 'plex', tokenEnvVar: 'PLEX_TOKEN' }]
        });
        // PLEX_TOKEN is missing from process.env

        runValidator();

        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Missing required environment variables'));
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('- PLEX_TOKEN'));
    });

    it('should warn but not exit if no media servers are enabled', () => {
        mockConfig({
            mediaServers: [{ enabled: false, type: 'plex', tokenEnvVar: 'PLEX_TOKEN' }]
        });

        runValidator();

        expect(mockProcessExit).not.toHaveBeenCalled();
        expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining('WARNING: No media servers are enabled'));
    });

    it('should handle a missing mediaServers array gracefully', () => {
        mockConfig({ someOtherKey: 'value' }); // config.json without mediaServers

        runValidator();

        expect(mockProcessExit).not.toHaveBeenCalled();
        expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining('WARNING: No media servers are enabled'));
    });

    it('should exit with an error if config.json cannot be parsed', () => {
        mockReadFileSync.mockImplementation(() => {
            throw new Error('JSON Parse Error');
        });

        runValidator();

        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('FATAL ERROR: Could not read or parse config.json'));
    });
});