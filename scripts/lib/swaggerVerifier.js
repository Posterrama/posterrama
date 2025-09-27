const fs = require('fs');
const path = require('path');

function loadServerFile() {
    const SERVER_FILE = path.join(__dirname, '..', '..', 'server.js');
    return fs.readFileSync(SERVER_FILE, 'utf8');
}

function loadSpec() {
    const swaggerModule = require('../../swagger');
    return swaggerModule && typeof swaggerModule.generate === 'function'
        ? swaggerModule.generate()
        : swaggerModule;
}

function buildExpressRouteSet(fileText) {
    const routeRegex =
        /app\.(get|post|put|delete|patch)\(\s*['"]((?:\/api[^'"\s>]*)|(?:\/(?:get-config|get-media|get-media-by-key|image|health)(?:\/[^'"\s>]*)?))/g;
    const lines = fileText.split(/\n/);
    const expressRoutes = [];
    let m;
    function lineNumberFromIndex(idx) {
        let line = 0;
        let running = 0;
        for (let i = 0; i < lines.length; i++) {
            if (running + lines[i].length + 1 > idx) {
                line = i;
                break;
            }
            running += lines[i].length + 1;
        }
        return line;
    }
    while ((m = routeRegex.exec(fileText)) !== null) {
        const method = m[1].toLowerCase();
        const rawPath = m[2];
        const idx = m.index;
        if (rawPath.includes('_internal')) continue;
        const lineIdx = lineNumberFromIndex(idx);
        let isInternal = false;
        for (let i = Math.max(0, lineIdx - 40); i < lineIdx; i++) {
            if (/^\s*\*\s+@swagger/.test(lines[i])) {
                for (let j = i; j < lineIdx; j++) {
                    if (/x-internal:\s*true/.test(lines[j])) {
                        isInternal = true;
                        break;
                    }
                    if (/^\s*\*\//.test(lines[j])) break;
                }
                break;
            }
        }
        if (isInternal) continue;
        const openApiPath = rawPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        expressRoutes.push({ method, path: openApiPath });
    }
    // Manual fallback for get-media-by-key
    if (
        !expressRoutes.some(r => r.path.startsWith('/get-media-by-key/')) &&
        /app\.get\(\s*['"]\/get-media-by-key\/:key['"]/.test(fileText)
    ) {
        expressRoutes.push({ method: 'get', path: '/get-media-by-key/{key}' });
    }
    return expressRoutes;
}

const PUBLIC_ALLOWLIST = new Set([
    '/get-config',
    '/get-media',
    '/get-media-by-key/{key}',
    '/image',
    '/health',
]);

function isMonitoredPath(p) {
    if (p.startsWith('/api/')) return true;
    return PUBLIC_ALLOWLIST.has(p);
}

function verifySwagger() {
    const fileText = loadServerFile();
    const spec = loadSpec();
    if (!spec || !spec.paths) throw new Error('Swagger spec missing paths property');
    const expressRoutes = buildExpressRouteSet(fileText);
    const documented = new Set();
    for (const [p, methods] of Object.entries(spec.paths)) {
        for (const method of Object.keys(methods)) documented.add(method.toLowerCase() + ' ' + p);
    }
    const uniqueExpress = new Map();
    for (const r of expressRoutes) uniqueExpress.set(r.method + ' ' + r.path, r);
    const missing = []; // exists in code but not in spec
    for (const key of uniqueExpress.keys()) if (!documented.has(key)) missing.push(key);
    const orphaned = []; // exists in spec but not in code
    for (const key of documented) {
        const [, p] = key.split(' ');
        if (!isMonitoredPath(p)) continue;
        if (!uniqueExpress.has(key)) orphaned.push(key);
    }
    return { missing: missing.sort(), orphaned: orphaned.sort() };
}

module.exports = { verifySwagger };
