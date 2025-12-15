/**
 * Script to validate that required environment variables are set.
 * This script is run before starting the server to ensure a valid configuration.
 */

const fs = require('fs');
const path = require('path');
// --- Auto-create .env if missing ---
const envPath = path.join(__dirname, '..', '.env');
const exampleEnvPath = path.join(__dirname, '..', 'config.example.env');
if (!fs.existsSync(envPath)) {
    if (fs.existsSync(exampleEnvPath)) {
        fs.copyFileSync(exampleEnvPath, envPath);
    } else {
        console.error('[Config] config.example.env ontbreekt, kan geen .env aanmaken!');
        if (process.env.NODE_ENV !== 'test') {
            process.exit(1);
        }
    }
}
// --- Auto-create config.json if missing ---
const configPath = path.join(__dirname, '..', 'config.json');
const exampleConfigPath = path.join(__dirname, '..', 'config.example.json');
if (!fs.existsSync(configPath)) {
    if (fs.existsSync(exampleConfigPath)) {
        fs.copyFileSync(exampleConfigPath, configPath);
    } else {
        console.error('[Config] config.example.json ontbreekt, kan geen config.json aanmaken!');
        if (process.env.NODE_ENV !== 'test') {
            process.exit(1);
        }
    }
}

// Shared logger for config maintenance (migrations/self-heal). Keep console.error for fatal messages
// (some tests assert console usage).
const logger = require('../utils/logger');
const { normalizeCinematicTransitions } = require('../utils/cinema-transition-compat');

function envFlag(name) {
    const raw = String(process.env[name] || '')
        .trim()
        .toLowerCase();
    if (!raw) return null;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return null;
}

const isTestRun = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID != null;

function createConfigMaintenanceReport() {
    const quietDefault = isTestRun;
    const quiet = envFlag('POSTERRAMA_CONFIG_VALIDATE_QUIET') ?? quietDefault;
    const verbose =
        envFlag('POSTERRAMA_CONFIG_VALIDATE_VERBOSE') ??
        (String(process.env.TEST_VERBOSE_CONFIG_VALIDATION || '').trim() === '1' ||
            String(process.env.TEST_VERBOSE_CONFIG_VALIDATION || '')
                .trim()
                .toLowerCase() === 'true');

    const state = {
        quiet,
        verbose,
        migrations: 0,
        repairs: 0,
        removedUnknownProperties: 0,
        savedWrites: 0,
        saveErrors: 0,
        notes: [],
    };

    function detail(message, meta) {
        // Per-change logs stay at debug; summary emitted at info.
        logger.debug(message, meta);
    }

    return {
        state,
        migration(message, meta) {
            state.migrations += 1;
            if (!state.quiet || state.verbose) detail(message, meta);
        },
        repair(message, meta) {
            state.repairs += 1;
            if (!state.quiet || state.verbose) detail(message, meta);
        },
        removedUnknown(pathStr) {
            state.removedUnknownProperties += 1;
            if (!state.quiet || state.verbose) {
                detail('[Config Self-Heal] Removing unknown property', { path: pathStr });
            }
        },
        saved(kind) {
            state.savedWrites += 1;
            if (!state.quiet || state.verbose) {
                detail('[Config] Saved config.json after maintenance', { kind });
            }
        },
        saveError(kind, error) {
            state.saveErrors += 1;
            logger.warn('[Config] Failed to save config.json after maintenance', {
                kind,
                error: error && error.message,
            });
        },
        note(message) {
            state.notes.push(message);
        },
        emitSummaryIfNeeded(context = {}) {
            const changed =
                state.migrations > 0 ||
                state.repairs > 0 ||
                state.removedUnknownProperties > 0 ||
                state.savedWrites > 0 ||
                state.saveErrors > 0;
            if (state.quiet && !state.verbose) return;
            if (!changed && !state.verbose) return;

            logger.info('[Config Maintenance] Summary', {
                ...context,
                migrations: state.migrations,
                repairs: state.repairs,
                removedUnknownProperties: state.removedUnknownProperties,
                savedWrites: state.savedWrites,
                saveErrors: state.saveErrors,
                notes: state.verbose ? state.notes : undefined,
            });
        },
    };
}

const Ajv = require('ajv');
// Use example env during tests, real .env otherwise
const envFileToUse = process.env.NODE_ENV === 'test' ? exampleEnvPath : envPath;
require('dotenv').config({ path: envFileToUse });

