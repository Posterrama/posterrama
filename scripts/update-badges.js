#!/usr/bin/env node
/**
 * Update README badges for tests count and coverage percentage.
 * - Reads coverage from coverage/coverage-final.json (lines.pct)
 * - Reads tests/suites from jest-results.json (numTotalTests/numTotalTestSuites)
 * - Replaces badges in README.md:
 *    Tests badge: tests-<num>%20tests%20in%20<suited>%20suites
 *    Coverage badge: coverage-<pct>%25
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

function run() {
    const repoRoot = path.resolve(__dirname, '..');
    const coveragePath = path.resolve(repoRoot, 'coverage', 'coverage-final.json');
    const jestResultsPath = path.resolve(repoRoot, 'jest-results.json');
    const pkgPath = path.resolve(repoRoot, 'package.json');
    const readmePath = path.resolve(repoRoot, 'README.md');

    const coverageJson = readJSON(coveragePath);
    const jestJson = readJSON(jestResultsPath);
    const pkgJson = readJSON(pkgPath);

    if (!fs.existsSync(readmePath)) {
        console.error('README.md not found, skipping badge update');
        process.exit(0);
    }

    let readme = fs.readFileSync(readmePath, 'utf8');
    let changed = false;

    // Update coverage badge
    if (
        coverageJson &&
        coverageJson.total &&
        coverageJson.total.lines &&
        typeof coverageJson.total.lines.pct === 'number'
    ) {
        const pct = formatPct(coverageJson.total.lines.pct);
        const covRe = /(coverage-)\d+(?:\.\d+)?%25/;
        const newStr = `coverage-${pct}%25`;
        if (covRe.test(readme)) {
            readme = readme.replace(covRe, newStr);
            changed = true;
            console.log(`Updated coverage badge to ${pct}%`);
        }
    } else {
        console.warn('coverage-final.json missing or malformed; skipping coverage badge update');
    }

    // Update tests badge
    if (jestJson && typeof jestJson.numTotalTests === 'number') {
        const tests = jestJson.numTotalTests;
        const suites =
            typeof jestJson.numTotalTestSuites === 'number'
                ? jestJson.numTotalTestSuites
                : Array.isArray(jestJson.testResults)
                  ? jestJson.testResults.length
                  : undefined;
        if (typeof suites === 'number') {
            const testsRe = /(tests-)\d+%20tests%20in%20\d+%20suites/;
            const newTestsStr = `tests-${tests}%20tests%20in%20${suites}%20suites`;
            if (testsRe.test(readme)) {
                readme = readme.replace(testsRe, newTestsStr);
                changed = true;
                console.log(`Updated tests badge to ${tests} tests in ${suites} suites`);
            }
        }
    } else {
        console.warn('jest-results.json missing; skipping tests badge update');
    }

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
