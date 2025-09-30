const deepMerge = require('../../utils/deep-merge');

describe('deepMerge', () => {
    test('should merge simple objects', () => {
        const target = { a: 1 };
        const source = { b: 2 };
        const result = deepMerge({}, target, source);
        expect(result).toEqual({ a: 1, b: 2 });
    });

    test('should merge nested objects', () => {
        const target = { a: { x: 1 } };
        const source = { a: { y: 2 }, b: 3 };
        const result = deepMerge({}, target, source);
        expect(result).toEqual({ a: { x: 1, y: 2 }, b: 3 });
    });

    test('should handle arrays (replace not merge)', () => {
        const target = { arr: [1, 2] };
        const source = { arr: [3, 4] };
        const result = deepMerge({}, target, source);
        expect(result).toEqual({ arr: [3, 4] });
    });
});
