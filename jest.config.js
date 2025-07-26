module.exports = {
  // Use the Node.js environment for the tests
  testEnvironment: 'node',
  // Tell Jest to only look for tests in the __tests__ directory.
  // This prevents confusion and ensures a clean project structure.
  roots: ['<rootDir>/__tests__'],
  // Ignore the node_modules directory when collecting test coverage
  coveragePathIgnorePatterns: ['/node_modules/'],
};