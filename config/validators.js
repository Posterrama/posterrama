const Joi = require('joi');

const schemas = {
    mediaItem: Joi.object({
        key: Joi.string().required(),
        title: Joi.string().required(),
        type: Joi.string().valid('movie', 'show', 'episode', 'game', 'music').required(),
        posterUrl: Joi.string().uri(),
        backdropUrl: Joi.string().uri(),
        year: Joi.number().integer().min(1900).max(2100),
        rating: Joi.number().min(0).max(10),
        source: Joi.string().required(),
        rottenTomatoesScore: Joi.number().integer().min(0).max(100).allow(null),
        // Game-specific fields
        platform: Joi.string().when('type', { is: 'game', then: Joi.optional() }),
        platformId: Joi.number().when('type', { is: 'game', then: Joi.optional() }),
        // Music-specific fields
        artist: Joi.string().when('type', { is: 'music', then: Joi.optional() }),
        artistId: Joi.string().when('type', { is: 'music', then: Joi.optional() }),
        album: Joi.string().when('type', { is: 'music', then: Joi.optional() }),
        albumId: Joi.string().when('type', { is: 'music', then: Joi.optional() }),
        genres: Joi.array().items(Joi.string()).when('type', { is: 'music', then: Joi.optional() }),
        styles: Joi.array().items(Joi.string()).when('type', { is: 'music', then: Joi.optional() }),
        moods: Joi.array().items(Joi.string()).when('type', { is: 'music', then: Joi.optional() }),
    }),

    config: Joi.object({
        clockWidget: Joi.boolean(),
        transitionIntervalSeconds: Joi.number().integer().min(5).max(3600),
        backgroundRefreshMinutes: Joi.number().integer().min(5).max(1440),
        showClearLogo: Joi.boolean(),
        showPoster: Joi.boolean(),
        showMetadata: Joi.boolean(),
        showRottenTomatoes: Joi.boolean(),
        rottenTomatoesMinimumScore: Joi.number().min(0).max(10),
        kenBurnsEffect: Joi.object({
            enabled: Joi.boolean(),
            durationSeconds: Joi.number().integer().min(5).max(60),
        }),
        wallartMode: Joi.object({
            musicMode: Joi.object({
                enabled: Joi.boolean().default(false),
                displayStyle: Joi.string()
                    .valid('covers-only', 'artist-cards')
                    .default('covers-only'),
                animation: Joi.string()
                    .valid('vinyl-spin', 'slide-fade', 'crossfade', 'flip')
                    .default('vinyl-spin'),
                density: Joi.string().valid('low', 'medium', 'high', 'ludicrous').default('medium'),
                showArtist: Joi.boolean().default(true),
                showAlbumTitle: Joi.boolean().default(true),
                showYear: Joi.boolean().default(true),
                showGenre: Joi.boolean().default(false),
                artistRotationSeconds: Joi.number().integer().min(10).max(600).default(60),
                sortMode: Joi.string()
                    .valid('weighted-random', 'recent', 'popular', 'alphabetical', 'random')
                    .default('weighted-random'),
                sortWeights: Joi.object({
                    recent: Joi.number().integer().min(0).max(100).default(20),
                    popular: Joi.number().integer().min(0).max(100).default(30),
                    random: Joi.number().integer().min(0).max(100).default(50),
                }).default({ recent: 20, popular: 30, random: 50 }),
            }).optional(),
        }).optional(),
        burnInPrevention: Joi.object({
            enabled: Joi.boolean().default(false),
            level: Joi.string().valid('subtle', 'moderate', 'aggressive').default('subtle'),
            pixelShift: Joi.object({
                enabled: Joi.boolean().default(true),
                amount: Joi.number().integer().min(1).max(10).default(2),
                intervalMs: Joi.number().integer().min(10000).max(3600000).default(180000),
            }).default({ enabled: true, amount: 2, intervalMs: 180000 }),
            elementCycling: Joi.object({
                enabled: Joi.boolean().default(true),
                intervalMs: Joi.number().integer().min(30000).max(3600000).default(300000),
                fadeMs: Joi.number().integer().min(0).max(2000).default(500),
            }).default({ enabled: true, intervalMs: 300000, fadeMs: 500 }),
            screenRefresh: Joi.object({
                enabled: Joi.boolean().default(false),
                intervalMs: Joi.number().integer().min(60000).max(86400000).default(3600000),
                type: Joi.string().valid('blackout', 'colorWipe').default('blackout'),
                durationMs: Joi.number().integer().min(50).max(2000).default(100),
            }).default({ enabled: false, intervalMs: 3600000, type: 'blackout', durationMs: 100 }),
        }).optional(),
        mediaServers: Joi.array().items(
            Joi.object({
                name: Joi.string().required(),
                type: Joi.string().valid('plex', 'jellyfin', 'romm').required(),
                enabled: Joi.boolean(),
                // Plex/Jellyfin fields (allow empty/missing - runtime will disable if enabled but incomplete)
                hostname: Joi.string().allow('').optional(),
                port: Joi.number().integer().min(1).allow(null).optional(),
                tokenEnvVar: Joi.string().when('type', {
                    is: Joi.valid('plex', 'jellyfin'),
                    then: Joi.required(),
                }),
                token: Joi.string().optional(),
                // RomM-specific fields (allow empty strings - runtime will disable if enabled but incomplete)
                url: Joi.string().allow('').optional(),
                username: Joi.string().allow('').optional(),
                password: Joi.string().allow('').optional().default(''),
                passwordEnvVar: Joi.string().optional(),
                selectedPlatforms: Joi.array().items(Joi.string()).optional(),
                filters: Joi.object({
                    favouritesOnly: Joi.boolean().default(false),
                    playableOnly: Joi.boolean().default(false),
                    excludeUnidentified: Joi.boolean().default(true),
                }).optional(),
                // Reject legacy fields explicitly
                hostnameEnvVar: Joi.any().forbidden().messages({
                    'any.unknown': 'hostnameEnvVar is no longer supported. Use hostname instead.',
                }),
                portEnvVar: Joi.any().forbidden().messages({
                    'any.unknown': 'portEnvVar is no longer supported. Use port instead.',
                }),
            }).custom((server, helpers) => {
                // Startup config validation should reject enabled servers with missing required fields.
                // (Runtime can still disable servers later, but config should be coherent.)
                if (server?.type !== 'romm' || server?.enabled !== true) return server;

                const urlOk = typeof server.url === 'string' && server.url.trim().length > 0;
                const usernameOk =
                    typeof server.username === 'string' && server.username.trim().length > 0;

                const passwordOk =
                    typeof server.password === 'string' && server.password.trim().length > 0;
                const passwordEnvVarOk =
                    typeof server.passwordEnvVar === 'string' &&
                    server.passwordEnvVar.trim().length > 0;

                if (!urlOk || !usernameOk) {
                    return helpers.message(
                        'RomM server is enabled and must include non-empty url and username'
                    );
                }

                if (!passwordOk && !passwordEnvVarOk) {
                    return helpers.message(
                        'RomM server is enabled and must include password or passwordEnvVar'
                    );
                }

                return server;
            }, 'RomM enabled credentials validation')
        ),
    }),

    loginRequest: Joi.object({
        username: Joi.string().required(),
        password: Joi.string().required(),
    }),

    changePasswordRequest: Joi.object({
        currentPassword: Joi.string().required(),
        newPassword: Joi.string().min(8).required(),
        confirmPassword: Joi.string()
            .valid(Joi.ref('newPassword'))
            .required()
            .messages({ 'any.only': 'New password and confirmation do not match' }),
    }),
};

function validate(schema, data) {
    const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (error) {
        const details = error.details.map(err => err.message).join(', ');
        throw new Error(`Validation error: ${details}`);
    }

    return value;
}

/**
 * Validate configuration object at application startup
 * Returns validation result with success flag and errors array
 * @param {object} config - Configuration object to validate
 * @returns {object} Validation result { valid: boolean, errors: array, sanitized: object }
 */
function validateConfig(config) {
    const { error, value } = schemas.config.validate(config, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (error) {
        return {
            valid: false,
            errors: error.details.map(err => ({
                path: err.path.join('.'),
                message: err.message,
                type: err.type,
            })),
            sanitized: null,
        };
    }

    return {
        valid: true,
        errors: [],
        sanitized: value,
    };
}

module.exports = {
    schemas,
    validate: (schema, data) => validate(schemas[schema], data),
    validateConfig,
};