// --- Schema Validation ---
// @ts-ignore - Ajv constructor is valid but TypeScript doesn't recognize it from require()
const ajv = new Ajv({
    allErrors: true,
    allowUnionTypes: true, // Support multi-type definitions like ["string", "integer", "null"]
    useDefaults: true, // Inject defaults for missing properties
    strict: false, // Disable strict mode to allow union types without warnings
});
const schemaPath = path.join(__dirname, '..', 'config.schema.json');

// Create a local safe reader that doesn't globally monkey-patch fs, to avoid
// interfering with Jest/Babel internals. We prefer the Jest mock for config.json
// (so tests can inject content), and bypass the mock for other files like the schema.
function realReadFileSync(p, encoding = 'utf-8') {
    const fd = fs.openSync(p, 'r');
    try {
        const stat = fs.fstatSync(fd);
        const buf = Buffer.allocUnsafe(stat.size);
        fs.readSync(fd, buf, 0, stat.size, 0);
        return encoding ? buf.toString(/** @type {BufferEncoding} */ (encoding)) : buf;
    } finally {
        try {
            fs.closeSync(fd);
        } catch (_) {
            // ignore
        }
    }
}

function safeReadFile(pathStr, { preferMockForConfig = false } = {}) {
    const isFsMocked =
        typeof fs.readFileSync === 'function' &&
        /** @type {any} */ (fs.readFileSync)._isMockFunction;
    if (preferMockForConfig && isFsMocked && pathStr === configPath) {
        // Let the test-provided mock supply config.json content
        return fs.readFileSync(pathStr, 'utf-8');
    }
    // For all other cases (schema and non-config), bypass the mock
    return realReadFileSync(pathStr, 'utf-8');
}

let configSchema;
try {
    configSchema = JSON.parse(String(safeReadFile(schemaPath)));
} catch (e) {
    console.error('[Config] Failed to read config.schema.json:', e.message);
    if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
    }
}
const validate = ajv.compile(configSchema);

let config;
try {
    config = JSON.parse(String(safeReadFile(configPath, { preferMockForConfig: true })));
} catch (error) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: Could not read or parse config.json.');
    console.error(error.message);
    if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
    }
    // In test mode, use empty config to allow tests to continue
    config = {};
}

/**
 * Migrate and repair config to ensure it always validates against schema.
 * This handles breaking changes and invalid values automatically.
 * @param {object} cfg - The config object to migrate/repair
 * @returns {boolean} - True if config was modified and needs saving
 */
