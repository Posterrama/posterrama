#!/usr/bin/env node

/**
 * Add Missing JSDoc Responses
 *
 * Identifies endpoints in server.js that are missing 200 responses in their JSDoc
 * and outputs the fixes needed. This is a helper to manually update server.js.
 *
 * Usage:
 *   node scripts/add-missing-jsdoc-responses.js
 */

// Force fresh require
delete require.cache[require.resolve('../swagger.js')];
const swagger = require('../swagger.js');

const spec = typeof swagger.generate === 'function' ? swagger.generate() : swagger;

console.log('🔍 Analyzing JSDoc in server.js for missing responses...\n');

const missingResponses = [];
const missingExamples = [];
const missingSecurity = [];

// Check each endpoint
for (const [pathKey, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
        if (typeof operation !== 'object' || !operation) continue;

        const endpoint = `${method.toUpperCase()} ${pathKey}`;
        const responses = operation.responses || {};

        // Check for 200 response
        if (!responses['200']) {
            missingResponses.push({
                endpoint,
                method: method.toUpperCase(),
                path: pathKey,
                summary: operation.summary,
            });
        }

        // Check for examples in 200 response
        if (responses['200'] && responses['200'].content) {
            const content = responses['200'].content;
            let hasExample = false;

            for (const mediaType of Object.values(content)) {
                if (
                    mediaType.example ||
                    mediaType.examples ||
                    (mediaType.schema && mediaType.schema.example)
                ) {
                    hasExample = true;
                    break;
                }
            }

            if (!hasExample) {
                missingExamples.push({ endpoint, method: method.toUpperCase(), path: pathKey });
            }
        }

        // Check for security
        if (!operation.security) {
            missingSecurity.push({ endpoint, method: method.toUpperCase(), path: pathKey });
        }
    }
}

console.log('📊 Summary:\n');
console.log(`   Endpoints without 200 response: ${missingResponses.length}`);
console.log(`   Endpoints without examples: ${missingExamples.length}`);
console.log(`   Endpoints without security: ${missingSecurity.length}`);
console.log('');

if (missingResponses.length > 0) {
    console.log('❌ Endpoints missing 200 response in JSDoc:\n');
    missingResponses.forEach(({ endpoint, path: _path, summary }) => {
        console.log(`   ${endpoint}`);
        console.log(`      Summary: ${summary || 'N/A'}`);
        console.log(`      → Add to JSDoc: responses → '200' → description + content\n`);
    });
}

console.log('\n💡 To fix: Update JSDoc comments in server.js for these endpoints.');
console.log('   Each endpoint needs a "200" response in the responses section.');
console.log('\n   Example JSDoc format:');
console.log('   /**');
console.log('    * @swagger');
console.log('    * /api/endpoint:');
console.log('    *   get:');
console.log('    *     responses:');
console.log('    *       200:');
console.log('    *         description: Success response');
console.log('    *         content:');
console.log('    *           application/json:');
console.log('    *             schema:');
console.log('    *               type: object');
console.log('    */');
