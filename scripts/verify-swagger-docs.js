#!/usr/bin/env node
/*
 * verify-swagger-docs.js
 * Ensures every Express app.<method>('/api...') route in server.js has a preceding @swagger JSDoc block.
 * Exits with code 1 if any undocumented API routes are found.
 */
const fs = require('fs');
const path = require('path');

const SERVER_FILE = path.join(__dirname, '..', 'server.js');
const TEXT = fs.readFileSync(SERVER_FILE, 'utf8');

// Collect all API route definitions (excluding comments) using a conservative regex.
// Match app.<method>(' /api or "/api
const routeRegex = /app\.(get|post|put|delete|patch)\(\s*['"](\/api[^'"\s]*)/g;

// Build a set of documented segments by locating @swagger blocks.
// Strategy: for each route occurrence, look back a fixed window (e.g., 30 lines) for '@swagger'.
const lines = TEXT.split(/\n/);

// Precompute line offsets for faster reverse lookup
let match;
const issues = [];

// Map file offset to line number
const offsets = [];
let pos = 0;
for (let i = 0; i < lines.length; i++) {
    offsets.push(pos);
    pos += lines[i].length + 1; // +1 for newline
}

function lineNumberFromIndex(idx) {
    // Binary search could be used; linear scan is fine for single file scale.
    let low = 0,
        high = offsets.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (offsets[mid] <= idx) {
            if (mid === offsets.length - 1 || offsets[mid + 1] > idx) return mid + 1; // 1-based
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return offsets.length; // fallback
}

while ((match = routeRegex.exec(TEXT)) !== null) {
    const method = match[1];
    const route = match[2];
    const idx = match.index;
    const lineNum = lineNumberFromIndex(idx);
    // Ignore internal/test helper routes if pattern contains _internal
    if (route.includes('_internal')) continue;
    // Look back up to 30 lines for '@swagger'
    const start = Math.max(0, lineNum - 31); // include current window
    let documented = false;
    for (let ln = lineNum - 1; ln >= start; ln--) {
        const l = lines[ln];
        if (/app\.(get|post|put|delete|patch)\(/.test(l) && ln !== lineNum - 1) {
            // Hit another route before finding @swagger -> stop
            break;
        }
        if (/@swagger/.test(l)) {
            documented = true;
            break;
        }
        // If we leave the comment block (non * line after seeing comment start) we still continue until another route or window end
    }
    if (!documented) {
        issues.push({ method, route, line: lineNum });
    }
}

if (issues.length) {
    console.error('\n❌ Swagger documentation verification failed. Undocumented API routes:');
    for (const i of issues) {
        console.error(` - [${i.method.toUpperCase()}] ${i.route} (approx line ${i.line})`);
    }
    console.error('\nAdd JSDoc @swagger blocks for the routes above.');
    process.exit(1);
} else {
    console.log('✅ Swagger documentation verification: all API routes have @swagger blocks.');
}
