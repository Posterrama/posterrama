const GitHubService = require('../../utils/github');

describe('GitHub Service - Integration Tests', () => {
    beforeEach(() => {
        GitHubService.clearCache();
    });

    test('should handle makeRequest errors gracefully', async () => {
        // Test that makeRequest throws expected errors for invalid paths
        await expect(GitHubService.makeRequest('/invalid/path')).rejects.toThrow();
    });

    test('should handle caching correctly', async () => {
        const GitHubService = require('../../utils/github');
        
        // Clear cache before test
        GitHubService.clearCache();
        
        // Mock makeRequest to track calls
        const originalMakeRequest = GitHubService.makeRequest;
        let callCount = 0;
        GitHubService.makeRequest = jest.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve({
                name: 'v1.0.0',
                tag_name: 'v1.0.0',
                published_at: '2023-01-01T00:00:00Z'
            });
        });
        
        // First call - should hit API
        const result1 = await GitHubService.getLatestRelease();
        expect(callCount).toBe(1);
        
        // Second call - should use cache
        const result2 = await GitHubService.getLatestRelease();
        expect(callCount).toBe(1); // Should still be 1 due to caching
        
        expect(result1).toEqual(result2);
        
        // Restore original method
        GitHubService.makeRequest = originalMakeRequest;
    });

    test('should export singleton instance', () => {
        const instance1 = require('../../utils/github');
        const instance2 = require('../../utils/github');
        
        expect(instance1).toBe(instance2);
        expect(typeof instance1).toBe('object');
        expect(typeof instance1.getLatestRelease).toBe('function');
        expect(typeof instance1.getReleases).toBe('function');
        expect(typeof instance1.checkForUpdates).toBe('function');
        expect(typeof instance1.getRepositoryInfo).toBe('function');
        expect(typeof instance1.clearCache).toBe('function');
        expect(typeof instance1.makeRequest).toBe('function');
    });

    test('should handle complete workflow', async () => {
        const mockRelease = {
            tag_name: 'v1.0.0',
            html_url: 'https://github.com/test',
            assets: [{ name: 'app.tar.gz', browser_download_url: 'https://download.url' }],
            body: 'Release notes',
            published_at: '2023-01-01T00:00:00Z',
            name: 'v1.0.0'
        };

        jest.spyOn(GitHubService, 'makeRequest').mockResolvedValue(mockRelease);
        
        const semver = require('semver');
        semver.lt = jest.fn().mockReturnValue(true);
        semver.diff = jest.fn().mockReturnValue('minor');

        // Test caching behavior
        const result1 = await GitHubService.getLatestRelease();
        const result2 = await GitHubService.getLatestRelease();

        expect(GitHubService.makeRequest).toHaveBeenCalledTimes(1);
        expect(result1).toEqual(result2);

        // Test update check
        const updateResult = await GitHubService.checkForUpdates('0.9.0');
        expect(updateResult.hasUpdate).toBe(true);

        // Clear cache and verify
        GitHubService.clearCache();
        expect(GitHubService.cache.data).toBe(null);
    });

    test('should handle malformed response data', async () => {
        jest.spyOn(GitHubService, 'makeRequest').mockRejectedValue(new Error('Malformed JSON'));

        await expect(GitHubService.getLatestRelease()).rejects.toThrow('Malformed JSON');
    });

    test('should handle network timeouts gracefully', async () => {
        jest.spyOn(GitHubService, 'makeRequest').mockRejectedValue(new Error('Request timeout'));

        await expect(GitHubService.getReleases(5)).rejects.toThrow('Request timeout');
    });
});
