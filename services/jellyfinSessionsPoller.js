/**
 * Jellyfin Sessions Polling Service
 * Polls Jellyfin /Sessions endpoint and caches results
 */

const logger = require('../utils/logger');
const EventEmitter = require('events');

class JellyfinSessionsPoller extends EventEmitter {
    constructor({ getJellyfinClient, config, pollInterval = 10000 }) {
        super();
        this.getJellyfinClient = getJellyfinClient;
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
     * Start polling Jellyfin sessions
     */
    start() {
        if (this.isRunning) {
            logger.debug('Jellyfin sessions poller already running');
            return;
        }

        logger.info('🎬 Starting Jellyfin sessions poller', {
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

        logger.info('Stopping Jellyfin sessions poller');
        this.isRunning = false;

        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Restart polling
     */
    restart() {
        logger.info('Restarting Jellyfin sessions poller');
        this.errorCount = 0;
        if (!this.isRunning) {
            this.start();
        }
    }

    /**
     * Poll Jellyfin for active sessions
     */
    async poll() {
        if (!this.isRunning) return;

        try {
            // Find enabled Jellyfin server
            const jellyfinServer = (this.config.mediaServers || []).find(
                s => s.enabled && s.type === 'jellyfin'
            );

            if (!jellyfinServer) {
                // No Jellyfin server configured, stop polling
                logger.debug('No Jellyfin server configured, skipping sessions poll');
                this.scheduleNextPoll();
                return;
            }

            // Get Jellyfin client
            const jellyfin = await this.getJellyfinClient(jellyfinServer);

            // Fetch sessions - Jellyfin uses /Sessions endpoint
            const response = await jellyfin.http.get('/Sessions');
            const sessions = response?.data || [];

            // Filter to only sessions with NowPlayingItem (currently playing)
            const activeSessions = sessions.filter(session => session.NowPlayingItem);

            // Process sessions into a format similar to Plex for consistency
            const processedSessions = activeSessions.map(session =>
                this.processSession(session, jellyfinServer)
            );

            // Check for changes
            const hasChanges = this.detectChanges(processedSessions);

            this.lastSessions = processedSessions;
            this.lastUpdate = Date.now();
            this.errorCount = 0;

            if (hasChanges) {
                this.emit('sessions', processedSessions);
            }

            logger.debug('Jellyfin sessions polled', {
                count: processedSessions.length,
                hasChanges,
            });
        } catch (error) {
            this.errorCount++;
            logger.warn('Failed to poll Jellyfin sessions', {
                error: error.message,
                errorCount: this.errorCount,
            });

            if (this.errorCount >= this.maxErrors) {
                logger.error('Jellyfin sessions poller: too many errors, stopping');
                this.stop();
                return;
            }
        }

        this.scheduleNextPoll();
    }

    /**
     * Process a Jellyfin session into our standardized format
     */
    processSession(session, serverConfig) {
        const item = session.NowPlayingItem;
        const playState = session.PlayState || {};

        const itemId = item.Id;

        // Jellyfin uses different image endpoints
        const thumb = itemId ? `/Items/${itemId}/Images/Primary` : null;
        const art = itemId ? `/Items/${itemId}/Images/Backdrop` : null;

        // Calculate viewOffset in milliseconds (Jellyfin uses ticks, 10000 ticks = 1ms)
        const positionTicks = playState.PositionTicks || 0;
        const viewOffset = Math.floor(positionTicks / 10000);

        // Duration in milliseconds
        const durationTicks = item.RunTimeTicks || 0;
        const duration = Math.floor(durationTicks / 10000);

        return {
            // Session identifiers
            sessionKey: session.Id,
            ratingKey: item.Id,
            key: `/Items/${item.Id}`,

            // Media info
            type: this.mapMediaType(item.Type),
            title: item.Name || 'Unknown',
            year: item.ProductionYear,
            thumb,
            art,

            // For TV shows
            grandparentTitle: item.SeriesName || null,
            parentIndex: item.ParentIndexNumber, // Season number
            index: item.IndexNumber, // Episode number

            // Progress info
            viewOffset,
            duration,

            // State - map Jellyfin state to Plex-like format
            state: playState.IsPaused ? 'paused' : 'playing',

            // User info
            username: session.UserName,
            User: {
                id: session.UserId,
                title: session.UserName,
                thumb: session.UserId ? `/Users/${session.UserId}/Images/Primary` : null,
            },

            // Player info
            Player: {
                state: playState.IsPaused ? 'paused' : 'playing',
                device: session.DeviceName || session.Client,
                platform: session.Client,
                product: session.Client,
                title: session.DeviceName || session.Client,
            },

            // Keep original Jellyfin fields for compatibility
            PlayState: playState,
            IsPaused: playState.IsPaused || false,

            // Source identifier
            _source: 'jellyfin',
            _serverName: serverConfig.name || 'Jellyfin',
        };
    }

    /**
     * Map Jellyfin media type to Plex-like type
     */
    mapMediaType(jellyfinType) {
        const typeMap = {
            Movie: 'movie',
            Episode: 'episode',
            Series: 'show',
            Audio: 'track',
            MusicVideo: 'clip',
            Video: 'movie',
        };
        return typeMap[jellyfinType] || 'movie';
    }

    /**
     * Detect if sessions have changed
     */
    detectChanges(newSessions) {
        if (newSessions.length !== this.lastSessions.length) return true;

        for (let i = 0; i < newSessions.length; i++) {
            const newSession = newSessions[i];
            const oldSession = this.lastSessions.find(s => s.sessionKey === newSession.sessionKey);

            if (!oldSession) return true;

            // Check for significant changes
            if (
                oldSession.ratingKey !== newSession.ratingKey ||
                oldSession.state !== newSession.state ||
                Math.abs((oldSession.viewOffset || 0) - (newSession.viewOffset || 0)) > 5000
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * Schedule next poll
     */
    scheduleNextPoll() {
        if (!this.isRunning) return;

        this.pollTimer = setTimeout(() => {
            this.poll();
        }, this.pollInterval);
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
     * Force immediate poll
     */
    async forcePoll() {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        await this.poll();
    }
}

module.exports = JellyfinSessionsPoller;
