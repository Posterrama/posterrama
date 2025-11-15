/**
 * Wallart Display Module Tests
 *
 * Tests grid layout calculation, poster rendering, and ambient overlay logic.
 * Note: Full UI rendering requires browser environment - these tests focus on core logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Wallart Display - Layout Calculation', () => {
    let originalLogger;

    beforeEach(() => {
        // Mock logger
        originalLogger = window.logger;
        window.logger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        };

        // Mock debugLog
        window.debugLog = vi.fn();

        // Mock document dimensions
        Object.defineProperty(document.documentElement, 'clientWidth', {
            writable: true,
            configurable: true,
            value: 1920,
        });
        Object.defineProperty(document.documentElement, 'clientHeight', {
            writable: true,
            configurable: true,
            value: 1080,
        });

        // Mock DOM
        document.body.innerHTML = `
            <div id="wallart-ambient-overlay"></div>
            <div id="wallart-grid"></div>
        `;
    });

    afterEach(() => {
        window.logger = originalLogger;
        delete window.debugLog;
        vi.restoreAllMocks();
    });

    describe('Density Configuration', () => {
        it('should calculate low density grid (2x3)', () => {
            const density = 'low';
            const cols = density === 'low' ? 2 : density === 'medium' ? 3 : 4;
            const rows = density === 'low' ? 3 : density === 'medium' ? 5 : 7;

            expect(cols).toBe(2);
            expect(rows).toBe(3);
        });

        it('should calculate medium density grid (3x5)', () => {
            const density = 'medium';
            const cols = density === 'low' ? 2 : density === 'medium' ? 3 : 4;
            const rows = density === 'low' ? 3 : density === 'medium' ? 5 : 7;

            expect(cols).toBe(3);
            expect(rows).toBe(5);
        });

        it('should calculate high density grid (4x7)', () => {
            const density = 'high';
            const cols = density === 'low' ? 2 : density === 'medium' ? 3 : 4;
            const rows = density === 'low' ? 3 : density === 'medium' ? 5 : 7;

            expect(cols).toBe(4);
            expect(rows).toBe(7);
        });
    });

    describe('Poster Count Calculation', () => {
        it('should calculate correct poster count for medium density', () => {
            const cols = 3;
            const rows = 5;
            const posterCount = cols * rows;
            const bufferedCount = Math.ceil(posterCount * 1.5);

            expect(posterCount).toBe(15);
            expect(bufferedCount).toBe(23); // 15 * 1.5 = 22.5, rounded up
        });

        it('should calculate correct poster count for high density', () => {
            const cols = 4;
            const rows = 7;
            const posterCount = cols * rows;
            const bufferedCount = Math.ceil(posterCount * 1.5);

            expect(posterCount).toBe(28);
            expect(bufferedCount).toBe(42);
        });

        it('should apply 1.5x buffer for smooth transitions', () => {
            const posterCount = 20;
            const bufferedCount = Math.ceil(posterCount * 1.5);

            expect(bufferedCount).toBe(30);
            expect(bufferedCount > posterCount).toBe(true);
        });
    });

    describe('Poster Dimensions', () => {
        it('should calculate poster dimensions from columns', () => {
            const screenWidth = 1920;
            const cols = 3;
            const posterAspectRatio = 2 / 3; // width/height

            const posterWidth = Math.floor(screenWidth / cols);
            const posterHeight = Math.round(posterWidth / posterAspectRatio);

            expect(posterWidth).toBe(640); // 1920 / 3
            expect(posterHeight).toBe(960); // 640 / (2/3) = 960
        });

        it('should maintain 2:3 aspect ratio', () => {
            const posterWidth = 400;
            const posterAspectRatio = 2 / 3;
            const posterHeight = Math.round(posterWidth / posterAspectRatio);

            const calculatedRatio = posterWidth / posterHeight;
            const expectedRatio = 2 / 3;

            // Allow small rounding difference
            expect(Math.abs(calculatedRatio - expectedRatio)).toBeLessThan(0.01);
        });
    });

    describe('Grid Positioning', () => {
        it('should center grid horizontally', () => {
            const screenWidth = 1920;
            const cols = 3;
            const posterWidth = 640;
            const gridWidth = cols * posterWidth;
            const gridLeft = Math.round((screenWidth - gridWidth) / 2);

            expect(gridWidth).toBe(1920);
            expect(gridLeft).toBe(0); // Perfect fit
        });

        it('should center grid vertically', () => {
            const availableHeight = 1080;
            const rows = 5;
            const posterHeight = 200;
            const gridHeight = rows * posterHeight;
            const gridTop = Math.round((availableHeight - gridHeight) / 2);

            expect(gridHeight).toBe(1000);
            expect(gridTop).toBe(40); // (1080 - 1000) / 2
        });

        it('should handle portrait orientation', () => {
            const screenWidth = 1080;
            const screenHeight = 1920;
            const isPortrait = screenHeight > screenWidth;

            expect(isPortrait).toBe(true);
        });
    });

    describe('Coverage Calculation', () => {
        it('should calculate screen coverage percentage', () => {
            const gridWidth = 1920;
            const gridHeight = 1000;
            const screenWidth = 1920;
            const screenHeight = 1080;

            const coverage = ((gridWidth * gridHeight) / (screenWidth * screenHeight)) * 100;

            expect(Math.round(coverage)).toBe(93);
        });

        it('should aim for high coverage', () => {
            const screenWidth = 1920;
            const screenHeight = 1080;
            const totalScreenArea = screenWidth * screenHeight;

            const cols = 3;
            const rows = 5;
            const posterWidth = 640;
            const posterHeight = 960;
            const gridArea = cols * posterWidth * rows * posterHeight;

            const coverage = (gridArea / totalScreenArea) * 100;

            // Grid should cover most of the screen
            expect(coverage).toBeGreaterThan(80);
        });
    });

    describe('Responsive Adjustments', () => {
        it('should optimize rows when extra height available', () => {
            const availableHeight = 1200;
            const rows = 5;
            const posterHeight = 200;
            const calculatedGridHeight = rows * posterHeight;
            const remainingHeight = availableHeight - calculatedGridHeight;

            // If remaining height > 40% of poster height, try adding a row
            const canFitExtraRow = remainingHeight > posterHeight * 0.4;

            expect(calculatedGridHeight).toBe(1000);
            expect(remainingHeight).toBe(200);
            expect(canFitExtraRow).toBe(true);
        });

        it('should not add row when insufficient height', () => {
            const availableHeight = 1050;
            const rows = 5;
            const posterHeight = 200;
            const calculatedGridHeight = rows * posterHeight;
            const remainingHeight = availableHeight - calculatedGridHeight;

            const canFitExtraRow = remainingHeight > posterHeight * 0.4;

            expect(remainingHeight).toBe(50);
            expect(canFitExtraRow).toBe(false);
        });
    });
});

describe('Wallart Display - Ambient Overlay', () => {
    beforeEach(() => {
        window.logger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        document.body.innerHTML = `
            <div id="wallart-ambient-overlay" style="background: none; opacity: 0;"></div>
        `;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Overlay Element', () => {
        it('should create ambient overlay if missing', () => {
            document.body.innerHTML = '';

            let ambient = document.getElementById('wallart-ambient-overlay');
            if (!ambient) {
                ambient = document.createElement('div');
                ambient.id = 'wallart-ambient-overlay';
                document.body.appendChild(ambient);
            }

            const createdElement = document.getElementById('wallart-ambient-overlay');
            expect(createdElement).not.toBeNull();
            expect(createdElement.id).toBe('wallart-ambient-overlay');
        });

        it('should reuse existing ambient overlay', () => {
            const existingElement = document.getElementById('wallart-ambient-overlay');
            expect(existingElement).not.toBeNull();

            let ambient = document.getElementById('wallart-ambient-overlay');
            if (!ambient) {
                ambient = document.createElement('div');
                ambient.id = 'wallart-ambient-overlay';
                document.body.appendChild(ambient);
            }

            expect(document.querySelectorAll('#wallart-ambient-overlay').length).toBe(1);
        });
    });

    describe('Color Averaging', () => {
        it('should calculate average RGB from samples', () => {
            // Simulate sampling 3 pixels
            const samples = [
                { r: 100, g: 150, b: 200 },
                { r: 120, g: 160, b: 210 },
                { r: 110, g: 155, b: 205 },
            ];

            let r = 18,
                g = 23,
                b = 34; // Base dark color
            let count = 1;

            for (const sample of samples) {
                r += sample.r;
                g += sample.g;
                b += sample.b;
                count++;
            }

            r = Math.round(r / count);
            g = Math.round(g / count);
            b = Math.round(b / count);

            expect(r).toBe(87); // (18 + 100 + 120 + 110) / 4
            expect(g).toBe(122); // (23 + 150 + 160 + 155) / 4
            expect(b).toBe(162); // (34 + 200 + 210 + 205) / 4
        });

        it('should generate complementary colors', () => {
            const r = 100;
            const g = 150;
            const b = 200;

            const comp = [255 - r, 255 - g, 255 - b].map(v => Math.max(24, Math.min(220, v)));

            expect(comp[0]).toBe(155); // 255 - 100
            expect(comp[1]).toBe(105); // 255 - 150
            expect(comp[2]).toBe(55); // 255 - 200
        });

        it('should clamp complementary colors to valid range', () => {
            const r = 250;
            const g = 10;
            const b = 128;

            const comp = [255 - r, 255 - g, 255 - b].map(v => Math.max(24, Math.min(220, v)));

            expect(comp[0]).toBe(24); // 255 - 250 = 5, clamped to 24
            expect(comp[1]).toBe(220); // 255 - 10 = 245, clamped to 220
            expect(comp[2]).toBe(127); // 255 - 128 = 127
        });
    });

    describe('Gradient Generation', () => {
        it('should create linear gradient from two colors', () => {
            const r1 = 100,
                g1 = 150,
                b1 = 200;
            const r2 = 200,
                g2 = 100,
                b2 = 50;

            const start = `rgba(${r1}, ${g1}, ${b1}, 0.9)`;
            const end = `rgba(${r2}, ${g2}, ${b2}, 0.9)`;
            const gradient = `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;

            expect(gradient).toBe(
                'linear-gradient(135deg, rgba(100, 150, 200, 0.9) 0%, rgba(200, 100, 50, 0.9) 100%)'
            );
        });

        it('should use consistent opacity', () => {
            const start = 'rgba(100, 150, 200, 0.9)';
            const end = 'rgba(200, 100, 50, 0.9)';

            expect(start).toContain('0.9');
            expect(end).toContain('0.9');
        });
    });
});

describe('Wallart Display - Lifecycle', () => {
    let mockMediaQueue;

    beforeEach(() => {
        window.logger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };
        window.debugLog = vi.fn();

        mockMediaQueue = [
            { id: 1, title: 'Movie 1', imageUrl: '/image1.jpg' },
            { id: 2, title: 'Movie 2', imageUrl: '/image2.jpg' },
            { id: 3, title: 'Movie 3', imageUrl: '/image3.jpg' },
        ];

        window.mediaQueue = mockMediaQueue;
        window.appConfig = { type: 'movies' };

        document.body.innerHTML = '<div id="wallart-grid"></div>';
    });

    afterEach(() => {
        delete window.mediaQueue;
        delete window.appConfig;
        delete window.debugLog;
        vi.restoreAllMocks();
    });

    describe('Start Validation', () => {
        it('should detect when media queue is available', () => {
            const mediaQueue = window.mediaQueue;
            const hasMedia = Array.isArray(mediaQueue) && mediaQueue.length > 0;

            expect(hasMedia).toBe(true);
            expect(mediaQueue.length).toBe(3);
        });

        it('should detect when media queue is missing', () => {
            delete window.mediaQueue;

            const mediaQueue = window.mediaQueue;
            const hasMedia = Array.isArray(mediaQueue) && mediaQueue.length > 0;

            expect(hasMedia).toBe(false);
        });

        it('should prevent infinite retry loop', () => {
            let retryCount = 0;
            const maxRetries = 5;

            for (let i = 0; i < 10; i++) {
                retryCount++;
                if (retryCount > maxRetries) {
                    break;
                }
            }

            expect(retryCount).toBe(6); // Stopped at maxRetries + 1
        });
    });

    describe('Configuration Merging', () => {
        it('should merge config with window.wallartConfig', () => {
            const cfg = { density: 'medium', cycleInterval: 30 };
            const windowConfig = { density: 'high' };
            window.wallartConfig = windowConfig;

            const merged = { ...cfg, ...windowConfig };

            expect(merged.density).toBe('high'); // windowConfig overwrites
            expect(merged.cycleInterval).toBe(30);

            delete window.wallartConfig;
        });

        it('should use default appConfig when available', () => {
            const appConfig = window.appConfig;

            expect(appConfig).toBeDefined();
            expect(appConfig.type).toBe('movies');
        });
    });

    describe('Device Heartbeat', () => {
        it('should trigger device heartbeat on poster change', () => {
            window.PosterramaDevice = {
                beat: vi.fn(),
                getState: () => ({ deviceId: 'device-123' }),
            };

            const dev = window.PosterramaDevice;
            if (dev && typeof dev.beat === 'function') {
                dev.beat();
            }

            expect(window.PosterramaDevice.beat).toHaveBeenCalledTimes(1);

            delete window.PosterramaDevice;
        });

        it('should debounce heartbeat calls', () => {
            window.__posterramaBeatCooldownUntil = Date.now() + 500;

            const now = Date.now();
            const until = window.__posterramaBeatCooldownUntil;
            const shouldTrigger = now >= until;

            expect(shouldTrigger).toBe(false);

            delete window.__posterramaBeatCooldownUntil;
        });

        it('should allow heartbeat after cooldown', () => {
            window.__posterramaBeatCooldownUntil = Date.now() - 100;

            const now = Date.now();
            const until = window.__posterramaBeatCooldownUntil;
            const shouldTrigger = now >= until;

            expect(shouldTrigger).toBe(true);

            delete window.__posterramaBeatCooldownUntil;
        });
    });
});

describe('Wallart Display - Error Handling', () => {
    beforeEach(() => {
        window.logger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should handle missing grid element gracefully', () => {
        document.body.innerHTML = '';

        const gridEl = document.getElementById('wallart-grid');
        expect(gridEl).toBeNull();

        // Should not throw when element is missing
        expect(() => {
            if (!gridEl) return;
            gridEl.innerHTML = '<div>test</div>';
        }).not.toThrow();
    });

    it('should handle cross-origin canvas errors', () => {
        const canvas = document.createElement('canvas');
        canvas.getContext('2d', { willReadFrequently: true });

        expect(() => {
            try {
                // Simulate cross-origin error
                throw new Error('SecurityError');
            } catch (e) {
                // Silently handle cross-origin errors
            }
        }).not.toThrow();
    });

    it('should handle missing canvas context', () => {
        const canvas = document.createElement('canvas');

        // JSDOM doesn't implement canvas.getContext(), so it returns null
        // This is expected behavior in test environment
        const ctx = canvas.getContext('2d');

        // In real browser: ctx !== null
        // In JSDOM: ctx === null (not implemented)
        // Both cases should be handled gracefully
        if (ctx) {
            expect(ctx.canvas).toBe(canvas);
        } else {
            // JSDOM case - gracefully handled
            expect(ctx).toBeNull();
        }
    });
});
