const GitHubService = require('../../utils/github');
const logger = require('../../logger');

// Mock logger
jest.mock('../../logger');

describe('GitHub Service - API Methods', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        GitHubService.clearCache();
    });

    describe('getLatestRelease', () => {
        test('should fetch and cache latest release', async () => {
            const mockRelease = {
                tag_name: 'v1.0.0',
                published_at: '2023-01-01T00:00:00Z',
                html_url: 'https://github.com/Posterrama/posterrama/releases/tag/v1.0.0',
            };

            // Mock makeRequest
            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(mockRelease);

            const result = await GitHubService.getLatestRelease();

            expect(result).toEqual(mockRelease);
            expect(GitHubService.makeRequest).toHaveBeenCalledWith(
                '/repos/Posterrama/posterrama/releases/latest'
            );
            expect(logger.info).toHaveBeenCalledWith('Fetching latest release from GitHub');
            expect(logger.info).toHaveBeenCalledWith('Latest release fetched: v1.0.0', {
                version: 'v1.0.0',
                published: '2023-01-01T00:00:00Z',
            });

            // Check cache
            expect(GitHubService.cache.data).toEqual(mockRelease);
            expect(typeof GitHubService.cache.timestamp).toBe('number');
            expect(GitHubService.cache.timestamp).toBeGreaterThan(0);
        });

        test('should return cached data when cache is valid', async () => {
            const mockRelease = {
                tag_name: 'v1.0.0',
                published_at: '2023-01-01T00:00:00Z',
            };

            // Set cache with valid timestamp
            GitHubService.cache = {
                data: mockRelease,
                timestamp: Date.now() - 1000, // 1 second ago, within cache duration
            };

            const spy = jest.spyOn(GitHubService, 'makeRequest');

            const result = await GitHubService.getLatestRelease();

            expect(result).toEqual(mockRelease);
            expect(spy).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith('Returning cached GitHub release data');
        });

        test('should fetch new data when cache is expired', async () => {
            const oldRelease = { tag_name: 'v0.9.0' };
            const newRelease = { tag_name: 'v1.0.0', published_at: '2023-01-01T00:00:00Z' };

            // Set cache with expired timestamp
            GitHubService.cache = {
                data: oldRelease,
                timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago, expired
            };

            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(newRelease);

            const result = await GitHubService.getLatestRelease();

            expect(result).toEqual(newRelease);
            expect(GitHubService.makeRequest).toHaveBeenCalledWith(
                '/repos/Posterrama/posterrama/releases/latest'
            );
        });

        test('should handle API errors', async () => {
            const error = new Error('API Error');
            jest.spyOn(GitHubService, 'makeRequest').mockRejectedValue(error);

            await expect(GitHubService.getLatestRelease()).rejects.toThrow('API Error');
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to fetch latest release from GitHub',
                {
                    error: 'API Error',
                }
            );
        });

        test('should handle cache with null values', async () => {
            GitHubService.cache = { data: null, timestamp: null };

            const mockRelease = { tag_name: 'v1.0.0', published_at: '2023-01-01T00:00:00Z' };
            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(mockRelease);

            const result = await GitHubService.getLatestRelease();

            expect(result).toEqual(mockRelease);
            expect(GitHubService.makeRequest).toHaveBeenCalled();
        });
    });

    describe('getReleases', () => {
        test('should fetch releases with default limit', async () => {
            const mockReleases = [{ tag_name: 'v1.0.0' }, { tag_name: 'v0.9.0' }];

            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(mockReleases);

            const result = await GitHubService.getReleases();

            expect(result).toEqual(mockReleases);
            expect(GitHubService.makeRequest).toHaveBeenCalledWith(
                '/repos/Posterrama/posterrama/releases?per_page=10'
            );
            expect(logger.info).toHaveBeenCalledWith('Fetching 10 releases from GitHub');
            expect(logger.info).toHaveBeenCalledWith('Fetched 2 releases from GitHub');
        });

        test('should fetch releases with custom limit', async () => {
            const mockReleases = [{ tag_name: 'v1.0.0' }];
            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(mockReleases);

            const result = await GitHubService.getReleases(5);

            expect(result).toEqual(mockReleases);
            expect(GitHubService.makeRequest).toHaveBeenCalledWith(
                '/repos/Posterrama/posterrama/releases?per_page=5'
            );
            expect(logger.info).toHaveBeenCalledWith('Fetching 5 releases from GitHub');
        });

        test('should handle API errors', async () => {
            const error = new Error('API Error');
            jest.spyOn(GitHubService, 'makeRequest').mockRejectedValue(error);

            await expect(GitHubService.getReleases()).rejects.toThrow('API Error');
            expect(logger.error).toHaveBeenCalledWith('Failed to fetch releases from GitHub', {
                error: 'API Error',
            });
        });

        test('should handle empty releases array', async () => {
            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue([]);

            const result = await GitHubService.getReleases();

            expect(result).toEqual([]);
            expect(logger.info).toHaveBeenCalledWith('Fetched 0 releases from GitHub');
        });
    });

    describe('getRepositoryInfo', () => {
        test('should fetch repository information', async () => {
            const mockRepo = {
                name: 'posterrama',
                full_name: 'Posterrama/posterrama',
                description: 'A poster app',
                html_url: 'https://github.com/Posterrama/posterrama',
                stargazers_count: 10,
                forks_count: 5,
                open_issues_count: 2,
                language: 'JavaScript',
                updated_at: '2023-01-01T00:00:00Z',
                license: { name: 'MIT' },
            };

            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(mockRepo);

            const result = await GitHubService.getRepositoryInfo();

            expect(result).toEqual({
                name: 'posterrama',
                fullName: 'Posterrama/posterrama',
                description: 'A poster app',
                url: 'https://github.com/Posterrama/posterrama',
                stars: 10,
                forks: 5,
                issues: 2,
                language: 'JavaScript',
                updatedAt: '2023-01-01T00:00:00Z',
                license: 'MIT',
            });

            expect(GitHubService.makeRequest).toHaveBeenCalledWith('/repos/Posterrama/posterrama');
            expect(logger.info).toHaveBeenCalledWith('Fetching repository information from GitHub');
            expect(logger.info).toHaveBeenCalledWith('Repository information fetched', {
                name: 'posterrama',
                stars: 10,
                forks: 5,
            });
        });

        test('should handle missing license', async () => {
            const mockRepo = {
                name: 'posterrama',
                full_name: 'Posterrama/posterrama',
                description: 'A poster app',
                html_url: 'https://github.com/Posterrama/posterrama',
                stargazers_count: 10,
                forks_count: 5,
                open_issues_count: 2,
                language: 'JavaScript',
                updated_at: '2023-01-01T00:00:00Z',
                license: null,
            };

            jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(mockRepo);

            const result = await GitHubService.getRepositoryInfo();

            expect(result.license).toBe('Unknown');
        });

        test('should handle API errors', async () => {
            const error = new Error('API Error');
            jest.spyOn(GitHubService, 'makeRequest').mockRejectedValue(error);

            await expect(GitHubService.getRepositoryInfo()).rejects.toThrow('API Error');
            expect(logger.error).toHaveBeenCalledWith('Failed to fetch repository information', {
                error: 'API Error',
            });
        });
    });
});
