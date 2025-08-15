/*
 * Posterrama Admin Panel - Version 2.2.0
 * Date: 2025-08-14 
 * Scope: Cache stats functionality with clearer labeling.
 */

// Version check for cache busting validation
console.log('✅ Admin script v2.2.0 loaded successfully');

// Ensure all API calls use the current host
const API_BASE = window.location.origin;
console.log('🌐 API Base URL:', API_BASE);

// Helper function to create API URLs with localhost fallback for dev environments
function apiUrl(path) {
    // Ensure path starts with /
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    
    // Check if we should use localhost fallback for dev environments with proxy issues
    const currentHost = window.location.hostname;
    const isDev = currentHost.includes('dev.') || currentHost.includes('staging.');
    
    if (isDev && window.__useLocalhostFallback) {
        console.log('🔄 Using localhost fallback for API call');
        return `http://localhost:4000${path}`;
    }
    
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
    // Track HTTP/2 errors to enable automatic localhost fallback
    window.__http2ErrorCount = window.__http2ErrorCount || 0;
    
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Connection': 'close', // Force HTTP/1.1 behavior
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'HTTP-Version': '1.1', // Request HTTP/1.1
            ...options.headers
        }
    };
    
    console.log('🌐 Making authenticated request:', {
        url,
        method: options.method || 'GET',
        hasBody: !!options.body,
        bodySize: options.body ? options.body.length : 0,
        localhostFallback: window.__useLocalhostFallback || false
    });
    
    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        
        console.log('📡 Response received:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
        });
        
        // Reset error count on successful request
        if (response.ok) {
            window.__http2ErrorCount = 0;
        }
        
        // Handle authentication errors
        if (response.status === 401) {
            console.warn('Authentication failed - redirecting to login');
            window.location.href = '/admin/login';
            throw new Error('Authentication required');
        }
        
        return response;
    } catch (error) {
        console.error('🚨 Fetch error:', error.name, error.message);
        
        // Track HTTP/2 errors
        if (error.message.includes('ERR_HTTP2_PROTOCOL_ERROR')) {
            window.__http2ErrorCount++;
            console.warn(`⚠️ HTTP/2 error count: ${window.__http2ErrorCount}`);
            
            // Enable localhost fallback after 2 HTTP/2 errors
            if (window.__http2ErrorCount >= 2 && !window.__useLocalhostFallback) {
                window.__useLocalhostFallback = true;
                console.warn('🔄 Enabling localhost fallback due to repeated HTTP/2 errors');
                
                // Retry the request with localhost
                const localhostUrl = url.replace(window.location.origin, 'http://localhost:4000');
                console.log('🏠 Retrying with localhost:', localhostUrl);
                
                try {
                    const localhostResponse = await fetch(localhostUrl, { ...defaultOptions, ...options });
                    console.log('✅ Localhost request succeeded');
                    return localhostResponse;
                } catch (localhostError) {
                    console.error('❌ Localhost request also failed:', localhostError.message);
                }
            }
        }
        
        // For any network error, try a simplified request
        if (error.message.includes('ERR_HTTP2_PROTOCOL_ERROR') || 
            error.message.includes('Failed to fetch') ||
            error.message.includes('502') ||
            error.message.includes('503')) {
            
            console.warn('🔄 Network error detected, attempting simplified request...');
            try {
                // Wait a moment before retry
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Try with absolute minimal headers and explicit HTTP/1.1
                const simplifiedOptions = {
                    method: options.method || 'GET',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Connection': 'close'
                    },
                    body: options.body
                };
                
                const fallbackResponse = await fetch(url, simplifiedOptions);
                console.log(`📡 Simplified response: ${fallbackResponse.status} ${fallbackResponse.statusText}`);
                
                // Check if fallback response is also an error
                if (fallbackResponse.status === 401) {
                    console.warn('Authentication failed in fallback - redirecting to login');
                    window.location.href = '/admin/login';
                    throw new Error('Authentication required');
                }
                
                if (!fallbackResponse.ok) {
                    console.error(`❌ Simplified request failed with HTTP ${fallbackResponse.status}: ${fallbackResponse.statusText}`);
                    throw new Error(`HTTP ${fallbackResponse.status}: ${fallbackResponse.statusText}`);
                }
                
                console.log('✅ Simplified request succeeded');
                return fallbackResponse;
            } catch (fallbackError) {
                console.error('❌ Simplified request also failed:', fallbackError.message);
                throw fallbackError;
            }
        }
        
        throw error;
    }
}

