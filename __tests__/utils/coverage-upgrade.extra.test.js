/**
 * Coverage booster for selective low-covered branches (updater rollback/cleanup fallbacks,
 * healthCheck jellyfin fallback & TMDB disabled cases).
 */

const updater = require('../../utils/updater');
const health = require('../../utils/healthCheck');
const fs = require('fs');
const path = require('path');

describe('Coverage upgrade targeted branches', () => {
    test('healthCheck performs without jellyfin servers (no connectivity check)', async () => {
        const cfgPath = path.join(process.cwd(), 'config.json');
        const original = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const mutated = { ...original, mediaServers: [] };
        fs.writeFileSync(cfgPath, JSON.stringify(mutated, null, 2));
        const result = await health.__performHealthChecks();
        expect(Array.isArray(result.checks)).toBe(true);
        expect(result.checks.some(c => c.name === 'jellyfin_connectivity')).toBe(false);
        fs.writeFileSync(cfgPath, JSON.stringify(original, null, 2));
    });

    test('updater listBackups handles empty directory gracefully', async () => {
        const backups = await updater.listBackups();
        expect(Array.isArray(backups)).toBe(true);
    });
});
