/** Test support utilities (not a test suite) */
const fs = require('fs');
let realReadFile;
function loadHealthCheckWithConfig(config, { fetchMock } = {}) {
    jest.resetModules();
    const fsMod = require('fs');
    if (!realReadFile) realReadFile = fsMod.promises.readFile;
    fsMod.promises.readFile = jest.fn((p, enc) => {
        if (typeof p === 'string' && p.endsWith('config.json')) {
            return Promise.resolve(JSON.stringify(config));
        }
        return realReadFile(p, enc);
    });
    if (fetchMock) global.fetch = fetchMock;
    else delete global.fetch;
    const healthCheck = require('../utils/healthCheck');
    healthCheck.__resetCache?.();
    return healthCheck;
}
function restoreConfigMock() {
    if (realReadFile) require('fs').promises.readFile = realReadFile;
    delete global.fetch;
}
module.exports = { loadHealthCheckWithConfig, restoreConfigMock };
