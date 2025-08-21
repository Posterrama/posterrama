describe('GitHub Service - Error Handling', () => {
    let GitHubService;

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear require cache to ensure fresh instance
        delete require.cache[require.resolve('../../utils/github')];
        GitHubService = require('../../utils/github');
        GitHubService.clearCache();
    });

    afterEach(() => {
        GitHubService.clearCache();
    });

    describe('makeRequest error scenarios', () => {
        test('should handle makeRequest errors by mocking the method directly', async () => {
            // Mock makeRequest to simulate API error
            const originalMakeRequest = GitHubService.makeRequest;
            GitHubService.makeRequest = jest
                .fn()
                .mockRejectedValue(new Error('GitHub API error: 404 - Not Found'));

            await expect(GitHubService.getLatestRelease()).rejects.toThrow(
                'GitHub API error: 404 - Not Found'
            );

            // Restore
            GitHubService.makeRequest = originalMakeRequest;
        });

        test('should handle JSON parse errors by mocking makeRequest', async () => {
            const originalMakeRequest = GitHubService.makeRequest;
            GitHubService.makeRequest = jest
                .fn()
                .mockRejectedValue(new Error('Failed to parse GitHub API response'));

            await expect(GitHubService.getRepositoryInfo()).rejects.toThrow(
                'Failed to parse GitHub API response'
            );

            // Restore
            GitHubService.makeRequest = originalMakeRequest;
        });

        test('should handle network errors by mocking makeRequest', async () => {
            const originalMakeRequest = GitHubService.makeRequest;
            GitHubService.makeRequest = jest
                .fn()
                .mockRejectedValue(new Error('GitHub API request failed: Network error'));

            await expect(GitHubService.getReleases()).rejects.toThrow(
                'GitHub API request failed: Network error'
            );

            // Restore
            GitHubService.makeRequest = originalMakeRequest;
        });

        test('should handle timeout errors by mocking makeRequest', async () => {
            const originalMakeRequest = GitHubService.makeRequest;
            GitHubService.makeRequest = jest
                .fn()
                .mockRejectedValue(new Error('GitHub API request timeout'));

            await expect(GitHubService.checkForUpdates()).rejects.toThrow(
                'GitHub API request timeout'
            );

            // Restore
            GitHubService.makeRequest = originalMakeRequest;
        });

        test('should handle various API error codes', async () => {
            const originalMakeRequest = GitHubService.makeRequest;

            // Test different error scenarios
            const errorScenarios = [
                { error: 'GitHub API error: 403 - Forbidden', method: 'getLatestRelease' },
                { error: 'GitHub API error: 500 - Internal Server Error', method: 'getReleases' },
                {
                    error: 'GitHub API error: 429 - Rate limit exceeded',
                    method: 'getRepositoryInfo',
                },
            ];

            for (const scenario of errorScenarios) {
                GitHubService.makeRequest = jest.fn().mockRejectedValue(new Error(scenario.error));
                await expect(GitHubService[scenario.method]()).rejects.toThrow(scenario.error);
            }

            // Restore
            GitHubService.makeRequest = originalMakeRequest;
        });
    });
});
