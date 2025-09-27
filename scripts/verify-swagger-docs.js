#!/usr/bin/env node
/* CLI wrapper delegating to scripts/lib/swaggerVerifier.js */
const { verifySwagger } = require('./lib/swaggerVerifier');

try {
    const { missing, orphaned } = verifySwagger();
    if (missing.length || orphaned.length) {
        if (missing.length) {
            console.error('\n❌ Missing from spec (Express has route, spec lacks):');
            missing.forEach(r => console.error(' - ' + r));
        }
        if (orphaned.length) {
            console.error('\n❌ Orphaned spec paths (spec documents but Express missing):');
            orphaned.forEach(r => console.error(' - ' + r));
        }
        console.error('\nResolve by adding/removing swagger JSDoc blocks or updating routes.');
        process.exit(1);
    } else {
        console.log(
            '✅ Swagger documentation verification: Express and swagger spec are in sync (no missing or orphaned endpoints).'
        );
    }
} catch (e) {
    console.error('❌ Verifier crashed:', e.message);
    process.exit(1);
}
