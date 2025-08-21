const GitHubService = require('../../utils/github');
const semver = require('semver');
const logger = require('../../logger');

// Mock dependencies
jest.mock('semver');
jest.mock('../../logger');

describe('GitHub Service - checkForUpdates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        GitHubService.clearCache();

        // Mock semver functions
        semver.lt.mockReturnValue(false);
        semver.diff.mockReturnValue(null);
    });

    test('should compare versions and detect update', async () => {
        const currentVersion = '0.9.0';

        const mockRelease = {
            tag_name: '1.0.0',
            html_url: 'https://github.com/Posterrama/posterrama/releases/tag/v1.0.0',
            assets: [
                { name: 'posterrama-v1.0.0.zip', browser_download_url: 'https://download.url' },
            ],
            body: 'Release notes',
            published_at: '2023-01-01T00:00:00Z',
            name: 'Version 1.0.0',
        };

        jest.spyOn(GitHubService, 'getLatestRelease').mockResolvedValue(mockRelease);
        semver.lt.mockReturnValue(true);
        semver.diff.mockReturnValue('minor');

        const result = await GitHubService.checkForUpdates(currentVersion);

        expect(result).toEqual({
            currentVersion: '0.9.0',
            latestVersion: '1.0.0',
            hasUpdate: true,
            updateType: 'minor',
            releaseUrl: 'https://github.com/Posterrama/posterrama/releases/tag/v1.0.0',
            downloadUrl: 'https://download.url',
            releaseNotes: 'Release notes',
            publishedAt: '2023-01-01T00:00:00Z',
            releaseName: 'Version 1.0.0',
        });

        expect(semver.lt).toHaveBeenCalledWith('0.9.0', '1.0.0');
        expect(semver.diff).toHaveBeenCalledWith('0.9.0', '1.0.0');
        expect(logger.info).toHaveBeenCalledWith('Version comparison completed', {
            current: '0.9.0',
            latest: '1.0.0',
            hasUpdate: true,
            updateType: 'minor',
        });
    });

    test('should handle version prefixes', async () => {
        const mockRelease = {
            tag_name: 'v1.0.0',
            html_url: 'https://github.com/test',
            assets: [],
            tarball_url: 'https://tarball.url',
            body: null,
            published_at: '2023-01-01T00:00:00Z',
            name: null,
        };

        jest.spyOn(GitHubService, 'getLatestRelease').mockResolvedValue(mockRelease);

        await GitHubService.checkForUpdates('v0.9.0');

        expect(semver.lt).toHaveBeenCalledWith('0.9.0', '1.0.0');
    });

    test('should use zipball_url when no zip assets available', async () => {
        const mockRelease = {
            tag_name: '1.0.0',
            html_url: 'https://github.com/test',
            assets: [],
            zipball_url: 'https://zipball.url',
            body: 'Notes',
            published_at: '2023-01-01T00:00:00Z',
            name: null,
        };

        jest.spyOn(GitHubService, 'getLatestRelease').mockResolvedValue(mockRelease);

        const result = await GitHubService.checkForUpdates('0.9.0');

        expect(result.downloadUrl).toBe('https://zipball.url');
        expect(result.releaseName).toBe('1.0.0'); // Falls back to tag_name
    });

    test('should find zip asset when available', async () => {
        const mockRelease = {
            tag_name: '1.0.0',
            html_url: 'https://github.com/test',
            assets: [{ name: 'posterrama-v1.0.0.zip', browser_download_url: 'https://zip.url' }],
            zipball_url: 'https://zipball.url',
            body: 'Notes',
            published_at: '2023-01-01T00:00:00Z',
            name: 'Release',
        };

        jest.spyOn(GitHubService, 'getLatestRelease').mockResolvedValue(mockRelease);

        const result = await GitHubService.checkForUpdates('0.9.0');

        expect(result.downloadUrl).toBe('https://zip.url');
    });

    test('should handle no update available', async () => {
        const mockRelease = {
            tag_name: '0.9.0',
            html_url: 'https://github.com/test',
            assets: [],
            zipball_url: 'https://zipball.url',
            body: 'Notes',
            published_at: '2023-01-01T00:00:00Z',
            name: 'Release',
        };

        jest.spyOn(GitHubService, 'getLatestRelease').mockResolvedValue(mockRelease);
        semver.lt.mockReturnValue(false);
        semver.diff.mockReturnValue(null);

        const result = await GitHubService.checkForUpdates('1.0.0');

        expect(result.hasUpdate).toBe(false);
        expect(result.updateType).toBe(null);
    });

    test('should handle errors', async () => {
        const error = new Error('API Error');
        jest.spyOn(GitHubService, 'getLatestRelease').mockRejectedValue(error);

        await expect(GitHubService.checkForUpdates('1.0.0')).rejects.toThrow('API Error');
        expect(logger.error).toHaveBeenCalledWith('Failed to check for updates', {
            error: 'API Error',
        });
    });

    test('should handle semver comparison errors', async () => {
        const mockRelease = {
            tag_name: 'invalid-version',
            html_url: 'https://github.com/test',
            assets: [],
            tarball_url: 'https://tarball.url',
            body: 'Notes',
            published_at: '2023-01-01T00:00:00Z',
            name: 'Release',
        };
        jest.spyOn(GitHubService, 'getLatestRelease').mockResolvedValue(mockRelease);
        semver.lt.mockImplementation(() => {
            throw new Error('Invalid version');
        });

        await expect(GitHubService.checkForUpdates('1.0.0')).rejects.toThrow('Invalid version');
    });

    test('should handle edge cases in version comparison', async () => {
        const mockRelease = {
            tag_name: 'release-1.0.0-beta',
            html_url: 'https://github.com/test',
            assets: [],
            tarball_url: 'https://tarball.url',
            body: '',
            published_at: '2023-01-01T00:00:00Z',
            name: '',
        };

        jest.spyOn(GitHubService, 'getLatestRelease').mockResolvedValue(mockRelease);

        await GitHubService.checkForUpdates('release-0.9.0-alpha');

        expect(semver.lt).toHaveBeenCalledWith('release-0.9.0-alpha', 'release-1.0.0-beta');
    });
});
