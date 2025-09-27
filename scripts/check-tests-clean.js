#!/usr/bin/env node
/*
 * Test Hygiene Guard
 * Fails (exit 1) if focused/ skipped / pending tests slip into the codebase.
 * Allowed patterns (maintain small allowlist below) can be whitelisted intentionally.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '__tests__');

// Maintain tiny allowlists if ever required (currently empty for strict mode)
const allowFiles = new Set(); // e.g. add relative paths like '__tests__/legacy/some.test.js'

const patterns = [
    { label: 'focused test (.only)', regex: /\b(?:it|test|describe)\.only\(/ },
    { label: 'skipped test (.skip)', regex: /\b(?:it|test|describe)\.skip\(/ },
    { label: 'skipped alias (xit/xdescribe)', regex: /\b(?:xit|xdescribe)\(/ },
    { label: 'todo test (test.todo)', regex: /\btest\.todo\(/ },
];

// Detect basic pending tests: test('name') with no callback argument.
// Heuristic: match test(<string or template>) followed by optional whitespace and a closing paren
// Not preceded by a dot (to avoid picking up .only/.skip variants redundantly)
// Refined: capture test(<name>) where same line does NOT contain a comma (argument separator),
// '=>' (arrow function), 'function', or a second opening brace before end, reducing false positives.
// We'll simply scan lines instead of big regex across file.
function detectPendingTests(text) {
    const lines = text.split(/\n/);
    const pendings = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!/\btest\s*\(/.test(line)) continue;
        // Skip legitimate implemented tests
        if (/(,|=>|function\s*\(|\{)/.test(line)) continue;
        // Also skip lines that end with a comma (multi-line arg start)
        if (/,$/.test(line)) continue;
        // Looks like: test('name') or test("name") alone
        if (/^test\s*\(\s*['"`].+['"`]\s*\)$/.test(line)) {
            pendings.push(line);
        }
    }
    return pendings;
}

const violations = [];

function scanFile(file) {
    const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    if (allowFiles.has(rel)) return; // skip allowlisted file

    for (const p of patterns) {
        if (p.regex.test(text)) {
            violations.push({ file: rel, label: p.label });
        }
    }
    // Pending test detection (skip if already matched skip/focus/todo for this file line)
    const pendingLines = detectPendingTests(text);
    for (const line of pendingLines) {
        violations.push({ file: rel, label: 'pending test (no implementation)', line });
    }
}

function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (/\.(test|spec)\.js$/.test(entry)) scanFile(full);
    }
}

walk(ROOT);

if (violations.length) {
    console.error('\n❌ Test hygiene check failed:');
    for (const v of violations) {
        console.error(` - ${v.label} in ${v.file}${v.line ? ' :: ' + v.line.trim() : ''}`);
    }
    console.error(
        '\nTo intentionally allow one, add it to allowFiles in scripts/check-tests-clean.js'
    );
    process.exit(1);
} else {
    console.log('✅ Test hygiene check: clean (no focused/ skipped / pending tests found).');
}
