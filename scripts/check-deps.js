const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
]);

const findImports = (dir, imports = new Set()) => {
    try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                if (
                    ![
                        'node_modules',
                        '.git',
                        'coverage',
                        'logs',
                        'cache',
                        'image_cache',
                        'backups',
                        'screenshots',
                        'sessions',
                        'private',
                        'media',
                    ].includes(file.name)
                ) {
                    findImports(fullPath, imports);
                }
            } else if (
                file.name.endsWith('.js') &&
                !file.name.includes('.test.') &&
                !file.name.includes('.spec.')
            ) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const requireMatches = content.matchAll(/require\(['"]([^'"]+)['"]\)/g);
                    const importMatches = content.matchAll(/import .* from ['"]([^'"]+)['"]/g);
                    for (const match of requireMatches) {
                        const mod = match[1];
                        if (!mod.startsWith('.') && !mod.startsWith('/')) {
                            imports.add(mod.split('/')[0]);
                        }
                    }
                    for (const match of importMatches) {
                        const mod = match[1];
                        if (!mod.startsWith('.') && !mod.startsWith('/')) {
                            imports.add(mod.split('/')[0]);
                        }
                    }
                } catch (e) {
                    // Skip files that can't be read
                }
            }
        }
    } catch (e) {
        // Skip directories that can't be read
    }
    return imports;
};

const used = findImports(projectRoot);
const builtins = [
    'fs',
    'path',
    'http',
    'https',
    'url',
    'os',
    'crypto',
    'events',
    'stream',
    'util',
    'buffer',
    'child_process',
    'querystring',
    'assert',
    'zlib',
    'net',
    'tls',
    'dns',
    'dgram',
    'readline',
    'repl',
    'vm',
    'cluster',
    'worker_threads',
    'perf_hooks',
    'async_hooks',
    'string_decoder',
    'timers',
    'console',
    'module',
    'process',
    'v8',
    'inspector',
];
const missing = [...used].filter(
    m => !declared.has(m) && !builtins.includes(m) && !m.startsWith('node:')
);

if (missing.length > 0) {
    console.log('❌ Missing dependencies:');
    missing.forEach(m => console.log('  -', m));
    process.exit(1);
} else {
    console.log('✅ All used dependencies are declared in package.json');
}
