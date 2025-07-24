document.addEventListener('DOMContentLoaded', () => {

    // Default values for settings
    const defaults = {
        transitionIntervalSeconds: 15,
        backgroundRefreshMinutes: 30,
        recentlyAddedCacheMinutes: 5, // A good default value
        showClearLogo: true,
        recentlyAddedSidebar: false,
        clockWidget: true,
        kenBurnsEffect: {
            enabled: true,
            durationSeconds: 25
        },
        mediaServers: [{
            enabled: true,
            movieLibraryNames: ["Movies"],
            showLibraryNames: ["TV Shows"],
            movieCount: 30,
            showCount: 15
        }],
        SERVER_PORT: 4000,
        DEBUG: false
    };

    /**
     * Helper to safely get a value from a nested object.
     * @param {object} obj The object to query.
     * @param {string} path The path to the value (e.g., 'kenBurnsEffect.enabled').
     * @param {*} defaultValue The default value to return if the path is not found.
     * @returns The found value or the default.
     */
    function get(obj, path, defaultValue) {
        const value = path.split('.').reduce((acc, part) => acc && acc[part], obj);
        return value !== undefined && value !== null ? value : defaultValue;
    }

    async function loadConfig() {
        try {
            const response = await fetch('/api/admin/config');
            if (!response.ok) {
                throw new Error('Could not load configuration from the server.');
            }
            const data = await response.json();
            const config = data.config || {};
            const env = data.env || {};

            // --- Populate General Settings ---
            document.getElementById('transitionIntervalSeconds').value = config.transitionIntervalSeconds ?? defaults.transitionIntervalSeconds;
            document.getElementById('backgroundRefreshMinutes').value = config.backgroundRefreshMinutes ?? defaults.backgroundRefreshMinutes;
            document.getElementById('recentlyAddedCacheMinutes').value = config.recentlyAddedCacheMinutes ?? defaults.recentlyAddedCacheMinutes;
            document.getElementById('SERVER_PORT').value = env.SERVER_PORT ?? defaults.SERVER_PORT;
            document.getElementById('DEBUG').checked = env.DEBUG === 'true' ?? defaults.DEBUG;

            // --- Populate Display Settings ---
            document.getElementById('showClearLogo').checked = config.showClearLogo ?? defaults.showClearLogo;
            document.getElementById('recentlyAddedSidebar').checked = config.recentlyAddedSidebar ?? defaults.recentlyAddedSidebar;
            document.getElementById('clockWidget').checked = config.clockWidget ?? defaults.clockWidget;
            document.getElementById('kenBurnsEffect.enabled').checked = get(config, 'kenBurnsEffect.enabled', defaults.kenBurnsEffect.enabled);
            document.getElementById('kenBurnsEffect.durationSeconds').value = get(config, 'kenBurnsEffect.durationSeconds', defaults.kenBurnsEffect.durationSeconds);

            // --- Populate Plex Media Server Settings (including sensitive values) ---
            const plexServerConfig = config.mediaServers && config.mediaServers[0] ? config.mediaServers[0] : {};
            const plexDefaults = defaults.mediaServers[0];

            document.getElementById('mediaServers[0].enabled').checked = plexServerConfig.enabled ?? plexDefaults.enabled;
            document.getElementById('PLEX_HOSTNAME').value = env.PLEX_HOSTNAME || '';
            document.getElementById('PLEX_PORT').value = env.PLEX_PORT || '';
            document.getElementById('PLEX_TOKEN').value = env.PLEX_TOKEN || '';

            // Library names are arrays, so we join them into a comma-separated string for the input field.
            document.getElementById('mediaServers[0].movieLibraryNames').value = (plexServerConfig.movieLibraryNames || plexDefaults.movieLibraryNames).join(', ');
            document.getElementById('mediaServers[0].showLibraryNames').value = (plexServerConfig.showLibraryNames || plexDefaults.showLibraryNames).join(', ');
            document.getElementById('mediaServers[0].movieCount').value = plexServerConfig.movieCount ?? plexDefaults.movieCount;
            document.getElementById('mediaServers[0].showCount').value = plexServerConfig.showCount ?? plexDefaults.showCount;

        } catch (error) {
            console.error('Failed to load config:', error);
            alert('Failed to load settings. Please try refreshing the page.');
        }
    }

    loadConfig();

    // TODO: Add event listeners for the config and password forms to save the data.
});