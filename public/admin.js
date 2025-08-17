/*
 * Posterrama Admin Panel - Version 2.2.0
 * Date: 2025-08-14 
 * Scope: Cache stats functionality with clearer labeling.
 */

// Make version available globally (will be updated by server)
window.POSTERRAMA_VERSION = 'Loading...';

// Fetch current version immediately
fetch('/api/admin/version')
    .then(response => response.json())
    .then(data => {
        window.POSTERRAMA_VERSION = data.version || 'Unknown';
    })
    .catch(error => {
        window.POSTERRAMA_VERSION = 'Unknown';
    });

// Ensure all API calls use the current host
const API_BASE = window.location.origin;

// Helper function to create API URLs - always use current host
function apiUrl(path) {
    // Ensure path starts with /
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    
    // Always use the current host - no hardcoded URLs or special cases
    return API_BASE + path;
}

// Cache busting helper for API calls that should always be fresh
function apiUrlWithCacheBust(path) {
    const url = apiUrl(path);
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_t=${Date.now()}`;
}

// Helper for authenticated fetch calls with proper error handling
async function authenticatedFetch(url, options = {}) {
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            ...options.headers
        }
    };
    
    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        
        // Handle authentication errors
        if (response.status === 401) {
            window.location.href = '/admin/login';
            throw new Error('Authentication required');
        }
        
        return response;
    } catch (error) {
        console.error('🚨 Fetch error:', error.name, error.message);
        throw error;
    }
}

/**
 * Global setButtonState function - manages visual state of buttons during async operations
 * @param {HTMLButtonElement} button The button element
 * @param {'loading' | 'success' | 'error' | 'revert'} state The state to set
 * @param {object} [options] Options for text and classes
 */
window.setButtonState = function(button, state, options = {}) {
    if (!button) {
        console.warn('setButtonState: button is null or undefined');
        return;
    }
    
    const buttonTextSpan = button.querySelector('span:last-child');
    const icon = button.querySelector('.icon i');

    // Store original state if not already stored
    if (!button.dataset.originalText) {
        button.dataset.originalText = buttonTextSpan ? buttonTextSpan.textContent : button.textContent;
        button.dataset.originalIconClass = icon ? icon.className : '';
        button.dataset.originalButtonClass = button.className;
    }

    switch (state) {
        case 'loading':
            button.disabled = true;
            if (buttonTextSpan) {
                buttonTextSpan.textContent = options.text || 'Working...';
            } else {
                button.textContent = options.text || 'Working...';
            }
            if (icon) {
                icon.className = options.iconClass || 'fas fa-spinner fa-spin';
            }
            button.className = button.dataset.originalButtonClass;
            break;
        case 'success':
        case 'error':
            button.disabled = true;
            if (buttonTextSpan) {
                buttonTextSpan.textContent = options.text || (state === 'success' ? 'Success!' : 'Failed');
            } else {
                button.textContent = options.text || (state === 'success' ? 'Success!' : 'Failed');
            }
            if (icon) {
                icon.className = options.iconClass || (state === 'success' ? 'fas fa-check' : 'fas fa-times');
            }
            button.className = options.buttonClass || (state === 'success' ? 
                button.dataset.originalButtonClass.replace('is-primary', 'is-success') : 
                button.dataset.originalButtonClass.replace('is-primary', 'is-danger'));
            break;
        case 'revert':
            button.disabled = false;
            if (buttonTextSpan) {
                buttonTextSpan.textContent = button.dataset.originalText;
            } else {
                button.textContent = button.dataset.originalText;
            }
            if (icon) {
                icon.className = button.dataset.originalIconClass;
            }
            button.className = button.dataset.originalButtonClass;
            break;
    }
};

// Make it available as both global and local alias
const setButtonState = window.setButtonState;

// Global cache management functions for debugging
window.clearBrowserCache = function() {
    // Clear localStorage
    localStorage.clear();
    
    // Clear sessionStorage
    sessionStorage.clear();
    
    // Unregister service workers
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
                registration.unregister();
            }
        });
    }
    
    // Clear cache storage
    if ('caches' in window) {
        caches.keys().then(function(names) {
            names.forEach(function(name) {
                caches.delete(name);
            });
        });
    }
    
    return 'Cache cleared! Please refresh the page.';
};

window.hardRefresh = function() {
    window.location.reload(true);
};

// DEBUGGING: Force show modal function
window.forceShowModal = function() {
    const modal = document.getElementById('update-confirmation-modal');
    
    if (modal) {
        // Try all possible ways to show it
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
        modal.style.zIndex = '99999';
        modal.classList.remove('is-hidden');
        modal.classList.add('force-visible');
        
        // Add inline CSS as fallback
        modal.setAttribute('style', `
            display: flex !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            z-index: 999999 !important;
            background: rgba(0,0,0,0.8) !important;
            align-items: center !important;
            justify-content: center !important;
        `);
        
        const content = modal.querySelector('.modal-content');
        if (content) {
            content.innerHTML = '<h2 style="color: white;">TEST MODAL - IF YOU SEE THIS, MODAL WORKS!</h2>';
        }
        
        return 'Modal force shown';
    } else {
        return 'Modal not found';
    }
};
// DEBUGGING: Advanced modal debugging
window.debugModal = function() {
    const modal = document.getElementById('update-confirmation-modal');
    
    if (modal) {
        const computed = window.getComputedStyle(modal);
        const rect = modal.getBoundingClientRect();
        
        // Try to make it bright red and huge to see if it shows
        modal.style.background = 'red !important';
        modal.style.border = '10px solid yellow !important';
        
        return 'Advanced debugging complete';
    }
    
    return 'Modal not found';
};

// DEBUGGING: Force call displayIdleUpdateStatus directly
window.testUpdateStatus = function() {
    displayIdleUpdateStatus({ isUpdating: false });
    return 'Update status test initiated';
};

window.checkNetworkStatus = function() {
    return {
        currentDomain: window.location.hostname,
        apiBase: API_BASE
    };
};

// Debug function to test config save with different methods
window.testConfigSave = async function() {
    const testConfig = {
        transitionIntervalSeconds: 10,
        backgroundRefreshMinutes: 30,
        showMetadata: true,
        clockWidget: false,
        transitionEffect: "slide",
        effectPauseTime: 3,
        mediaServers: []
    };
    
    const testEnv = {
        DEBUG: "false"
    };
    
    try {
        const response1 = await authenticatedFetch(apiUrl('/api/admin/config'), {
            method: 'POST',
            body: JSON.stringify({ config: testConfig, env: testEnv })
        });
        return 'Test passed with normal method';
    } catch (error1) {
        
        try {
            const response2 = await fetch(apiUrl('/api/admin/config'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Connection': 'close',
                    'HTTP-Version': '1.1'
                },
                body: JSON.stringify({ config: testConfig, env: testEnv })
            });
            return 'Test passed with HTTP/1.1 fallback';
        } catch (error2) {
            return 'Both methods failed: ' + error2.message;
        }
    }
};

// Check authentication status
async function checkAuthStatus() {
    try {
        const response = await fetch(apiUrl('/api/admin/config'), {
            method: 'GET',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            window.location.href = '/admin/login';
            return false;
        } else if (response.ok) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('🚨 Auth check failed:', error);
        return false;
    }
}

/*
 * Key Changes (chronological/high-level):
 * - Fixed historical layout issue where only 'general' & 'display' sections rendered: introduced portal container to prevent hidden/collapsed content.
 * - Removed legacy preview / PiP code (dead / debug-only) reducing script size & noise.
 * - Unified admin font stack to Roboto (no changes to public/logs pages per request).
 * - Added lazy-loading for Media (Plex libraries + background slideshow) on first Media tab activation instead of upfront.
 * - Hardened keyboard shortcut (Help panel 'H') against undefined e.key (prevented toLowerCase TypeError).
 * - Cinema Mode improvements:
 *   - Eliminated duplicate toggleCinemaModeSettings invocations.
 *   - Preserves Ken Burns selection; temporarily swaps to fade while hidden and restores afterwards.
 * - Password change form: removed duplicate mismatch checks (now single clear validation path).
 * - Restart button UX: shows progress, completion, then re-enables after delay (no forced page refresh requirement).
 * - Background slideshow:
 *   - Logging drastically reduced; gated behind defaults.DEBUG flag (light heartbeat only otherwise).
 *   - Timer cleared when leaving Media section (prevents leaks / duplicate intervals).
 * - Auto-save mechanism:
 *   - Replaced fixed 200ms retry delay with microtask + requestAnimationFrame scheduling for responsiveness.
 *   - UI scaling auto-save no longer overwrites values with 100 when slider empty; ignores blank input.
 * - UI scaling manual submit logic: preserves explicit zero, uses defaults only when value truly absent.
 * - Added Ken Burns + cinema mode state memory & restoration semantics.
 * - Plex token security: replaced fragile placeholder text parsing with data-token-set attribute.
 * - Clean form submission sanitizer (cleanNulls) now also strips empty strings (prevents overwriting server config with '').
 * - Rotten Tomatoes badge logic clarified with inline comment; minimum score persists but only applied if badge enabled.
 * - General logging scrubs: background rotation & restart flow now concise; removed obsolete debug helpers & mutation observers.
 * - Memory / global hygiene: removed old preview globals, prevented accumulating timers, minimized window namespace surface.
 *
 * Outstanding / Future (not performed here):
 * - Potential modular split of this file (config, media, ui, helpers) for maintainability.
 * - Accessibility pass (ARIA roles, focus management, reduced motion preference for transitions).
 * - Design token centralization (colors, spacing, radii) for easier theming.
 * - Additional debounce/coalesce for rapid config slider changes (current approach acceptable but could batch network posts).
 *
 * NOTE: This comment block documents the refactor session; retain until next major version bump or migrate to CHANGELOG.
 */
// Simple help panel toggle - rebuilt from scratch with original styling
function toggleHelpPanel() {
    // Get current active section
    const activeNavItem = document.querySelector('.nav-item.active');
    const sectionName = activeNavItem ? activeNavItem.dataset.section : 'general';
    
    // Use existing help panel from HTML
    let helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        return;
    }
    
    // Toggle visibility using CSS classes
    helpPanel.classList.toggle('open');
    
    // Update content based on active section - do this AFTER opening
    if (helpPanel.classList.contains('open')) {
        updateHelpContent(sectionName);
    }
}

function updateHelpContent(sectionId) {
    const helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        return;
    }
    
    // Only update if the help panel is currently open/visible
    if (!helpPanel.classList.contains('open')) {
        return;
    }
    
    // Call the forced update function
    updateHelpContentForced(sectionId);
}

function updateRandomnessLabel(value) {
    const label = document.getElementById('wallartRandomnessValue');
    if (label) {
        label.textContent = value;
    }
}

function updateHelpContentForced(sectionId) {
    const helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        return;
    }
    
    // Map section names to section IDs for help content lookup
    const sectionMap = {
        'general': 'general-section',
        'display': 'display-section', 
        'media': 'media-section',
        'authentication': 'authentication-section',
        'promobox': 'promobox-section',
        'management': 'management-section',
        'logs': 'logs-section'
    };
    
    const mappedSectionId = sectionMap[sectionId] || 'general-section';
    
    const helpContent = getHelpContentForSection(mappedSectionId);
    
    const newHTML = `
        <div class="help-header">
            <h3>${helpContent.title}</h3>
            <button class="help-close btn btn-icon" onclick="toggleHelpPanel()" aria-label="Close help panel">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="help-content">
            ${helpContent.sections.map(section => `
                <div class="help-section">
                    <h4>${section.title}</h4>
                    <p>${section.description}</p>
                    ${section.details ? `<ul>${section.details.map(detail => `<li>${detail}</li>`).join('')}</ul>` : ''}
                </div>
            `).join('')}
        </div>
    `;
    
    helpPanel.innerHTML = newHTML;
}

function getHelpContentForSection(sectionId) {
    const helpContent = {
        'general-section': {
            title: '<i class="fas fa-cog"></i>&nbsp;&nbsp;General Settings',
            sections: [
                {
                    title: 'Transition Interval (seconds)',
                    description: 'How long each poster is displayed before switching to the next one.',
                    details: [
                        'Set between 1 and 300 seconds',
                        'Short intervals (1-5 sec): Dynamic slideshow for entertainment',
                        'Medium intervals (10-30 sec): Good balance between variety and readability',
                        'Long intervals (60+ sec): Calm display, ideal for reading information'
                    ]
                },
                {
                    title: 'Background Refresh (minutes)',
                    description: 'How often the system fetches new content from your content sources.',
                    details: [
                        'Set to 0 to disable automatic refresh',
                        'Recommended: 60-180 minutes for most users',
                        'Short intervals: New content appears faster, but more server load',
                        'Long intervals: Less server load, but new movies/shows appear later',
                        'Maximum: 1440 minutes (24 hours)'
                    ]
                },
                {
                    title: 'Application Port',
                    description: 'The port number on which the admin interface and screensaver are accessible.',
                    details: [
                        'Default port is usually 4000',
                        'Valid range: 1024-65535',
                        'Make sure the port is not used by other programs',
                        'Application restart required after change',
                        'Update your bookmarks after port change'
                    ]
                },
                {
                    title: 'Debug Mode',
                    description: 'Enable detailed logging for troubleshooting problems.',
                    details: [
                        'Shows extensive information in logs',
                        'Useful for diagnosing connection problems',
                        'May impact performance when enabled',
                        'Enable only when troubleshooting, then disable again',
                        'Check the logs section to view debug information'
                    ]
                }
            ]
        },
        'display-section': {
            title: '<i class="fas fa-tv"></i>&nbsp;&nbsp;Display Settings',
            sections: [
                {
                    title: 'Cinema Mode - Digital Movie Poster',
                    description: 'Transform your display into a professional Digital Movie Poster for theaters, lobbies, or home cinema.',
                    details: [
                        'Digital Movie Poster: Creates an immersive, professional poster display experience',
                        'Perfect for movie theaters, cinema lobbies, media rooms, or home theater setups',
                        'Automatically cycles through your movie collection with high-quality posters and metadata',
                        'Orientation options: Portrait (theater-style), Portrait-flipped, or Auto-detect',
                        'Removes UI elements for clean, uninterrupted poster presentation',
                        'Ideal for: Digital signage, theater displays, home cinema ambiance, or media showcases'
                    ]
                },
                {
                    title: 'Visual Elements',
                    description: 'Choose which visual elements to display on screen.',
                    details: [
                        'ClearLogo: Show high-quality transparent logos',
                        'Rotten Tomatoes Badge: Display critic ratings and badges',
                        'Show Poster: Display movie/TV show poster images',
                        'Show Metadata: Display titles, descriptions and other info'
                    ]
                },
                {
                    title: 'Content Quality Filtering',
                    description: 'Filter content based on rating quality.',
                    details: [
                        'Minimum Rotten Tomatoes Score (0-10): Only show movies/shows with RT ratings above this threshold',
                        'Setting applies only when Rotten Tomatoes badges are enabled',
                        'Lower values include more content, higher values show only highly-rated content'
                    ]
                },
                {
                    title: 'Clock Widget',
                    description: 'Display a clock on screen with timezone support.',
                    details: [
                        'Show Clock: Enable/disable the clock widget display',
                        'Timezone: Choose from auto-detect or specific timezones',
                        'Auto mode: Uses system timezone automatically',
                        'Manual: Select from common timezones worldwide (CET, EST, JST, etc.)'
                    ]
                },
                {
                    title: 'Effects & Transitions',
                    description: 'Configure visual effects and transitions between content.',
                    details: [
                        'Ken Burns: Slow zoom and pan effect on images',
                        'Fade In/Out: Smooth fading transitions between content',
                        'Slide Transition: Content slides in from different directions',
                        'Effect Pause Time: How long effects pause between transitions (0-10 seconds)'
                    ]
                },
                {
                    title: 'Scale Settings',
                    description: 'Adapt the interface to different screen sizes.',
                    details: [
                        'Full HD (1920x1080): Optimal for most TVs',
                        '4K (3840x2160): For large 4K screens and displays',
                        'Widescreen: For ultrawide monitors and projector screens',
                        'Custom: Manually adjust for specific setup'
                    ]
                }
            ]
        },
        'media-section': {
            title: '<i class="fas fa-database"></i>&nbsp;&nbsp;Content Sources',
            sections: [
                {
                    title: 'Plex Media Server',
                    description: 'Configure your local Plex server with hostname/IP, port (usually 32400), and authentication token.',
                    details: [
                        'Server URL: The IP address or domain name of your Plex server (e.g. http://192.168.1.100:32400)',
                        'Plex Token: Get your authentication token from <a href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/" target="_blank" rel="noopener">Plex Support</a>',
                        'Choose which libraries to include and test connection before saving',
                        'Enable as content source to include in rotation'
                    ]
                },
                {
                    title: 'TMDB External Source',
                    description: 'Use The Movie Database as an external content source.',
                    details: [
                        'Get a free API key from TMDB website (developers section)',
                        'Choose from many categories and enable advanced filtering by genre, year, and rating',
                        'API keys are securely stored and preserved when making other changes',
                        'Test connection validates your key and shows available genres'
                    ]
                },
                {
                    title: 'TMDB Categories & Configuration',
                    description: 'Extensive category options and multi-select genre filtering.',
                    details: [
                        '🎬 Movies: Popular, Top Rated, Now Playing, Upcoming, Latest, Trending Daily/Weekly',
                        '📺 TV: Popular Shows, Top Rated, Currently Airing, Airing Today, Latest, Trending Daily/Weekly',
                        '🔍 Discover: Advanced filtering with all options combined',
                        'Select multiple genres using the dropdown or clear all selections with the clear button'
                    ]
                },
                {
                    title: 'TVDB External Source',
                    description: 'Use The TV Database as an external content source.',
                    details: [
                        'No API key required - TVDB integration works out of the box for all users',
                        'Comprehensive database of TV shows, movies, and metadata',
                        'Professional artwork and high-quality background images',
                        'Test connection validates TVDB API access and shows sample data'
                    ]
                },
                {
                    title: 'TVDB Categories & Configuration',
                    description: 'Wide variety of sorting and discovery options.',
                    details: [
                        '🏆 By Rating: Top Rated (highest ratings), Most Popular (popularity scores)',
                        '📅 By Date: Recently Updated, Newest Releases, Classic Content',
                        '📊 By Activity: Trending Now, Recently Added to TVDB',
                        '🔤 Alphabetical: A-Z sorted content for easy browsing',
                        'Genre filtering with multi-select support and clear selection button'
                    ]
                },
                {
                    title: 'Content Filtering & Limits',
                    description: 'Filter content and set performance limits.',
                    details: [
                        'Filter by rating, genre, quality, or recently added date',
                        'Plex filters use your server metadata while TMDB and TVDB use their rating and year filters',
                        'Genre filtering supports multi-select for all sources (Plex, TMDB, TVDB)',
                        'Set reasonable limits for movies and shows to maintain good performance',
                        'TMDB has daily API limits, so moderate requests',
                        'TVDB has no API key limitations but respects reasonable request limits'
                    ]
                }
            ]
        },
        'authentication-section': {
            title: '<i class="fas fa-shield-alt"></i>&nbsp;&nbsp;Authentication & Security',
            sections: [
                {
                    title: 'Admin Password',
                    description: 'Manage the password for access to this admin interface.',
                    details: [
                        'Use a strong password with at least 8 characters',
                        'Combine uppercase, lowercase, numbers and symbols',
                        'Change the password regularly for optimal security',
                        'Store the password in a safe place'
                    ]
                },
                {
                    title: 'Two-Factor Authentication (2FA)',
                    description: 'Extra security layer with an authentication app on your phone.',
                    details: [
                        'Requires an authentication app like Google Authenticator or Authy',
                        'Scan the QR code with your authentication app during setup',
                        'Enter the 6-digit code from your app at each login',
                        'Save the backup codes in a safe place',
                        'Recommended for all admin accounts'
                    ]
                },
                {
                    title: 'API Keys',
                    description: 'Manage access for external applications and integrations.',
                    details: [
                        'Generate API keys to allow external applications to access Posterrama',
                        'Each API key provides programmatic access to the service',
                        'Revoke unused API keys for security'
                    ]
                }
            ]
        },
        'promobox-section': {
            title: '<i class="fas fa-globe"></i>&nbsp;&nbsp;Promobox Site',
            sections: [
                {
                    title: 'Promobox Website',
                    description: 'Enable an additional web server that serves the Posterrama promotional website.',
                    details: [
                        'Starts a separate web server for promotional content',
                        'Configure port and enable/disable the service',
                        'Useful for showcasing Posterrama to visitors'
                    ]
                }
            ]
        },
        'management-section': {
            title: '<i class="fas fa-tools"></i>&nbsp;&nbsp;Management & Tools',
            sections: [
                {
                    title: 'Cache Management',
                    description: 'Manage stored data to optimize performance.',
                    details: [
                        'View cache: See which images and data are stored',
                        'Clear cache: Remove all stored data to fix problems',
                        'Automatic cleanup: Old cache files are automatically removed',
                        'Cache size: Monitor how much disk space is used'
                    ]
                },
                {
                    title: 'Application Controls',
                    description: 'Manage the Posterrama application and system status.',
                    details: [
                        'Restart application: Fix problems by restarting the app',
                        'Status check: See if all systems are functioning correctly',
                        'Update check: Check for new versions of Posterrama',
                        'Performance monitoring: View CPU and memory usage'
                    ]
                }
            ]
        },
        'logs-section': {
            title: '<i class="fas fa-file-alt"></i>&nbsp;&nbsp;Logs & Debug',
            sections: [
                {
                    title: 'Log Monitoring',
                    description: 'View real-time system activity and messages.',
                    details: [
                        'Live Logs: View real-time system messages and activity as they happen',
                        'Monitor application status, errors, and performance information',
                        'Useful for troubleshooting connection issues and system problems'
                    ]
                }
            ]
        }
    };
    
    return helpContent[sectionId] || helpContent['general-section'];
}
// Expose globally
window.toggleHelpPanel = toggleHelpPanel;

document.addEventListener('DOMContentLoaded', () => {
    // Add event listener to help button as backup
    const helpButton = document.getElementById('toggle-help-panel');
    if (helpButton) {
        helpButton.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent any default behavior
            // Use the EXACT same call as the 'H' key
            if (window.toggleHelpPanel) {
                window.toggleHelpPanel();
            }
        });
    }
    
    // Register Service Worker for caching
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                // Service worker registered successfully
            })
            .catch((error) => {
                // Service worker registration failed
            });
    }
    
    // Performance monitoring
    if ('performance' in window) {
        window.addEventListener('load', () => {
            const perfData = performance.getEntriesByType('navigation')[0];
            // Performance data collected but not logged in production
        });
    }
    
    // Global runtime error capture overlay (diagnostic aid)
    (function installGlobalErrorHandler(){
        if (window.__ADMIN_ERROR_HANDLER_INSTALLED) return; window.__ADMIN_ERROR_HANDLER_INSTALLED=true;
        function showRuntimeError(title, msg){
            let box = document.getElementById('admin-runtime-error-box');
            if(!box){
                box=document.createElement('div');
                box.id='admin-runtime-error-box';
                box.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);max-width:860px;width:90%;background:#300;border:2px solid #f33;color:#fff;font:12px monospace;z-index:70000;padding:10px;white-space:pre-wrap;overflow:auto;max-height:70vh;';
                document.body.appendChild(box);
            }
            const ts=new Date().toISOString();
            box.innerHTML = `[${ts}] ${title}\n${msg}\n` + box.innerHTML;
        }
        window.addEventListener('error', e=>{
            showRuntimeError('JS Error', `${e.message}\nSource:${e.filename}:${e.lineno}:${e.colno}`);
        });
        window.addEventListener('unhandledrejection', e=>{
            showRuntimeError('Unhandled Promise Rejection', String(e.reason && e.reason.stack || e.reason));
        });
        window.__showRuntimeError = showRuntimeError;
    })();
    // (Removed old sentinel overlay & transient debug badges)
    // Sidebar functionality
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const navItems = document.querySelectorAll('.nav-item');
    let sections = document.querySelectorAll('.section-content');

    const expectedSectionKeys = ['general','display','media','authentication','promobox','management','logs'];

    // Mobile detection and initialization
    function isMobile() {
        return window.innerWidth <= 768;
    }

    // Initialize mobile state
    function initializeMobileState() {
        if (isMobile()) {
            // On mobile, sidebar should ALWAYS be collapsed by default
            sidebar.classList.add('collapsed');
            sidebar.classList.remove('mobile-open');
            // Remove any saved state that might override this on mobile
            if (localStorage.getItem('sidebarCollapsed')) {
                localStorage.removeItem('sidebarCollapsed');
            }
            
            // PHYSICALLY remove ALL desktop sidebar toggles on mobile (more aggressive)
            const desktopToggle = document.getElementById('sidebar-toggle');
            if (desktopToggle) {
                desktopToggle.remove();
            }
            
            // Remove any remaining desktop toggles (BUT NOT the help button!)
            const allDesktopToggles = document.querySelectorAll('.sidebar-toggle, .sidebar-header button, #sidebar-toggle, button[class*="toggle"]:not(#toggle-help-panel)');
            allDesktopToggles.forEach((toggle, index) => {
                // Double check we're not removing the help button
                if (toggle.id !== 'toggle-help-panel') {
                    toggle.remove();
                }
            });
            
            // Remove the entire sidebar header to prevent any lingering event handlers
            const sidebarHeader = document.querySelector('.sidebar-header');
            if (sidebarHeader) {
                sidebarHeader.remove();
            }
            
            // REMOVED: Mobile menu button creation
            // We no longer create a hamburger menu on mobile
            // The sidebar is completely hidden on mobile via CSS and HTML changes
            
        } else {
            // Remove mobile menu button on desktop (cleanup)
            const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
            if (mobileMenuBtn) {
                mobileMenuBtn.remove();
            }
        }
    }

    // Handle window resize
    function handleResize() {
        const wasMobile = false; // No mobile menu anymore
        const nowMobile = isMobile();
        
        if (wasMobile !== nowMobile) {
            if (nowMobile) {
                // Switching to mobile - remove desktop toggle
                const desktopToggle = document.getElementById('sidebar-toggle');
                if (desktopToggle) {
                    desktopToggle.remove();
                }
                
                // Remove all desktop sidebar toggles
                const allDesktopToggles = document.querySelectorAll('.sidebar-toggle');
                allDesktopToggles.forEach(toggle => {
                    toggle.remove();
                });
            }
            
            initializeMobileState();
        }
    }

    // Initialize mobile state on load
    initializeMobileState();
    
    // Listen for window resize
    window.addEventListener('resize', handleResize);

    function ensureAllSectionsPresent() {
        sections = document.querySelectorAll('.section-content');
        const presentIds = Array.from(sections).map(s=>s.id);
        const missing = expectedSectionKeys.filter(key=>!presentIds.includes(`${key}-section`));
        if (missing.length) {
            console.warn('[ADMIN] Missing section DOM nodes detected, creating placeholders for:', missing);
            const form = document.getElementById('config-form');
            if (form) {
                missing.forEach(key => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'section-content';
                    wrapper.id = `${key}-section`;
                    wrapper.innerHTML = `\n<div class="section-main-content">\n  <div class="section-title">${key.charAt(0).toUpperCase()+key.slice(1)} (placeholder injected)</div>\n  <div class="form-section">\n    <p style="padding:8px 4px;margin:0;color:#fff;font-family:monospace;font-size:14px;">Original HTML for this section was not delivered by the server. Placeholder injected client-side.</p>\n  </div>\n</div>`;
                    form.appendChild(wrapper);
                });
                sections = document.querySelectorAll('.section-content');
            }
        }
    }

    // Run once at startup
    ensureAllSectionsPresent();

    // (Removed legacy layout fallback interval – no longer required after portal approach)

    // Restore sidebar state from localStorage
    const savedSidebarState = localStorage.getItem('sidebarCollapsed');
    if (savedSidebarState === 'true') {
        sidebar.classList.add('collapsed');
    }
    
    // Set initial ARIA state
    if (sidebarToggle) {
        const isExpanded = !sidebar.classList.contains('collapsed');
        sidebarToggle.setAttribute('aria-expanded', isExpanded);
    }

    // Toggle sidebar - ONLY on desktop
    if (sidebarToggle && !isMobile()) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            
            // Update ARIA attributes (true when sidebar is expanded/visible)
            const isExpanded = !sidebar.classList.contains('collapsed');
            sidebarToggle.setAttribute('aria-expanded', isExpanded);
            
            // Save the new state to localStorage (only on desktop)
            if (!isMobile()) {
                localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
            }
        });
    }

    // Mobile overlay and click outside functionality
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.add('collapsed');
            sidebar.classList.remove('mobile-open');
        });
    }
    
    // Click outside to close mobile sidebar
    document.addEventListener('click', (e) => {
        // Mobile sidebar is now completely hidden via CSS
        // No click handling needed for mobile menu
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Quick Help shortcut: Press 'H' key (defensive for browsers/events without key)
        const key = (e && typeof e.key === 'string') ? e.key.toLowerCase() : '';
        
        if (key === 'h' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Only activate if we're not typing in an input field
            const activeElement = document.activeElement;
            const isInputField = activeElement && (
                activeElement.tagName === 'INPUT' || 
                activeElement.tagName === 'TEXTAREA' || 
                activeElement.contentEditable === 'true'
            );
            
            if (!isInputField) {
                e.preventDefault();
                // Use globally attached function (set later) to avoid scope issues
                if (window.toggleHelpPanel) {
                    window.toggleHelpPanel();
                }
            }
        }
        
        // Close help panel with Escape key
        if (key === 'escape') {
            const helpPanel = document.getElementById('quick-help-panel');
            if (helpPanel && helpPanel.classList.contains('open')) {
                e.preventDefault();
                window.toggleHelpPanel();
            }
        }
    });

    // Store original section content before any modifications
    window.originalSectionContent = {};
    
    // Store all section content at page load
    const allSections = document.querySelectorAll('.section-content');
    allSections.forEach(section => {
        window.originalSectionContent[section.id] = section.innerHTML;
    });

    // Default values for settings (moved up to precede any timer cleanup calls)
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
            showCount: 15,
            ratingFilter: '',
            genreFilter: '',
            recentlyAddedOnly: false,
            recentlyAddedDays: 30,
            qualityFilter: ''
        }],
        tmdbSource: {
            enabled: false,
            apiKey: '',
            category: 'popular',
            movieCount: 50,
            showCount: 25,
            minRating: 0,
            yearFilter: null,
            genreFilter: ''
        },
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

    // (Preview system removed)
    let isCinemaMode = false; // retained only for display settings toggling until rewrite

    let sectionNodes = Array.from(document.querySelectorAll('.section-content'));

    // Mutation observer diagnostics to detect unexpected child removals / empties
    // (Removed mutation observers & legacy debug toggles – simplifying production build)

    function cleanupLegacyDebug() { /* no-op after cleanup */ }

    function activateSection(targetSection) {
        if (!targetSection) return;
        // Remove the logic that stops background slideshow - fanart should always run
        sectionNodes = Array.from(document.querySelectorAll('.section-content'));
        ensureAllSectionsPresent();
        // Simple show/hide logic for sections
        sectionNodes.forEach(sec => {
            const isTarget = sec.id === `${targetSection}-section`;
            if (isTarget) {
                sec.classList.add('active');
                sec.style.display='block';
            } else {
                sec.classList.remove('active');
                sec.style.display='none';
            }
        });
        
        // Always update help content when section changes
        updateHelpContent(targetSection);
        
        // If help panel is open, make sure it updates immediately
        const helpPanel = document.getElementById('quick-help-panel');
        if (helpPanel && helpPanel.classList.contains('open')) {
            // Force update by calling with forceUpdate parameter
            updateHelpContentForced(targetSection);
        }
        
        // Load cache stats when Management section is activated
        if (targetSection === 'management') {
            setTimeout(() => {
                loadCacheStats();
                loadCacheConfig();
                
                // Also ensure cache config event listeners are attached
                setupCacheConfigEventListeners();
            }, 100); // Small delay to ensure DOM is ready
        }
        
        // Libraries are now loaded during config load, no need for lazy loading here
    }

    // Make activateSection globally available
    window.activateSection = activateSection;

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSection = item.dataset.section;
            
            // Update ARIA attributes and classes for tab navigation
            navItems.forEach(nav => {
                nav.classList.remove('active');
                nav.setAttribute('aria-selected', 'false');
            });
            
            item.classList.add('active');
            item.setAttribute('aria-selected', 'true');
            
            activateSection(targetSection);
        });
    });

    // Initialize help content after definitions
    updateHelpContent('general');

    // Ensure only first (or currently expected) section is visible at start (after timers defined)
    if (navItems.length > 0) {
        const initial = navItems[0].dataset.section;
        const firstItem = navItems[0];
        
        // Only set ARIA and class, don't override existing inline styles
        firstItem.classList.add('active');
        firstItem.setAttribute('aria-selected', 'true');
        
        // Reset other items (but not the first one)
        navItems.forEach((nav, index) => {
            if (index !== 0) {
                nav.classList.remove('active');
                nav.setAttribute('aria-selected', 'false');
            }
        });
        
        activateSection(initial);
    }

    // Legacy debug helpers removed

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

    // (defaults & state moved earlier)

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
        // Normalize env values to predictable runtime types (strings for ports, booleans for flags)
        const normalizedEnv = {
            SERVER_PORT: env.SERVER_PORT != null ? String(env.SERVER_PORT) : String(defaults.SERVER_PORT),
            DEBUG: env.DEBUG != null ? (env.DEBUG === true || env.DEBUG === 'true') : !!defaults.DEBUG,
            PLEX_HOSTNAME: env.PLEX_HOSTNAME != null ? String(env.PLEX_HOSTNAME) : undefined,
            PLEX_PORT: env.PLEX_PORT != null ? String(env.PLEX_PORT) : undefined,
            PLEX_TOKEN: env.PLEX_TOKEN === true // server already sends boolean for token presence
        };
        // Persist normalized version for other functions (read-only usage)
        window.__normalizedEnv = normalizedEnv;

        // Update the defaults object with server DEBUG value so console.log conditions work
        defaults.DEBUG = normalizedEnv.DEBUG;

        document.getElementById('transitionIntervalSeconds').value = config.transitionIntervalSeconds ?? defaults.transitionIntervalSeconds;
        document.getElementById('backgroundRefreshMinutes').value = config.backgroundRefreshMinutes ?? defaults.backgroundRefreshMinutes;
        document.getElementById('SERVER_PORT').value = normalizedEnv.SERVER_PORT;
        document.getElementById('DEBUG').checked = normalizedEnv.DEBUG;

        const debugCheckbox = document.getElementById('DEBUG');
        const debugAction = document.getElementById('debug-cache-action');
        if (debugAction) {
            debugAction.classList.toggle('is-hidden', !debugCheckbox.checked);
        }
    // Site server settings are populated after server meta (IP) is available in loadConfig.
    // (Avoid early call with placeholder IP to prevent inconsistent link text.)
    }

    function populateSiteServerSettings(config, server = {}) {
        const siteServer = config.siteServer || {};
        const serverIP = server.ipAddress; // Only use real IP when provided
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
                    if (serverIP) {
                        statusLink.href = `http://${serverIP}:${port}`;
                        statusLink.textContent = `http://${serverIP}:${port}`;
                    } else {
                        statusLink.removeAttribute('href');
                        statusLink.textContent = `(waiting for server IP...)`;
                    }
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
                            if (serverIP) {
                                statusLink.href = `http://${serverIP}:${port}`;
                                statusLink.textContent = `http://${serverIP}:${port}`;
                            } else {
                                statusLink.removeAttribute('href');
                                statusLink.textContent = `(waiting for server IP...)`;
                            }
                        }
                    }
                }
            });
        }
        
        // Add event listener for port input
        if (portInput && statusIndicator && serverIP) {
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
    // Enhanced form change tracking (singleton)
    let formTrackingInitialized = false;
    function setupFormChangeTracking() {
        if (formTrackingInitialized) return; // prevent duplicate listeners
        const configForm = document.getElementById('config-form');
        const statusMessage = document.getElementById('config-status');
        const saveButton = document.getElementById('save-config-button');
        if (!configForm || !statusMessage || !saveButton) return;

        formTrackingInitialized = true;
        let hasChanges = false;
        let originalFormData = null;

        const captureFormState = () => {
            const formData = new FormData(configForm);
            const state = {};
            for (const [key, value] of formData.entries()) state[key] = value;
            configForm.querySelectorAll('input[type="checkbox"]').forEach(cb => { state[cb.name] = cb.checked; });
            return state;
        };

        const formHasChanged = () => {
            if (!originalFormData) return false;
            return JSON.stringify(originalFormData) !== JSON.stringify(captureFormState());
        };

        const updateStatus = (message, className = '') => {
            statusMessage.textContent = message;
            statusMessage.className = `status-message ${className}`;
        };

        const handleFormChange = debounce(() => {
            if (formHasChanged()) {
                if (!hasChanges) {
                    hasChanges = true;
                    updateStatus('Unsaved changes detected', 'warning');
                    saveButton.classList.add('has-changes');
                }
            } else if (hasChanges) {
                hasChanges = false;
                updateStatus('All changes saved', 'success');
                saveButton.classList.remove('has-changes');
            }
        }, 400);

        // Initial snapshot after current tick (ensures population done)
        setTimeout(() => { originalFormData = captureFormState(); }, 120);

        configForm.addEventListener('input', handleFormChange);
        configForm.addEventListener('change', handleFormChange);

        document.addEventListener('configSaved', () => {
            originalFormData = captureFormState();
            hasChanges = false;
            updateStatus('Configuration saved successfully', 'success');
            saveButton.classList.remove('has-changes');
            
            // Update saved library selections after successful save
            const movieLibraries = getSelectedLibraries('movie');
            const showLibraries = getSelectedLibraries('show');
            window.__savedMovieLibs = movieLibraries;
            window.__savedShowLibs = showLibraries;
        });

        window.addEventListener('beforeunload', (e) => {
            if (hasChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });

        // Expose helper to manually reset tracking (e.g., after external save)
        window.resetFormChangeTracking = () => {
            originalFormData = captureFormState();
            hasChanges = false;
            updateStatus('All changes saved', 'success');
            saveButton.classList.remove('has-changes');
        };
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
        
        // Wallart Mode (object-based)
        const wallartMode = config.wallartMode ?? defaults.wallartMode ?? { 
            enabled: false, 
            density: 'medium', 
            randomness: 5,
            animationType: 'fade'
        };
        document.getElementById('wallartModeEnabled').checked = wallartMode.enabled;
        document.getElementById('wallartDensity').value = wallartMode.density ?? 'medium';
        document.getElementById('wallartRandomness').value = wallartMode.randomness ?? 5;
        document.getElementById('wallartAnimationType').value = wallartMode.animationType ?? 'fade';
        
        // Update randomness label
        updateRandomnessLabel(wallartMode.randomness ?? 5);
        
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
        
        // Set wallart mode state from config
        const wallartModeState = config.wallartMode ?? defaults.wallartMode ?? { enabled: false };
        const isWallartMode = wallartModeState.enabled;
        
        // Show/hide effect pause time based on transition effect
        toggleEffectPauseTime();
        
        // Show/hide wallart settings based on wallart mode
        const wallartSettingsGroup = document.getElementById('wallartSettingsGroup');
        if (wallartSettingsGroup) {
            wallartSettingsGroup.style.display = isWallartMode ? 'block' : 'none';
            if (isWallartMode) {
                wallartSettingsGroup.classList.remove('hidden');
            } else {
                wallartSettingsGroup.classList.add('hidden');
            }
        }
        
        // Show/hide cinema orientation settings based on cinema mode
        const cinemaOrientationGroup = document.getElementById('cinemaOrientationGroup');
        if (cinemaOrientationGroup) {
            cinemaOrientationGroup.style.display = isCinemaMode ? 'block' : 'none';
        }
        
    // Apply cinema mode settings (including Ken Burns dropdown handling) - single invocation
    toggleCinemaModeSettings(isCinemaMode);
    
    // Apply wallart mode settings 
    toggleWallartModeSettings(isWallartMode);
        
        // Set up real-time input validation
        setupInputValidation();
        
        // Set up form change tracking
        setupFormChangeTracking();
        
        // Set up keyboard shortcuts
        setupKeyboardShortcuts();
        
    // (Removed duplicate toggleCinemaModeSettings call)
        
        // Populate UI scaling settings
        populateUIScalingSettings(config, defaults);
        
        // Show/hide timezone settings based on clockWidget state
        toggleClockSettings();
        
        // Show/hide recently added days field based on checkbox state
        toggleRecentlyAddedDays();
    }

    function populateUIScalingSettings(config, defaults) {
        const scalingConfig = config.uiScaling || defaults.uiScaling;
        
        // Populate range sliders and their value displays
        const scalingFields = ['content', 'clearlogo', 'clock', 'global'];
        scalingFields.forEach(field => {
            const slider = document.getElementById(`uiScaling.${field}`);
            const valueDisplay = document.getElementById(`uiScaling.${field}-value`);
            
            if (slider && valueDisplay) {
                let raw = scalingConfig[field];
                if (raw === undefined || raw === null || raw === '') raw = defaults.uiScaling[field];
                const value = Number(raw);
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
                    // preview update removed
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
                        // preview update removed
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

        // Setup recently added toggle
        const recentlyAddedCheckbox = document.getElementById('mediaServers[0].recentlyAddedOnly');
        if (recentlyAddedCheckbox) {
            recentlyAddedCheckbox.addEventListener('change', toggleRecentlyAddedDays);
        }

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

    function toggleRecentlyAddedDays() {
        const recentlyAddedCheckbox = document.getElementById('mediaServers[0].recentlyAddedOnly');
        const daysContainer = document.getElementById('recentlyAddedDaysContainer');
        
        if (daysContainer) {
            daysContainer.style.display = recentlyAddedCheckbox.checked ? 'block' : 'none';
        }
    }

    function populateSecuritySettings(security) {
        const is2FAEnabled = security.is2FAEnabled || false;
        update2FAStatusText(is2FAEnabled);
    }

    async function populatePlexSettings(config, env, defaults) {
        // Prefer normalized env if available
        const nEnv = window.__normalizedEnv || {};
        const plexServerConfig = config.mediaServers && config.mediaServers[0] ? config.mediaServers[0] : {};
        const plexDefaults = defaults.mediaServers[0];

        document.getElementById('mediaServers[0].enabled').checked = plexServerConfig.enabled ?? plexDefaults.enabled;
        document.getElementById('mediaServers[0].hostname').value = nEnv.PLEX_HOSTNAME ?? env.PLEX_HOSTNAME ?? plexDefaults.hostname;
        document.getElementById('mediaServers[0].port').value = nEnv.PLEX_PORT ?? env.PLEX_PORT ?? plexDefaults.port;
        // For security, don't display the token. Show a placeholder if it's set.
        const tokenInput = document.getElementById('mediaServers[0].token');
        tokenInput.value = ''; // Always clear the value on load
    // env.PLEX_TOKEN is now a boolean indicating if the token is set on the server
    const tokenIsSet = (nEnv.PLEX_TOKEN || env.PLEX_TOKEN === true);
    tokenInput.dataset.tokenSet = tokenIsSet ? 'true' : 'false';
    tokenInput.placeholder = tokenIsSet ? '******** (token stored)' : 'Enter new token...';

        const savedMovieLibs = plexServerConfig.movieLibraryNames || plexDefaults.movieLibraryNames;
        const savedShowLibs = plexServerConfig.showLibraryNames || plexDefaults.showLibraryNames;

        document.getElementById('mediaServers[0].movieCount').value = plexServerConfig.movieCount ?? plexDefaults.movieCount;
        document.getElementById('mediaServers[0].showCount').value = plexServerConfig.showCount ?? plexDefaults.showCount;

        // Content Filtering settings
        document.getElementById('mediaServers[0].ratingFilter').value = plexServerConfig.ratingFilter ?? plexDefaults.ratingFilter;
        
        // Load genres first, then set selected values
        await loadPlexGenres();
        setGenreFilterValues(plexServerConfig.genreFilter ?? plexDefaults.genreFilter);
        
        document.getElementById('mediaServers[0].recentlyAddedOnly').checked = plexServerConfig.recentlyAddedOnly ?? plexDefaults.recentlyAddedOnly;
        document.getElementById('mediaServers[0].recentlyAddedDays').value = plexServerConfig.recentlyAddedDays ?? plexDefaults.recentlyAddedDays;
        document.getElementById('mediaServers[0].qualityFilter').value = plexServerConfig.qualityFilter ?? plexDefaults.qualityFilter;

        return { savedMovieLibs, savedShowLibs };
    }

    async function loadPlexGenres() {
        const genreSelect = document.getElementById('mediaServers[0].genreFilter');
        if (!genreSelect) return;

        // Save currently selected genres before clearing
        const currentlySelected = Array.from(genreSelect.selectedOptions).map(option => option.value);

        try {
            // Get connection parameters for testing (same as libraries)
            const hostname = document.getElementById('mediaServers[0].hostname').value;
            const port = document.getElementById('mediaServers[0].port').value;
            const token = document.getElementById('mediaServers[0].token').value;

            // If we have test parameters, use the test endpoint, otherwise use the regular endpoint
            let response;
            if (hostname && port) {
                response = await fetch('/api/admin/plex-genres-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        hostname: hostname || undefined,
                        port: port || undefined,
                        token: token || undefined
                    })
                });
            } else {
                response = await fetch('/api/admin/plex-genres');
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch genres: ${response.status}`);
            }

            const data = await response.json();
            const genres = data.genres || [];

            // Clear existing options
            genreSelect.innerHTML = '';

            if (genres.length === 0) {
                genreSelect.innerHTML = '<option value="">No genres found</option>';
                return;
            }

            // Add genres as options
            genres.forEach(genre => {
                const option = document.createElement('option');
                option.value = genre;
                option.textContent = genre;
                // Restore previous selection if this genre was selected
                option.selected = currentlySelected.includes(genre);
                genreSelect.appendChild(option);
            });

            
            // Setup listeners after genres are loaded
            setupGenreFilterListeners();
        } catch (error) {
            console.error('Error loading Plex genres:', error);
            genreSelect.innerHTML = '<option value="">Error loading genres</option>';
        }
    }

    function setGenreFilterValues(genreFilterString) {
        const genreSelect = document.getElementById('mediaServers[0].genreFilter');
        if (!genreSelect || !genreFilterString) return;

        // Split comma-separated genres and trim whitespace
        const selectedGenres = genreFilterString.split(',').map(g => g.trim()).filter(g => g);
        
        // Select matching options
        Array.from(genreSelect.options).forEach(option => {
            option.selected = selectedGenres.includes(option.value);
        });
    }

    function getGenreFilterValues() {
        const genreSelect = document.getElementById('mediaServers[0].genreFilter');
        if (!genreSelect) return '';

        const selectedValues = Array.from(genreSelect.selectedOptions).map(option => option.value);
        return selectedValues.join(', ');
    }

    function clearGenreSelection() {
        const genreSelect = document.getElementById('mediaServers[0].genreFilter');
        if (!genreSelect) return;

        // Deselect all options
        Array.from(genreSelect.options).forEach(option => {
            option.selected = false;
        });

        // Trigger a change event to ensure any listeners are notified
        genreSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setupGenreFilterListeners() {
        const clearBtn = document.getElementById('clearGenresBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearGenreSelection);
        }
    }

    // Make loadPlexGenres globally accessible
    window.loadPlexGenres = loadPlexGenres;

    function populateTMDBSettings(config, env, defaults) {
        const tmdbConfig = config.tmdbSource || {};
        const tmdbDefaults = {
            enabled: false,
            apiKey: '',
            category: 'popular',
            movieCount: 50,
            showCount: 25,
            minRating: 0,
            yearFilter: null
        };

        // Populate TMDB form fields
        const enabledField = document.getElementById('tmdbSource.enabled');
        const apiKeyField = document.getElementById('tmdbSource.apiKey');
        const categoryField = document.getElementById('tmdbSource.category');
        const movieCountField = document.getElementById('tmdbSource.movieCount');
        const showCountField = document.getElementById('tmdbSource.showCount');
        const minRatingField = document.getElementById('tmdbSource.minRating');
        const yearFilterField = document.getElementById('tmdbSource.yearFilter');

        if (enabledField) enabledField.checked = tmdbConfig.enabled ?? tmdbDefaults.enabled;
        if (apiKeyField) {
            // For security, don't display the API key. Show a placeholder if it's set.
            apiKeyField.value = '';
            const apiKeyIsSet = tmdbConfig.apiKey && tmdbConfig.apiKey.length > 0;
            apiKeyField.placeholder = apiKeyIsSet ? '******** (API key stored)' : 'Enter TMDB API key...';
            apiKeyField.dataset.apiKeySet = apiKeyIsSet ? 'true' : 'false';
        }
        if (categoryField) categoryField.value = tmdbConfig.category ?? tmdbDefaults.category;
        if (movieCountField) movieCountField.value = tmdbConfig.movieCount ?? tmdbDefaults.movieCount;
        if (showCountField) showCountField.value = tmdbConfig.showCount ?? tmdbDefaults.showCount;
        if (minRatingField) minRatingField.value = tmdbConfig.minRating ?? tmdbDefaults.minRating;
        if (yearFilterField) yearFilterField.value = tmdbConfig.yearFilter || '';

        // Load TMDB genres and set selected values
        if (tmdbConfig.enabled && tmdbConfig.apiKey) {
            loadTMDBGenres().then(() => {
                setTMDBGenreFilterValues(tmdbConfig.genreFilter || '');
            });
        }

        // Setup TMDB test button
        setupTMDBTestButton();
        
        // Setup Streaming configuration
        populateStreamingSettings(config);
        
        // Setup TVDB configuration
        const tvdbConfig = config.tvdbSource || {};
        const tvdbEnabledField = document.getElementById('tvdbSource.enabled');
        const tvdbCategoryField = document.getElementById('tvdbSource.category');
        const tvdbMovieCountField = document.getElementById('tvdbSource.movieCount');
        const tvdbShowCountField = document.getElementById('tvdbSource.showCount');
        const tvdbMinRatingField = document.getElementById('tvdbSource.minRating');
        const tvdbYearFilterField = document.getElementById('tvdbSource.yearFilter');

        if (tvdbEnabledField) tvdbEnabledField.checked = tvdbConfig.enabled || false;
        if (tvdbCategoryField) tvdbCategoryField.value = tvdbConfig.category || 'popular';
        if (tvdbMovieCountField) tvdbMovieCountField.value = tvdbConfig.movieCount || 25;
        if (tvdbShowCountField) tvdbShowCountField.value = tvdbConfig.showCount || 50;
        if (tvdbMinRatingField) tvdbMinRatingField.value = tvdbConfig.minRating || 0;
        if (tvdbYearFilterField) tvdbYearFilterField.value = tvdbConfig.yearFilter || '';

        // Load TVDB genres and set selected values
        if (tvdbConfig.enabled) {
            loadTVDBGenres().then(() => {
                setTVDBGenreFilterValues(tvdbConfig.genreFilter || '');
            });
        }
    }

    async function loadTMDBGenres() {
        const genreSelect = document.getElementById('tmdbSource.genreFilter');
        if (!genreSelect) return;

        // Save currently selected genres before clearing
        const currentlySelected = Array.from(genreSelect.selectedOptions).map(option => option.value);

        try {
            // Get API key and category for testing (same as test connection)
            const apiKey = document.getElementById('tmdbSource.apiKey').value;
            const category = document.getElementById('tmdbSource.category').value;

            // If we have test parameters, use the test endpoint, otherwise use the regular endpoint
            let response;
            if (apiKey) {
                response = await fetch('/api/admin/tmdb-genres-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiKey: apiKey || undefined,
                        category: category || 'popular'
                    })
                });
            } else {
                response = await fetch('/api/admin/tmdb-genres');
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch TMDB genres: ${response.status}`);
            }

            const data = await response.json();
            const genres = data.genres || [];

            // Clear existing options
            genreSelect.innerHTML = '';

            if (genres.length === 0) {
                genreSelect.innerHTML = '<option value="">No genres found</option>';
                return;
            }

            // Add genres as options
            genres.forEach(genre => {
                const option = document.createElement('option');
                option.value = genre;
                option.textContent = genre;
                // Restore previous selection if this genre was selected
                option.selected = currentlySelected.includes(genre);
                genreSelect.appendChild(option);
            });

            // Setup listeners after genres are loaded
            setupTMDBGenreFilterListeners();
        } catch (error) {
            console.error('Error loading TMDB genres:', error);
            genreSelect.innerHTML = '<option value="">Error loading genres</option>';
        }
    }

    // Make loadTMDBGenres globally accessible  
    window.loadTMDBGenres = loadTMDBGenres;

    function setTMDBGenreFilterValues(genreFilterString) {
        const genreSelect = document.getElementById('tmdbSource.genreFilter');
        if (!genreSelect || !genreFilterString) return;

        // Split comma-separated genres and trim whitespace
        const selectedGenres = genreFilterString.split(',').map(g => g.trim()).filter(g => g);
        
        // Select matching options
        Array.from(genreSelect.options).forEach(option => {
            option.selected = selectedGenres.includes(option.value);
        });
    }

    function getTMDBGenreFilterValues() {
        const genreSelect = document.getElementById('tmdbSource.genreFilter');
        if (!genreSelect) return '';

        const selectedValues = Array.from(genreSelect.selectedOptions).map(option => option.value);
        return selectedValues.join(', ');
    }

    function clearTMDBGenreSelection() {
        const genreSelect = document.getElementById('tmdbSource.genreFilter');
        if (!genreSelect) return;

        // Deselect all options
        Array.from(genreSelect.options).forEach(option => {
            option.selected = false;
        });

        // Trigger a change event to ensure any listeners are notified
        genreSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setupTMDBGenreFilterListeners() {
        const clearBtn = document.getElementById('clearTmdbGenresBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearTMDBGenreSelection);
        }
    }

    async function loadTVDBGenres() {
        const genreSelect = document.getElementById('tvdbSource.genreFilter');
        if (!genreSelect) return;

        // Save currently selected genres before clearing
        const currentlySelected = Array.from(genreSelect.selectedOptions).map(option => option.value);

        try {
            // Since TVDB has a hardcoded API key, we can always call the test endpoint
            const response = await fetch('/api/admin/tvdb-genres-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) // Empty body since API key is hardcoded
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch TVDB genres: ${response.status}`);
            }

            const data = await response.json();
            const genres = data.genres || [];

            // Clear existing options
            genreSelect.innerHTML = '';

            if (genres.length === 0) {
                genreSelect.innerHTML = '<option value="">No genres found</option>';
                return;
            }

            // Add genres as options
            genres.forEach(genre => {
                const option = document.createElement('option');
                const genreName = genre.name || genre;
                option.value = genreName;
                option.textContent = genreName;
                if (genre.id) option.dataset.genreId = genre.id;
                // Restore previous selection if this genre was selected
                option.selected = currentlySelected.includes(genreName);
                genreSelect.appendChild(option);
            });

            // Setup listeners after genres are loaded
            setupTVDBGenreFilterListeners();
        } catch (error) {
            console.error('Error loading TVDB genres:', error);
            genreSelect.innerHTML = '<option value="">Error loading genres</option>';
        }
    }

    // Make loadTVDBGenres globally accessible
    window.loadTVDBGenres = loadTVDBGenres;

    function setTVDBGenreFilterValues(genreFilterString) {
        const genreSelect = document.getElementById('tvdbSource.genreFilter');
        if (!genreSelect || !genreFilterString) return;

        // Split comma-separated genres and trim whitespace
        const selectedGenres = genreFilterString.split(',').map(g => g.trim()).filter(g => g);
        
        // Select matching options
        Array.from(genreSelect.options).forEach(option => {
            option.selected = selectedGenres.includes(option.value);
        });
    }

    function getTVDBGenreFilterValues() {
        const genreSelect = document.getElementById('tvdbSource.genreFilter');
        if (!genreSelect) return '';

        const selectedValues = Array.from(genreSelect.selectedOptions).map(option => option.value);
        return selectedValues.join(', ');
    }

    function clearTVDBGenreSelection() {
        const genreSelect = document.getElementById('tvdbSource.genreFilter');
        if (!genreSelect) return;

        // Deselect all options
        Array.from(genreSelect.options).forEach(option => {
            option.selected = false;
        });

        // Trigger a change event to ensure any listeners are notified
        genreSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setupTVDBGenreFilterListeners() {
        const clearBtn = document.getElementById('clearTvdbGenresBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearTVDBGenreSelection);
        }
    }

    function setupTMDBTestButton() {
        const testButton = document.getElementById('test-tmdb-button');
        const statusElement = document.getElementById('tmdb-connection-status');
        
        if (!testButton) return;

        testButton.addEventListener('click', async () => {
            const apiKeyField = document.getElementById('tmdbSource.apiKey');
            const categoryField = document.getElementById('tmdbSource.category');
            
            // Check if API key is entered or already stored
            let apiKey = apiKeyField?.value?.trim() || '';
            const isApiKeyStored = apiKeyField?.dataset?.apiKeySet === 'true';
            const category = categoryField?.value || 'popular';

            // If no API key entered but one is stored, use a placeholder to indicate we should test with stored key
            if (!apiKey && isApiKeyStored) {
                apiKey = 'stored_key'; // This will trigger the server to use the stored key
            }

            if (!apiKey && !isApiKeyStored) {
                if (statusElement) {
                    statusElement.textContent = 'Please enter an API key first.';
                    statusElement.style.color = '#ff6b6b';
                }
                return;
            }

            // Show loading state
            testButton.disabled = true;
            testButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            if (statusElement) {
                const keySource = isApiKeyStored && !apiKeyField?.value?.trim() ? 'stored API key' : 'provided API key';
                statusElement.textContent = `Testing TMDB connection with ${keySource}...`;
                statusElement.style.color = '#ffd93d';
            }

            try {
                const response = await fetch('/api/admin/test-tmdb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, category })
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    if (statusElement) {
                        statusElement.textContent = `✅ Connection successful! Found ${result.count || 0} ${category} items.`;
                        statusElement.style.color = '#51cf66';
                    }
                    
                    // Automatically load TMDB genres after successful connection
                    try {
                        await loadTMDBGenres();
                        showNotification('TMDB connection successful and genres loaded', 'success');
                    } catch (genreError) {
                        console.warn('Failed to load TMDB genres:', genreError);
                        showNotification('TMDB connection successful, but genres could not be loaded', 'error');
                    }
                } else {
                    if (statusElement) {
                        statusElement.textContent = `❌ Connection failed: ${result.error || 'Unknown error'}`;
                        statusElement.style.color = '#ff6b6b';
                    }
                    showNotification(`TMDB connection failed: ${result.error || 'Unknown error'}`, 'error');
                }
            } catch (error) {
                if (statusElement) {
                    statusElement.textContent = `❌ Test failed: ${error.message}`;
                    statusElement.style.color = '#ff6b6b';
                }
                showNotification(`TMDB connection failed: ${error.message}`, 'error');
            } finally {
                // Restore button state
                testButton.disabled = false;
                testButton.innerHTML = '<i class="fas fa-plug icon"></i><span>Test TMDB Connection</span>';
            }
        });
    }

    function populateStreamingSettings(config) {
        const streamingConfig = config.streamingSources || {};
        const streamingDefaults = {
            enabled: false,
            region: 'US',
            maxItems: 20,
            minRating: 6.0,
            netflix: false,
            disney: false,
            prime: false,
            hbo: false,
            newReleases: false
        };

        // Populate streaming form fields
        const enabledField = document.getElementById('streamingSources.enabled');
        const regionField = document.getElementById('streamingSources.region');
        const maxItemsField = document.getElementById('streamingSources.maxItems');
        const minRatingField = document.getElementById('streamingSources.minRating');
        
        // Provider checkboxes
        const netflixField = document.getElementById('streamingSources.netflix');
        const disneyField = document.getElementById('streamingSources.disney');
        const primeField = document.getElementById('streamingSources.prime');
        const hboField = document.getElementById('streamingSources.hbo');
        const newReleasesField = document.getElementById('streamingSources.newReleases');

        if (enabledField) enabledField.checked = streamingConfig.enabled ?? streamingDefaults.enabled;
        if (regionField) regionField.value = streamingConfig.region ?? streamingDefaults.region;
        if (maxItemsField) maxItemsField.value = streamingConfig.maxItems ?? streamingDefaults.maxItems;
        if (minRatingField) minRatingField.value = streamingConfig.minRating ?? streamingDefaults.minRating;
        
        // Set provider checkboxes
        if (netflixField) netflixField.checked = streamingConfig.netflix ?? streamingDefaults.netflix;
        if (disneyField) disneyField.checked = streamingConfig.disney ?? streamingDefaults.disney;
        if (primeField) primeField.checked = streamingConfig.prime ?? streamingDefaults.prime;
        if (hboField) hboField.checked = streamingConfig.hbo ?? streamingDefaults.hbo;
        if (newReleasesField) newReleasesField.checked = streamingConfig.newReleases ?? streamingDefaults.newReleases;

        // Setup streaming test button
        setupStreamingTestButton();
    }

    function setupStreamingTestButton() {
        const testButton = document.getElementById('test-streaming-button');
        if (!testButton) return;

        testButton.addEventListener('click', async () => {
            const statusElement = document.getElementById('streaming-connection-status');
            
            // Disable button and show loading state
            testButton.disabled = true;
            testButton.innerHTML = '<i class="fas fa-spinner fa-spin icon"></i><span>Testing...</span>';
            
            if (statusElement) {
                statusElement.textContent = 'Testing streaming connection...';
                statusElement.style.color = '#94a3b8';
            }

            try {
                // Get streaming configuration
                const enabledField = document.getElementById('streamingSources.enabled');
                const regionField = document.getElementById('streamingSources.region');
                
                if (!enabledField?.checked) {
                    if (statusElement) {
                        statusElement.textContent = '⚠️ Streaming sources are disabled';
                        statusElement.style.color = '#f59e0b';
                    }
                    return;
                }

                const region = regionField?.value || 'US';
                
                // Test TMDB API (streaming uses TMDB)
                const response = await fetch('/api/admin/test-tmdb', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        testType: 'streaming',
                        region: region,
                        apiKey: 'stored_key'
                    })
                });

                const result = await response.json();
                
                if (result.success) {
                    if (statusElement) {
                        statusElement.textContent = `✅ Streaming API ready! Region: ${region}`;
                        statusElement.style.color = '#51cf66';
                    }
                } else {
                    if (statusElement) {
                        statusElement.textContent = `❌ Connection failed: ${result.error || 'Unknown error'}`;
                        statusElement.style.color = '#ff6b6b';
                    }
                }
            } catch (error) {
                if (statusElement) {
                    statusElement.textContent = `❌ Test failed: ${error.message}`;
                    statusElement.style.color = '#ff6b6b';
                }
            } finally {
                // Restore button state
                testButton.disabled = false;
                testButton.innerHTML = '<i class="fas fa-stream icon"></i><span>Test Streaming Connection</span>';
            }
        });
    }

    async function loadConfig() {
        try {
            const response = await authenticatedFetch(apiUrlWithCacheBust('/api/admin/config'));
            if (!response.ok) {
                throw new Error(`Could not load configuration from the server. Status: ${response.status} ${response.statusText}`);
            }
            const { config = {}, env = {}, security = {}, server = {} } = await response.json();

            populateGeneralSettings(config, env, defaults);
            populateDisplaySettings(config, defaults);
            setupDisplaySettingListeners();
            // (preview timers removed)
            setupCinemaModeListeners();
            setupWallartModeListeners();
            populateSecuritySettings(security);
            const { savedMovieLibs, savedShowLibs } = await populatePlexSettings(config, env, defaults);
            window.__savedMovieLibs = savedMovieLibs;
            window.__savedShowLibs = savedShowLibs;
            
            // Populate TMDB settings
            populateTMDBSettings(config, env, defaults);

            // Pass server info to site server settings
            populateSiteServerSettings(config, server);

            // If Plex is configured, fetch libraries and start background slideshow
            const nEnv = window.__normalizedEnv || {};
            const isNonEmpty = v => v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null' && String(v).toLowerCase() !== 'undefined';
            const hasPlexHost = isNonEmpty(nEnv.PLEX_HOSTNAME ?? env.PLEX_HOSTNAME);
            const rawPort = nEnv.PLEX_PORT ?? env.PLEX_PORT;
            const portNum = Number(rawPort);
            // Accept only numeric port within valid range (1-65535). Port '0' is invalid for Plex.
            const hasPlexPort = Number.isFinite(portNum) && portNum >= 1 && portNum <= 65535;
            const rawToken = (nEnv.PLEX_TOKEN !== undefined ? nEnv.PLEX_TOKEN : env.PLEX_TOKEN);
            const hasPlexToken = rawToken === true || rawToken === 'true' || (typeof rawToken === 'string' && rawToken.length > 0);
            window.__plexReady = (hasPlexHost && hasPlexPort && hasPlexToken);
            if (!window.__plexReady) {
                const missing = [];
                if (!hasPlexHost) missing.push('PLEX_HOSTNAME');
                if (!hasPlexPort) missing.push('PLEX_PORT(valid)');
                if (!hasPlexToken) missing.push('PLEX_TOKEN');
                if (missing.length < 3) console.warn('Plex not initialized — missing:', missing.join(', '));
            } else {
                // Load Plex libraries immediately when config is loaded
                const movieContainer = document.getElementById('movie-libraries-container');
                const showContainer = document.getElementById('show-libraries-container');
                if (movieContainer) movieContainer.innerHTML = '<small>Loading libraries...</small>';
                if (showContainer) showContainer.innerHTML = '<small>Loading libraries...</small>';
                
                // Load libraries with saved selections - only if Plex is properly configured
                setTimeout(() => {
                    try {
                        const hostname = document.getElementById('mediaServers[0].hostname')?.value;
                        const port = document.getElementById('mediaServers[0].port')?.value;
                        const tokenInput = document.getElementById('mediaServers[0].token');
                        const tokenIsSet = tokenInput?.dataset.tokenSet === 'true';
                        
                        // Only fetch libraries if we have valid Plex configuration
                        if (hostname && hostname.trim() && port && port.trim() && tokenIsSet) {
                            fetchAndDisplayPlexLibraries(window.__savedMovieLibs||[], window.__savedShowLibs||[]);
                        } else {
                            // Show placeholder message instead of trying to connect
                            if (movieContainer) movieContainer.innerHTML = '<small>Configure Plex connection to load libraries</small>';
                            if (showContainer) showContainer.innerHTML = '<small>Configure Plex connection to load libraries</small>';
                        }
                        window.__mediaLazyLoaded = true; // Mark as loaded
                    } catch(e) { 
                        console.warn('[ADMIN] Library load failed during config load', e); 
                        if (movieContainer) movieContainer.innerHTML = '<small>Failed to load libraries</small>';
                        if (showContainer) showContainer.innerHTML = '<small>Failed to load libraries</small>';
                    }
                }, 100);
            }

            // Forcefully remove focus from any element that the browser might have auto-focused.
            if (document.activeElement) document.activeElement.blur();
            
            // Always initialize fanart background regardless of active section
            initializeAdminBackground();
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
                    setGradientBackground();
                    return;
                }
                adminBgQueue = await response.json();
                if (adminBgQueue.length === 0) {
                    console.warn('Admin background queue is empty. Using gradient background.');
                    setGradientBackground();
                    return;
                }
                // Start at random index instead of -1 for random fanart on refresh
                adminBgIndex = Math.floor(Math.random() * adminBgQueue.length) - 1;
            } catch (error) {
                console.warn('Failed to fetch admin background media:', error);
                setGradientBackground();
                return;
            }
        }

    if (defaults.DEBUG) console.log(`[AdminBG] Starting slideshow with ${adminBgQueue.length} images`);
        
        // Show first image immediately
        changeAdminBackground();
        
        // Set up regular interval
        adminBgTimer = setInterval(changeAdminBackground, 30000); // Change every 30 seconds
    }

    /**
     * Changes the background image on the admin page with a fade effect.
     */
    function changeAdminBackground() {
        if (!defaults.DEBUG) {
            // Light heartbeat every few cycles only
            if (adminBgIndex % 10 === 0 && defaults.DEBUG) console.debug('[AdminBG] rotate');
        } else {
            if (defaults.DEBUG) console.log('[AdminBG] tick');
        }
        
        if (adminBgQueue.length === 0 || !activeAdminLayer || !inactiveAdminLayer) {
            return;
        }

        const oldIndex = adminBgIndex;
        adminBgIndex = (adminBgIndex + 1) % adminBgQueue.length;
        const currentItem = adminBgQueue[adminBgIndex];

        if (defaults.DEBUG) {
            // Debug background index change
        }

        if (!currentItem || !currentItem.backgroundUrl) {
            return;
        }

        if (defaults.DEBUG) {
            // Debug background change
        }

        // Log current layer states
        if (defaults.DEBUG) {
            console.log('[AdminBG] BEFORE', {
                activeOpacity: window.getComputedStyle(activeAdminLayer).opacity,
                inactiveOpacity: window.getComputedStyle(inactiveAdminLayer).opacity
            });
        }

        const img = new Image();
        img.onload = () => {
            if (defaults.DEBUG) console.log('[AdminBG] image loaded');
            
            // Show the overlay again when fanart is available (it darkens the fanart for better readability)
            const overlay = document.querySelector('.admin-background-overlay');
            if (overlay) {
                overlay.style.opacity = '1';
                if (defaults.DEBUG) console.log('Admin background overlay restored for fanart');
            }
            
            // Set new image on inactive layer and make it visible
            inactiveAdminLayer.style.backgroundImage = `url('${currentItem.backgroundUrl}')`;
            inactiveAdminLayer.style.opacity = 0;
            
            if (defaults.DEBUG) console.log('[AdminBG] inactive layer prepared');
            
            // Start fade transition immediately
            setTimeout(() => {
                if (defaults.DEBUG) console.log('[AdminBG] fade start');
                
                // Fade out current active layer
                activeAdminLayer.style.opacity = 0;
                // Fade in new layer
                inactiveAdminLayer.style.opacity = 0.7;
                
                if (defaults.DEBUG) console.log('[AdminBG] transition props applied');
                
                // After transition, swap the layer references 
                // The inactive layer (which now has the new image and is visible) becomes active
                setTimeout(() => {
                    if (defaults.DEBUG) console.log('[AdminBG] swapping layers');
                    
                    const tempLayer = activeAdminLayer;
                    activeAdminLayer = inactiveAdminLayer;  // The one with the new image becomes active
                    inactiveAdminLayer = tempLayer;         // The old active becomes inactive
                    
                    // DO NOT clear the background image - keep it for debugging
                    // inactiveAdminLayer.style.backgroundImage = 'none';
                    
                    if (defaults.DEBUG) console.log('[AdminBG] swap complete', { active: activeAdminLayer.id, inactive: inactiveAdminLayer.id });
                    
                    // Log final states
                    if (defaults.DEBUG) console.log('[AdminBG] AFTER', {
                        activeOpacity: window.getComputedStyle(activeAdminLayer).opacity,
                        inactiveOpacity: window.getComputedStyle(inactiveAdminLayer).opacity
                    });
                    
                }, 1100); // Wait a bit longer for CSS transition to complete
                
            }, 50); // Small delay to ensure image is set
        };
        
        img.onerror = () => {
            console.warn(`Failed to load admin background image: ${currentItem.backgroundUrl}`);
            // Try next image
            setTimeout(() => {
                changeAdminBackground();
            }, 1000);
        };
        
        if (defaults.DEBUG) console.log('[AdminBG] loading image');
        img.src = currentItem.backgroundUrl;
    }

    /**
     * Sets a beautiful gradient background when no fanart is available
     */
    function setGradientBackground() {
        if (!activeAdminLayer || !inactiveAdminLayer) {
            console.warn('Background layers not found for gradient');
            return;
        }

        // Use the same static gradient as the admin login for consistency
        const staticGradient = 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 25%, #16213e 50%, #0f3460 75%, #533483 100%)';
        
        // Clear any existing background images and animations
        activeAdminLayer.style.backgroundImage = staticGradient;
        inactiveAdminLayer.style.backgroundImage = '';
        
        // Ensure active layer is visible
        activeAdminLayer.style.opacity = '1';
        inactiveAdminLayer.style.opacity = '0';
        
        // Remove animation for a calm, stable background
        activeAdminLayer.style.backgroundSize = '100% 100%';
        activeAdminLayer.style.animation = 'none';
        
        // Hide the dark overlay when showing gradient fallback so it's clearly visible
        const overlay = document.querySelector('.admin-background-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
        }
        
        // Clear any existing rotation timer since we want a static background
        if (adminBgTimer) {
            clearInterval(adminBgTimer);
            adminBgTimer = null;
        }
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
            const isTokenSetOnServer = tokenInput.dataset.tokenSet === 'true';

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

                setButtonState(testButton, 'success', { text: 'Connection successful' });

                // Enable the "Refresh Media" button
                const refreshButton = document.getElementById('refresh-media-button');
                if (refreshButton) refreshButton.disabled = false;

                 // On success, fetch and display libraries, preserving current selections
                 const currentMovieLibs = getSelectedLibraries('movie');
                 const currentShowLibs = getSelectedLibraries('show');
                 fetchAndDisplayPlexLibraries(currentMovieLibs, currentShowLibs);
                 
                 // Load genres after successful connection test
                 try {
                     await window.loadPlexGenres();
                     showNotification('Plex connection successful and genres loaded', 'success');
                 } catch (genreError) {
                     console.warn('Failed to load genres after connection test:', genreError);
                     showNotification('Plex connection successful, but genres could not be loaded', 'warning');
                 }
                 
                 adminBgQueue = []; // Force a re-fetch of the media queue
                 initializeAdminBackground();

            } catch (error) {
                setButtonState(testButton, 'error', { text: 'Connection failed' });
                showNotification(`Plex connection failed: ${error.message}`, 'error');

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
        
        // Add change listener to automatically load genres when a library is selected
        input.addEventListener('change', async () => {
            const hasAnyLibrarySelected = getSelectedLibraries('movie').length > 0 || getSelectedLibraries('show').length > 0;
            if (hasAnyLibrarySelected) {
                // Load genres immediately when a library is selected
                try {
                    await loadPlexGenres();
                    showNotification('Genres updated based on selected libraries', 'success');
                } catch (error) {
                    console.warn('Failed to load genres after library selection:', error);
                }
            }
        });
        
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = name;
        container.appendChild(input);
        container.appendChild(label);
        return container;
    }

    function getSelectedLibraries(type) {
        const container = document.getElementById(`${type}-libraries-container`);
        if (!container) {
            console.warn(`[Admin] getSelectedLibraries: container not found for type='${type}'`);
            return [];
        }
        try {
            const checkedBoxes = container.querySelectorAll(`input[name="${type}Library"]:checked`);
            return Array.from(checkedBoxes).map(cb => cb.value);
        } catch (err) {
            console.error('[Admin] getSelectedLibraries failed:', err);
            return [];
        }
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
        
        // NUCLEAR OPTION: Create a completely new modal element
        
        // Remove any existing custom modal
        const existingCustomModal = document.getElementById('custom-2fa-modal');
        if (existingCustomModal) {
            existingCustomModal.remove();
        }
        
        // Create completely new modal
        const customModal = document.createElement('div');
        customModal.id = 'custom-2fa-modal';
        customModal.innerHTML = `
            <div style="
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 99999999 !important;
                background: rgba(0, 0, 0, 0.7) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 0 !important;
                padding: 0 !important;
                backdrop-filter: blur(5px) !important;
            ">
                <div style="
                    background: linear-gradient(135deg, rgba(30, 30, 30, 0.95) 0%, rgba(20, 20, 20, 0.95) 100%) !important;
                    border: 1px solid rgba(102, 126, 234, 0.3) !important;
                    border-radius: 16px !important;
                    padding: 2rem !important;
                    max-width: 500px !important;
                    width: 90% !important;
                    text-align: center !important;
                    backdrop-filter: blur(20px) !important;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 8px 32px rgba(102, 126, 234, 0.2) !important;
                ">
                    <h2 style="
                        color: #ffffff !important; 
                        font-size: 1.5rem !important;
                        font-weight: 600 !important;
                        margin-bottom: 1rem !important;
                        text-align: center !important;
                    ">
                        Setup Two-Factor Authentication
                    </h2>
                    <ol style="
                        color: #b3b3b3 !important; 
                        margin: 1rem 0 !important; 
                        padding-left: 1.5rem !important;
                        text-align: left !important;
                    ">
                        <li>Install an authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.)</li>
                        <li>Scan the QR code below with your authenticator app</li>
                        <li>Enter the 6-digit code from your app to complete setup</li>
                    </ol>
                    <div id="custom-qr-container" style="
                        text-align: center !important;
                        margin: 1.5rem 0 !important;
                    ">
                        <!-- QR code will be inserted here -->
                    </div>
                    <input type="text" id="custom-2fa-token" placeholder="000000" maxlength="6" style="
                        display: block !important;
                        width: 200px !important;
                        margin: 1rem auto !important;
                        padding: 10px !important;
                        text-align: center !important;
                        font-size: 1.2rem !important;
                        letter-spacing: 0.2rem !important;
                        border: 2px solid rgba(102, 126, 234, 0.3) !important;
                        border-radius: 8px !important;
                        background: rgba(40, 40, 40, 0.8) !important;
                        color: #ffffff !important;
                        outline: none !important;
                    ">
                    <div style="margin-top: 1.5rem !important;">
                        <button id="custom-cancel-2fa" style="
                            margin-right: 10px !important;
                            padding: 12px 24px !important;
                            background: rgba(60, 60, 60, 0.8) !important;
                            color: #ffffff !important;
                            border: 1px solid rgba(102, 126, 234, 0.3) !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            transition: all 0.3s ease !important;
                        ">Cancel Setup</button>
                        <button id="custom-verify-2fa" style="
                            padding: 12px 24px !important;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                            color: white !important;
                            border: none !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            font-weight: 600 !important;
                            transition: all 0.3s ease !important;
                        ">Complete Setup</button>
                    </div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
            </style>
        `;
        
        // Add to body directly
        document.body.appendChild(customModal);
        
        // Add QR code to custom modal
        const customQrContainer = document.getElementById('custom-qr-container');
        if (customQrContainer && qrCodeContainer && qrCodeContainer.innerHTML) {
            // Copy QR code with better styling
            const qrImg = qrCodeContainer.querySelector('img');
            if (qrImg) {
                const styledQrCode = `
                    <img src="${qrImg.src}" alt="2FA QR Code" style="
                        max-width: 200px !important;
                        border: 1px solid rgba(102, 126, 234, 0.3) !important;
                        border-radius: 8px !important;
                        padding: 10px !important;
                        background: white !important;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
                    ">
                `;
                customQrContainer.innerHTML = styledQrCode;
            } else {
                customQrContainer.innerHTML = qrCodeContainer.innerHTML;
            }
        }
        
        // Add event listeners
        const cancelBtn = document.getElementById('custom-cancel-2fa');
        const verifyBtn = document.getElementById('custom-verify-2fa');
        const tokenInput = document.getElementById('custom-2fa-token');
        
        // Add hover effects
        if (cancelBtn) {
            cancelBtn.addEventListener('mouseenter', () => {
                cancelBtn.style.background = 'rgba(80, 80, 80, 0.9)';
            });
            cancelBtn.addEventListener('mouseleave', () => {
                cancelBtn.style.background = 'rgba(60, 60, 60, 0.8)';
            });
            cancelBtn.addEventListener('click', () => {
                customModal.remove();
                update2FAStatusText(false);
            });
        }
        
        if (verifyBtn) {
            verifyBtn.addEventListener('mouseenter', () => {
                verifyBtn.style.transform = 'translateY(-2px)';
                verifyBtn.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.3)';
            });
            verifyBtn.addEventListener('mouseleave', () => {
                verifyBtn.style.transform = 'translateY(0)';
                verifyBtn.style.boxShadow = 'none';
            });
        }
        
        // Add input focus effects
        if (tokenInput) {
            tokenInput.addEventListener('focus', () => {
                tokenInput.style.borderColor = 'rgba(102, 126, 234, 0.8)';
                tokenInput.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.2)';
            });
            tokenInput.addEventListener('blur', () => {
                tokenInput.style.borderColor = 'rgba(102, 126, 234, 0.3)';
                tokenInput.style.boxShadow = 'none';
            });
            // Auto-format input (digits only)
            tokenInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, '').substring(0, 6);
            });
        }
        
        if (verifyBtn && tokenInput) {
            verifyBtn.addEventListener('click', async () => {
                const token = tokenInput.value;
                if (token.length === 6) {
                    // Show loading state
                    const originalText = verifyBtn.innerHTML;
                    verifyBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Verifying...';
                    verifyBtn.disabled = true;
                    verifyBtn.style.opacity = '0.7';
                    
                    // Use the existing verification logic
                    try {
                        const response = await authenticatedFetch('/api/admin/2fa/verify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token })
                        });
                        const result = await response.json();
                        
                        if (response.status === 401) {
                            throw new Error('Your session has expired. Please log in again.');
                        }
                        if (!response.ok) throw new Error(result.error || 'Verification failed.');

                        customModal.remove();
                        showNotification('🎉 Two-Factor Authentication enabled successfully!', 'success');
                        update2FAStatusText(true);
                    } catch (error) {
                        showNotification(`❌ ${error.message}`, 'error');
                        tokenInput.value = '';
                        tokenInput.focus();
                        
                        // Reset button state
                        verifyBtn.innerHTML = '✓ Verify Code';
                        verifyBtn.disabled = false;
                        verifyBtn.style.opacity = '1';
                    }
                } else {
                    // Simple validation feedback
                    tokenInput.style.borderColor = '#ff4757';
                    tokenInput.style.animation = 'shake 0.5s ease-in-out';
                    setTimeout(() => {
                        tokenInput.style.borderColor = 'rgba(102, 126, 234, 0.3)';
                        tokenInput.style.animation = '';
                        tokenInput.focus();
                    }, 500);
                }
            });
            
            // Allow Enter key to submit
            tokenInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && tokenInput.value.length === 6) {
                    verifyBtn.click();
                }
            });
        }
        
        // Focus on input
        if (tokenInput) {
            setTimeout(() => tokenInput.focus(), 100);
        }
    }

    function hide2FAModal() {
        // Hide original modal
        if (twoFaModal) {
            twoFaModal.classList.add('is-hidden');
            twoFaModal.setAttribute('aria-hidden', 'true');
        }
        if (qrCodeContainer) qrCodeContainer.innerHTML = '';
        const tokenInput = document.getElementById('2fa-token');
        if (tokenInput) tokenInput.value = '';
        
        // Also remove custom modal if it exists
        const customModal = document.getElementById('custom-2fa-modal');
        if (customModal) {
            customModal.remove();
        }
    }

    // New functions for the disable modal
    function showDisable2FAModal() {
        // Remove any existing custom disable modal
        const existingCustomModal = document.getElementById('ultra-protected-disable-2fa-modal');
        if (existingCustomModal) {
            existingCustomModal.remove();
        }
        
        // Create completely new disable modal with ULTRA protection
        const customDisableModal = document.createElement('div');
        customDisableModal.id = 'ultra-protected-disable-2fa-modal';
        
        // Make it nearly impossible to remove accidentally
        Object.defineProperty(customDisableModal, 'remove', {
            value: function() {
                // Only allow removal if explicitly called with the secret key
                if (arguments[0] === 'ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE') {
                    Element.prototype.remove.call(this);
                } else {
                    // Default behavior without explicit permission
                    return;
                }
            },
            writable: false,
            configurable: false
        });
        
        customDisableModal.innerHTML = `
            <div style="
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 2147483647 !important;
                background: rgba(0, 0, 0, 0.7) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 0 !important;
                padding: 0 !important;
                backdrop-filter: blur(5px) !important;
            ">
                <div style="
                    background: linear-gradient(135deg, rgba(30, 30, 30, 0.95) 0%, rgba(20, 20, 20, 0.95) 100%) !important;
                    border: 1px solid rgba(239, 68, 68, 0.3) !important;
                    border-radius: 16px !important;
                    padding: 2rem !important;
                    max-width: 500px !important;
                    width: 90% !important;
                    text-align: center !important;
                    backdrop-filter: blur(20px) !important;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 8px 32px rgba(239, 68, 68, 0.2) !important;
                ">
                    <h2 style="
                        color: #ffffff !important; 
                        font-size: 1.5rem !important;
                        font-weight: 600 !important;
                        margin-bottom: 1rem !important;
                        text-align: center !important;
                    ">
                        Disable Two-Factor Authentication
                    </h2>
                    <div style="
                        color: #ff6b6b !important;
                        background: rgba(239, 68, 68, 0.1) !important;
                        border: 1px solid rgba(239, 68, 68, 0.3) !important;
                        border-radius: 8px !important;
                        padding: 1rem !important;
                        margin-bottom: 1.5rem !important;
                        text-align: left !important;
                    ">
                        <strong>⚠️ Warning:</strong> Disabling 2FA will make your account less secure.
                    </div>
                    <p style="
                        color: #b3b3b3 !important; 
                        margin-bottom: 1.5rem !important;
                        text-align: center !important;
                    ">
                        Please enter your current password to confirm this change:
                    </p>
                    <input type="password" id="ultra-disable-password" placeholder="Current Password" style="
                        display: block !important;
                        width: 100% !important;
                        max-width: 300px !important;
                        margin: 1rem auto !important;
                        padding: 12px !important;
                        text-align: center !important;
                        font-size: 1rem !important;
                        border: 2px solid rgba(239, 68, 68, 0.3) !important;
                        border-radius: 8px !important;
                        background: rgba(40, 40, 40, 0.8) !important;
                        color: #ffffff !important;
                        outline: none !important;
                        transition: border-color 0.3s ease !important;
                    ">
                    <div id="ultra-disable-error" style="
                        display: none !important;
                        color: #ff6b6b !important;
                        background: rgba(239, 68, 68, 0.1) !important;
                        border: 1px solid rgba(239, 68, 68, 0.3) !important;
                        border-radius: 8px !important;
                        padding: 0.75rem !important;
                        margin: 1rem auto !important;
                        max-width: 300px !important;
                        font-size: 0.9rem !important;
                        text-align: center !important;
                    "></div>
                    <div style="margin-top: 1.5rem !important;">
                        <button id="ultra-cancel-disable" style="
                            margin-right: 10px !important;
                            padding: 12px 24px !important;
                            background: rgba(60, 60, 60, 0.8) !important;
                            color: #ffffff !important;
                            border: 1px solid rgba(102, 126, 234, 0.3) !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            transition: all 0.3s ease !important;
                        ">Keep 2FA Enabled</button>
                        <button id="ultra-confirm-disable" style="
                            padding: 12px 24px !important;
                            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%) !important;
                            color: white !important;
                            border: none !important;
                            border-radius: 8px !important;
                            cursor: pointer !important;
                            font-size: 1rem !important;
                            font-weight: 600 !important;
                            transition: all 0.3s ease !important;
                        ">Disable 2FA</button>
                    </div>
                </div>
            </div>
            <style>
                #ultra-disable-password:focus {
                    border-color: rgba(239, 68, 68, 0.6) !important;
                    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1) !important;
                }
                #ultra-cancel-disable:hover {
                    background: rgba(80, 80, 80, 0.9) !important;
                    transform: translateY(-1px) !important;
                }
                #ultra-confirm-disable:hover {
                    background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%) !important;
                    transform: translateY(-1px) !important;
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3) !important;
                }
            </style>
        `;
        
        // Inject into body
        document.body.appendChild(customDisableModal);
        
        // Prevent accidental closing - even more aggressive
        customDisableModal.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
        });
        
        // Get elements from the new modal
        const passwordInput = document.getElementById('ultra-disable-password');
        const cancelBtn = document.getElementById('ultra-cancel-disable');
        const confirmBtn = document.getElementById('ultra-confirm-disable');
        const errorDiv = document.getElementById('ultra-disable-error');
        
        // Add event listeners
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                // Use the secret key to allow removal
                customDisableModal.remove('ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE');
                // Reset checkbox to enabled state
                update2FAStatusText(true);
            });
        }
        
        if (confirmBtn && passwordInput) {
            confirmBtn.addEventListener('click', async () => {
                const password = passwordInput.value;
                if (!password) {
                    passwordInput.style.borderColor = '#ff4757';
                    passwordInput.style.animation = 'shake 0.5s ease-in-out';
                    setTimeout(() => {
                        passwordInput.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                        passwordInput.style.animation = '';
                        passwordInput.focus();
                    }, 500);
                    return;
                }
                
                // HIDE modal from querySelector/getElementById during request
                const originalId = customDisableModal.id;
                customDisableModal.id = 'hidden-during-request-' + Date.now();
                
                // Show loading state
                const originalText = confirmBtn.innerHTML;
                confirmBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Disabling...';
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.7';
                
                // Hide any previous error
                if (errorDiv) {
                    errorDiv.style.display = 'none';
                }
                
                try {
                    // Use pure fetch to avoid any side effects from authenticatedFetch
                    const response = await fetch('/api/admin/2fa/disable', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-cache'
                        },
                        body: JSON.stringify({ password })
                    });
                    
                    const result = await response.json();
                    
                    // Handle different types of 401 errors
                    if (response.status === 401) {
                        if (result.error && result.error.includes('Authentication required')) {
                            throw new Error('Your session has expired. Please refresh the page and log in again.');
                        } else if (result.error && result.error.includes('Incorrect password')) {
                            throw new Error('Incorrect password');
                        } else {
                            throw new Error(result.error || 'Authentication failed');
                        }
                    }
                    if (!response.ok) throw new Error(result.error || 'Failed to disable 2FA');

                    // Restore modal ID before removing
                    customDisableModal.id = originalId;
                    
                    // Use secret key to allow removal on success
                    customDisableModal.remove('ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE');
                    update2FAStatusText(false);
                    showNotification('🔓 Two-Factor Authentication disabled successfully.', 'success');
                } catch (error) {
                    // RESTORE modal ID immediately in error case
                    customDisableModal.id = originalId;
                    
                    // Reset button state IMMEDIATELY
                    confirmBtn.innerHTML = originalText;
                    confirmBtn.disabled = false;
                    confirmBtn.style.opacity = '1';
                    
                    // Handle error WITHOUT any external calls that might close modal
                    let errorMessage = error.message;
                    
                    // Customize error messages for better UX
                    if (errorMessage.includes('Incorrect password')) {
                        errorMessage = '❌ Incorrect password. Please try again.';
                    } else if (errorMessage.includes('session has expired') || errorMessage.includes('Authentication required')) {
                        errorMessage = '⚠️ Your session has expired. Please refresh the page and log in again.';
                        // For session expiry, we should probably close the modal and redirect
                        setTimeout(() => {
                            window.location.reload();
                        }, 3000);
                    } else if (errorMessage.includes('Failed to disable 2FA')) {
                        errorMessage = '❌ Failed to disable 2FA. Please check your password and try again.';
                    } else {
                        errorMessage = `❌ ${errorMessage}`;
                    }
                    
                    // Show error ONLY in modal - NO external calls whatsoever
                    if (errorDiv) {
                        errorDiv.textContent = errorMessage;
                        errorDiv.style.display = 'block';
                        // Hide error after 8 seconds
                        setTimeout(() => {
                            if (errorDiv && document.body.contains(errorDiv)) {
                                errorDiv.style.display = 'none';
                            }
                        }, 8000);
                    }
                    
                    // Clear password and focus for retry
                    passwordInput.value = '';
                    passwordInput.style.borderColor = '#ff4757';
                    passwordInput.focus();
                    
                    // Reset border color after animation
                    setTimeout(() => {
                        if (passwordInput && document.body.contains(passwordInput)) {
                            passwordInput.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                        }
                    }, 1000);
                    
                    // Prevent any further error propagation
                    return false;
                }
            });
            
            // Allow Enter key to submit
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && passwordInput.value) {
                    confirmBtn.click();
                }
            });
            
            // Hide error message when user starts typing
            passwordInput.addEventListener('input', () => {
                if (errorDiv && errorDiv.style.display === 'block') {
                    errorDiv.style.display = 'none';
                }
                // Reset border color when typing
                passwordInput.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            });
        }
        
        // Focus on password input
        if (passwordInput) {
            setTimeout(() => passwordInput.focus(), 100);
        }
    }

    function hideDisable2FAModal() {
        // Hide original modal if it exists
        if (disable2FAModal) disable2FAModal.classList.add('is-hidden');
        if (disable2FAForm) disable2FAForm.reset();
        
        // Remove ultra protected modal if it exists
        const ultraProtectedModal = document.getElementById('ultra-protected-disable-2fa-modal');
        if (ultraProtectedModal) {
            // Use secret key to allow removal
            ultraProtectedModal.remove('ALLOW_REMOVE_SECRET_KEY_2FA_DISABLE');
        }
        
        // Also try to remove old custom modal if it exists
        const customDisableModal = document.getElementById('custom-disable-2fa-modal');
        if (customDisableModal) {
            customDisableModal.remove();
        }
        
        // Always restore the checkbox to enabled state when modal is hidden
        // (unless 2FA was actually successfully disabled)
        const actuallyEnabled = twoFaCheckbox && twoFaCheckbox.dataset.actuallyEnabled === 'true';
        if (actuallyEnabled && twoFaCheckbox.checked === false) {
            // User cancelled the disable process, restore the enabled state
            update2FAStatusText(true);
        }
    }

    function update2FAStatusText(isEnabled) {
        if (!twoFaStatusText) return;
        
        // Update the visual status
        if (isEnabled) {
            twoFaStatusText.innerHTML = '<i class="fas fa-shield-alt" style="color: #28a745;"></i> Two-Factor Authentication is <strong>enabled</strong> and protecting your account.';
            twoFaStatusText.className = 'status-text enabled';
        } else {
            twoFaStatusText.innerHTML = '<i class="fas fa-shield-alt" style="color: #6c757d;"></i> Two-Factor Authentication is <strong>disabled</strong>. Click above to set it up.';
            twoFaStatusText.className = 'status-text disabled';
        }
        
        // Update checkbox state and store actual status
        if (twoFaCheckbox) {
            twoFaCheckbox.checked = isEnabled;
            twoFaCheckbox.dataset.actuallyEnabled = isEnabled.toString();
        }
    }

    async function handleEnable2FA() {
        // Show loading notification
        const loadingNotification = showNotification('🔄 Generating 2FA setup...', 'info');
        
        try {
            const response = await authenticatedFetch('/api/admin/2fa/generate', { method: 'POST' });
            const result = await response.json();
            
            if (response.status === 401) {
                throw new Error('Your session has expired. Please log in again.');
            }
            if (!response.ok) throw new Error(result.error || 'Could not generate QR code.');

            // Hide loading notification immediately
            if (loadingNotification) {
                loadingNotification.classList.remove('show');
                setTimeout(() => {
                    if (loadingNotification && loadingNotification.parentNode) {
                        loadingNotification.remove();
                    }
                }, 300); // Give time for transition
            }

            qrCodeContainer.innerHTML = `<img src="${result.qrCodeDataUrl}" alt="QR Code" style="max-width: 200px; border: 1px solid #ddd; padding: 10px; background: white;">`;
            
            show2FAModal();
            
            // Focus is now handled in show2FAModal function
        } catch (error) {
            // Hide loading notification immediately
            if (loadingNotification) {
                loadingNotification.classList.remove('show');
                setTimeout(() => {
                    if (loadingNotification && loadingNotification.parentNode) {
                        loadingNotification.remove();
                    }
                }, 300);
            }
            showNotification(`❌ Error enabling 2FA: ${error.message}`, 'error');
            // Reset checkbox to original state on error
            update2FAStatusText(false);
        }
    }

    async function handleDisable2FA() {
        // First check if we're still authenticated
        try {
            const testResponse = await fetch('/api/admin/config', {
                method: 'GET',
                credentials: 'include',
                headers: { 'Cache-Control': 'no-cache' }
            });
            
            if (testResponse.status === 401) {
                showNotification('⚠️ Your session has expired. Please refresh the page and log in again.', 'error');
                setTimeout(() => window.location.reload(), 2000);
                return;
            }
        } catch (error) {
            console.warn('Failed to test authentication:', error);
            // Continue anyway, the actual request will handle auth errors
        }
        
        // This function now just shows the modal. The logic is moved to the form submit handler.
        showDisable2FAModal();
    }

    if (twoFaCheckbox) {
        twoFaCheckbox.addEventListener('click', (event) => {
            // Prevent the default checkbox behavior
            event.preventDefault();
            
            // Check current actual state from server
            const currentlyEnabled = twoFaCheckbox.dataset.actuallyEnabled === 'true';
            const clickedToEnable = !currentlyEnabled;
            
            if (clickedToEnable) {
                // User wants to enable 2FA - start wizard
                handleEnable2FA();
            } else {
                // User wants to disable 2FA - immediately update visual state and show confirmation
                // Temporarily update the checkbox to show unchecked state
                twoFaCheckbox.checked = false;
                twoFaStatusText.innerHTML = '<i class="fas fa-shield-alt" style="color: #ffc107;"></i> Two-Factor Authentication is being <strong>disabled</strong>... Please confirm below.';
                twoFaStatusText.className = 'status-text warning';
                
                handleDisable2FA();
            }
        });
    }

    if (cancel2faButton) {
        cancel2faButton.addEventListener('click', () => {
            hide2FAModal();
            // Reset to actual current state (disabled)
            update2FAStatusText(false);
        });
    }

    if (twoFaVerifyForm) {
        twoFaVerifyForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const tokenInput = document.getElementById('2fa-token');
            const submitButton = event.target.querySelector('button[type="submit"]');
            const token = tokenInput.value;

            // Show loading state
            const originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
            submitButton.disabled = true;

            try {
                const response = await authenticatedFetch('/api/admin/2fa/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                const result = await response.json();
                
                if (response.status === 401) {
                    throw new Error('Your session has expired. Please log in again.');
                }
                if (!response.ok) throw new Error(result.error || 'Verification failed.');

                hide2FAModal();
                showNotification('🎉 Two-Factor Authentication enabled successfully!', 'success');
                update2FAStatusText(true);
            } catch (error) {
                showNotification(`❌ ${error.message}`, 'error');
                tokenInput.value = '';
                tokenInput.focus();
            } finally {
                // Reset button state
                submitButton.innerHTML = originalText;
                submitButton.disabled = false;
            }
        });
    }

    if (disable2FAForm) {
        disable2FAForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const passwordInput = document.getElementById('disable-2fa-password');
            const submitButton = event.target.querySelector('button[type="submit"]');
            const password = passwordInput.value;

            // Show loading state
            const originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Disabling...';
            submitButton.disabled = true;

            try {
                const response = await authenticatedFetch('/api/admin/2fa/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const result = await response.json();
                
                if (response.status === 401) {
                    throw new Error('Your session has expired. Please log in again.');
                }
                if (!response.ok) throw new Error(result.error || 'Disable failed.');

                // Update status first before hiding modal
                update2FAStatusText(false);
                hideDisable2FAModal();
                showNotification('🔓 Two-Factor Authentication disabled successfully.', 'success');
                update2FAStatusText(false);
            } catch (error) {
                showNotification(`❌ Error disabling 2FA: ${error.message}`, 'error');
                // Don't hide the modal on error, so the user can try again.
                passwordInput.value = '';
                passwordInput.focus();
            } finally {
                // Reset button state
                submitButton.innerHTML = originalText;
                submitButton.disabled = false;
            }
        });
    }

    if (cancelDisable2FAButton) {
        cancelDisable2FAButton.addEventListener('click', () => {
            hideDisable2FAModal();
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
    
    // Load cache configuration on page load with multiple attempts
    setTimeout(() => {
        loadCacheConfig();
    }, 500); // Small delay to ensure main config is loaded first
    
    // Additional attempt when management section is first viewed
    setTimeout(() => {
        loadCacheConfig();
    }, 2000); // Longer delay as backup
    
    // Track original form values to detect actual changes
    let originalConfigValues = {};
    
    // Function to capture current form state
    function captureFormState() {
        const form = document.getElementById('config-form');
        if (!form) return {};
        
        const formData = new FormData(form);
        const values = {};
        
        // Get all form inputs
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (input.type === 'checkbox') {
                values[input.id || input.name] = input.checked;
            } else if (input.type === 'radio') {
                if (input.checked) {
                    values[input.name] = input.value;
                }
            } else {
                values[input.id || input.name] = input.value;
            }
        });
        
        return values;
    }
    
    // Capture initial state after config loads
    setTimeout(() => {
        originalConfigValues = captureFormState();
    }, 1000);
    
    // Function to check if form has actually changed
    function hasFormChanged() {
        const currentValues = captureFormState();
        
        // Compare with original values
        for (const key in currentValues) {
            if (originalConfigValues[key] !== currentValues[key]) {
                return true;
            }
        }
        
        // Check for new keys
        for (const key in originalConfigValues) {
            if (!(key in currentValues)) {
                return true;
            }
        }
        
        return false;
    }
    
    // Remove automatic background initialization - it will be handled by section switching

    // Cleanup timers when page unloads
    window.addEventListener('beforeunload', () => {
        clearAllPreviewTimers();
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

     const configForm = document.getElementById('config-form');
    if (configForm) {
        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = document.getElementById('save-config-button'); // Direct ID selector instead
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
                // Primitive handling: convert empty strings to undefined sentinel (drop later)
                if (obj === '') return undefined;
                if (obj === null || typeof obj !== 'object') {
                    return obj;
                }
                if (Array.isArray(obj)) {
                    return obj
                        .map(cleanNulls)
                        .filter(item => item !== null && item !== undefined);
                }
                const newObj = {};
                for (const key in obj) {
                    const cleaned = cleanNulls(obj[key]);
                    if (cleaned !== null && cleaned !== undefined) {
                        newObj[key] = cleaned;
                    }
                }
                return newObj;
            };

            try {
                // --- Validation ---
                // Only validate Plex library selection if we're actively configuring in the media section
                const mediaSection = document.getElementById('media-section');
                const isMediaSectionActive = mediaSection && mediaSection.classList.contains('active');
                const isPlexEnabled = document.getElementById('mediaServers[0].enabled')?.checked;
                
                // Only require library selection if user is actually in media section configuring Plex
                if (isPlexEnabled && isMediaSectionActive) {
                    const selectedMovieLibs = getSelectedLibraries('movie');
                    const selectedShowLibs = getSelectedLibraries('show');

                    if (selectedMovieLibs.length === 0 && selectedShowLibs.length === 0) {
                        throw new Error('When configuring Plex in the Media section, you must select at least one movie or show library.');
                    }
                }
                
                // Allow Plex to be saved even from other sections for fanart functionality

                // --- Numeric Field Validation ---
                const numericFieldIds = [
                    'transitionIntervalSeconds', 'backgroundRefreshMinutes',
                    'SERVER_PORT', 'rottenTomatoesMinimumScore', 'effectPauseTime',
                    'mediaServers[0].movieCount', 'mediaServers[0].showCount',
                    'wallartItemsPerScreen', 'wallartColumns', 'wallartTransitionInterval',
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
                        if (id === 'wallartItemsPerScreen' && (value < 4 || value > 100)) {
                            throw new Error('Wallart items per screen must be between 4 and 100.');
                        }
                        if (id === 'wallartColumns' && (value < 2 || value > 12)) {
                            throw new Error('Wallart columns must be between 2 and 12.');
                        }
                        if (id === 'wallartTransitionInterval' && (value < 5 || value > 300)) {
                            throw new Error('Wallart transition interval must be between 5 and 300 seconds.');
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
                    // Rotten Tomatoes: minimum score applied only if badge enabled; when disabled we still send value for persistence.
                    showRottenTomatoes: getValue('showRottenTomatoes'),
                    rottenTomatoesMinimumScore: getValue('rottenTomatoesMinimumScore', 'number'),
                    showPoster: getValue('showPoster'),
                    showMetadata: getValue('showMetadata'),
                    clockWidget: getValue('clockWidget'),
                    clockTimezone: getValue('clockTimezone'),
                    clockFormat: getValue('clockFormat'),
                    wallartMode: {
                        enabled: getValue('wallartModeEnabled'),
                        density: getValue('wallartDensity'),
                        randomness: getValue('wallartRandomness', 'number'),
                        animationType: getValue('wallartAnimationType')
                    },
                    cinemaMode: getValue('cinemaMode'),
                    cinemaOrientation: getValue('cinemaOrientation'),
                    transitionEffect: getValue('transitionEffect'),
                    effectPauseTime: getValue('effectPauseTime', 'number'),
                    uiScaling: {
                        content: (()=>{ const v=getValue('uiScaling.content','number'); return Number.isFinite(v)?v:defaults.uiScaling.content; })(),
                        clearlogo: (()=>{ const v=getValue('uiScaling.clearlogo','number'); return Number.isFinite(v)?v:defaults.uiScaling.clearlogo; })(),
                        clock: (()=>{ const v=getValue('uiScaling.clock','number'); return Number.isFinite(v)?v:defaults.uiScaling.clock; })(),
                        global: (()=>{ const v=getValue('uiScaling.global','number'); return Number.isFinite(v)?v:defaults.uiScaling.global; })()
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
                        showCount: getValue('mediaServers[0].showCount', 'number'),
                        ratingFilter: getValue('mediaServers[0].ratingFilter'),
                        genreFilter: getGenreFilterValues(),
                        recentlyAddedOnly: getValue('mediaServers[0].recentlyAddedOnly'),
                        recentlyAddedDays: getValue('mediaServers[0].recentlyAddedDays', 'number'),
                        qualityFilter: getValue('mediaServers[0].qualityFilter')
                    }],
                    tmdbSource: {
                        enabled: getValue('tmdbSource.enabled'),
                        apiKey: (() => {
                            const apiKeyField = document.getElementById('tmdbSource.apiKey');
                            const enteredKey = apiKeyField ? apiKeyField.value : '';
                            const apiKeyIsSet = apiKeyField ? apiKeyField.dataset.apiKeySet === 'true' : false;
                            
                            // If user entered a new key, use it
                            if (enteredKey && enteredKey.trim() !== '') {
                                return enteredKey.trim();
                            }
                            
                            // If field is empty but there's an existing key, preserve it by returning null
                            // (null means "don't change the existing value" in the backend)
                            if (apiKeyIsSet) {
                                return null;
                            }
                            
                            // If field is empty and no key was set, use empty string
                            return '';
                        })(),
                        category: getValue('tmdbSource.category'),
                        movieCount: getValue('tmdbSource.movieCount', 'number'),
                        showCount: getValue('tmdbSource.showCount', 'number'),
                        minRating: getValue('tmdbSource.minRating', 'number'),
                        yearFilter: getValue('tmdbSource.yearFilter', 'number'),
                        genreFilter: getTMDBGenreFilterValues()
                    },
                    tvdbSource: {
                        enabled: getValue('tvdbSource.enabled'),
                        category: getValue('tvdbSource.category'),
                        movieCount: getValue('tvdbSource.movieCount', 'number'),
                        showCount: getValue('tvdbSource.showCount', 'number'),
                        minRating: getValue('tvdbSource.minRating', 'number'),
                        yearFilter: getValue('tvdbSource.yearFilter', 'number'),
                        genreFilter: getTVDBGenreFilterValues()
                    },
                    streamingSources: {
                        enabled: getValue('streamingSources.enabled'),
                        region: getValue('streamingSources.region'),
                        maxItems: getValue('streamingSources.maxItems', 'number'),
                        minRating: getValue('streamingSources.minRating', 'number'),
                        netflix: getValue('streamingSources.netflix'),
                        disney: getValue('streamingSources.disney'),
                        prime: getValue('streamingSources.prime'),
                        hbo: getValue('streamingSources.hbo'),
                        newReleases: getValue('streamingSources.newReleases')
                    },
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

                // Coordinate with auto-save to avoid race
                window.__saveCoordinator = window.__saveCoordinator || { 
                    manualInProgress: false,
                    lastRequestAt: 0,
                    lastManualAt: 0
                };
                window.__saveCoordinator.manualInProgress = true;
                // Don't set lastRequestAt for manual saves - only auto-saves use this for rate limiting
                
                // Debug: Log request data
                console.log('🔍 Saving config with data:', {
                    configSize: JSON.stringify(cleanedConfig).length,
                    envSize: JSON.stringify(newEnv).length,
                    totalSize: JSON.stringify({ config: cleanedConfig, env: newEnv }).length
                });
                
                const requestBody = JSON.stringify({ config: cleanedConfig, env: newEnv });
                
                // If request is large, add additional headers to help with HTTP/2 issues
                const requestOptions = {
                    method: 'POST',
                    body: requestBody
                };
                
                if (requestBody.length > 50000) {
                    console.warn('⚠️ Large request detected, adding HTTP/2 compatibility headers');
                    requestOptions.headers = {
                        'Content-Length': requestBody.length.toString(),
                        'Transfer-Encoding': 'chunked'
                    };
                }
                
                
                // Retry mechanism for network errors
                let lastError;
                let retryCount = 0;
                const maxRetries = 3;
                
                while (retryCount <= maxRetries) {
                    try {
                        if (retryCount > 0) {
                            buttonTextSpan.textContent = `Retrying... (${retryCount}/${maxRetries})`;
                            await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
                        }
                        
                        const response = await authenticatedFetch(apiUrl('/api/admin/config'), requestOptions);

                        if (!response.ok) {
                            // Try to get error message from response
                            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                            try {
                                const errorResult = await response.json();
                                if (errorResult.error) {
                                    errorMessage = errorResult.error;
                                }
                            } catch (jsonError) {
                                // If response is not JSON, use status text
                                console.warn('Response is not JSON, using status text as error');
                            }
                            
                            // Retry on 502 Bad Gateway or 503 Service Unavailable
                            if ((response.status === 502 || response.status === 503) && retryCount < maxRetries) {
                                lastError = new Error(errorMessage);
                                retryCount++;
                                continue;
                            }
                            
                            throw new Error(errorMessage);
                        }

                        const result = await response.json();

                        // Config saved successfully - check if restart is needed
                        showNotification('Settings saved successfully!', 'success');
                        
                        // Only show restart button if form actually changed
                        if (hasFormChanged()) {
                            showRestartButton();
                        }
                        
                        // Update original values after successful save
                        originalConfigValues = captureFormState();
                        
                        if (window.__saveCoordinator) {
                            window.__saveCoordinator.lastManualAt = Date.now();
                        }
                        // Notify form tracking listeners
                        document.dispatchEvent(new CustomEvent('configSaved'));
                        return; // Success - exit retry loop
                        
                    } catch (error) {
                        lastError = error;
                        
                        // Check if this is a retryable error
                        const isRetryable = error.message.includes('502') || 
                                          error.message.includes('503') || 
                                          error.message.includes('Failed to fetch') ||
                                          error.message.includes('ERR_HTTP2_PROTOCOL_ERROR');
                        
                        if (isRetryable && retryCount < maxRetries) {
                            retryCount++;
                            continue;
                        }
                        
                        // Not retryable or max retries reached
                        break;
                    }
                }
                
                // If we get here, all retries failed
                throw lastError;

            } catch (error) {
                console.error('Failed to save config:', error);
                showNotification(`Error saving settings: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
                buttonTextSpan.textContent = originalButtonText;
                if (window.__saveCoordinator) {
                    window.__saveCoordinator.manualInProgress = false;
                }
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
            button.dataset.originalText = buttonTextSpan ? buttonTextSpan.textContent : button.textContent;
            button.dataset.originalIconClass = icon ? icon.className : '';
            button.dataset.originalButtonClass = button.className;
        }

        switch (state) {
            case 'loading':
                button.disabled = true;
                if (buttonTextSpan) {
                    buttonTextSpan.textContent = options.text || 'Working...';
                } else {
                    button.textContent = options.text || 'Working...';
                }
                if (icon) {
                    icon.className = options.iconClass || 'fas fa-spinner fa-spin';
                }
                button.className = button.dataset.originalButtonClass;
                break;
            case 'success':
            case 'error':
                button.disabled = true; // Keep disabled until revert
                if (buttonTextSpan) {
                    buttonTextSpan.textContent = options.text || (state === 'success' ? 'Success!' : 'Failed');
                } else {
                    button.textContent = options.text || (state === 'success' ? 'Success!' : 'Failed');
                }
                if (icon) {
                    icon.className = options.iconClass || (state === 'success' ? 'fas fa-check' : 'fas fa-exclamation-triangle');
                }
                button.className = `${button.dataset.originalButtonClass} ${options.buttonClass || (state === 'success' ? 'is-success' : 'is-danger')}`;
                break;
            case 'revert':
                button.disabled = false;
                if (buttonTextSpan) {
                    buttonTextSpan.textContent = button.dataset.originalText;
                } else {
                    button.textContent = button.dataset.originalText;
                }
                if (icon) {
                    icon.className = button.dataset.originalIconClass;
                }
                button.className = button.dataset.originalButtonClass;
                break;
        }
    }

    const restartButton = document.getElementById('restart-app-button');
    if (restartButton) {
        addConfirmClickHandler(restartButton, 'Are you sure? Click again', async () => {
             setButtonState(restartButton, 'loading', { text: 'Restarting...' });

             const handleRestartInitiated = (message) => {
                 showNotification(message || 'Restart initiated.', 'success');
                 // After a short delay, show completion and then re-enable for another attempt without full page reload.
                 setTimeout(() => {
                     showNotification('Restart complete (refresh page if UI seems stale).', 'success');
                     setButtonState(restartButton, 'success', { text: 'Restart Complete' });
                     // Revert after a further delay so user can restart again later if needed.
                     setTimeout(()=> setButtonState(restartButton, 'revert'), 4000);
                 }, 2500);
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

    // Status Check Button
    const statusCheckButton = document.getElementById('status-check-button');
    if (statusCheckButton) {
        statusCheckButton.addEventListener('click', async () => {
            setButtonState(statusCheckButton, 'loading', { text: 'Checking...' });
            
            try {
                await performStatusCheck();
                setButtonState(statusCheckButton, 'success', { text: 'Status Checked' });
                setTimeout(() => setButtonState(statusCheckButton, 'revert'), 2000);
            } catch (error) {
                console.error('[Admin] Error during status check:', error);
                showNotification(`Error checking status: ${error.message}`, 'error');
                setButtonState(statusCheckButton, 'revert');
            }
        });
    }

    // Update Check Button - REMOVED (functionality moved to Automatic Updates section)
    // const updateCheckButton = document.getElementById('update-check-button');
    // Button removed from HTML to avoid duplication with Automatic Updates

    // Performance Monitor Button
    const performanceMonitorButton = document.getElementById('performance-monitor-button');
    if (performanceMonitorButton) {
        performanceMonitorButton.addEventListener('click', async () => {
            setButtonState(performanceMonitorButton, 'loading', { text: 'Loading...' });
            
            try {
                await loadPerformanceMonitor();
                setButtonState(performanceMonitorButton, 'success', { text: 'Monitor Loaded' });
                setTimeout(() => setButtonState(performanceMonitorButton, 'revert'), 2000);
            } catch (error) {
                console.error('[Admin] Error loading performance monitor:', error);
                showNotification(`Error loading performance data: ${error.message}`, 'error');
                setButtonState(performanceMonitorButton, 'revert');
            }
        });
    }

    // Auto-Update: Start Auto-Update Button - NUCLEAR OPTION: Clear all existing listeners
    const startAutoUpdateButton = document.getElementById('start-auto-update-button');
    if (startAutoUpdateButton) {
        // Remove any existing event listeners by cloning the element
        const newButton = startAutoUpdateButton.cloneNode(true);
        startAutoUpdateButton.parentNode.replaceChild(newButton, startAutoUpdateButton);
        
        // Add single clean event listener
        newButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            // Check if button is in updating state
            if (newButton.getAttribute('data-updating') === 'true') {
                return;
            }
            
            // Open the confirmation modal
            openUpdateConfirmationModal();
        });
    }

    // Auto-Update: Rollback Button
    const rollbackUpdateButton = document.getElementById('rollback-update-button');
    if (rollbackUpdateButton) {
        rollbackUpdateButton.addEventListener('click', rollbackUpdate);
    }

    // Auto-Update: List Backups Button
    const listBackupsButton = document.getElementById('list-backups-button');
    if (listBackupsButton) {
        listBackupsButton.addEventListener('click', async () => {
            setButtonState(listBackupsButton, 'loading', { text: 'Loading...' });
            
            try {
                await loadBackupList();
                setButtonState(listBackupsButton, 'success', { text: 'Backups Loaded' });
                setTimeout(() => setButtonState(listBackupsButton, 'revert'), 2000);
            } catch (error) {
                console.error('[Admin] Error loading backups:', error);
                showNotification(`Error loading backups: ${error.message}`, 'error');
                setButtonState(listBackupsButton, 'revert');
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
                // Refresh cache stats after clearing
                refreshCacheStats();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
            setTimeout(() => setButtonState(clearCacheButton, 'revert'), 2000);
        });
    }

    // Cache stats refresh button
    const refreshCacheStatsButton = document.getElementById('refresh-cache-stats');
    if (refreshCacheStatsButton) {
        refreshCacheStatsButton.addEventListener('click', async () => {
            setButtonState(refreshCacheStatsButton, 'loading', { text: 'Refreshing...' });
            await refreshCacheStats();
            setTimeout(() => setButtonState(refreshCacheStatsButton, 'revert'), 1000);
        });
    }

    // Cache cleanup button
    const cleanupCacheButton = document.getElementById('cleanup-cache-button');
    if (cleanupCacheButton) {
        cleanupCacheButton.addEventListener('click', async () => {
            setButtonState(cleanupCacheButton, 'loading', { text: 'Cleaning...' });
            try {
                const response = await fetch('/api/admin/cleanup-cache', { method: 'POST' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to cleanup cache.');
                showNotification(result.message, 'success');
                // Refresh cache stats after cleanup
                refreshCacheStats();
            } catch (error) {
                showNotification(`Error: ${error.message}`, 'error');
            }
            setTimeout(() => setButtonState(cleanupCacheButton, 'revert'), 2000);
        });
    }

/**
 * Setup event listeners for cache configuration inputs
 */
function setupCacheConfigEventListeners() {
    console.log('[Cache Config] Cache configuration fields have been removed from UI');
    
    // Since cache configuration fields have been removed, just log that cache is auto-managed
    console.log('[Cache Config] Cache is auto-managed with fixed settings: 5GB max, 500MB min free space');
    
    // Clean up any existing auto-managed notices (user requested removal)
    const existingNotices = document.querySelectorAll('.auto-managed-notice');
    existingNotices.forEach(notice => notice.remove());
}

    // Load cache stats when Management section is first accessed
    // Test: Also load stats on page load for debugging
    setTimeout(() => {
        // Also test if DOM elements exist
        const diskUsageElement = document.getElementById('cache-disk-usage');
        const itemCountElement = document.getElementById('cache-item-count');
        if (diskUsageElement && itemCountElement) {
            loadCacheStats();
        }
    }, 2000);

    updateApiKeyStatus();

    // Preview functionality removed

    function updatePreviewOrientation() { /* removed */ }

    function updatePreview() { /* removed */ }

    // Removed preview timer logic

    function clearAllPreviewTimers() { /* removed */ }

    function updatePreviewElements() { /* removed */ }

    function updateCinemaPreview() { /* removed */ }

    function updateNormalPreview() { /* removed */ }

    function restoreNormalPreviewStructure() { /* removed */ }

    function updatePreviewClock() { /* removed */ }

    function updatePreviewWithMockData() { /* removed */ }

    function setupLivePreviewUpdates() { /* removed */ }

    function setupPreviewTimerListener() { /* removed */ }

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
            
            // Initial state handled once inside populateDisplaySettings to avoid duplicate invocation here.
        }
        
        // Add event listener for cinema orientation changes
        if (cinemaOrientationSelect) {
            cinemaOrientationSelect.addEventListener('change', () => {
                console.log('Cinema orientation changed:', cinemaOrientationSelect.value);
                updatePreviewOrientation();
            });
        }
    }

    function setupWallartModeListeners() {
        const wallartModeCheckbox = document.getElementById('wallartModeEnabled');
        const wallartSettingsGroup = document.getElementById('wallartSettingsGroup');
        const randomnessSlider = document.getElementById('wallartRandomness');
        
        if (wallartModeCheckbox) {
            wallartModeCheckbox.addEventListener('change', () => {
                const isWallartMode = wallartModeCheckbox.checked;
                
                // Show/hide wallart settings
                if (wallartSettingsGroup) {
                    wallartSettingsGroup.style.display = isWallartMode ? 'block' : 'none';
                    if (isWallartMode) {
                        wallartSettingsGroup.classList.remove('hidden');
                    } else {
                        wallartSettingsGroup.classList.add('hidden');
                    }
                }
                
                // Show/hide cinema mode and visual elements when wallart mode is active
                toggleWallartModeSettings(isWallartMode);
                
                console.log('Wallart mode toggled:', isWallartMode ? 'enabled' : 'disabled');
            });
        }
        
        // Setup randomness slider
        if (randomnessSlider) {
            randomnessSlider.addEventListener('input', () => {
                updateRandomnessLabel(randomnessSlider.value);
            });
        }
    }

    function toggleWallartModeSettings(isWallartMode) {
        // Hide Cinema Mode section when wallart mode is active
        const cinemaModeHeader = document.getElementById('cinemaModeHeader');
        const cinemaModeContent = document.getElementById('cinemaModeContent');
        
        if (cinemaModeHeader && cinemaModeContent) {
            cinemaModeHeader.style.display = isWallartMode ? 'none' : 'block';
            cinemaModeContent.style.display = isWallartMode ? 'none' : 'block';
        }
        
        // Hide Visual Elements section when wallart mode is active
        const visualElementsHeader = document.getElementById('visualElementsHeader');
        const visualElementsContent = document.getElementById('visualElementsContent');
        
        if (visualElementsHeader && visualElementsContent) {
            visualElementsHeader.style.display = isWallartMode ? 'none' : 'block';
            visualElementsContent.style.display = isWallartMode ? 'none' : 'block';
        }
        
        // If wallart mode is enabled, disable cinema mode
        if (isWallartMode) {
            const cinemaModeCheckbox = document.getElementById('cinemaMode');
            if (cinemaModeCheckbox && cinemaModeCheckbox.checked) {
                cinemaModeCheckbox.checked = false;
                // Reset cinema mode settings
                toggleCinemaModeSettings(false);
            }
        }
    }

    function toggleCinemaModeSettings(isCinemaMode) {
        // Preserve user preference for Ken Burns effect when toggling cinema mode
        const transitionEffectSelect = document.getElementById('transitionEffect');
        if (!isCinemaMode && transitionEffectSelect && transitionEffectSelect.value === 'kenburns') {
            window.__wantedKenBurnsBeforeCinema = true;
        }
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
        
        // Handle Ken Burns option with restoration after exiting cinema mode
        if (transitionEffectSelect) {
            const kenBurnsOption = transitionEffectSelect.querySelector('option[value="kenburns"]');
            if (kenBurnsOption) {
                if (isCinemaMode) {
                    kenBurnsOption.style.display = 'none';
                    if (transitionEffectSelect.value === 'kenburns') {
                        window.__wantedKenBurnsBeforeCinema = true; // remember preference
                        transitionEffectSelect.value = 'fade';
                        console.log('[CinemaMode] Temporarily switched Ken Burns to Fade');
                    }
                } else {
                    kenBurnsOption.style.display = 'block';
                    if (window.__wantedKenBurnsBeforeCinema) {
                        transitionEffectSelect.value = 'kenburns';
                        delete window.__wantedKenBurnsBeforeCinema;
                    }
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
            }
        }
    }

    // applyScalingToPreview removed (no preview UI)

    // Save configuration without showing notifications and clear cache
    async function saveConfigurationSilently() {
        // Coordinated auto-save to avoid race with manual save
        window.__saveCoordinator = window.__saveCoordinator || {
            manualInProgress: false,
            autoInProgress: false,
            pending: false,
            lastManualAt: 0,
            lastAutoAt: 0,
            lastRequestAt: 0
        };
        const state = window.__saveCoordinator;

        // Add rate limiting: don't allow AUTO-SAVE requests more than once per second
        // (Manual saves should not be rate limited)
        const now = Date.now();
        if (now - state.lastRequestAt < 1000) {
            console.log('⏳ Rate limiting: skipping auto-save (too soon since last request)');
            return;
        }

        // If a manual save just happened (<2s), skip auto-save
        if (now - state.lastManualAt < 2000) {
            console.log('⏳ Skipping auto-save: manual save happened recently');
            return;
        }
        // If another auto save is running, mark pending and exit
        if (state.autoInProgress || state.manualInProgress) {
            state.pending = true;
            return;
        }
        state.autoInProgress = true;
        state.pending = false;
        state.lastRequestAt = now;
        
        try {
            // Fetch latest to merge safely
            const currentConfigResponse = await fetch('/api/admin/config');
            if (!currentConfigResponse.ok) {
                console.error('Auto-save: failed to fetch current config for merge');
                return;
            }
            const currentData = await currentConfigResponse.json();
            const configData = JSON.parse(JSON.stringify(currentData.config));
            const envData = { ...currentData.env };

            const displayInputs = [
                'showClearLogo','showRottenTomatoes','rottenTomatoesMinimumScore','showPoster','showMetadata','clockWidget','clockTimezone','clockFormat'
            ];
            const uiScalingInputs = ['uiScaling.content','uiScaling.clearlogo','uiScaling.clock','uiScaling.global'];
            const updates = {};

            displayInputs.forEach(fieldName => {
                const input = document.querySelector(`[name="${fieldName}"]`);
                if (!input) return;
                let newValue;
                if (input.type === 'checkbox') newValue = input.checked; else if (input.type === 'number') newValue = parseFloat(input.value) || 0; else newValue = input.value;
                if (configData[fieldName] !== newValue) {
                    configData[fieldName] = newValue;
                    updates[fieldName] = newValue;
                }
            });
            if (!configData.uiScaling) configData.uiScaling = {};
            uiScalingInputs.forEach(path => {
                const field = path.split('.')[1];
                const input = document.getElementById(path);
                if (!input) return;
                const trimmed = (input.value || '').trim();
                if (trimmed === '') return; // don't overwrite with default if user cleared
                const parsed = Number(trimmed);
                if (!Number.isFinite(parsed)) return;
                if (configData.uiScaling[field] !== parsed) {
                    configData.uiScaling[field] = parsed;
                    updates[path] = parsed;
                }
            });

            if (Object.keys(updates).length === 0) {
                return; // nothing changed
            }

            const resp = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: configData, env: envData })
            });
            if (resp.ok) {
                state.lastAutoAt = Date.now();
                document.dispatchEvent(new CustomEvent('configSaved'));
            } else {
                const t = await resp.text();
                console.error('Auto-save failed:', resp.status, resp.statusText, t);
            }
        } catch (err) {
            console.error('Auto-save error:', err);
        } finally {
            state.autoInProgress = false;
            if (state.pending) {
                // Schedule next cycle with microtask + rAF for responsiveness instead of fixed 200ms
                state.pending = false;
                queueMicrotask(() => requestAnimationFrame(() => saveConfigurationSilently()));
            }
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

    // (Preview initialization removed)

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

                    // preview hook removed

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
            const valueDisplay = document.querySelector(`[data-target="uiScaling.${key}"]`);
            
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

// End cleanup: preview/PiP code fully removed

// Event listeners for inline event handler replacements
document.addEventListener('DOMContentLoaded', () => {
    // Number input increment/decrement buttons
    const incrementButtons = document.querySelectorAll('[id^="increment-"]');
    const decrementButtons = document.querySelectorAll('[id^="decrement-"]');
    
    incrementButtons.forEach(button => {
        button.addEventListener('click', () => {
            const fieldName = button.id.replace('increment-', '');
            incrementValue(fieldName);
        });
    });
    
    decrementButtons.forEach(button => {
        button.addEventListener('click', () => {
            const fieldName = button.id.replace('decrement-', '');
            decrementValue(fieldName);
        });
    });
    
    // Scaling template buttons
    const fullhdTemplateBtn = document.getElementById('apply-fullhd-template');
    const fourKTemplateBtn = document.getElementById('apply-4k-template');
    const widescreenTemplateBtn = document.getElementById('apply-widescreen-template');
    const resetScalingBtn = document.getElementById('reset-scaling-defaults');
    
    if (fullhdTemplateBtn) {
        fullhdTemplateBtn.addEventListener('click', () => applyScalingTemplate('fullhd'));
    }
    if (fourKTemplateBtn) {
        fourKTemplateBtn.addEventListener('click', () => applyScalingTemplate('4k'));
    }
    if (widescreenTemplateBtn) {
        widescreenTemplateBtn.addEventListener('click', () => applyScalingTemplate('widescreen'));
    }
    if (resetScalingBtn) {
        resetScalingBtn.addEventListener('click', () => resetScalingToDefaults());
    }
    
    // Simple help panel - no complex event listeners needed
    // Button has onclick="toggleHelpPanel()" in HTML
});

// Function to scroll to a specific subsection
function scrollToSubsection(subsectionId) {
    const element = document.getElementById(subsectionId);
    if (element) {
        // Close help panel first
        const helpPanel = document.getElementById('quick-help-panel');
        if (helpPanel && helpPanel.classList.contains('open')) {
            helpPanel.classList.remove('open');
        }
        
        // Scroll to the subsection with smooth behavior
        element.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start',
            inline: 'nearest'
        });
        
        // Add a subtle highlight effect
        element.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
        element.style.transition = 'background-color 0.3s ease';
        setTimeout(() => {
            element.style.backgroundColor = '';
        }, 2000);
    }
}

