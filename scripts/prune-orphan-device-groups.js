#!/usr/bin/env node
/*
 * Prune orphan group references from devices.
 * Usage: node scripts/prune-orphan-device-groups.js [--dry-run]
 * Optionally set DEVICES_STORE_PATH / GROUPS_STORE_PATH env vars to target specific files.
 */
const fs = require('fs');
const path = require('path');

function readJson(p, fallback) {
    if (!fs.existsSync(p)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return fallback;
    }
}

function resolveStore(envVar, defaultName) {
    if (process.env[envVar]) {
        return path.isAbsolute(process.env[envVar])
            ? process.env[envVar]
            : path.join(process.cwd(), process.env[envVar]);
    }
    return path.join(__dirname, '..', defaultName);
}

const dry = process.argv.includes('--dry-run');
const devicesPath = resolveStore('DEVICES_STORE_PATH', 'devices.json');
const groupsPath = resolveStore('GROUPS_STORE_PATH', 'groups.json');

const devices = readJson(devicesPath, []);
const groups = readJson(groupsPath, []);
const valid = new Set(groups.map(g => g.id));

let totalRemoved = 0;
for (const d of devices) {
    if (Array.isArray(d.groups) && d.groups.length) {
        const before = d.groups.length;
        d.groups = d.groups.filter(g => valid.has(g));
        totalRemoved += before - d.groups.length;
    }
}

if (totalRemoved === 0) {
    console.log('No orphan group references found.');
    process.exit(0);
}

console.log(`Found ${totalRemoved} orphan group references.`);
if (dry) {
    console.log('Dry run: not writing changes.');
    process.exit(0);
}

// Backup then write
fs.writeFileSync(devicesPath + '.bak', JSON.stringify(devices, null, 2), 'utf8');
fs.writeFileSync(devicesPath, JSON.stringify(devices, null, 2), 'utf8');
console.log('Prune complete.');