// Global cache management functions for debugging
window.clearBrowserCache = function() {
    console.log('🧹 Clearing browser cache...');
    
    // Clear localStorage
    localStorage.clear();
    console.log('✅ localStorage cleared');
    
    // Clear sessionStorage
    sessionStorage.clear();
    console.log('✅ sessionStorage cleared');
    
    // Unregister service workers
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
                registration.unregister();
                console.log('✅ Service worker unregistered');
            }
        });
    }
    
    // Clear cache storage
    if ('caches' in window) {
        caches.keys().then(function(names) {
            names.forEach(function(name) {
                caches.delete(name);
                console.log('✅ Cache storage cleared:', name);
            });
        });
    }
    
    console.log('🎯 Browser cache cleared! Refresh the page to see changes.');
    return 'Cache cleared! Please refresh the page.';
};

window.hardRefresh = function() {
    console.log('🔄 Performing hard refresh...');
    window.location.reload(true);
};

// Network debugging functions
window.enableLocalhostFallback = function() {
    window.__useLocalhostFallback = true;
    console.log('🏠 Localhost fallback enabled - API calls will use http://localhost:4000');
    return 'Localhost fallback enabled';
};

window.disableLocalhostFallback = function() {
    window.__useLocalhostFallback = false;
    console.log('🌐 Localhost fallback disabled - API calls will use current domain');
    return 'Localhost fallback disabled';
};

window.checkNetworkStatus = function() {
    console.log('📊 Network Status:', {
        http2ErrorCount: window.__http2ErrorCount || 0,
        localhostFallback: window.__useLocalhostFallback || false,
        currentDomain: window.location.hostname,
        apiBase: API_BASE
    });
    return {
        http2ErrorCount: window.__http2ErrorCount || 0,
        localhostFallback: window.__useLocalhostFallback || false,
        currentDomain: window.location.hostname,
        apiBase: API_BASE
    };
};

// Debug function to test config save with different methods
window.testConfigSave = async function() {
    console.log('🧪 Testing config save with minimal data...');
    
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
        console.log('Method 1: Normal authenticatedFetch');
        const response1 = await authenticatedFetch(apiUrl('/api/admin/config'), {
            method: 'POST',
            body: JSON.stringify({ config: testConfig, env: testEnv })
        });
        console.log('✅ Method 1 succeeded:', response1.status);
        return 'Test passed with normal method';
    } catch (error1) {
        console.log('❌ Method 1 failed:', error1.message);
        
        try {
            console.log('Method 2: Direct fetch with HTTP/1.1 headers');
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
            console.log('✅ Method 2 succeeded:', response2.status);
            return 'Test passed with HTTP/1.1 fallback';
        } catch (error2) {
            console.log('❌ Method 2 also failed:', error2.message);
            return 'Both methods failed: ' + error2.message;
        }
    }
};

// Check authentication status
async function checkAuthStatus() {
    console.log('🔍 Checking authentication status...');
    try {
        const response = await fetch(apiUrl('/api/admin/config'), {
            method: 'GET',
            credentials: 'include'
        });
        
        console.log('Auth Status:', response.status);
        if (response.status === 401) {
            console.log('❌ Not authenticated - redirecting to login');
            window.location.href = '/admin/login';
            return false;
        } else if (response.ok) {
            console.log('✅ Authenticated successfully');
            return true;
        } else {
            console.log('⚠️ Unexpected response:', response.status, response.statusText);
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
    console.log('toggleHelpPanel function started');
    
    // Get current active section
    const activeNavItem = document.querySelector('.nav-item.active');
    const sectionName = activeNavItem ? activeNavItem.dataset.section : 'general';
    
    console.log('Active section:', sectionName);
    
    // Use existing help panel from HTML
    let helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        console.log('ERROR: Help panel not found in DOM');
        return;
    }
    
    // Check current styles before toggle
    const computedStyle = window.getComputedStyle(helpPanel);
    console.log('Current transform:', computedStyle.transform);
    console.log('Current display:', computedStyle.display);
    console.log('Current visibility:', computedStyle.visibility);
    console.log('Current z-index:', computedStyle.zIndex);
    
    // Toggle visibility using CSS classes
    helpPanel.classList.toggle('open');
    
    // Check styles after toggle
    setTimeout(() => {
        const newComputedStyle = window.getComputedStyle(helpPanel);
        console.log('After toggle transform:', newComputedStyle.transform);
        console.log('After toggle display:', newComputedStyle.display);
    }, 100);
    
    // Update content based on active section - do this AFTER opening
    if (helpPanel.classList.contains('open')) {
        updateHelpContent(sectionName);
    }
    
    console.log('Toggled help panel for section:', sectionName, 'Panel open:', helpPanel.classList.contains('open'));
}

function updateHelpContent(sectionId) {
    console.log('updateHelpContent called with:', sectionId);
    
    const helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        console.log('Help panel not found');
        return;
    }
    
    // Only update if the help panel is currently open/visible
    if (!helpPanel.classList.contains('open')) {
        console.log('Help panel not open, skipping update');
        return;
    }
    
    // Call the forced update function
    updateHelpContentForced(sectionId);
}