function migrateConfig(cfg, options = {}) {
    let modified = false;
    const report = options && options.report;

    // === VALID ENUM VALUES (from schema) ===
    const VALID = {
        // Header typography
        headerFontFamily: [
            'system',
            'cinematic',
            'classic',
            'modern',
            'elegant',
            'marquee',
            'retro',
            'neon',
        ],
        headerShadow: ['none', 'subtle', 'dramatic', 'neon', 'glow'],
        headerAnimation: ['none', 'pulse', 'flicker', 'marquee'],
        headerDecoration: ['none', 'frame', 'underline', 'backdrop'],
        // Footer
        footerType: ['marquee', 'metadata', 'tagline'],
        footerFontFamily: ['system', 'cinematic', 'classic', 'modern', 'elegant'],
        footerShadow: ['none', 'subtle', 'dramatic'],
        // Metadata
        metadataPosition: ['bottom', 'overlay'],
        metadataLayout: ['compact', 'comfortable', 'spacious'],
        specsStyle: [
            'dark-glass',
            'glass',
            'icons-only',
            'icons-text',
            'subtle',
            'badges',
            'icons',
        ],
        specsIconSet: ['tabler', 'material'],
        // Background
        backgroundMode: [
            'solid',
            'blurred',
            'gradient',
            'ambient',
            'spotlight',
            'starfield',
            'curtain',
        ],
        vignette: ['none', 'subtle', 'dramatic'],
        // Global Effects
        colorFilter: ['none', 'sepia', 'cool', 'warm', 'tint'],
        textColorMode: ['custom', 'tonSurTon'],
        textEffect: ['none', 'subtle', 'dramatic', 'neon', 'glow'],
        // Poster
        posterStyle: [
            'fullBleed',
            'framed',
            'floating',
            'polaroid',
            'shadowBox',
            'neon',
            'doubleBorder',
            'ornate',
        ],
        posterOverlay: [
            'none',
            'grain',
            'oldMovie',
            'vhs',
            'monochrome',
            'scanlines',
            'paper',
            'vintage',
        ],
        posterAnimation: ['fade', 'slide', 'zoom', 'flip'],
        // Promotional
        qrPosition: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'],
        // Orientation
        orientation: ['auto', 'portrait', 'portrait-flipped', 'landscape', 'landscape-flipped'],
    };

    // Helper: validate and fix enum value
    const fixEnum = (obj, key, validValues, defaultValue, path) => {
        if (obj && obj[key] !== undefined && !validValues.includes(obj[key])) {
            if (report) {
                report.repair('[Config Repair] Invalid enum value normalized', {
                    path: `${path}.${key}`,
                    from: obj[key],
                    to: defaultValue,
                });
            }
            obj[key] = defaultValue;
            return true;
        }
        return false;
    };

    // Helper: ensure object exists
    const ensureObj = (parent, key) => {
        if (!parent[key] || typeof parent[key] !== 'object') {
            parent[key] = {};
            return true;
        }
        return false;
    };

    // Helper: remove invalid property
    const removeProperty = (obj, key, path) => {
        if (obj && obj[key] !== undefined) {
            delete obj[key];
            if (report) {
                report.repair('[Config Repair] Removed invalid property', {
                    path: `${path}.${key}`,
                });
            }
            return true;
        }
        return false;
    };

    // === TOP-LEVEL REQUIRED PROPERTIES WITH DEFAULTS ===
    // Ensure backgroundRefreshMinutes exists (was previously required in schema)
    if (cfg.backgroundRefreshMinutes === undefined) {
        cfg.backgroundRefreshMinutes = 60;
        if (report)
            report.migration('[Config Migration] Added default backgroundRefreshMinutes', {
                value: 60,
            });
        modified = true;
    } else if (
        typeof cfg.backgroundRefreshMinutes !== 'number' ||
        cfg.backgroundRefreshMinutes < 5
    ) {
        cfg.backgroundRefreshMinutes = 60;
        if (report)
            report.migration('[Config Migration] Fixed invalid backgroundRefreshMinutes', {
                value: 60,
            });
        modified = true;
    }

    // === TOP-LEVEL ORIENTATION ===
    modified = fixEnum(cfg, 'cinemaOrientation', VALID.orientation, 'auto', 'config') || modified;

    // === WALLART MODE ===
    // Handle deprecated/invalid values so config continues to validate after upgrades.
    if (cfg.wallartMode && typeof cfg.wallartMode === 'object') {
        const wallartMode = cfg.wallartMode;

        if (wallartMode.musicMode && typeof wallartMode.musicMode === 'object') {
            const musicMode = wallartMode.musicMode;

            // Deprecated value removed from UI/schema; normalize old configs.
            if (musicMode.displayStyle === 'album-info') {
                if (report) {
                    report.migration(
                        '[Config Migration] Normalized wallartMode.musicMode.displayStyle',
                        {
                            from: 'album-info',
                            to: 'covers-only',
                        }
                    );
                }
                musicMode.displayStyle = 'covers-only';
                modified = true;
            }

            // Legacy/invalid value that was previously exposed in UI; normalize old configs.
            if (musicMode.displayStyle === 'grid') {
                if (report) {
                    report.migration(
                        '[Config Migration] Normalized wallartMode.musicMode.displayStyle',
                        {
                            from: 'grid',
                            to: 'covers-only',
                        }
                    );
                }
                musicMode.displayStyle = 'covers-only';
                modified = true;
            }

            modified =
                fixEnum(
                    musicMode,
                    'displayStyle',
                    ['covers-only', 'artist-cards'],
                    'covers-only',
                    'wallartMode.musicMode'
                ) || modified;
        }
    }

    // === CINEMA OBJECT ===
    if (!cfg.cinema) {
        cfg.cinema = {};
        modified = true;
    }
    const cinema = cfg.cinema;

    modified = fixEnum(cinema, 'orientation', VALID.orientation, 'auto', 'cinema') || modified;

    // === GLOBAL EFFECTS ===
    modified = ensureObj(cinema, 'globalEffects') || modified;
    const globalEffects = cinema.globalEffects;

    modified =
        fixEnum(globalEffects, 'colorFilter', VALID.colorFilter, 'none', 'globalEffects') ||
        modified;

    // Validate tintColor
    if (globalEffects.tintColor && !/^#[0-9A-Fa-f]{6}$/.test(globalEffects.tintColor)) {
        globalEffects.tintColor = '#ff6b00';
        modified = true;
    }

    // Validate contrast (50-150)
    if (globalEffects.contrast !== undefined) {
        if (
            typeof globalEffects.contrast !== 'number' ||
            globalEffects.contrast < 50 ||
            globalEffects.contrast > 150
        ) {
            globalEffects.contrast = 100;
            modified = true;
        }
    }

    // Validate brightness (50-150)
    if (globalEffects.brightness !== undefined) {
        if (
            typeof globalEffects.brightness !== 'number' ||
            globalEffects.brightness < 50 ||
            globalEffects.brightness > 150
        ) {
            globalEffects.brightness = 100;
            modified = true;
        }
    }

    // Validate fontFamily (global typography)
    modified =
        fixEnum(
            globalEffects,
            'fontFamily',
            VALID.headerFontFamily,
            'cinematic',
            'globalEffects'
        ) || modified;

    // Validate textColorMode
    modified =
        fixEnum(globalEffects, 'textColorMode', VALID.textColorMode, 'custom', 'globalEffects') ||
        modified;

    // Validate textColor
    if (globalEffects.textColor && !/^#[0-9A-Fa-f]{6}$/.test(globalEffects.textColor)) {
        globalEffects.textColor = '#ffffff';
        modified = true;
    }

    // Validate tonSurTonIntensity (10-100)
    if (globalEffects.tonSurTonIntensity !== undefined) {
        if (
            typeof globalEffects.tonSurTonIntensity !== 'number' ||
            globalEffects.tonSurTonIntensity < 10 ||
            globalEffects.tonSurTonIntensity > 100
        ) {
            globalEffects.tonSurTonIntensity = 45;
            modified = true;
        }
    }

    // Validate textEffect
    modified =
        fixEnum(globalEffects, 'textEffect', VALID.textEffect, 'subtle', 'globalEffects') ||
        modified;

    // === HEADER ===
    modified = ensureObj(cinema, 'header') || modified;
    const header = cinema.header;

    // Remove deprecated header.style
    modified = removeProperty(header, 'style', 'cinema.header') || modified;

    // Ensure header has required fields
    if (header.enabled === undefined) {
        header.enabled = true;
        modified = true;
    }
    if (!header.text) {
        header.text = 'Now Playing';
        modified = true;
    }

    // === HEADER TYPOGRAPHY ===
    // Migrate from cinema.typography if exists
    if (cinema.typography && !header.typography) {
        const oldTypo = cinema.typography;
        header.typography = {
            fontFamily: VALID.headerFontFamily.includes(oldTypo.fontFamily)
                ? oldTypo.fontFamily
                : 'cinematic',
            fontSize: typeof oldTypo.titleSize === 'number' ? oldTypo.titleSize : 100,
            color: /^#[0-9A-Fa-f]{6}$/.test(oldTypo.titleColor) ? oldTypo.titleColor : '#ffffff',
            shadow: VALID.headerShadow.includes(oldTypo.titleShadow)
                ? oldTypo.titleShadow
                : 'subtle',
            animation: 'none',
        };
        if (report)
            report.migration('[Config Migration] Migrated cinema.typography to header.typography');
        modified = true;
    }

    modified = ensureObj(header, 'typography') || modified;
    const hTypo = header.typography;

    // Validate/fix header typography values
    modified =
        fixEnum(hTypo, 'fontFamily', VALID.headerFontFamily, 'cinematic', 'header.typography') ||
        modified;

    modified =
        fixEnum(hTypo, 'shadow', VALID.headerShadow, 'subtle', 'header.typography') || modified;
    modified =
        fixEnum(hTypo, 'animation', VALID.headerAnimation, 'none', 'header.typography') || modified;
    modified =
        fixEnum(hTypo, 'decoration', VALID.headerDecoration, 'none', 'header.typography') ||
        modified;

    // Remove invalid properties from header.typography
    modified = removeProperty(hTypo, 'effect', 'header.typography') || modified;

    // Ensure valid fontSize
    if (typeof hTypo.fontSize !== 'number' || hTypo.fontSize < 50 || hTypo.fontSize > 200) {
        hTypo.fontSize = 100;
        modified = true;
    }
    // Ensure valid color
    if (!/^#[0-9A-Fa-f]{6}$/.test(hTypo.color)) {
        hTypo.color = '#ffffff';
        modified = true;
    }

    // === FOOTER ===
    modified = ensureObj(cinema, 'footer') || modified;
    const footer = cinema.footer;

    // Remove deprecated properties
    modified = removeProperty(footer, 'marqueeStyle', 'cinema.footer') || modified;
    modified = removeProperty(footer, 'specs', 'cinema.footer') || modified;

    // Ensure footer has required fields
    if (footer.enabled === undefined) {
        footer.enabled = true;
        modified = true;
    }
    if (!footer.marqueeText) {
        footer.marqueeText = 'Feature Presentation';
        modified = true;
    }
    if (footer.taglineMarquee === undefined) {
        footer.taglineMarquee = false;
    }

    // Fix footer.type (migrate "specs" to "metadata")
    if (footer.type === 'specs') {
        footer.type = 'metadata';
        if (report)
            report.migration('[Config Migration] Changed footer.type from "specs" to "metadata"');
        modified = true;
    }
    modified = fixEnum(footer, 'type', VALID.footerType, 'marquee', 'cinema.footer') || modified;

    // === FOOTER TYPOGRAPHY ===
    // Migrate from cinema.typography if exists (for footer)
    if (cinema.typography && !footer.typography) {
        footer.typography = {
            fontFamily: 'system',
            fontSize: 100,
            color: '#cccccc',
            shadow: 'none',
        };
        if (report) report.migration('[Config Migration] Created footer.typography');
        modified = true;
    }

    modified = ensureObj(footer, 'typography') || modified;
    const fTypo = footer.typography;

    // Validate/fix footer typography values
    modified =
        fixEnum(fTypo, 'fontFamily', VALID.footerFontFamily, 'system', 'footer.typography') ||
        modified;
    modified =
        fixEnum(fTypo, 'shadow', VALID.footerShadow, 'none', 'footer.typography') || modified;

    // Remove invalid properties from footer.typography
    modified = removeProperty(fTypo, 'effect', 'footer.typography') || modified;
    modified = removeProperty(fTypo, 'animation', 'footer.typography') || modified;

    // Ensure valid fontSize
    if (typeof fTypo.fontSize !== 'number' || fTypo.fontSize < 50 || fTypo.fontSize > 200) {
        fTypo.fontSize = 100;
        modified = true;
    }
    // Ensure valid color
    if (!/^#[0-9A-Fa-f]{6}$/.test(fTypo.color)) {
        fTypo.color = '#cccccc';
        modified = true;
    }

    // === REMOVE OLD cinema.typography ===
    if (cinema.typography) {
        // Move metadataOpacity to metadata before deleting
        if (cinema.typography.metadataOpacity !== undefined) {
            if (!cinema.metadata) cinema.metadata = {};
            if (cinema.metadata.opacity === undefined) {
                cinema.metadata.opacity = cinema.typography.metadataOpacity;
            }
        }
        delete cinema.typography;
        if (report) report.migration('[Config Migration] Removed deprecated cinema.typography');
        modified = true;
    }

    // === METADATA ===
    modified = ensureObj(cinema, 'metadata') || modified;
    const metadata = cinema.metadata;

    // Ensure metadata has required fields
    if (metadata.enabled === undefined) {
        metadata.enabled = true;
        modified = true;
    }
    if (metadata.opacity === undefined) {
        metadata.opacity = 80;
        modified = true;
    }

    // Fix position (remove "side" option)
    if (metadata.position === 'side') {
        metadata.position = 'bottom';
        if (report)
            report.migration(
                '[Config Migration] Changed metadata.position from "side" to "bottom"'
            );
        modified = true;
    }
    modified =
        fixEnum(metadata, 'position', VALID.metadataPosition, 'bottom', 'metadata') || modified;

    // Ensure layout has valid value (new property)
    if (metadata.layout === undefined) {
        metadata.layout = 'comfortable';
        modified = true;
    }
    modified =
        fixEnum(metadata, 'layout', VALID.metadataLayout, 'comfortable', 'metadata') || modified;

    // === METADATA SPECS ===
    modified = ensureObj(metadata, 'specs') || modified;
    const specs = metadata.specs;

    // Migrate showFlags to showHDR
    if (specs.showFlags !== undefined) {
        specs.showHDR = specs.showFlags;
        delete specs.showFlags;
        if (report) report.migration('[Config Migration] Renamed specs.showFlags to specs.showHDR');
        modified = true;
    }

    // Migrate old style values to new values
    const styleMapping = {
        subtle: 'dark-glass',
        badges: 'icons-text',
        icons: 'icons-only',
    };
    if (specs.style && styleMapping[specs.style]) {
        if (report) {
            report.migration('[Config Migration] Normalized specs.style', {
                from: specs.style,
                to: styleMapping[specs.style],
            });
        }
        specs.style = styleMapping[specs.style];
        modified = true;
    }
    modified =
        fixEnum(specs, 'style', VALID.specsStyle, 'icons-text', 'metadata.specs') || modified;

    // Migrate old iconSet values (filled/outline/mediaflags) to new values (tabler/material)
    if (specs.iconSet === 'filled' || specs.iconSet === 'outline') {
        if (report) {
            report.migration('[Config Migration] Normalized specs.iconSet', {
                from: specs.iconSet,
                to: 'tabler',
            });
        }
        specs.iconSet = 'tabler';
        modified = true;
    }
    if (specs.iconSet === 'mediaflags') {
        if (report) {
            report.migration('[Config Migration] Normalized specs.iconSet', {
                from: 'mediaflags',
                to: 'material',
            });
        }
        specs.iconSet = 'material';
        modified = true;
    }
    modified =
        fixEnum(specs, 'iconSet', VALID.specsIconSet, 'tabler', 'metadata.specs') || modified;

    // === BACKGROUND ===
    if (cinema.background) {
        modified =
            fixEnum(cinema.background, 'mode', VALID.backgroundMode, 'solid', 'background') ||
            modified;
        modified =
            fixEnum(cinema.background, 'vignette', VALID.vignette, 'subtle', 'background') ||
            modified;

        // Validate blurAmount
        if (cinema.background.blurAmount !== undefined) {
            if (
                typeof cinema.background.blurAmount !== 'number' ||
                cinema.background.blurAmount < 5 ||
                cinema.background.blurAmount > 50
            ) {
                cinema.background.blurAmount = 20;
                modified = true;
            }
        }
        // Validate solidColor
        if (
            cinema.background.solidColor &&
            !/^#[0-9A-Fa-f]{6}$/.test(cinema.background.solidColor)
        ) {
            cinema.background.solidColor = '#000000';
            modified = true;
        }
    }

    // === POSTER ===
    if (cinema.poster) {
        modified =
            fixEnum(cinema.poster, 'style', VALID.posterStyle, 'floating', 'poster') || modified;
        modified =
            fixEnum(cinema.poster, 'overlay', VALID.posterOverlay, 'none', 'poster') || modified;
        modified =
            fixEnum(cinema.poster, 'animation', VALID.posterAnimation, 'fade', 'poster') ||
            modified;

        // Validate frameColor
        if (cinema.poster.frameColor && !/^#[0-9A-Fa-f]{6}$/.test(cinema.poster.frameColor)) {
            cinema.poster.frameColor = '#333333';
            modified = true;
        }
        // Validate frameWidth
        if (cinema.poster.frameWidth !== undefined) {
            if (
                typeof cinema.poster.frameWidth !== 'number' ||
                cinema.poster.frameWidth < 2 ||
                cinema.poster.frameWidth > 20
            ) {
                cinema.poster.frameWidth = 8;
                modified = true;
            }
        }
        // Validate transitionDuration
        if (cinema.poster.transitionDuration !== undefined) {
            if (
                typeof cinema.poster.transitionDuration !== 'number' ||
                cinema.poster.transitionDuration < 0.5 ||
                cinema.poster.transitionDuration > 5
            ) {
                cinema.poster.transitionDuration = 1.5;
                modified = true;
            }
        }
    }

    // === PROMOTIONAL ===
    // === CINEMATIC TRANSITIONS (compat) ===
    // Normalize deprecated/removed transition names so existing installs keep starting.
    // This must run before schema validation because config.schema.json enumerates valid transitions.
    try {
        const { changed } = normalizeCinematicTransitions(cfg);
        if (changed) {
            if (report) {
                report.migration('[Config Migration] Normalized cinematic transition names');
            }
            modified = true;
        }
    } catch (_) {
        // Never block startup on compat normalization failures
    }

    // === PROMOTIONAL ===
    if (cinema.promotional) {
        // Trailer settings - no validation needed, just boolean options

        // QR Code settings
        if (cinema.promotional.qrCode) {
            modified =
                fixEnum(
                    cinema.promotional.qrCode,
                    'position',
                    VALID.qrPosition,
                    'bottomRight',
                    'promotional.qrCode'
                ) || modified;

            // Validate size
            if (cinema.promotional.qrCode.size !== undefined) {
                if (
                    typeof cinema.promotional.qrCode.size !== 'number' ||
                    cinema.promotional.qrCode.size < 60 ||
                    cinema.promotional.qrCode.size > 200
                ) {
                    cinema.promotional.qrCode.size = 100;
                    modified = true;
                }
            }
        }
    }

    // === AMBILIGHT ===
    if (cinema.ambilight) {
        if (cinema.ambilight.strength !== undefined) {
            if (
                typeof cinema.ambilight.strength !== 'number' ||
                cinema.ambilight.strength < 0 ||
                cinema.ambilight.strength > 100
            ) {
                cinema.ambilight.strength = 60;
                modified = true;
            }
        }
    }

    // === SAVE IF MODIFIED ===
    // Don't write to disk during tests to avoid corrupting test data
    if (modified && process.env.NODE_ENV !== 'test') {
        try {
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
            if (report) report.saved('migration');
        } catch (err) {
            console.error('[Config Migration] Failed to save repaired config:', err.message);
            if (report) report.saveError('migration', err);
        }
    }

    return modified;
}

