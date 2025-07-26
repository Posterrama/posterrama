module.exports = {
  // Gebruik de Node.js-omgeving voor de tests
  testEnvironment: 'node',
  // Vertel Jest om alleen in de __tests__ map te zoeken naar testen.
  // Dit voorkomt verwarring en zorgt voor een schone projectstructuur.
  roots: ['<rootDir>/__tests__'],
  // Negeer de node_modules map bij het verzamelen van test coverage
  coveragePathIgnorePatterns: ['/node_modules/'],
};