module.exports = {
  // Use the Node.js environment for the tests
  testEnvironment: 'node',
  
  // Tell Jest to only look for tests in the __tests__ directory.
  // This prevents confusion and ensures a clean project structure.
  roots: ['<rootDir>/__tests__'],
  
  // Coverage configuration
  collectCoverage: false, // Set to true by default if you want coverage always
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
  
  // Coverage thresholds - tests will fail if coverage is below these percentages
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 65,
      statements: 65
    },
    // Per-file thresholds for critical modules (adjusted to realistic levels)
    './utils/auth.js': {
      branches: 25,
      functions: 40,
      lines: 40,
      statements: 40
    },
    './utils/cache.js': {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    },
    './middleware/errorHandler.js': {
      branches: 75,
      functions: 65,
      lines: 75,
      statements: 75
    }
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
  setupFilesAfterEnv: [], // Add global test setup files here if needed
  
  // Test timeout (in milliseconds)
  testTimeout: 30000,
  
  // Verbose output
  verbose: true
};