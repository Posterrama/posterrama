document.addEventListener('DOMContentLoaded', () => {

    // Sidebar functionality
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section-content');

    // Restore sidebar state from localStorage
    const savedSidebarState = localStorage.getItem('sidebarCollapsed');
    if (savedSidebarState === 'true') {
        sidebar.classList.add('collapsed');
    }

    // Toggle sidebar
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            // Save the new state to localStorage
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });
    }

    // Mobile overlay
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Quick Help shortcut: Press 'H' key
        if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Only activate if we're not typing in an input field
            const activeElement = document.activeElement;
            const isInputField = activeElement && (
                activeElement.tagName === 'INPUT' || 
                activeElement.tagName === 'TEXTAREA' || 
                activeElement.contentEditable === 'true'
            );
            
            if (!isInputField) {
                e.preventDefault();
                toggleHelpPanel();
            }
        }
    });

    // Navigation functionality
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetSection = item.dataset.section;
            
            // Update active nav item
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Update active section
            sections.forEach(section => section.classList.remove('active'));
            const targetElement = document.getElementById(`${targetSection}-section`);
            if (targetElement) {
                targetElement.classList.add('active');
            }
            
            // Update help content based on section
            updateHelpContent(targetSection);
        });
    });

    // Help content for different sections
    const helpContent = {
        general: {
            title: "General Settings Help",
            sections: [
                {
                    title: "Transition Interval",
                    content: "Controls how long each poster is displayed before switching to the next one. Set between 1-300 seconds. Shorter intervals create more dynamic displays, while longer intervals are better for reading metadata."
                },
                {
                    title: "Background Refresh",
                    content: "How often the system fetches new content from your media server. Set to 0 to disable automatic refresh. Regular refreshing ensures new content appears in the rotation."
                },
                {
                    title: "Application Port",
                    content: "The network port for the admin interface. Default is 4000. Changing this requires an application restart. Make sure the port isn't used by other applications."
                },
                {
                    title: "Debug Mode",
                    content: "Enables detailed logging for troubleshooting. Check the live logs to see debug information. Only enable when investigating issues as it can impact performance."
                }
            ]
        },
        display: {
            title: "Display Settings Help",
            sections: [
                {
                    title: "Visual Elements",
                    content: "Control which elements are visible on the screensaver: ClearLogo (movie/show logos), Rotten Tomatoes badges, posters, and metadata text."
                },
                {
                    title: "Clock Widget",
                    content: "Shows a customizable clock in the top-left corner. Choose timezone and format (12/24 hour). Uses IANA timezone identifiers for accuracy."
                },
                {
                    title: "UI Scaling",
                    content: "Adjust the size of different UI elements. Global scale affects everything at once, useful for different screen sizes and viewing distances."
                }
            ]
        },
        effects: {
            title: "Effects & Transitions Help",
            sections: [
                {
                    title: "Transition Effects",
                    content: "Ken Burns: Slow zoom and pan effect. Fade: Simple fade in/out transitions. Slide: Left/right sliding in cinema mode."
                },
                {
                    title: "Cinema Mode",
                    content: "Optimized for portrait displays. Shows fullscreen posters with header/footer areas. Can force specific orientation if device sensors aren't reliable."
                },
                {
                    title: "Effect Timing",
                    content: "Pause time controls the delay after an effect completes. Not applicable to Ken Burns effect which uses the full transition interval."
                }
            ]
        },
        media: {
            title: "Media Servers Help",
            sections: [
                {
                    title: "Plex Connection",
                    content: "Configure your Plex server hostname/IP, port (usually 32400), and authentication token. Test the connection before saving to ensure it works."
                },
                {
                    title: "Library Selection",
                    content: "Choose which Plex libraries to include. Movie and TV show libraries are handled separately. Test connection first to populate available libraries."
                },
                {
                    title: "Content Limits",
                    content: "Limit the number of movies and shows to prevent performance issues. Higher numbers may cause slower loading and increased memory usage."
                }
            ]
        },
        authentication: {
            title: "Authentication & Security Help",
            sections: [
                {
                    title: "Password Management",
                    content: "Change your admin password. Enter current password first for security. Choose a strong password to protect your admin interface."
                },
                {
                    title: "Two-Factor Authentication",
                    content: "Add an extra security layer with authenticator apps like Google Authenticator. Scan the QR code and enter the verification code to enable."
                },
                {
                    title: "API Access",
                    content: "Generate permanent API keys for external applications or scripts. Keys can be viewed, copied, or revoked as needed. Useful for Swagger API access."
                }
            ]
        },
        promobox: {
            title: "Promobox Site Help",
            sections: [
                {
                    title: "Public Site",
                    content: "Enable a public-facing screensaver site on port 4001 without admin access. Perfect for promotional displays or kiosks."
                },
                {
                    title: "Port Configuration",
                    content: "Choose a different port if 4001 is unavailable. Ensure the port isn't used by other applications and is accessible to your intended users."
                }
            ]
        },
        management: {
            title: "Application Management Help",
            sections: [
                {
                    title: "Cache Management",
                    content: "Clear image cache to free space or force re-download of images. Refresh media to update the content library from Plex immediately."
                },
                {
                    title: "Application Control",
                    content: "Restart the application when needed (required after port changes). Use with caution as it will disconnect all users temporarily."
                },
                {
                    title: "Debugging",
                    content: "View live logs for real-time troubleshooting. Debug cache view shows raw playlist data when debug mode is enabled."
                }
            ]
        },
        logs: {
            title: "Live Logs Help",
            sections: [
                {
                    title: "Log Monitoring",
                    content: "Real-time view of application logs. Different log levels (info, warn, error) are color-coded for easy identification of issues."
                },
                {
                    title: "Troubleshooting",
                    content: "Enable debug mode in General Settings for more detailed logging. Logs automatically scroll to show newest entries first."
                }
            ]
        }
    };

    // Function to update help content based on current section
    function updateHelpContent(section) {
        const helpTitle = document.getElementById('help-title');
        const helpContentDiv = document.getElementById('help-content');
        
        if (!helpTitle || !helpContentDiv) return;
        
        const content = helpContent[section];
        if (!content) return;
        
        helpTitle.textContent = content.title;
        
        helpContentDiv.innerHTML = content.sections.map(section => `
            <div class="help-section">
                <h4>${section.title}</h4>
                <p>${section.content}</p>
            </div>
        `).join('');
    }

    // Mobile responsive
    function handleResize() {
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('collapsed');
            if (sidebarToggle) {
                sidebarToggle.addEventListener('click', () => {
                    sidebar.classList.toggle('open');
                });
            }
        }
    }

    window.addEventListener('resize', handleResize);
    handleResize();

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
        cinemaMode: false,
        cinemaOrientation: 'auto',
        transitionEffect: 'kenburns',
        effectPauseTime: 2,
        uiScaling: {
            content: 100,
            clearlogo: 100,
            clock: 100,
            global: 100
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
        siteServer: {
            enabled: false,
            port: 4001
        },
        SERVER_PORT: 4000,
        DEBUG: false,
    };

    // --- Admin Background Slideshow State ---
    let adminBgQueue = [];
    let adminBgIndex = -1;
    let adminBgTimer = null;
    let activeAdminLayer = null;
    let inactiveAdminLayer = null;

    // --- Preview Slideshow State ---
    let previewMediaQueue = [];
    let previewMediaIndex = -1;
    let previewTimer = null;
    let currentPreviewConfig = null;
    let isCinemaMode = false;

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
        
        // Populate site server settings
        populateSiteServerSettings(config);
    }

    function populateSiteServerSettings(config, server = {}) {
        const siteServer = config.siteServer || {};
        const serverIP = server.ipAddress || 'localhost';
        const enabledCheckbox = document.getElementById('siteServer.enabled');
        const portInput = document.getElementById('siteServer.port');
        const portGroup = document.getElementById('siteServerPortGroup');
        const statusIndicator = document.getElementById('siteServerStatus');
        
        if (enabledCheckbox) {
            enabledCheckbox.checked = siteServer.enabled || false;
        }
        
        if (portInput) {
            portInput.value = siteServer.port || 4001;
        }
        
        // Show/hide port input based on enabled state
        if (portGroup) {
            portGroup.style.display = siteServer.enabled ? 'block' : 'none';
        }
        
        // Show/hide status indicator based on enabled state
        if (statusIndicator) {
            statusIndicator.style.display = siteServer.enabled ? 'block' : 'none';
            if (siteServer.enabled) {
                const port = siteServer.port || 4001;
                const statusLink = statusIndicator.querySelector('.status-link');
                if (statusLink) {
                    statusLink.href = `http://${serverIP}:${port}`;
                    statusLink.textContent = `http://${serverIP}:${port}`;
                }
            }
        }
        
        // Add event listener for site server checkbox
        if (enabledCheckbox) {
            enabledCheckbox.addEventListener('change', function() {
                const isEnabled = this.checked;
                if (portGroup) {
                    portGroup.style.display = isEnabled ? 'block' : 'none';
                }
                if (statusIndicator) {
                    statusIndicator.style.display = isEnabled ? 'block' : 'none';
                    if (isEnabled) {
                        const port = portInput ? (portInput.value || 4001) : 4001;
                        const statusLink = statusIndicator.querySelector('.status-link');
                        if (statusLink) {
                            statusLink.href = `http://${serverIP}:${port}`;
                            statusLink.textContent = `http://${serverIP}:${port}`;
                        }
                    }
                }
            });
        }
        
        // Add event listener for port input
        if (portInput && statusIndicator) {
            portInput.addEventListener('input', function() {
                const port = this.value || 4001;
                const statusLink = statusIndicator.querySelector('.status-link');
                if (statusLink) {
                    statusLink.href = `http://${serverIP}:${port}`;
                    statusLink.textContent = `http://${serverIP}:${port}`;
                }
            });
        }
    }

    // Setup real-time input validation
    function setupInputValidation() {
        // Add validation for numeric fields
        const numericFields = [
            { id: 'transitionIntervalSeconds', min: 1, max: 300, label: 'Transition Interval' },
            { id: 'backgroundRefreshMinutes', min: 0, max: 1440, label: 'Background Refresh' },
            { id: 'SERVER_PORT', min: 1024, max: 65535, label: 'Application Port' },
            { id: 'siteServer.port', min: 1024, max: 65535, label: 'Promobox Site Port' },
            { id: 'rottenTomatoesMinimumScore', min: 0, max: 10, label: 'Rotten Tomatoes Score' },
            { id: 'mediaServers[0].port', min: 1, max: 65535, label: 'Plex Port' },
            { id: 'mediaServers[0].movieCount', min: 1, max: 10000, label: 'Movie Count' },
            { id: 'mediaServers[0].showCount', min: 1, max: 10000, label: 'Show Count' },
            { id: 'effectPauseTime', min: 0, max: 10, label: 'Effect Pause Time' }
        ];

        numericFields.forEach(field => {
            const element = document.getElementById(field.id);
            if (element) {
                // Add input event listener for real-time validation
                element.addEventListener('input', function() {
                    validateNumericInput(element, field);
                });
                
                // Add blur event for more thorough validation
                element.addEventListener('blur', function() {
                    validateNumericInput(element, field);
                });
            }
        });

        // Add validation for password confirmation
        const newPasswordInput = document.getElementById('newPassword');
        const confirmPasswordInput = document.getElementById('confirmPassword');
        
        if (newPasswordInput && confirmPasswordInput) {
            const validatePasswords = () => {
                const newPassword = newPasswordInput.value;
                const confirmPassword = confirmPasswordInput.value;
                
                // Clear previous validation state
                confirmPasswordInput.setCustomValidity('');
                
                if (confirmPassword && newPassword !== confirmPassword) {
                    confirmPasswordInput.setCustomValidity('Passwords do not match');
                } else if (newPassword && newPassword.length < 6) {
                    newPasswordInput.setCustomValidity('Password must be at least 6 characters long');
                } else {
                    newPasswordInput.setCustomValidity('');
                }
            };
            
            newPasswordInput.addEventListener('input', validatePasswords);
            confirmPasswordInput.addEventListener('input', validatePasswords);
        }

        // Add validation for hostname/IP format
        const hostnameInput = document.getElementById('mediaServers[0].hostname');
        if (hostnameInput) {
            hostnameInput.addEventListener('input', function() {
                const value = this.value.trim();
                if (value && !/^[a-zA-Z0-9\.\-]+$/.test(value)) {
                    this.setCustomValidity('Hostname must contain only letters, numbers, dots, and hyphens');
                } else {
                    this.setCustomValidity('');
                }
            });
        }
    }

    function validateNumericInput(element, field) {
        const value = element.value.trim();
        
        // Clear previous validation state
        element.setCustomValidity('');
        
        if (value === '') {
            // Empty is allowed for most fields
            return;
        }
        
        const numValue = Number(value);
        
        if (!Number.isFinite(numValue)) {
            element.setCustomValidity(`${field.label} must be a valid number`);
            return;
        }
        
        if (field.min !== undefined && numValue < field.min) {
            element.setCustomValidity(`${field.label} must be at least ${field.min}`);
            return;
        }
        
        if (field.max !== undefined && numValue > field.max) {
            element.setCustomValidity(`${field.label} must be at most ${field.max}`);
            return;
        }
    }

    // Setup form change tracking for better UX
    function setupFormChangeTracking() {
        const configForm = document.getElementById('config-form');
        const statusMessage = document.getElementById('config-status');
        const saveButton = document.getElementById('save-config-button');
        let hasChanges = false;
        let originalFormData = null;

        if (!configForm || !statusMessage || !saveButton) return;

        // Capture original form state
        const captureFormState = () => {
            const formData = new FormData(configForm);
            const state = {};
            for (const [key, value] of formData.entries()) {
                state[key] = value;
            }
            // Also capture checkbox states
            configForm.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                state[checkbox.name] = checkbox.checked;
            });
            return state;
        };

        // Compare form states
        const formHasChanged = () => {
            if (!originalFormData) return false;
            const currentData = captureFormState();
            return JSON.stringify(originalFormData) !== JSON.stringify(currentData);
        };

        // Update status message
        const updateStatus = (message, className = '') => {
            statusMessage.textContent = message;
            statusMessage.className = `status-message ${className}`;
        };

        // Monitor form changes
        const handleFormChange = debounce(() => {
            if (formHasChanged()) {
                if (!hasChanges) {
                    hasChanges = true;
                    updateStatus('Unsaved changes detected', 'warning');
                    saveButton.classList.add('has-changes');
                }
            } else {
                if (hasChanges) {
                    hasChanges = false;
                    updateStatus('All changes saved', 'success');
                    saveButton.classList.remove('has-changes');
                }
            }
        }, 500);

        // Capture initial state after form is populated
        setTimeout(() => {
            originalFormData = captureFormState();
        }, 100);

        // Add event listeners
        configForm.addEventListener('input', handleFormChange);
        configForm.addEventListener('change', handleFormChange);

        // Reset state after successful save
        document.addEventListener('configSaved', () => {
            originalFormData = captureFormState();
            hasChanges = false;
            updateStatus('Configuration saved successfully', 'success');
            saveButton.classList.remove('has-changes');
        });

        // Show unsaved changes warning before page unload
        window.addEventListener('beforeunload', (e) => {
            if (hasChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });
    }

    // Setup keyboard shortcuts for improved accessibility
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+S or Cmd+S to save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                const saveButton = document.getElementById('save-config-button');
                if (saveButton && !saveButton.disabled) {
                    saveButton.click();
                }
            }
            
            // Ctrl+T or Cmd+T to test Plex connection
            if ((e.ctrlKey || e.metaKey) && e.key === 't') {
                e.preventDefault();
                const testButton = document.getElementById('test-plex-button');
                if (testButton && !testButton.disabled) {
                    testButton.click();
                }
            }
            
            // Escape to close modals
            if (e.key === 'Escape') {
                const modals = document.querySelectorAll('.modal:not(.is-hidden)');
                modals.forEach(modal => {
                    modal.classList.add('is-hidden');
                });
            }
        });
        
        // Add keyboard shortcuts help tooltip
        const saveButton = document.getElementById('save-config-button');
        if (saveButton) {
            saveButton.title = 'Save all settings (Ctrl+S)';
        }
        
        const testButton = document.getElementById('test-plex-button');
        if (testButton) {
            testButton.title = 'Test Plex connection (Ctrl+T)';
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
        
        // Handle backward compatibility: convert old kenBurnsEffect to new transitionEffect
        let transitionEffect = config.transitionEffect ?? defaults.transitionEffect;

        if (!transitionEffect && config.kenBurnsEffect) {
            transitionEffect = config.kenBurnsEffect.enabled ? 'kenburns' : 'none';
        }

        document.getElementById('transitionEffect').value = transitionEffect;
        document.getElementById('effectPauseTime').value = config.effectPauseTime ?? defaults.effectPauseTime;
        document.getElementById('cinemaMode').checked = config.cinemaMode ?? defaults.cinemaMode;
        document.getElementById('cinemaOrientation').value = config.cinemaOrientation ?? defaults.cinemaOrientation;
        
        // Set cinema mode state from config
        isCinemaMode = config.cinemaMode ?? defaults.cinemaMode;
        
        // Show/hide effect pause time based on transition effect
        toggleEffectPauseTime();
        
        // Show/hide cinema orientation settings based on cinema mode
        const cinemaOrientationGroup = document.getElementById('cinemaOrientationGroup');
        if (cinemaOrientationGroup) {
            cinemaOrientationGroup.style.display = isCinemaMode ? 'block' : 'none';
        }
        
        // Apply cinema mode settings (including Ken Burns dropdown handling)
        toggleCinemaModeSettings(isCinemaMode);
        
        // Set up real-time input validation
        setupInputValidation();
        
        // Set up form change tracking
        setupFormChangeTracking();
        
        // Set up keyboard shortcuts
        setupKeyboardShortcuts();
        
        // Show/hide display settings based on cinema mode
        toggleCinemaModeSettings(isCinemaMode);
        
        // Populate UI scaling settings
        populateUIScalingSettings(config, defaults);
        
        // Show/hide timezone settings based on clockWidget state
        toggleClockSettings();
    }

    function populateUIScalingSettings(config, defaults) {
        const scalingConfig = config.uiScaling || defaults.uiScaling;
        
        // Populate range sliders and their value displays
        const scalingFields = ['content', 'clearlogo', 'clock', 'global'];
        scalingFields.forEach(field => {
            const slider = document.getElementById(`uiScaling.${field}`);
            const valueDisplay = document.getElementById(`uiScaling.${field}-value`);
            
            if (slider && valueDisplay) {
                const value = scalingConfig[field] || defaults.uiScaling[field];
                slider.value = value;
                valueDisplay.textContent = `${value}%`;
                
                // Update slider background to show progress
                updateSliderBackground(slider);
                
                // Add event listener to update display in real-time
                slider.addEventListener('input', () => {
                    valueDisplay.textContent = `${slider.value}%`;
                    updateSliderBackground(slider);
                });
                
                // Add event listener for live preview updates
                slider.addEventListener('change', () => {
                    updatePreview();
                });
                
                // Add keyboard support for fine control
                slider.addEventListener('keydown', (e) => {
                    let currentValue = parseInt(slider.value);
                    let newValue = currentValue;
                    
                    switch(e.key) {
                        case 'ArrowLeft':
                        case 'ArrowDown':
                            newValue = Math.max(parseInt(slider.min), currentValue - 1);
                            break;
                        case 'ArrowRight':
                        case 'ArrowUp':
                            newValue = Math.min(parseInt(slider.max), currentValue + 1);
                            break;
                        case 'PageDown':
                            newValue = Math.max(parseInt(slider.min), currentValue - 10);
                            break;
                        case 'PageUp':
                            newValue = Math.min(parseInt(slider.max), currentValue + 10);
                            break;
                        case 'Home':
                            newValue = parseInt(slider.min);
                            break;
                        case 'End':
                            newValue = parseInt(slider.max);
                            break;
                        default:
                            return; // Don't prevent default for other keys
                    }
                    
                    if (newValue !== currentValue) {
                        e.preventDefault();
                        slider.value = newValue;
                        valueDisplay.textContent = `${newValue}%`;
                        updateSliderBackground(slider);
                        updatePreview();
                    }
                });
            }
        });

        // Function to update slider background based on value
        function updateSliderBackground(slider) {
            const value = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
            slider.style.background = `linear-gradient(to right, #bb86fc 0%, #bb86fc ${value}%, rgba(255, 255, 255, 0.1) ${value}%, rgba(255, 255, 255, 0.1) 100%)`;
        }

        // Setup reset button
        setupUIScalingResetButton();

        // Setup preset buttons
        setupUIScalingPresets();
    }

    function setupUIScalingResetButton() {
        const resetButton = document.getElementById('reset-ui-scaling');
        if (!resetButton) return;

        resetButton.addEventListener('click', async () => {
            // Visual feedback - disable button temporarily
            resetButton.disabled = true;
            resetButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
            
            // Reset all sliders to default values (100%)
            const scalingFields = ['content', 'clearlogo', 'clock', 'global'];
            
            scalingFields.forEach(field => {
                const slider = document.getElementById(`uiScaling.${field}`);
                const valueDisplay = document.getElementById(`uiScaling.${field}-value`);
                
                if (slider && valueDisplay) {
                    slider.value = 100;
                    valueDisplay.textContent = '100%';
                }
            });

            // Apply immediately to preview
            applyScalingToPreview();

            try {
                // Save the reset values
                await saveConfigurationSilently();
                
                // Show success notification
                showNotification('UI scaling reset to defaults', 'success');
                
                console.log('UI scaling reset to defaults');
            } catch (error) {
                console.error('Failed to save reset values:', error);
                showNotification('Failed to save reset values', 'error');
            } finally {
                // Restore button state
                setTimeout(() => {
                    resetButton.disabled = false;
                    resetButton.innerHTML = '<i class="fas fa-undo"></i> Reset to Defaults';
                }, 1000);
            }
        });
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

        // Setup transition effect change to toggle effect pause time visibility
        const transitionEffectSelect = document.getElementById('transitionEffect');
        if (transitionEffectSelect) {
            transitionEffectSelect.addEventListener('change', toggleEffectPauseTime);
        }

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
            const { config = {}, env = {}, security = {}, server = {} } = await response.json();

            populateGeneralSettings(config, env, defaults);
            populateDisplaySettings(config, defaults);
            setupDisplaySettingListeners();
            setupPreviewTimerListener();
            setupCinemaModeListeners();
            populateSecuritySettings(security);
            const { savedMovieLibs, savedShowLibs } = populatePlexSettings(config, env, defaults);

            // Pass server info to site server settings
            populateSiteServerSettings(config, server);

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
        console.log('Initializing admin background slideshow...');
        
        // Clear any existing timer
        if (adminBgTimer) {
            clearInterval(adminBgTimer);
            adminBgTimer = null;
        }

        // Initialize layers
        if (!activeAdminLayer) {
            activeAdminLayer = document.getElementById('admin-background-a');
            inactiveAdminLayer = document.getElementById('admin-background-b');
        }

        if (!activeAdminLayer || !inactiveAdminLayer) {
            console.warn('Admin background layers not found');
            return;
        }

        // Reset layers
        activeAdminLayer.style.opacity = 0;
        inactiveAdminLayer.style.opacity = 0;
        activeAdminLayer.style.backgroundImage = '';
        inactiveAdminLayer.style.backgroundImage = '';

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
                adminBgIndex = -1; // Start at -1 so first increment gives 0
            } catch (error) {
                console.warn('Failed to fetch admin background media:', error);
                return;
            }
        }

        console.log(`Starting slideshow with ${adminBgQueue.length} images`);
        
        // Show first image immediately
        changeAdminBackground();
        
        // Set up regular interval
        adminBgTimer = setInterval(changeAdminBackground, 30000); // Change every 30 seconds
    }

    /**
     * Changes the background image on the admin page with a fade effect.
     */
    function changeAdminBackground() {
        console.log('=== changeAdminBackground CALLED ===');
        
        if (adminBgQueue.length === 0 || !activeAdminLayer || !inactiveAdminLayer) {
            console.log('Admin background change skipped - missing elements or empty queue');
            console.log('Queue length:', adminBgQueue.length);
            console.log('Active layer:', activeAdminLayer);
            console.log('Inactive layer:', inactiveAdminLayer);
            return;
        }

        const oldIndex = adminBgIndex;
        adminBgIndex = (adminBgIndex + 1) % adminBgQueue.length;
        const currentItem = adminBgQueue[adminBgIndex];

        console.log(`Index changed from ${oldIndex} to ${adminBgIndex}`);
        console.log('Current item:', currentItem);

        if (!currentItem || !currentItem.backgroundUrl) {
            console.log('Admin background change skipped - invalid item');
            console.log('Current item:', currentItem);
            return;
        }

        console.log(`Changing admin background to: ${currentItem.title || 'Unknown'} (${adminBgIndex + 1}/${adminBgQueue.length})`);
        console.log('Background URL:', currentItem.backgroundUrl);

        // Log current layer states
        console.log('BEFORE transition:');
        console.log('Active layer opacity:', window.getComputedStyle(activeAdminLayer).opacity);
        console.log('Inactive layer opacity:', window.getComputedStyle(inactiveAdminLayer).opacity);
        console.log('Active layer background:', window.getComputedStyle(activeAdminLayer).backgroundImage);
        console.log('Inactive layer background:', window.getComputedStyle(inactiveAdminLayer).backgroundImage);

        const img = new Image();
        img.onload = () => {
            console.log('Image loaded successfully');
            
            // Set new image on inactive layer and make it visible
            inactiveAdminLayer.style.backgroundImage = `url('${currentItem.backgroundUrl}')`;
            inactiveAdminLayer.style.opacity = 0;
            
            console.log('Set background image on inactive layer, opacity set to 0');
            
            // Start fade transition immediately
            setTimeout(() => {
                console.log('Starting fade transition...');
                
                // Fade out current active layer
                activeAdminLayer.style.opacity = 0;
                // Fade in new layer
                inactiveAdminLayer.style.opacity = 0.7;
                
                console.log('Set transitions: active to 0, inactive to 0.7');
                
                // After transition, swap the layer references 
                // The inactive layer (which now has the new image and is visible) becomes active
                setTimeout(() => {
                    console.log('Swapping layer references...');
                    console.log('Before swap - active:', activeAdminLayer.id, 'inactive:', inactiveAdminLayer.id);
                    
                    const tempLayer = activeAdminLayer;
                    activeAdminLayer = inactiveAdminLayer;  // The one with the new image becomes active
                    inactiveAdminLayer = tempLayer;         // The old active becomes inactive
                    
                    // DO NOT clear the background image - keep it for debugging
                    // inactiveAdminLayer.style.backgroundImage = 'none';
                    
                    console.log('After swap - active:', activeAdminLayer.id, 'inactive:', inactiveAdminLayer.id);
                    console.log('Background transition completed');
                    
                    // Log final states
                    console.log('AFTER transition:');
                    console.log('Active layer opacity:', window.getComputedStyle(activeAdminLayer).opacity);
                    console.log('Inactive layer opacity:', window.getComputedStyle(inactiveAdminLayer).opacity);
                    console.log('Active layer background:', window.getComputedStyle(activeAdminLayer).backgroundImage);
                    console.log('Inactive layer background:', window.getComputedStyle(inactiveAdminLayer).backgroundImage);
                    
                }, 1100); // Wait a bit longer for CSS transition to complete
                
            }, 50); // Small delay to ensure image is set
        };
        
        img.onerror = () => {
            console.warn(`Failed to load admin background image: ${currentItem.backgroundUrl}`);
            // Try next image
            setTimeout(() => {
                console.log('Retrying with next image due to load error...');
                changeAdminBackground();
            }, 1000);
        };
        
        console.log('Loading image...');
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

    // Cleanup timers when page unloads
    window.addEventListener('beforeunload', () => {
        stopPreviewTimer();
        if (adminBgTimer) {
            clearInterval(adminBgTimer);
            adminBgTimer = null;
        }
    });

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
                    'SERVER_PORT', 'rottenTomatoesMinimumScore', 'effectPauseTime',
                    'mediaServers[0].movieCount', 'mediaServers[0].showCount',
                    'siteServer.port'
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
                        
                        // Additional range validation for specific fields
                        const value = Number(element.value);
                        if (id === 'transitionIntervalSeconds' && (value < 1 || value > 300)) {
                            throw new Error('Transition Interval must be between 1 and 300 seconds.');
                        }
                        if (id === 'backgroundRefreshMinutes' && (value < 0 || value > 1440)) {
                            throw new Error('Background Refresh must be between 0 and 1440 minutes (24 hours).');
                        }
                        if ((id === 'SERVER_PORT' || id === 'siteServer.port') && (value < 1024 || value > 65535)) {
                            throw new Error('Port numbers must be between 1024 and 65535.');
                        }
                        if (id === 'rottenTomatoesMinimumScore' && (value < 0 || value > 10)) {
                            throw new Error('Rotten Tomatoes score must be between 0 and 10.');
                        }
                        if ((id === 'mediaServers[0].movieCount' || id === 'mediaServers[0].showCount') && (value < 1 || value > 10000)) {
                            throw new Error('Movie/Show count must be between 1 and 10,000.');
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
                    cinemaMode: getValue('cinemaMode'),
                    cinemaOrientation: getValue('cinemaOrientation'),
                    transitionEffect: getValue('transitionEffect'),
                    effectPauseTime: getValue('effectPauseTime', 'number'),
                    uiScaling: {
                        content: getValue('uiScaling.content', 'number') || 100,
                        clearlogo: getValue('uiScaling.clearlogo', 'number') || 100,
                        clock: getValue('uiScaling.clock', 'number') || 100,
                        global: getValue('uiScaling.global', 'number') || 100
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
                    }],
                    siteServer: {
                        enabled: getValue('siteServer.enabled'),
                        port: getValue('siteServer.port', 'number') || 4001
                    }
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
                
                if (data.newPassword.length < 6) {
                    throw new Error('New password must be at least 6 characters long.');
                }
                
                if (data.newPassword !== data.confirmPassword) {
                    throw new Error('New password and confirmation do not match.');
                }
                
                if (data.currentPassword === data.newPassword) {
                    throw new Error('New password must be different from the current password.');
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

        // Set up PiP button functionality
        const pipButton = document.querySelector('.pip-button');
        if (pipButton) {
            pipButton.addEventListener('click', togglePiP);
            console.log('PiP button event listener added');
        } else {
            console.log('PiP button not found');
        }

        // Set up live updates for DISPLAY SETTINGS
        setupLivePreviewUpdates();

        // Start preview immediately and keep it always on
        startPreview();

        function startPreview() {
            console.log('Starting preview...');
            
            // Show preview container and frame
            previewContainer.style.display = 'block';
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
        
        if (!previewFrame) return;

        if (isCinemaMode) {
            // Cinema Mode (Portrait)
            previewFrame.className = 'preview-frame preview-cinema';
            
            // Apply cinema orientation if specified
            const cinemaOrientationSelect = document.getElementById('cinemaOrientation');
            if (cinemaOrientationSelect) {
                const orientation = cinemaOrientationSelect.value;
                
                // Remove existing orientation classes
                previewFrame.classList.remove('portrait-flipped');
                
                // Add specific orientation class
                if (orientation === 'portrait-flipped') {
                    previewFrame.classList.add('portrait-flipped');
                }
                // Note: 'auto' and 'portrait' don't need special classes (default state)
            }
        } else {
            // PC Mode (Landscape) - default
            previewFrame.className = 'preview-frame preview-pc';
        }
    }

    function updatePreview() {
        console.log('Updating preview content...');
        
        const previewOverlay = document.getElementById('preview-overlay');
        
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
            
            // Store config and media data for timer
            currentPreviewConfig = config;
            previewMediaQueue = Array.isArray(mediaData) ? mediaData : [];
            
            // Reset index for fresh random selection on each update
            previewMediaIndex = -1;
            
            // Get media item for preview
            let poster = null;
            if (previewMediaQueue.length > 0) {
                // Select random item
                previewMediaIndex = Math.floor(Math.random() * previewMediaQueue.length);
                poster = previewMediaQueue[previewMediaIndex];
            }
            
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
            updatePreviewElements(config, poster);
            
            // Apply scaling to preview
            applyScalingToPreview();
            
            // Update orientation based on radio buttons
            updatePreviewOrientation();
            
            // Start preview timer based on transition interval
            startPreviewTimer(config);
            
            // Hide loading overlay
            if (previewOverlay) {
                previewOverlay.style.display = 'none';
            }
            
        }).catch(error => {
            console.error('Error updating preview:', error);
            
            // Show preview with mock data if API fails
            updatePreviewWithMockData();
            
            // Hide loading overlay on error
            if (previewOverlay) {
                previewOverlay.style.display = 'none';
            }
        });
    }

    function startPreviewTimer(config) {
        // Clear existing timer
        if (previewTimer) {
            clearInterval(previewTimer);
            previewTimer = null;
        }

        // Only start timer if we have media and config
        if (previewMediaQueue.length > 1 && config && config.transitionIntervalSeconds) {
            const interval = config.transitionIntervalSeconds * 1000;
            console.log(`Starting preview timer with ${config.transitionIntervalSeconds}s interval`);
            
            previewTimer = setInterval(() => {
                changePreviewMedia();
            }, interval);
        }
    }

    function changePreviewMedia() {
        if (previewMediaQueue.length === 0) return;

        // Move to next media item
        previewMediaIndex = (previewMediaIndex + 1) % previewMediaQueue.length;
        const poster = previewMediaQueue[previewMediaIndex];

        console.log(`Preview switching to item ${previewMediaIndex + 1}/${previewMediaQueue.length}:`, poster.title);

        // Update preview elements with new media
        if (currentPreviewConfig && poster) {
            updatePreviewElements(currentPreviewConfig, poster);
        }
    }

    function stopPreviewTimer() {
        if (previewTimer) {
            clearInterval(previewTimer);
            previewTimer = null;
            console.log('Preview timer stopped');
        }
    }

    function updatePreviewElements(config, poster, elements) {
        if (isCinemaMode) {
            updateCinemaPreview(config, poster);
        } else {
            updateNormalPreview(config, poster);
        }
    }

    function updateCinemaPreview(config, poster) {
        const previewContent = document.getElementById('preview-content');
        
        if (!previewContent || !poster) return;

        // Clear existing content
        previewContent.innerHTML = '';

        // Create cinema layout
        const cinemaContainer = document.createElement('div');
        cinemaContainer.className = 'cinema-poster-container';

        // Header section
        const header = document.createElement('div');
        header.className = 'cinema-header';
        header.textContent = 'NOW SHOWING';

        // Poster container with ambilight effect
        const posterContainer = document.createElement('div');
        posterContainer.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
        `;

        // Ambilight background
        const ambilight = document.createElement('div');
        ambilight.className = 'cinema-ambilight';
        if (poster.posterUrl) {
            ambilight.style.backgroundImage = `url("${poster.posterUrl}")`;
        }

        // Main poster
        const posterImg = document.createElement('img');
        posterImg.className = 'cinema-poster';
        posterImg.src = poster.posterUrl || '';
        posterImg.alt = poster.title || 'Movie Poster';

        // Footer section
        const footer = document.createElement('div');
        footer.className = 'cinema-footer';
        footer.textContent = 'Premium Experience';

        // Assemble layout
        posterContainer.appendChild(ambilight);
        posterContainer.appendChild(posterImg);
        
        cinemaContainer.appendChild(header);
        cinemaContainer.appendChild(posterContainer);
        cinemaContainer.appendChild(footer);
        
        previewContent.appendChild(cinemaContainer);
    }

    function updateNormalPreview(config, poster) {
        const previewContent = document.getElementById('preview-content');
        
        // Ensure normal preview HTML structure exists
        if (!document.getElementById('preview-layer')) {
            restoreNormalPreviewStructure();
        }
        
        const previewLayer = document.getElementById('preview-layer');
        const previewInfoContainer = document.getElementById('preview-info-container');
        const previewPoster = document.getElementById('preview-poster');
        const previewMetadata = document.getElementById('preview-metadata');
        const previewClock = document.getElementById('preview-clock');
        const previewClearlogo = document.getElementById('preview-clearlogo');
        const previewRtBadge = document.getElementById('preview-rt-badge');
        const previewRtIcon = document.getElementById('preview-rt-icon');
        
        // Set background layer to poster image
        if (poster && poster.posterUrl && previewLayer) {
            previewLayer.style.backgroundImage = `url("${poster.posterUrl}")`;
        }
        
        // Show/hide info container based on poster setting
        if (config.showPoster && previewInfoContainer) {
            previewInfoContainer.classList.add('visible');
            
            // Show poster
            if (poster && previewPoster) {
                previewPoster.src = poster.posterUrl || poster.posterPath || poster.poster || '';
                previewPoster.style.display = 'block';
                console.log('Showing poster:', poster.posterUrl);
            } else if (previewPoster) {
                previewPoster.style.display = 'none';
            }
            
            // Show/hide metadata
            if (config.showMetadata && poster && previewMetadata) {
                const title = poster.title || poster.name || 'Sample Movie';
                const tagline = poster.tagline || poster.summary || 'A great movie preview';
                const year = poster.year || '';
                const rating = poster.rating || poster.contentRating || '';
                
                let metaInfo = '';
                if (year) metaInfo += year;
                if (rating && year) metaInfo += ` • ${rating}`;
                else if (rating) metaInfo += rating;
                
                previewMetadata.innerHTML = `
                    <h3>${title}</h3>
                    <p>${tagline}</p>
                    ${metaInfo ? `<div class="meta-info">${metaInfo}<span class="rating">8.5</span></div>` : ''}
                `;
                previewMetadata.style.display = 'block';
                console.log('Showing metadata:', title);
            } else if (previewMetadata) {
                previewMetadata.style.display = 'none';
                console.log('Hiding metadata');
            }
            
            // Show/hide RT badge
            if (config.showRottenTomatoes && poster && previewRtBadge && previewRtIcon) {
                const rtScore = poster.rottenTomatoes?.score || poster.rottenTomatoesScore || poster.rtScore || 0;
                if (rtScore >= (config.rottenTomatoesMinimumScore || 0)) {
                    const isFresh = rtScore >= 60;
                    previewRtIcon.src = `/icons/rt-${isFresh ? 'certified-fresh' : 'rotten'}.svg`;
                    previewRtBadge.classList.add('visible');
                    previewRtBadge.style.display = 'block';
                    console.log('Showing RT badge:', rtScore, isFresh ? 'fresh' : 'rotten');
                } else {
                    previewRtBadge.classList.remove('visible');
                    previewRtBadge.style.display = 'none';
                }
            } else if (previewRtBadge) {
                previewRtBadge.classList.remove('visible');
                previewRtBadge.style.display = 'none';
                console.log('Hiding RT badge');
            }
        } else if (previewInfoContainer) {
            previewInfoContainer.classList.remove('visible');
            console.log('Hiding poster container');
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
            if (logoUrl) {
                previewClearlogo.src = logoUrl;
                previewClearlogo.classList.add('visible');
                previewClearlogo.style.display = 'block';
                console.log('Showing clear logo:', logoUrl);
            } else {
                previewClearlogo.classList.remove('visible');
                previewClearlogo.style.display = 'none';
            }
        } else if (previewClearlogo) {
            previewClearlogo.classList.remove('visible');
            previewClearlogo.style.display = 'none';
            console.log('Hiding clear logo');
        }
    }

    function restoreNormalPreviewStructure() {
        const previewContent = document.getElementById('preview-content');
        if (!previewContent) return;

        // Clear any cinema mode content
        previewContent.innerHTML = `
            <!-- Background layer for posters -->
            <div class="preview-layer" id="preview-layer"></div>
            
            <!-- Widget container (clock) - top left -->
            <div class="preview-widget-container" id="preview-widget-container">
                <div class="preview-time-widget" id="preview-clock"></div>
            </div>
            
            <!-- Clearlogo container - top right -->
            <div class="preview-clearlogo-container" id="preview-clearlogo-container">
                <img id="preview-clearlogo" src="" alt="Clear Logo">
            </div>
            
            <!-- Info container - bottom left -->
            <div class="preview-info-container" id="preview-info-container">
                <div class="preview-poster-wrapper" id="preview-poster-wrapper">
                    <img id="preview-poster" src="" alt="Preview Poster">
                    <div class="preview-rt-badge" id="preview-rt-badge">
                        <img id="preview-rt-icon" src="" alt="Rotten Tomatoes">
                    </div>
                </div>
                <div class="preview-text-wrapper" id="preview-text-wrapper">
                    <div class="preview-metadata" id="preview-metadata"></div>
                </div>
            </div>
        `;
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
        const previewInfoContainer = document.getElementById('preview-info-container');
        const previewMetadata = document.getElementById('preview-metadata');
        const previewClock = document.getElementById('preview-clock');
        const previewClearlogo = document.getElementById('preview-clearlogo');
        const previewRtBadge = document.getElementById('preview-rt-badge');
        
        // Show mock content if API fails
        console.log('Using mock data for preview');
        
        if (previewInfoContainer) {
            previewInfoContainer.classList.add('visible');
        }
        
        if (previewMetadata) {
            previewMetadata.innerHTML = `
                <h3>Sample Movie</h3>
                <p>This is a preview of how your screensaver will look</p>
                <div class="meta-info">2024 • PG-13<span class="rating">8.5</span></div>
            `;
            previewMetadata.style.display = 'block';
        }
        
        // Hide elements that need poster data
        if (previewClearlogo) {
            previewClearlogo.classList.remove('visible');
            previewClearlogo.style.display = 'none';
        }
        if (previewRtBadge) {
            previewRtBadge.classList.remove('visible');
            previewRtBadge.style.display = 'none';
        }
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
            'cinemaMode',
            'cinemaOrientation'
        ];

        // Add UI scaling inputs
        const scalingInputs = [
            'uiScaling.content',
            'uiScaling.clearlogo', 
            'uiScaling.clock',
            'uiScaling.global'
        ];

        console.log('Setting up live preview updates for:', [...displayInputs, ...scalingInputs]);

        [...displayInputs, ...scalingInputs].forEach(inputName => {
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
                } else if (input.type === 'range') {
                    // For range sliders, update preview immediately without saving
                    input.addEventListener('input', () => {
                        applyScalingToPreview();
                    });
                    // Save when user stops dragging
                    input.addEventListener('change', async () => {
                        console.log(`Scaling setting changed: ${inputName} = ${input.value}`);
                        await saveConfigurationSilently();
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

    function setupPreviewTimerListener() {
        const transitionInput = document.getElementById('transitionIntervalSeconds');
        if (transitionInput) {
            transitionInput.addEventListener('input', debounce(() => {
                console.log('Transition interval changed, restarting preview timer');
                // If we have current config and media, restart timer with new interval
                if (currentPreviewConfig && previewMediaQueue.length > 0) {
                    // Update the config with new value
                    currentPreviewConfig.transitionIntervalSeconds = parseInt(transitionInput.value) || 15;
                    // Restart timer
                    startPreviewTimer(currentPreviewConfig);
                }
            }, 500)); // Debounce for half a second
        }
    }

    function setupCinemaModeListeners() {
        const cinemaModeCheckbox = document.getElementById('cinemaMode');
        const cinemaOrientationGroup = document.getElementById('cinemaOrientationGroup');
        const cinemaOrientationSelect = document.getElementById('cinemaOrientation');
        
        if (cinemaModeCheckbox) {
            cinemaModeCheckbox.addEventListener('change', () => {
                isCinemaMode = cinemaModeCheckbox.checked;
                
                // Show/hide orientation settings
                if (cinemaOrientationGroup) {
                    cinemaOrientationGroup.style.display = isCinemaMode ? 'block' : 'none';
                }
                
                // Show/hide irrelevant display settings for cinema mode
                toggleCinemaModeSettings(isCinemaMode);
                
                // Update preview orientation
                updatePreviewOrientation();
                
                console.log('Cinema mode toggled:', isCinemaMode ? 'enabled' : 'disabled');
            });
            
            // Set initial state on page load
            toggleCinemaModeSettings(cinemaModeCheckbox.checked);
        }
        
        // Add event listener for cinema orientation changes
        if (cinemaOrientationSelect) {
            cinemaOrientationSelect.addEventListener('change', () => {
                console.log('Cinema orientation changed:', cinemaOrientationSelect.value);
                updatePreviewOrientation();
            });
        }
    }

    function toggleCinemaModeSettings(isCinemaMode) {
        // Elements to hide in cinema mode (these are not applicable)
        const elementsToHide = [
            'showClearLogo',
            'showRottenTomatoes', 
            'rottenTomatoesMinimumScore',
            'showPoster',
            'showMetadata'
        ];
        
        // Hide/show individual form groups
        elementsToHide.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                const formGroup = element.closest('.form-group');
                if (formGroup) {
                    formGroup.style.display = isCinemaMode ? 'none' : 'block';
                }
            }
        });
        
        // Handle Ken Burns option in transition effects dropdown
        const transitionEffectSelect = document.getElementById('transitionEffect');
        if (transitionEffectSelect) {
            const kenBurnsOption = transitionEffectSelect.querySelector('option[value="kenburns"]');
            if (kenBurnsOption) {
                if (isCinemaMode) {
                    // Hide Ken Burns option and switch to fade if currently selected
                    kenBurnsOption.style.display = 'none';
                    if (transitionEffectSelect.value === 'kenburns') {
                        transitionEffectSelect.value = 'fade';
                        console.log('Cinema mode enabled: switched from Ken Burns to Fade effect');
                    }
                } else {
                    // Show Ken Burns option
                    kenBurnsOption.style.display = 'block';
                }
            }
        }
        
        // Hide entire UI Scaling section in cinema mode
        const uiScalingSection = document.querySelector('.form-section h3');
        if (uiScalingSection && uiScalingSection.textContent.includes('UI Element Scaling')) {
            const scalingSection = uiScalingSection.closest('.form-section');
            if (scalingSection) {
                scalingSection.style.display = isCinemaMode ? 'none' : 'block';
            }
        }
        
        // Add visual indication for cinema mode
        const displaySettingsHeaders = document.querySelectorAll('h2');
        let displaySettingsHeader = null;
        displaySettingsHeaders.forEach(header => {
            if (header.textContent.includes('Display Settings')) {
                displaySettingsHeader = header;
            }
        });
        
        if (displaySettingsHeader) {
            const existingIndicator = displaySettingsHeader.parentNode.querySelector('.cinema-mode-subtitle');
            
            if (isCinemaMode) {
                if (!existingIndicator) {
                    // Create subtitle element
                    const subtitle = document.createElement('div');
                    subtitle.className = 'cinema-mode-subtitle';
                    subtitle.textContent = 'Cinema Mode Active';
                    subtitle.style.cssText = `
                        color: #e28743;
                        font-size: 0.9em;
                        font-weight: 500;
                        margin-top: -8px;
                        margin-bottom: 16px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        opacity: 0.9;
                    `;
                    
                    // Insert after the h2 header
                    displaySettingsHeader.parentNode.insertBefore(subtitle, displaySettingsHeader.nextSibling);
                }
            } else {
                if (existingIndicator) {
                    existingIndicator.remove();
                }
            }
        }
    }

    function toggleEffectPauseTime() {
        const transitionEffectSelect = document.getElementById('transitionEffect');
        const effectPauseTimeElement = document.getElementById('effectPauseTime');
        
        if (transitionEffectSelect && effectPauseTimeElement) {
            const isKenBurns = transitionEffectSelect.value === 'kenburns';
            const formGroup = effectPauseTimeElement.closest('.form-group');
            
            if (formGroup) {
                formGroup.style.display = isKenBurns ? 'none' : 'block';
                console.log('Effect Pause Time visibility:', isKenBurns ? 'hidden' : 'visible', 'for effect:', transitionEffectSelect.value);
            }
        }
    }

    function applyScalingToPreview() {
        // Get current scaling values from sliders
        const contentScale = document.getElementById('uiScaling.content')?.value || 100;
        const clearlogoScale = document.getElementById('uiScaling.clearlogo')?.value || 100;
        const clockScale = document.getElementById('uiScaling.clock')?.value || 100;
        const globalScale = document.getElementById('uiScaling.global')?.value || 100;

        // Apply scaling to preview elements
        const previewPoster = document.getElementById('preview-poster');
        const previewMetadata = document.getElementById('preview-metadata');
        const previewClearlogo = document.getElementById('preview-clearlogo');
        const previewClock = document.getElementById('preview-clock');

        // Calculate combined scales (individual * global / 100)
        const finalContentScale = (contentScale * globalScale) / 100;
        const finalClearlogoScale = (clearlogoScale * globalScale) / 100;
        const finalClockScale = (clockScale * globalScale) / 100;

        // Apply transforms
        if (previewPoster) {
            previewPoster.style.transform = `scale(${finalContentScale / 100})`;
        }
        
        if (previewMetadata) {
            previewMetadata.style.transform = `scale(${finalContentScale / 100})`;
            previewMetadata.style.transformOrigin = 'bottom left';
        }
        
        if (previewClearlogo) {
            previewClearlogo.style.transform = `scale(${finalClearlogoScale / 100})`;
            previewClearlogo.style.transformOrigin = 'top right';
        }
        
        if (previewClock) {
            previewClock.style.transform = `scale(${finalClockScale / 100})`;
            previewClock.style.transformOrigin = 'top left';
        }

        console.log('Applied scaling to preview:', {
            content: finalContentScale,
            clearlogo: finalClearlogoScale,
            clock: finalClockScale
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
            
            // UI Scaling inputs
            const uiScalingInputs = [
                'uiScaling.content',
                'uiScaling.clearlogo',
                'uiScaling.clock',
                'uiScaling.global'
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
            
            // Handle UI scaling fields (nested structure)
            if (!configData.uiScaling) {
                configData.uiScaling = {};
            }
            
            uiScalingInputs.forEach(fieldPath => {
                const fieldName = fieldPath.split('.')[1]; // Get 'poster' from 'uiScaling.poster'
                const input = document.getElementById(fieldPath);
                if (input) {
                    const newValue = parseInt(input.value) || 100;
                    
                    // Only update if value actually changed
                    if (configData.uiScaling[fieldName] !== newValue) {
                        configData.uiScaling[fieldName] = newValue;
                        updates[fieldPath] = newValue;
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

    function setupUIScalingPresets() {
        // Define preset configurations
        const presets = {
            '4k-tv': {
                name: '4K TV',
                content: 150,
                clearlogo: 140,
                clock: 140,
                global: 100
            },
            'full-hd': {
                name: 'Full HD',
                content: 100,
                clearlogo: 100,
                clock: 100,
                global: 100
            },
            'ultrawide': {
                name: 'Ultrawide',
                content: 115,
                clearlogo: 120,
                clock: 110,
                global: 100
            }
        };

        // Setup click handlers for preset buttons
        const presetButtons = document.querySelectorAll('.preset-button');
        presetButtons.forEach(button => {
            button.addEventListener('click', async () => {
                const presetKey = button.dataset.preset;
                const preset = presets[presetKey];
                
                if (!preset) return;

                // Visual feedback
                button.disabled = true;
                const originalHTML = button.innerHTML;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';

                try {
                    // Apply preset values to sliders
                    Object.keys(preset).forEach(field => {
                        if (field === 'name') return;
                        
                        const slider = document.getElementById(`uiScaling.${field}`);
                        const valueDisplay = document.getElementById(`uiScaling.${field}-value`);
                        
                        if (slider && valueDisplay) {
                            slider.value = preset[field];
                            valueDisplay.textContent = `${preset[field]}%`;
                        }
                    });

                    // Apply immediately to preview
                    applyScalingToPreview();

                    // Save the preset values
                    await saveConfigurationSilently();
                    
                    // Show success notification
                    showNotification(`Applied ${preset.name} preset`, 'success');
                    
                    console.log(`Applied ${preset.name} preset:`, preset);
                } catch (error) {
                    console.error('Failed to apply preset:', error);
                    showNotification('Failed to apply preset', 'error');
                } finally {
                    // Restore button state
                    setTimeout(() => {
                        button.disabled = false;
                        button.innerHTML = originalHTML;
                    }, 1000);
                }
            });
        });

    // Toggle help panel
    function toggleHelpPanel() {
        const helpPanel = document.getElementById('quick-help-panel');
        if (helpPanel) {
            helpPanel.classList.toggle('open');
        }
    }

    // Make toggleHelpPanel globally available
    window.toggleHelpPanel = toggleHelpPanel;
    
    // Note: Admin background slideshow is now initialized from loadSettings() when Plex is configured
    }

// Initialize range slider value displays
const rangeInputs = document.querySelectorAll('input[type="range"]');
rangeInputs.forEach(input => {
    const valueDisplay = document.getElementById(input.id + '-value');
    if (valueDisplay) {
        // Update display on input
        input.addEventListener('input', () => {
            valueDisplay.textContent = input.value + '%';
        });
        // Initialize display
        valueDisplay.textContent = input.value + '%';
    }
});

});

// UI Scaling Template Functions
function applyScalingTemplate(template) {
    const templates = {
        fullhd: {
            poster: 100,
            text: 100,
            clearlogo: 100,
            clock: 100,
            global: 100
        },
        '4k': {
            poster: 150,
            text: 130,
            clearlogo: 140,
            clock: 120,
            global: 130
        },
        widescreen: {
            poster: 120,
            text: 110,
            clearlogo: 125,
            clock: 110,
            global: 115
        }
    };

    const values = templates[template];
    if (values) {
        Object.keys(values).forEach(key => {
            const input = document.getElementById(`uiScaling.${key}`);
            const valueDisplay = document.getElementById(`uiScaling.${key}-value`);
            
            if (input && valueDisplay) {
                input.value = values[key];
                valueDisplay.textContent = values[key] + '%';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }
}

function resetScalingToDefaults() {
    applyScalingTemplate('fullhd');
}

// Custom Number Input Controls
function incrementValue(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    const currentValue = parseInt(input.value) || 0;
    const step = parseInt(input.step) || 1;
    const max = parseInt(input.max);
    
    let newValue = currentValue + step;
    if (max && newValue > max) {
        newValue = max;
    }
    
    input.value = newValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function decrementValue(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    const currentValue = parseInt(input.value) || 0;
    const step = parseInt(input.step) || 1;
    const min = parseInt(input.min);
    
    let newValue = currentValue - step;
    if (min !== undefined && newValue < min) {
        newValue = min;
    }
    
    input.value = newValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Update preview scaling for PiP mode
function updatePreviewScaling() {
    const previewContainer = document.getElementById('preview-container');
    const previewContent = document.getElementById('preview-content');
    
    if (!previewContainer || !previewContent) {
        console.log('Preview elements not found for scaling');
        return;
    }
    
    if (!previewContainer.classList.contains('pip-mode')) {
        console.log('Not in PiP mode, skipping scaling');
        return;
    }
    
    // Get container dimensions
    const containerRect = previewContainer.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    console.log('Container dimensions:', containerWidth, 'x', containerHeight);
    
    // Target content dimensions based on mode
    const targetWidth = 1920;
    const targetHeight = 1080;
    
    // Calculate scale to fit content in container while maintaining aspect ratio
    const scaleX = containerWidth / targetWidth;
    const scaleY = containerHeight / targetHeight;
    const scale = Math.min(scaleX, scaleY);
    
    console.log('Calculated scale:', scale);
    
    // Apply scaling transform
    previewContent.style.transform = `scale(${scale})`;
    previewContent.style.transformOrigin = 'top left';
    
    // Set explicit dimensions for proper scaling
    previewContent.style.width = targetWidth + 'px';
    previewContent.style.height = targetHeight + 'px';
    
    console.log('Applied scaling to preview content');
}

// PiP (Picture-in-Picture) functionality
function togglePiP() {
    const previewContainer = document.getElementById('preview-container');
    const pipButton = document.querySelector('.pip-button');
    
    if (!previewContainer) {
        console.error('Preview container not found');
        return;
    }
    
    const isPiPMode = previewContainer.classList.contains('pip-mode');
    
    if (isPiPMode) {
        // Exit PiP mode
        previewContainer.classList.remove('pip-mode');
        previewContainer.style.position = '';
        previewContainer.style.top = '';
        previewContainer.style.left = '';
        previewContainer.style.width = '';
        previewContainer.style.height = '';
        previewContainer.style.zIndex = '';
        
        // Remove transform from content
        const previewContent = document.getElementById('preview-content');
        if (previewContent) {
            previewContent.style.transform = '';
            previewContent.style.width = '';
            previewContent.style.height = '';
        }
        
        // Update button
        if (pipButton) {
            pipButton.innerHTML = '<i class="fas fa-external-link-alt"></i>';
            pipButton.title = 'Open in Picture-in-Picture';
        }
        
        console.log('Exited PiP mode');
    } else {
        // Enter PiP mode
        previewContainer.classList.add('pip-mode');
        
        // Set PiP position and size
        previewContainer.style.position = 'fixed';
        previewContainer.style.top = '20px';
        previewContainer.style.right = '20px';
        previewContainer.style.width = '400px';
        previewContainer.style.height = '225px';
        previewContainer.style.zIndex = '9999';
        
        // Update button
        if (pipButton) {
            pipButton.innerHTML = '<i class="fas fa-compress"></i>';
            pipButton.title = 'Exit Picture-in-Picture';
        }
        
        // Apply scaling
        setTimeout(() => {
            updatePreviewScaling();
        }, 50);
        
        // Add drag functionality for PiP mode
        makeDraggable(previewContainer);
        
        console.log('Entered PiP mode');
    }
}

// Make PiP preview draggable
function makeDraggable(element) {
    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;
    
    element.style.cursor = 'move';
    
    element.addEventListener('mousedown', (e) => {
        if (!element.classList.contains('pip-mode')) return;
        
        isDragging = true;
        initialX = e.clientX - currentX;
        initialY = e.clientY - currentY;
        
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !element.classList.contains('pip-mode')) return;
        
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        
        // Keep within viewport bounds
        const rect = element.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;
        
        currentX = Math.max(0, Math.min(currentX, maxX));
        currentY = Math.max(0, Math.min(currentY, maxY));
        
        element.style.left = currentX + 'px';
        element.style.top = currentY + 'px';
        element.style.right = 'auto';
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Test function for checking preview scaling
window.testScaling = function() {
    console.log('=== TESTING PREVIEW SCALING ===');
    const previewContent = document.getElementById('preview-content');
    const previewContainer = document.getElementById('preview-container');
    
    if (previewContent && previewContainer) {
        // Ensure PiP mode is active
        previewContainer.classList.add('pip-mode');
        
        // Clear any existing content and set test content
        previewContent.innerHTML = `
            <div style="
                position: absolute;
                top: 0;
                left: 0;
                width: 1920px;
                height: 1080px;
                background: linear-gradient(45deg, red, blue, green, yellow);
                border: 20px solid white;
                z-index: 1;
                box-sizing: border-box;
            ">
                <div style="
                    position: absolute;
                    top: 50px;
                    left: 50px;
                    background: black;
                    color: white;
                    padding: 20px;
                    font-size: 72px;
                    font-weight: bold;
                ">SCALING TEST</div>
                
                <div style="
                    position: absolute;
                    top: 200px;
                    left: 50px;
                    background: rgba(255,255,255,0.9);
                    color: black;
                    padding: 20px;
                    font-size: 48px;
                ">1920x1080 Content</div>
                
                <div style="
                    position: absolute;
                    bottom: 50px;
                    right: 50px;
                    background: purple;
                    color: white;
                    padding: 20px;
                    font-size: 36px;
                ">Bottom Right</div>
            </div>
        `;
        
        // Force update scaling
        setTimeout(() => {
            updatePreviewScaling();
            console.log('✅ Scaling test applied - you should see colorful content scaled to fit the container');
            console.log('✅ If you see this content, the scaling system is working!');
        }, 100);
    } else {
        console.error('❌ Preview elements not found');
    }
};

// Debug function to check preview state
window.debugPreview = function() {
    console.log('=== PREVIEW DEBUG INFO ===');
    const previewContainer = document.getElementById('preview-container');
    const previewContent = document.getElementById('preview-content');
    const previewFrame = document.getElementById('preview-frame');
    
    if (previewContainer) {
        const rect = previewContainer.getBoundingClientRect();
        const styles = window.getComputedStyle(previewContainer);
        console.log('PREVIEW CONTAINER:');
        console.log('  Classes:', previewContainer.className);
        console.log('  Dimensions:', rect.width + 'x' + rect.height);
        console.log('  Position:', rect.left + ',' + rect.top);
        console.log('  Display:', styles.display);
        console.log('  Visibility:', styles.visibility);
        console.log('  Z-index:', styles.zIndex);
        console.log('  PiP mode:', previewContainer.classList.contains('pip-mode'));
    }
    
    if (previewContent) {
        const rect = previewContent.getBoundingClientRect();
        const styles = window.getComputedStyle(previewContent);
        console.log('PREVIEW CONTENT:');
        console.log('  Dimensions:', rect.width + 'x' + rect.height);
        console.log('  Transform:', styles.transform);
        console.log('  Overflow:', styles.overflow);
        console.log('  Background:', styles.background);
    }
    
    if (previewFrame) {
        console.log('PREVIEW FRAME:');
        console.log('  Display:', window.getComputedStyle(previewFrame).display);
    }
    
    console.log('=== END DEBUG INFO ===');
};
