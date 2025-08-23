#!/usr/bin/env node
/*
 * Detached update runner: executes the AutoUpdater from a separate Node process
 * so stopping the PM2-managed app doesn't kill the updater mid-flight.
 */
const path = require('path');
const fs = require('fs');

// Ensure we run from repo root (utils/..)
const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

// Lightweight file logger to survive parent shutdown
const logFile = path.join(appRoot, 'logs', 'updater-worker.log');
function log(level, msg, extra = {}) {
    const line = JSON.stringify({ level, msg, ...extra, ts: new Date().toISOString() }) + '\n';
    try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.appendFileSync(logFile, line);
    } catch (e) {
        try {
            process.stderr.write(`[update-runner] log write failed: ${e && e.message}\n`);
        } catch (e2) {
            // last resort: swallow to avoid throwing in logger
        }
    }
}

async function main() {
    try {
        // Parse args: support --version X or -v X
        const args = process.argv.slice(2);
        let targetVersion = null;
        let dryRun = false;
        let deferStop = !!process.env.PM2_HOME; // if spawned from PM2-managed app, defer stopping services
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if ((a === '--version' || a === '-v') && args[i + 1]) {
                targetVersion = String(args[i + 1]);
                i++;
            } else if (a === '--dry-run' || a === '-n') {
                dryRun = true;
            } else if (a === '--defer-stop') {
                deferStop = true;
            } else if (a === '--no-defer-stop') {
                deferStop = false;
            }
        }

        log('info', 'update-runner starting', { targetVersion, dryRun, deferStop });
        const autoUpdater = require('./updater');

        await autoUpdater.startUpdate(targetVersion, { dryRun, deferStop });
        log('info', 'update-runner completed successfully');
        process.exit(0);
    } catch (err) {
        log('error', 'update-runner failed', { error: err && err.message });
        // Best effort exit; rollback handled inside updater
        process.exit(1);
    }
}

main();
