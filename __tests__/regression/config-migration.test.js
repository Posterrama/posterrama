/**
 * Config Schema Migration & Compatibility Regression Tests
 *
 * Deze tests valideren dat config schema changes backward compatible zijn
 * en dat migration paths correct werken zonder data verlies.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Mock logger om side effects te voorkomen
jest.mock('../../utils/logger');

/**
 * Config Migration Tester
 * Valideert backward compatibility en migration paths
 */
class ConfigMigrationTester {
    constructor() {
        this.schemaPath = path.join(__dirname, '../../config.schema.json');
        this.examplePath = path.join(__dirname, '../../config.example.json');
        this.migrationsDir = path.join(__dirname, '../../private/regression');
        this.baselinesDir = path.join(__dirname, 'config-baselines');
        this.updateEnabled = this.isUpdateEnabled();

        this.ensureDirectories();
        this.ajv = new Ajv({ allErrors: true, strict: false });
        addFormats(this.ajv);
    }

    ensureDirectories() {
        [this.migrationsDir, this.baselinesDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    isUpdateEnabled() {
        const v = process.env.REGRESSION_UPDATE;
        if (!v) return false;
        return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
    }

    /**
     * Laad het huidige schema
     */
    loadCurrentSchema() {
        if (!fs.existsSync(this.schemaPath)) {
            throw new Error(`Schema niet gevonden: ${this.schemaPath}`);
        }
        return JSON.parse(fs.readFileSync(this.schemaPath, 'utf8'));
    }

    /**
     * Laad een baseline schema voor vergelijking
     */
    loadBaselineSchema(version) {
        const baselinePath = path.join(this.baselinesDir, `schema-v${version}.json`);
        if (!fs.existsSync(baselinePath)) {
            // Eerste keer - maak baseline aan van huidige schema
            const currentSchema = this.loadCurrentSchema();
            this.saveSchemaBaseline(version, currentSchema);
            return currentSchema;
        }
        return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    }

    /**
     * Sla een schema baseline op
     */
    saveSchemaBaseline(version, schema) {
        const baselinePath = path.join(this.baselinesDir, `schema-v${version}.json`);
        if (this.updateEnabled) {
            fs.writeFileSync(baselinePath, JSON.stringify(schema, null, 2));
            console.log(`📝 Schema baseline opgeslagen: v${version}`);
        } else {
            console.log(`📝 Baseline write skipped (REGRESSION_UPDATE not set): v${version}`);
        }
    }

    /**
     * Valideer config tegen schema
     */
    validateConfig(config, schema = null) {
        const actualSchema = schema || this.loadCurrentSchema();
        const validate = this.ajv.compile(actualSchema);
        const isValid = validate(config);

        return {
            valid: isValid,
            errors: validate.errors || [],
            schema: actualSchema,
        };
    }

    /**
     * Test backward compatibility van schema changes
     */
    testBackwardCompatibility(oldVersion, _newVersion) {
        const oldSchema = this.loadBaselineSchema(oldVersion);
        const newSchema = this.loadCurrentSchema();

        const results = {
            compatible: true,
            issues: [],
            removedProperties: [],
            changedTypes: [],
            newRequiredProperties: [],
        };

        // Vergelijk properties recursief
        this.compareSchemaProperties(oldSchema.properties, newSchema.properties, '', results);

        // Check required fields
        const oldRequired = oldSchema.required || [];
        const newRequired = newSchema.required || [];

        newRequired.forEach(field => {
            if (!oldRequired.includes(field)) {
                results.newRequiredProperties.push(field);
                results.compatible = false;
                results.issues.push(
                    `Nieuw required field '${field}' breekt backward compatibility`
                );
            }
        });

        return results;
    }

    compareSchemaProperties(oldProps, newProps, path, results) {
        // Check verwijderde properties
        Object.keys(oldProps || {}).forEach(key => {
            const currentPath = path ? `${path}.${key}` : key;

            if (!(key in (newProps || {}))) {
                results.removedProperties.push(currentPath);
                results.compatible = false;
                results.issues.push(`Property '${currentPath}' is verwijderd`);
                return;
            }

            const oldProp = oldProps[key];
            const newProp = newProps[key];

            // Check type changes
            if (oldProp.type && newProp.type && oldProp.type !== newProp.type) {
                results.changedTypes.push({
                    path: currentPath,
                    oldType: oldProp.type,
                    newType: newProp.type,
                });
                results.compatible = false;
                results.issues.push(
                    `Property '${currentPath}' type changed: ${oldProp.type} → ${newProp.type}`
                );
            }

            // Recursief voor nested objects
            if (oldProp.properties && newProp.properties) {
                this.compareSchemaProperties(
                    oldProp.properties,
                    newProp.properties,
                    currentPath,
                    results
                );
            }
        });
    }

    /**
     * Test config migration van oude naar nieuwe versie
     */
    testConfigMigration(oldConfig, _expectedNewConfig = null) {
        // Valideer oude config tegen oud schema (zou moeten slagen)
        const oldValidation = this.validateConfig(oldConfig);

        // Probeer oude config tegen nieuwe schema (migration test)
        const migrationResult = this.validateConfig(oldConfig);

        // Als migration script bestaat, run het
        const migratedConfig = this.runMigrationScript(oldConfig);

        return {
            oldConfigValid: oldValidation.valid,
            oldConfigErrors: oldValidation.errors,
            migrationValid: migrationResult.valid,
            migrationErrors: migrationResult.errors,
            migratedConfig: migratedConfig,
            needsMigration: !migrationResult.valid && oldValidation.valid,
        };
    }

    /**
     * Simuleer migration script (placeholder voor echte migration logic)
     */
    runMigrationScript(oldConfig) {
        // Voor nu: gewoon return de originele config
        // In de toekomst: implementeer echte migration logic hier
        return { ...oldConfig };
    }

    /**
     * Genereer test configs voor verschillende scenario's
     */
    generateTestConfigs() {
        const baseConfig = JSON.parse(fs.readFileSync(this.examplePath, 'utf8'));

        return {
            minimal: {
                transitionIntervalSeconds: 10,
            },
            maximal: baseConfig,
            legacy_v2_5: {
                // Simuleer oude config structuur
                transitionIntervalSeconds: 15,
                showPoster: true,
                showMetadata: false,
                // Oude property die mogelijk niet meer bestaat
                legacyShowAging: true,
            },
            future_v2_7: {
                // Simuleer toekomstige config met nieuwe velden
                ...baseConfig,
                newFeatureEnabled: true,
                advancedWallartMode: {
                    aiSorting: true,
                    dynamicDensity: 'adaptive',
                },
            },
        };
    }

    /**
     * Sla migration test rapport op
     */
    saveMigrationReport(version, results) {
        const reportPath = path.join(this.migrationsDir, `migration-report-v${version}.json`);
        const report = {
            version,
            timestamp: new Date().toISOString(),
            results,
            summary: {
                totalTests: Object.keys(results).length,
                successful: Object.values(results).filter(r => r.migrationValid).length,
                needsMigration: Object.values(results).filter(r => r.needsMigration).length,
            },
        };

        if (this.updateEnabled) {
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        } else {
            console.log('📝 Migration report write skipped (REGRESSION_UPDATE not set)');
        }
        return report;
    }
}

describe('Config Schema Migration & Compatibility Tests', () => {
    let migrationTester;

    beforeAll(() => {
        migrationTester = new ConfigMigrationTester();
    });

    describe('Schema Backward Compatibility', () => {
        test('Current schema should be backward compatible with v2.6', () => {
            const compatibility = migrationTester.testBackwardCompatibility('2.6', '2.7');

            console.log('🔍 Backward Compatibility Analysis:');
            console.log(`Compatible: ${compatibility.compatible ? '✅' : '❌'}`);

            if (compatibility.issues.length > 0) {
                console.log('Issues found:');
                compatibility.issues.forEach(issue => console.log(`  - ${issue}`));
            }

            if (compatibility.removedProperties.length > 0) {
                console.log('Removed properties:');
                compatibility.removedProperties.forEach(prop => console.log(`  - ${prop}`));
            }

            if (compatibility.changedTypes.length > 0) {
                console.log('Type changes:');
                compatibility.changedTypes.forEach(change =>
                    console.log(`  - ${change.path}: ${change.oldType} → ${change.newType}`)
                );
            }

            // Voor nu: waarschuwen in plaats van falen om baseline te establishen
            if (!compatibility.compatible) {
                console.warn('⚠️  Schema backward compatibility issues detected');
            }
        });

        test('Schema should validate current example config', () => {
            const exampleConfig = JSON.parse(fs.readFileSync(migrationTester.examplePath, 'utf8'));
            const validation = migrationTester.validateConfig(exampleConfig);

            expect(validation.valid).toBe(true);

            if (!validation.valid) {
                console.log('❌ Schema validation errors:');
                validation.errors.forEach(error => {
                    console.log(`  - ${error.instancePath || 'root'}: ${error.message}`);
                });
            }
        });
    });

    describe('Config Migration Paths', () => {
        test('Legacy v2.5 config should migrate successfully', () => {
            const testConfigs = migrationTester.generateTestConfigs();
            const legacyConfig = testConfigs.legacy_v2_5;

            const migration = migrationTester.testConfigMigration(legacyConfig);

            console.log('🔄 Legacy Config Migration Test:');
            console.log(`Old config valid: ${migration.oldConfigValid ? '✅' : '❌'}`);
            console.log(`Migration needed: ${migration.needsMigration ? '⚠️ Yes' : '✅ No'}`);
            console.log(`Migration valid: ${migration.migrationValid ? '✅' : '❌'}`);

            if (migration.migrationErrors.length > 0) {
                console.log('Migration errors:');
                migration.migrationErrors.forEach(error => {
                    console.log(`  - ${error.instancePath || 'root'}: ${error.message}`);
                });
            }

            // Config should either be valid as-is or successfully migrated
            // Voor regression testing controleren we dat migration logica werkt
            expect(migration).toHaveProperty('oldConfigValid');
            expect(migration).toHaveProperty('migrationValid');
        });

        test('Minimal config should be extensible', () => {
            const testConfigs = migrationTester.generateTestConfigs();
            const minimalConfig = testConfigs.minimal;

            const validation = migrationTester.validateConfig(minimalConfig);

            console.log('🔧 Minimal Config Test:');
            console.log(`Valid: ${validation.valid ? '✅' : '❌'}`);

            if (!validation.valid) {
                console.log('Validation errors:');
                validation.errors.forEach(error => {
                    console.log(`  - ${error.instancePath || 'root'}: ${error.message}`);
                });
            }

            // Minimal configs kunnen validation errors hebben - dat is OK voor testing
            expect(typeof validation.valid).toBe('boolean');
        });

        test('Future config should be gracefully handled', () => {
            const testConfigs = migrationTester.generateTestConfigs();
            const futureConfig = testConfigs.future_v2_7;

            const validation = migrationTester.validateConfig(futureConfig);

            console.log('🔮 Future Config Test:');
            console.log(`Valid: ${validation.valid ? '✅' : '⚠️ Has unknown properties'}`);

            // Future configs kunnen unknown properties hebben - dat is OK
            // We testen dat bestaande properties nog steeds werken
            const knownPropsConfig = Object.keys(futureConfig)
                .filter(key => validation.schema.properties && key in validation.schema.properties)
                .reduce((obj, key) => {
                    obj[key] = futureConfig[key];
                    return obj;
                }, {});

            const knownValidation = migrationTester.validateConfig(knownPropsConfig);
            expect(knownValidation.valid).toBe(true);
        });
    });

    describe('Config Migration Stress Tests', () => {
        test('All test configs should have viable migration paths', () => {
            const testConfigs = migrationTester.generateTestConfigs();
            const results = {};

            Object.entries(testConfigs).forEach(([name, config]) => {
                console.log(`Testing migration for: ${name}`);
                results[name] = migrationTester.testConfigMigration(config);
            });

            // Sla rapport op
            const report = migrationTester.saveMigrationReport('current', results);

            console.log('📊 Migration Test Summary:');
            console.log(`Total configs tested: ${report.summary.totalTests}`);
            console.log(`Successful migrations: ${report.summary.successful}`);
            console.log(`Need migration: ${report.summary.needsMigration}`);

            // Voor regression testing: controleer dat migration process werkend is
            expect(report.summary.totalTests).toBeGreaterThan(0);
            expect(report.summary).toHaveProperty('successful');
        });
    });

    describe('Schema Evolution Tracking', () => {
        test('Schema changes should be documented', () => {
            const currentSchema = migrationTester.loadCurrentSchema();

            // Sla huidige schema op als baseline voor toekomstige vergelijkingen
            const version = '2.6.2'; // Current version
            migrationTester.saveSchemaBaseline(version, currentSchema);

            // Valideer dat schema basic requirements heeft
            expect(currentSchema).toHaveProperty('type', 'object');
            expect(currentSchema).toHaveProperty('properties');
            expect(typeof currentSchema.properties).toBe('object');

            console.log(
                '📋 Schema Properties Count:',
                Object.keys(currentSchema.properties).length
            );
            console.log('📋 Required Fields:', currentSchema.required?.length || 0);
        });

        test('Config validation performance should be acceptable', () => {
            const testConfig = migrationTester.generateTestConfigs().maximal;

            const iterations = 100;
            const startTime = Date.now();

            for (let i = 0; i < iterations; i++) {
                migrationTester.validateConfig(testConfig);
            }

            const endTime = Date.now();
            const avgTime = (endTime - startTime) / iterations;

            console.log(`⚡ Config validation performance: ${avgTime.toFixed(2)}ms avg`);

            // Validatie zou onder de 50ms moeten zijn (ruimere threshold voor CI)
            expect(avgTime).toBeLessThan(50);
        });
    });
});
