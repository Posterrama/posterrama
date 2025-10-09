const { verifySwagger } = require('../../scripts/lib/swaggerVerifier');
const path = require('path');
const { execFileSync } = require('child_process');

describe('Swagger Verifier', () => {
    test('module verifySwagger returns empty missing/orphaned', () => {
        const { missing, orphaned } = verifySwagger();
        expect(Array.isArray(missing)).toBe(true);
        expect(Array.isArray(orphaned)).toBe(true);
        expect(missing).toHaveLength(0);
        expect(orphaned).toHaveLength(0);
    });

    test('CLI script exits 0 on clean state', () => {
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-swagger-docs.js');
        expect(() => execFileSync('node', [scriptPath], { stdio: 'pipe' })).not.toThrow();
    });
});