function updateHelpContentForced(sectionId) {
    console.log('updateHelpContentForced called with:', sectionId);
    
    const helpPanel = document.getElementById('quick-help-panel');
    if (!helpPanel) {
        console.log('Help panel not found');
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
    console.log('Mapped section ID:', mappedSectionId);
    
    const helpContent = getHelpContentForSection(mappedSectionId);
    console.log('Help content:', helpContent);
    
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
    
    console.log('Generated HTML length:', newHTML.length);
    helpPanel.innerHTML = newHTML;
    console.log('Content FORCED update in panel for section:', sectionId);
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
    console.log('[ADMIN SENTINEL] admin.js build 1.2.9 loaded at', new Date().toISOString());
    
    // Add event listener to help button as backup
    const helpButton = document.getElementById('toggle-help-panel');
    if (helpButton) {
        console.log('Help button found, adding event listener');
        helpButton.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent any default behavior
            // Use the EXACT same call as the 'H' key
            if (window.toggleHelpPanel) {
                window.toggleHelpPanel();
            }
        });
    } else {
        console.log('Help button not found');
    }
    
    // Register Service Worker for caching
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('[SW] Registration successful:', registration.scope);
            })
            .catch((error) => {
                console.log('[SW] Registration failed:', error);
            });
    }
    
    // Performance monitoring
    if ('performance' in window) {
        window.addEventListener('load', () => {
            const perfData = performance.getEntriesByType('navigation')[0];
            if (perfData) {
                console.log('[PERF] Page load metrics:', {
                    domContentLoaded: Math.round(perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart),
                    loadComplete: Math.round(perfData.loadEventEnd - perfData.loadEventStart),
                    domInteractive: Math.round(perfData.domInteractive - perfData.fetchStart),
                    totalTime: Math.round(perfData.loadEventEnd - perfData.fetchStart)
                });
            }
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
        // Log diagnostics table
        try {
            const diag = Array.from(sections).map(sec=>({id:sec.id,len:sec.innerHTML.length}));
            console.table(diag);
        } catch(_) {}
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

    // Toggle sidebar
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            
            // Update ARIA attributes (true when sidebar is expanded/visible)
            const isExpanded = !sidebar.classList.contains('collapsed');
            sidebarToggle.setAttribute('aria-expanded', isExpanded);
            
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
        console.log('activateSection called with:', targetSection);
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
            console.log('Help panel is open, forcing content update for section:', targetSection);
            // Force update by calling with forceUpdate parameter
            updateHelpContentForced(targetSection);
        }
        
        // Load cache stats when Management section is activated
        if (targetSection === 'management') {
            console.log('Loading cache stats for Management section');
            setTimeout(() => {
                console.log('Delayed loading of cache stats...');
                loadCacheStats();
                loadCacheConfig();
            }, 100); // Small delay to ensure DOM is ready
        }
        
        // Libraries are now loaded during config load, no need for lazy loading here
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSection = item.dataset.section;
            
            console.log('Navigation clicked for section:', targetSection);
            
            // Update ARIA attributes and classes for tab navigation
            navItems.forEach(nav => {
                nav.classList.remove('active');
                nav.setAttribute('aria-selected', 'false');
            });
            
            item.classList.add('active');
            item.setAttribute('aria-selected', 'true');
            
            console.log('About to call activateSection for:', targetSection);
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
        
    // Apply cinema mode settings (including Ken Burns dropdown handling) - single invocation
    toggleCinemaModeSettings(isCinemaMode);
        
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
        twoFaCheckbox.checked = security.is2FAEnabled;
        update2FAStatusText(security.is2FAEnabled);
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

        try {
            const response = await fetch('/api/admin/plex-genres');
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
                genreSelect.appendChild(option);
            });

            console.log(`Loaded ${genres.length} genres from Plex`);
            
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

        try {
            const response = await fetch('/api/admin/tmdb-genres');
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
                genreSelect.appendChild(option);
            });

            console.log(`Loaded ${genres.length} genres from TMDB`);
            
            // Setup listeners after genres are loaded
            setupTMDBGenreFilterListeners();
        } catch (error) {
            console.error('Error loading TMDB genres:', error);
            genreSelect.innerHTML = '<option value="">Error loading genres</option>';
        }
    }

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

        try {
            const response = await fetch('/api/admin/tvdb-genres');
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
                option.value = genre.name;
                option.textContent = genre.name;
                option.dataset.genreId = genre.id;
                genreSelect.appendChild(option);
            });

            console.log(`Loaded ${genres.length} genres from TVDB`);
            
            // Setup listeners after genres are loaded
            setupTVDBGenreFilterListeners();
        } catch (error) {
            console.error('Error loading TVDB genres:', error);
            genreSelect.innerHTML = '<option value="">Error loading genres</option>';
        }
    }

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
                throw new Error('Could not load configuration from the server.');
            }
            const { config = {}, env = {}, security = {}, server = {} } = await response.json();

            populateGeneralSettings(config, env, defaults);
            populateDisplaySettings(config, defaults);
            setupDisplaySettingListeners();
            // (preview timers removed)
            setupCinemaModeListeners();
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
                
                // Load libraries with saved selections
                setTimeout(() => {
                    try {
                        fetchAndDisplayPlexLibraries(window.__savedMovieLibs||[], window.__savedShowLibs||[]);
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
            if (defaults.DEBUG) {
                console.log('Admin background change skipped - missing elements or empty queue');
                console.log('Queue length:', adminBgQueue.length);
                console.log('Active layer:', activeAdminLayer);
                console.log('Inactive layer:', inactiveAdminLayer);
            }
            return;
        }

        const oldIndex = adminBgIndex;
        adminBgIndex = (adminBgIndex + 1) % adminBgQueue.length;
        const currentItem = adminBgQueue[adminBgIndex];

        if (defaults.DEBUG) {
            console.log(`[AdminBG] index ${oldIndex} -> ${adminBgIndex}`, currentItem);
        }

        if (!currentItem || !currentItem.backgroundUrl) {
            if (defaults.DEBUG) {
                console.log('Admin background change skipped - invalid item');
                console.log('Current item:', currentItem);
            }
            return;
        }

        if (defaults.DEBUG) {
            console.log(`[AdminBG] change -> ${currentItem.title || 'Unknown'} (${adminBgIndex + 1}/${adminBgQueue.length}) url=${currentItem.backgroundUrl}`);
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
                console.log('Retrying with next image due to load error...');
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
        console.log('Setting gradient background - no fanart available');
        
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
            console.log('Admin background overlay hidden for gradient visibility');
        }
        
        console.log('Static gradient background applied:', staticGradient);
        
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
                    // Rotten Tomatoes: minimum score applied only if badge enabled; when disabled we still send value for persistence.
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
                            
                            console.log('[TMDB API Key Debug] enteredKey:', enteredKey);
                            console.log('[TMDB API Key Debug] apiKeyIsSet:', apiKeyIsSet);
                            
                            // If user entered a new key, use it
                            if (enteredKey && enteredKey.trim() !== '') {
                                console.log('[TMDB API Key Debug] Using new entered key');
                                return enteredKey.trim();
                            }
                            
                            // If field is empty but there's an existing key, preserve it by returning null
                            // (null means "don't change the existing value" in the backend)
                            if (apiKeyIsSet) {
                                console.log('[TMDB API Key Debug] Preserving existing key (returning null)');
                                return null;
                            }
                            
                            // If field is empty and no key was set, use empty string
                            console.log('[TMDB API Key Debug] No key set, using empty string');
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
                
                console.log('🔧 Manual save initiated');
                
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
                            console.log(`🔄 Retry attempt ${retryCount}/${maxRetries} after ${retryCount * 1000}ms delay`);
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

                        // Config saved successfully - show restart banner
                        showNotification('Settings saved successfully!', 'success');
                        showRestartButton();
                        
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

    // Update Check Button
    const updateCheckButton = document.getElementById('update-check-button');
    if (updateCheckButton) {
        updateCheckButton.addEventListener('click', async () => {
            setButtonState(updateCheckButton, 'loading', { text: 'Checking...' });
            
            try {
                await performUpdateCheck();
                setButtonState(updateCheckButton, 'success', { text: 'Check Complete' });
                setTimeout(() => setButtonState(updateCheckButton, 'revert'), 2000);
            } catch (error) {
                console.error('[Admin] Error during update check:', error);
                showNotification(`Error checking updates: ${error.message}`, 'error');
                setButtonState(updateCheckButton, 'revert');
            }
        });
    }

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

    // Cache configuration event listeners
    const maxSizeInput = document.getElementById('cache-max-size');
    const minFreeSpaceInput = document.getElementById('min-free-space');
    
    if (maxSizeInput) {
        maxSizeInput.addEventListener('change', () => {
            saveCacheConfig();
        });
    }
    
    if (minFreeSpaceInput) {
        minFreeSpaceInput.addEventListener('change', () => {
            saveCacheConfig();
        });
    }

    // Load cache stats when Management section is first accessed
    // Test: Also load stats on page load for debugging
    setTimeout(() => {
        console.log('Testing cache stats load on page ready...');
        // Also test if DOM elements exist
        const diskUsageElement = document.getElementById('cache-disk-usage');
        const itemCountElement = document.getElementById('cache-item-count');
        console.log('Cache DOM elements found:', {
            diskUsageElement: !!diskUsageElement,
            itemCountElement: !!itemCountElement
        });
        if (diskUsageElement && itemCountElement) {
            console.log('DOM elements found, loading cache stats...');
            loadCacheStats();
        } else {
            console.log('DOM elements not found, will try when management section is activated');
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
                        console.log('[CinemaMode] Restored Ken Burns effect');
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
                console.log('Effect Pause Time visibility:', isKenBurns ? 'hidden' : 'visible', 'for effect:', transitionEffectSelect.value);
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
        
        console.log('🔄 Auto-save initiated');
        
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
        const response = await fetch('/api/test-tvdb-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            statusElement.textContent = `✅ Connection successful! Found ${result.sampleData?.length || 0} sample items.`;
            statusElement.style.color = '#51cf66';
        } else {
            throw new Error(result.error || 'Connection test failed');
        }
    } catch (error) {
        statusElement.textContent = `❌ Connection failed: ${error.message}`;
        statusElement.style.color = '#ff6b6b';
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
    
    // Update disk usage with combined format: "1.2 GB / 2.0 GB (60%)"
    const totalSize = data.diskUsage?.total || 0;
    const imageCacheSize = data.diskUsage?.imageCache || 0;
    const logSize = data.diskUsage?.logFiles || 0;
    
    // Get max cache size from form (fallback to 2GB)
    const maxSizeInput = document.getElementById('cache-max-size');
    const maxSizeGB = maxSizeInput ? parseFloat(maxSizeInput.value) : 2;
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
 * Load cache configuration from server
 */
async function loadCacheConfig() {
    try {
        const response = await fetch('/api/admin/cache/config', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const config = await response.json();
        
        // Update form fields with loaded config
        const maxSizeInput = document.getElementById('cache-max-size');
        const minFreeSpaceInput = document.getElementById('min-free-space');
        
        if (maxSizeInput) maxSizeInput.value = config.maxSizeGB || 2;
        if (minFreeSpaceInput) minFreeSpaceInput.value = config.minFreeDiskSpaceMB || 500;
        
        console.log('Cache configuration loaded:', config);
        
    } catch (error) {
        console.error('Error loading cache configuration:', error);
        // Safe check for showNotification function
        if (typeof showNotification === 'function') {
            showNotification('Failed to load cache configuration', 'error');
        }
    }
}

/**
 * Save cache configuration to server
 */
async function saveCacheConfig() {
    try {
        const maxSizeInput = document.getElementById('cache-max-size');
        const minFreeSpaceInput = document.getElementById('min-free-space');
        
        const config = {
            maxSizeGB: parseFloat(maxSizeInput?.value || 2),
            minFreeDiskSpaceMB: parseInt(minFreeSpaceInput?.value || 500),
            autoCleanup: true
        };
        
        // Validate inputs
        if (config.maxSizeGB < 0.5 || config.maxSizeGB > 100) {
            throw new Error('Cache size must be between 0.5GB and 100GB');
        }
        
        if (config.minFreeDiskSpaceMB < 100 || config.minFreeDiskSpaceMB > 5000) {
            throw new Error('Minimum free disk space must be between 100MB and 5000MB');
        }
        
        const response = await fetch('/api/admin/cache/config', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error || 'Failed to save cache configuration');
        }
        
        const result = await response.json();
        if (typeof showNotification === 'function') {
            showNotification('Cache configuration saved successfully', 'success');
        }
        
        // Refresh cache stats to show updated limits
        setTimeout(() => refreshCacheStats(), 1000);
        
    } catch (error) {
        console.error('Error saving cache configuration:', error);
        if (typeof showNotification === 'function') {
            showNotification(`Error: ${error.message}`, 'error');
        }
    }
}

// ===================================
// Global Test Functions for Debugging
// ===================================

console.log('🔧 Setting up global test functions...');

// Add global function for testing
window.testCacheStats = function() {
    console.log('Testing cache stats manually...');
    loadCacheStats();
};

// Add direct API test function
window.testCacheAPI = async function() {
    console.log('Testing cache API directly...');
    try {
        const response = await fetch(apiUrl('/api/admin/cache-stats'), {
            method: 'GET',
            credentials: 'include'
        });
        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);
        updateCacheStatsDisplay(data);
    } catch (error) {
        console.error('Direct API test failed:', error);
    }
};

console.log('✅ Global test functions ready! Try: testCacheAPI() or testCacheStats()');

// ===================================
// Management Section Observer  
// ===================================

// Watch for management section becoming visible
const managementObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const managementSection = document.getElementById('management-section');
            if (managementSection && managementSection.style.display !== 'none') {
                console.log('Management section is now visible, loading cache stats...');
                loadCacheStats();
            }
        }
    });
});

