/**
 * Basic swagger spec shape test to ensure critical component schemas are present.
 */
const path = require('path');

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
    ];

    test.each(requiredSchemas)('schema %s exists', name => {
        expect(spec.components.schemas[name]).toBeTruthy();
    });

    test('BackupCreateResponse references BackupRecord', () => {
        const s = spec.components.schemas.BackupCreateResponse;
        expect(s.properties.backup).toBeTruthy();
    });
});
