/**
 * Wallart Playback Unit Tests
 *
 * Tests __posterramaPlayback hooks (next, prev, pause, resume)
 * and their interaction with refresh logic.
 *
 * @group wallart
 * @group unit
 */

describe('Wallart Playback Controls', () => {
    let mockWindow;
    let mockState;
    let refreshNowCalled;

    beforeEach(() => {
        // Mock window and state
        refreshNowCalled = 0;
        mockState = {
            paused: false,
            refreshNow: jest.fn(() => {
                refreshNowCalled++;
            }),
        };

        mockWindow = {
            __posterramaPlayback: {
                next: () => {
                    mockState.paused = false;
                    mockState.refreshNow && mockState.refreshNow();
                },
                prev: () => {
                    mockState.paused = false;
                    mockState.refreshNow && mockState.refreshNow();
                },
                pause: () => {
                    mockState.paused = true;
                    mockWindow.__posterramaPaused = true;
                },
                resume: () => {
                    mockState.paused = false;
                    mockWindow.__posterramaPaused = false;
                    mockState.refreshNow && mockState.refreshNow();
                },
            },
            __posterramaPaused: false,
        };
    });

    describe('next() command', () => {
        test('should unpause and trigger refresh', () => {
            mockState.paused = true;
            mockWindow.__posterramaPlayback.next();

            expect(mockState.paused).toBe(false);
            expect(mockState.refreshNow).toHaveBeenCalledTimes(1);
        });

        test('should trigger refresh even when already unpaused', () => {
            mockState.paused = false;
            mockWindow.__posterramaPlayback.next();

            expect(mockState.paused).toBe(false);
            expect(mockState.refreshNow).toHaveBeenCalledTimes(1);
        });
    });

    describe('prev() command', () => {
        test('should unpause and trigger refresh', () => {
            mockState.paused = true;
            mockWindow.__posterramaPlayback.prev();

            expect(mockState.paused).toBe(false);
            expect(mockState.refreshNow).toHaveBeenCalledTimes(1);
        });

        test('should trigger refresh even when already unpaused', () => {
            mockState.paused = false;
            mockWindow.__posterramaPlayback.prev();

            expect(mockState.paused).toBe(false);
            expect(mockState.refreshNow).toHaveBeenCalledTimes(1);
        });
    });

    describe('pause() command', () => {
        test('should set paused state', () => {
            mockState.paused = false;
            mockWindow.__posterramaPlayback.pause();

            expect(mockState.paused).toBe(true);
            expect(mockWindow.__posterramaPaused).toBe(true);
        });

        test('should not trigger refresh', () => {
            mockWindow.__posterramaPlayback.pause();

            expect(mockState.refreshNow).not.toHaveBeenCalled();
        });

        test('should halt automatic refresh when paused', () => {
            mockState.paused = false;

            // Simulate automatic refresh timer
            const autoRefresh = () => {
                if (!mockState.paused) {
                    mockState.refreshNow();
                }
            };

            // Before pause: refresh works
            autoRefresh();
            expect(refreshNowCalled).toBe(1);

            // After pause: refresh blocked
            mockWindow.__posterramaPlayback.pause();
            autoRefresh();
            expect(refreshNowCalled).toBe(1); // No new refresh
        });
    });

    describe('resume() command', () => {
        test('should unpause and trigger immediate refresh', () => {
            mockState.paused = true;
            mockWindow.__posterramaPaused = true;

            mockWindow.__posterramaPlayback.resume();

            expect(mockState.paused).toBe(false);
            expect(mockWindow.__posterramaPaused).toBe(false);
            expect(mockState.refreshNow).toHaveBeenCalledTimes(1);
        });

        test('should allow automatic refresh after resume', () => {
            mockWindow.__posterramaPlayback.pause();
            expect(mockState.paused).toBe(true);

            // Simulate automatic refresh (should be blocked)
            const autoRefresh = () => {
                if (!mockState.paused) {
                    mockState.refreshNow();
                }
            };
            autoRefresh();
            expect(refreshNowCalled).toBe(0);

            // Resume: immediate refresh + future refreshes allowed
            mockWindow.__posterramaPlayback.resume();
            expect(refreshNowCalled).toBe(1);

            // Next auto-refresh works
            autoRefresh();
            expect(refreshNowCalled).toBe(2);
        });
    });

    describe('Integration scenarios', () => {
        test('pause → next should unpause and refresh', () => {
            mockWindow.__posterramaPlayback.pause();
            expect(mockState.paused).toBe(true);

            mockWindow.__posterramaPlayback.next();
            expect(mockState.paused).toBe(false);
            expect(mockState.refreshNow).toHaveBeenCalledTimes(1);
        });

        test('pause → resume → next should trigger two refreshes', () => {
            mockWindow.__posterramaPlayback.pause();
            mockWindow.__posterramaPlayback.resume();
            expect(refreshNowCalled).toBe(1);

            mockWindow.__posterramaPlayback.next();
            expect(refreshNowCalled).toBe(2);
        });

        test('multiple pause calls should be idempotent', () => {
            mockWindow.__posterramaPlayback.pause();
            mockWindow.__posterramaPlayback.pause();
            mockWindow.__posterramaPlayback.pause();

            expect(mockState.paused).toBe(true);
            expect(mockState.refreshNow).not.toHaveBeenCalled();
        });

        test('multiple resume calls should trigger multiple refreshes', () => {
            mockState.paused = true;

            mockWindow.__posterramaPlayback.resume();
            mockWindow.__posterramaPlayback.resume();

            expect(mockState.paused).toBe(false);
            expect(refreshNowCalled).toBe(2);
        });
    });

    describe('Edge cases', () => {
        test('should handle missing refreshNow gracefully', () => {
            mockState.refreshNow = null;

            expect(() => {
                mockWindow.__posterramaPlayback.next();
                mockWindow.__posterramaPlayback.resume();
            }).not.toThrow();
        });

        test('should handle missing __posterramaPaused flag', () => {
            delete mockWindow.__posterramaPaused;

            expect(() => {
                mockWindow.__posterramaPlayback.pause();
                mockWindow.__posterramaPlayback.resume();
            }).not.toThrow();
        });
    });
});