/**
 * Self-healing: Remove unknown properties that would cause schema validation to fail.
 * This recursively traverses the config and removes any properties not defined in the schema.
 * @param {object} cfg - The config object to clean
 * @param {object} schema - The JSON schema
 * @returns {boolean} - True if any properties were removed
 */
function removeUnknownProperties(cfg, schema, options = {}) {
    let removed = false;
    const report = options && options.report;

    if (!cfg || typeof cfg !== 'object' || !schema) return false;

    /**
     * Recursively clean an object against a schema definition
     * @param {object} obj - Object to clean
     * @param {object} schemaDef - Schema definition for this object
     * @param {string} pathStr - Current path for logging
     */
    function cleanObject(obj, schemaDef, pathStr) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
        if (!schemaDef || schemaDef.type !== 'object') return;

        const allowedProps = schemaDef.properties ? Object.keys(schemaDef.properties) : [];
        const additionalAllowed = schemaDef.additionalProperties !== false;

        // Get all current keys
        const currentKeys = Object.keys(obj);

        for (const key of currentKeys) {
            // Check if this property is allowed
            if (!additionalAllowed && !allowedProps.includes(key)) {
                if (report) report.removedUnknown(`${pathStr}.${key}`);
                delete obj[key];
                removed = true;
                continue;
            }

            // Recursively clean nested objects
            if (schemaDef.properties && schemaDef.properties[key]) {
                const propSchema = schemaDef.properties[key];
                if (propSchema.type === 'object' && obj[key] && typeof obj[key] === 'object') {
                    cleanObject(obj[key], propSchema, `${pathStr}.${key}`);
                }
                // Handle arrays of objects
                if (propSchema.type === 'array' && propSchema.items && Array.isArray(obj[key])) {
                    obj[key].forEach((item, idx) => {
                        if (item && typeof item === 'object') {
                            cleanObject(item, propSchema.items, `${pathStr}.${key}[${idx}]`);
                        }
                    });
                }
            }
        }
    }

    // Start cleaning from root
    cleanObject(cfg, schema, 'config');

    // Save if we removed anything
    if (removed && process.env.NODE_ENV !== 'test') {
        try {
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
            if (report) report.saved('self-heal');
        } catch (err) {
            console.error('[Config Self-Heal] Failed to save cleaned config:', err.message);
            if (report) report.saveError('self-heal', err);
        }
    }

    return removed;
}

