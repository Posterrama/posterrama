const fs = require('fs');
const path = require('path');

function stripComments(source) {
    // Remove block comments first, then line comments.
    // This is a heuristic for tests only.
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('Security regression: admin endpoints require auth middleware', () => {
    test('all /api/admin/* routes include an auth middleware', () => {
        const routesDir = path.join(__dirname, '..', '..', 'routes');
        const files = fs
            .readdirSync(routesDir)
            .filter(name => name.endsWith('.js'))
            .map(name => path.join(routesDir, name));

        const findings = [];

        for (const filePath of files) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const source = stripComments(raw);

            const lines = source.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!/router\.(get|post|put|patch|delete)\(/.test(line)) continue;
                if (!line.includes('/api/admin/')) continue;

                const window = lines.slice(i, i + 25).join('\n');
                const hasAuth =
                    window.includes('adminAuth') ||
                    window.includes('isAuthenticated') ||
                    window.includes('createMetricsAuth');

                if (!hasAuth) {
                    findings.push({
                        file: path.relative(process.cwd(), filePath),
                        line: i + 1,
                        snippet: line.trim(),
                    });
                }
            }
        }

        // Guard: ensure the scan actually found admin routes
        expect(files.length).toBeGreaterThan(0);
        // If we found any violations, fail with a readable summary.
        expect(findings).toEqual([]);
    });
});
