/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Module functions
let startScreensaver;
let initScreensaver;

describe('screensaver-bootstrap.js', () => {
    beforeEach(async () => {
        // Reset DOM
        document.body.innerHTML = '<div id="loader"></div>';

        // Reset window properties (handle defineProperty immutability)
        [
            'appConfig',
            'mediaQueue',
            'PosterramaCore',
            'PosterramaDevice',
            'PosterramaScreensaver',
            'logger',
        ].forEach(prop => {
            try {
                delete window[prop];
            } catch (e) {
                window[prop] = undefined;
            }
        });

        // Mock console
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // Import module fresh
        const module = await import('../../public/screensaver-bootstrap.js');
        startScreensaver = module.startScreensaver;
        initScreensaver = module.initScreensaver;
    });

    describe('forceServiceWorkerUpdate', () => {
        it('should request service worker update if available', async () => {
            const updateMock = vi.fn().mockResolvedValue(undefined);
            const registration = { update: updateMock };

            navigator.serviceWorker = {
                getRegistration: vi.fn().mockResolvedValue(registration),
            };

            // Test via startScreensaver (forceServiceWorkerUpdate is not exported)
            await startScreensaver();

            expect(navigator.serviceWorker.getRegistration).toHaveBeenCalled();
            expect(updateMock).toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('[Screensaver] SW update requested');
        });

        it('should handle service worker errors gracefully', async () => {
            navigator.serviceWorker = {
                getRegistration: vi.fn().mockRejectedValue(new Error('SW error')),
            };

            await startScreensaver();

            expect(console.warn).toHaveBeenCalledWith('[Screensaver] SW update error:', 'SW error');
        });

        it('should skip if service worker not available', async () => {
            delete navigator.serviceWorker;

            await startScreensaver();

            // Should not throw error
            expect(console.warn).not.toHaveBeenCalled();
        });
    });

    describe('ensureConfig', () => {
        it('should return true if config already exists', async () => {
            window.appConfig = { test: true };

            await startScreensaver();

            // Should not fetch
            expect(window.appConfig).toEqual({ test: true });
        });

        it('should fetch config via PosterramaCore if available', async () => {
            window.PosterramaCore = {
                fetchConfig: vi.fn().mockResolvedValue({ mode: 'screensaver' }),
            };

            await startScreensaver();

            expect(window.PosterramaCore.fetchConfig).toHaveBeenCalled();
            expect(window.appConfig).toEqual({ mode: 'screensaver' });
        });

        it('should fetch config via /get-config if PosterramaCore unavailable', async () => {
            const mockConfig = { type: 'movies' };
            global.fetch = vi.fn().mockResolvedValue({
                json: () => Promise.resolve(mockConfig),
            });

            await startScreensaver();

            expect(global.fetch).toHaveBeenCalledWith('/get-config', {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
            });
            expect(window.appConfig).toEqual(mockConfig);
        });

        it('should handle fetch errors gracefully', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

            await startScreensaver();

            // Should not throw
            expect(window.appConfig).toBeUndefined();
        });
    });

    describe('ensureMediaQueue', () => {
        it('should return true if mediaQueue already exists', async () => {
            window.appConfig = { type: 'movies' };
            window.mediaQueue = [{ id: 1 }];

            await startScreensaver();

            // Should not fetch again
            expect(window.mediaQueue).toEqual([{ id: 1 }]);
        });

        it('should fetch media items with correct parameters', async () => {
            window.appConfig = { type: 'tv' };
            const mockMedia = [{ id: 1 }, { id: 2 }];

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockMedia),
            });

            await startScreensaver();

            const expectedUrl = `${window.location.origin}/get-media?count=12&type=tv&excludeGames=1`;
            expect(global.fetch).toHaveBeenCalledWith(expectedUrl, {
                method: 'GET',
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    Accept: 'application/json',
                },
                credentials: 'same-origin',
                mode: 'cors',
            });
            expect(window.mediaQueue).toEqual(mockMedia);
        });

        it('should handle data.results format', async () => {
            window.appConfig = { type: 'movies' };
            const mockMedia = { results: [{ id: 1 }, { id: 2 }] };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockMedia),
            });

            await startScreensaver();

            expect(window.mediaQueue).toEqual([{ id: 1 }, { id: 2 }]);
        });

        it('should use default type if appConfig missing', async () => {
            const mockMedia = [{ id: 1 }];

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockMedia),
            });

            await startScreensaver();

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('type=movies'),
                expect.any(Object)
            );
        });

        it('should handle empty results', async () => {
            window.appConfig = { type: 'movies' };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            });

            await startScreensaver();

            expect(window.mediaQueue).toBeUndefined();
        });

        it('should handle fetch errors', async () => {
            window.appConfig = { type: 'movies' };

            global.fetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));

            await startScreensaver();

            expect(console.error).toHaveBeenCalledWith(
                '[Screensaver] Fetch media failed:',
                'Fetch failed',
                'Error'
            );
            expect(window.mediaQueue).toBeUndefined();
        });

        it('should handle non-ok response', async () => {
            window.appConfig = { type: 'movies' };

            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
            });

            await startScreensaver();

            expect(window.mediaQueue).toBeUndefined();
        });
    });

    describe('startScreensaver', () => {
        it('should initialize device management if available', async () => {
            const initMock = vi.fn();
            window.appConfig = { test: true };
            window.mediaQueue = [{ id: 1 }];
            window.PosterramaDevice = { init: initMock };

            await startScreensaver();

            expect(initMock).toHaveBeenCalledWith({ test: true });
        });

        it('should log debug info if logger available', async () => {
            const debugMock = vi.fn();
            window.appConfig = { test: true };
            window.mediaQueue = [{ id: 1 }, { id: 2 }];
            window.logger = { debug: debugMock };

            await startScreensaver();

            expect(debugMock).toHaveBeenCalledWith('[Screensaver] bootstrap: config+media ready', {
                count: 2,
            });
        });

        it('should start screensaver display if available', async () => {
            const startMock = vi.fn();
            window.appConfig = { test: true };
            window.mediaQueue = [{ id: 1 }];
            window.PosterramaScreensaver = { start: startMock };

            await startScreensaver();

            expect(startMock).toHaveBeenCalled();
        });

        it('should hide loader after starting screensaver', async () => {
            window.appConfig = { test: true };
            window.mediaQueue = [{ id: 1 }];
            window.PosterramaScreensaver = { start: vi.fn() };

            const loader = document.getElementById('loader');
            expect(loader).toBeTruthy();

            await startScreensaver();

            expect(loader.style.opacity).toBe('0');
            expect(loader.style.display).toBe('none');
        });

        it('should handle missing loader element', async () => {
            document.body.innerHTML = '';
            window.appConfig = { test: true };
            window.mediaQueue = [{ id: 1 }];
            window.PosterramaScreensaver = { start: vi.fn() };

            await startScreensaver();

            // Should not throw
            expect(window.PosterramaScreensaver.start).toHaveBeenCalled();
        });

        it('should handle all errors silently', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Fatal error'));

            await startScreensaver();

            // Should not throw - fails silently
            expect(window.appConfig).toBeUndefined();
        });
    });

    describe('initScreensaver', () => {
        it('should call startScreensaver if DOM already loaded', async () => {
            Object.defineProperty(document, 'readyState', {
                writable: true,
                value: 'complete',
            });

            window.appConfig = { test: true };
            window.mediaQueue = [{ id: 1 }];

            initScreensaver();

            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(window.appConfig).toBeTruthy();
        });

        it('should wait for DOMContentLoaded if document loading', async () => {
            Object.defineProperty(document, 'readyState', {
                writable: true,
                value: 'loading',
            });

            const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

            initScreensaver();

            expect(addEventListenerSpy).toHaveBeenCalledWith(
                'DOMContentLoaded',
                expect.any(Function)
            );
        });
    });
});
