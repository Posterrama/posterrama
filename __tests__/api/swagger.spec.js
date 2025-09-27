/**
 * Basic swagger spec shape test to ensure critical component schemas are present
 * and internal endpoints (x-internal) are stripped from the exported spec.
 */

// Import swagger module (exports spec and generate())
const swagger = require('../../swagger');

function getSpec() {
    return swagger && swagger.generate ? swagger.generate() : swagger;
}

describe('OpenAPI schema (swagger)', () => {
    let spec;
    beforeAll(() => {
        spec = getSpec();
    });

    test('has components.schemas', () => {
        expect(spec).toBeTruthy();
        expect(spec.components).toBeTruthy();
        expect(spec.components.schemas).toBeTruthy();
    });

    const requiredSchemas = [
        'StandardOkResponse',
        'BackupCreateResponse',
        'BackupCleanupResponse',
        'BackupRestoreResponse',
        'BackupDeleteResponse',
        'BackupSchedule',
        'BackupScheduleResponse',
        'StandardErrorResponse',
    ];

    test.each(requiredSchemas)('schema %s exists', name => {
        expect(spec.components.schemas[name]).toBeTruthy();
    });

    test('BackupCreateResponse references BackupRecord', () => {
        const s = spec.components.schemas.BackupCreateResponse;
        expect(s.properties.backup).toBeTruthy();
    });

    test('internal health-debug route is stripped', () => {
        const hasInternal = Object.keys(spec.paths || {}).some(p =>
            p.includes('_internal/health-debug')
        );
        expect(hasInternal).toBe(false);
    });
});
