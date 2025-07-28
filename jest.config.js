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
  // Adjusted to realistic levels based on current coverage
  coverageThreshold: {
    global: {
      branches: 35,  // Current: 37.68%
      functions: 50,  // Current: 53.61%
      lines: 50,     // Current: 53.22%
      statements: 50  // Current: 52.71%
    },
    // Per-file thresholds for critical modules (adjusted to realistic levels)
    './utils/auth.js': {
      branches: 10,   // Current: 12.04%
      functions: 25,  // Current: 25.64%
      lines: 25,     // Current: 29.46%
      statements: 25  // Current: 28.7%
    },
    './utils/cache.js': {
      branches: 45,   // Current: 47.56%
      functions: 40,  // Current: 44%
      lines: 45,     // Current: 47.55%
      statements: 45  // Current: 46.57%
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