#!/usr/bin/env node
/**
 * Generate a per-file coverage table (Statements, Branches, Functions, Lines)
 * using Istanbul JSON (coverage/coverage-final.json) and LCOV (coverage/lcov.info),
 * compare against per-file thresholds defined in jest.config.js, and write docs/COVERAGE.md.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_DIR = path.join(ROOT, 'coverage');
const JSON_PATH = path.join(COVERAGE_DIR, 'coverage-final.json');
const LCOV_PATH = path.join(COVERAGE_DIR, 'lcov.info');
const OUTPUT_MD = path.join(ROOT, 'docs', 'COVERAGE.md');
const JEST_CONFIG_PATH = path.join(ROOT, 'jest.config.js');

function toRel(filePath) {
    // Normalize absolute paths from JSON to repo-relative like 'middleware/cache.js'
    if (!filePath) return filePath;
    const absRoot = ROOT + path.sep;
    let p = filePath.replace(/\\/g, '/');
    const rootNorm = absRoot.replace(/\\/g, '/');
    if (p.startsWith(rootNorm)) p = p.slice(rootNorm.length);
    // Some LCOV entries may already be relative
    return p;
}

function percent(covered, total) {
    if (!Number.isFinite(total) || total <= 0) return 100;
    return (covered / total) * 100;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

function loadThresholds() {
    try {
        // eslint-disable-next-line import/no-dynamic-require, global-require
        const jestConfig = require(JEST_CONFIG_PATH);
        const thresholds = jestConfig.coverageThreshold || {};
        const perFile = { ...thresholds };
        delete perFile.global;
        return perFile;
    } catch (e) {
        return {};
    }
}

function parseCoverageJson(filePath) {
    const out = {};
    if (!fs.existsSync(filePath)) return out;
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    Object.entries(json).forEach(([absPath, data]) => {
        const rel = toRel(data.path || absPath);
        const sVals = Object.values(data.s || {});
        const fVals = Object.values(data.f || {});
        const bVals = Object.values(data.b || {});

        const statements = {
            total: sVals.length,
            covered: sVals.filter(v => v > 0).length,
        };
        const functions = {
            total: fVals.length,
            covered: fVals.filter(v => v > 0).length,
        };
        // Branches: each entry is an array of hits for branch paths
        let branchesTotal = 0;
        let branchesCovered = 0;
        bVals.forEach(arr => {
            if (Array.isArray(arr)) {
                branchesTotal += arr.length;
                branchesCovered += arr.filter(v => v > 0).length;
            }
        });
        out[rel] = out[rel] || {};
        out[rel].statements = statements;
        out[rel].functions = functions;
        out[rel].branches = { total: branchesTotal, covered: branchesCovered };
    });
    return out;
}

function parseLCOV(filePath) {
    const out = {};
    if (!fs.existsSync(filePath)) return out;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let current = null;

    for (const line of lines) {
        if (line.startsWith('SF:')) {
            const file = toRel(line.slice(3));
            current = {
                file,
                lines: { total: 0, covered: 0 },
                functions: { total: 0, covered: 0 },
                branches: { total: 0, covered: 0 },
            };
            out[file] = out[file] || {};
        } else if (current && line.startsWith('LF:')) {
            current.lines.total = Number(line.slice(3)) || 0;
        } else if (current && line.startsWith('LH:')) {
            current.lines.covered = Number(line.slice(3)) || 0;
        } else if (current && line.startsWith('FNF:')) {
            current.functions.total = Number(line.slice(4)) || 0;
        } else if (current && line.startsWith('FNH:')) {
            current.functions.covered = Number(line.slice(4)) || 0;
        } else if (current && line.startsWith('BRF:')) {
            current.branches.total = Number(line.slice(4)) || 0;
        } else if (current && line.startsWith('BRH:')) {
            current.branches.covered = Number(line.slice(4)) || 0;
        } else if (line === 'end_of_record') {
            // commit current
            if (current) {
                const rel = current.file;
                out[rel] = out[rel] || {};
                out[rel].lines = current.lines;
                out[rel].functions = current.functions;
                out[rel].branches = current.branches;
            }
            current = null;
        }
    }
    return out;
}

function mergeMetrics(jsonMetrics, lcovMetrics) {
    // Prefer Istanbul JSON for statements; use LCOV for lines. For functions/branches prefer JSON when present.
    const files = new Set([...Object.keys(jsonMetrics), ...Object.keys(lcovMetrics)]);
    const out = {};
    for (const file of files) {
        const jm = jsonMetrics[file] || {};
        const lm = lcovMetrics[file] || {};
        out[file] = {
            statements: jm.statements || { total: 0, covered: 0 },
            functions: jm.functions || lm.functions || { total: 0, covered: 0 },
            branches: jm.branches || lm.branches || { total: 0, covered: 0 },
            lines: lm.lines || { total: 0, covered: 0 },
        };
    }
    return out;
}

function formatRow(cells) {
    return `| ${cells.join(' | ')} |`;
}

function badge(ok) {
    return ok ? '✅' : '❌';
}

function meetsThresholds(metrics, thresholds) {
    if (!thresholds) return { ok: true, fails: [] };
    const fails = [];
    const { statements, branches, functions, lines } = thresholds;
    const sPct = percent(metrics.statements.covered, metrics.statements.total);
    const bPct = percent(metrics.branches.covered, metrics.branches.total);
    const fPct = percent(metrics.functions.covered, metrics.functions.total);
    const lPct = percent(metrics.lines.covered, metrics.lines.total);
    if (Number.isFinite(statements) && sPct + 1e-9 < statements)
        fails.push(`statements ${round2(sPct)}% < ${statements}%`);
    if (Number.isFinite(branches) && bPct + 1e-9 < branches)
        fails.push(`branches ${round2(bPct)}% < ${branches}%`);
    if (Number.isFinite(functions) && fPct + 1e-9 < functions)
        fails.push(`functions ${round2(fPct)}% < ${functions}%`);
    if (Number.isFinite(lines) && lPct + 1e-9 < lines)
        fails.push(`lines ${round2(lPct)}% < ${lines}%`);
    return { ok: fails.length === 0, fails };
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function run() {
    if (!fs.existsSync(COVERAGE_DIR)) {
        console.error(
            'Coverage directory not found. Run tests with coverage first: npm run test:coverage'
        );
        process.exit(1);
    }
    const thresholds = loadThresholds();
    const json = parseCoverageJson(JSON_PATH);
    const lcov = parseLCOV(LCOV_PATH);
    const metrics = mergeMetrics(json, lcov);

    const files = Object.keys(metrics).sort((a, b) => a.localeCompare(b));

    // Prepare rows sorted by lowest statements coverage first for quick triage
    const rows = files
        .map(file => {
            const m = metrics[file];
            const sPct = round2(percent(m.statements.covered, m.statements.total));
            const bPct = round2(percent(m.branches.covered, m.branches.total));
            const fPct = round2(percent(m.functions.covered, m.functions.total));
            const lPct = round2(percent(m.lines.covered, m.lines.total));
            const th = thresholds[file];
            const { ok, fails } = meetsThresholds(m, th);
            return {
                file,
                sPct,
                bPct,
                fPct,
                lPct,
                thOk: ok,
                thFails: fails,
                m,
            };
        })
        .sort((a, b) => a.sPct - b.sPct);

    const below = rows.filter(r => r.thFails.length > 0);
    const above = rows.filter(r => r.thFails.length === 0);

    const lines = [];
    lines.push('# Coverage Report (Per-file)');
    lines.push('');
    lines.push(
        'This table is generated from Istanbul JSON and LCOV after running tests with coverage.'
    );
    lines.push('To regenerate: npm run coverage:table');
    lines.push('');

    if (below.length) {
        lines.push('## Files below thresholds');
        lines.push('');
        lines.push(
            formatRow([
                'File',
                'Statements %',
                'Branches %',
                'Functions %',
                'Lines %',
                'Threshold status',
            ])
        );
        lines.push('|---|---:|---:|---:|---:|---|');
        below.forEach(r => {
            const status = `${badge(false)} ${r.thFails.join('; ')}`;
            lines.push(
                formatRow([r.file, `${r.sPct}`, `${r.bPct}`, `${r.fPct}`, `${r.lPct}`, status])
            );
        });
        lines.push('');
    } else {
        lines.push('## All files meet configured per-file thresholds');
        lines.push('');
    }

    lines.push('## Full per-file coverage');
    lines.push('');
    lines.push(
        formatRow([
            'File',
            'Statements (cov/total)',
            'Statements %',
            'Branches (cov/total)',
            'Branches %',
            'Functions (cov/total)',
            'Functions %',
            'Lines (cov/total)',
            'Lines %',
            'Meets thresholds',
        ])
    );
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|:--:|');
    rows.forEach(r => {
        const s = `${r.m.statements.covered}/${r.m.statements.total}`;
        const b = `${r.m.branches.covered}/${r.m.branches.total}`;
        const f = `${r.m.functions.covered}/${r.m.functions.total}`;
        const l = `${r.m.lines.covered}/${r.m.lines.total}`;
        lines.push(
            formatRow([
                r.file,
                s,
                `${r.sPct}`,
                b,
                `${r.bPct}`,
                f,
                `${r.fPct}`,
                l,
                `${r.lPct}`,
                badge(r.thFails.length === 0),
            ])
        );
    });

    ensureDir(path.dirname(OUTPUT_MD));
    fs.writeFileSync(OUTPUT_MD, lines.join('\n') + '\n');
    console.log(`Wrote ${path.relative(ROOT, OUTPUT_MD)} with ${rows.length} files.`);
    if (below.length) {
        console.log(`Files below thresholds: ${below.length}`);
        below.slice(0, 10).forEach(r => console.log(` - ${r.file}: ${r.thFails.join('; ')}`));
    }
}

run();
