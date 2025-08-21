const https = require('https');
const semver = require('semver');
const logger = require('../logger');

class GitHubService {
    constructor() {
        this.owner = 'Posterrama';
        this.repo = 'posterrama';
        this.apiUrl = 'api.github.com';
        this.cacheDuration = 5 * 60 * 1000; // 5 minutes
        this.cache = {
            data: null,
            timestamp: null,
        };
    }

    /**
     * Make a request to GitHub API
     * @param {string} path - API path
     * @returns {Promise<Object>} - Response data
     */
    async makeRequest(path) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.apiUrl,
                path: path,
                method: 'GET',
                headers: {
                    'User-Agent': 'Posterrama-App/1.0',
                    Accept: 'application/vnd.github.v3+json',
                },
            };

            const req = https.request(options, res => {
                let data = '';

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(response);
                        } else {
                            reject(
                                new Error(
                                    `GitHub API error: ${res.statusCode} - ${response.message || 'Unknown error'}`
                                )
                            );
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse GitHub API response: ${error.message}`));
                    }
                });
            });

            req.on('error', error => {
                reject(new Error(`GitHub API request failed: ${error.message}`));
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('GitHub API request timeout'));
            });

            req.end();
        });
    }

    /**
     * Get the latest release from GitHub
     * @returns {Promise<Object>} - Latest release data
     */
    async getLatestRelease() {
        try {
            // Check cache first
            if (
                this.cache.data &&
                this.cache.timestamp &&
                Date.now() - this.cache.timestamp < this.cacheDuration
            ) {
                logger.debug('Returning cached GitHub release data');
                return this.cache.data;
            }

            logger.info('Fetching latest release from GitHub');
            const path = `/repos/${this.owner}/${this.repo}/releases/latest`;
            const release = await this.makeRequest(path);

            // Cache the result
            this.cache = {
                data: release,
                timestamp: Date.now(),
            };

            logger.info(`Latest release fetched: ${release.tag_name}`, {
                version: release.tag_name,
                published: release.published_at,
            });

            return release;
        } catch (error) {
            logger.error('Failed to fetch latest release from GitHub', {
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Get all releases from GitHub
     * @param {number} limit - Maximum number of releases to fetch
     * @returns {Promise<Array>} - Array of release data
     */
    async getReleases(limit = 10) {
        try {
            logger.info(`Fetching ${limit} releases from GitHub`);
            const path = `/repos/${this.owner}/${this.repo}/releases?per_page=${limit}`;
            const releases = await this.makeRequest(path);

            logger.info(`Fetched ${releases.length} releases from GitHub`);
            return releases;
        } catch (error) {
            logger.error('Failed to fetch releases from GitHub', {
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Compare current version with latest release
     * @param {string} currentVersion - Current application version
     * @returns {Promise<Object>} - Comparison result
     */
    async checkForUpdates(currentVersion) {
        try {
            const latestRelease = await this.getLatestRelease();
            const latestVersion = latestRelease.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
            const current = currentVersion.replace(/^v/, '');

            const hasUpdate = semver.lt(current, latestVersion);
            const versionDiff = semver.diff(current, latestVersion);

            const result = {
                currentVersion: current,
                latestVersion: latestVersion,
                hasUpdate: hasUpdate,
                updateType: versionDiff, // 'major', 'minor', 'patch', etc.
                releaseUrl: latestRelease.html_url,
                downloadUrl:
                    latestRelease.assets.find(asset => asset.name.includes('.zip'))
                        ?.browser_download_url || latestRelease.zipball_url,
                releaseNotes: latestRelease.body,
                publishedAt: latestRelease.published_at,
                releaseName: latestRelease.name || latestRelease.tag_name,
            };

            logger.info('Version comparison completed', {
                current: current,
                latest: latestVersion,
                hasUpdate: hasUpdate,
                updateType: versionDiff,
            });

            return result;
        } catch (error) {
            logger.error('Failed to check for updates', {
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Get repository information
     * @returns {Promise<Object>} - Repository data
     */
    async getRepositoryInfo() {
        try {
            logger.info('Fetching repository information from GitHub');
            const path = `/repos/${this.owner}/${this.repo}`;
            const repo = await this.makeRequest(path);

            const result = {
                name: repo.name,
                fullName: repo.full_name,
                description: repo.description,
                url: repo.html_url,
                stars: repo.stargazers_count,
                forks: repo.forks_count,
                issues: repo.open_issues_count,
                language: repo.language,
                updatedAt: repo.updated_at,
                license: repo.license?.name || 'Unknown',
            };

            logger.info('Repository information fetched', {
                name: result.name,
                stars: result.stars,
                forks: result.forks,
            });

            return result;
        } catch (error) {
            logger.error('Failed to fetch repository information', {
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache = {
            data: null,
            timestamp: null,
        };
        logger.debug('GitHub service cache cleared');
    }
}

module.exports = new GitHubService();
