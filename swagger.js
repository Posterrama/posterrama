/**
 * Swagger Configuration for posterrama.app
 */
const swaggerJsdoc = require('swagger-jsdoc');
const pkg = require('./package.json');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Posterrama API',
      version: pkg.version,
      description: 'API for the Posterrama application, used by the frontend to fetch media and manage configuration.',
    },
    servers: [
      {
        url: '/', // The API is on the same server
        description: 'Local server',
      },
    ],
    components: {
      schemas: {
        MediaItem: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'A unique key for the media item.' },
            title: { type: 'string' },
            backgroundUrl: { type: 'string', description: 'URL for the background image (fanart).' },
            posterUrl: { type: 'string', description: 'URL for the poster image.' },
            clearLogoUrl: { type: 'string', nullable: true, description: 'URL for the ClearLogo image.' },
            tagline: { type: 'string', nullable: true },
            rating: { type: 'number', nullable: true, description: 'The rating (e.g., from IMDb).' },
            year: { type: 'integer', nullable: true },
            imdbUrl: { type: 'string', nullable: true, description: 'URL to the IMDb page.' },
            rottenTomatoes: {
              type: 'object',
              nullable: true,
              properties: {
                score: { type: 'integer', description: 'The Rotten Tomatoes score (0-100).' },
                icon: { type: 'string', enum: ['fresh', 'rotten', 'certified-fresh'], description: 'The icon to display.' },
                originalScore: { type: 'number', description: 'The original score from the source (0-10).' }
              }
            }
          }
        },
        Config: {
          type: 'object',
          properties: {
            clockWidget: { type: 'boolean' },
            transitionIntervalSeconds: { type: 'integer' },
            backgroundRefreshMinutes: { type: 'integer' },
            showClearLogo: { type: 'boolean' },
            showPoster: { type: 'boolean' },
            showMetadata: { type: 'boolean' },
            showRottenTomatoes: { type: 'boolean' },
            rottenTomatoesMinimumScore: { type: 'number' },
          }
        }
      }
    }
  },
  apis: ['./server.js'], // Path to the file containing API annotations
};

const specs = swaggerJsdoc(options);
module.exports = specs;