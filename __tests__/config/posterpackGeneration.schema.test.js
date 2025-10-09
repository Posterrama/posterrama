const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';

describe('config.schema: posterpackGeneration concurrency/limits/retry', () => {
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    const originalConfig = fs.readFileSync(configPath, 'utf-8');

    beforeAll(() => {
        const cfg = JSON.parse(originalConfig);
        cfg.localDirectory = cfg.localDirectory || {};
        cfg.localDirectory.enabled = true;
        cfg.localDirectory.rootPath = '/tmp/posterrama-media';
        cfg.localDirectory.posterpackGeneration = cfg.localDirectory.posterpackGeneration || {};
        Object.assign(cfg.localDirectory.posterpackGeneration, {
            itemConcurrency: 3,
            assetConcurrency: 5,
            maxInflightDownloads: 10,
            retryMaxRetries: 4,
            retryBaseDelay: 250,
        });
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        jest.resetModules();
    });

    afterAll(() => {
        fs.writeFileSync(configPath, originalConfig);
        jest.resetModules();
    });

    it('accepts new posterpackGeneration fields', () => {
        const { validate } = require('../../config/validate-env');
        const result = validate();
        expect(result).toBeUndefined();
    });
});
