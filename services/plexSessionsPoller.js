/**
 * Plex Sessions Polling Service
 * Polls Plex /status/sessions endpoint and caches results
 */

const logger = require('../utils/logger');
const EventEmitter = require('events');

class PlexSessionsPoller extends EventEmitter {
    constructor({ getPlexClient, config, pollInterval = 10000 }) {
        super();
        this.getPlexClient = getPlexClient;
        this.config = config;
        this.pollInterval = pollInterval;
        this.isRunning = false;
        this.pollTimer = null;
        this.lastSessions = [];
        this.lastUpdate = null;
        this.errorCount = 0;
        this.maxErrors = 5;
    }

    /**
     * Start polling Plex sessions
     */
    start() {
        if (this.isRunning) {
            logger.debug('Plex sessions poller already running');
            return;
        }

        logger.info('🎬 Starting Plex sessions poller', {
            interval: `${this.pollInterval}ms`,
        });

        this.isRunning = true;
        this.errorCount = 0;

        // Initial poll
        this.poll();
    }

    /**
     * Stop polling
     */
    stop() {
        if (!this.isRunning) return;

        logger.info('Stopping Plex sessions poller');
        this.isRunning = false;

        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Restart polling (e.g., after Plex server comes back online)
     */
    restart() {
        logger.info('Restarting Plex sessions poller');
        this.errorCount = 0;
        if (!this.isRunning) {
            this.start();
        }
    }

    /**
     * Poll Plex for active sessions
     */
    async poll() {
        if (!this.isRunning) return;

        try {
            // Find enabled Plex server
            const plexServer = (this.config.mediaServers || []).find(
                s => s.enabled && s.type === 'plex'
            );

            if (!plexServer) {
                // No Plex server configured, stop polling
                logger.debug('No Plex server configured, skipping sessions poll');
                this.scheduleNextPoll();
                return;
            }

            // Get Plex client
            const plex = await this.getPlexClient(plexServer);

            // Fetch sessions
            const response = await plex.query('/status/sessions');
            const sessions = response?.MediaContainer?.Metadata || [];

            // Process sessions into our format
            const processedSessions = sessions.map(session => ({
                // Media info
                ratingKey: session.ratingKey,
                key: session.key,
                guid: session.guid,
                type: session.type, // movie, episode
                title: session.title,
                grandparentTitle: session.grandparentTitle, // Show name
                parentTitle: session.parentTitle, // Season
                year: session.year,
                thumb: session.thumb,
                art: session.art,
                parentThumb: session.parentThumb,
                grandparentThumb: session.grandparentThumb,
                duration: session.duration || 0,

                // Playback info
                viewOffset: session.viewOffset || 0,
                progressPercent: session.duration
                    ? Math.round(((session.viewOffset || 0) / session.duration) * 100)
                    : 0,

                // Session info
                sessionKey: session.Session?.id || session.sessionKey,
                bandwidth: session.Session?.bandwidth,
                location: session.Session?.location,

                // User info
                userId: session.User?.id,
                username: session.User?.title || 'Unknown',
                userThumb: session.User?.thumb,

                // Player info
                playerState: session.Player?.state || 'unknown', // playing, paused, buffering
                playerTitle: session.Player?.title || 'Unknown Player',
                playerDevice: session.Player?.device,
                playerPlatform: session.Player?.platform,
                playerProduct: session.Player?.product,
                playerAddress: session.Player?.address,

                // Timestamps
                timestamp: Date.now(),
            }));

            // Check if sessions changed
            const sessionsChanged =
                JSON.stringify(this.lastSessions) !== JSON.stringify(processedSessions);

            if (sessionsChanged) {
                logger.debug('📊 Plex sessions updated', {
                    count: processedSessions.length,
                    users: [...new Set(processedSessions.map(s => s.username))],
                });

                this.lastSessions = processedSessions;
                this.lastUpdate = Date.now();

                // Emit sessions update event
                this.emit('sessions', processedSessions);
            }

            // Reset error count on success
            this.errorCount = 0;
        } catch (error) {
            this.errorCount++;

            if (this.errorCount <= this.maxErrors) {
                logger.error('Plex sessions poll failed', {
                    error: error.message,
                    attempt: this.errorCount,
                    maxErrors: this.maxErrors,
                });
            }

            if (this.errorCount === this.maxErrors) {
                logger.error('Plex sessions poller: max errors reached, stopping', {
                    totalErrors: this.errorCount,
                    interval: this.pollInterval,
                });
                this.stop();
                return;
            }
        }

        // Schedule next poll
        this.scheduleNextPoll();
    }

    /**
     * Schedule next poll
     */
    scheduleNextPoll() {
        if (!this.isRunning) return;

        this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
    }

    /**
     * Get cached sessions
     */
    getSessions() {
        return {
            sessions: this.lastSessions,
            lastUpdate: this.lastUpdate,
            isActive: this.isRunning,
        };
    }

    /**
     * Get sessions for specific user
     */
    getSessionsForUser(username) {
        if (!username) return this.lastSessions;

        return this.lastSessions.filter(s => s.username.toLowerCase() === username.toLowerCase());
    }

    /**
     * Get session by rating key
     */
    getSessionByRatingKey(ratingKey) {
        return this.lastSessions.find(s => s.ratingKey === ratingKey);
    }
}

module.exports = PlexSessionsPoller;
