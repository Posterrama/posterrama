#!/usr/bin/env node
/**
 * Secret generator utility.
 * Safely generate cryptographically strong secrets (hex/base64) for .env values.
 */
const crypto = require('crypto');

const args = process.argv.slice(2);

function usage() {
  console.log(`Usage: node scripts/generate-secrets.js [options]\n\nOptions:\n  --hex [length]        Generate hex secret (default length 64 chars)\n  --base64 [bytes]      Generate base64 secret from N random bytes (default 32)\n  --session             Convenience: 64-char hex for SESSION_SECRET\n  --all                 Generate common secrets set (session only)\n  -h, --help            Show this help\n\nExamples:\n  npm run secrets:generate -- --session\n  npm run secrets:generate -- --hex 48\n  npm run secrets:generate -- --all\n`);
}

function genHex(len = 64) {
  if (len % 2 !== 0) {
    console.error('Hex length must be even (2 hex chars per byte).');
    process.exit(1);
  }
  return crypto.randomBytes(len / 2).toString('hex');
}

function genBase64(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64');
}

if (args.includes('-h') || args.includes('--help') || args.length === 0) {
  usage();
  if (args.length === 0) process.exit(0);
}

const out = {};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--hex') {
    const len = parseInt(args[i + 1], 10) || 64;
    i++;
    out[`HEX_${len}`] = genHex(len);
  } else if (a === '--base64') {
    const bytes = parseInt(args[i + 1], 10) || 32;
    i++;
    out[`BASE64_${bytes}`] = genBase64(bytes);
  } else if (a === '--session') {
    out.SESSION_SECRET = genHex(64);
  } else if (a === '--all') {
    out.SESSION_SECRET = genHex(64);
  }
}

if (Object.keys(out).length === 0) {
  console.warn('No secrets generated. Use --help for options.');
  process.exit(1);
}

console.log('\nGenerated secrets:');
Object.entries(out).forEach(([k, v]) => {
  console.log(`${k}=${v}`);
});

console.log('\nCopy the desired values into your .env file.');
