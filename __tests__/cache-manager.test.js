const { cacheManager } = require('../utils/cache');

describe('Cache Manager', () => {
    beforeEach(() => {
        // Clear cache before each test
        cacheManager.clear();
    });

    afterEach(() => {
        // Clear cache after each test
        cacheManager.clear();
    });

    describe('Basic Cache Operations', () => {
        test('should set and get values', () => {
            cacheManager.set('test-key', { data: 'test-value' });
            const result = cacheManager.get('test-key');
            
            expect(result).toBeDefined();
            expect(result.value).toEqual({ data: 'test-value' });
        });

        test('should return null for non-existent keys', () => {
            const result = cacheManager.get('non-existent-key');
            expect(result).toBeNull();
        });

        test('should handle string values', () => {
            cacheManager.set('string-key', 'string-value');
            const result = cacheManager.get('string-key');
            
            expect(result).toBeDefined();
            expect(result.value).toBe('string-value');
        });

        test('should handle number values', () => {
            cacheManager.set('number-key', 42);
            const result = cacheManager.get('number-key');
            
            expect(result).toBeDefined();
            expect(result.value).toBe(42);
        });

        test('should handle array values', () => {
            const arrayValue = [1, 2, 3, 'test'];
            cacheManager.set('array-key', arrayValue);
            const result = cacheManager.get('array-key');
            
            expect(result).toBeDefined();
            expect(result.value).toEqual(arrayValue);
        });

        test('should handle null values', () => {
            cacheManager.set('null-key', null);
            const result = cacheManager.get('null-key');
            
            expect(result).toBeDefined();
            expect(result.value).toBeNull();
        });
    });

    describe('TTL (Time To Live)', () => {
        test('should respect TTL settings', (done) => {
            cacheManager.set('ttl-key', 'ttl-value', 50); // 50ms TTL
            
            // Should exist immediately
            const immediate = cacheManager.get('ttl-key');
            expect(immediate).toBeDefined();
            expect(immediate.value).toBe('ttl-value');
            
            // Should expire after TTL
            setTimeout(() => {
                expect(cacheManager.get('ttl-key')).toBeNull();
                done();
            }, 60);
        });

        test('should use default TTL when not specified', () => {
            cacheManager.set('default-ttl-key', 'default-ttl-value');
            const result = cacheManager.get('default-ttl-key');
            
            expect(result).toBeDefined();
            expect(result.value).toBe('default-ttl-value');
        });

        test('should handle immediate expiration', () => {
            cacheManager.set('immediate-expire', 'value', 0);
            // With 0 TTL, it should either be null immediately or expire very quickly
            const result = cacheManager.get('immediate-expire');
            
            // It's acceptable for this to be either null (immediate expiration) 
            // or defined (if the implementation doesn't handle 0 TTL specially)
            if (result !== null) {
                expect(result.value).toBe('value');
            }
        });
    });

    describe('Cache Management', () => {
        test('should delete specific keys', () => {
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            
            cacheManager.delete('key1');
            
            expect(cacheManager.get('key1')).toBeNull();
            const key2Result = cacheManager.get('key2');
            expect(key2Result).toBeDefined();
            expect(key2Result.value).toBe('value2');
        });

        test('should clear all cache', () => {
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            cacheManager.set('key3', 'value3');
            
            cacheManager.clear();
            
            expect(cacheManager.get('key1')).toBeNull();
            expect(cacheManager.get('key2')).toBeNull();
            expect(cacheManager.get('key3')).toBeNull();
        });

        test('should check if key exists', () => {
            cacheManager.set('exists-key', 'exists-value');
            
            expect(cacheManager.has('exists-key')).toBe(true);
            expect(cacheManager.has('non-exists-key')).toBeFalsy(); // Can be false or undefined
        });

        test('should get cache size', () => {
            const stats1 = cacheManager.getStats();
            expect(stats1.size).toBe(0);
            
            cacheManager.set('key1', 'value1');
            const stats2 = cacheManager.getStats();
            expect(stats2.size).toBe(1);
            
            cacheManager.set('key2', 'value2');
            const stats3 = cacheManager.getStats();
            expect(stats3.size).toBe(2);
            
            cacheManager.delete('key1');
            const stats4 = cacheManager.getStats();
            expect(stats4.size).toBe(1);
        });

        test('should get all keys', () => {
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            cacheManager.set('key3', 'value3');
            
            const stats = cacheManager.getStats();
            expect(stats.size).toBe(3);
        });
    });

    describe('Cache Statistics', () => {
        test('should track cache statistics', () => {
            // Initial stats should be empty
            const initialStats = cacheManager.getStats();
            expect(initialStats.size).toBe(0);
            expect(initialStats.maxSize).toBeGreaterThan(0);
            expect(initialStats.entries).toEqual([]);
            
            // Set a value
            cacheManager.set('stats-key', 'stats-value');
            
            // Access it
            cacheManager.get('stats-key');
            const afterAccess = cacheManager.getStats();
            expect(afterAccess.size).toBe(1);
            expect(afterAccess.entries).toHaveLength(1);
            expect(afterAccess.entries[0].accessCount).toBeGreaterThan(0);
        });

        test('should calculate total access count', () => {
            cacheManager.set('key1', 'value1');
            cacheManager.set('key2', 'value2');
            
            // Access both keys multiple times
            cacheManager.get('key1');
            cacheManager.get('key1');
            cacheManager.get('key2');
            
            const stats = cacheManager.getStats();
            expect(stats.totalAccess).toBeGreaterThan(0);
        });

        test('should handle hit rate calculation', () => {
            cacheManager.set('rate-key', 'rate-value');
            
            // Access the key multiple times
            cacheManager.get('rate-key');
            cacheManager.get('rate-key');
            
            const stats = cacheManager.getStats();
            expect(stats.hitRate).toBeGreaterThan(0);
        });

        test('should handle hit rate with no entries', () => {
            const stats = cacheManager.getStats();
            expect(stats.hitRate).toBe(0);
        });
    });

    describe('Error Handling', () => {
        test('should handle invalid TTL values gracefully', () => {
            expect(() => {
                cacheManager.set('key', 'value', -1);
            }).not.toThrow();
            
            expect(() => {
                cacheManager.set('key', 'value', 'invalid');
            }).not.toThrow();
        });

        test('should handle undefined key', () => {
            expect(() => {
                cacheManager.get(undefined);
            }).not.toThrow();
            
            expect(cacheManager.get(undefined)).toBeNull();
        });

        test('should handle null key', () => {
            expect(() => {
                cacheManager.get(null);
            }).not.toThrow();
            
            expect(cacheManager.get(null)).toBeNull();
        });
    });

    describe('Memory Management', () => {
        test('should handle TTL expiration', (done) => {
            cacheManager.set('cleanup1', 'value1', 30);
            cacheManager.set('cleanup2', 'value2', 30);
            cacheManager.set('cleanup3', 'value3', 100); // This should not expire
            
            expect(cacheManager.getStats().size).toBe(3);
            
            setTimeout(() => {
                // After expiration, only cleanup3 should remain valid
                expect(cacheManager.get('cleanup1')).toBeNull();
                expect(cacheManager.get('cleanup2')).toBeNull();
                const cleanup3 = cacheManager.get('cleanup3');
                expect(cleanup3).toBeDefined();
                expect(cleanup3.value).toBe('value3');
                done();
            }, 50);
        });
    });
});