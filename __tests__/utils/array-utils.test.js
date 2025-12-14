const { shuffleArray } = require('../../utils/array-utils');

describe('utils/array-utils shuffleArray', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('shuffles a 2-item array deterministically (covers swap loop)', () => {
        jest.spyOn(Math, 'random').mockImplementation(() => 0); // j=0

        const arr = [1, 2];
        const result = shuffleArray(arr);

        expect(result).toBe(arr); // in-place
        expect(result).toEqual([2, 1]);
    });

    test('returns empty array unchanged (covers loop not entered)', () => {
        const arr = [];
        const result = shuffleArray(arr);
        expect(result).toBe(arr);
        expect(result).toEqual([]);
    });

    test('returns single-item array unchanged (covers loop not entered)', () => {
        const arr = ['only'];
        const result = shuffleArray(arr);
        expect(result).toBe(arr);
        expect(result).toEqual(['only']);
    });
});
