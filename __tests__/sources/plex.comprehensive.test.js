// Formerly plex-source.test.js (renamed to plex.comprehensive.test.js)
const PlexSource = require('../../sources/plex');

describe('Plex Source', () => {
    let plexSource;
    let mockServerConfig;
    let mockGetPlexClient;
    let mockProcessPlexItem;
    let mockGetPlexLibraries;
    let mockShuffleArray;
    let mockPlexClient;

    beforeEach(() => {
        mockServerConfig = { name: 'Test Plex Server', host: 'test.local', port: 32400, token: 'test-token' };
        mockPlexClient = { query: jest.fn() };
        mockGetPlexClient = jest.fn().mockReturnValue(mockPlexClient);
        mockProcessPlexItem = jest.fn().mockImplementation(item => ({ ...item, processed: true }));
        mockGetPlexLibraries = jest.fn();
        mockShuffleArray = jest.fn().mockImplementation(array => [...array].reverse());
        plexSource = new PlexSource( mockServerConfig, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 0, false );
    });

    afterEach(() => { jest.clearAllMocks(); });

    describe('Constructor', () => {
        it('should initialize with provided configuration', () => {
            expect(plexSource.server).toBe(mockServerConfig);
            expect(plexSource.getPlexClient).toBe(mockGetPlexClient);
            expect(plexSource.processPlexItem).toBe(mockProcessPlexItem);
            expect(plexSource.getPlexLibraries).toBe(mockGetPlexLibraries);
            expect(plexSource.shuffleArray).toBe(mockShuffleArray);
            expect(plexSource.rtMinScore).toBe(0);
            expect(plexSource.isDebug).toBe(false);
            expect(mockGetPlexClient).toHaveBeenCalledWith(mockServerConfig);
        });
    });

    describe('fetchMedia', () => {
        it('should return empty array when no library names provided', async () => { const result = await plexSource.fetchMedia([], 'movie', 10); expect(result).toEqual([]); });
        it('should return empty array when count is 0', async () => { const result = await plexSource.fetchMedia(['Movies'], 'movie', 0); expect(result).toEqual([]); });
        it('should return empty array when library names is null', async () => { const result = await plexSource.fetchMedia(null, 'movie', 10); expect(result).toEqual([]); });
        it('should fetch media from valid libraries', async () => { const mockLibraries = new Map([ ['Movies', { key: '1', title: 'Movies' }], ['TV Shows', { key: '2', title: 'TV Shows' }] ]); const mockMediaItems = [ { ratingKey: '1', title: 'Movie 1', type: 'movie' }, { ratingKey: '2', title: 'Movie 2', type: 'movie' }, { ratingKey: '3', title: 'Movie 3', type: 'movie' } ]; mockGetPlexLibraries.mockResolvedValue(mockLibraries); mockPlexClient.query.mockResolvedValue({ MediaContainer: { Metadata: mockMediaItems } }); const result = await plexSource.fetchMedia(['Movies'], 'movie', 2); expect(mockGetPlexLibraries).toHaveBeenCalledWith(mockServerConfig); expect(mockPlexClient.query).toHaveBeenCalledWith('/library/sections/1/all'); expect(mockShuffleArray).toHaveBeenCalledWith(mockMediaItems); expect(mockProcessPlexItem).toHaveBeenCalledTimes(2); expect(result).toHaveLength(2); });
        it('should warn when library is not found', async () => { const mockLibraries = new Map([ ['Movies', { key: '1', title: 'Movies' }] ]); mockGetPlexLibraries.mockResolvedValue(mockLibraries); const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(); const result = await plexSource.fetchMedia(['NonExistent'], 'movie', 10); expect(consoleWarnSpy).toHaveBeenCalledWith('[PlexSource:Test Plex Server] Library "NonExistent" not found.'); expect(result).toEqual([]); consoleWarnSpy.mockRestore(); });
        it('should handle libraries with no content', async () => { const mockLibraries = new Map([ ['Empty', { key: '1', title: 'Empty' }] ]); mockGetPlexLibraries.mockResolvedValue(mockLibraries); mockPlexClient.query.mockResolvedValue({ MediaContainer: {} }); const result = await plexSource.fetchMedia(['Empty'], 'movie', 10); expect(result).toEqual([]); });
        it('should handle errors gracefully', async () => { mockGetPlexLibraries.mockRejectedValue(new Error('Network error')); const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(); const result = await plexSource.fetchMedia(['Movies'], 'movie', 10); expect(consoleErrorSpy).toHaveBeenCalledWith('[PlexSource:Test Plex Server] Error fetching media: Network error'); expect(result).toEqual([]); consoleErrorSpy.mockRestore(); });
        it('should respect rtMinScore filtering', async () => { const plexSourceWithRating = new PlexSource( mockServerConfig, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 7.0, false ); const mockLibraries = new Map([ ['Movies', { key: '1', title: 'Movies' }] ]); const mockMediaItems = [ { ratingKey: '1', title: 'Good Movie', rating: 8.5 }, { ratingKey: '2', title: 'Bad Movie', rating: 5.0 }, { ratingKey: '3', title: 'Great Movie', rating: 9.0 } ]; mockGetPlexLibraries.mockResolvedValue(mockLibraries); mockPlexClient.query.mockResolvedValue({ MediaContainer: { Metadata: mockMediaItems } }); mockProcessPlexItem.mockClear(); mockProcessPlexItem.mockResolvedValueOnce({ title: 'Good Movie', rottenTomatoes: { originalScore: 0.85 } }).mockResolvedValueOnce({ title: 'Bad Movie', rottenTomatoes: { originalScore: 0.50 } }).mockResolvedValueOnce({ title: 'Great Movie', rottenTomatoes: { originalScore: 0.90 } }); const result = await plexSourceWithRating.fetchMedia(['Movies'], 'movie', 10); expect(mockProcessPlexItem).toHaveBeenCalledTimes(3); expect(result).toHaveLength(2); });
        it('should log debug information when debug is enabled', async () => { const debugPlexSource = new PlexSource( mockServerConfig, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 0, true ); const mockLibraries = new Map([ ['Movies', { key: '1', title: 'Movies' }] ]); const mockMediaItems = [ { ratingKey: '1', title: 'Movie 1' } ]; mockGetPlexLibraries.mockResolvedValue(mockLibraries); mockPlexClient.query.mockResolvedValue({ MediaContainer: { Metadata: mockMediaItems } }); const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(); await debugPlexSource.fetchMedia(['Movies'], 'movie', 5); expect(consoleLogSpy).toHaveBeenCalledWith('[PlexSource:Test Plex Server] Fetching 5 movie(s) from libraries: Movies'); consoleLogSpy.mockRestore(); });
        it('should handle multiple libraries', async () => { const mockLibraries = new Map([ ['Movies', { key: '1', title: 'Movies' }], ['Documentaries', { key: '2', title: 'Documentaries' }] ]); const movieItems = [ { ratingKey: '1', title: 'Movie 1' }, { ratingKey: '2', title: 'Movie 2' } ]; const docItems = [ { ratingKey: '3', title: 'Doc 1' }, { ratingKey: '4', title: 'Doc 2' } ]; mockGetPlexLibraries.mockResolvedValue(mockLibraries); mockPlexClient.query.mockResolvedValueOnce({ MediaContainer: { Metadata: movieItems } }).mockResolvedValueOnce({ MediaContainer: { Metadata: docItems } }); const result = await plexSource.fetchMedia(['Movies', 'Documentaries'], 'movie', 3); expect(mockPlexClient.query).toHaveBeenCalledTimes(2); expect(result.length).toBeGreaterThan(0); });
    });

    describe('Content Filtering', () => {
        it('should filter by rating', async () => { const serverConfigWithRating = { ...mockServerConfig, ratingFilter: 'PG-13' }; const plexSourceWithRating = new PlexSource( serverConfigWithRating, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 0, false ); const mockItems = [ { ratingKey: '1', title: 'Movie 1', contentRating: 'PG-13' }, { ratingKey: '2', title: 'Movie 2', contentRating: 'R' }, { ratingKey: '3', title: 'Movie 3', contentRating: 'PG-13' } ]; const filteredItems = plexSourceWithRating.applyContentFiltering(mockItems); expect(filteredItems).toHaveLength(2); });
        it('should filter by genre', async () => { const serverConfigWithGenre = { ...mockServerConfig, genreFilter: 'Action, Comedy' }; const plexSourceWithGenre = new PlexSource( serverConfigWithGenre, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 0, false ); const mockItems = [ { ratingKey: '1', title: 'Action Movie', Genre: [{ tag: 'Action' }, { tag: 'Thriller' }] }, { ratingKey: '2', title: 'Drama Movie', Genre: [{ tag: 'Drama' }] }, { ratingKey: '3', title: 'Comedy Movie', Genre: [{ tag: 'Comedy' }, { tag: 'Romance' }] } ]; const filteredItems = plexSourceWithGenre.applyContentFiltering(mockItems); expect(filteredItems).toHaveLength(2); });
        it('should filter by recently added', async () => { const serverConfigWithRecent = { ...mockServerConfig, recentlyAddedOnly: true, recentlyAddedDays: 7 }; const plexSourceWithRecent = new PlexSource( serverConfigWithRecent, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 0, false ); const now = Math.floor(Date.now() / 1000); const sixDaysAgo = now - (6 * 24 * 60 * 60); const monthAgo = now - (30 * 24 * 60 * 60); const mockItems = [ { ratingKey: '1', title: 'Recent Movie', addedAt: now }, { ratingKey: '2', title: 'Old Movie', addedAt: monthAgo }, { ratingKey: '3', title: 'Six Days Old Movie', addedAt: sixDaysAgo } ]; const filteredItems = plexSourceWithRecent.applyContentFiltering(mockItems); expect(filteredItems).toHaveLength(2); });
        it('should filter by quality', async () => { const serverConfigWithQuality = { ...mockServerConfig, qualityFilter: '1080p' }; const plexSourceWithQuality = new PlexSource( serverConfigWithQuality, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 0, false ); const mockItems = [ { ratingKey: '1', title: 'HD Movie', Media: [{ videoResolution: '1080' }] }, { ratingKey: '2', title: 'SD Movie', Media: [{ videoResolution: 'sd' }] }, { ratingKey: '3', title: 'Another HD Movie', Media: [{ videoResolution: '1080' }] } ]; const filteredItems = plexSourceWithQuality.applyContentFiltering(mockItems); expect(filteredItems).toHaveLength(2); });
        it('should apply multiple filters', async () => { const serverConfigWithMultiple = { ...mockServerConfig, ratingFilter: 'PG-13', genreFilter: 'Action' }; const plexSourceWithMultiple = new PlexSource( serverConfigWithMultiple, mockGetPlexClient, mockProcessPlexItem, mockGetPlexLibraries, mockShuffleArray, 0, false ); const mockItems = [ { ratingKey: '1', title: 'PG-13 Action Movie', contentRating: 'PG-13', Genre: [{ tag: 'Action' }] }, { ratingKey: '2', title: 'R Action Movie', contentRating: 'R', Genre: [{ tag: 'Action' }] }, { ratingKey: '3', title: 'PG-13 Drama Movie', contentRating: 'PG-13', Genre: [{ tag: 'Drama' }] } ]; const filteredItems = plexSourceWithMultiple.applyContentFiltering(mockItems); expect(filteredItems).toHaveLength(1); });
    });
});
