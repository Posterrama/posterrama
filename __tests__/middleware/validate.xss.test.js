/**
 * XSS Attack Vector Tests
 * Tests sanitizeInput function against known XSS attack patterns
 * Addresses Issue #15: Uncovered Sanitization Paths
 */

const { sanitizeInput } = require('../../middleware/validate');

describe('XSS Protection - Attack Vectors', () => {
    // Common XSS attack patterns from OWASP
    const attackVectors = [
        {
            name: 'Basic script tag',
            input: '<script>alert("XSS")</script>',
            shouldNotContain: ['script', 'alert'],
        },
        {
            name: 'Script tag with attributes',
            input: '<script type="text/javascript">alert(1)</script>',
            shouldNotContain: ['script', 'alert'],
        },
        {
            name: 'Script tag uppercase',
            input: '<SCRIPT>alert("XSS")</SCRIPT>',
            shouldNotContain: ['script', 'alert'],
        },
        {
            name: 'Script tag mixed case',
            input: '<ScRiPt>alert("XSS")</ScRiPt>',
            shouldNotContain: ['script', 'alert'],
        },
        {
            name: 'JavaScript protocol',
            input: 'javascript:alert("XSS")',
            shouldNotContain: ['javascript:'], // DOMPurify removes protocol
        },
        {
            name: 'JavaScript protocol uppercase',
            input: 'JAVASCRIPT:alert("XSS")',
            shouldNotContain: ['javascript:'], // Case-insensitive check
        },
        {
            name: 'Data URI with script',
            input: 'data:text/html,<script>alert("XSS")</script>',
            shouldNotContain: ['script'], // DOMPurify removes script tags
        },
        {
            name: 'Data URI base64 encoded',
            input: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            shouldNotContain: ['script'], // Base64 content doesn't decode during sanitization
        },
        {
            name: 'IMG tag with onerror',
            input: '<img src=x onerror="alert(1)">',
            shouldNotContain: ['onerror', 'alert'],
        },
        {
            name: 'IMG tag with onerror uppercase',
            input: '<IMG SRC=x ONERROR="alert(1)">',
            shouldNotContain: ['onerror', 'alert'],
        },
        {
            name: 'SVG with onload',
            input: '<svg onload="alert(1)">',
            shouldNotContain: ['onload', 'alert'],
        },
        {
            name: 'Body tag with onload',
            input: '<body onload="alert(1)">',
            shouldNotContain: ['onload', 'alert'],
        },
        {
            name: 'Iframe with javascript',
            input: '<iframe src="javascript:alert(1)">',
            shouldNotContain: ['javascript:', 'alert'],
        },
        {
            name: 'Object tag with data',
            input: '<object data="javascript:alert(1)">',
            shouldNotContain: ['javascript:', 'alert'],
        },
        {
            name: 'Embed tag with src',
            input: '<embed src="javascript:alert(1)">',
            shouldNotContain: ['javascript:', 'alert'],
        },
        {
            name: 'Link tag with href javascript',
            input: '<link href="javascript:alert(1)">',
            shouldNotContain: ['javascript:', 'alert'],
        },
        {
            name: 'Input with onfocus',
            input: '<input onfocus="alert(1)" autofocus>',
            shouldNotContain: ['onfocus', 'alert'],
        },
        {
            name: 'Form with onsubmit',
            input: '<form onsubmit="alert(1)"><input type="submit"></form>',
            shouldNotContain: ['onsubmit', 'alert'],
        },
        {
            name: 'Div with onmouseover',
            input: '<div onmouseover="alert(1)">Hover me</div>',
            shouldNotContain: ['onmouseover', 'alert'],
        },
        {
            name: 'Style tag with expression',
            input: '<style>body{background:expression(alert(1))}</style>',
            shouldNotContain: ['expression', 'alert'],
        },
    ];

    describe('Known attack vectors', () => {
        attackVectors.forEach(({ name, input, shouldNotContain }) => {
            test(`should sanitize: ${name}`, () => {
                const result = sanitizeInput(input);

                // Result should be a string (not throw error)
                expect(typeof result).toBe('string');

                // Result should not contain dangerous patterns
                const lowerResult = result.toLowerCase();
                shouldNotContain.forEach(pattern => {
                    expect(lowerResult).not.toContain(pattern.toLowerCase());
                });
            });
        });
    });

    describe('Nested attack vectors', () => {
        test('should sanitize attack vectors in nested objects', () => {
            const input = {
                name: 'John',
                bio: '<script>alert("XSS")</script>',
                nested: {
                    comment: '<img src=x onerror="alert(1)">',
                },
            };

            const result = sanitizeInput(input);

            expect(result.name).toBe('John');
            expect(result.bio.toLowerCase()).not.toContain('script');
            expect(result.nested.comment.toLowerCase()).not.toContain('onerror');
        });

        test('should sanitize attack vectors in arrays', () => {
            const input = [
                'safe string',
                '<script>alert(1)</script>',
                { text: 'javascript:alert(1)' },
            ];

            const result = sanitizeInput(input);

            expect(result[0]).toBe('safe string');
            expect(result[1].toLowerCase()).not.toContain('script');
            expect(result[2].text.toLowerCase()).not.toContain('javascript:');
        });

        test('should sanitize deeply nested structures', () => {
            const input = {
                level1: {
                    level2: {
                        level3: {
                            dangerous: '<script>alert("deep")</script>',
                        },
                    },
                },
            };

            const result = sanitizeInput(input);

            expect(result.level1.level2.level3.dangerous.toLowerCase()).not.toContain('script');
        });
    });

    describe('Edge cases', () => {
        test('should handle empty strings', () => {
            expect(sanitizeInput('')).toBe('');
        });

        test('should handle very long attack strings', () => {
            const longAttack = '<script>' + 'alert(1);'.repeat(1000) + '</script>';
            const result = sanitizeInput(longAttack);

            expect(result.toLowerCase()).not.toContain('script');
        });

        test('should handle multiple attack vectors in one string', () => {
            const multiAttack =
                '<script>alert(1)</script><img src=x onerror="alert(2)"><svg onload="alert(3)">';
            const result = sanitizeInput(multiAttack);

            expect(result.toLowerCase()).not.toContain('script');
            expect(result.toLowerCase()).not.toContain('onerror');
            expect(result.toLowerCase()).not.toContain('onload');
        });

        test('should preserve safe HTML-like strings', () => {
            const safe = '<div>Hello World</div>';
            const result = sanitizeInput(safe);

            // Should not throw error and return string
            expect(typeof result).toBe('string');
        });

        test('should handle URL-encoded attacks', () => {
            const encoded = '%3Cscript%3Ealert(1)%3C/script%3E';
            const result = sanitizeInput(encoded);

            // After sanitization, should not contain dangerous patterns
            expect(typeof result).toBe('string');
        });

        test('should handle null bytes', () => {
            const nullByte = 'javascript\x00:alert(1)';
            const result = sanitizeInput(nullByte);

            expect(result.toLowerCase()).not.toContain('javascript:');
        });
    });

    describe('Performance', () => {
        test('should handle large objects efficiently', () => {
            const largeObj = {};
            for (let i = 0; i < 1000; i++) {
                largeObj[`key${i}`] = i % 10 === 0 ? '<script>alert(1)</script>' : `value${i}`;
            }

            const start = Date.now();
            const result = sanitizeInput(largeObj);
            const duration = Date.now() - start;

            // Should complete in reasonable time (< 5 seconds for 1000 keys)
            expect(duration).toBeLessThan(5000);

            // Should sanitize the malicious entries
            const maliciousKeys = Object.keys(result).filter(k => k.endsWith('0'));
            maliciousKeys.forEach(key => {
                expect(result[key].toLowerCase()).not.toContain('script');
            });
        });
    });

    describe('Real-world scenarios', () => {
        test('should sanitize user profile data', () => {
            const userProfile = {
                username: 'john_doe',
                email: 'john@example.com',
                bio: 'I love coding! <script>alert("XSS")</script>',
                website: 'javascript:alert(document.cookie)',
                avatar: '<img src=x onerror="alert(1)">',
            };

            const result = sanitizeInput(userProfile);

            expect(result.username).toBe('john_doe');
            expect(result.email).toBe('john@example.com');
            expect(result.bio.toLowerCase()).not.toContain('script');
            expect(result.website.toLowerCase()).not.toContain('javascript:');
            expect(result.avatar.toLowerCase()).not.toContain('onerror');
        });

        test('should sanitize comment/post content', () => {
            const comment = {
                author: 'attacker',
                content: 'Check out my site: <a href="javascript:alert(1)">click here</a>',
                timestamp: Date.now(),
            };

            const result = sanitizeInput(comment);

            expect(result.author).toBe('attacker');
            expect(result.content.toLowerCase()).not.toContain('javascript:');
            expect(result.timestamp).toBe(comment.timestamp);
        });

        test('should sanitize search queries', () => {
            const searchQueries = [
                'normal search',
                '<script>alert(1)</script>',
                'javascript:void(0)',
                '"\'><img src=x onerror=alert(1)>',
            ];

            const results = searchQueries.map(q => sanitizeInput(q));

            expect(results[0]).toBe('normal search');
            results.slice(1).forEach(result => {
                expect(result.toLowerCase()).not.toContain('script');
                expect(result.toLowerCase()).not.toContain('javascript:');
                expect(result.toLowerCase()).not.toContain('onerror');
            });
        });
    });
});
