#!/usr/bin/env node
/**
 * Update README badges:
 *  - Coverage badge (from coverage-final.json total.lines.pct) with dynamic color
 *  - Version badge (from package.json)
 */
const fs = require('fs');
const path = require('path');

function readJSON(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        return null;
    }
}

function formatPct(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
}

function colorFor(pct) {
    const n = typeof pct === 'string' ? parseFloat(pct) : pct;
    if (n >= 90) return 'brightgreen';
    if (n >= 80) return 'green';
    if (n >= 70) return 'yellowgreen';
    if (n >= 60) return 'yellow';
    if (n >= 50) return 'orange';
    return 'red';
}

function run() {
    // Only update badges in CI on the main branch to avoid local README churn
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const refName = process.env.GITHUB_REF_NAME || '';
    const ref = process.env.GITHUB_REF || '';
    const branch = refName || (ref.startsWith('refs/heads/') ? ref.replace('refs/heads/', '') : '');
    if (!isCI || (branch && branch !== 'main')) {
        console.log('Skipping badge update (not CI on main)');
        return;
    }

    const repoRoot = path.resolve(__dirname, '..');
    const coveragePath = path.resolve(repoRoot, 'coverage', 'coverage-final.json');
    const lcovPath = path.resolve(repoRoot, 'coverage', 'lcov.info');
    const pkgPath = path.resolve(repoRoot, 'package.json');
    const readmePath = path.resolve(repoRoot, 'README.md');

    const coverageJson = readJSON(coveragePath);
    const pkgJson = readJSON(pkgPath);

    if (!fs.existsSync(readmePath)) {
        console.error('README.md not found, skipping badge update');
        process.exit(0);
    }

    let readme = fs.readFileSync(readmePath, 'utf8');
    let changed = false;

    // Update coverage badge (number and color). Prefer JSON total if available, otherwise fallback to LCOV.
    let pct = null;
    if (
        coverageJson &&
        coverageJson.total &&
        coverageJson.total.lines &&
        typeof coverageJson.total.lines.pct === 'number'
    ) {
        pct = formatPct(coverageJson.total.lines.pct);
    } else if (fs.existsSync(lcovPath)) {
        // Compute from LCOV (sum LH/LF across all records)
        const content = fs.readFileSync(lcovPath, 'utf8');
        let total = 0;
        let covered = 0;
        for (const line of content.split(/\r?\n/)) {
            if (line.startsWith('LF:')) total += Number(line.slice(3)) || 0;
            if (line.startsWith('LH:')) covered += Number(line.slice(3)) || 0;
        }
        if (total > 0) pct = formatPct((covered / total) * 100);
    }

    if (pct !== null) {
        const color = colorFor(pct);
        // Replace full shields URL segment for coverage (handles HTML <img> src attributes)
        const covUrlRe =
            /(https:\/\/img\.shields\.io\/badge\/coverage-)\d+(?:\.\d+)?%25-[a-z]+(\.svg)/i;
        const newSeg = `$1${pct}%25-${color}$2`;
        if (covUrlRe.test(readme)) {
            readme = readme.replace(covUrlRe, newSeg);
            changed = true;
            console.log(`Updated coverage badge to ${pct}% (${color})`);
        }
    } else {
        console.warn('coverage-final.json missing or malformed; skipping coverage badge update');
    }

    // Tests badge removed by request; no longer updated

    // Update version badge (from package.json)
    if (pkgJson && typeof pkgJson.version === 'string') {
        const version = pkgJson.version;
        const verRe = /(version-)([0-9A-Za-z_.-]+)(-blue\.svg)/;
        if (verRe.test(readme)) {
            const before = readme;
            readme = readme.replace(verRe, `$1${version}$3`);
            if (readme !== before) {
                changed = true;
                console.log(`Updated version badge to ${version}`);
            }
        }
    }

    if (changed) {
        fs.writeFileSync(readmePath, readme);
        console.log('README.md badges updated');
    } else {
        console.log('No badge changes applied');
    }
}

run();
