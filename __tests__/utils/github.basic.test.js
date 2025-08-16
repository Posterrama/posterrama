const GitHubService = require('../../utils/github');
const logger = require('../../logger');

// Mock logger
jest.mock('../../logger');

describe('GitHub Service Basic Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        GitHubService.clearCache();
    });

    test('should initialize with correct values', () => {
        expect(GitHubService.owner).toBe('Posterrama');
        expect(GitHubService.repo).toBe('posterrama');
        expect(GitHubService.apiUrl).toBe('api.github.com');
        expect(GitHubService.cacheDuration).toBe(5 * 60 * 1000);
    });
    
    test('should have required methods', () => {
        expect(typeof GitHubService.makeRequest).toBe('function');
        expect(typeof GitHubService.getLatestRelease).toBe('function');
        expect(typeof GitHubService.getReleases).toBe('function');
        expect(typeof GitHubService.checkForUpdates).toBe('function');
        expect(typeof GitHubService.getRepositoryInfo).toBe('function');
        expect(typeof GitHubService.clearCache).toBe('function');
    });
    
    test('should clear cache', () => {
        // Set some cache data
        GitHubService.cache = {
            data: { tag_name: 'v1.0.0' },
            timestamp: Date.now()
        };

        GitHubService.clearCache();

        expect(GitHubService.cache).toEqual({
            data: null,
            timestamp: null
        });
        expect(logger.debug).toHaveBeenCalledWith('GitHub service cache cleared');
    });
});
