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
            document.getElementById('PLEX_HOSTNAME').value = env.PLEX_HOSTNAME ?? '';
            document.getElementById('PLEX_PORT').value = env.PLEX_PORT ?? '';
            // For security, don't display the token. Show a placeholder if it's set.
            const tokenInput = document.getElementById('PLEX_TOKEN');
            tokenInput.value = ''; // Always clear the value on load
            // env.PLEX_TOKEN is now a boolean indicating if the token is set on the server
            tokenInput.placeholder = env.PLEX_TOKEN === true ? '******** (already set)' : 'Enter new token...';

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

    /**
     * Adds a "Test Connection" button for the Plex server settings.
     */
    function addPlexTestButton() {
        const tokenInput = document.getElementById('PLEX_TOKEN');
        if (!tokenInput) return;
 
        const testButton = document.createElement('button');
        testButton.type = 'button';
        testButton.className = 'button is-info is-small';
        testButton.style.marginLeft = '10px';
        testButton.style.verticalAlign = 'middle';
        // Set a fixed width to prevent layout shifts when text changes
        testButton.style.width = '140px';
        testButton.style.transition = 'background-color 0.3s, border-color 0.3s';
 
        const iconSpan = document.createElement('span');
        iconSpan.className = 'icon';
        const icon = document.createElement('i');
        icon.className = 'fas fa-plug';
        iconSpan.appendChild(icon);
 
        const textSpan = document.createElement('span');
        textSpan.textContent = 'Test Verbinding';
 
        testButton.appendChild(iconSpan);
        testButton.appendChild(textSpan);
 
        tokenInput.parentElement.appendChild(testButton);
 
        testButton.addEventListener('click', async () => {
            const originalText = 'Test Verbinding';
            const originalIconClass = 'fas fa-plug';
            const originalButtonClass = 'button is-info is-small';
 
            // Set loading state
            testButton.disabled = true;
            textSpan.textContent = 'Testen...';
            icon.className = 'fas fa-spinner fa-spin';
            testButton.classList.remove('is-success', 'is-danger');
            testButton.classList.add('is-info');
 
            let finalMessage = '';
            let finalIcon = '';
            let finalClass = '';
 
            try {
                const hostname = document.getElementById('PLEX_HOSTNAME').value;
                const port = document.getElementById('PLEX_PORT').value;
                const tokenInput = document.getElementById('PLEX_TOKEN');
                const token = tokenInput.value;
                const isTokenSetOnServer = tokenInput.placeholder.includes('already set');
 
                if (!hostname || !port) {
                    throw new Error('Hostname en poort zijn vereist om een test uit te voeren.');
                }
                if (!token && !isTokenSetOnServer) {
                    throw new Error('Een nieuw token is vereist om de verbinding te testen, omdat er nog geen is ingesteld.');
                }
 
                const response = await fetch('/api/admin/test-plex', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostname, port, token: token || undefined }) // Send token only if it has a value
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Onbekende fout');
 
                showNotification(result.message, 'success');
                finalMessage = 'Succes';
                finalIcon = 'fas fa-check';
                finalClass = 'is-success';
            } catch (error) {
                showNotification(`Test mislukt: ${error.message}`, 'error');
                finalMessage = 'Mislukt';
                finalIcon = 'fas fa-exclamation-triangle';
                finalClass = 'is-danger';
            }
 
            // Set final state (success or error)
            testButton.className = `${originalButtonClass} ${finalClass}`;
            testButton.classList.remove('is-info');
            textSpan.textContent = finalMessage;
            icon.className = finalIcon;
 
            // Revert to original state after a delay
            setTimeout(() => {
                testButton.disabled = false;
                testButton.className = originalButtonClass;
                testButton.style.width = '140px';
                textSpan.textContent = originalText;
                icon.className = originalIconClass;
            }, 2500);
        });
    }

    loadConfig();

    /**
     * Displays a notification message on the screen.
     * @param {string} message The message to display.
     * @param {string} type The type of notification ('success' or 'error').
     */
    function showNotification(message, type = 'success') {
        const container = document.getElementById('notification-area');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        container.appendChild(notification);

        // Trigger the transition for appearing
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Hide and remove the notification after 5 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            notification.addEventListener('transitionend', () => notification.remove());
        }, 5000);
    }

     const configForm = document.getElementById('config-form');
    if (configForm) {
        addPlexTestButton();

        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = event.target.querySelector('button[type="submit"]');
            const originalButtonText = button.textContent;
            button.disabled = true;
            button.textContent = 'Saving...';

            try {
                // Helper to get form values and parse them
                const getValue = (id, type = 'string') => {
                    const element = document.getElementById(id);
                    if (!element) return null;

                    if (element.type === 'checkbox') {
                        return element.checked;
                    }

                    const value = element.value;
                    if (type === 'number') {
                        return value === '' ? null : parseInt(value, 10);
                    }
                    if (type === 'array') {
                        return value.split(',').map(s => s.trim()).filter(Boolean);
                    }
                    return value;
                };

                const newConfig = {
                    transitionIntervalSeconds: getValue('transitionIntervalSeconds', 'number'),
                    backgroundRefreshMinutes: getValue('backgroundRefreshMinutes', 'number'),
                    recentlyAddedCacheMinutes: getValue('recentlyAddedCacheMinutes', 'number'),
                    showClearLogo: getValue('showClearLogo'),
                    recentlyAddedSidebar: getValue('recentlyAddedSidebar'),
                    clockWidget: getValue('clockWidget'),
                    kenBurnsEffect: {
                        enabled: getValue('kenBurnsEffect.enabled'),
                        durationSeconds: getValue('kenBurnsEffect.durationSeconds', 'number')
                    },
                    mediaServers: [{
                        name: "Plex Server", // This is not editable in the UI
                        type: "plex", // This is not editable in the UI
                        enabled: getValue('mediaServers[0].enabled'),
                        hostnameEnvVar: "PLEX_HOSTNAME",
                        portEnvVar: "PLEX_PORT",
                        tokenEnvVar: "PLEX_TOKEN",
                        movieLibraryNames: getValue('mediaServers[0].movieLibraryNames', 'array'),
                        showLibraryNames: getValue('mediaServers[0].showLibraryNames', 'array'),
                        movieCount: getValue('mediaServers[0].movieCount', 'number'),
                        showCount: getValue('mediaServers[0].showCount', 'number')
                    }]
                };

                const newEnv = {
                    SERVER_PORT: getValue('SERVER_PORT'),
                    DEBUG: String(getValue('DEBUG')), // .env values must be strings
                    PLEX_HOSTNAME: getValue('PLEX_HOSTNAME'),
                    PLEX_PORT: getValue('PLEX_PORT'),
                };

                // Only include the token if the user has entered a new one.
                // This prevents overwriting the existing token with an empty string.
                const plexToken = getValue('PLEX_TOKEN');
                if (plexToken) {
                    newEnv.PLEX_TOKEN = plexToken;
                }

                const response = await fetch('/api/admin/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ config: newConfig, env: newEnv }),
                });

                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to save settings.');

                showNotification('Settings saved successfully! Some changes may require a restart.', 'success');
                // Clear the token field and update the placeholder if a new token was saved.
                const tokenInput = document.getElementById('PLEX_TOKEN');
                tokenInput.value = '';
                if (plexToken) {
                    tokenInput.placeholder = '******** (already set)';
                }

            } catch (error) {
                console.error('Failed to save config:', error);
                showNotification(`Error saving settings: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                button.textContent = originalButtonText;
            }
        });
    }

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = event.target.querySelector('button[type="submit"]');
            const originalButtonText = button.textContent;
            button.disabled = true;
            button.textContent = 'Changing...';

            try {
                const response = await fetch('/api/admin/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to change password.');
                showNotification('Password changed successfully!', 'success');
                passwordForm.reset();
            } catch (error) {
                console.error('Failed to change password:', error);
                showNotification(`Error changing password: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                button.textContent = originalButtonText;
            }
        });
    }
});