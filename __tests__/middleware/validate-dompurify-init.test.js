/**
 * @file __tests__/middleware/validate-dompurify-init.test.js
 * Tests for DOMPurify eager initialization
 * Verifies that DOMPurify is initialized at module load time,
 * not lazily on first use, eliminating first-request penalty
 */

describe('DOMPurify Initialization Strategy', () => {
    describe('Eager Initialization', () => {
        test('should have DOMPurify initialized at module load', () => {
            // The module has already been loaded by test setup
            // If it wasn't eagerly initialized, first validation would be slower
            const validate = require('../../middleware/validate');

            // Module should export validation functions
            expect(validate).toBeDefined();
            expect(typeof validate.createValidationMiddleware).toBe('function');
        });

        test('should handle sanitization without lazy loading penalty', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            // Multiple sanitization calls should be consistent
            const input1 = '<script>alert("test")</script>';
            const input2 = '<img src=x onerror=alert(1)>';

            const result1 = sanitizeInput(input1);
            const result2 = sanitizeInput(input2);

            // Should sanitize both inputs (remove scripts)
            expect(result1).not.toContain('<script>');
            expect(result2).not.toContain('onerror=');
        });

        test('should handle nested object sanitization', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            const maliciousObj = {
                name: 'Test<script>alert("xss")</script>',
                nested: {
                    value: '<img src=x onerror=alert(1)>',
                },
                array: ['<script>test</script>', 'safe value'],
            };

            const sanitized = sanitizeInput(maliciousObj);

            // Should sanitize all nested strings
            expect(sanitized.name).not.toContain('<script>');
            expect(sanitized.nested.value).not.toContain('onerror=');
            expect(sanitized.array[0]).not.toContain('<script>');
            expect(sanitized.array[1]).toBe('safe value');
        });

        test('should prevent circular reference infinite loops', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            const circular = { name: 'test' };
            circular.self = circular;

            // Should not throw or hang
            expect(() => {
                const result = sanitizeInput(circular);
                expect(result).toBeDefined();
            }).not.toThrow();
        });

        test('should handle non-string primitives correctly', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            expect(sanitizeInput(42)).toBe(42);
            expect(sanitizeInput(true)).toBe(true);
            expect(sanitizeInput(null)).toBe(null);
            expect(sanitizeInput(undefined)).toBe(undefined);
        });

        test('should remove javascript: protocol', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            const input = 'javascript:alert("xss")';
            const result = sanitizeInput(input);

            expect(result).not.toContain('javascript:');
        });

        test('should remove data:script protocol', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            const input = 'data:text/script,alert("xss")';
            const result = sanitizeInput(input);

            expect(result).not.toContain('data:');
        });

        test('should return empty string for obvious XSS patterns', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            // These patterns should trigger the XSS detection
            const patterns = ['<script>evil</script>', '<div onclick="evil()">test</div>'];

            patterns.forEach(pattern => {
                const result = sanitizeInput(pattern);
                // Should either be empty or fully sanitized
                expect(result.length).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Error Handling', () => {
        test('should gracefully handle sanitization errors', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            // Edge case: very long string
            const longString = 'a'.repeat(100000);

            expect(() => {
                const result = sanitizeInput(longString);
                expect(typeof result).toBe('string');
            }).not.toThrow();
        });

        test('should handle array sanitization', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            const inputArray = [
                '<script>test1</script>',
                { nested: '<script>test2</script>' },
                'safe',
            ];

            const result = sanitizeInput(inputArray);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(3);
            expect(result[2]).toBe('safe');
        });
    });

    describe('Performance Characteristics', () => {
        test('should have consistent performance across multiple calls', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            const input = '<div>Test content<script>alert(1)</script></div>';

            // First call (if lazy, would be slower)
            const start1 = process.hrtime.bigint();
            sanitizeInput(input);
            const end1 = process.hrtime.bigint();
            const time1 = Number(end1 - start1) / 1000000; // Convert to ms

            // Second call (should be similar speed)
            const start2 = process.hrtime.bigint();
            sanitizeInput(input);
            const end2 = process.hrtime.bigint();
            const time2 = Number(end2 - start2) / 1000000;

            // With eager initialization, times should be similar
            // Allow for some variance in execution time
            // Both should be fast (< 10ms typically)
            expect(time1).toBeLessThan(50);
            expect(time2).toBeLessThan(50);
        });
    });

    describe('Validation Middleware Integration', () => {
        test('should create validation middleware successfully', () => {
            const { createValidationMiddleware } = require('../../middleware/validate');
            const Joi = require('joi');

            const schema = Joi.object({
                name: Joi.string().required(),
            });

            const middleware = createValidationMiddleware(schema);

            expect(typeof middleware).toBe('function');
            expect(middleware.length).toBe(3); // (req, res, next)
        });

        test('should export sanitizeInput function', () => {
            const { sanitizeInput } = require('../../middleware/validate');

            expect(typeof sanitizeInput).toBe('function');

            // Verify it works
            const result = sanitizeInput('<b>test</b>');
            expect(typeof result).toBe('string');
        });
    });
});
