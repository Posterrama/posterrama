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

    async function loadConfig() {
        try {
            const response = await fetch('/api/admin/config');
            if (!response.ok) {
                throw new Error('Could not load configuration from the server.');
            }
            const data = await response.json();
            const config = data.config || {};
            const env = data.env || {};

            let savedMovieLibs = [], savedShowLibs = [];

            // --- Populate General Settings ---
            document.getElementById('transitionIntervalSeconds').value = config.transitionIntervalSeconds ?? defaults.transitionIntervalSeconds;
            document.getElementById('backgroundRefreshMinutes').value = config.backgroundRefreshMinutes ?? defaults.backgroundRefreshMinutes;
            document.getElementById('SERVER_PORT').value = env.SERVER_PORT ?? defaults.SERVER_PORT;
            document.getElementById('DEBUG').checked = env.DEBUG === 'true' ?? defaults.DEBUG;

            const debugCheckbox = document.getElementById('DEBUG');
            const debugLink = document.getElementById('debug-link');
            if (debugLink) {
                debugLink.classList.toggle('is-hidden', !debugCheckbox.checked);
            }

            // --- Populate Display Settings ---
            document.getElementById('showClearLogo').checked = config.showClearLogo ?? defaults.showClearLogo;
            document.getElementById('showRottenTomatoes').checked = config.showRottenTomatoes ?? defaults.showRottenTomatoes;
            document.getElementById('rottenTomatoesMinimumScore').value = config.rottenTomatoesMinimumScore ?? defaults.rottenTomatoesMinimumScore;
            document.getElementById('showPoster').checked = config.showPoster ?? defaults.showPoster;
            document.getElementById('showMetadata').checked = config.showMetadata ?? defaults.showMetadata;
            document.getElementById('clockWidget').checked = config.clockWidget ?? defaults.clockWidget;
            document.getElementById('kenBurnsEffect.enabled').checked = get(config, 'kenBurnsEffect.enabled', defaults.kenBurnsEffect.enabled);
            document.getElementById('kenBurnsEffect.durationSeconds').value = get(config, 'kenBurnsEffect.durationSeconds', defaults.kenBurnsEffect.durationSeconds);

            load2FAStatus();

            // Logic for poster/metadata dependency
            const showPosterCheckbox = document.getElementById('showPoster');
            const showMetadataCheckbox = document.getElementById('showMetadata');

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

            syncMetadataState(); // Set initial state

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
            
            savedMovieLibs = plexServerConfig.movieLibraryNames || plexDefaults.movieLibraryNames;
            savedShowLibs = plexServerConfig.showLibraryNames || plexDefaults.showLibraryNames;

            document.getElementById('mediaServers[0].movieCount').value = plexServerConfig.movieCount ?? plexDefaults.movieCount;
            document.getElementById('mediaServers[0].showCount').value = plexServerConfig.showCount ?? plexDefaults.showCount;

            if (env.PLEX_HOSTNAME && env.PLEX_PORT && env.PLEX_TOKEN === true) {
                fetchAndDisplayPlexLibraries(savedMovieLibs, savedShowLibs);
                initializeAdminBackground();
            }

            // Forcefully remove focus from any element that the browser might have auto-focused.
            if (document.activeElement) document.activeElement.blur();

        } catch (error) {
            console.error('Failed to load config:', error);
            alert('Failed to load settings. Please try refreshing the page.');
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
        const tokenInput = document.getElementById('PLEX_TOKEN');
        if (!tokenInput) return;
 
        const testButton = document.createElement('button');
        testButton.type = 'button';
        testButton.className = 'button-primary test-button';
 
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
            const originalButtonClass = 'button-primary test-button';
 
            // Set loading state
            testButton.disabled = true;
            textSpan.textContent = 'Testen...';
            icon.className = 'fas fa-spinner fa-spin';
            testButton.className = originalButtonClass; // Revert to base style for loading
 
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
 
                finalMessage = 'Succes';
                finalIcon = 'fas fa-check';
                finalClass = 'is-success';

                // On success, fetch and display libraries, preserving current selections
                const currentMovieLibs = getSelectedLibraries('movie');
                const currentShowLibs = getSelectedLibraries('show');
                fetchAndDisplayPlexLibraries(currentMovieLibs, currentShowLibs);
                adminBgQueue = []; // Force a re-fetch of the media queue
                initializeAdminBackground();
            } catch (error) {
                finalMessage = 'Mislukt';
                finalIcon = 'fas fa-exclamation-triangle';
                finalClass = 'is-danger';
            }
 
            // Set final state (success or error)
            testButton.classList.add(finalClass);
            textSpan.textContent = finalMessage;
            icon.className = finalIcon;
 
            // Revert to original state after a delay
            setTimeout(() => {
                testButton.disabled = false;
                testButton.className = originalButtonClass;
                textSpan.textContent = originalText;
                icon.className = originalIconClass;
            }, 2500);
        });
    }

    /**
     * Fetches Plex libraries from the server and populates checkbox lists.
     * @param {string[]} preSelectedMovieLibs - Array of movie library names to pre-check.
     * @param {string[]} preSelectedShowLibs - Array of show library names to pre-check.
     */
    async function fetchAndDisplayPlexLibraries(preSelectedMovieLibs = [], preSelectedShowLibs = []) {
        const movieContainer = document.getElementById('movie-libraries-container');
        const showContainer = document.getElementById('show-libraries-container');

        movieContainer.innerHTML = '<small>Bibliotheken ophalen...</small>';
        showContainer.innerHTML = '<small>Bibliotheken ophalen...</small>';

        try {
            const hostname = document.getElementById('PLEX_HOSTNAME').value;
            const port = document.getElementById('PLEX_PORT').value;
            const token = document.getElementById('PLEX_TOKEN').value;

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
            if (!response.ok) throw new Error(result.error || 'Ophalen van bibliotheken mislukt.');

            const libraries = result.libraries || [];
            const movieLibraries = libraries.filter(lib => lib.type === 'movie');
            const showLibraries = libraries.filter(lib => lib.type === 'show');

            movieContainer.innerHTML = '';
            showContainer.innerHTML = '';

            if (movieLibraries.length === 0) {
                movieContainer.innerHTML = '<small>Geen filmbibliotheken gevonden.</small>';
            } else {
                movieLibraries.forEach(lib => {
                    const isChecked = preSelectedMovieLibs.includes(lib.name);
                    movieContainer.appendChild(createLibraryCheckbox(lib.name, 'movie', isChecked));
                });
            }

            if (showLibraries.length === 0) {
                showContainer.innerHTML = '<small>Geen seriebibliotheken gevonden.</small>';
            } else {
                showLibraries.forEach(lib => {
                    const isChecked = preSelectedShowLibs.includes(lib.name);
                    showContainer.appendChild(createLibraryCheckbox(lib.name, 'show', isChecked));
                });
            }

        } catch (error) {
            console.error('Failed to fetch Plex libraries:', error);
            const errorMessage = `<small class="error-text">Fout: ${error.message}</small>`;
            movieContainer.innerHTML = errorMessage;
            showContainer.innerHTML = errorMessage;
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

    function show2FAModal() {
        if (twoFaModal) twoFaModal.classList.remove('is-hidden');
    }

    function hide2FAModal() {
        if (twoFaModal) twoFaModal.classList.add('is-hidden');
        if (qrCodeContainer) qrCodeContainer.innerHTML = '';
        const tokenInput = document.getElementById('2fa-token');
        if (tokenInput) tokenInput.value = '';
    }

    function update2FAStatusText(isEnabled) {
        if (!twoFaStatusText) return;
        if (isEnabled) {
            twoFaStatusText.textContent = '2FA is momenteel ingeschakeld.';
            twoFaStatusText.className = 'status-text enabled';
        } else {
            twoFaStatusText.textContent = '2FA is momenteel uitgeschakeld.';
            twoFaStatusText.className = 'status-text disabled';
        }
    }

    async function handleEnable2FA() {
        try {
            const response = await fetch('/api/admin/2fa/generate', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Kon QR-code niet genereren.');

            qrCodeContainer.innerHTML = `<img src="${result.qrCodeDataUrl}" alt="QR Code">`;
            show2FAModal();
        } catch (error) {
            showNotification(`Fout bij inschakelen 2FA: ${error.message}`, 'error');
            twoFaCheckbox.checked = false;
        }
    }

    async function handleDisable2FA() {
        // Een simpele prompt wordt hier gebruikt voor de beknoptheid. Een modaal formulier is beter voor de UX.
        const password = prompt('Voer uw huidige wachtwoord in om het uitschakelen van 2FA te bevestigen:');
        if (password === null) { // Gebruiker klikte op annuleren
            twoFaCheckbox.checked = true; // Zet de checkbox terug
            return;
        }

        try {
            const response = await fetch('/api/admin/2fa/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Uitschakelen mislukt.');

            showNotification('2FA succesvol uitgeschakeld.', 'success');
            update2FAStatusText(false);
        } catch (error) {
            showNotification(`Fout bij uitschakelen 2FA: ${error.message}`, 'error');
            twoFaCheckbox.checked = true; // Zet de checkbox terug bij een fout
        }
    }

    async function load2FAStatus() {
        if (!twoFaCheckbox) return;
        try {
            const response = await fetch('/api/admin/2fa/status');
            if (!response.ok) throw new Error('Kon 2FA-status niet ophalen.');
            const data = await response.json();
            twoFaCheckbox.checked = data.enabled;
            update2FAStatusText(data.enabled);
        } catch (error) {
            console.error('Failed to load 2FA status:', error);
            if (twoFaStatusText) {
                twoFaStatusText.textContent = 'Kon status niet laden.';
                twoFaStatusText.className = 'status-text error-text';
            }
        }
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
                if (!response.ok) throw new Error(result.error || 'Verificatie mislukt.');

                hide2FAModal();
                showNotification('2FA succesvol ingeschakeld!', 'success');
                update2FAStatusText(true);
            } catch (error) {
                showNotification(`Fout: ${error.message}`, 'error');
                tokenInput.value = '';
                tokenInput.focus();
            }
        });
    }

    // --- Initialization ---

    loadConfig();

    const debugCheckbox = document.getElementById('DEBUG');
    const debugLink = document.getElementById('debug-link');

    if (debugCheckbox && debugLink) {
        debugCheckbox.addEventListener('change', () => {
            debugLink.classList.toggle('is-hidden', !debugCheckbox.checked);
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
        addPlexTestButton();

        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = event.target.querySelector('button[type="submit"]');
            const originalButtonText = button.textContent;
            button.disabled = true;
            button.textContent = 'Saving...';

            try {
                // --- Validation ---
                const isPlexEnabled = document.getElementById('mediaServers[0].enabled').checked;
                if (isPlexEnabled) {
                    const selectedMovieLibs = getSelectedLibraries('movie');
                    const selectedShowLibs = getSelectedLibraries('show');

                    if (selectedMovieLibs.length === 0 && selectedShowLibs.length === 0) {
                        throw new Error('Als de Plex-server is ingeschakeld, moet u ten minste één film- of seriebibliotheek selecteren.');
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
                            throw new Error(`Het veld "${fieldName}" moet een geldig getal zijn.`);
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

    const restartButton = document.getElementById('restart-app-button');
    if (restartButton) {
        restartButton.addEventListener('click', async () => {
            if (!confirm('Weet je zeker dat je de applicatie wilt herstarten? De pagina wordt hierdoor tijdelijk onbereikbaar.')) {
                return;
            }

            const buttonTextSpan = restartButton.querySelector('span:last-child');
            const originalText = buttonTextSpan.textContent;
            const icon = restartButton.querySelector('.icon i');
            const originalIconClass = icon.className;

            restartButton.disabled = true;
            buttonTextSpan.textContent = 'Herstarten...';
            icon.className = 'fas fa-spinner fa-spin';

            const handleRestartInitiated = (message) => {
                showNotification(message, 'success');
                // After a short delay, update the UI to indicate the restart is done.
                setTimeout(() => {
                    showNotification('Vernieuw de pagina over enkele seconden.', 'success');
                    buttonTextSpan.textContent = 'Herstart voltooid';
                    icon.className = 'fas fa-check';
                    // The button remains disabled, forcing a page refresh to use it again.
                }, 3000);
            };

            try {
                const response = await fetch('/api/admin/restart-app', { method: 'POST' });
                const result = await response.json();

                if (!response.ok) {
                    // This will now catch genuine errors returned by the server before the restart is attempted.
                    throw new Error(result.error || 'Kon het herstart-commando niet naar de server sturen.');
                }
                // The server now guarantees a response before restarting, so we can trust the result.
                handleRestartInitiated(result.message);
            } catch (error) {
                // Any error here is now a real error, not an expected one.
                console.error('[Admin] Error during restart request:', error);
                showNotification(`Fout bij herstarten: ${error.message}`, 'error');
                restartButton.disabled = false;
                buttonTextSpan.textContent = originalText;
                icon.className = originalIconClass;
            }
        });
    }
});