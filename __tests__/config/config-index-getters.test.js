const path = require('path');

// Set up required environment variables before any config loading
process.env.PLEX_TOKEN = 'test-token';

/**
 * Tests for config/index.js getter helpers to raise coverage on simple
 * precedence + parsing logic (get, getInt, getBool, defaults).
 */

describe('config/index.js getters', () => {
    const originalEnv = { ...process.env };
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let originalConfigContent;

    beforeAll(() => {
        originalConfigContent = require('fs').readFileSync(configPath, 'utf8');
    });

    afterEach(() => {
        // restore env and config cache between tests
        process.env = { ...originalEnv };
        jest.resetModules();
        require('fs').writeFileSync(configPath, originalConfigContent);
    });

    afterAll(() => {
        process.env = originalEnv;
        require('fs').writeFileSync(configPath, originalConfigContent);
    });

    test('get falls back: env > config > defaults', () => {
        const fs = require('fs');
        const cfg = JSON.parse(originalConfigContent);
        cfg.testKeyConfig = 'fromConfig';
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

        process.env.testKeyConfig = 'fromEnv';

        const config = require('../../config/index.js');
        expect(config.get('testKeyConfig')).toBe('fromEnv');
        // remove env to hit config
        delete process.env.testKeyConfig;
        jest.resetModules();
        const config2 = require('../../config/index.js');
        expect(config2.get('testKeyConfig')).toBe('fromConfig');
    });

    test('getInt parses integers and null on falsy', () => {
        const fs = require('fs');
        const cfg = JSON.parse(originalConfigContent);
        cfg.someInt = 42;
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        const config = require('../../config/index.js');

        expect(config.getInt('someInt')).toBe(42);

        process.env.someInt = '100';
        jest.resetModules();
        const config2 = require('../../config/index.js');
        expect(config2.getInt('someInt')).toBe(100);

        // falsy -> null (undefined key)
        expect(config2.getInt('doesNotExist')).toBeNull();
    });

    test('getBool recognizes string true and boolean true only', () => {
        const fs = require('fs');
        const cfg = JSON.parse(originalConfigContent);
        cfg.flagA = true;
        cfg.flagB = false;
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        const config = require('../../config/index.js');
        expect(config.getBool('flagA')).toBe(true);
        expect(config.getBool('flagB')).toBe(false); // false not recognized as true

        process.env.flagA = 'true';
        process.env.flagB = 'false';
        jest.resetModules();
        const config2 = require('../../config/index.js');
        expect(config2.getBool('flagA')).toBe(true);
        expect(config2.getBool('flagB')).toBe(false);
    });

    test('port getter uses SERVER_PORT env then fallback default 4000', () => {
        process.env.SERVER_PORT = '5555';
        const config = require('../../config/index.js');
        expect(config.port).toBe(5555);

        delete process.env.SERVER_PORT;
        jest.resetModules();
        // Removed unused duplicate require that triggered lint (no-unused-vars)
        // if config.json has port we cannot assert 4000, so we mimic removal by editing config
        const fs = require('fs');
        const cfg = JSON.parse(originalConfigContent);
        delete cfg.SERVER_PORT;
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        jest.resetModules();
        const config3 = require('../../config/index.js');
        expect(config3.port).toBe(4000); // default
    });
});
