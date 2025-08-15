module.exports = {
  // Use the Node.js environment for the tests
  testEnvironment: 'node',
  
  // Tell Jest to only look for tests in the __tests__ directory.
  // This prevents confusion and ensures a clean project structure.
  roots: ['<rootDir>/__tests__'],
  
  // Add timeout and force exit to prevent hanging
  testTimeout: 30000, // 30 second timeout
  forceExit: true,    // Force exit after tests complete
  
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
  
  // Updated coverage thresholds – set just below current levels to prevent regressions while allowing minor variance.
  // (Current approx: statements 88.85, lines 89.5, functions 92.05, branches 75.68)
  coverageThreshold: {
    global: {
      // Updated thresholds based on current ~91.15 statements / 91.81 lines / 94.22 funcs / 79.57 branches
      branches: 79,      // small safety margin under 79.57
      functions: 94,     // just below 94.22
      lines: 91,         // below 91.81
      statements: 91     // below 91.15
    },
    'sources/tmdb.js': { branches: 70, functions: 95, lines: 85, statements: 85 },
    'sources/tvdb.js': { branches: 73, functions: 89, lines: 80, statements: 80 },
    'sources/plex.js': { branches: 70, functions: 100, lines: 85, statements: 85 },
    'utils/cache.js': { branches: 87, functions: 90, lines: 95, statements: 95 },
    'logger.js': { branches: 88, functions: 100, lines: 93, statements: 94 }
  },
  
  // Coverage output formats
  coverageReporters: [
    'text',           // Console output
    'text-summary',   // Summary in console
    'html',           // HTML report in coverage/ directory
    'json',           // JSON report
    'lcov'            // LCOV format for external tools
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
    '/public/'
  ],
  
  // Test setup and teardown
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // Global test setup for timer cleanup
  globalTeardown: '<rootDir>/jest.teardown.js', // Global teardown for complete cleanup
  
  // Test timeout (in milliseconds)
  testTimeout: 30000,
  
  // Memory leak detection and cleanup
  detectOpenHandles: true, // Detect open handles that prevent Jest from exiting
  clearMocks: true,       // Clear mock calls and instances between tests
  resetMocks: true,       // Reset mock implementations between tests
  restoreMocks: true,     // Restore original implementations after tests
  
  // Simplify module resolution so tests can use root-relative paths (e.g. require('sources/tmdb'))
  modulePaths: ['<rootDir>'],

  // Verbose output - reduced for cleaner test output
  verbose: false
};