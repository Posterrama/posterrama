#!/usr/bin/env node

// Quick test to check if environment variables are available in the server process
console.log('🔍 Environment Variable Check:');
const fs = require('fs');
const path = require('path');
try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'));
    const jf = (cfg.mediaServers || []).find(s => s.type === 'jellyfin');
    if (!jf) {
        console.log('No jellyfin server configured in config.json');
    } else {
        console.log(`JELLYFIN hostname (config.json): ${jf.hostname || 'NOT SET'}`);
        console.log(`JELLYFIN port (config.json): ${jf.port || 'NOT SET'}`);
        console.log(
            `API key env (${jf.tokenEnvVar || 'JELLYFIN_API_KEY'}): ${process.env[jf.tokenEnvVar || 'JELLYFIN_API_KEY'] ? 'SET' : 'NOT SET'}`
        );
    }
} catch (e) {
    console.log('Failed to read config.json:', e.message);
}
console.log(
    `JELLYFIN_API_KEY: ${process.env.JELLYFIN_API_KEY ? `${process.env.JELLYFIN_API_KEY.substring(0, 8)}...` : 'NOT SET'}`
);
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'NOT SET'}`);