// TVDB Connection Test
async function testTVDBConnection() {
    const testButton = document.getElementById('test-tvdb-connection');
    const statusElement = document.getElementById('tvdb-connection-status');
    
    if (!testButton || !statusElement) return;
    
    // Disable button and show loading state
    testButton.disabled = true;
    testButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
    statusElement.textContent = 'Testing TVDB connection...';
    statusElement.style.color = '#ffd93d';
    
    try {
        const response = await fetch('/api/admin/test-tvdb', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            statusElement.textContent = `✅ Connection successful! Found ${result.sampleData?.length || 0} sample items.`;
            statusElement.style.color = '#51cf66';
            
            // Automatically load TVDB genres after successful connection
            try {
                await window.loadTVDBGenres();
                showNotification('TVDB connection successful and genres loaded', 'success');
            } catch (genreError) {
                console.warn('Failed to load TVDB genres:', genreError);
                showNotification('TVDB connection successful, but genres could not be loaded', 'error');
            }
        } else {
            throw new Error(result.error || 'Connection test failed');
        }
    } catch (error) {
        statusElement.textContent = `❌ Connection failed: ${error.message}`;
        statusElement.style.color = '#ff6b6b';
        showNotification(`TVDB connection failed: ${error.message}`, 'error');
    } finally {
        // Re-enable button
        testButton.disabled = false;
        testButton.innerHTML = '<i class="fas fa-plug icon"></i><span>Test TVDB Connection</span>';
    }
}

