const fs = require('fs');
const path = require('path');
const glob = require('glob');

function isInternalViaNearbySwaggerBlock(lines, lineIdx) {
    // Look for the closest preceding @swagger block (not the first within a window).
    // The previous implementation scanned forwards and could incorrectly associate
    // an earlier x-internal block with a later, unrelated route.
    const startIdx = Math.max(0, lineIdx - 200);
    for (let i = lineIdx - 1; i >= startIdx; i--) {
        if (/^\s*\*\s+@swagger/.test(lines[i])) {
            for (let j = i; j <= lineIdx && j < lines.length; j++) {
                if (/x-internal:\s*true/.test(lines[j])) return true;
                if (/^\s*\*\//.test(lines[j])) break;
            }
            return false;
        }
    }
    return false;
}

function loadServerFile() {
    const SERVER_FILE = path.join(__dirname, '..', '..', 'server.js');
    return fs.readFileSync(SERVER_FILE, 'utf8');
}

function loadRouteFiles() {
    const routesDir = path.join(__dirname, '..', '..', 'routes');
    const routeFiles = glob.sync(path.join(routesDir, '**', '*.js'));
    return routeFiles.map(file => ({
        path: file,
        content: fs.readFileSync(file, 'utf8'),
    }));
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
        if (isInternalViaNearbySwaggerBlock(lines, lineIdx)) continue;
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

function buildRouterRouteSet(fileText) {
    // For router-based routes: router.get('/', ...) or router.post('/path', ...)
    const routerRegex = /router\.(get|post|put|delete|patch)\(\s*['"](\/[^'"\s]*|\/)/g;
    const lines = fileText.split(/\n/);
    const routes = [];
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
    while ((m = routerRegex.exec(fileText)) !== null) {
        const method = m[1].toLowerCase();
        const routePath = m[2];
        const idx = m.index;
        const lineIdx = lineNumberFromIndex(idx);
        if (isInternalViaNearbySwaggerBlock(lines, lineIdx)) continue;
        const openApiPath = routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        routes.push({ method, path: openApiPath });
    }
    return routes;
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
    const routeFiles = loadRouteFiles();
    const spec = loadSpec();
    if (!spec || !spec.paths) throw new Error('Swagger spec missing paths property');

    // Collect routes from server.js
    const expressRoutes = buildExpressRouteSet(fileText);

    // Collect routes from route modules and map them to their mount points
    // Infer mount points from server.js app.use() statements
    const mountPoints = new Map();
    const mountRegex = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*create\w+Router/g;
    let mountMatch;
    while ((mountMatch = mountRegex.exec(fileText)) !== null) {
        const mountPath = mountMatch[1];
        // Store for later matching with route files
        mountPoints.set(mountPath, true);
    }

    // Known mount points for route modules.
    // IMPORTANT: many routers define absolute paths (e.g. '/api/...') already, so mount prefixes should
    // only be used for routers that use relative paths.
    const routeMountMap = {
        'config-public.js': '/get-config',
        'auth.js': '/admin',
        'devices.js': '/api/devices',
        'profiles.js': '/api/profiles',
    };

    /**
     * Combine a mount prefix (e.g. '/api/devices') with a router path (e.g. '/register').
     * - If the router path is absolute API/public (starts with '/api/' or is in PUBLIC_ALLOWLIST),
     *   we assume it's already fully-qualified and do not prefix.
     * - Preserve '/' when both mountPrefix and routePath are root.
     */
    function combineMountPath(mountPrefix, routePath) {
        const normalizedMount = mountPrefix || '';
        const normalizedRoute = routePath || '';

        // If route file already declares an absolute API/public path, do not prefix.
        if (normalizedRoute.startsWith('/api/') || PUBLIC_ALLOWLIST.has(normalizedRoute)) {
            return normalizedRoute;
        }

        if (!normalizedMount) {
            return normalizedRoute === '' ? '/' : normalizedRoute;
        }

        if (normalizedRoute === '/' || normalizedRoute === '') {
            return normalizedMount;
        }

        // Both are expected to start with '/', but normalize just in case.
        const a = normalizedMount.endsWith('/') ? normalizedMount.slice(0, -1) : normalizedMount;
        const b = normalizedRoute.startsWith('/') ? normalizedRoute : `/${normalizedRoute}`;
        return a + b;
    }

    for (const { path: filePath, content } of routeFiles) {
        const fileName = path.basename(filePath);
        const mountPrefix = routeMountMap[fileName] || '';
        const routerRoutes = buildRouterRouteSet(content);
        for (const route of routerRoutes) {
            // Combine mount prefix with route path
            const fullPath = combineMountPath(mountPrefix, route.path);
            expressRoutes.push({ method: route.method, path: fullPath });
        }
    }

    const documented = new Set();
    for (const [p, methods] of Object.entries(spec.paths)) {
        for (const method of Object.keys(methods)) documented.add(method.toLowerCase() + ' ' + p);
    }
    const uniqueExpress = new Map();
    for (const r of expressRoutes) uniqueExpress.set(r.method + ' ' + r.path, r);
    const missing = []; // exists in code but not in spec
    for (const key of uniqueExpress.keys()) {
        const [_method, p] = key.split(' ');
        if (!isMonitoredPath(p)) continue;
        if (!documented.has(key)) missing.push(key);
    }
    const orphaned = []; // exists in spec but not in code
    for (const key of documented) {
        const [method, p] = key.split(' ');
        if (!isMonitoredPath(p)) continue;
        // Skip x-internal routes from orphaned check - they may be conditionally mounted
        const pathSpec = spec.paths[p];
        if (pathSpec && pathSpec[method] && pathSpec[method]['x-internal'] === true) continue;
        if (!uniqueExpress.has(key)) orphaned.push(key);
    }
    return { missing: missing.sort(), orphaned: orphaned.sort() };
}

module.exports = { verifySwagger };
