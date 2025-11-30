/**
 * Parallax Scrolling Mode for Wallart
 *
 * Implements true parallax depth effect with continuous vertical scrolling.
 * Multiple layers scroll at different speeds creating 3D depth perception.
 *
 * Architecture:
 * - 2-4 depth layers (configurable)
 * - Each layer is an independent scrolling container
 * - Background layers scroll slower than foreground
 * - Infinite scroll with dynamic poster loading
 * - GPU-accelerated transforms for smooth 60fps
 */

(function () {
    'use strict';

    // Module state
    const state = {
        isActive: false,
        layers: [],
        config: null,
        posterQueue: [],
        allPosters: [], // Growing pool of all loaded posters
        isFetching: false,
        lastFetchTime: 0,
        fetchCount: 0,
        animationFrame: null,
        lastTime: 0,
        scrollSpeed: 20, // Base pixels per second
    };

    /**
     * Initialize parallax scrolling mode
     * @param {Object} config - Configuration from window.appConfig.wallartMode
     * @param {Array} posters - Array of poster items to display
     */
    function init(config, posters) {
        console.log('[ParallaxScrolling] Initializing with config:', config);

        // Clean up any existing instance
        cleanup();

        state.config = config.parallaxDepth || {};
        state.allPosters = [...posters];
        state.posterQueue = shuffleArray([...posters]);
        state.isFetching = false;
        state.lastFetchTime = Date.now();
        state.fetchCount = 0;
        state.isActive = true;

        // Create layer containers
        createLayers();

        // Start animation loop
        startScrolling();

        console.log('[ParallaxScrolling] Initialized with', state.layers.length, 'layers');
    }

    /**
     * Create depth layer containers
     */
    function createLayers() {
        const layerCount = parseInt(state.config.layerCount) || 3;
        const perspective = parseInt(state.config.perspective) || 1000;
        const depthScale = parseFloat(state.config.depthScale) || 1.3;

        // Create perspective container
        const perspectiveContainer = document.createElement('div');
        perspectiveContainer.id = 'parallax-perspective-container';
        perspectiveContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            perspective: ${perspective}px;
            perspective-origin: 50% 50%;
            transform-style: preserve-3d;
            background: #000;
            z-index: 10000;
        `;

        // Create each depth layer
        for (let i = 0; i < layerCount; i++) {
            const layer = createLayer(i, layerCount, depthScale);
            perspectiveContainer.appendChild(layer.container);
            state.layers.push(layer);
        }

        document.body.appendChild(perspectiveContainer);
    }

    /**
     * Create a single depth layer
     * @param {number} layerIndex - Layer index (0 = background)
     * @param {number} totalLayers - Total number of layers
     * @param {number} depthScale - Scale multiplier for depth
     * @returns {Object} Layer object with container and state
     */
    function createLayer(layerIndex, totalLayers, depthScale) {
        const container = document.createElement('div');
        container.className = 'parallax-layer';
        container.dataset.layer = layerIndex;

        // Calculate depth position and scale
        const depthRatio = layerIndex / (totalLayers - 1); // 0 to 1
        const translateZ = -200 + depthRatio * 400; // -200 to +200
        const scale = 1 + depthRatio * (depthScale - 1); // Scale increases with depth

        // Speed multiplier: background slower, foreground faster
        const speedMultiplier = 0.3 + depthRatio * 0.7; // 0.3x to 1.0x

        // Calculate responsive grid columns based on viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Determine optimal poster width based on resolution
        let posterWidth;
        if (viewportWidth >= 3840) {
            // 4K and above: smaller posters, more columns
            posterWidth = 280;
        } else if (viewportWidth >= 2560) {
            // 2K: medium posters
            posterWidth = 250;
        } else if (viewportWidth >= 1920) {
            // 1080p: standard posters
            posterWidth = 220;
        } else {
            // Lower resolutions: larger posters
            posterWidth = 200;
        }

        const columns = Math.floor(viewportWidth / (posterWidth + 20)); // 20px gap
        const gap = 20;
        const padding = 20;

        // Calculate how many posters we need for smooth infinite scroll
        // Need enough to fill ~3x viewport height to ensure no gaps during scroll
        const posterHeight = Math.round(posterWidth * 1.5); // 2:3 aspect ratio
        const rowsNeeded = Math.ceil((viewportHeight * 3) / (posterHeight + gap));
        const posterCount = columns * rowsNeeded;

        container.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: ${viewportHeight * 3}px;
            transform: translateZ(${translateZ}px) scale(${scale});
            transform-style: preserve-3d;
            will-change: transform;
            display: grid;
            grid-template-columns: repeat(${columns}, ${posterWidth}px);
            gap: ${gap}px;
            padding: ${padding}px;
            align-content: start;
            justify-content: center;
        `;

        // Fill layer with calculated poster count
        console.log(
            `[ParallaxScrolling] Layer ${layerIndex}: ${columns} columns × ${rowsNeeded} rows = ${posterCount} posters`
        );

        for (let i = 0; i < posterCount; i++) {
            const poster = getNextPoster();
            if (!poster) {
                console.warn(
                    `[ParallaxScrolling] Not enough posters for layer ${layerIndex}, only got ${i}/${posterCount}`
                );
                break;
            }

            const posterEl = createPosterElement(poster, posterWidth);
            container.appendChild(posterEl);
        }

        return {
            container,
            layerIndex,
            speedMultiplier,
            scrollPosition: 0,
            translateZ,
            scale,
        };
    }

    /**
     * Create a poster element
     * @param {Object} poster - Poster data
     * @param {number} width - Poster width in pixels
     * @returns {HTMLElement} Poster element
     */
    function createPosterElement(poster, width = 250) {
        const posterEl = document.createElement('div');
        posterEl.className = 'parallax-poster';
        const height = Math.round(width * 1.5);
        posterEl.style.cssText = `
            width: ${width}px;
            height: ${height}px;
            background: #111;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;

        const img = document.createElement('img');
        img.src = poster.posterUrl;
        img.alt = poster.title || 'Poster';
        img.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        `;

        posterEl.appendChild(img);
        return posterEl;
    }

    /**
     * Shuffle array using Fisher-Yates algorithm
     */
    function shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Fetch more posters from API
     */
    async function fetchMorePosters() {
        if (state.isFetching) return;

        // Rate limit: don't fetch more than once per 10 seconds
        const now = Date.now();
        if (now - state.lastFetchTime < 10000) return;

        state.isFetching = true;
        state.lastFetchTime = now;
        state.fetchCount++;

        console.log(`[ParallaxScrolling] Fetching more posters (batch ${state.fetchCount})...`);

        try {
            const baseUrl = window.location.origin;
            const count = 100; // Fetch 100 more posters each time
            const type = window.appConfig?.type || 'movie';
            const musicMode = window.appConfig?.wallartMode?.musicMode?.enabled === true;

            let url = `${baseUrl}/get-media?count=${count}&type=${encodeURIComponent(type)}`;
            if (musicMode) {
                url += '&musicMode=1';
            }

            const res = await fetch(url, {
                cache: 'no-cache',
                headers: { Accept: 'application/json' },
            });

            if (!res.ok) {
                console.warn('[ParallaxScrolling] Failed to fetch more posters:', res.status);
                state.isFetching = false;
                return;
            }

            const data = await res.json();
            const newPosters = Array.isArray(data)
                ? data
                : Array.isArray(data?.results)
                  ? data.results
                  : [];

            if (newPosters.length > 0) {
                console.log(`[ParallaxScrolling] Loaded ${newPosters.length} new posters`);

                // Add new posters to pool
                state.allPosters.push(...newPosters);

                // Add shuffled new posters to queue
                const shuffledNew = shuffleArray(newPosters);
                state.posterQueue.push(...shuffledNew);
            }
        } catch (err) {
            console.error('[ParallaxScrolling] Error fetching more posters:', err);
        } finally {
            state.isFetching = false;
        }
    }

    /**
     * Get next poster with automatic API fetching when queue runs low
     * Prevents duplicates currently visible on screen
     * @param {Set<string>} visiblePosters - Set of currently visible poster URLs
     * @returns {Object|null} Poster object
     */
    function getNextPoster(visiblePosters = new Set()) {
        if (state.allPosters.length === 0) return null;

        // If queue is running low, fetch more posters
        if (state.posterQueue.length < 20 && !state.isFetching) {
            fetchMorePosters();
        }

        // If queue is empty, add shuffled posters from existing pool while waiting for fetch
        if (state.posterQueue.length === 0) {
            console.log('[ParallaxScrolling] Queue empty, reshuffling existing pool...');
            state.posterQueue = shuffleArray([...state.allPosters]);
        }

        // Find next poster that isn't currently visible on screen
        let poster = null;
        let attempts = 0;
        const maxAttempts = Math.min(50, state.posterQueue.length);

        while (attempts < maxAttempts && poster === null) {
            const candidate = state.posterQueue.shift();
            if (!candidate) break;

            // If not visible on screen, use it
            if (!visiblePosters.has(candidate.posterUrl)) {
                poster = candidate;
            } else {
                // Put back at end of queue and try next
                state.posterQueue.push(candidate);
            }
            attempts++;
        }

        // If all posters are visible (small pool), just return next one
        if (!poster && state.posterQueue.length > 0) {
            poster = state.posterQueue.shift();
        }

        return poster || null;
    }

    /**
     * Start scrolling animation loop
     */
    function startScrolling() {
        state.lastTime = performance.now();

        function animate(currentTime) {
            if (!state.isActive) return;

            const deltaTime = (currentTime - state.lastTime) / 1000; // Convert to seconds
            state.lastTime = currentTime;

            // Update each layer
            updateLayers(deltaTime);

            state.animationFrame = requestAnimationFrame(animate);
        }

        state.animationFrame = requestAnimationFrame(animate);
    }

    /**
     * Update all layers' scroll positions
     * @param {number} deltaTime - Time since last frame in seconds
     */
    function updateLayers(deltaTime) {
        const speed = parseFloat(state.config.speed) || 1.0;
        const smoothScroll = state.config.smoothScroll !== false;
        const baseSpeed = state.scrollSpeed * speed;

        state.layers.forEach(layer => {
            // Calculate scroll distance for this frame
            const scrollDistance = baseSpeed * deltaTime * layer.speedMultiplier;

            // Apply smooth scroll interpolation if enabled
            if (smoothScroll) {
                // Ease-out interpolation for smoother movement
                const easeFactor = 0.15; // Lower = less dampening, faster response
                const targetPosition = layer.scrollPosition + scrollDistance;
                layer.scrollPosition += (targetPosition - layer.scrollPosition) * (1 - easeFactor);
            } else {
                // Linear movement (no interpolation)
                layer.scrollPosition += scrollDistance;
            }

            // Update layer position for continuous scroll
            const layerHeight = window.innerHeight * 3;
            const yOffset = -layer.scrollPosition % layerHeight;

            // Apply CSS transition for additional smoothness if enabled
            if (smoothScroll && !layer.container.style.transition) {
                layer.container.style.transition = 'top 0.1s ease-out';
            } else if (!smoothScroll && layer.container.style.transition) {
                layer.container.style.transition = 'none';
            }

            layer.container.style.top = `${yOffset}px`;

            // Recycle posters when layer scrolls past full layer height (3x viewport)
            if (layer.scrollPosition > layerHeight) {
                layer.scrollPosition -= layerHeight;
                recyclePoster(layer.container);
            }
        });
    }

    /**
     * Recycle posters by updating the first row with new content
     * @param {HTMLElement} container - Layer container
     */
    function recyclePoster(container) {
        const posters = container.querySelectorAll('.parallax-poster');
        if (posters.length === 0) return;

        // Collect all currently visible poster URLs across all layers to prevent duplicates
        const visiblePosters = new Set();
        state.layers.forEach(layer => {
            const layerPosters = layer.container.querySelectorAll('.parallax-poster img');
            layerPosters.forEach(img => {
                if (img.src) visiblePosters.add(img.src);
            });
        });

        // Get actual column count from grid
        const computedStyle = window.getComputedStyle(container);
        const gridColumns = computedStyle.gridTemplateColumns.split(' ').length;

        // Recycle first row (first 'gridColumns' number of posters)
        for (let i = 0; i < Math.min(gridColumns, posters.length); i++) {
            const posterEl = posters[i];

            // Remove old poster from visible set before getting new one
            const img = posterEl.querySelector('img');
            if (img && img.src) {
                visiblePosters.delete(img.src);
            }

            const newPoster = getNextPoster(visiblePosters);
            if (!newPoster) continue;

            // Update image
            if (img) {
                img.src = newPoster.posterUrl;
                img.alt = newPoster.title || 'Poster';
                visiblePosters.add(newPoster.posterUrl);
            }

            // Move to end
            container.appendChild(posterEl);
        }
    }

    /**
     * Stop scrolling and clean up
     */
    function cleanup() {
        console.log('[ParallaxScrolling] Cleaning up');

        state.isActive = false;

        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }

        // Remove container
        const container = document.getElementById('parallax-perspective-container');
        if (container) {
            container.remove();
        }

        // Reset state
        state.layers = [];
        state.scrollPosition = 0;
        state.posterQueue = [];
        state.allPosters = [];
        state.isFetching = false;
        state.fetchCount = 0;
    }

    /**
     * Update configuration on the fly
     * @param {Object} newConfig - New parallax configuration
     */
    function updateConfig(newConfig) {
        console.log('[ParallaxScrolling] Updating config:', newConfig);

        state.config = newConfig;

        // Update perspective
        const container = document.getElementById('parallax-perspective-container');
        if (container) {
            const perspective = parseInt(newConfig.perspective) || 1000;
            container.style.perspective = `${perspective}px`;
        }

        // Update scroll speed
        state.scrollSpeed = 20 * (parseFloat(newConfig.speed) || 1.0);

        // Update smooth scroll transition on layers
        const smoothScroll = newConfig.smoothScroll !== false;
        state.layers.forEach(layer => {
            if (smoothScroll) {
                layer.container.style.transition = 'top 0.1s ease-out';
            } else {
                layer.container.style.transition = 'none';
            }
        });
    }

    // Export public API
    window.ParallaxScrolling = {
        init,
        cleanup,
        updateConfig,
        isActive: () => state.isActive,
    };

    console.log('[ParallaxScrolling] Module loaded');
})();
