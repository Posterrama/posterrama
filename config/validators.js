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
                    .valid('covers-only', 'album-info', 'artist-cards')
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
        mediaServers: Joi.array().items(
            Joi.object({
                name: Joi.string().required(),
                type: Joi.string().valid('plex', 'jellyfin', 'romm').required(),
                enabled: Joi.boolean(),
                // Plex/Jellyfin fields
                hostname: Joi.string().when('type', {
                    is: Joi.valid('plex', 'jellyfin'),
                    then: Joi.when('enabled', { is: true, then: Joi.required() }),
                }),
                port: Joi.number()
                    .integer()
                    .min(1)
                    .when('type', {
                        is: Joi.valid('plex', 'jellyfin'),
                        then: Joi.when('enabled', { is: true, then: Joi.required() }),
                    }),
                tokenEnvVar: Joi.string().when('type', {
                    is: Joi.valid('plex', 'jellyfin'),
                    then: Joi.required(),
                }),
                token: Joi.string().optional(),
                // RomM-specific fields
                url: Joi.string()
                    .uri()
                    .when('type', {
                        is: 'romm',
                        then: Joi.when('enabled', { is: true, then: Joi.required() }),
                    }),
                username: Joi.string().when('type', {
                    is: 'romm',
                    then: Joi.when('enabled', { is: true, then: Joi.required() }),
                }),
                password: Joi.string().optional(),
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
            })
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
