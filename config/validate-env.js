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
        process.exit(1);
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
        process.exit(1);
    }
}

const Ajv = require('ajv');
// Use example env during tests, real .env otherwise
const envFileToUse = process.env.NODE_ENV === 'test' ? exampleEnvPath : envPath;
require('dotenv').config({ path: envFileToUse });

// --- Schema Validation ---
// @ts-ignore - Ajv constructor is valid but TypeScript doesn't recognize it from require()
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true }); // allowUnionTypes to support multi-type definitions
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
    process.exit(1);
}
const validate = ajv.compile(configSchema);

let config;
try {
    config = JSON.parse(String(safeReadFile(configPath, { preferMockForConfig: true })));
} catch (error) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: Could not read or parse config.json.');
    console.error(error.message);
    process.exit(1);
}

/**
 * Migrate and repair config to ensure it always validates against schema.
 * This handles breaking changes and invalid values automatically.
 * @param {object} cfg - The config object to migrate/repair
 * @returns {boolean} - True if config was modified and needs saving
 */
function migrateConfig(cfg) {
    let modified = false;

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
        // Footer
        footerType: ['marquee', 'metadata', 'tagline'],
        footerFontFamily: ['system', 'cinematic', 'classic', 'modern', 'elegant'],
        footerShadow: ['none', 'subtle', 'dramatic'],
        // Metadata
        metadataPosition: ['bottom', 'overlay'],
        metadataLayout: ['compact', 'comfortable', 'spacious'],
        specsStyle: ['subtle', 'badges', 'icons'],
        specsIconSet: ['tabler', 'mediaflags'],
        // Background
        backgroundMode: ['solid', 'blur', 'gradient'],
        vignette: ['none', 'subtle', 'dramatic'],
        // Poster
        posterStyle: ['floating', 'framed', 'minimal', 'shadow'],
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
            console.log(
                `[Config Repair] Invalid ${path}.${key}: "${obj[key]}" → "${defaultValue}"`
            );
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
            console.log(`[Config Repair] Removed invalid property: ${path}.${key}`);
            return true;
        }
        return false;
    };

    // === TOP-LEVEL ORIENTATION ===
    modified = fixEnum(cfg, 'cinemaOrientation', VALID.orientation, 'auto', 'config') || modified;

    // === CINEMA OBJECT ===
    if (!cfg.cinema) {
        cfg.cinema = {};
        modified = true;
    }
    const cinema = cfg.cinema;

    modified = fixEnum(cinema, 'orientation', VALID.orientation, 'auto', 'cinema') || modified;

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
        console.log('[Config Migration] Migrated cinema.typography to header.typography');
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

    // Fix footer.type (migrate "specs" to "metadata")
    if (footer.type === 'specs') {
        footer.type = 'metadata';
        console.log('[Config Migration] Changed footer.type from "specs" to "metadata"');
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
        console.log('[Config Migration] Created footer.typography');
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
        console.log('[Config Migration] Removed deprecated cinema.typography');
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
        console.log('[Config Migration] Changed metadata.position from "side" to "bottom"');
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
        console.log('[Config Migration] Renamed specs.showFlags to specs.showHDR');
        modified = true;
    }

    modified = fixEnum(specs, 'style', VALID.specsStyle, 'badges', 'metadata.specs') || modified;

    // Migrate old iconSet values (filled/outline) to new values (tabler/mediaflags)
    if (specs.iconSet === 'filled' || specs.iconSet === 'outline') {
        console.log(`[Config Migration] Changed specs.iconSet from "${specs.iconSet}" to "tabler"`);
        specs.iconSet = 'tabler';
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
    if (cinema.promotional) {
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
    if (modified) {
        try {
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
            console.log('[Config Migration] ✓ Config file repaired and saved');
        } catch (err) {
            console.error('[Config Migration] Failed to save repaired config:', err.message);
        }
    }

    return modified;
}

// Run migrations before validation
migrateConfig(config);

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
        process.exit(1); // Exit with an error code to prevent server from starting
    }

    // Only now report config schema validation errors (if any) after env var fatal checks
    if (!isConfigValid) {
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
        // Don't exit during tests, just log the error
        if (process.env.NODE_ENV !== 'test') {
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

module.exports = { validate: validateEnvironment };