const configMaintenanceReport = createConfigMaintenanceReport();

// Run self-healing to remove unknown properties BEFORE migrations
removeUnknownProperties(config, configSchema, { report: configMaintenanceReport });

// Run migrations before validation
migrateConfig(config, { report: configMaintenanceReport });

configMaintenanceReport.emitSummaryIfNeeded({ phase: 'startup' });

// Export the validation function for use by other modules
function validateEnvironment() {
    // Defer config schema validation error output until after env var checks to match test expectations
    const isConfigValid = validate(config);

    /**
     * Determines which environment variables are required based on the configuration.
     * @param {object} appConfig The application's config.json content.
     * @returns {{required: Set<string>, tokens: string[]}} An object containing a set of required variable names and an array of token variable names.
     */
    function getRequiredVars(appConfig) {
        const required = new Set();
        const tokens = [];

        // Session secret is needed if an admin user exists
        if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH) {
            required.add('SESSION_SECRET');
        }

        const enabledServers = (appConfig.mediaServers || []).filter(s => s.enabled);
        if (enabledServers.length === 0) {
            console.warn(
                '\x1b[33m%s\x1b[0m',
                'WARNING: No media servers are enabled in config.json. The application will run but will not display any media.'
            );
        }

        for (const server of enabledServers) {
            // Hostname/port now come strictly from config.json. Only token env var is required (unless direct token provided).
            if (server.tokenEnvVar && !server.token) {
                required.add(server.tokenEnvVar);
                tokens.push(server.tokenEnvVar);
            }

            // RomM uses 'url' field instead of hostname/port
            if (server.type === 'romm') {
                if (!server.url) {
                    console.warn(
                        `[Config] WARNING: Enabled RomM server "${server.name}" missing mandatory url - will be disabled at runtime`
                    );
                    // Don't exit - let the server start and disable this source
                }
            } else {
                // Plex and Jellyfin require hostname and port
                if (!server.hostname || !server.port) {
                    console.warn(
                        `[Config] WARNING: Enabled server "${server.name}" missing mandatory hostname/port - will be disabled at runtime`
                    );
                    // Don't exit - let the server start and disable this source
                }
            }
        }
        return { required, tokens };
    }

    const { required: requiredVarsSet, tokens: tokenVars } = getRequiredVars(config);

    const missingVars = [...requiredVarsSet].filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: Missing required environment variables.');
        console.error('The following variables are not set in your .env file:');
        missingVars.forEach(varName => console.error(`  - ${varName}`));
        console.error(
            '\nPlease copy `config.example.env` to a new file named `.env` and fill in the required values.'
        );
        const isJestRun = !!process.env.JEST_WORKER_ID;
        if (process.env.NODE_ENV !== 'test' && !isJestRun) {
            process.exit(1); // Exit with an error code to prevent server from starting
        } else {
            console.warn('[Test Mode] Missing env vars but continuing...');
            return false;
        }
    }

    // Only now report config schema validation errors (if any) after env var fatal checks
    if (!isConfigValid) {
        const isJestRun = !!process.env.JEST_WORKER_ID;
        const isTestRun = process.env.NODE_ENV === 'test' || isJestRun;
        const verboseTestLogging =
            String(process.env.TEST_VERBOSE_CONFIG_VALIDATION || '').trim() === '1' ||
            String(process.env.TEST_VERBOSE_CONFIG_VALIDATION || '')
                .trim()
                .toLowerCase() === 'true';

        if (isTestRun && !verboseTestLogging) {
            // Keep at least one console.error call (some tests assert it), but avoid huge spam.
            console.error('FATAL ERROR: config.json is invalid (test mode).');
            console.error(`Validation errors: ${(validate.errors || []).length}`);
        } else {
            console.error(
                '\x1b[31m%s\x1b[0m',
                'FATAL ERROR: config.json is invalid. Please correct the following errors:'
            );
            validate.errors.forEach(error => {
                const instancePath = error.instancePath || 'root';
                const readablePath = instancePath.replace(/\//g, ' -> ').substring(3) || 'root';
                console.error(`  - Path: \x1b[33m${readablePath}\x1b[0m`);
                console.error(`    Message: ${error.message}`);
                if (error.params) {
                    console.error(`    Details: ${JSON.stringify(error.params)}`);
                }
            });
        }
        // Don't exit during tests, just log the error
        if (process.env.NODE_ENV !== 'test' && !isJestRun) {
            process.exit(1);
        } else {
            console.warn('[Test Mode] Config validation failed but continuing...');
            return false;
        }
    }

    tokenVars.forEach(tokenVar => {
        if (process.env[tokenVar] === 'YourPlexTokenHere') {
            console.warn(
                '\x1b[33m%s\x1b[0m',
                `WARNING: The environment variable ${tokenVar} seems to be a placeholder value.`
            );
            console.warn(
                'Please replace "YourPlexTokenHere" with your actual token in the .env file.'
            );
        }
    });
}

module.exports = { validate: validateEnvironment, migrateConfig };
