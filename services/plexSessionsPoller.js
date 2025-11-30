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
            const processedSessions = sessions.map(session => {
                // For episodes, extract season/episode numbers from various possible fields
                let seasonNum = session.parentIndex;
                const episodeNum = session.index;

                // If not available, try extracting from parentTitle (e.g., "Season 1")
                if (session.type === 'episode' && !seasonNum && session.parentTitle) {
                    const seasonMatch = session.parentTitle.match(/Season (\d+)/i);
                    if (seasonMatch) seasonNum = parseInt(seasonMatch[1], 10);
                }

                // Extract technical specs from Media array
                let resolution = null;
                let videoCodec = null;
                let audioCodec = null;
                let audioChannels = null;
                let aspectRatio = null;
                let hasHDR = false;
                let hasDolbyVision = false;

                if (session.Media && session.Media.length > 0) {
                    const media = session.Media[0];

                    // Resolution from media container
                    if (media.videoResolution) {
                        resolution = media.videoResolution.toUpperCase();
                        // Convert common resolutions
                        if (resolution === '1080') resolution = '1080p';
                        else if (resolution === '720') resolution = '720p';
                        else if (resolution === '4K' || resolution === '2160') resolution = '4K';
                    }

                    // Video codec
                    videoCodec = media.videoCodec || null;

                    // Audio codec and channels
                    audioCodec = media.audioCodec ? media.audioCodec.toUpperCase() : null;
                    if (audioCodec === 'EAC3') audioCodec = 'Dolby Digital+';
                    else if (audioCodec === 'AC3') audioCodec = 'Dolby Digital';
                    else if (audioCodec === 'TRUEHD') audioCodec = 'Dolby TrueHD';
                    else if (audioCodec === 'DTS-HD MA') audioCodec = 'DTS-HD MA';

                    if (media.audioChannels) {
                        const ch = media.audioChannels;
                        if (ch >= 8) audioChannels = '7.1';
                        else if (ch >= 6) audioChannels = '5.1';
                        else if (ch === 2) audioChannels = '2.0';
                        else audioChannels = `${ch}.0`;
                    }

                    // Aspect ratio
                    aspectRatio = media.aspectRatio || null;

                    // Check for HDR/Dolby Vision from video stream parts
                    if (media.Part && media.Part.length > 0) {
                        const part = media.Part[0];
                        if (part.Stream) {
                            for (const stream of part.Stream) {
                                if (stream.streamType === 1) {
                                    // Video stream
                                    // Check for Dolby Vision
                                    if (
                                        stream.DOVIPresent ||
                                        stream.DOVIBLPresent ||
                                        (stream.displayTitle &&
                                            stream.displayTitle
                                                .toLowerCase()
                                                .includes('dolby vision')) ||
                                        (stream.extendedDisplayTitle &&
                                            stream.extendedDisplayTitle
                                                .toLowerCase()
                                                .includes('dolby vision'))
                                    ) {
                                        hasDolbyVision = true;
                                    }
                                    // Check for HDR
                                    if (
                                        stream.colorSpace === 'bt2020nc' ||
                                        stream.colorTrc === 'smpte2084' ||
                                        stream.colorTrc === 'arib-std-b67' || // HLG
                                        (stream.displayTitle &&
                                            stream.displayTitle.toLowerCase().includes('hdr')) ||
                                        (stream.extendedDisplayTitle &&
                                            stream.extendedDisplayTitle
                                                .toLowerCase()
                                                .includes('hdr'))
                                    ) {
                                        hasHDR = true;
                                    }
                                    // Get aspect ratio from stream if not set
                                    if (!aspectRatio && stream.aspectRatio) {
                                        aspectRatio = stream.aspectRatio;
                                    }
                                }
                            }
                        }
                    }
                }

                return {
                    // Media info
                    ratingKey: session.ratingKey,
                    key: session.key,
                    guid: session.guid,
                    type: session.type, // movie, episode
                    title: session.title,
                    grandparentTitle: session.grandparentTitle, // Show name
                    parentTitle: session.parentTitle, // Season
                    parentIndex: seasonNum, // Season number (extracted)
                    index: episodeNum, // Episode number
                    year: session.year,
                    thumb: session.thumb,
                    art: session.art,
                    parentThumb: session.parentThumb,
                    grandparentThumb: session.grandparentThumb,
                    duration: session.duration || 0,
                    rating: session.rating,
                    contentRating: session.contentRating,
                    tagline: session.tagline,
                    summary: session.summary,
                    genres: session.Genre ? session.Genre.map(g => g.tag) : [],

                    // Technical specs
                    resolution,
                    videoCodec,
                    audioCodec,
                    audioChannels,
                    aspectRatio,
                    hasHDR,
                    hasDolbyVision,

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
                };
            });

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
