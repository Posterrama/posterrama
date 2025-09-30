const Joi = require('joi');

const schemas = {
    mediaItem: Joi.object({
        key: Joi.string().required(),
        title: Joi.string().required(),
        type: Joi.string().valid('movie', 'show', 'episode').required(),
        posterUrl: Joi.string().uri(),
        backdropUrl: Joi.string().uri(),
        year: Joi.number().integer().min(1900).max(2100),
        rating: Joi.number().min(0).max(10),
        source: Joi.string().required(),
        rottenTomatoesScore: Joi.number().integer().min(0).max(100).allow(null),
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
        mediaServers: Joi.array().items(
            Joi.object({
                name: Joi.string().required(),
                type: Joi.string().valid('plex', 'jellyfin').required(),
                enabled: Joi.boolean(),
                hostname: Joi.string().when('enabled', { is: true, then: Joi.required() }),
                port: Joi.number()
                    .integer()
                    .min(1)
                    .when('enabled', { is: true, then: Joi.required() }),
                tokenEnvVar: Joi.string().required(),
                token: Joi.string().optional(),
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

module.exports = {
    schemas,
    validate: (schema, data) => validate(schemas[schema], data),
};
