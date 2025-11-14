/**
 * Tests for PlexSessionsPoller service
 */

const PlexSessionsPoller = require('../../services/plexSessionsPoller');
const logger = require('../../utils/logger');

// Mock logger
jest.mock('../../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

describe('PlexSessionsPoller', () => {
    let poller;
    let mockGetPlexClient;
    let mockConfig;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockConfig = {
            mediaServers: [
                {
                    enabled: true,
                    type: 'plex',
                    name: 'Test Plex',
                },
            ],
        };

        mockGetPlexClient = jest.fn();
    });

    afterEach(() => {
        if (poller) {
            poller.stop();
        }
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        test('should initialize with default values', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            expect(poller.isRunning).toBe(false);
            expect(poller.errorCount).toBe(0);
            expect(poller.maxErrors).toBe(5);
            expect(poller.pollInterval).toBe(10000);
            expect(poller.lastSessions).toEqual([]);
            expect(poller.lastUpdate).toBeNull();
        });

        test('should accept custom poll interval', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
                pollInterval: 5000,
            });

            expect(poller.pollInterval).toBe(5000);
        });
    });

    describe('start()', () => {
        test('should start polling', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();

            expect(poller.isRunning).toBe(true);
            expect(poller.errorCount).toBe(0);
            expect(logger.info).toHaveBeenCalledWith('🎬 Starting Plex sessions poller', {
                interval: '10000ms',
            });
        });

        test('should not start if already running', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();
            logger.info.mockClear();
            poller.start();

            expect(logger.debug).toHaveBeenCalledWith('Plex sessions poller already running');
            expect(logger.info).not.toHaveBeenCalled();
        });
    });

    describe('stop()', () => {
        test('should stop polling', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();
            poller.stop();

            expect(poller.isRunning).toBe(false);
            expect(poller.pollTimer).toBeNull();
            expect(logger.info).toHaveBeenCalledWith('Stopping Plex sessions poller');
        });

        test('should clear timer on stop', async () => {
            const mockSessions = {
                MediaContainer: { Metadata: [] },
            };
            const mockPlexClient = {
                query: jest.fn().mockResolvedValue(mockSessions),
            };
            mockGetPlexClient.mockResolvedValue(mockPlexClient);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();

            // Let first poll complete (timer is set after poll)
            await jest.runOnlyPendingTimersAsync();
            expect(poller.pollTimer).not.toBeNull();

            poller.stop();
            expect(poller.pollTimer).toBeNull();
        });

        test('should not throw if called when not running', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            expect(() => poller.stop()).not.toThrow();
        });
    });

    describe('restart()', () => {
        test('should reset error count and start polling', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.errorCount = 3;
            poller.restart();

            expect(poller.errorCount).toBe(0);
            expect(poller.isRunning).toBe(true);
            expect(logger.info).toHaveBeenCalledWith('Restarting Plex sessions poller');
        });

        test('should not start if already running', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();
            poller.errorCount = 3;
            logger.info.mockClear();

            poller.restart();

            expect(poller.errorCount).toBe(0);
            expect(logger.info).toHaveBeenCalledWith('Restarting Plex sessions poller');
            // Should not call start again since already running
        });
    });

    describe('poll()', () => {
        test('should fetch and process sessions successfully', async () => {
            const mockSessions = {
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            year: 2024,
                            duration: 7200000,
                            viewOffset: 3600000,
                            Session: {
                                id: 'session1',
                                bandwidth: 4000,
                            },
                            User: {
                                id: 'user1',
                                title: 'TestUser',
                            },
                            Player: {
                                state: 'playing',
                                title: 'Chrome',
                                device: 'Chrome',
                            },
                        },
                    ],
                },
            };

            const mockPlexClient = {
                query: jest.fn().mockResolvedValue(mockSessions),
            };

            mockGetPlexClient.mockResolvedValue(mockPlexClient);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();
            await jest.runOnlyPendingTimersAsync();

            expect(mockGetPlexClient).toHaveBeenCalledWith(mockConfig.mediaServers[0]);
            expect(mockPlexClient.query).toHaveBeenCalledWith('/status/sessions');
            expect(poller.lastSessions).toHaveLength(1);
            expect(poller.lastSessions[0]).toMatchObject({
                ratingKey: '123',
                title: 'Test Movie',
                type: 'movie',
                username: 'TestUser',
                playerState: 'playing',
                progressPercent: 50,
            });
            expect(poller.errorCount).toBe(0);
        });

        test('should skip polling if no Plex server configured', async () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: { mediaServers: [] },
            });

            poller.start();
            await jest.runOnlyPendingTimersAsync();

            expect(mockGetPlexClient).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'No Plex server configured, skipping sessions poll'
            );
        });

        test('should emit sessions event when sessions change', async () => {
            const mockSessions = {
                MediaContainer: {
                    Metadata: [
                        {
                            ratingKey: '123',
                            title: 'Test Movie',
                            type: 'movie',
                            User: { id: 'user1', title: 'TestUser' },
                            Player: { state: 'playing' },
                            Session: {},
                        },
                    ],
                },
            };

            const mockPlexClient = {
                query: jest.fn().mockResolvedValue(mockSessions),
            };

            mockGetPlexClient.mockResolvedValue(mockPlexClient);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            const sessionsHandler = jest.fn();
            poller.on('sessions', sessionsHandler);

            poller.start();
            await jest.runOnlyPendingTimersAsync();

            expect(sessionsHandler).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        ratingKey: '123',
                        title: 'Test Movie',
                    }),
                ])
            );
        });

        test('should handle empty sessions gracefully', async () => {
            const mockSessions = {
                MediaContainer: {
                    Metadata: [],
                },
            };

            const mockPlexClient = {
                query: jest.fn().mockResolvedValue(mockSessions),
            };

            mockGetPlexClient.mockResolvedValue(mockPlexClient);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();
            await jest.runOnlyPendingTimersAsync();

            expect(mockPlexClient.query).toHaveBeenCalledWith('/status/sessions');
            expect(poller.lastSessions).toEqual([]);
            expect(poller.errorCount).toBe(0);
        });
    });

    describe('Error handling and maxErrors behavior', () => {
        test('should log error and continue on first failure', async () => {
            const mockError = new Error('Connection timeout');
            mockGetPlexClient.mockRejectedValue(mockError);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();
            await jest.runOnlyPendingTimersAsync();

            expect(poller.errorCount).toBeGreaterThanOrEqual(1);
            expect(logger.error).toHaveBeenCalledWith('Plex sessions poll failed', {
                error: 'Connection timeout',
                attempt: 1,
                maxErrors: 5,
            });

            // Should schedule next poll
            expect(poller.pollTimer).not.toBeNull();
        });

        test('should stop polling after reaching maxErrors', async () => {
            const mockError = new Error('Server offline');
            mockGetPlexClient.mockRejectedValue(mockError);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();

            // Simulate 5 failures
            for (let i = 0; i < 5; i++) {
                await jest.runOnlyPendingTimersAsync();
                if (i < 4) {
                    await jest.advanceTimersByTimeAsync(10000);
                }
            }

            expect(poller.errorCount).toBe(5);
            expect(logger.error).toHaveBeenCalledWith(
                'Plex sessions poller: max errors reached, stopping',
                {
                    totalErrors: 5,
                    interval: 10000,
                }
            );
            expect(poller.isRunning).toBe(false);
            expect(poller.pollTimer).toBeNull();
        });

        test('should NOT schedule next poll after maxErrors reached', async () => {
            const mockError = new Error('Server offline');
            mockGetPlexClient.mockRejectedValue(mockError);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();

            // Simulate 5 failures
            for (let i = 0; i < 5; i++) {
                await jest.runOnlyPendingTimersAsync();
                if (i < 4) {
                    await jest.advanceTimersByTimeAsync(10000);
                }
            }

            expect(poller.pollTimer).toBeNull();

            // Try to advance time - nothing should happen
            const callCountBefore = mockGetPlexClient.mock.calls.length;
            await jest.advanceTimersByTimeAsync(30000);
            expect(mockGetPlexClient.mock.calls.length).toBe(callCountBefore);
        });

        test('should reset error count on successful poll after errors', async () => {
            const mockSessions = {
                MediaContainer: { Metadata: [] },
            };
            const mockPlexClient = {
                query: jest.fn().mockResolvedValue(mockSessions),
            };

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            // Simulate errors manually
            poller.errorCount = 3;
            expect(poller.errorCount).toBe(3);

            // Now have a successful poll
            mockGetPlexClient.mockResolvedValue(mockPlexClient);
            poller.start();
            await jest.runOnlyPendingTimersAsync();

            // Error count should be reset to 0 after success
            expect(poller.errorCount).toBe(0);
        });
    });

    describe('getSessions()', () => {
        test('should return cached sessions with metadata', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.lastSessions = [{ ratingKey: '123', title: 'Test' }];
            poller.lastUpdate = 1234567890;
            poller.isRunning = true;

            const result = poller.getSessions();

            expect(result).toEqual({
                sessions: [{ ratingKey: '123', title: 'Test' }],
                lastUpdate: 1234567890,
                isActive: true,
            });
        });

        test('should return empty sessions when not started', () => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            const result = poller.getSessions();

            expect(result).toEqual({
                sessions: [],
                lastUpdate: null,
                isActive: false,
            });
        });
    });

    describe('getSessionsForUser()', () => {
        beforeEach(() => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.lastSessions = [
                { ratingKey: '1', username: 'Alice', title: 'Movie A' },
                { ratingKey: '2', username: 'Bob', title: 'Movie B' },
                { ratingKey: '3', username: 'Alice', title: 'Movie C' },
            ];
        });

        test('should filter sessions by username', () => {
            const sessions = poller.getSessionsForUser('Alice');

            expect(sessions).toHaveLength(2);
            expect(sessions[0].title).toBe('Movie A');
            expect(sessions[1].title).toBe('Movie C');
        });

        test('should be case-insensitive', () => {
            const sessions = poller.getSessionsForUser('alice');

            expect(sessions).toHaveLength(2);
        });

        test('should return all sessions if no username provided', () => {
            const sessions = poller.getSessionsForUser();

            expect(sessions).toHaveLength(3);
        });

        test('should return empty array if user not found', () => {
            const sessions = poller.getSessionsForUser('Charlie');

            expect(sessions).toHaveLength(0);
        });
    });

    describe('getSessionByRatingKey()', () => {
        beforeEach(() => {
            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.lastSessions = [
                { ratingKey: '123', title: 'Movie A' },
                { ratingKey: '456', title: 'Movie B' },
            ];
        });

        test('should find session by rating key', () => {
            const session = poller.getSessionByRatingKey('456');

            expect(session).toEqual({ ratingKey: '456', title: 'Movie B' });
        });

        test('should return undefined if not found', () => {
            const session = poller.getSessionByRatingKey('999');

            expect(session).toBeUndefined();
        });
    });

    describe('Memory leak prevention', () => {
        test('should not accumulate timers after stop', async () => {
            const mockSessions = {
                MediaContainer: { Metadata: [] },
            };
            const mockPlexClient = {
                query: jest.fn().mockResolvedValue(mockSessions),
            };
            mockGetPlexClient.mockResolvedValue(mockPlexClient);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();
            await jest.runOnlyPendingTimersAsync();

            // Should have timer scheduled
            expect(poller.pollTimer).not.toBeNull();

            poller.stop();

            // Timer should be cleared
            expect(poller.pollTimer).toBeNull();

            // Advance time - no new timer should be created
            await jest.advanceTimersByTimeAsync(30000);
            expect(poller.pollTimer).toBeNull();
        });

        test('should stop scheduling after maxErrors without memory leak', async () => {
            const mockError = new Error('Server offline');
            mockGetPlexClient.mockRejectedValue(mockError);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();

            // Hit maxErrors
            for (let i = 0; i < 5; i++) {
                await jest.runOnlyPendingTimersAsync();
                if (i < 4) {
                    await jest.advanceTimersByTimeAsync(10000);
                }
            }

            // Should be stopped with no timer
            expect(poller.isRunning).toBe(false);
            expect(poller.pollTimer).toBeNull();

            // Verify no timers leak by advancing time
            await jest.advanceTimersByTimeAsync(100000);
            const pendingTimersAfter = jest.getTimerCount();

            // No new timers should be created
            expect(pendingTimersAfter).toBe(0);
        });
    });

    describe('Integration: restart after maxErrors', () => {
        test('should successfully restart after hitting maxErrors', async () => {
            const mockError = new Error('Server offline');
            const mockSessions = {
                MediaContainer: { Metadata: [] },
            };
            const mockPlexClient = {
                query: jest.fn().mockResolvedValue(mockSessions),
            };

            // Fail 5 times, then succeed after restart
            mockGetPlexClient.mockRejectedValue(mockError);

            poller = new PlexSessionsPoller({
                getPlexClient: mockGetPlexClient,
                config: mockConfig,
            });

            poller.start();

            // Hit maxErrors
            for (let i = 0; i < 5; i++) {
                await jest.runOnlyPendingTimersAsync();
                if (i < 4) {
                    await jest.advanceTimersByTimeAsync(10000);
                }
            }

            expect(poller.isRunning).toBe(false);
            expect(poller.errorCount).toBe(5);

            // Server comes back online
            mockGetPlexClient.mockResolvedValue(mockPlexClient);

            // Restart
            poller.restart();

            expect(poller.isRunning).toBe(true);
            expect(poller.errorCount).toBe(0);

            // Should successfully poll
            await jest.runOnlyPendingTimersAsync();
            expect(mockPlexClient.query).toHaveBeenCalled();
        });
    });
});
