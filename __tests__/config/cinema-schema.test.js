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
                header: { enabled: true, text: 'Now Playing', style: 'classic' },
                footer: {
                    enabled: true,
                    type: 'specs',
                    specs: {
                        showResolution: true,
                        showAudio: true,
                        showAspectRatio: true,
                        showFlags: false,
                        style: 'subtle',
                        iconSet: 'filled',
                    },
                },
                presets: { headerTexts: ['Now Playing'], footerTexts: ['Feature Presentation'] },
                ambilight: { enabled: true, strength: 60 },
            },
        };
        const ok = validate(cfg);
        if (!ok) console.error(validate.errors);
        expect(ok).toBe(true);
    });
});
