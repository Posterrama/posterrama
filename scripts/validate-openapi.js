#!/usr/bin/env node
/**
 * OpenAPI Specification Validator
 *
 * Validates the generated OpenAPI spec against OpenAPI 3.0 standards.
 * Checks for:
 * - Valid OpenAPI 3.0 structure
 * - All endpoints have examples
 * - Security schemes are properly defined
 * - No duplicate operationIds
 * - Proper response structures
 *
 * Usage: npm run openapi:validate
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const OPENAPI_SPEC_PATH = path.join(__dirname, '..', 'docs', 'openapi-latest.json');

// OpenAPI 3.0 JSON Schema (simplified - covers main structure)
const openapi30Schema = {
    type: 'object',
    required: ['openapi', 'info', 'paths'],
    properties: {
        openapi: { type: 'string', pattern: '^3\\.0\\.\\d+$' },
        info: {
            type: 'object',
            required: ['title', 'version'],
            properties: {
                title: { type: 'string' },
                version: { type: 'string' },
                description: { type: 'string' },
            },
        },
        paths: { type: 'object' },
        components: { type: 'object' },
        security: { type: 'array' },
        servers: { type: 'array' },
        tags: { type: 'array' },
    },
};

function validateOpenAPISpec() {
    console.log('🔍 Validating OpenAPI specification...\n');

    // 1. Check if spec exists
    if (!fs.existsSync(OPENAPI_SPEC_PATH)) {
        console.error(`❌ OpenAPI spec not found at: ${OPENAPI_SPEC_PATH}`);
        console.error('   Run: npm run openapi:export');
        process.exit(1);
    }

    // 2. Load and parse spec
    let spec;
    try {
        const content = fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8');
        spec = JSON.parse(content);
    } catch (error) {
        console.error('❌ Failed to parse OpenAPI spec:', error.message);
        process.exit(1);
    }

    const errors = [];
    const warnings = [];

    // 3. Validate against OpenAPI 3.0 schema
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(openapi30Schema);
    const valid = validate(spec);

    if (!valid) {
        errors.push('Schema validation failed:');
        validate.errors.forEach(err => {
            errors.push(`  - ${err.instancePath}: ${err.message}`);
        });
    }

    // 4. Check all endpoints have 200 responses
    const pathsWithout200 = [];
    const pathsWithoutExamples = [];
    const pathsWithoutSecurity = [];

    // Frontend/HTML routes and binary/image endpoints that don't need JSON examples
    const htmlRoutes = [
        '/',
        '/index.html',
        '/admin',
        '/admin/login',
        '/admin/2fa-verify',
        '/admin/logout',
        '/admin/logs',
        '/admin/setup',
        '/screensaver',
        '/wallart',
        '/cinema',
        '/admin-analytics',
        '/admin.css',
        '/admin.js',
        '/image',
        '/proxy',
        '/setup.html',
        '/2fa-verify.html',
        '/local-posterpack',
        '/[site]',
        '/[site]/*',
        '/api/admin/events',
        '/api/devices/logs',
        '/reset-refresh',
        '/local-media/{path}',
        '/local-media',
        '/admin-new-item-bounce.js',
        '/health',
        '/api/admin/profile/photo', // Binary image response
        '/api/qr', // SVG/PNG QR code response
    ];
    Object.entries(spec.paths || {}).forEach(([endpointPath, pathItem]) => {
        Object.entries(pathItem).forEach(([httpMethod, operation]) => {
            if (typeof operation !== 'object') return;

            const isHtmlRoute =
                htmlRoutes.includes(endpointPath) || endpointPath.includes('*.html');

            // Check for 200 response
            if (!operation.responses || !operation.responses['200']) {
                pathsWithout200.push(`${httpMethod.toUpperCase()} ${endpointPath}`);
            }

            // Check for examples in 200 response (skip HTML routes)
            if (
                !isHtmlRoute &&
                operation.responses &&
                operation.responses['200'] &&
                operation.responses['200'].content
            ) {
                const hasExample = Object.values(operation.responses['200'].content).some(
                    mediaType => mediaType.example || mediaType.examples
                );
                if (!hasExample) {
                    pathsWithoutExamples.push(`${httpMethod.toUpperCase()} ${endpointPath}`);
                }
            }

            // Check for security (warn only for non-public endpoints)
            if (
                !operation.security &&
                !endpointPath.startsWith('/health') &&
                !endpointPath.startsWith('/get-')
            ) {
                pathsWithoutSecurity.push(`${httpMethod.toUpperCase()} ${endpointPath}`);
            }
        });
    });

    if (pathsWithout200.length > 0) {
        warnings.push(`Endpoints without 200 response (${pathsWithout200.length}):`);
        pathsWithout200.forEach(p => warnings.push(`  - ${p}`));
    }

    if (pathsWithoutExamples.length > 0) {
        errors.push(`Endpoints without examples (${pathsWithoutExamples.length}):`);
        pathsWithoutExamples.slice(0, 5).forEach(p => errors.push(`  - ${p}`));
        if (pathsWithoutExamples.length > 5) {
            errors.push(`  ... and ${pathsWithoutExamples.length - 5} more`);
        }
    }

    if (pathsWithoutSecurity.length > 0) {
        warnings.push(`Endpoints without security defined (${pathsWithoutSecurity.length}):`);
        pathsWithoutSecurity.slice(0, 3).forEach(p => warnings.push(`  - ${p}`));
        if (pathsWithoutSecurity.length > 3) {
            warnings.push(`  ... and ${pathsWithoutSecurity.length - 3} more`);
        }
    }

    // 5. Check for duplicate operationIds
    const operationIds = new Set();
    const duplicateOperationIds = [];

    Object.entries(spec.paths || {}).forEach(([_path, pathItem]) => {
        Object.entries(pathItem).forEach(([_method, operation]) => {
            if (typeof operation !== 'object' || !operation.operationId) return;

            if (operationIds.has(operation.operationId)) {
                duplicateOperationIds.push(operation.operationId);
            } else {
                operationIds.add(operation.operationId);
            }
        });
    });

    if (duplicateOperationIds.length > 0) {
        errors.push(`Duplicate operationIds found: ${duplicateOperationIds.join(', ')}`);
    }

    // 6. Check security schemes
    const securitySchemes = spec.components?.securitySchemes || {};
    const securitySchemeCount = Object.keys(securitySchemes).length;

    if (securitySchemeCount === 0) {
        warnings.push('No security schemes defined');
    } else if (securitySchemeCount > 3) {
        warnings.push(
            `Many security schemes defined (${securitySchemeCount}). Consider consolidation.`
        );
    }

    // 7. Summary
    console.log('📊 Validation Summary:\n');
    console.log(`   OpenAPI Version: ${spec.openapi}`);
    console.log(`   API Version: ${spec.info.version}`);
    console.log(`   Total Endpoints: ${Object.keys(spec.paths || {}).length}`);
    console.log(`   Security Schemes: ${securitySchemeCount}`);
    console.log(`   Tags: ${(spec.tags || []).length}\n`);

    // 8. Print results
    if (warnings.length > 0) {
        console.log('⚠️  Warnings:\n');
        warnings.forEach(w => console.log(`   ${w}`));
        console.log();
    }

    if (errors.length > 0) {
        console.log('❌ Errors:\n');
        errors.forEach(e => console.log(`   ${e}`));
        console.log();
        console.log('Validation failed! Fix errors and try again.\n');
        process.exit(1);
    }

    console.log('✅ OpenAPI specification is valid!\n');

    // 9. Additional quality checks
    const totalPaths = Object.keys(spec.paths || {}).length;
    const pathsWithExamples = totalPaths - pathsWithoutExamples.length;
    const exampleCoverage = ((pathsWithExamples / totalPaths) * 100).toFixed(1);

    console.log('📈 Quality Metrics:\n');
    console.log(`   Example Coverage: ${exampleCoverage}%`);
    console.log(`   Endpoints with 200: ${totalPaths - pathsWithout200.length}/${totalPaths}`);
    console.log(`   Secured Endpoints: ${totalPaths - pathsWithoutSecurity.length}/${totalPaths}`);
    console.log();

    if (exampleCoverage < 90) {
        console.log(
            '⚠️  Example coverage below 90%. Consider adding more examples for better documentation.\n'
        );
    }

    return true;
}

// Run validation
try {
    validateOpenAPISpec();
} catch (error) {
    console.error('❌ Validation error:', error.message);
    process.exit(1);
}
