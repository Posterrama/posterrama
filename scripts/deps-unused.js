#!/usr/bin/env node
/*
 * deps-unused.js
 * Programmatic depcheck wrapper with allowlists and CI-friendly output.
 */
const depcheck = require('depcheck');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// Allowlist (packages we intentionally keep even if depcheck can't see usage)
const ALLOW_UNUSED = new Set([
    // Tools invoked only in shell scripts or via npx patterns
    'audit-ci',
    // Used by eslint flat config system (indirect import via @eslint/js)
    '@eslint/eslintrc',
]);

// Packages whose missing usage we want to suppress (dynamic / optional / vendor)
const IGNORE_MISSING = new Set([
    'chart.js', // Loaded via CDN or vendor files in public/vendor/
    'luxon', // Loaded via CDN or vendor files in public/vendor/
    'winston-transport', // Transient dependency of winston, not directly required
]);

const options = {
    ignorePatterns: ['coverage', 'logs', 'cache', 'image_cache', 'sessions', 'backups'],
    ignoreMatches: [
        // Glob patterns to skip (none yet)
    ],
};

function formatList(list) {
    return list.length
        ? list
              .sort()
              .map(x => `  - ${x}`)
              .join('\n')
        : '  (none)';
}

(async () => {
    try {
        const result = await depcheck(projectRoot, options);

        const unusedDeps = result.dependencies.filter(d => !ALLOW_UNUSED.has(d));
        const unusedDevDeps = result.devDependencies.filter(d => !ALLOW_UNUSED.has(d));

        // Filter missing: omit ignore list
        const missingEntries = Object.entries(result.missing)
            .filter(([name]) => !IGNORE_MISSING.has(name))
            .map(([name, files]) => ({ name, files }));

        const hasIssues = unusedDeps.length || unusedDevDeps.length || missingEntries.length;

        console.log('Dependency Audit (depcheck wrapper)');
        console.log('===================================');
        console.log('\nUnused PROD dependencies:');
        console.log(formatList(unusedDeps));
        console.log('\nUnused DEV dependencies:');
        console.log(formatList(unusedDevDeps));
        console.log('\nMissing dependencies (not ignored):');
        if (missingEntries.length) {
            missingEntries.sort((a, b) => a.name.localeCompare(b.name));
            for (const m of missingEntries) {
                console.log(`  - ${m.name}`);
                m.files
                    .slice(0, 5)
                    .forEach(f => console.log(`      * ${path.relative(projectRoot, f)}`));
                if (m.files.length > 5) console.log('      * ...');
            }
        } else {
            console.log('  (none)');
        }

        console.log('\nAllowlisted unused (kept):');
        if (ALLOW_UNUSED.size) {
            [...ALLOW_UNUSED].sort().forEach(p => console.log(`  - ${p}`));
        } else {
            console.log('  (none)');
        }

        console.log('\nIgnored missing (optional):');
        if (IGNORE_MISSING.size) {
            [...IGNORE_MISSING].sort().forEach(p => console.log(`  - ${p}`));
        } else {
            console.log('  (none)');
        }

        if (hasIssues) {
            console.log('\nResult: ISSUES FOUND');
            process.exitCode = 1; // mark non-zero for CI if any real issues
        } else {
            console.log('\nResult: CLEAN');
        }
    } catch (err) {
        console.error('depcheck wrapper failed:', err);
        process.exitCode = 2;
    }
})();