// Add event listener for TVDB test button
document.addEventListener('DOMContentLoaded', () => {
    const testButton = document.getElementById('test-tvdb-connection');
    if (testButton) {
        testButton.addEventListener('click', testTVDBConnection);
    }
});

// ===================================
// Cache Statistics Functions
// ===================================

/**
 * Format bytes into human readable format
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Load cache statistics
 */
async function loadCacheStats() {
    try {
        await refreshCacheStats();
    } catch (error) {
        console.error('Error loading cache stats:', error);
        updateCacheStatsDisplay({ 
            diskUsage: { total: 0 }, 
            itemCount: { total: 0 } 
        }, true);
    }
}

/**
 * Refresh cache statistics from server
 */
async function refreshCacheStats() {
    try {
        const response = await authenticatedFetch(apiUrlWithCacheBust('/api/admin/cache-stats'), {
            method: 'GET'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        updateCacheStatsDisplay(data);
        
    } catch (error) {
        console.error('Error refreshing cache stats:', error);
        updateCacheStatsDisplay({ 
            diskUsage: { total: 0 }, 
            itemCount: { total: 0 } 
        }, true);
    }
}

/**
 * Update cache statistics display
 */
function updateCacheStatsDisplay(data, isError = false) {
    const diskUsageElement = document.getElementById('cache-disk-usage');
    const itemCountElement = document.getElementById('cache-item-count');
    
    if (!diskUsageElement || !itemCountElement) {
        // Retry after a delay in case DOM isn't ready
        setTimeout(() => {
            const retryDiskUsage = document.getElementById('cache-disk-usage');
            const retryItemCount = document.getElementById('cache-item-count');
            if (retryDiskUsage && retryItemCount) {
                updateCacheStatsDisplay(data, isError);
            }
        }, 1000);
        return;
    }
    
    if (isError) {
        diskUsageElement.innerHTML = '<span class="error">Error loading</span>';
        itemCountElement.innerHTML = '<span class="error">Error loading</span>';
        return;
    }
    
    // Update disk usage with combined format: "1.2 GB / 5.0 GB (24%)"
    const totalSize = data.diskUsage?.total || 0;
    const imageCacheSize = data.diskUsage?.imageCache || 0;
    const logSize = data.diskUsage?.logFiles || 0;
    
    // Use hardcoded max cache size (5GB)
    const maxSizeGB = 5;
    const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024; // Convert GB to bytes
    
    // Calculate usage percentage
    const usagePercentage = maxSizeBytes > 0 ? Math.round((imageCacheSize / maxSizeBytes) * 100) : 0;
    
    diskUsageElement.innerHTML = `
        <div>${formatBytes(imageCacheSize)} / ${formatBytes(maxSizeBytes)} (${usagePercentage}%)</div>
        <div class="size-bytes">Logs: ${formatBytes(logSize)} | Total: ${formatBytes(totalSize)}</div>
    `;
    
    // Update item count (Memory cache items)
    const totalItems = data.itemCount?.total || 0;
    
    itemCountElement.innerHTML = `
        <div>${totalItems.toLocaleString()}</div>
        <div class="size-bytes">Active in RAM</div>
    `;
}

/**
 * Load hardcoded cache configuration
 * Cache limits are now fixed and hidden from the UI
 */
async function loadCacheConfig() {
    // Cache configuration fields have been removed from the UI
    // Configuration is now hardcoded in the backend
}

/**
 * Cache configuration save function - no longer needed since fields are removed
 */
async function saveCacheConfig() {
    console.log('[Cache Config] Save attempted - cache configuration fields have been removed');
    
    if (typeof showNotification === 'function') {
        showNotification('Cache is automatically managed with optimal settings (5GB max, 500MB min free)', 'info');
    }
}

// ===================================
// Global Test Functions for Debugging
// ===================================
// Management Section Observer  
// ===================================

// Watch for management section becoming visible
const managementObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const managementSection = document.getElementById('management-section');
            if (managementSection && managementSection.style.display !== 'none') {
                console.log('Management section is now visible, loading cache stats and update status...');
                loadCacheStats();
                loadUpdateStatus();
            }
        }
    });
});

