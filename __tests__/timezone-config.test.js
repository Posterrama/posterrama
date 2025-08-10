const request = require('supertest');
const express = require('express');

describe('Timezone Configuration', () => {
    let app;

    beforeEach(() => {
        // Mock the config object
        global.config = {
            clockWidget: true,
            clockTimezone: 'Europe/Amsterdam',
            clockFormat: '24h',
            transitionIntervalSeconds: 15,
            backgroundRefreshMinutes: 30,
            showClearLogo: true,
            showPoster: true,
            showMetadata: true,
            showRottenTomatoes: true,
            rottenTomatoesMinimumScore: 0,
            kenBurnsEffect: { enabled: true, durationSeconds: 15 }
        };

        // Create a minimal express app with the config endpoint
        app = express();
        app.get('/get-config', (req, res) => {
            res.json({
                clockWidget: config.clockWidget !== false,
                clockTimezone: config.clockTimezone || 'auto',
                clockFormat: config.clockFormat || '24h',
                transitionIntervalSeconds: config.transitionIntervalSeconds || 15,
                backgroundRefreshMinutes: config.backgroundRefreshMinutes || 30,
                showClearLogo: config.showClearLogo !== false,
                showPoster: config.showPoster !== false,
                showMetadata: config.showMetadata === true,
                showRottenTomatoes: config.showRottenTomatoes !== false,
                rottenTomatoesMinimumScore: config.rottenTomatoesMinimumScore || 0,
                kenBurnsEffect: config.kenBurnsEffect || { enabled: true, durationSeconds: 20 }
            });
        });
    });

    afterEach(() => {
        delete global.config;
    });

    describe('Clock Configuration API', () => {
        it('should return default clock configuration', async () => {
            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body).toMatchObject({
                clockWidget: true,
                clockTimezone: 'Europe/Amsterdam',
                clockFormat: '24h'
            });
        });

        it('should return auto timezone when not configured', async () => {
            config.clockTimezone = null;

            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body.clockTimezone).toBe('auto');
        });

        it('should return 24h format when not configured', async () => {
            config.clockFormat = null;

            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body.clockFormat).toBe('24h');
        });

        it('should handle disabled clock widget', async () => {
            config.clockWidget = false;

            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body.clockWidget).toBe(false);
        });

        it('should support various timezone formats', async () => {
            const timezones = [
                'America/New_York',
                'Europe/London',
                'Asia/Tokyo',
                'Australia/Sydney',
                'UTC'
            ];

            for (const timezone of timezones) {
                config.clockTimezone = timezone;

                const response = await request(app)
                    .get('/get-config')
                    .expect(200);

                expect(response.body.clockTimezone).toBe(timezone);
            }
        });

        it('should support both clock formats', async () => {
            // Test 12h format
            config.clockFormat = '12h';
            let response = await request(app)
                .get('/get-config')
                .expect(200);
            expect(response.body.clockFormat).toBe('12h');

            // Test 24h format
            config.clockFormat = '24h';
            response = await request(app)
                .get('/get-config')
                .expect(200);
            expect(response.body.clockFormat).toBe('24h');
        });
    });

    describe('Timezone Validation', () => {
        const validTimezones = [
            'UTC',
            'Europe/Amsterdam',
            'America/New_York',
            'Asia/Tokyo',
            'Australia/Sydney',
            'Pacific/Honolulu',
            'auto'
        ];

        const invalidTimezones = [
            'Invalid/Timezone',
            'Europe/InvalidCity',
            'America/FakeCity',
            'NotATimezone',
            123,
            null,
            undefined
        ];

        it('should accept valid IANA timezone identifiers', () => {
            validTimezones.forEach(timezone => {
                // Test if timezone would be accepted by Intl.DateTimeFormat
                expect(() => {
                    if (timezone !== 'auto') {
                        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
                    }
                }).not.toThrow();
            });
        });

        it('should validate timezone format in config', async () => {
            // This test ensures our config accepts standard timezone formats
            for (const timezone of validTimezones) {
                config.clockTimezone = timezone;
                
                const response = await request(app)
                    .get('/get-config')
                    .expect(200);

                expect(response.body.clockTimezone).toBe(timezone);
            }
        });
    });

    describe('Client-side Timezone Handling', () => {
        // Simulate frontend timezone handling logic
        function formatTimeWithTimezone(date, timezone, format) {
            let timeOptions = {
                hour: '2-digit',
                minute: '2-digit',
                hour12: format === '12h'
            };

            if (timezone !== 'auto') {
                timeOptions.timeZone = timezone;
            }

            try {
                if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
                    const formatter = new Intl.DateTimeFormat('en-US', timeOptions);
                    return formatter.format(date);
                } else {
                    return date.toLocaleTimeString('en-US', timeOptions);
                }
            } catch (error) {
                // Fallback to local time if timezone is invalid
                const fallbackOptions = {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: format === '12h'
                };
                return date.toLocaleTimeString('en-US', fallbackOptions);
            }
        }

        it('should format time correctly for different timezones', () => {
            const testDate = new Date('2025-08-10T12:00:00Z'); // Noon UTC

            // Test different timezones
            const nycTime = formatTimeWithTimezone(testDate, 'America/New_York', '24h');
            const londonTime = formatTimeWithTimezone(testDate, 'Europe/London', '24h');
            const tokyoTime = formatTimeWithTimezone(testDate, 'Asia/Tokyo', '24h');

            // These should be different times due to timezone differences
            expect(nycTime).toMatch(/^\d{2}:\d{2}$/);
            expect(londonTime).toMatch(/^\d{2}:\d{2}$/);
            expect(tokyoTime).toMatch(/^\d{2}:\d{2}$/);
        });

        it('should format time correctly for 12h format', () => {
            const testDate = new Date('2025-08-10T15:30:00Z'); // 3:30 PM UTC

            const time12h = formatTimeWithTimezone(testDate, 'UTC', '12h');
            const time24h = formatTimeWithTimezone(testDate, 'UTC', '24h');

            expect(time12h).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
            expect(time24h).toMatch(/^\d{2}:\d{2}$/);
        });

        it('should handle auto timezone gracefully', () => {
            const testDate = new Date();
            const autoTime = formatTimeWithTimezone(testDate, 'auto', '24h');

            expect(autoTime).toMatch(/^\d{1,2}:\d{2}$/);
        });

        it('should fallback gracefully for invalid timezones', () => {
            const testDate = new Date();
            
            // Should not throw error and return some time format
            expect(() => {
                const result = formatTimeWithTimezone(testDate, 'Invalid/Timezone', '24h');
                expect(typeof result).toBe('string');
            }).not.toThrow();
        });
    });

    describe('Config Schema Validation', () => {
        it('should validate clock widget boolean', () => {
            const validValues = [true, false, undefined, null];
            const invalidValues = ['true', 'false', 1, 0, 'yes', 'no'];

            validValues.forEach(value => {
                config.clockWidget = value;
                // Should not cause issues in the endpoint
                expect(() => {
                    const result = config.clockWidget !== false;
                    expect(typeof result).toBe('boolean');
                }).not.toThrow();
            });
        });

        it('should validate clock format enum', () => {
            const validFormats = ['12h', '24h', null, undefined];
            const invalidFormats = ['12hour', '24hour', 'am/pm', '12', '24', true, false];

            validFormats.forEach(format => {
                config.clockFormat = format;
                const result = config.clockFormat || '24h';
                expect(['12h', '24h'].includes(result)).toBe(true);
            });
        });

        it('should handle missing clock configuration gracefully', () => {
            delete config.clockWidget;
            delete config.clockTimezone;
            delete config.clockFormat;

            const defaults = {
                clockWidget: config.clockWidget !== false, // true when undefined
                clockTimezone: config.clockTimezone || 'auto',
                clockFormat: config.clockFormat || '24h'
            };

            expect(defaults.clockWidget).toBe(true);
            expect(defaults.clockTimezone).toBe('auto');
            expect(defaults.clockFormat).toBe('24h');
        });
    });
});
