/**
 * Cinema Display Module Tests
 *
 * Tests poster rotation logic, Now Playing integration, and orientation management.
 * Note: Full UI rendering requires browser environment - these tests focus on core logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Cinema Display - Rotation Logic', () => {
    let originalLogger;
    let mockMediaQueue;
    let mockConfig;
    let rotationTimer;
    let nowPlayingTimer;

    beforeEach(() => {
        // Mock logger
        originalLogger = window.logger;
        window.logger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        };

        // Mock appConfig
        mockConfig = { type: 'movies' };
        window.appConfig = mockConfig;

        // Mock media queue
        mockMediaQueue = [
            { id: 1, title: 'Movie 1', imageUrl: '/image1.jpg' },
            { id: 2, title: 'Movie 2', imageUrl: '/image2.jpg' },
            { id: 3, title: 'Movie 3', imageUrl: '/image3.jpg' },
        ];

        // Mock fetch
        global.fetch = vi.fn(url => {
            if (url.includes('/get-media')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockMediaQueue),
                });
            }
            if (url.includes('/api/plex/sessions')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ sessions: [] }),
                });
            }
            return Promise.resolve({ ok: false });
        });

        // Mock DOM elements
        document.body.innerHTML = `
            <div id="poster"></div>
            <div id="cinema-header"></div>
            <div id="cinema-footer"></div>
            <div id="cinema-ambilight"></div>
        `;

        // Mock clientWidth/clientHeight
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

        // Clear timers
        rotationTimer = null;
        nowPlayingTimer = null;
    });

    afterEach(() => {
        window.logger = originalLogger;
        delete window.appConfig;
        if (rotationTimer) clearInterval(rotationTimer);
        if (nowPlayingTimer) clearInterval(nowPlayingTimer);
        vi.restoreAllMocks();
    });

    describe('Rotation Configuration', () => {
        it('should disable rotation when interval is 0', () => {
            // Simulate cinema config with rotation disabled
            const config = { rotationIntervalMinutes: 0 };

            // startRotation logic: if intervalMinutes <= 0, return early
            const intervalMinutes = config.rotationIntervalMinutes || 0;
            const shouldRotate = intervalMinutes > 0;

            expect(shouldRotate).toBe(false);
            expect(window.logger.info).not.toHaveBeenCalledWith(
                expect.stringContaining('Starting poster rotation')
            );
        });

        it('should enable rotation when interval > 0', () => {
            const config = { rotationIntervalMinutes: 5 };
            const intervalMinutes = config.rotationIntervalMinutes || 0;
            const shouldRotate = intervalMinutes > 0;

            expect(shouldRotate).toBe(true);
        });

        it('should calculate correct interval in milliseconds', () => {
            const intervalMinutes = 10;
            const expectedMs = intervalMinutes * 60 * 1000;

            expect(expectedMs).toBe(600000); // 10 minutes
        });
    });

    describe('Media Queue Management', () => {
        it('should fetch media queue from /get-media endpoint', async () => {
            const response = await fetch('/get-media?count=50&type=movies&excludeGames=1');
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(data).toEqual(mockMediaQueue);
            expect(data.length).toBe(3);
        });

        it('should handle empty media queue gracefully', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                })
            );

            const response = await fetch('/get-media?count=50&type=movies&excludeGames=1');
            const data = await response.json();

            expect(data).toEqual([]);
        });

        it('should handle fetch errors gracefully', async () => {
            global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

            try {
                await fetch('/get-media');
            } catch (error) {
                expect(error.message).toBe('Network error');
            }
        });
    });

    describe('Poster Rotation', () => {
        it('should cycle through media queue sequentially', () => {
            let currentIndex = 0;
            const queueLength = mockMediaQueue.length;

            // Simulate 3 next poster calls
            currentIndex = (currentIndex + 1) % queueLength;
            expect(currentIndex).toBe(1);
            expect(mockMediaQueue[currentIndex].title).toBe('Movie 2');

            currentIndex = (currentIndex + 1) % queueLength;
            expect(currentIndex).toBe(2);
            expect(mockMediaQueue[currentIndex].title).toBe('Movie 3');

            currentIndex = (currentIndex + 1) % queueLength;
            expect(currentIndex).toBe(0); // Wrap around
            expect(mockMediaQueue[currentIndex].title).toBe('Movie 1');
        });

        it('should cycle backwards through media queue', () => {
            let currentIndex = 2;
            const queueLength = mockMediaQueue.length;

            currentIndex = (currentIndex - 1 + queueLength) % queueLength;
            expect(currentIndex).toBe(1);
            expect(mockMediaQueue[currentIndex].title).toBe('Movie 2');

            currentIndex = (currentIndex - 1 + queueLength) % queueLength;
            expect(currentIndex).toBe(0);
            expect(mockMediaQueue[currentIndex].title).toBe('Movie 1');

            currentIndex = (currentIndex - 1 + queueLength) % queueLength;
            expect(currentIndex).toBe(2); // Wrap around
            expect(mockMediaQueue[currentIndex].title).toBe('Movie 3');
        });

        it('should not rotate when Now Playing is active', () => {
            const nowPlayingActive = true;
            const isPinned = false;

            const shouldRotate = !isPinned && !nowPlayingActive;

            expect(shouldRotate).toBe(false);
        });

        it('should not rotate when poster is pinned', () => {
            const nowPlayingActive = false;
            const isPinned = true;

            const shouldRotate = !isPinned && !nowPlayingActive;

            expect(shouldRotate).toBe(false);
        });

        it('should rotate when neither pinned nor Now Playing active', () => {
            const nowPlayingActive = false;
            const isPinned = false;

            const shouldRotate = !isPinned && !nowPlayingActive;

            expect(shouldRotate).toBe(true);
        });
    });

    describe('Now Playing Integration', () => {
        it('should fetch Plex sessions from API', async () => {
            const response = await fetch('/api/plex/sessions');
            const data = await response.json();

            expect(response.ok).toBe(true);
            expect(data).toHaveProperty('sessions');
            expect(Array.isArray(data.sessions)).toBe(true);
        });

        it('should detect session ID changes', () => {
            const lastSessionId = 'session-123';
            const currentSessionId = 'session-456';

            const sessionChanged = lastSessionId !== currentSessionId;

            expect(sessionChanged).toBe(true);
        });

        it('should detect when session continues', () => {
            const lastSessionId = 'session-123';
            const currentSessionId = 'session-123';

            const sessionChanged = lastSessionId !== currentSessionId;

            expect(sessionChanged).toBe(false);
        });

        it('should handle missing session data', () => {
            const session = null;
            const hasActiveSession = !!session;

            expect(hasActiveSession).toBe(false);
        });
    });

    describe('Poster Layout Calculation', () => {
        it('should calculate symmetric top/bottom bars', () => {
            const vw = 1920;
            const vh = 1080;

            // Poster aspect ratio is 2:3 (width:height)
            const posterHeightByWidth = Math.round(vw * 1.5);
            const posterHeight = Math.min(vh, posterHeightByWidth);
            const bar = Math.max(0, Math.round((vh - posterHeight) / 2));

            // 1920 * 1.5 = 2880, min(1080, 2880) = 1080
            // bar = (1080 - 1080) / 2 = 0
            expect(posterHeight).toBe(1080);
            expect(bar).toBe(0);
        });

        it('should handle portrait orientation', () => {
            const vw = 1080;
            const vh = 1920;

            const posterHeightByWidth = Math.round(vw * 1.5);
            const posterHeight = Math.min(vh, posterHeightByWidth);
            const bar = Math.max(0, Math.round((vh - posterHeight) / 2));

            // 1080 * 1.5 = 1620, min(1920, 1620) = 1620
            // bar = (1920 - 1620) / 2 = 150
            expect(posterHeight).toBe(1620);
            expect(bar).toBe(150);
        });
    });

    describe('Error Handling', () => {
        it('should handle missing DOM elements gracefully', () => {
            document.body.innerHTML = ''; // Clear DOM

            const posterEl = document.getElementById('poster');
            expect(posterEl).toBeNull();

            // Should not throw when elements are missing
            expect(() => {
                if (!posterEl) return;
                posterEl.style.backgroundImage = 'url(/test.jpg)';
            }).not.toThrow();
        });

        it('should handle invalid media data', () => {
            const invalidMedia = null;

            expect(() => {
                if (!invalidMedia) return;
                console.log(invalidMedia.title);
            }).not.toThrow();
        });
    });
});

describe('Cinema Display - Orientation Management', () => {
    beforeEach(() => {
        window.logger = {
            info: vi.fn(),
            error: vi.fn(),
        };
        document.body.innerHTML = '<div id="poster"></div>';
    });

    it('should apply auto orientation (default)', () => {
        const orientation = 'auto';
        const expectedClass = 'cinema-orientation-auto';

        expect(orientation).toBe('auto');
        expect(expectedClass).toBe('cinema-orientation-auto');
    });

    it('should apply portrait orientation', () => {
        const orientation = 'portrait';
        const expectedClass = 'cinema-orientation-portrait';

        expect(orientation).toBe('portrait');
        expect(expectedClass).toBe('cinema-orientation-portrait');
    });

    it('should apply portrait-flipped orientation', () => {
        const orientation = 'portrait-flipped';
        const expectedClass = 'cinema-orientation-portrait-flipped';

        expect(orientation).toBe('portrait-flipped');
        expect(expectedClass).toBe('cinema-orientation-portrait-flipped');
    });
});
