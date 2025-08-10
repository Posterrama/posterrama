const { shuffleArray } = require('../utils');

describe('Utils', () => {
    describe('shuffleArray', () => {
        it('should shuffle an array and return the same array', () => {
            const originalArray = [1, 2, 3, 4, 5];
            const arrayToShuffle = [...originalArray]; // Copy to avoid mutation during comparison
            
            const result = shuffleArray(arrayToShuffle);
            
            // Should return the same array object (in-place modification)
            expect(result).toBe(arrayToShuffle);
            
            // Should contain the same elements
            expect(result.sort()).toEqual(originalArray.sort());
            expect(result).toHaveLength(originalArray.length);
        });

        it('should handle empty array', () => {
            const emptyArray = [];
            const result = shuffleArray(emptyArray);
            
            expect(result).toBe(emptyArray);
            expect(result).toEqual([]);
        });

        it('should handle single element array', () => {
            const singleElementArray = [42];
            const result = shuffleArray(singleElementArray);
            
            expect(result).toBe(singleElementArray);
            expect(result).toEqual([42]);
        });

        it('should handle two element array', () => {
            const twoElementArray = [1, 2];
            const originalArray = [...twoElementArray];
            
            const result = shuffleArray(twoElementArray);
            
            expect(result).toBe(twoElementArray);
            expect(result.sort()).toEqual(originalArray.sort());
            expect(result).toHaveLength(2);
            // Result should be either [1, 2] or [2, 1]
            expect([1, 2].includes(result[0])).toBe(true);
            expect([1, 2].includes(result[1])).toBe(true);
        });

        it('should maintain all original elements', () => {
            const originalArray = ['a', 'b', 'c', 'd', 'e', 'f'];
            const arrayToShuffle = [...originalArray];
            
            const result = shuffleArray(arrayToShuffle);
            
            // Check that all elements are still present
            originalArray.forEach(element => {
                expect(result).toContain(element);
            });
            
            // Check that no extra elements were added
            expect(result).toHaveLength(originalArray.length);
        });

        it('should work with different data types', () => {
            const mixedArray = [1, 'string', { key: 'value' }, null, undefined, true];
            const originalArray = [...mixedArray];
            
            const result = shuffleArray(mixedArray);
            
            expect(result).toBe(mixedArray);
            expect(result).toHaveLength(originalArray.length);
            
            // Check each original element is still present
            expect(result).toContain(1);
            expect(result).toContain('string');
            expect(result).toContain(originalArray[2]); // Object reference
            expect(result).toContain(null);
            expect(result).toContain(undefined);
            expect(result).toContain(true);
        });

        it('should produce different results on multiple calls (probabilistic)', () => {
            const originalArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const results = [];
            
            // Run shuffle multiple times
            for (let i = 0; i < 10; i++) {
                const arrayToShuffle = [...originalArray];
                shuffleArray(arrayToShuffle);
                results.push(arrayToShuffle.join(','));
            }
            
            // With 10 elements, it's extremely unlikely all shuffles produce the same result
            const uniqueResults = new Set(results);
            expect(uniqueResults.size).toBeGreaterThan(1);
        });

        it('should handle arrays with duplicate elements', () => {
            const arrayWithDuplicates = [1, 1, 2, 2, 3, 3];
            const originalArray = [...arrayWithDuplicates];
            
            const result = shuffleArray(arrayWithDuplicates);
            
            expect(result).toBe(arrayWithDuplicates);
            expect(result.sort()).toEqual(originalArray.sort());
            
            // Check frequency of each element is preserved
            const originalCounts = originalArray.reduce((acc, val) => {
                acc[val] = (acc[val] || 0) + 1;
                return acc;
            }, {});
            
            const resultCounts = result.reduce((acc, val) => {
                acc[val] = (acc[val] || 0) + 1;
                return acc;
            }, {});
            
            expect(resultCounts).toEqual(originalCounts);
        });

        it('should not create a new array', () => {
            const originalArray = [1, 2, 3];
            const originalReference = originalArray;
            
            const result = shuffleArray(originalArray);
            
            // Should be the same object reference
            expect(result).toBe(originalReference);
            expect(result).toBe(originalArray);
        });

        it('should work with large arrays', () => {
            const largeArray = Array.from({ length: 1000 }, (_, i) => i);
            const originalSum = largeArray.reduce((sum, val) => sum + val, 0);
            
            const result = shuffleArray([...largeArray]);
            const resultSum = result.reduce((sum, val) => sum + val, 0);
            
            // Sum should be preserved (all elements still present)
            expect(resultSum).toBe(originalSum);
            expect(result).toHaveLength(1000);
        });

        describe('Edge cases', () => {
            it('should handle array with only null values', () => {
                const nullArray = [null, null, null];
                const result = shuffleArray([...nullArray]);
                
                expect(result).toHaveLength(3);
                expect(result.every(val => val === null)).toBe(true);
            });

            it('should handle array with only undefined values', () => {
                const undefinedArray = [undefined, undefined, undefined];
                const result = shuffleArray([...undefinedArray]);
                
                expect(result).toHaveLength(3);
                expect(result.every(val => val === undefined)).toBe(true);
            });

            it('should handle array with falsy values', () => {
                const falsyArray = [0, false, '', null, undefined, NaN];
                const originalArray = [...falsyArray];
                
                const result = shuffleArray(falsyArray);
                
                expect(result).toHaveLength(originalArray.length);
                // Check each falsy value is still present
                expect(result).toContain(0);
                expect(result).toContain(false);
                expect(result).toContain('');
                expect(result).toContain(null);
                expect(result).toContain(undefined);
                // Note: NaN comparison is special
                expect(result.some(val => Number.isNaN(val))).toBe(true);
            });
        });
    });
});
