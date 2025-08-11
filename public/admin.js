document.addEventListener('DOMContentLoaded', () => {

    // Default values for settings
    const defaults = {
        transitionIntervalSeconds: 15,
        backgroundRefreshMinutes: 30,
        showClearLogo: true,
        showRottenTomatoes: true,
        rottenTomatoesMinimumScore: 0,
        showPoster: true,
        showMetadata: true,
        clockWidget: true,
        clockTimezone: 'auto',
        clockFormat: '24h',
        kenBurnsEffect: {
            enabled: true,
            durationSeconds: 25
        },
        mediaServers: [{
            enabled: true,
            hostname: '',
            port: 32400,
            movieLibraryNames: ["Movies"],
            showLibraryNames: ["TV Shows"],
            movieCount: 30,
            showCount: 15
        }],
        SERVER_PORT: 4000,
        DEBUG: false,
    };

    // --- Admin Background Slideshow State ---
    let adminBgQueue = [];
    let adminBgIndex = -1;
    let adminBgTimer = null;
    let activeAdminLayer = null;
    let inactiveAdminLayer = null;

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

    function populateGeneralSettings(config, env, defaults) {
        document.getElementById('transitionIntervalSeconds').value = config.transitionIntervalSeconds ?? defaults.transitionIntervalSeconds;
        document.getElementById('backgroundRefreshMinutes').value = config.backgroundRefreshMinutes ?? defaults.backgroundRefreshMinutes;
        // Use the nullish coalescing operator (??) to correctly handle empty strings from .env
        document.getElementById('SERVER_PORT').value = env.SERVER_PORT ?? defaults.SERVER_PORT;
        // Correctly check for the existence of the env.DEBUG variable.
        // The previous logic had an operator precedence issue and was not correctly using the default.
        document.getElementById('DEBUG').checked = (env.DEBUG !== undefined) ? (env.DEBUG === 'true') : defaults.DEBUG;

        const debugCheckbox = document.getElementById('DEBUG');
        const debugAction = document.getElementById('debug-cache-action');
        if (debugAction) {
            debugAction.classList.toggle('is-hidden', !debugCheckbox.checked);
        }
    }

    function populateDisplaySettings(config, defaults) {
        document.getElementById('showClearLogo').checked = config.showClearLogo ?? defaults.showClearLogo;
        document.getElementById('showRottenTomatoes').checked = config.showRottenTomatoes ?? defaults.showRottenTomatoes;
        document.getElementById('rottenTomatoesMinimumScore').value = config.rottenTomatoesMinimumScore ?? defaults.rottenTomatoesMinimumScore;
        document.getElementById('showPoster').checked = config.showPoster ?? defaults.showPoster;
        document.getElementById('showMetadata').checked = config.showMetadata ?? defaults.showMetadata;
        document.getElementById('clockWidget').checked = config.clockWidget ?? defaults.clockWidget;
        document.getElementById('clockTimezone').value = config.clockTimezone ?? defaults.clockTimezone;
        document.getElementById('clockFormat').value = config.clockFormat ?? defaults.clockFormat;
        document.getElementById('kenBurnsEffect.enabled').checked = get(config, 'kenBurnsEffect.enabled', defaults.kenBurnsEffect.enabled);
        document.getElementById('kenBurnsEffect.durationSeconds').value = get(config, 'kenBurnsEffect.durationSeconds', defaults.kenBurnsEffect.durationSeconds);
        
        // Show/hide timezone settings based on clockWidget state
        toggleClockSettings();
    }

    function setupDisplaySettingListeners() {
        const showPosterCheckbox = document.getElementById('showPoster');
        const showMetadataCheckbox = document.getElementById('showMetadata');
        const clockWidgetCheckbox = document.getElementById('clockWidget');

        const syncMetadataState = () => {
            if (!showPosterCheckbox.checked) {
                showMetadataCheckbox.checked = false;
                showMetadataCheckbox.disabled = true;
            } else {
                showMetadataCheckbox.disabled = false;
            }
        };

        showPosterCheckbox.addEventListener('change', syncMetadataState);
        showMetadataCheckbox.addEventListener('change', () => {
            if (showMetadataCheckbox.checked) {
                showPosterCheckbox.checked = true;
                syncMetadataState(); // Re-enable metadata checkbox if it was disabled
            }
        });

        // Setup clock widget toggle
        clockWidgetCheckbox.addEventListener('change', toggleClockSettings);

        // Initial state
        syncMetadataState();
        toggleClockSettings();
    }

    function toggleClockSettings() {
        const clockWidget = document.getElementById('clockWidget');
        const timezoneGroup = document.getElementById('clockTimezoneGroup');
        const formatGroup = document.getElementById('clockFormatGroup');
        
        if (clockWidget.checked) {
            timezoneGroup.style.display = 'block';
            formatGroup.style.display = 'block';
        } else {
            timezoneGroup.style.display = 'none';
            formatGroup.style.display = 'none';
        }
    }

    function populateSecuritySettings(security) {
        twoFaCheckbox.checked = security.is2FAEnabled;
        update2FAStatusText(security.is2FAEnabled);
    }

    function populatePlexSettings(config, env, defaults) {
        const plexServerConfig = config.mediaServers && config.mediaServers[0] ? config.mediaServers[0] : {};
        const plexDefaults = defaults.mediaServers[0];

        document.getElementById('mediaServers[0].enabled').checked = plexServerConfig.enabled ?? plexDefaults.enabled;
        // Use the nullish coalescing operator (??) to correctly handle empty strings from .env
        document.getElementById('mediaServers[0].hostname').value = env.PLEX_HOSTNAME ?? plexDefaults.hostname;
        document.getElementById('mediaServers[0].port').value = env.PLEX_PORT ?? plexDefaults.port;
        // For security, don't display the token. Show a placeholder if it's set.
        const tokenInput = document.getElementById('mediaServers[0].token');
        tokenInput.value = ''; // Always clear the value on load
        // env.PLEX_TOKEN is now a boolean indicating if the token is set on the server
        tokenInput.placeholder = env.PLEX_TOKEN === true ? '******** (already set)' : 'Enter new token...';

        const savedMovieLibs = plexServerConfig.movieLibraryNames || plexDefaults.movieLibraryNames;
        const savedShowLibs = plexServerConfig.showLibraryNames || plexDefaults.showLibraryNames;

        document.getElementById('mediaServers[0].movieCount').value = plexServerConfig.movieCount ?? plexDefaults.movieCount;
        document.getElementById('mediaServers[0].showCount').value = plexServerConfig.showCount ?? plexDefaults.showCount;

        return { savedMovieLibs, savedShowLibs };
    }

    async function loadConfig() {
        try {
            const response = await fetch('/api/admin/config');
            if (!response.ok) {
                throw new Error('Could not load configuration from the server.');
            }
            const { config = {}, env = {}, security = {} } = await response.json();

            populateGeneralSettings(config, env, defaults);
            populateDisplaySettings(config, defaults);
            setupDisplaySettingListeners();
            populateSecuritySettings(security);
            const { savedMovieLibs, savedShowLibs } = populatePlexSettings(config, env, defaults);

            // If Plex is configured, fetch libraries and start background slideshow
            if (env.PLEX_HOSTNAME && env.PLEX_PORT && env.PLEX_TOKEN === true) {
                fetchAndDisplayPlexLibraries(savedMovieLibs, savedShowLibs);
                initializeAdminBackground();
            }

            // Forcefully remove focus from any element that the browser might have auto-focused.
            if (document.activeElement) document.activeElement.blur();
        } catch (error) {
            console.error('Failed to load config:', error);
            showNotification('Failed to load settings. Please try refreshing the page.', 'error');
        }
    }

    /**
     * Initializes and starts the admin background slideshow.
     * Fetches the media list if not already present and starts a timer.
     */
    async function initializeAdminBackground() {
        if (adminBgTimer) {
            clearInterval(adminBgTimer);
        }

        if (!activeAdminLayer) {
            activeAdminLayer = document.getElementById('admin-background-a');
            inactiveAdminLayer = document.getElementById('admin-background-b');
        }

        if (adminBgQueue.length === 0) {
            try {
                const response = await fetch(`/get-media?_=${Date.now()}`);
                if (!response.ok) {
                    console.warn('Could not fetch media for admin background, server might be starting up.');
                    return;
                }
                adminBgQueue = await response.json();
                if (adminBgQueue.length === 0) {
                    console.warn('Admin background queue is empty.');
                    return;
                }
                adminBgIndex = Math.floor(Math.random() * adminBgQueue.length) - 1;
            } catch (error) {
                console.warn('Failed to fetch admin background media:', error);
                return;
            }
        }

        changeAdminBackground(); // Show first image immediately
        adminBgTimer = setInterval(changeAdminBackground, 30000); // Change every 30 seconds
    }

    /**
     * Changes the background image on the admin page with a fade effect.
     */
    function changeAdminBackground() {
        if (adminBgQueue.length === 0 || !activeAdminLayer || !inactiveAdminLayer) return;

        adminBgIndex = (adminBgIndex + 1) % adminBgQueue.length;
        const currentItem = adminBgQueue[adminBgIndex];

        if (!currentItem || !currentItem.backgroundUrl) return;

        const img = new Image();
        img.onload = () => {
            inactiveAdminLayer.style.backgroundImage = `url('${currentItem.backgroundUrl}')`;
            inactiveAdminLayer.style.opacity = 1;
            activeAdminLayer.style.opacity = 0;

            // Swap layers for the next transition
            const tempLayer = activeAdminLayer;
            activeAdminLayer = inactiveAdminLayer;
            inactiveAdminLayer = tempLayer;
        };
        img.src = currentItem.backgroundUrl;
    }

    /**
     * Adds a "Test Connection" button for the Plex server settings.
     */
    function addPlexTestButton() {
        const testButton = document.getElementById('test-plex-button');
        if (!testButton) return;

        testButton.addEventListener('click', async () => {
            const hostname = document.getElementById('mediaServers[0].hostname').value;
            const port = document.getElementById('mediaServers[0].port').value;
            const tokenInput = document.getElementById('mediaServers[0].token');
            const token = tokenInput.value;
            const isTokenSetOnServer = tokenInput.placeholder.includes('already set');

            setButtonState(testButton, 'loading', { text: 'Testing...' });

            try {
                if (!hostname || !port) {
                    throw new Error('Hostname and port are required to run a test.');
                }
                if (!token && !isTokenSetOnServer) {
                    throw new Error('A new token is required to test the connection, as none is set yet.');
                }

                const response = await fetch('/api/admin/test-plex', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostname, port, token: token || undefined }) // Send token only if it has a value
                });
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Unknown error');
                }

                setButtonState(testButton, 'success', { text: result.message });

                // Enable the "Refresh Media" button
                const refreshButton = document.getElementById('refresh-media-button');
                if (refreshButton) refreshButton.disabled = false;

                 // On success, fetch and display libraries, preserving current selections
                 const currentMovieLibs = getSelectedLibraries('movie');
                 const currentShowLibs = getSelectedLibraries('show');
                 fetchAndDisplayPlexLibraries(currentMovieLibs, currentShowLibs);
                 adminBgQueue = []; // Force a re-fetch of the media queue
                 initializeAdminBackground();

            } catch (error) {
                setButtonState(testButton, 'error');

                // Disable the "Refresh Media" button
                const refreshButton = document.getElementById('refresh-media-button');
                if (refreshButton) refreshButton.disabled = true;

            }
            // Revert to original state after a delay
            setTimeout(() => {
                setButtonState(testButton, 'revert');
            }, 2500);
        });
    }

    addPlexTestButton();

 























    /**
     * Fetches Plex libraries from the server and populates checkbox lists.
     * @param {string[]} preSelectedMovieLibs - Array of movie library names to pre-check.
     * @param {string[]} preSelectedShowLibs - Array of show library names to pre-check.
     */
    async function fetchAndDisplayPlexLibraries(preSelectedMovieLibs = [], preSelectedShowLibs = []) {
        const movieContainer = document.getElementById('movie-libraries-container');
        const showContainer = document.getElementById('show-libraries-container');
        const refreshButton = document.getElementById('refresh-media-button');

        movieContainer.innerHTML = '<small>Fetching libraries...</small>';
        showContainer.innerHTML = '<small>Fetching libraries...</small>';

        try {
            const hostname = document.getElementById('mediaServers[0].hostname').value;
            const port = document.getElementById('mediaServers[0].port').value;
            const token = document.getElementById('mediaServers[0].token').value;

            const response = await fetch('/api/admin/plex-libraries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hostname: hostname || undefined,
                    port: port || undefined,
                    token: token || undefined
                })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to fetch libraries.');

            const libraries = result.libraries || [];
            const movieLibraries = libraries.filter(lib => lib.type === 'movie');
            const showLibraries = libraries.filter(lib => lib.type === 'show');

            movieContainer.innerHTML = '';
            showContainer.innerHTML = '';

            if (movieLibraries.length === 0) {
                movieContainer.innerHTML = '<small>No movie libraries found.</small>';
            } else {
                movieLibraries.forEach(lib => {
                    const isChecked = preSelectedMovieLibs.includes(lib.name);
                    movieContainer.appendChild(createLibraryCheckbox(lib.name, 'movie', isChecked));
                });
            }

            if (showLibraries.length === 0) {
                showContainer.innerHTML = '<small>No show libraries found.</small>';
            } else {
                showLibraries.forEach(lib => {
                    const isChecked = preSelectedShowLibs.includes(lib.name);
                    showContainer.appendChild(createLibraryCheckbox(lib.name, 'show', isChecked));
                });
            }

            // Enable refresh button on successful library fetch
            if (refreshButton) refreshButton.disabled = false;

        } catch (error) {
            console.error('Failed to fetch Plex libraries:', error);
            const errorMessage = `<small class="error-text">Error: ${error.message}</small>`;
            movieContainer.innerHTML = errorMessage;
            showContainer.innerHTML = errorMessage;
            // Disable refresh button on failure
            if (refreshButton) refreshButton.disabled = true;
        }
    }

    function createLibraryCheckbox(name, type, isChecked) {
        const container = document.createElement('div');
        container.className = 'checkbox-group';
        const id = `lib-${type}-${name.replace(/\s+/g, '-')}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.name = `${type}Library`;
        input.value = name;
        input.checked = isChecked;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = name;
        container.appendChild(input);
        container.appendChild(label);
        return container;
    }

    function getSelectedLibraries(type) {
        const container = document.getElementById(`${type}-libraries-container`);
        const checkedBoxes = container.querySelectorAll(`input[name="${type}Library"]:checked`);
        return Array.from(checkedBoxes).map(cb => cb.value);
    }

    // --- 2FA Management ---

    const twoFaCheckbox = document.getElementById('enable2FA');
    const twoFaStatusText = document.getElementById('2fa-status-text');
    const twoFaModal = document.getElementById('2fa-modal');
    const twoFaVerifyForm = document.getElementById('2fa-verify-form');
    const cancel2faButton = document.getElementById('cancel-2fa-button');
    const qrCodeContainer = document.getElementById('qr-code-container');

    // New elements for the disable modal
    const disable2FAModal = document.getElementById('disable-2fa-modal');
    const disable2FAForm = document.getElementById('disable-2fa-form');
    const cancelDisable2FAButton = document.getElementById('cancel-disable-2fa-button');

    function show2FAModal() {
        if (twoFaModal) twoFaModal.classList.remove('is-hidden');
    }

    function hide2FAModal() {
        if (twoFaModal) twoFaModal.classList.add('is-hidden');
        if (qrCodeContainer) qrCodeContainer.innerHTML = '';
        const tokenInput = document.getElementById('2fa-token');
        if (tokenInput) tokenInput.value = '';
    }

    // New functions for the disable modal
    function showDisable2FAModal() {
        if (disable2FAModal) disable2FAModal.classList.remove('is-hidden');
    }

    function hideDisable2FAModal() {
        if (disable2FAModal) disable2FAModal.classList.add('is-hidden');
        if (disable2FAForm) disable2FAForm.reset();
    }

    function update2FAStatusText(isEnabled) {
        if (!twoFaStatusText) return;
        if (isEnabled) {
            twoFaStatusText.textContent = '2FA is currently enabled.';
            twoFaStatusText.className = 'status-text enabled';
        } else {
            twoFaStatusText.textContent = '2FA is currently disabled.';
            twoFaStatusText.className = 'status-text disabled';
        }
    }

    async function handleEnable2FA() {
        try {
            const response = await fetch('/api/admin/2fa/generate', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not generate QR code.');

            qrCodeContainer.innerHTML = `<img src="${result.qrCodeDataUrl}" alt="QR Code">`;
            show2FAModal();
        } catch (error) {
            showNotification(`Error enabling 2FA: ${error.message}`, 'error');
            twoFaCheckbox.checked = false;
        }
    }

    async function handleDisable2FA() {
        // This function now just shows the modal. The logic is moved to the form submit handler.
        showDisable2FAModal();
    }

    if (twoFaCheckbox) {
        twoFaCheckbox.addEventListener('change', (event) => {
            if (event.target.checked) {
                handleEnable2FA();
            } else {
                handleDisable2FA();
            }
        });
    }

    if (cancel2faButton) {
        cancel2faButton.addEventListener('click', () => {
            hide2FAModal();
            twoFaCheckbox.checked = false;
            update2FAStatusText(false);
        });
    }

    if (twoFaVerifyForm) {
        twoFaVerifyForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const tokenInput = document.getElementById('2fa-token');
            const token = tokenInput.value;

            try {
                const response = await fetch('/api/admin/2fa/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Verification failed.');

                hide2FAModal();
                showNotification('2FA enabled successfully!', 'success');
                update2FAStatusText(true);
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
                tokenInput.value = '';
                tokenInput.focus();
            }
        });
    }

    if (disable2FAForm) {
        disable2FAForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const passwordInput = document.getElementById('disable-2fa-password');
            const password = passwordInput.value;

            try {
                const response = await fetch('/api/admin/2fa/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Disable failed.');

                hideDisable2FAModal();
                showNotification('2FA disabled successfully.', 'success');
                update2FAStatusText(false);
            } catch (error) {
                showNotification(`Error disabling 2FA: ${error.message}`, 'error');
                // Don't hide the modal on error, so the user can try again.
                passwordInput.value = '';
                passwordInput.focus();
            }
        });
    }

    if (cancelDisable2FAButton) {
        cancelDisable2FAButton.addEventListener('click', () => {
            hideDisable2FAModal();
            twoFaCheckbox.checked = true; // Revert the checkbox state since the user cancelled
            update2FAStatusText(true);
        });
    }

    /**
     * Attaches a click handler to a button that requires a second confirmation click.
     * This provides a better user experience than a native confirm() dialog.
     * @param {HTMLButtonElement} button The button element.
     * @param {string} confirmText The text to display on the button for confirmation.
     * @param {function} onConfirm The async function to execute upon confirmation.
     */
    function addConfirmClickHandler(button, confirmText, onConfirm) {
        let confirmTimeout = null;
        const textSpan = button.querySelector('span:last-child');
        // If there's no text span, the button likely doesn't have an icon. Fallback to full textContent.
        const originalText = textSpan ? textSpan.textContent : button.textContent;

        const revertButton = () => {
            if (confirmTimeout) clearTimeout(confirmTimeout);
            if (!button) return;
            button.dataset.confirming = 'false';
            if (textSpan) {
                textSpan.textContent = originalText;
            } else {
                button.textContent = originalText;
            }
            button.classList.remove('is-warning');
        };

        button.addEventListener('click', (event) => {
            if (button.disabled) return;

            if (button.dataset.confirming === 'true') {
                revertButton();
                onConfirm(event);
            } else {
                button.dataset.confirming = 'true';
                if (textSpan) {
                    textSpan.textContent = confirmText;
                } else {
                    button.textContent = confirmText;
                }
                button.classList.add('is-warning');
                confirmTimeout = setTimeout(revertButton, 4000);
            }
        });
    }

    // --- API Key Management ---
    const apiKeyStatusText = document.getElementById('api-key-status-text');
    const apiKeyDisplayContainer = document.getElementById('api-key-display-container');
    const apiKeyInput = document.getElementById('api-key-input');
    const copyApiKeyButton = document.getElementById('copy-api-key-button');
    const toggleApiKeyVisibilityButton = document.getElementById('toggle-api-key-visibility-button');
    const generateApiKeyButton = document.getElementById('generate-api-key-button');
    const revokeApiKeyButton = document.getElementById('revoke-api-key-button');

    async function updateApiKeyStatus() {
        try {
            const response = await fetch('/api/admin/api-key/status');
            if (!response.ok) throw new Error('Could not fetch status.');
            const { hasKey } = await response.json();

            if (hasKey) {
                apiKeyStatusText.textContent = 'Active';
                apiKeyStatusText.className = 'status-text enabled';
                revokeApiKeyButton.disabled = false;

                // Fetch the key and display it
                const keyResponse = await fetch('/api/admin/api-key');
                if (!keyResponse.ok) throw new Error('Could not fetch API key.');
                const { apiKey } = await keyResponse.json();

                if (apiKey) {
                    apiKeyInput.value = apiKey;
                    apiKeyDisplayContainer.classList.remove('is-hidden');
                } else {
                    apiKeyDisplayContainer.classList.add('is-hidden');
                }
            } else {
                apiKeyStatusText.textContent = 'No key configured';
                apiKeyStatusText.className = 'status-text disabled';
                revokeApiKeyButton.disabled = true;
                apiKeyDisplayContainer.classList.add('is-hidden');
                apiKeyInput.value = '';
            }
        } catch (error) {
            apiKeyStatusText.textContent = `Error: ${error.message}`;
            apiKeyStatusText.className = 'status-text error';
        }
    }

    if (generateApiKeyButton) {
        addConfirmClickHandler(generateApiKeyButton, 'Are you sure? Click again', async () => {
            try {
                const response = await fetch('/api/admin/api-key/generate', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Genereren mislukt.');

                apiKeyInput.value = result.apiKey;
                apiKeyDisplayContainer.classList.remove('is-hidden');
                showNotification(result.message, 'success');
                updateApiKeyStatus();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
        });
    }

    if (revokeApiKeyButton) {
        addConfirmClickHandler(revokeApiKeyButton, 'Are you sure? Click again', async () => {
            try {
                const response = await fetch('/api/admin/api-key/revoke', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Revoke failed.');

                showNotification(result.message, 'success');
                apiKeyDisplayContainer.classList.add('is-hidden'); // Hide the key display after revoking
                apiKeyInput.value = '';
                updateApiKeyStatus();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
        });
    }

    if (copyApiKeyButton) {
        copyApiKeyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(apiKeyInput.value).then(() => {
                showNotification('API key copied to clipboard!', 'success');
            }, () => {
                showNotification('Copy failed.', 'error');
            });
        });
    }

    if (toggleApiKeyVisibilityButton) {
        toggleApiKeyVisibilityButton.addEventListener('click', () => {
            const icon = toggleApiKeyVisibilityButton.querySelector('i');
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                apiKeyInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // --- Initialization ---

    loadConfig();

    const debugCheckbox = document.getElementById('DEBUG');
    const debugAction = document.getElementById('debug-cache-action');

    if (debugCheckbox && debugAction) {
        debugCheckbox.addEventListener('change', () => {
            debugAction.classList.toggle('is-hidden', !debugCheckbox.checked);
        });
    }

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
        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = document.querySelector('button[type="submit"][form="config-form"]');
            if (!button) return;

            const buttonTextSpan = button.querySelector('span:last-child');
            const originalButtonText = buttonTextSpan.textContent;

            button.disabled = true;
            buttonTextSpan.textContent = 'Saving...';

            /**
             * Recursively creates a deep copy of an object, excluding any keys with a null value.
             * This prevents empty form fields from overwriting existing settings with null.
             * @param {object} obj The object to clean.
             * @returns {object} A new object with null values removed.
             */
            const cleanNulls = (obj) => {
                if (obj === null || typeof obj !== 'object') {
                    return obj;
                }

                if (Array.isArray(obj)) {
                    return obj.map(cleanNulls).filter(item => item !== null);
                }

                const newObj = {};
                for (const key in obj) {
                    if (obj[key] !== null) {
                        newObj[key] = cleanNulls(obj[key]);
                    }
                }
                return newObj;
            };

            try {
                // --- Validation ---
                const isPlexEnabled = document.getElementById('mediaServers[0].enabled').checked;
                if (isPlexEnabled) {
                    const selectedMovieLibs = getSelectedLibraries('movie');
                    const selectedShowLibs = getSelectedLibraries('show');

                    if (selectedMovieLibs.length === 0 && selectedShowLibs.length === 0) {
                        throw new Error('If the Plex server is enabled, you must select at least one movie or show library.');
                    }
                }

                // --- Numeric Field Validation ---
                const numericFieldIds = [
                    'transitionIntervalSeconds', 'backgroundRefreshMinutes',
                    'SERVER_PORT', 'rottenTomatoesMinimumScore', 'kenBurnsEffect.durationSeconds',
                    'mediaServers[0].movieCount', 'mediaServers[0].showCount'
                ];

                for (const id of numericFieldIds) {
                    const element = document.getElementById(id);
                    if (element && element.value.trim() !== '') {
                        // Use Number.isFinite to ensure the value is a valid, finite number.
                        // This correctly handles cases like "123a" which parseFloat would partially parse.
                        if (!Number.isFinite(Number(element.value))) {
                            const label = document.querySelector(`label[for="${id}"]`);
                            const fieldName = label ? label.textContent : id;
                            throw new Error(`The field "${fieldName}" must be a valid number.`);
                        }
                    }
                }

                // Helper to get form values and parse them
                const getValue = (id, type = 'string') => {
                    const element = document.getElementById(id);
                    if (!element) return null;

                    if (element.type === 'checkbox') {
                        return element.checked;
                    }

                    const value = element.value;
                    if (type === 'number') {
                        return value === '' ? null : parseFloat(value);
                    }
                    return value;
                };

                const newConfig = {
                    transitionIntervalSeconds: getValue('transitionIntervalSeconds', 'number'),
                    backgroundRefreshMinutes: getValue('backgroundRefreshMinutes', 'number'),
                    showClearLogo: getValue('showClearLogo'),
                    showRottenTomatoes: getValue('showRottenTomatoes'),
                    rottenTomatoesMinimumScore: getValue('rottenTomatoesMinimumScore', 'number'),
                    showPoster: getValue('showPoster'),
                    showMetadata: getValue('showMetadata'),
                    clockWidget: getValue('clockWidget'),
                    clockTimezone: getValue('clockTimezone'),
                    clockFormat: getValue('clockFormat'),
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
                        movieLibraryNames: getSelectedLibraries('movie'),
                        showLibraryNames: getSelectedLibraries('show'),
                        movieCount: getValue('mediaServers[0].movieCount', 'number'),
                        showCount: getValue('mediaServers[0].showCount', 'number')
                    }]
                };

                const newEnv = {
                    SERVER_PORT: getValue('SERVER_PORT'),
                    DEBUG: String(getValue('DEBUG')), // .env values must be strings
                    PLEX_HOSTNAME: getValue('mediaServers[0].hostname'),
                    PLEX_PORT: getValue('mediaServers[0].port'),
                };

                // Only include the token if the user has entered a new one.
                // This prevents overwriting the existing token with an empty string.
                const plexToken = getValue('mediaServers[0].token');
                if (plexToken) {
                    newEnv.PLEX_TOKEN = plexToken;
                }

                // Create a version of the config that doesn't include null values.
                const cleanedConfig = cleanNulls(newConfig);

                const response = await fetch('/api/admin/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ config: cleanedConfig, env: newEnv }),
                });

                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to save settings.');

                // Since PM2 watches config.json, saving settings will trigger a restart.
                // We provide feedback to the user and tell them to refresh.
                showNotification('Settings saved! The application is restarting. Please refresh the page in a few seconds.', 'success');

            } catch (error) {
                console.error('Failed to save config:', error);
                showNotification(`Error saving settings: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                buttonTextSpan.textContent = originalButtonText;
            }
        });
    }

    /**
     * Force-enables the refresh media button.
     * This is a workaround to enable it even if the connection test fails,
     * allowing users to trigger a refresh manually.
     */
    const changePasswordButton = document.getElementById('change-password-button');
    if (changePasswordButton) {
        addConfirmClickHandler(changePasswordButton, 'Change password?', async () => {
            setButtonState(changePasswordButton, 'loading', { text: 'Changing...' });
            const currentPasswordInput = document.getElementById('currentPassword');
            const newPasswordInput = document.getElementById('newPassword');
            const confirmPasswordInput = document.getElementById('confirmPassword');

            try {
                const data = {
                    currentPassword: currentPasswordInput.value,
                    newPassword: newPasswordInput.value,
                    confirmPassword: confirmPasswordInput.value
                };

                // Client-side validation
                if (!data.currentPassword || !data.newPassword || !data.confirmPassword) {
                    throw new Error('All password fields are required.');
                }
                if (data.newPassword !== data.confirmPassword) {
                    throw new Error('The new password and confirmation do not match.');
                }

                const response = await fetch('/api/admin/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to change password.');

                setButtonState(changePasswordButton, 'success', { text: 'Changed!' });
                showNotification('Password changed successfully!', 'success');
                if (currentPasswordInput) currentPasswordInput.value = '';
                if (newPasswordInput) newPasswordInput.value = '';
                if (confirmPasswordInput) confirmPasswordInput.value = '';
            } catch (error) {
                setButtonState(changePasswordButton, 'error', { text: 'Failed' });
                showNotification(`Error: ${error.message}`, 'error');
            } finally {
                // Revert button state after a short delay
                setTimeout(() => setButtonState(changePasswordButton, 'revert'), 3000);
            }
        });
    }

    /**
     * Manages the visual state of a button during an async operation.
     * Stores the original state in data attributes to easily revert.
     * @param {HTMLButtonElement} button The button element.
     * @param {'loading' | 'success' | 'error' | 'revert'} state The state to set.
     * @param {object} [options] Options for text and classes.
     * @param {string} [options.text] Text for the new state.
     * @param {string} [options.iconClass] FontAwesome class for the new state.
     * @param {string} [options.buttonClass] Bulma class for the new state (e.g., 'is-success').
     */
    function setButtonState(button, state, options = {}) {
        const buttonTextSpan = button.querySelector('span:last-child');
        const icon = button.querySelector('.icon i');

        // Store original state if not already stored
        if (!button.dataset.originalText) {
            button.dataset.originalText = buttonTextSpan.textContent;
            button.dataset.originalIconClass = icon.className;
            button.dataset.originalButtonClass = button.className;
        }

        switch (state) {
            case 'loading':
                button.disabled = true;
                buttonTextSpan.textContent = options.text || 'Working...';
                icon.className = options.iconClass || 'fas fa-spinner fa-spin';
                button.className = button.dataset.originalButtonClass;
                break;
            case 'success':
            case 'error':
                button.disabled = true; // Keep disabled until revert
                buttonTextSpan.textContent = options.text || (state === 'success' ? 'Success!' : 'Failed');
                icon.className = options.iconClass || (state === 'success' ? 'fas fa-check' : 'fas fa-exclamation-triangle');
                button.className = `${button.dataset.originalButtonClass} ${options.buttonClass || (state === 'success' ? 'is-success' : 'is-danger')}`;
                break;
            case 'revert':
                button.disabled = false;
                buttonTextSpan.textContent = button.dataset.originalText;
                icon.className = button.dataset.originalIconClass;
                button.className = button.dataset.originalButtonClass;
                break;
        }
    }

    const restartButton = document.getElementById('restart-app-button');
    if (restartButton) {
        addConfirmClickHandler(restartButton, 'Are you sure? Click again', async () => {
             setButtonState(restartButton, 'loading', { text: 'Restarting...' });
 
             const handleRestartInitiated = (message) => {
                 showNotification(message, 'success');
                 // After a short delay, update the UI to indicate the restart is done.
                 setTimeout(() => {
                     showNotification('Please refresh the page in a few seconds.', 'success');
                     setButtonState(restartButton, 'success', { text: 'Restart Complete' });
                     // The button remains disabled, forcing a page refresh to use it again.
                 }, 3000);
             };
 
             try {
                 const response = await fetch('/api/admin/restart-app', { method: 'POST' });
                 const result = await response.json();
 
                 if (!response.ok) {
                     // This will now catch genuine errors returned by the server before the restart is attempted.
                     throw new Error(result.error || 'Could not send restart command to the server.');
                 }
                 // The server now guarantees a response before restarting, so we can trust the result.
                 handleRestartInitiated(result.message);
             } catch (error) {
                 // Any error here is now a real error, not an expected one.
                 console.error('[Admin] Error during restart request:', error);
                 showNotification(`Error restarting: ${error.message}`, 'error');
                 setButtonState(restartButton, 'revert');
             }
        });
    }

    const refreshMediaButton = document.getElementById('refresh-media-button');
    if (refreshMediaButton) {
        refreshMediaButton.addEventListener('click', async () => {
            setButtonState(refreshMediaButton, 'loading', { text: 'Refreshing...' });

            console.log('[Admin Debug] "Refresh Media" button clicked. Preparing to call API endpoint.');

            try {
                console.log('[Admin Debug] Sending POST request to /api/admin/refresh-media');
                const response = await fetch('/api/admin/refresh-media', { method: 'POST' });

                if (!response.ok) {
                    console.error(`[Admin Debug] API call failed. Status: ${response.status} ${response.statusText}`);
                    let errorMsg = `HTTP error! Status: ${response.status}`;
                    try {
                        const errorResult = await response.json();
                        errorMsg = errorResult.error || errorMsg;
                    } catch (e) {
                        // Fallback if response is not JSON (e.g., HTML error page)
                        errorMsg = response.statusText || errorMsg;
                    }

                    if (response.status === 401) {
                        showNotification('Your session has expired. You will be redirected to the login page.', 'error');
                        setTimeout(() => window.location.href = '/admin/login', 2500);
                    }
                    throw new Error(errorMsg);
                }

                console.log('[Admin Debug] API call successful. Refreshing background.');
                const result = await response.json();
                showNotification(result.message, 'success');

                // Also refresh the admin background to show new items
                adminBgQueue = [];
                initializeAdminBackground();

            } catch (error) {
                console.error('[Admin] Error during media refresh:', error);
                showNotification(`Error refreshing: ${error.message}`, 'error');
            } finally {
                // Restore button state after a short delay to show completion
                setTimeout(() => {
                    setButtonState(refreshMediaButton, 'revert');
                }, 1000);
            }
        });
    }

    const clearCacheButton = document.getElementById('clear-cache-button');
    if (clearCacheButton) {
        addConfirmClickHandler(clearCacheButton, 'Are you sure? Click again', async () => {
            setButtonState(clearCacheButton, 'loading', { text: 'Clearing...' });
            try {
                const response = await fetch('/api/admin/clear-image-cache', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to clear cache.');
                showNotification(result.message, 'success');
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
            setTimeout(() => setButtonState(clearCacheButton, 'revert'), 2000);
        });
    }

    updateApiKeyStatus();

    // Preview functionality
    function initializePreview() {
        console.log('Initializing preview functionality...');
        const previewContainer = document.getElementById('preview-container');
        const previewFrame = document.getElementById('preview-frame');
        const previewContent = document.getElementById('preview-content');
        
        console.log('Preview elements found:', {
            previewContainer: !!previewContainer,
            previewFrame: !!previewFrame,
            previewContent: !!previewContent
        });
        
        if (!previewContainer || !previewFrame || !previewContent) {
            console.log('Preview elements not found - aborting initialization');
            return;
        }

        // Handle orientation radio buttons
        const orientationRadios = document.querySelectorAll('input[name="preview-orientation"]');
        orientationRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                updatePreviewOrientation();
            });
        });

        // Set up live updates for DISPLAY SETTINGS
        setupLivePreviewUpdates();

        // Start preview immediately and keep it always on
        startPreview();

        function startPreview() {
            console.log('Starting preview...');
            
            // Show preview frame and set initial orientation
            previewFrame.style.display = 'block';
            updatePreviewOrientation();
            
            // Load initial preview
            updatePreview();
            
            // Auto-refresh preview every 30 seconds to sync any other changes
            window.previewInterval = setInterval(() => {
                updatePreview();
            }, 30000);
            
            console.log('Preview started successfully');
        }

        // Hide loading overlay when content loads
        const previewOverlay = document.getElementById('preview-overlay');
        if (previewOverlay) {
            // Hide overlay after initial load
            setTimeout(() => {
                previewOverlay.style.display = 'none';
            }, 1000);
        }
    }

    function updatePreviewOrientation() {
        const previewFrame = document.getElementById('preview-frame');
        const orientationRadios = document.querySelectorAll('input[name="preview-orientation"]');
        
        if (!previewFrame) return;

        const selectedOrientation = Array.from(orientationRadios).find(radio => radio.checked)?.value;
        
        if (selectedOrientation === 'portrait') {
            // Cinema Mode (Portrait)
            previewFrame.className = 'preview-frame preview-cinema';
        } else {
            // PC Mode (Landscape) - default
            previewFrame.className = 'preview-frame preview-pc';
        }
    }

    function updatePreview() {
        console.log('Updating preview content...');
        
        const previewOverlay = document.getElementById('preview-overlay');
        const previewPoster = document.getElementById('preview-poster');
        const previewMetadata = document.getElementById('preview-metadata');
        const previewClock = document.getElementById('preview-clock');
        const previewClearlogo = document.getElementById('preview-clearlogo');
        const previewRtBadge = document.getElementById('preview-rt-badge');
        
        // Show loading overlay
        if (previewOverlay) {
            previewOverlay.style.display = 'flex';
        }

        // Fetch current config and generate preview
        Promise.all([
            fetch('/get-config', {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            }).then(r => r.json()),
            fetch('/get-media').then(r => r.json()) // Use the correct endpoint
        ]).then(([config, mediaData]) => {
            console.log('Preview data loaded successfully!');
            console.log('Config data:', config);
            console.log('Media data (first item):', Array.isArray(mediaData) ? mediaData[0] : mediaData);
            
            // Get first media item for preview (mediaData is an array)
            const poster = Array.isArray(mediaData) && mediaData.length > 0 ? mediaData[0] : null;
            
            if (poster) {
                console.log('Using poster data:', {
                    title: poster.title,
                    posterUrl: poster.posterUrl,
                    clearLogoUrl: poster.clearLogoUrl,
                    tagline: poster.tagline,
                    rottenTomatoes: poster.rottenTomatoes
                });
            } else {
                console.log('No poster data available, using mock data');
            }
            
            // Update preview based on config
            updatePreviewElements(config, poster, {
                previewPoster,
                previewMetadata, 
                previewClock,
                previewClearlogo,
                previewRtBadge
            });
            
            // Update orientation based on radio buttons
            updatePreviewOrientation();
            
            // Hide loading overlay
            if (previewOverlay) {
                previewOverlay.style.display = 'none';
            }
            
        }).catch(error => {
            console.error('Error updating preview:', error);
            
            // Show preview with mock data if API fails
            updatePreviewWithMockData({
                previewPoster,
                previewMetadata, 
                previewClock,
                previewClearlogo,
                previewRtBadge
            });
            
            // Hide loading overlay on error
            if (previewOverlay) {
                previewOverlay.style.display = 'none';
            }
        });
    }

    function updatePreviewElements(config, poster, elements) {
        const { previewPoster, previewMetadata, previewClock, previewClearlogo, previewRtBadge } = elements;
        
        // Show/hide poster
        if (config.showPoster && poster && previewPoster) {
            // Use the correct property name from the media API
            const posterUrl = poster.posterUrl || poster.posterPath || poster.poster || '';
            previewPoster.src = posterUrl;
            previewPoster.style.display = posterUrl ? 'block' : 'none';
            console.log('Showing poster:', posterUrl);
        } else if (previewPoster) {
            previewPoster.style.display = 'none';
            console.log('Hiding poster');
        }
        
        // Show/hide metadata
        if (config.showMetadata && poster && previewMetadata) {
            const title = poster.title || poster.name || 'Sample Movie';
            const tagline = poster.tagline || poster.summary || 'A great movie preview';
            previewMetadata.innerHTML = `
                <h3>${title}</h3>
                <p>${tagline}</p>
            `;
            previewMetadata.style.display = 'block';
            console.log('Showing metadata:', title);
        } else if (previewMetadata) {
            previewMetadata.style.display = 'none';
            console.log('Hiding metadata');
        }
        
        // Show/hide clock
        if (config.clockWidget && previewClock) {
            updatePreviewClock(config, previewClock);
            previewClock.style.display = 'block';
            console.log('Showing clock');
        } else if (previewClock) {
            previewClock.style.display = 'none';
            console.log('Hiding clock');
        }
        
        // Show/hide clear logo  
        if (config.showClearLogo && poster && previewClearlogo) {
            const logoUrl = poster.clearLogoUrl || poster.clearLogoPath || poster.clearLogo || '';
            const logoImg = previewClearlogo.querySelector('img');
            if (logoImg && logoUrl) {
                logoImg.src = logoUrl;
                previewClearlogo.style.display = 'block';
                console.log('Showing clear logo:', logoUrl);
            } else {
                previewClearlogo.style.display = 'none';
            }
        } else if (previewClearlogo) {
            previewClearlogo.style.display = 'none';
            console.log('Hiding clear logo');
        }
        
        // Show/hide RT badge
        if (config.showRottenTomatoes && poster && previewRtBadge) {
            const rtScore = poster.rottenTomatoes?.score || poster.rottenTomatoesScore || poster.rtScore || 0;
            if (rtScore > 0) {
                const badgeImg = previewRtBadge.querySelector('img');
                if (badgeImg) {
                    const isFresh = rtScore >= 60;
                    badgeImg.src = `/icons/rt-${isFresh ? 'certified-fresh' : 'rotten'}.svg`;
                    previewRtBadge.style.display = 'block';
                    console.log('Showing RT badge:', rtScore, isFresh ? 'fresh' : 'rotten');
                } else {
                    console.log('RT badge img element not found');
                }
            } else {
                previewRtBadge.style.display = 'none';
                console.log('No RT score available:', rtScore);
            }
        } else if (previewRtBadge) {
            previewRtBadge.style.display = 'none';
            console.log('Hiding RT badge - config disabled or no poster');
        }
    }

    function updatePreviewClock(config, previewClock) {
        const now = new Date();
        const timeFormat = config.clockFormat === '12h' ? 
            { hour12: true, hour: 'numeric', minute: '2-digit' } :
            { hour12: false, hour: '2-digit', minute: '2-digit' };
        
        const timeString = config.clockTimezone === 'auto' ?
            now.toLocaleTimeString([], timeFormat) :
            now.toLocaleTimeString([], { ...timeFormat, timeZone: config.clockTimezone });
            
        previewClock.textContent = timeString;
        
        // Update clock every second
        if (!window.previewClockInterval) {
            window.previewClockInterval = setInterval(() => {
                if (config.clockWidget && previewClock.style.display !== 'none') {
                    const now = new Date();
                    const timeString = config.clockTimezone === 'auto' ?
                        now.toLocaleTimeString([], timeFormat) :
                        now.toLocaleTimeString([], { ...timeFormat, timeZone: config.clockTimezone });
                    previewClock.textContent = timeString;
                }
            }, 1000);
        }
    }

    function updatePreviewWithMockData(elements) {
        const { previewPoster, previewMetadata, previewClock, previewClearlogo, previewRtBadge } = elements;
        
        // Show mock content if API fails
        console.log('Using mock data for preview');
        
        if (previewMetadata) {
            previewMetadata.innerHTML = `
                <h3>Sample Movie</h3>
                <p>This is a preview of how your screensaver will look</p>
            `;
            previewMetadata.style.display = 'block';
        }
        
        // Other elements will be hidden since we don't have poster data
        if (previewPoster) previewPoster.style.display = 'none';
        if (previewClearlogo) previewClearlogo.style.display = 'none';
        if (previewRtBadge) previewRtBadge.style.display = 'none';
    }

    function setupLivePreviewUpdates() {
        // Find all display-related form elements (using correct field names from HTML)
        const displayInputs = [
            'showClearLogo',
            'showRottenTomatoes', 
            'rottenTomatoesMinimumScore',
            'showPoster',
            'showMetadata',
            'clockWidget',
            'clockTimezone',
            'clockFormat',
            'cinemaMode'
        ];

        console.log('Setting up live preview updates for:', displayInputs);

        displayInputs.forEach(inputName => {
            const input = document.querySelector(`[name="${inputName}"]`);
            if (input) {
                console.log(`Found input: ${inputName}`, input.type);
                // Add event listeners for different input types
                if (input.type === 'checkbox' || input.type === 'radio') {
                    input.addEventListener('change', async () => {
                        console.log(`Display setting changed: ${inputName} = ${input.checked || input.value}`);
                        // Auto-save the configuration
                        await saveConfigurationSilently();
                        // Wait longer for config to be fully processed and cached
                        setTimeout(() => updatePreview(), 2000);
                    });
                } else {
                    // For text inputs, number inputs, selects
                    input.addEventListener('input', debounce(async () => {
                        console.log(`Display setting changed: ${inputName} = ${input.value}`);
                        // Auto-save the configuration
                        await saveConfigurationSilently();
                        setTimeout(() => updatePreview(), 2000);
                    }, 1000)); // Debounce for 1 second
                }
            } else {
                console.log(`Input not found: ${inputName}`);
            }
        });
    }

    // Save configuration without showing notifications and clear cache
    async function saveConfigurationSilently() {
        try {
            console.log('Auto-saving configuration for preview update...');
            
            // Get current config from server first to maintain structure
            const currentConfigResponse = await fetch('/api/admin/config');
            if (!currentConfigResponse.ok) {
                console.error('Failed to fetch current config for merge');
                return;
            }
            const currentData = await currentConfigResponse.json();
            
            // Create a deep copy of current config to modify
            const configData = JSON.parse(JSON.stringify(currentData.config));
            const envData = { ...currentData.env };
            
            // Only update the changed display field(s) while preserving nested structure
            const displayInputs = [
                'showClearLogo',
                'showRottenTomatoes', 
                'rottenTomatoesMinimumScore',
                'showPoster',
                'showMetadata',
                'clockWidget',
                'clockTimezone',
                'clockFormat'
            ];
            
            // Track what we're updating
            const updates = {};
            
            // Update only display-related fields from the form
            displayInputs.forEach(fieldName => {
                const input = document.querySelector(`[name="${fieldName}"]`);
                if (input) {
                    let newValue;
                    if (input.type === 'checkbox') {
                        newValue = input.checked;
                    } else if (input.type === 'number') {
                        newValue = parseFloat(input.value) || 0;
                    } else {
                        newValue = input.value;
                    }
                    
                    // Only update if value actually changed
                    if (configData[fieldName] !== newValue) {
                        configData[fieldName] = newValue;
                        updates[fieldName] = newValue;
                    }
                }
            });
            
            console.log('Config fields being updated:', updates);
            
            // Only save if there are actual changes
            if (Object.keys(updates).length === 0) {
                console.log('No config changes detected, skipping save');
                return;
            }
            
            const response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    config: configData,
                    env: envData
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('Configuration auto-saved successfully:', result);
            } else {
                const errorText = await response.text();
                console.error('Failed to auto-save configuration:', response.status, response.statusText, errorText);
            }
        } catch (error) {
            console.error('Error auto-saving configuration:', error);
        }
    }

    // Debounce function to prevent too many updates
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function triggerConfigChanged() {
        // Dispatch custom event when config is saved
        document.dispatchEvent(new CustomEvent('configChanged'));
    }

    // Initialize preview when DOM is ready
    setTimeout(() => {
        initializePreview();
    }, 100);

    // Modify the existing save config function to trigger preview update
    const originalSubmitHandler = document.querySelector('#config-form')?.onsubmit;
    const previewConfigForm = document.querySelector('#config-form');
    if (previewConfigForm && !previewConfigForm.dataset.previewHandlerAdded) {
        previewConfigForm.dataset.previewHandlerAdded = 'true';
        previewConfigForm.addEventListener('submit', (e) => {
            // Let the original handler run first
            setTimeout(() => {
                triggerConfigChanged();
            }, 1000); // Delay to ensure config is saved
        });
    }

});