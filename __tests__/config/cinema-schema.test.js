const Ajv = require('ajv');
const fs = require('fs');

function loadJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('config.schema.json – cinema block', () => {
    test('accepts example config', () => {
        const schema = loadJson('./config.schema.json');
        const example = loadJson('./config.example.json');
        const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
        const validate = ajv.compile(schema);
        const ok = validate(example);
        if (!ok) console.error(validate.errors);
        expect(ok).toBe(true);
    });

    test('minimal cinema config passes', () => {
        const schema = loadJson('./config.schema.json');
        const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
        const validate = ajv.compile(schema);
        const cfg = {
            transitionIntervalSeconds: 10,
            backgroundRefreshMinutes: 60,
            showClearLogo: true,
            showRottenTomatoes: true,
            rottenTomatoesMinimumScore: 0,
            showPoster: true,
            showMetadata: true,
            clockWidget: true,
            transitionEffect: 'kenburns',
            effectPauseTime: 3,
            mediaServers: [],
            cinema: {
                header: { enabled: true, text: 'Now Playing' },
                footer: {
                    enabled: true,
                    type: 'metadata',
                },
                presets: { headerTexts: ['Now Playing'], footerTexts: ['Feature Presentation'] },
                ambilight: { enabled: true, strength: 60 },
            },
        };
        const ok = validate(cfg);
        if (!ok) console.error(validate.errors);
        expect(ok).toBe(true);
    });

    // Issue #126: Enhanced Header Text Effects
    test('accepts header with textEffect and entranceAnimation', () => {
        const schema = loadJson('./config.schema.json');
        const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
        const validate = ajv.compile(schema);
        const cfg = {
            transitionIntervalSeconds: 10,
            backgroundRefreshMinutes: 60,
            showClearLogo: true,
            showRottenTomatoes: true,
            rottenTomatoesMinimumScore: 0,
            showPoster: true,
            showMetadata: true,
            clockWidget: true,
            transitionEffect: 'kenburns',
            effectPauseTime: 3,
            mediaServers: [],
            cinema: {
                header: {
                    enabled: true,
                    text: 'Now Playing',
                    typography: {
                        fontFamily: 'cinematic',
                        fontSize: 100,
                        color: '#ffffff',
                        shadow: 'subtle',
                        textEffect: 'gradient-gold',
                        entranceAnimation: 'cinematic',
                        decoration: 'none',
                    },
                },
                footer: { enabled: true, type: 'metadata' },
                ambilight: { enabled: true, strength: 60 },
            },
        };
        const ok = validate(cfg);
        if (!ok) console.error(validate.errors);
        expect(ok).toBe(true);
    });

    test('validates all textEffect enum values', () => {
        const schema = loadJson('./config.schema.json');
        const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
        const validate = ajv.compile(schema);

        const textEffects = [
            'none',
            'gradient',
            'gradient-rainbow',
            'gradient-gold',
            'gradient-silver',
            'outline',
            'outline-thick',
            'outline-double',
            'metallic',
            'chrome',
            'gold-metallic',
            'vintage',
            'retro',
            'fire',
            'ice',
            'pulse',
            'marquee',
        ];

        for (const effect of textEffects) {
            const cfg = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 60,
                showClearLogo: true,
                showRottenTomatoes: true,
                rottenTomatoesMinimumScore: 0,
                showPoster: true,
                showMetadata: true,
                clockWidget: true,
                transitionEffect: 'kenburns',
                effectPauseTime: 3,
                mediaServers: [],
                cinema: {
                    header: {
                        enabled: true,
                        text: 'Test',
                        typography: { textEffect: effect },
                    },
                },
            };
            const ok = validate(cfg);
            if (!ok) console.error(`textEffect "${effect}" failed:`, validate.errors);
            expect(ok).toBe(true);
        }
    });

    test('validates all entranceAnimation enum values', () => {
        const schema = loadJson('./config.schema.json');
        const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
        const validate = ajv.compile(schema);

        const entranceAnimations = [
            'none',
            'typewriter',
            'fade-words',
            'slide-left',
            'slide-right',
            'slide-top',
            'slide-bottom',
            'zoom',
            'zoom-bounce',
            'blur-focus',
            'float',
            'letter-spread',
            'rotate-3d',
            'flip',
            'drop',
            'fade',
            'cinematic',
        ];

        for (const anim of entranceAnimations) {
            const cfg = {
                transitionIntervalSeconds: 10,
                backgroundRefreshMinutes: 60,
                showClearLogo: true,
                showRottenTomatoes: true,
                rottenTomatoesMinimumScore: 0,
                showPoster: true,
                showMetadata: true,
                clockWidget: true,
                transitionEffect: 'kenburns',
                effectPauseTime: 3,
                mediaServers: [],
                cinema: {
                    header: {
                        enabled: true,
                        text: 'Test',
                        typography: { entranceAnimation: anim },
                    },
                },
            };
            const ok = validate(cfg);
            if (!ok) console.error(`entranceAnimation "${anim}" failed:`, validate.errors);
            expect(ok).toBe(true);
        }
    });
});
