#!/usr/bin/env node

// Quick test to check if environment variables are available in the server process
console.log('🔍 Environment Variable Check:');
console.log(`JELLYFIN_HOSTNAME: ${process.env.JELLYFIN_HOSTNAME || 'NOT SET'}`);
console.log(`JELLYFIN_PORT: ${process.env.JELLYFIN_PORT || 'NOT SET'}`);
console.log(
    `JELLYFIN_API_KEY: ${process.env.JELLYFIN_API_KEY ? `${process.env.JELLYFIN_API_KEY.substring(0, 8)}...` : 'NOT SET'}`
);
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'NOT SET'}`);
