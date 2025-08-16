const { shuffleArray } = require('../../utils.js');

describe('Utils Module', () => {
  describe('shuffleArray', () => {
    test('should return the same array instance', () => {
      const original = [1, 2, 3, 4, 5];
      const result = shuffleArray(original);
      
      expect(result).toBe(original); // Same reference
    });

    test('should contain all original elements', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = shuffleArray([...original]); // Copy to avoid mutation
      
      expect(shuffled).toHaveLength(original.length);
      expect(shuffled.sort()).toEqual(original.sort());
    });

    test('should handle empty array', () => {
      const empty = [];
      const result = shuffleArray(empty);
      
      expect(result).toEqual([]);
      expect(result).toBe(empty);
    });

    test('should handle single element array', () => {
      const single = [42];
      const result = shuffleArray(single);
      
      expect(result).toEqual([42]);
      expect(result).toBe(single);
    });

    test('should handle two element array', () => {
      const pair = [1, 2];
      const result = shuffleArray([...pair]);
      
      expect(result).toHaveLength(2);
      expect(result.includes(1)).toBe(true);
      expect(result.includes(2)).toBe(true);
    });

    test('should actually shuffle (statistical test)', () => {
      // Run multiple times to check if shuffling actually happens
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      let sameOrderCount = 0;
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const copy = [...original];
        const shuffled = shuffleArray(copy);
        
        // Check if order remained exactly the same
        if (JSON.stringify(shuffled) === JSON.stringify(original)) {
          sameOrderCount++;
        }
      }

      // Probability of getting same order 100 times is astronomically low
      // Allow for some same orders (should be less than 10% with good shuffling)
      expect(sameOrderCount).toBeLessThan(10);
    });

    test('should handle array with duplicate elements', () => {
      const withDuplicates = [1, 1, 2, 2, 3];
      const result = shuffleArray([...withDuplicates]);
      
      expect(result).toHaveLength(5);
      expect(result.filter(x => x === 1)).toHaveLength(2);
      expect(result.filter(x => x === 2)).toHaveLength(2);
      expect(result.filter(x => x === 3)).toHaveLength(1);
    });

    test('should handle array with different data types', () => {
      const mixed = [1, 'string', null, undefined, { key: 'value' }, [1, 2]];
      const result = shuffleArray([...mixed]);
      
      expect(result).toHaveLength(6);
      expect(result.includes(1)).toBe(true);
      expect(result.includes('string')).toBe(true);
      expect(result.includes(null)).toBe(true);
      expect(result.includes(undefined)).toBe(true);
      expect(result.find(item => typeof item === 'object' && item !== null && item.key === 'value')).toBeDefined();
      expect(result.find(item => Array.isArray(item) && item.length === 2)).toBeDefined();
    });

    test('should maintain array mutability', () => {
      const mutable = [1, 2, 3];
      const result = shuffleArray(mutable);
      
      // Verify that the original array was modified
      expect(result).toBe(mutable);
      
      // Add element to prove it's still mutable
      result.push(4);
      expect(mutable).toHaveLength(4);
      expect(mutable.includes(4)).toBe(true);
    });

    test('should work with large arrays', () => {
      // Test performance and correctness with larger datasets
      const large = Array.from({ length: 1000 }, (_, i) => i);
      const original = [...large];
      const result = shuffleArray(large);
      
      expect(result).toHaveLength(1000);
      expect(result.sort((a, b) => a - b)).toEqual(original);
      expect(result).toBe(large);
    });
  });
});
