module.exports = {
    // Use the Node.js environment for the tests
    testEnvironment: 'node',

    // Tell Jest to only look for tests in the __tests__ directory.
    // This prevents confusion and ensures a clean project structure.
    roots: ['<rootDir>/__tests__'],

    // Add timeout and force exit to prevent hanging
    testTimeout: 30000, // 30 second timeout
    forceExit: true, // Force exit after tests complete

    // Coverage configuration
    collectCoverage: true, // Always collect coverage to enforce thresholds
    collectCoverageFrom: [
        // Include these files in coverage
        '*.js',
        'middleware/*.js',
        'utils/*.js',
        'sources/*.js',
        'config/*.js',
        // Exclude specific files
        '!server.js', // Exclude server.js as it's hard to test fully
        '!ecosystem.config.js',
        '!jest.config.js',
        '!validate-env.js', // Already has dedicated tests
    ],

    // Coverage thresholds - realistic targets based on current coverage
    coverageThreshold: {
        global: {
            branches: 24, // Based on current 42.91% with margin
            functions: 25, // Based on current 43.22% with margin
            lines: 25, // Based on current 45.7% with margin
            statements: 25, // Based on current 45.24% with margin
        },
        // File-specific thresholds for well-tested modules only
        'sources/tmdb.js': { branches: 65, functions: 95, lines: 83, statements: 83 },
        'sources/tvdb.js': { branches: 79, functions: 90, lines: 90, statements: 90 },
        'sources/plex.js': { branches: 100, functions: 100, lines: 100, statements: 100 },
        // FASE 1 improvements - Complete or high coverage
        'utils.js': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'logger.js': { branches: 38, functions: 64, lines: 52, statements: 55 },
        'errors.js': { branches: 100, functions: 100, lines: 100, statements: 100 },
        // FASE 2 improvements - Middleware optimization
        'middleware/cache.js': { branches: 74, functions: 89, lines: 93, statements: 92 },
        'middleware/errorHandler.js': { branches: 100, functions: 88, lines: 98, statements: 98 },
        'middleware/validate.js': { branches: 93, functions: 100, lines: 100, statements: 100 },
        // FASE 3 improvements - Cache utilities
        'utils/cache.js': { branches: 81, functions: 79, lines: 90, statements: 89 },
        // FASE 4 improvements - Rate limiting
        'middleware/rateLimiter.js': { branches: 100, functions: 100, lines: 100, statements: 100 },
        // FASE 5 improvements - Middleware orchestration
        'middleware/index.js': { branches: 92, functions: 100, lines: 98, statements: 98 },
        // FASE 7 improvements - Metrics middleware
        'middleware/metrics.js': { branches: 100, functions: 100, lines: 100, statements: 100 },
        // FASE 8 improvements - Metrics utilities
        'utils/metrics.js': { branches: 85, functions: 94, lines: 96, statements: 96 },
        // FASE 9 improvements - Input validation middleware
        'middleware/validation.js': { branches: 100, functions: 100, lines: 100, statements: 100 },
    },

    // Coverage output formats
    coverageReporters: [
        'text', // Console output
        'text-summary', // Summary in console
        'html', // HTML report in coverage/ directory
        'json', // JSON report
        'lcov', // LCOV format for external tools
    ],

    // Directory where coverage reports will be stored
    coverageDirectory: 'coverage',

    // Ignore these paths when collecting coverage
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/',
        '/logs/',
        '/sessions/',
        '/image_cache/',
        '/screenshots/',
        '/public/',
    ],

    // Test setup and teardown
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // Global test setup for timer cleanup
    globalTeardown: '<rootDir>/jest.teardown.js', // Global teardown for complete cleanup

    // Memory leak detection and cleanup
    detectOpenHandles: true, // Detect open handles that prevent Jest from exiting
    clearMocks: true, // Clear mock calls and instances between tests
    resetMocks: true, // Reset mock implementations between tests
    restoreMocks: true, // Restore original implementations after tests

    // Simplify module resolution so tests can use root-relative paths (e.g. require('sources/tmdb'))
    modulePaths: ['<rootDir>'],

    // Verbose output - reduced for cleaner test output
    verbose: false,
};
