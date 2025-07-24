document.addEventListener('DOMContentLoaded', () => {

    // Default values as requested
    const defaults = {
        transitionIntervalSeconds: 15,
        backgroundRefreshMinutes: 15,
        SERVER_PORT: 4000,
        showClearLogo: true,
        recentlyAddedSidebar: false,
        clockWidget: true,
        DEBUG: false
    };

    async function loadConfig() {
        try {
            const response = await fetch('/api/admin/config');
            if (!response.ok) {
                throw new Error('Could not load configuration from the server.');
            }
            const data = await response.json();
            const config = data.config || {};
            const env = data.env || {};

            // Populate General Settings
            document.getElementById('transitionIntervalSeconds').value = config.transitionIntervalSeconds ?? defaults.transitionIntervalSeconds;
            document.getElementById('backgroundRefreshMinutes').value = config.backgroundRefreshMinutes ?? defaults.backgroundRefreshMinutes;
            document.getElementById('SERVER_PORT').value = env.SERVER_PORT ?? defaults.SERVER_PORT;

            // Populate Display Settings (Checkboxes)
            document.getElementById('showClearLogo').checked = config.showClearLogo ?? defaults.showClearLogo;
            document.getElementById('recentlyAddedSidebar').checked = config.recentlyAddedSidebar ?? defaults.recentlyAddedSidebar;
            document.getElementById('clockWidget').checked = config.clockWidget ?? defaults.clockWidget;
            // env.DEBUG is a string 'true'/'false' or undefined, so it needs special handling.
            document.getElementById('DEBUG').checked = env.DEBUG != null ? (env.DEBUG === 'true') : defaults.DEBUG;

        } catch (error) {
            console.error('Failed to load config:', error);
            alert('Failed to load settings. Please try refreshing the page.');
        }
    }

    loadConfig();
});