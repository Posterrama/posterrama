const { schemas, validate } = require('../validators');

describe('Validators - Unit Tests', () => {
  describe('mediaItem schema', () => {
    test('valid minimal media item passes', () => {
      const data = {
        key: '1',
        title: 'Movie Title',
        type: 'movie',
        source: 'plex'
      };
      const result = validate('mediaItem', data);
      expect(result).toEqual(data);
    });

    test('invalid media item aggregates multiple errors', () => {
      expect(() => validate('mediaItem', { key: 5, type: 'invalid', source: 42 }))
        .toThrow(/Validation error:.*"key" must be a string.*"type" must be one of.*"source" must be a string/);
    });
  });

  describe('changePasswordRequest schema', () => {
    test('password mismatch gives custom message', () => {
      expect(() => validate('changePasswordRequest', { currentPassword: 'a', newPassword: 'StrongPass1!', confirmPassword: 'Mismatch1!' }))
        .toThrow(/New password and confirmation do not match/);
    });
  });

  describe('loginRequest schema', () => {
    test('missing fields produce validation error', () => {
      expect(() => validate('loginRequest', { username: 'user' }))
        .toThrow(/Validation error:/);
    });
  });
});
