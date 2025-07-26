/**
 * Swagger/OpenAPI configuration for posterrama.app
 * This file uses swagger-jsdoc to generate an OpenAPI specification from JSDoc comments
 * in the source code. This specification is then used by swagger-ui-express to render
 * the interactive API documentation at the /api-docs endpoint.
 */

const swaggerJSDoc = require('swagger-jsdoc');
const pkg = require('./package.json');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Posterrama API',
            version: pkg.version,
            description: 'API-documentatie voor de posterrama.app screensaver-applicatie. Dit documenteert de publieke API die door de frontend wordt gebruikt om media en configuratie op te halen.',
            contact: {
                name: 'Mark Frelink',
                url: 'https://github.com/mfrelink/posterrama',
            },
            license: {
                name: 'GPL-3.0-or-later',
                url: 'https://www.gnu.org/licenses/gpl-3.0.html',
            },
        },
        tags: [
            {
                name: 'Public API',
                description: 'Eindpunten die beschikbaar zijn voor de frontend-client zonder authenticatie.'
            },
            {
                name: 'Admin API',
                description: 'Beveiligde eindpunten voor het beheren van de applicatie. Vereist een actieve admin-sessie.'
            }
        ],
        servers: [
            {
                url: '/',
                description: 'Huidige server'
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT', // Of een ander tokenformaat
                    description: 'Voer het token in met het "Bearer " voorvoegsel, bv. "Bearer abcde12345"'
                }
            },
            schemas: {
                Config: {
                    type: 'object',
                    properties: {
                        clockWidget: { type: 'boolean', description: 'Of de klok-widget is ingeschakeld.' },
                        transitionIntervalSeconds: { type: 'integer', description: 'Tijd in seconden tussen media-overgangen.' },
                        backgroundRefreshMinutes: { type: 'integer', description: 'Hoe vaak de media-afspeellijst wordt vernieuwd vanaf de server.' },
                        showClearLogo: { type: 'boolean', description: 'Of de ClearLogo-afbeelding moet worden weergegeven.' },
                        showPoster: { type: 'boolean', description: 'Of de poster-afbeelding moet worden weergegeven.' },
                        showMetadata: { type: 'boolean', description: 'Of metadatatekst (tagline, jaar, etc.) moet worden weergegeven.' },
                        showRottenTomatoes: { type: 'boolean', description: 'Of de Rotten Tomatoes-badge moet worden weergegeven.' },
                        rottenTomatoesMinimumScore: { type: 'integer', description: 'Minimale score voor een item om te worden opgenomen als het een Rotten Tomatoes-beoordeling heeft.' },
                        kenBurnsEffect: {
                            type: 'object',
                            properties: {
                                enabled: { type: 'boolean' },
                                durationSeconds: { type: 'integer' }
                            }
                        }
                    }
                },
                MediaItem: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'Een unieke identificatie voor het media-item, samengesteld uit servertype, naam en item-sleutel.' },
                        title: { type: 'string' },
                        backgroundUrl: { type: 'string', format: 'uri', description: 'URL naar de achtergrondafbeelding, geproxied via de app.' },
                        posterUrl: { type: 'string', format: 'uri', description: 'URL naar de posterafbeelding, geproxied via de app.' },
                        clearLogoUrl: { type: 'string', format: 'uri', nullable: true, description: 'URL naar de ClearLogo-afbeelding, geproxied via de app.' },
                        tagline: { type: 'string', nullable: true },
                        rating: { type: 'number', nullable: true, description: 'De algemene publieksbeoordeling (bijv. 7.8).' },
                        year: { type: 'integer', nullable: true },
                        imdbUrl: { type: 'string', format: 'uri', nullable: true, description: 'Directe link naar de IMDb-pagina voor het item.' },
                        rottenTomatoes: {
                            type: 'object',
                            nullable: true,
                            properties: {
                                score: { type: 'integer', description: 'De Rotten Tomatoes-score (0-100).' },
                                icon: { type: 'string', enum: ['fresh', 'rotten', 'certified-fresh'], description: 'Het bijbehorende RT-icoon.' },
                                originalScore: { type: 'number', description: 'De originele score van de bron (bijv. schaal 0-10).' }
                            }
                        }
                    }
                },
                ApiMessage: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', example: 'building' },
                        message: { type: 'string', example: 'Afspeellijst wordt opgebouwd. Probeer het over een paar seconden opnieuw.' },
                        retryIn: { type: 'integer', example: 2000 },
                        error: { type: 'string' }
                    }
                },
                AdminApiResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true },
                        message: { type: 'string' },
                        error: { type: 'string' }
                    }
                },
                PlexConnectionRequest: {
                    type: 'object',
                    required: ['hostname', 'port'],
                    properties: {
                        hostname: { type: 'string', description: 'De hostnaam of het IP-adres van de Plex-server.', example: '192.168.1.10' },
                        port: { type: 'integer', description: 'De poort van de Plex-server.', example: 32400 },
                        token: { type: 'string', description: 'De Plex X-Plex-Token. Optioneel bij testen, verplicht bij ophalen van bibliotheken als er geen is geconfigureerd.' }
                    }
                },
                PlexLibrary: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'De unieke sleutel van de bibliotheek.', example: '1' },
                        name: { type: 'string', description: 'De naam van de bibliotheek.', example: 'Movies' },
                        type: { type: 'string', description: 'Het type van de bibliotheek.', example: 'movie', enum: ['movie', 'show', 'artist'] }
                    }
                },
                PlexLibrariesResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true },
                        libraries: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/PlexLibrary' }
                        }
                    }
                },
                AdminConfigResponse: {
                    type: 'object',
                    properties: {
                        config: { type: 'object', description: 'De volledige inhoud van config.json.' },
                        env: { type: 'object', description: 'Een selectie van relevante omgevingsvariabelen.' },
                        security: {
                            type: 'object',
                            properties: {
                                is2FAEnabled: { type: 'boolean', description: 'Geeft aan of 2FA is ingeschakeld voor de admin.' }
                            }
                        }
                    }
                },
                SaveConfigRequest: {
                    type: 'object',
                    properties: {
                        config: { type: 'object', description: 'Het volledige config.json-object om op te slaan.' },
                        env: { type: 'object', description: 'Sleutel-waardeparen van omgevingsvariabelen om op te slaan.' }
                    }
                },
                ChangePasswordRequest: {
                    type: 'object',
                    required: ['currentPassword', 'newPassword', 'confirmPassword'],
                    properties: {
                        currentPassword: { type: 'string', format: 'password' },
                        newPassword: { type: 'string', format: 'password' },
                        confirmPassword: { type: 'string', format: 'password' }
                    }
                },
                Generate2FAResponse: {
                    type: 'object',
                    properties: {
                        qrCodeDataUrl: { type: 'string', format: 'uri', description: 'Een data-URI van de QR-code afbeelding die gescand kan worden.' }
                    }
                },
                Verify2FARequest: {
                    type: 'object',
                    required: ['token'],
                    properties: {
                        token: { type: 'string', description: 'De 6-cijferige TOTP-code van de authenticator-app.' }
                    }
                },
                Disable2FARequest: {
                    type: 'object',
                    required: ['password'],
                    properties: {
                        password: { type: 'string', format: 'password', description: 'Het huidige admin-wachtwoord van de gebruiker.' }
                    }
                },
                DebugResponse: {
                    type: 'object',
                    properties: {
                        note: { type: 'string', description: 'Een opmerking over de inhoud van de response.' },
                        playlist_item_count: { type: 'integer', description: 'Het aantal items in de huidige afspeellijst-cache.' },
                        playlist_items_raw: {
                            type: 'array',
                            description: 'Een array van de onbewerkte media-objecten zoals ontvangen van de mediaserver.',
                            items: {
                                type: 'object'
                            }
                        }
                    }
                },
                ApiKeyResponse: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'De nieuw gegenereerde API-sleutel. Wordt slechts eenmaal getoond.'
                        },
                        message: { type: 'string' }
                    }
                },
                LogEntry: {
                    type: 'object',
                    properties: {
                        timestamp: { type: 'string', format: 'date-time' },
                        level: { type: 'string', enum: ['LOG', 'ERROR', 'WARN', 'INFO'] },
                        message: { type: 'string' }
                    }
                }
            }
        }
    },
    apis: ['./server.js'], // Pad naar de bestanden met OpenAPI-definities
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;