// Start observing when DOM is ready
setTimeout(() => {
    const managementSection = document.getElementById('management-section');
    if (managementSection) {
        managementObserver.observe(managementSection, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
        
        // Check if management section is already visible
        if (managementSection.style.display !== 'none' && managementSection.classList.contains('active')) {
            console.log('Management section is already visible, loading cache stats and update status...');
            loadCacheStats();
            loadUpdateStatus();
        }
    }
}, 1000);

// ===================================
// System Control Functions
// ===================================

/**
 * Hide all status displays
 */
function hideAllStatusDisplays() {
    // Stop any running auto-refresh when switching displays
    stopAutoRefresh();
    
    const displays = ['status-display', 'update-display', 'performance-display'];
    displays.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = 'none';
        }
    });
}

/**
 * Perform system status check
 */
async function performStatusCheck() {
    hideAllStatusDisplays(); // Hide other displays first
    
    const statusDisplay = document.getElementById('status-display');
    const statusContent = document.getElementById('status-content');
    
    if (!statusDisplay || !statusContent) return;
    
    statusDisplay.style.display = 'block';
    statusContent.innerHTML = '<div class="loading">Checking system status...</div>';
    
    try {
        const response = await fetch('/api/admin/status', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayStatusResults(data);
        
        // Start auto-refresh for status check
        startAutoRefresh('status', 30); // Refresh every 30 seconds
    } catch (error) {
        console.error('Status check failed:', error);
        statusContent.innerHTML = `<div class="status-error">Failed to check system status: ${error.message}</div>`;
    }
}

/**
 * Display status check results
 */
function displayStatusResults(data) {
    const statusContent = document.getElementById('status-content');
    if (!statusContent) return;
    
    const statusItems = [
        { label: 'Application', value: data.app?.status || 'Unknown', icon: 'fas fa-cog', status: data.app?.status === 'running' ? 'success' : 'error' },
        { label: 'Database', value: data.database?.status || 'Unknown', icon: 'fas fa-database', status: data.database?.status === 'connected' ? 'success' : 'error' },
        { label: 'Cache', value: data.cache?.status || 'Unknown', icon: 'fas fa-memory', status: data.cache?.status === 'active' ? 'success' : 'warning' },
        { label: 'Disk Space', value: data.disk?.available || 'Unknown', icon: 'fas fa-hdd', status: data.disk?.status || 'info' },
        { label: 'Memory Usage', value: data.memory?.usage || 'Unknown', icon: 'fas fa-microchip', status: data.memory?.status || 'info' },
        { label: 'Uptime', value: data.uptime || 'Unknown', icon: 'fas fa-clock', status: 'info' }
    ];
    
    statusContent.innerHTML = `
        <div class="status-grid">
            ${statusItems.map(item => `
                <div class="status-item">
                    <div class="status-item-header">
                        <i class="${item.icon}"></i>
                        ${item.label}
                    </div>
                    <div class="status-item-value status-${item.status}">
                        ${item.value}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Check for application updates
 */
async function performUpdateCheck() {
    hideAllStatusDisplays(); // Hide other displays first
    
    const updateDisplay = document.getElementById('update-display');
    const updateContent = document.getElementById('update-content');
    
    if (!updateDisplay || !updateContent) return;
    
    updateDisplay.style.display = 'block';
    updateContent.innerHTML = '<div class="loading">Checking for updates...</div>';
    
    try {
        const response = await fetch('/api/admin/update-check', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayUpdateResults(data);
    } catch (error) {
        console.error('Update check failed:', error);
        updateContent.innerHTML = `<div class="status-error">Failed to check for updates: ${error.message}</div>`;
    }
}

/**
 * Display update check results
 */
function displayUpdateResults(data) {
    const updateContent = document.getElementById('update-content');
    if (!updateContent) return;
    
    const currentVersion = data.currentVersion || 'Unknown';
    const latestVersion = data.latestVersion || 'Unknown';
    const hasUpdate = data.hasUpdate || data.updateAvailable || false; // Support both old and new format
    const updateType = data.updateType || null;
    const releaseUrl = data.releaseUrl || null;
    const publishedAt = data.publishedAt || null;
    const releaseName = data.releaseName || null;
    const releaseNotes = data.releaseNotes || null;
    
    // Format published date
    let publishedText = '';
    if (publishedAt) {
        try {
            const date = new Date(publishedAt);
            publishedText = date.toLocaleDateString();
        } catch (e) {
            publishedText = publishedAt;
        }
    }
    
    updateContent.innerHTML = `
        <div class="status-grid">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-tag"></i>
                    Installed Version
                </div>
                <div class="status-item-value status-info">
                    ${currentVersion}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fab fa-github"></i>
                    Latest Release
                </div>
                <div class="status-item-value status-info">
                    ${latestVersion}${publishedText ? ` (${publishedText})` : ''}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-exclamation-circle"></i>
                    Update Status
                </div>
                <div class="status-item-value ${hasUpdate ? 'status-warning' : 'status-success'}">
                    ${hasUpdate ? `Update Available${updateType ? ` (${updateType})` : ''}` : 'Up to Date'}
                </div>
            </div>
        </div>
        ${hasUpdate ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(255, 152, 0, 0.1); border: 1px solid rgba(255, 152, 0, 0.3); border-radius: 6px;">
                <div style="margin-bottom: 1rem;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #ff9800;">
                        <i class="fas fa-download"></i> 
                        ${releaseName || `Version ${latestVersion}`} Available
                    </h4>
                    ${releaseNotes ? `
                        <div style="margin: 0.5rem 0; padding: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 0.85rem; color: #ccc; white-space: pre-wrap; max-height: 150px; overflow-y: auto;">
                            ${releaseNotes.substring(0, 500)}${releaseNotes.length > 500 ? '...' : ''}
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    ${releaseUrl ? `
                        <a href="${releaseUrl}" target="_blank" class="btn btn-primary" style="flex: 1; min-width: 120px; text-align: center;">
                            <i class="fab fa-github"></i> View Release
                        </a>
                    ` : ''}
                    <a href="https://github.com/Posterrama/posterrama/releases/latest" target="_blank" class="btn btn-secondary" style="flex: 1; min-width: 120px; text-align: center;">
                        <i class="fas fa-download"></i> Download
                    </a>
                </div>
            </div>
        ` : ''}
        ${data.error ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px;">
                <p style="margin: 0; color: #f44336;">
                    <i class="fas fa-exclamation-triangle"></i> 
                    ${data.error}
                </p>
            </div>
        ` : ''}
    `;
}

/**
 * Load performance monitoring data
 */
async function loadPerformanceMonitor() {
    hideAllStatusDisplays(); // Hide other displays first
    
    const performanceDisplay = document.getElementById('performance-display');
    const performanceContent = document.getElementById('performance-content');
    
    if (!performanceDisplay || !performanceContent) return;
    
    performanceDisplay.style.display = 'block';
    performanceContent.innerHTML = '<div class="loading">Loading performance data...</div>';
    
    try {
        const response = await fetch('/api/admin/performance', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayPerformanceResults(data);
        
        // Start auto-refresh for performance monitor
        startAutoRefresh('performance', 5); // Refresh every 5 seconds
    } catch (error) {
        console.error('Performance monitoring failed:', error);
        performanceContent.innerHTML = `<div class="status-error">Failed to load performance data: ${error.message}</div>`;
    }
}

/**
 * Display performance monitoring results
 */
function displayPerformanceResults(data) {
    const performanceContent = document.getElementById('performance-content');
    if (!performanceContent) return;
    
    const cpu = data.cpu || {};
    const memory = data.memory || {};
    const disk = data.disk || {};
    
    performanceContent.innerHTML = `
        <div class="performance-metric">
            <div class="metric-label">
                <span><i class="fas fa-microchip"></i> CPU Usage</span>
                <span>${cpu.usage || '0'}%</span>
            </div>
            <div class="metric-bar">
                <div class="metric-fill ${getMetricClass(cpu.usage)}" style="width: ${cpu.usage || 0}%"></div>
            </div>
        </div>
        
        <div class="performance-metric">
            <div class="metric-label">
                <span><i class="fas fa-memory"></i> Memory Usage</span>
                <span>${memory.usage || '0'}% (${memory.used || '0 MB'} / ${memory.total || '0 MB'})</span>
            </div>
            <div class="metric-bar">
                <div class="metric-fill ${getMetricClass(memory.usage)}" style="width: ${memory.usage || 0}%"></div>
            </div>
        </div>
        
        <div class="performance-metric">
            <div class="metric-label">
                <span><i class="fas fa-hdd"></i> Disk Usage</span>
                <span>${disk.usage || '0'}% (${disk.used || '0 GB'} / ${disk.total || '0 GB'})</span>
            </div>
            <div class="metric-bar">
                <div class="metric-fill ${getMetricClass(disk.usage)}" style="width: ${disk.usage || 0}%"></div>
            </div>
        </div>
        
        <div class="status-grid" style="margin-top: 1.5rem;">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-chart-line"></i>
                    Load Average
                </div>
                <div class="status-item-value status-info">
                    ${cpu.loadAverage || 'N/A'}
                </div>
                <div style="font-size: 0.8rem; color: #b0b0b0; margin-top: 0.5rem;">
                    1min, 5min, 15min averages<br>
                    <span style="color: #4caf50;">< 1.0 = Good</span> | 
                    <span style="color: #ff9800;">1.0-2.0 = Busy</span> | 
                    <span style="color: #f44336;">> 2.0 = Overloaded</span>
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-clock"></i>
                    Uptime
                </div>
                <div class="status-item-value status-info">
                    ${data.uptime || 'N/A'}
                </div>
            </div>
        </div>
    `;
}

/**
 * Get metric class based on usage percentage
 */
function getMetricClass(usage) {
    const usageNum = parseFloat(usage) || 0;
    if (usageNum >= 90) return 'danger';
    if (usageNum >= 70) return 'warning';
    return '';
}

// ===================================
// Auto-refresh functionality
// ===================================

let autoRefreshInterval = null;
let currentAutoRefreshType = null;

/**
 * Start auto-refresh for a specific monitor type
 */
function startAutoRefresh(type, intervalSeconds = 5) {
    // Stop any existing auto-refresh
    stopAutoRefresh();
    
    currentAutoRefreshType = type;
    
    autoRefreshInterval = setInterval(() => {
        const display = document.getElementById(`${type}-display`);
        if (display && display.style.display === 'block') {
            console.log(`Auto-refreshing ${type} data...`);
            
            switch (type) {
                case 'performance':
                    loadPerformanceMonitorSilent();
                    break;
                case 'status':
                    performStatusCheckSilent();
                    break;
            }
        } else {
            // Display is no longer visible, stop auto-refresh
            stopAutoRefresh();
        }
    }, intervalSeconds * 1000);
    
    console.log(`Started auto-refresh for ${type} every ${intervalSeconds} seconds`);
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log(`Stopped auto-refresh for ${currentAutoRefreshType}`);
        currentAutoRefreshType = null;
    }
}

/**
 * Silent version of loadPerformanceMonitor (no loading state change)
 */
async function loadPerformanceMonitorSilent() {
    try {
        const response = await fetch('/api/admin/performance', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayPerformanceResults(data);
    } catch (error) {
        console.error('Performance monitor auto-refresh failed:', error);
        // Don't show error in UI for silent refresh
    }
}

/**
 * Silent version of performStatusCheck (no loading state change)
 */
async function performStatusCheckSilent() {
    try {
        const response = await fetch('/api/admin/status', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayStatusResults(data);
    } catch (error) {
        console.error('Status check auto-refresh failed:', error);
        // Don't show error in UI for silent refresh
    }
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
    // Special styling for setup complete message
    if (message.includes('Setup complete!')) {
        notification.className = `notification ${type} setup-complete`;
        notification.innerHTML = `<i class='fas fa-rocket'></i> <strong>${message}</strong>`;
    } else {
        notification.className = `notification ${type}`;
        notification.textContent = message;
    }

    container.appendChild(notification);

    // Trigger the transition for appearing
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    // Setup complete message stays longer (8s), others 5s
    const timeout = notification.classList.contains('setup-complete') ? 8000 : 5000;
    setTimeout(() => {
        notification.classList.remove('show');
        notification.addEventListener('transitionend', () => notification.remove());
    }, timeout);
    
    // Return the notification element so it can be managed externally
    return notification;
}

// Restart Button Management
function showRestartButton() {
    const restartBtn = document.getElementById('restart-now-btn');
    
    if (restartBtn) {
        // Force show the button by removing all hiding styles
        restartBtn.removeAttribute('style');
        restartBtn.removeAttribute('hidden');
        restartBtn.classList.remove('hidden');
        
        // Add specific show styles
        restartBtn.style.setProperty('display', 'inline-flex', 'important');
        restartBtn.style.setProperty('visibility', 'visible', 'important');
        restartBtn.style.setProperty('opacity', '1', 'important');
        
        // Store in sessionStorage so button persists across page navigation
        sessionStorage.setItem('restartButtonVisible', 'true');
        
        // Force a reflow to ensure changes are applied
        restartBtn.offsetHeight;
    } else {
        console.warn('⚠️ Restart button element not found when trying to show!');
    }
}

function hideRestartButton() {
    const restartBtn = document.getElementById('restart-now-btn');
    
    if (restartBtn) {
        // Force hide with multiple methods to override any CSS
        restartBtn.style.setProperty('display', 'none', 'important');
        restartBtn.style.setProperty('visibility', 'hidden', 'important');
        restartBtn.style.setProperty('opacity', '0', 'important');
        restartBtn.setAttribute('hidden', 'true');
        restartBtn.classList.add('hidden');
        
        // Remove from sessionStorage
        sessionStorage.removeItem('restartButtonVisible');
        
        // Force a reflow to ensure changes are applied
        restartBtn.offsetHeight;
    } else {
        console.warn('⚠️ Restart button element not found!');
    }
}

function performRestart() {
    const restartBtn = document.getElementById('restart-now-btn');
    const originalText = restartBtn.innerHTML;
    
    // Show loading state
    restartBtn.disabled = true;
    restartBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Restarting...';
    
    // Trigger restart
    fetch('/api/admin/restart-app', { 
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    }).then(() => {
        hideRestartButton();
        sessionStorage.removeItem('restartButtonVisible'); // Verwijder flag zodat knop niet terugkomt na reload
        
        // Show notification and auto-refresh
        if (typeof showNotification === 'function') {
            showNotification('Server is restarting... Please refresh the page in a few seconds.', 'success');
        }
        
        // Auto-refresh na 3 seconden
        setTimeout(() => {
            window.location.reload();
        }, 3000);
    }).catch(error => {
        console.error('Restart failed:', error);
        if (typeof showNotification === 'function') {
            showNotification('Could not restart server automatically. Please restart manually if needed.', 'error');
        }
        // Restore button state
        restartBtn.disabled = false;
        restartBtn.innerHTML = originalText;
    });
}

// Initialize restart button functionality
document.addEventListener('DOMContentLoaded', function() {
    // Check if restart button should be visible (from sessionStorage)
    const shouldShowRestart = sessionStorage.getItem('restartButtonVisible') === 'true';
    
    if (shouldShowRestart) {
        // Show the button because restart is still needed
        showRestartButton();
    } else {
        // Make sure button is hidden
        hideRestartButton();
    }
    
    // Restart now button handler
    const restartNowBtn = document.getElementById('restart-now-btn');
    if (restartNowBtn) {
        restartNowBtn.addEventListener('click', performRestart);
    }
});

/**
 * Load GitHub releases data
 */
async function loadGithubReleases() {
    hideAllStatusDisplays(); // Hide other displays first
    
    const githubReleasesDisplay = document.getElementById('github-releases-display');
    const githubReleasesContent = document.getElementById('github-releases-content');
    
    if (!githubReleasesDisplay || !githubReleasesContent) return;
    
    githubReleasesDisplay.style.display = 'block';
    githubReleasesContent.innerHTML = '<div class="loading">Loading releases...</div>';
    
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/github/releases?limit=10'));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const releases = await response.json();
        displayGithubReleases(releases);
    } catch (error) {
        console.error('GitHub releases loading failed:', error);
        githubReleasesContent.innerHTML = `<div class="status-error">Failed to load releases: ${error.message}</div>`;
    }
}

/**
 * Display GitHub releases data
 */
function displayGithubReleases(releases) {
    const githubReleasesContent = document.getElementById('github-releases-content');
    if (!githubReleasesContent) return;
    
    if (!releases || releases.length === 0) {
        githubReleasesContent.innerHTML = '<div class="status-info">No releases found.</div>';
        return;
    }
    
    const releasesHtml = releases.map(release => {
        const publishedDate = release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : 'Unknown';
        const releaseBody = release.body ? release.body.substring(0, 200) + (release.body.length > 200 ? '...' : '') : '';
        
        return `
            <div style="margin-bottom: 1rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <h4 style="margin: 0; color: #fff; font-size: 0.95rem;">
                        <i class="fas fa-tag" style="color: #667eea; margin-right: 0.5rem;"></i>
                        ${release.name}
                    </h4>
                    <span style="color: #b3b3b3; font-size: 0.8rem;">${publishedDate}</span>
                </div>
                ${releaseBody ? `
                    <p style="margin: 0.5rem 0; color: #ccc; font-size: 0.85rem; line-height: 1.4;">
                        ${releaseBody}
                    </p>
                ` : ''}
                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    <a href="${release.url}" target="_blank" class="btn btn-primary" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">
                        <i class="fab fa-github"></i> View Release
                    </a>
                    ${release.prerelease ? '<span style="color: #ff9800; font-size: 0.8rem;"><i class="fas fa-flask"></i> Pre-release</span>' : ''}
                    ${release.draft ? '<span style="color: #f44336; font-size: 0.8rem;"><i class="fas fa-edit"></i> Draft</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
    
    githubReleasesContent.innerHTML = releasesHtml;
}

/**
 * Load GitHub repository information
 */
async function loadGithubRepositoryInfo() {
    hideAllStatusDisplays(); // Hide other displays first
    
    const githubRepoDisplay = document.getElementById('github-repo-display');
    const githubRepoContent = document.getElementById('github-repo-content');
    
    if (!githubRepoDisplay || !githubRepoContent) return;
    
    githubRepoDisplay.style.display = 'block';
    githubRepoContent.innerHTML = '<div class="loading">Loading repository information...</div>';
    
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/github/repository'));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const repoInfo = await response.json();
        displayGithubRepositoryInfo(repoInfo);
    } catch (error) {
        console.error('GitHub repository info loading failed:', error);
        githubRepoContent.innerHTML = `<div class="status-error">Failed to load repository info: ${error.message}</div>`;
    }
}

/**
 * Display GitHub repository information
 */
function displayGithubRepositoryInfo(repoInfo) {
    const githubRepoContent = document.getElementById('github-repo-content');
    if (!githubRepoContent) return;
    
    const updatedDate = repoInfo.updatedAt ? new Date(repoInfo.updatedAt).toLocaleDateString() : 'Unknown';
    
    githubRepoContent.innerHTML = `
        <div class="status-grid">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fab fa-github"></i>
                    Repository
                </div>
                <div class="status-item-value status-info">
                    ${repoInfo.fullName || 'Unknown'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-star"></i>
                    Stars
                </div>
                <div class="status-item-value status-success">
                    ${repoInfo.stars || 0}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-code-branch"></i>
                    Forks
                </div>
                <div class="status-item-value status-info">
                    ${repoInfo.forks || 0}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-exclamation-circle"></i>
                    Open Issues
                </div>
                <div class="status-item-value ${(repoInfo.issues || 0) > 10 ? 'status-warning' : 'status-success'}">
                    ${repoInfo.issues || 0}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-code"></i>
                    Language
                </div>
                <div class="status-item-value status-info">
                    ${repoInfo.language || 'Unknown'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-balance-scale"></i>
                    License
                </div>
                <div class="status-item-value status-info">
                    ${repoInfo.license || 'Unknown'}
                </div>
            </div>
        </div>
        ${repoInfo.description ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">
                <h4 style="margin: 0 0 0.5rem 0; color: #fff; font-size: 0.95rem;">
                    <i class="fas fa-info-circle"></i> Description
                </h4>
                <p style="margin: 0; color: #ccc; font-size: 0.85rem; line-height: 1.4;">
                    ${repoInfo.description}
                </p>
            </div>
        ` : ''}
        <div style="margin-top: 1rem; padding: 1rem; background: rgba(103, 126, 234, 0.1); border: 1px solid rgba(103, 126, 234, 0.3); border-radius: 6px;">
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <a href="${repoInfo.url}" target="_blank" class="btn btn-primary" style="flex: 1; min-width: 120px; text-align: center;">
                    <i class="fab fa-github"></i> View Repository
                </a>
                <a href="${repoInfo.url}/issues" target="_blank" class="btn btn-secondary" style="flex: 1; min-width: 120px; text-align: center;">
                    <i class="fas fa-bug"></i> Report Issue
                </a>
                <a href="${repoInfo.url}/releases" target="_blank" class="btn btn-secondary" style="flex: 1; min-width: 120px; text-align: center;">
                    <i class="fas fa-tags"></i> All Releases
                </a>
            </div>
            <div style="margin-top: 0.5rem; color: #b3b3b3; font-size: 0.8rem; text-align: center;">
                Last updated: ${updatedDate}
            </div>
        </div>
    `;
}

// Update status monitoring
let updateStatusInterval = null;

/**
 * Start monitoring update status
 */
function startUpdateStatusMonitoring() {
    if (updateStatusInterval) {
        clearInterval(updateStatusInterval);
    }

    updateStatusInterval = setInterval(async () => {
        try {
            await updateProgressBar();
        } catch (error) {
            console.error('[Admin] Error monitoring update status:', error);
        }
    }, 2000); // Check every 2 seconds
}

/**
 * Stop monitoring update status
 */
function stopUpdateStatusMonitoring() {
    if (updateStatusInterval) {
        clearInterval(updateStatusInterval);
        updateStatusInterval = null;
    }
}

/**
 * Update the progress bar with current status
 */
async function updateProgressBar() {
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/status'));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const status = await response.json();
        
        const progressContainer = document.getElementById('update-progress-container');
        const progressLabel = document.getElementById('update-progress-label');
        const progressPercentage = document.getElementById('update-progress-percentage');
        const progressFill = document.getElementById('update-progress-fill');
        
        if (!progressContainer) return;
        
        // Update progress bar
        if (progressLabel) progressLabel.textContent = status.message || 'Update in progress...';
        if (progressPercentage) progressPercentage.textContent = `${status.progress || 0}%`;
        if (progressFill) progressFill.style.width = `${status.progress || 0}%`;
        
        // Apply phase-specific styling
        progressLabel.className = `update-phase-${status.phase || 'idle'}`;
        
        // Stop monitoring if update is complete or failed
        if (status.phase === 'completed' || status.phase === 'error' || !status.isUpdating) {
            stopUpdateStatusMonitoring();
            
            if (status.phase === 'completed') {
                showNotification('Update completed successfully!', 'success');
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 5000);
            } else if (status.phase === 'error') {
                showNotification(`Update failed: ${status.error}`, 'error');
            }
        }
        
    } catch (error) {
        console.error('[Admin] Error updating progress bar:', error);
        stopUpdateStatusMonitoring();
    }
}

/**
 * Load update status data
 */
async function loadUpdateStatus() {
    hideAllStatusDisplays();
    
    const updateStatusDisplay = document.getElementById('update-status-display');
    const updateStatusContent = document.getElementById('update-status-content');
    
    if (!updateStatusDisplay || !updateStatusContent) return;
    
    updateStatusDisplay.style.display = 'block';
    updateStatusContent.innerHTML = '<div class="loading">Loading update status...</div>';
    
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/status'));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const status = await response.json();
        displayUpdateStatus(status);
    } catch (error) {
        console.error('Update status loading failed, showing idle status:', error);
        // If the update status API fails, show idle status by default
        displayIdleUpdateStatus({ isUpdating: false });
    }
}

/**
 * Display update status information
 */
function displayUpdateStatus(status) {
    const updateStatusContent = document.getElementById('update-status-content');
    if (!updateStatusContent) return;
    
    // If not updating, show version info and update check
    if (!status.isUpdating) {
        displayIdleUpdateStatus(status);
        return;
    }
    
    const startTime = status.startTime ? new Date(status.startTime).toLocaleString() : 'Not started';
    const duration = status.startTime ? Math.floor((Date.now() - new Date(status.startTime)) / 1000) : 0;
    
    updateStatusContent.innerHTML = `
        <div class="status-grid">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-info-circle"></i>
                    Current Phase
                </div>
                <div class="status-item-value update-phase-${status.phase}">
                    ${status.phase ? status.phase.charAt(0).toUpperCase() + status.phase.slice(1) : 'Idle'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-percentage"></i>
                    Progress
                </div>
                <div class="status-item-value status-info">
                    ${status.progress || 0}%
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-play"></i>
                    Status
                </div>
                <div class="status-item-value ${status.isUpdating ? 'status-warning' : 'status-success'}">
                    ${status.isUpdating ? 'In Progress' : 'Idle'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-clock"></i>
                    Start Time
                </div>
                <div class="status-item-value status-info">
                    ${startTime}
                </div>
            </div>
        </div>
        ${status.message ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">
                <h4 style="margin: 0 0 0.5rem 0; color: #fff; font-size: 0.95rem;">
                    <i class="fas fa-comment"></i> Current Message
                </h4>
                <p style="margin: 0; color: #ccc; font-size: 0.85rem;">
                    ${status.message}
                </p>
            </div>
        ` : ''}
        ${status.error ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px;">
                <h4 style="margin: 0 0 0.5rem 0; color: #f44336; font-size: 0.95rem;">
                    <i class="fas fa-exclamation-triangle"></i> Error Details
                </h4>
                <p style="margin: 0; color: #f44336; font-size: 0.85rem;">
                    ${status.error}
                </p>
            </div>
        ` : ''}
        ${status.backupPath ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(103, 126, 234, 0.1); border: 1px solid rgba(103, 126, 234, 0.3); border-radius: 6px;">
                <h4 style="margin: 0 0 0.5rem 0; color: #667eea; font-size: 0.95rem;">
                    <i class="fas fa-archive"></i> Backup Information
                </h4>
                <p style="margin: 0; color: #ccc; font-size: 0.85rem; word-break: break-all;">
                    Backup location: ${status.backupPath}
                </p>
            </div>
        ` : ''}
        ${duration > 0 ? `
            <div style="margin-top: 1rem; color: #b3b3b3; font-size: 0.85rem; text-align: center;">
                Duration: ${Math.floor(duration / 60)}m ${duration % 60}s
            </div>
        ` : ''}
    `;
}

/**
 * Display idle update status with version information
 */
async function displayIdleUpdateStatus(status) {
    const updateStatusContent = document.getElementById('update-status-content');
    if (!updateStatusContent) return;
    
    // Show loading state first with current version if available
    updateStatusContent.innerHTML = `
        <div class="status-grid">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-tag"></i>
                    Current Version
                </div>
                <div class="status-item-value status-info">
                    v${window.POSTERRAMA_VERSION || 'Loading...'}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-cloud-download-alt"></i>
                    Update Status
                </div>
                <div class="status-item-value status-info">
                    <i class="fas fa-spinner fa-spin"></i> Checking for updates...
                </div>
            </div>
        </div>
    `;
    
    try {
        // Check for available updates
        const updateCheckResponse = await authenticatedFetch(apiUrl('/api/admin/update-check'));
        const updateInfo = await updateCheckResponse.json();
        
        const hasUpdate = updateInfo.hasUpdate;
        const currentVersion = updateInfo.currentVersion;
        const latestVersion = updateInfo.latestVersion;
        const releaseNotes = updateInfo.releaseNotes;
        
        updateStatusContent.innerHTML = `
            <div class="status-grid">
                <div class="status-item">
                    <div class="status-item-header">
                        <i class="fas fa-tag"></i>
                        Current Version
                    </div>
                    <div class="status-item-value status-info">
                        v${currentVersion}
                    </div>
                </div>
                ${hasUpdate ? `
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-download"></i>
                            Available Version
                        </div>
                        <div class="status-item-value status-warning">
                            v${latestVersion}
                        </div>
                    </div>
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-chart-line"></i>
                            Update Type
                        </div>
                        <div class="status-item-value status-info">
                            ${updateInfo.updateType || 'Unknown'}
                        </div>
                    </div>
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-check-circle"></i>
                            Status
                        </div>
                        <div class="status-item-value status-warning">
                            Update Available
                        </div>
                    </div>
                ` : `
                    <div class="status-item">
                        <div class="status-item-header">
                            <i class="fas fa-check-circle"></i>
                            Status
                        </div>
                        <div class="status-item-value status-success">
                            Up to Date
                        </div>
                    </div>
                `}
            </div>
            ${hasUpdate && releaseNotes ? `
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #4caf50; font-size: 0.95rem;">
                        <i class="fas fa-list"></i> Release Notes for v${latestVersion}
                    </h4>
                    <div style="color: #ccc; font-size: 0.85rem; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">${releaseNotes}</div>
                </div>
            ` : ''}
            ${!hasUpdate ? `
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 6px; text-align: center;">
                    <i class="fas fa-check-circle" style="color: #4caf50; font-size: 2rem; margin-bottom: 0.5rem;"></i>
                    <p style="margin: 0; color: #4caf50; font-weight: 600;">Your installation is up to date!</p>
                    <p style="margin: 0.5rem 0 0 0; color: #ccc; font-size: 0.85rem;">Running the latest version v${currentVersion}</p>
                </div>
            ` : ''}
        `;
    } catch (error) {
        console.error('Failed to check for updates:', error);
        updateStatusContent.innerHTML = `
            <div class="status-grid">
                <div class="status-item">
                    <div class="status-item-header">
                        <i class="fas fa-exclamation-triangle"></i>
                        Status
                    </div>
                    <div class="status-item-value status-error">
                        Unable to check for updates
                    </div>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 6px;">
                <p style="margin: 0; color: #f44336; font-size: 0.85rem;">
                    <i class="fas fa-exclamation-triangle"></i> Error: ${error.message}
                </p>
            </div>
        `;
    }
}

/**
 * Show version information in update status
 */
function showVersion(currentVersion, availableVersion = null) {
    const updateStatusDisplay = document.getElementById('update-status-display');
    if (!updateStatusDisplay) return;
    
    updateStatusDisplay.innerHTML = `
        <div class="status-card">
            <div class="status-header">
                <i class="fas fa-info-circle"></i>
                <span>Version Information</span>
            </div>
            <div class="status-content">
                <div style="margin-bottom: 1rem;">
                    <strong>Current Version:</strong> <span class="version-tag">${currentVersion}</span>
                </div>
                ${availableVersion ? `
                    <div style="margin-bottom: 1rem;">
                        <strong>Available Version:</strong> <span class="version-tag">${availableVersion}</span>
                    </div>
                ` : ''}
                <div style="color: #b3b3b3; font-size: 0.85rem; margin-top: 1rem;">
                    Click "Check for Updates" to check for new versions
                </div>
            </div>
        </div>
    `;
}

/**
 * Load backups list
 */
async function loadBackupsList() {
    hideAllStatusDisplays();
    
    const backupsListDisplay = document.getElementById('backups-list-display');
    const backupsListContent = document.getElementById('backups-list-content');
    
    if (!backupsListDisplay || !backupsListContent) return;
    
    backupsListDisplay.style.display = 'block';
    backupsListContent.innerHTML = '<div class="loading">Loading backups...</div>';
    
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/backups'));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const backups = await response.json();
        displayBackupsList(backups);
    } catch (error) {
        console.error('Backups list loading failed:', error);
        backupsListContent.innerHTML = `<div class="status-error">Failed to load backups: ${error.message}</div>`;
    }
}

/**
 * Display backups list
 */
function displayBackupsList(backups) {
    const backupsListContent = document.getElementById('backups-list-content');
    if (!backupsListContent) return;
    
    if (!backups || backups.length === 0) {
        backupsListContent.innerHTML = '<div class="status-info">No backups found.</div>';
        return;
    }
    
    const backupsHtml = backups.map(backup => {
        const createdDate = backup.created ? new Date(backup.created).toLocaleDateString() : 'Unknown';
        const createdTime = backup.created ? new Date(backup.created).toLocaleTimeString() : '';
        const sizeKB = backup.size ? Math.round(backup.size / 1024) : 0;
        const sizeMB = sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
        
        return `
            <div class="backup-item">
                <div class="backup-item-header">
                    <div class="backup-item-title">
                        <i class="fas fa-archive" style="color: #667eea; margin-right: 0.5rem;"></i>
                        ${backup.name}
                    </div>
                    <div class="backup-item-version">
                        v${backup.version}
                    </div>
                </div>
                <div class="backup-item-meta">
                    <div>
                        <i class="fas fa-calendar"></i> 
                        ${createdDate} ${createdTime}
                    </div>
                    <div>
                        <i class="fas fa-database"></i> 
                        ${sizeMB}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    backupsListContent.innerHTML = `
        <div style="margin-bottom: 1rem; color: #b3b3b3; font-size: 0.9rem;">
            <i class="fas fa-info-circle"></i> 
            Found ${backups.length} backup${backups.length !== 1 ? 's' : ''} (sorted by date, newest first)
        </div>
        ${backupsHtml}
    `;
}

/**
 * Auto-Update Functionality
 */

/**
 * Initialize auto-update functionality
 */
function initializeAutoUpdate() {
    // Start monitoring update status
    startUpdateStatusMonitoring();
    
    // Initial status check
    checkUpdateStatus();
    
    // Show current version info initially
    fetch('/api/v1/config')
        .then(response => response.json())
        .then(data => {
            if (data && data.version) {
                showVersion(data.version);
            }
        })
        .catch(error => {
            console.log('Could not load version info:', error.message);
        });
}

/**
 * Start monitoring update status
 */
function startUpdateStatusMonitoring() {
    if (updateStatusInterval) {
        clearInterval(updateStatusInterval);
    }
    
    // Check status every 2 seconds during updates
    updateStatusInterval = setInterval(checkUpdateStatus, 2000);
}

/**
 * Stop monitoring update status
 */
function stopUpdateStatusMonitoring() {
    if (updateStatusInterval) {
        clearInterval(updateStatusInterval);
        updateStatusInterval = null;
    }
}

/**
 * Check current update status
 */
async function checkUpdateStatus() {
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/status'));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const status = await response.json();
        updateStatusDisplay(status);
        
        // Stop monitoring if update is complete or idle
        if (status.phase === 'completed' || status.phase === 'idle' || status.phase === 'error') {
            stopUpdateStatusMonitoring();
        }
        
    } catch (error) {
        console.error('Failed to check update status:', error);
        // Continue monitoring even on error
    }
}

/**
 * Update the status display
 */
function updateStatusDisplay(status) {
    const idleState = document.getElementById('update-idle-state');
    const progressState = document.getElementById('update-progress-state');
    const phaseText = document.getElementById('update-phase-text');
    const progressPercent = document.getElementById('update-progress-percent');
    const progressBar = document.getElementById('update-progress-bar');
    const messageText = document.getElementById('update-message');
    const startButton = document.getElementById('start-auto-update-button');
    const rollbackButton = document.getElementById('rollback-update-button');
    
    if (!idleState || !progressState) return;
    
    // Update button states
    const isUpdating = status.phase !== 'idle' && status.phase !== 'completed' && status.phase !== 'error';
    
    if (startButton) {
        startButton.setAttribute('data-updating', isUpdating.toString());
        if (isUpdating) {
            startButton.querySelector('span').textContent = 'Updating...';
            startButton.querySelector('i').className = 'fas fa-spinner icon';
        } else {
            startButton.querySelector('span').textContent = 'Start Auto-Update';
            startButton.querySelector('i').className = 'fas fa-download icon';
        }
    }
    
    if (rollbackButton) {
        rollbackButton.style.display = status.backupPath ? 'block' : 'none';
    }
    
    if (status.phase === 'idle' || status.phase === 'completed') {
        // Show idle state
        idleState.style.display = 'block';
        progressState.style.display = 'none';
        
        if (status.phase === 'completed') {
            const statusValue = idleState.querySelector('.status-item-value');
            if (statusValue) {
                statusValue.textContent = status.message || 'Update completed';
                statusValue.className = 'status-item-value status-success';
            }
        }
    } else {
        // Show progress state
        idleState.style.display = 'none';
        progressState.style.display = 'block';
        
        // Update progress elements
        if (phaseText) {
            phaseText.textContent = getPhaseDisplayText(status.phase);
        }
        
        if (progressPercent) {
            progressPercent.textContent = `${status.progress || 0}%`;
        }
        
        if (progressBar) {
            progressBar.style.width = `${status.progress || 0}%`;
            
            // Update progress bar class based on phase
            progressBar.className = 'progress-fill';
            if (status.phase === 'error') {
                progressBar.classList.add('error');
            } else if (status.phase === 'completed') {
                progressBar.classList.add('success');
            }
        }
        
        if (messageText) {
            messageText.textContent = status.message || 'Processing...';
            messageText.className = 'update-message';
            
            if (status.error) {
                messageText.classList.add('error');
                messageText.textContent = status.error;
            } else if (status.phase === 'completed') {
                messageText.classList.add('success');
            }
            
            // Add phase-specific class
            messageText.classList.add(`update-phase-${status.phase}`);
        }
    }
}

/**
 * Get display text for update phase
 */
function getPhaseDisplayText(phase) {
    const phaseTexts = {
        'checking': 'Checking for Updates',
        'backup': 'Creating Backup',
        'download': 'Downloading Update',
        'validation': 'Validating Download',
        'stopping': 'Stopping Services',
        'applying': 'Applying Update',
        'dependencies': 'Updating Dependencies',
        'starting': 'Starting Services',
        'verification': 'Verifying Update',
        'completed': 'Update Completed',
        'error': 'Update Failed',
        'rollback': 'Rolling Back'
    };
    
    return phaseTexts[phase] || phase;
}

/**
 * Start automatic update
 */
async function startAutoUpdate(targetVersion = null) {
    try {
        const startButton = document.getElementById('start-auto-update-button');
        setButtonState(startButton, 'loading', { text: 'Starting...' });
        
        const requestBody = targetVersion ? { targetVersion } : {};
        
        const response = await authenticatedFetch(apiUrl('/api/admin/update/start'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        showNotification(`Update started: ${result.message}`, 'success');
        
        // Start monitoring
        startUpdateStatusMonitoring();
        
        // Initial status check
        setTimeout(checkUpdateStatus, 1000);
        
    } catch (error) {
        console.error('Failed to start update:', error);
        showNotification(`Failed to start update: ${error.message}`, 'error');
        
        const startButton = document.getElementById('start-auto-update-button');
        setButtonState(startButton, 'revert');
    }
}

/**
 * Show rollback modal with backup selection
 */
async function rollbackUpdate() {
    try {
        // Load backup list first
        const response = await authenticatedFetch(apiUrl('/api/admin/update/backups'));
        
        if (!response.ok) {
            throw new Error(`Failed to load backups: HTTP ${response.status}`);
        }
        
        const backups = await response.json();
        
        if (!backups || backups.length === 0) {
            showNotification('No backups available for rollback', 'warning');
            return;
        }
        
        // Show modal with backup selection
        showRollbackModal(backups);
        
    } catch (error) {
        console.error('Failed to load backups for rollback:', error);
        showNotification(`Failed to load backups: ${error.message}`, 'error');
    }
}

/**
 * Show rollback modal with backup selection
 */
function showRollbackModal(backups) {
    // Create modal HTML
    const modalHTML = `
        <div id="rollback-modal" class="modal" style="display: block;">
            <div class="modal-content" style="max-width: 700px;">
                <span class="close" onclick="closeRollbackModal()">&times;</span>
                <h3><i class="fas fa-undo"></i> Select Backup to Restore</h3>
                <p style="color: #ccc; margin-bottom: 1.5rem;">Choose a backup to rollback to. This will replace your current installation with the selected backup.</p>
                
                <div id="backup-selection-list" style="max-height: 400px; overflow-y: auto; margin-bottom: 1.5rem;">
                    ${backups.map((backup, index) => `
                        <div class="backup-selection-item" data-backup-path="${backup.path}" data-backup-version="${backup.version}" 
                             style="margin-bottom: 1rem; padding: 1rem; background: rgba(255, 255, 255, 0.05); border: 2px solid transparent; border-radius: 6px; cursor: pointer; transition: all 0.2s;"
                             onclick="selectBackupForRollback(this)">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <div style="font-weight: 600; color: #fff;">
                                    <i class="fas fa-archive" style="color: #667eea; margin-right: 0.5rem;"></i>
                                    ${backup.name}
                                </div>
                                <div style="background: rgba(103, 126, 234, 0.2); color: #667eea; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
                                    v${backup.version}
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; font-size: 0.85rem; color: #ccc;">
                                <div>
                                    <i class="fas fa-calendar"></i> 
                                    ${backup.created ? new Date(backup.created).toLocaleDateString() : 'Unknown date'}
                                </div>
                                <div>
                                    <i class="fas fa-clock"></i> 
                                    ${backup.created ? new Date(backup.created).toLocaleTimeString() : ''}
                                </div>
                                <div>
                                    <i class="fas fa-database"></i> 
                                    ${backup.size ? (backup.size > 1024 * 1024 ? (backup.size / (1024 * 1024)).toFixed(1) + ' MB' : Math.round(backup.size / 1024) + ' KB') : 'Unknown size'}
                                </div>
                            </div>
                            ${index === 0 ? `
                                <div style="margin-top: 0.5rem; color: #4caf50; font-size: 0.8rem; font-weight: 600;">
                                    <i class="fas fa-star"></i> Most Recent Backup
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
                
                <div style="padding: 1rem; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px; margin-bottom: 1.5rem;">
                    <p style="margin: 0; color: #ffc107; font-size: 0.85rem;">
                        <i class="fas fa-exclamation-triangle"></i> 
                        <strong>Warning:</strong> Rolling back will stop the current application, restore the selected backup, and restart. This process cannot be undone.
                    </p>
                </div>
                
                <div class="form-actions">
                    <button type="button" id="confirm-rollback-button" class="btn btn-danger" onclick="confirmRollback()" disabled>
                        <i class="fas fa-undo icon"></i>
                        <span>Rollback to Selected Backup</span>
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeRollbackModal()">
                        <i class="fas fa-times icon"></i>
                        <span>Cancel</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if present
    const existingModal = document.getElementById('rollback-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add click outside to close
    const modal = document.getElementById('rollback-modal');
    modal.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeRollbackModal();
        }
    });
}

/**
 * Select backup for rollback
 */
function selectBackupForRollback(element) {
    // Remove selection from all items
    document.querySelectorAll('.backup-selection-item').forEach(item => {
        item.style.border = '2px solid transparent';
        item.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    
    // Select current item
    element.style.border = '2px solid #667eea';
    element.style.background = 'rgba(103, 126, 234, 0.1)';
    
    // Enable confirm button
    const confirmButton = document.getElementById('confirm-rollback-button');
    if (confirmButton) {
        confirmButton.disabled = false;
        
        const version = element.getAttribute('data-backup-version');
        confirmButton.querySelector('span').textContent = `Rollback to v${version}`;
        
        // Store selected backup info
        confirmButton.setAttribute('data-backup-path', element.getAttribute('data-backup-path'));
        confirmButton.setAttribute('data-backup-version', version);
    }
}

/**
 * Confirm rollback with selected backup
 */
async function confirmRollback() {
    const confirmButton = document.getElementById('confirm-rollback-button');
    const backupPath = confirmButton.getAttribute('data-backup-path');
    const backupVersion = confirmButton.getAttribute('data-backup-version');
    
    if (!backupPath) {
        showNotification('Please select a backup first', 'warning');
        return;
    }
    
    closeRollbackModal();
    
    try {
        setButtonState(confirmButton, 'loading', { text: 'Rolling back...' });
        
        const response = await authenticatedFetch(apiUrl('/api/admin/update/rollback'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                backupPath: backupPath,
                version: backupVersion
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        showNotification(`Rollback to v${backupVersion} completed successfully`, 'success');
        
        // Refresh page after rollback
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (error) {
        console.error('Rollback failed:', error);
        showNotification(`Rollback failed: ${error.message}`, 'error');
    }
}

/**
 * Close rollback modal
 */
function closeRollbackModal() {
    const modal = document.getElementById('rollback-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Load and display backup list
 */
async function loadBackupList() {
    hideAllStatusDisplays(); // Hide other displays first
    
    const backupsDisplay = document.getElementById('backups-display');
    const backupsContent = document.getElementById('backups-content');
    
    if (!backupsDisplay || !backupsContent) return;
    
    backupsDisplay.style.display = 'block';
    backupsContent.innerHTML = '<div class="loading">Loading backups...</div>';
    
    try {
        const response = await authenticatedFetch(apiUrl('/api/admin/update/backups'));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const backups = await response.json();
        displayBackupList(backups);
    } catch (error) {
        console.error('Failed to load backups:', error);
        backupsContent.innerHTML = `<div class="status-error">Failed to load backups: ${error.message}</div>`;
    }
}

/**
 * Display backup list
 */
function displayBackupList(backups) {
    const backupsContent = document.getElementById('backups-content');
    if (!backupsContent) return;
    
    if (!backups || backups.length === 0) {
        backupsContent.innerHTML = '<div class="status-info">No backups found.</div>';
        return;
    }
    
    const backupsHtml = backups.map(backup => {
        const createdDate = new Date(backup.timestamp).toLocaleDateString();
        const createdTime = new Date(backup.timestamp).toLocaleTimeString();
        const sizeMB = (backup.size / (1024 * 1024)).toFixed(1) + ' MB';
        
        return `
            <div class="backup-item">
                <div class="backup-info">
                    <div class="backup-name">
                        <i class="fas fa-archive" style="color: #667eea; margin-right: 0.5rem;"></i>
                        ${backup.name}
                    </div>
                    <div class="backup-details">
                        <span class="backup-version">v${backup.version}</span> • 
                        ${createdDate} ${createdTime} • 
                        ${sizeMB}
                    </div>
                </div>
                <div class="backup-actions">
                    <button class="btn btn-secondary btn-sm" onclick="restoreFromBackup('${backup.path}', '${backup.version}')" title="Restore this backup">
                        <i class="fas fa-undo"></i> Restore
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    backupsContent.innerHTML = `
        <div style="margin-bottom: 1rem; color: #b3b3b3; font-size: 0.9rem;">
            <i class="fas fa-info-circle"></i> 
            Found ${backups.length} backup${backups.length !== 1 ? 's' : ''} (sorted by date, newest first)
        </div>
        ${backupsHtml}
        <div style="margin-top: 1rem; padding: 1rem; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px;">
            <div style="color: #f59e0b; font-weight: 500; margin-bottom: 0.5rem;">
                <i class="fas fa-exclamation-triangle"></i> Backup Management
            </div>
            <p style="margin: 0; color: #fef3c7; font-size: 0.85rem;">
                Backups are automatically created before each update. You can restore any backup or clean up old ones to save disk space.
            </p>
        </div>
    `;
}

/**
 * Restore from a specific backup
 */
async function restoreFromBackup(backupPath, version) {
    if (!confirm(`Are you sure you want to restore from backup version ${version}? This will replace the current installation.`)) {
        return;
    }
    
    try {
        showNotification('Restoring from backup...', 'info');
        
        // Note: This would require a new API endpoint for restoring specific backups
        // For now, we'll show a message that this feature is coming soon
        showNotification('Specific backup restoration is not yet implemented. Use the general rollback function instead.', 'warning');
        
    } catch (error) {
        console.error('Failed to restore backup:', error);
        showNotification(`Failed to restore backup: ${error.message}`, 'error');
    }
}

// Initialize auto-update functionality when the page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initialize auto-update monitoring
    initializeAutoUpdate();
});

/**
 * Modal functions for update confirmation
 */
async function openUpdateConfirmationModal() {
    console.log('📂 Opening update confirmation modal');
    
    const modal = document.getElementById('update-confirmation-modal');
    const content = document.getElementById('update-confirmation-content');
    const confirmButton = document.getElementById('confirm-update-button');
    
    console.log('🔍 Modal elements:', {
        modal: modal ? 'found' : 'NOT FOUND',
        content: content ? 'found' : 'NOT FOUND',
        confirmButton: confirmButton ? 'found' : 'NOT FOUND'
    });
    
    if (!modal || !content) {
        console.error('❌ Modal elements not found!');
        return;
    }
    
    // NUCLEAR FIX: Move modal to body if it's not already there
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    
    modal.classList.remove('is-hidden');
    modal.style.display = 'flex'; // Use flex as per CSS
    confirmButton.disabled = true;
    
    // Prevent body scrolling when modal is open - use CSS classes
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
    modal.classList.add('modal-open');
    
    // Load update information
    try {
        const updateCheckResponse = await authenticatedFetch(apiUrl('/api/admin/update-check'));
        
        const updateInfo = await updateCheckResponse.json();
        
        const hasUpdate = updateInfo.hasUpdate;
        const currentVersion = updateInfo.currentVersion;
        const latestVersion = updateInfo.latestVersion;
        const releaseNotes = updateInfo.releaseNotes;
        
        if (!hasUpdate) {
            content.innerHTML = `
                <div style="text-align: center; padding: 1rem;">
                    <i class="fas fa-check-circle" style="color: #4caf50; font-size: 3rem; margin-bottom: 1rem;"></i>
                    <h4 style="color: #4caf50; margin: 0 0 0.5rem 0;">Already Up to Date</h4>
                    <p style="margin: 0; color: #ccc;">You are already running the latest version v${currentVersion}</p>
                </div>
            `;
            confirmButton.disabled = true;
            confirmButton.querySelector('span').textContent = 'No Update Needed';
        } else {
            content.innerHTML = `
                <div style="margin-bottom: 1.5rem;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div style="text-align: center; padding: 1rem; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                            <div style="color: #ccc; font-size: 0.85rem; margin-bottom: 0.5rem;">Current Version</div>
                            <div style="font-size: 1.2rem; font-weight: 600; color: #667eea;">v${currentVersion}</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: rgba(76, 175, 80, 0.1); border-radius: 6px; border: 1px solid rgba(76, 175, 80, 0.3);">
                            <div style="color: #4caf50; font-size: 0.85rem; margin-bottom: 0.5rem;">Available Version</div>
                            <div style="font-size: 1.2rem; font-weight: 600; color: #4caf50;">v${latestVersion}</div>
                        </div>
                    </div>
                    ${releaseNotes ? `
                        <div style="margin-bottom: 1.5rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1);">
                            <h4 style="margin: 0 0 0.5rem 0; color: #fff; font-size: 0.95rem;">
                                <i class="fas fa-list"></i> What's New in v${latestVersion}
                            </h4>
                            <div style="color: #ccc; font-size: 0.85rem; white-space: pre-wrap; max-height: 150px; overflow-y: auto;">${releaseNotes}</div>
                        </div>
                    ` : ''}
                </div>
                <div style="margin-bottom: 1rem;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #fff; font-size: 0.95rem;">
                        <i class="fas fa-info-circle"></i> Update Process
                    </h4>
                    <p style="margin: 0 0 0.5rem 0; color: #ccc; font-size: 0.85rem;">The update will automatically:</p>
                    <ul style="margin: 0; padding-left: 1.5rem; color: #ccc; font-size: 0.85rem;">
                        <li>Create a backup of your current installation</li>
                        <li>Download version v${latestVersion} from GitHub</li>
                        <li>Stop the application safely</li>
                        <li>Install the new version</li>
                        <li>Update dependencies</li>
                        <li>Restart the application</li>
                    </ul>
                    <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 4px;">
                        <p style="margin: 0; color: #ffc107; font-size: 0.85rem;">
                            <i class="fas fa-exclamation-triangle"></i> 
                            <strong>Important:</strong> The process may take several minutes. Do not close this page or stop the server during the update.
                        </p>
                    </div>
                </div>
            `;
            confirmButton.disabled = false;
            confirmButton.querySelector('span').textContent = `Update to v${latestVersion}`;
        }
    } catch (error) {
        console.error('❌ Failed to load update info for modal:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 1rem;">
                <i class="fas fa-exclamation-triangle" style="color: #f44336; font-size: 2rem; margin-bottom: 1rem;"></i>
                <h4 style="color: #f44336; margin: 0 0 0.5rem 0;">Update Check Failed</h4>
                <p style="margin: 0; color: #ccc;">Failed to load update information: ${error.message}</p>
                <p style="margin: 0.5rem 0 0 0; color: #999; font-size: 0.85rem;">Please check your internet connection and try again.</p>
            </div>
        `;
        confirmButton.disabled = true;
        confirmButton.querySelector('span').textContent = 'Unable to Check';
    }
    
    // Add event listener for clicking outside modal
    modal.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeUpdateConfirmationModal();
        }
    });
}

function closeUpdateConfirmationModal() {
    const modal = document.getElementById('update-confirmation-modal');
    if (modal) {
        modal.classList.add('is-hidden');
        modal.style.display = 'none';
        
        // Re-enable body scrolling when modal closes - remove CSS classes
        document.body.classList.remove('modal-open');
        document.documentElement.classList.remove('modal-open');
        modal.classList.remove('modal-open');
    }
}

function confirmAutoUpdate() {
    closeUpdateConfirmationModal();
    // Call the actual update function
    startAutoUpdate();
}

// Mobile Navigation Panel Management
function initMobileNavPanel() {
    const mobileNavToggle = document.getElementById('mobile-nav-toggle');
    const mobileNavPanel = document.getElementById('mobile-nav-panel');
    const closeMobileNav = document.getElementById('close-mobile-nav');
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');

    if (!mobileNavToggle || !mobileNavPanel) return;

    // Open mobile nav panel
    mobileNavToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileNavPanel.classList.add('open');
    });

    // Close mobile nav panel
    if (closeMobileNav) {
        closeMobileNav.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            mobileNavPanel.classList.remove('open');
        });
    }

    // Handle navigation item clicks
    mobileNavItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = item.getAttribute('data-section');
            
            // Remove active class from all mobile nav items
            mobileNavItems.forEach(navItem => navItem.classList.remove('active'));
            
            // Add active class to clicked mobile nav item
            item.classList.add('active');
            
            // Also update desktop nav items
            const desktopNavItems = document.querySelectorAll('.nav-item');
            desktopNavItems.forEach(nav => {
                nav.classList.remove('active');
                nav.setAttribute('aria-selected', 'false');
            });
            
            const correspondingDesktopItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
            if (correspondingDesktopItem) {
                correspondingDesktopItem.classList.add('active');
                correspondingDesktopItem.setAttribute('aria-selected', 'true');
            }
            
            // Switch to the selected section (same logic as desktop sidebar)
            if (window.activateSection) {
                window.activateSection(sectionId);
            }
            
            // Close the mobile nav panel
            mobileNavPanel.classList.remove('open');
        });
    });

    // Close mobile nav when clicking outside
    document.addEventListener('click', (e) => {
        if (mobileNavPanel.classList.contains('open') && 
            !mobileNavPanel.contains(e.target) && 
            !mobileNavToggle.contains(e.target)) {
            mobileNavPanel.classList.remove('open');
        }
    });
}

// Initialize mobile nav panel when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNavPanel);
} else {
    initMobileNavPanel();
}
