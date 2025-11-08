const PlexSource = require('../../sources/plex');

describe('PlexSource - Music Support', () => {
    let mockPlexClient;
    let mockGetPlexClient;
    let mockProcessPlexItem;
    let mockGetPlexLibraries;
    let mockShuffleArray;
    let plexSource;

    const serverConfig = {
        name: 'Test Plex',
        hostname: 'localhost',
        port: 32400,
        tokenEnvVar: 'PLEX_TOKEN',
        musicLibraryNames: ['Music'],
        musicFilters: {
            genres: [],
            artists: [],
            minRating: 0,
            sortWeights: {
                recent: 20,
                popular: 30,
                random: 50,
            },
        },
    };

    beforeEach(() => {
        mockPlexClient = {
            query: jest.fn(),
        };

        mockGetPlexClient = jest.fn().mockResolvedValue(mockPlexClient);
        mockProcessPlexItem = jest.fn().mockImplementation(item => Promise.resolve(item));
        mockGetPlexLibraries = jest.fn().mockResolvedValue(
            new Map([
                ['Music', { key: '1', title: 'Music' }],
                ['Classical', { key: '2', title: 'Classical' }],
            ])
        );
        mockShuffleArray = jest.fn().mockImplementation(arr => arr);

        plexSource = new PlexSource(
            serverConfig,
            mockGetPlexClient,
            mockProcessPlexItem,
            mockGetPlexLibraries,
            mockShuffleArray,
            0,
            false
        );
    });

    describe('fetchMusic', () => {
        test('fetches albums from music library', async () => {
            const mockAlbums = [
                {
                    key: '/library/metadata/1',
                    ratingKey: '1',
                    title: 'Dark Side of the Moon',
                    parentTitle: 'Pink Floyd',
                    year: 1973,
                    rating: 9.5,
                    thumb: '/library/metadata/1/thumb',
                    Genre: [{ tag: 'Progressive Rock' }, { tag: 'Psychedelic Rock' }],
                    addedAt: Date.now() / 1000,
                },
                {
                    key: '/library/metadata/2',
                    ratingKey: '2',
                    title: 'Abbey Road',
                    parentTitle: 'The Beatles',
                    year: 1969,
                    rating: 9.8,
                    thumb: '/library/metadata/2/thumb',
                    Genre: [{ tag: 'Rock' }],
                    addedAt: Date.now() / 1000,
                },
            ];

            mockPlexClient.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: mockAlbums,
                },
            });

            const result = await plexSource.fetchMusic(['Music'], 10);

            expect(mockPlexClient.query).toHaveBeenCalledWith('/library/sections/1/all?type=9');
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                type: 'music',
                title: 'Dark Side of the Moon',
                artist: 'Pink Floyd',
                year: 1973,
                genres: ['Progressive Rock', 'Psychedelic Rock'],
            });
        });

        test('returns empty array for empty library names', async () => {
            const result = await plexSource.fetchMusic([], 10);
            expect(result).toEqual([]);
            expect(mockPlexClient.query).not.toHaveBeenCalled();
        });

        test('returns empty array for count = 0', async () => {
            const result = await plexSource.fetchMusic(['Music'], 0);
            expect(result).toEqual([]);
            expect(mockPlexClient.query).not.toHaveBeenCalled();
        });

        test('handles library not found', async () => {
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: { Metadata: [] },
            });

            const result = await plexSource.fetchMusic(['NonExistent'], 10);
            expect(result).toEqual([]);
        });

        test('handles API errors gracefully', async () => {
            mockGetPlexLibraries.mockRejectedValue(new Error('Network error'));

            const result = await plexSource.fetchMusic(['Music'], 10);
            expect(result).toEqual([]);
            expect(plexSource.metrics.errorCount).toBe(1);
        });

        test('limits results to requested count', async () => {
            const mockAlbums = Array.from({ length: 20 }, (_, i) => ({
                key: `/library/metadata/${i}`,
                ratingKey: `${i}`,
                title: `Album ${i}`,
                parentTitle: `Artist ${i}`,
                thumb: `/thumb/${i}`,
                addedAt: Date.now() / 1000,
            }));

            mockPlexClient.query.mockResolvedValue({
                MediaContainer: { Metadata: mockAlbums },
            });

            const result = await plexSource.fetchMusic(['Music'], 5);
            expect(result).toHaveLength(5);
        });
    });

    describe('applyMusicFiltering', () => {
        const mockAlbums = [
            {
                title: 'Album 1',
                parentTitle: 'Pink Floyd',
                rating: 9.0,
                Genre: [{ tag: 'Rock' }, { tag: 'Progressive Rock' }],
            },
            {
                title: 'Album 2',
                parentTitle: 'Miles Davis',
                rating: 8.5,
                Genre: [{ tag: 'Jazz' }],
            },
            {
                title: 'Album 3',
                parentTitle: 'The Beatles',
                rating: 6.0,
                Genre: [{ tag: 'Rock' }],
            },
        ];

        test('filters by genre', () => {
            const result = plexSource.applyMusicFiltering(mockAlbums, {
                genres: ['Jazz'],
            });
            expect(result).toHaveLength(1);
            expect(result[0].parentTitle).toBe('Miles Davis');
        });

        test('filters by artist', () => {
            const result = plexSource.applyMusicFiltering(mockAlbums, {
                artists: ['Pink Floyd', 'The Beatles'],
            });
            expect(result).toHaveLength(2);
        });

        test('filters by minimum rating', () => {
            const result = plexSource.applyMusicFiltering(mockAlbums, {
                minRating: 8.0,
            });
            expect(result).toHaveLength(2);
            expect(result.every(album => album.rating >= 8.0)).toBe(true);
        });

        test('applies multiple filters', () => {
            const result = plexSource.applyMusicFiltering(mockAlbums, {
                genres: ['Rock'],
                minRating: 8.0,
            });
            expect(result).toHaveLength(1);
            expect(result[0].parentTitle).toBe('Pink Floyd');
        });

        test('returns all albums when no filters', () => {
            const result = plexSource.applyMusicFiltering(mockAlbums, {});
            expect(result).toHaveLength(3);
        });
    });

    describe('applySortWeights', () => {
        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        const mockAlbums = [
            // Recent albums (added < 30 days ago)
            { title: 'Recent 1', addedAt: now / 1000, rating: 5.0 },
            { title: 'Recent 2', addedAt: now / 1000, rating: 6.0 },
            // Popular albums (rating >= 7.0)
            { title: 'Popular 1', addedAt: thirtyDaysAgo / 1000 - 1, rating: 9.0 },
            { title: 'Popular 2', addedAt: thirtyDaysAgo / 1000 - 1, rating: 8.0 },
            // Random albums (older, lower rating)
            { title: 'Random 1', addedAt: thirtyDaysAgo / 1000 - 1, rating: 5.0 },
            { title: 'Random 2', addedAt: thirtyDaysAgo / 1000 - 1, rating: 6.0 },
        ];

        test('applies default weights (20/30/50)', () => {
            const result = plexSource.applySortWeights(mockAlbums);
            expect(result).toHaveLength(6);
            // With default weights on 6 items: recent=1, popular=2, random=3
        });

        test('applies custom weights', () => {
            const result = plexSource.applySortWeights(mockAlbums, {
                recent: 50,
                popular: 30,
                random: 20,
            });
            expect(result).toHaveLength(6);
        });

        test('handles empty album list', () => {
            const result = plexSource.applySortWeights([]);
            expect(result).toEqual([]);
        });

        test('fills remaining slots when categories are small', () => {
            const smallList = [mockAlbums[0], mockAlbums[2]]; // 1 recent, 1 popular
            const result = plexSource.applySortWeights(smallList);
            expect(result).toHaveLength(2);
        });
    });

    describe('processMusicAlbum', () => {
        test('processes album with all metadata', async () => {
            const mockAlbum = {
                key: '/library/metadata/123',
                ratingKey: '123',
                title: 'The Wall',
                parentTitle: 'Pink Floyd',
                parentRatingKey: '456',
                year: 1979,
                rating: 9.2,
                thumb: '/library/metadata/123/thumb',
                parentThumb: '/library/metadata/456/thumb',
                Genre: [{ tag: 'Rock' }, { tag: 'Progressive Rock' }],
                Style: [{ tag: 'Art Rock' }],
                Mood: [{ tag: 'Dark' }, { tag: 'Atmospheric' }],
                studio: 'Harvest Records',
                addedAt: 1234567890,
                viewCount: 42,
                librarySectionTitle: 'Music',
                librarySectionID: '1',
            };

            const result = await plexSource.processMusicAlbum(mockAlbum, serverConfig);

            expect(result).toMatchObject({
                key: '/library/metadata/123',
                title: 'The Wall',
                type: 'music',
                year: 1979,
                rating: 9.2,
                source: 'Test Plex',
                artist: 'Pink Floyd',
                artistId: '456',
                album: 'The Wall',
                albumId: '123',
                genres: ['Rock', 'Progressive Rock'],
                styles: ['Art Rock'],
                moods: ['Dark', 'Atmospheric'],
                studio: 'Harvest Records',
                addedAt: 1234567890,
                viewCount: 42,
            });
            expect(result.posterUrl).toContain('localhost:32400');
            expect(result.posterUrl).toContain('/library/metadata/123/thumb');
            expect(result.backdropUrl).toContain('/library/metadata/456/thumb');
        });

        test('handles missing optional fields', async () => {
            const mockAlbum = {
                title: 'Unknown Album',
                ratingKey: '999',
            };

            const result = await plexSource.processMusicAlbum(mockAlbum, serverConfig);

            expect(result).toMatchObject({
                title: 'Unknown Album',
                type: 'music',
                artist: 'Unknown Artist',
                genres: [],
                styles: [],
                moods: [],
            });
            expect(result.posterUrl).toBeNull();
            expect(result.year).toBeNull();
        });

        test('builds correct URLs with HTTPS', async () => {
            const httpsConfig = { ...serverConfig, port: 443 };
            const mockAlbum = {
                title: 'Test Album',
                thumb: '/thumb/test',
                ratingKey: '1',
            };

            const result = await plexSource.processMusicAlbum(mockAlbum, httpsConfig);

            expect(result.posterUrl).toContain('https://localhost:443');
        });
    });

    describe('metrics tracking', () => {
        test('updates metrics on successful fetch', async () => {
            mockPlexClient.query.mockResolvedValue({
                MediaContainer: {
                    Metadata: [
                        {
                            title: 'Test Album',
                            parentTitle: 'Test Artist',
                            ratingKey: '1',
                            thumb: '/thumb/1',
                            addedAt: Date.now() / 1000,
                        },
                    ],
                },
            });

            const initialRequestCount = plexSource.metrics.requestCount;
            const initialProcessed = plexSource.metrics.itemsProcessed;

            await plexSource.fetchMusic(['Music'], 1);

            expect(plexSource.metrics.requestCount).toBe(initialRequestCount + 1);
            expect(plexSource.metrics.itemsProcessed).toBeGreaterThan(initialProcessed);
            expect(plexSource.metrics.lastRequestTime).toBeGreaterThanOrEqual(0);
        });

        test('tracks error count on failures', async () => {
            mockGetPlexLibraries.mockRejectedValue(new Error('Connection failed'));

            const initialErrors = plexSource.metrics.errorCount;

            await plexSource.fetchMusic(['Music'], 1);

            expect(plexSource.metrics.errorCount).toBe(initialErrors + 1);
        });
    });
});
