#!/usr/bin/env node
/*
 * Cleanup script to remove placeholder / test pollution groups named 'G Wait'.
 * Options:
 *   --dry-run : Show what would be removed without writing.
 *   --keep N  : Keep at most N newest groups (default 0) matching placeholder name.
 *   --file path : Target groups store file (defaults to ./groups.json relative to project root).
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { dry: false, keep: 0, file: path.join(__dirname, '..', 'groups.json') };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') args.dry = true;
        else if (a === '--keep') args.keep = Number(argv[++i] || 0) || 0;
        else if (a === '--file') args.file = path.resolve(argv[++i]);
    }
    return args;
}

async function main() {
    const opts = parseArgs(process.argv);
    if (!fs.existsSync(opts.file)) {
        console.error('Groups file not found:', opts.file);
        process.exit(1);
    }
    const raw = fs.readFileSync(opts.file, 'utf8');
    let list;
    try {
        list = JSON.parse(raw);
    } catch (e) {
        console.error('Invalid JSON');
        process.exit(1);
    }
    if (!Array.isArray(list)) {
        console.error('Not an array');
        process.exit(1);
    }
    const placeholder = 'G Wait';
    const targets = list.map((g, idx) => ({ g, idx })).filter(x => x.g.name === placeholder);
    if (targets.length === 0) {
        console.log('No placeholder groups to remove.');
        return;
    }
    // Sort by createdAt descending so we can keep newest N
    targets.sort((a, b) => (b.g.createdAt || '').localeCompare(a.g.createdAt || ''));
    const toRemove = targets.slice(opts.keep);
    const removeIds = new Set(toRemove.map(x => x.g.id));
    const next = list.filter(g => !removeIds.has(g.id));
    console.log(
        `Found ${targets.length} placeholder groups; removing ${toRemove.length}, keeping ${targets.length - toRemove.length}.`
    );
    if (opts.dry) {
        console.log('Dry run: would write file with', next.length, 'groups total.');
        return;
    }
    fs.writeFileSync(opts.file + '.bak', raw, 'utf8');
    fs.writeFileSync(opts.file, JSON.stringify(next, null, 2), 'utf8');
    console.log('Cleanup complete. New group count:', next.length);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