// Start observing when DOM is ready
setTimeout(() => {
    const managementSection = document.getElementById('management-section');
    if (managementSection) {
        console.log('Starting management section observer...');
        managementObserver.observe(managementSection, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
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
    const updateAvailable = data.updateAvailable || false;
    
    updateContent.innerHTML = `
        <div class="status-grid">
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-tag"></i>
                    Current Version
                </div>
                <div class="status-item-value status-info">
                    ${currentVersion}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-cloud-download-alt"></i>
                    Latest Version
                </div>
                <div class="status-item-value status-info">
                    ${latestVersion}
                </div>
            </div>
            <div class="status-item">
                <div class="status-item-header">
                    <i class="fas fa-exclamation-circle"></i>
                    Update Status
                </div>
                <div class="status-item-value ${updateAvailable ? 'status-warning' : 'status-success'}">
                    ${updateAvailable ? 'Update Available' : 'Up to Date'}
                </div>
            </div>
        </div>
        ${updateAvailable ? `
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(255, 152, 0, 0.1); border: 1px solid rgba(255, 152, 0, 0.3); border-radius: 6px;">
                <p style="margin: 0; color: #ff9800;">
                    <i class="fas fa-info-circle"></i> 
                    A new version is available. Please check the 
                    <a href="https://github.com/Posterrama/posterrama" target="_blank" style="color: #667eea;">GitHub repository</a> 
                    for update instructions.
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

// Restart Button Management
function showRestartButton() {
    const restartBtn = document.getElementById('restart-now-btn');
    
    if (restartBtn) {
        restartBtn.style.display = 'flex';
        
        // Store in sessionStorage so button persists across page navigation
        sessionStorage.setItem('restartButtonVisible', 'true');
    }
}

function hideRestartButton() {
    const restartBtn = document.getElementById('restart-now-btn');
    
    if (restartBtn) {
        restartBtn.style.display = 'none';
        
        // Remove from sessionStorage
        sessionStorage.removeItem('restartButtonVisible');
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
        showNotification('Server is restarting... Please refresh the page in a few seconds.', 'info');
        hideRestartButton();
        
        // Auto-refresh after 3 seconds
        setTimeout(() => {
            window.location.reload();
        }, 3000);
    }).catch(error => {
        console.error('Restart failed:', error);
        showNotification('Could not restart server automatically. Please restart manually if needed.', 'warning');
        
        // Restore button state
        restartBtn.disabled = false;
        restartBtn.innerHTML = originalText;
    });
}

// Initialize restart button functionality
document.addEventListener('DOMContentLoaded', function() {
    // Check if restart button should be visible (from sessionStorage)
    if (sessionStorage.getItem('restartButtonVisible') === 'true') {
        showRestartButton();
    }
    
    // Restart now button handler
    const restartNowBtn = document.getElementById('restart-now-btn');
    if (restartNowBtn) {
        restartNowBtn.addEventListener('click', performRestart);
    }
});
