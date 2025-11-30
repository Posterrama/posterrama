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
        state.posterQueue = [...posters];
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

        container.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 200%;
            transform: translateZ(${translateZ}px) scale(${scale});
            transform-style: preserve-3d;
            will-change: transform;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 20px;
            align-content: start;
        `;

        // Fill layer with posters in grid
        const posterCount = Math.ceil((window.innerWidth / 270) * 4); // ~4 rows worth
        for (let i = 0; i < posterCount; i++) {
            const poster = getNextPoster(layerIndex);
            if (!poster) continue;

            const posterEl = createPosterElement(poster);
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
     * @returns {HTMLElement} Poster element
     */
    function createPosterElement(poster) {
        const posterEl = document.createElement('div');
        posterEl.className = 'parallax-poster';
        posterEl.style.cssText = `
            aspect-ratio: 2/3;
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
     * Get next poster from queue (cycling through)
     * @param {number} layerIndex - Layer index for distribution
     * @returns {Object|null} Poster object
     */
    function getNextPoster(layerIndex) {
        if (state.posterQueue.length === 0) return null;

        // Distribute posters across layers
        const posterIndex = (layerIndex * 37) % state.posterQueue.length;
        const poster = state.posterQueue[posterIndex];

        // Rotate queue
        state.posterQueue.push(state.posterQueue.shift());

        return poster;
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
        const baseSpeed = state.scrollSpeed * speed;

        state.layers.forEach(layer => {
            // Calculate scroll distance for this frame
            const scrollDistance = baseSpeed * deltaTime * layer.speedMultiplier;
            layer.scrollPosition += scrollDistance;

            // Update layer position for continuous scroll
            const yOffset = -layer.scrollPosition % window.innerHeight;
            layer.container.style.top = `${yOffset}px`;

            // Recycle posters when layer scrolls full height
            if (layer.scrollPosition > window.innerHeight) {
                layer.scrollPosition -= window.innerHeight;
                recyclePoster(layer.container, layer.layerIndex);
            }
        });
    }

    /**
     * Recycle posters by updating the first row with new content
     * @param {HTMLElement} container - Layer container
     * @param {number} layerIndex - Layer index
     */
    function recyclePoster(container, layerIndex) {
        const posters = container.querySelectorAll('.parallax-poster');
        if (posters.length === 0) return;

        // Calculate columns in grid
        const cols = Math.floor(window.innerWidth / 270);

        // Recycle first row (first 'cols' number of posters)
        for (let i = 0; i < Math.min(cols, posters.length); i++) {
            const posterEl = posters[i];
            const newPoster = getNextPoster(layerIndex);
            if (!newPoster) continue;

            // Update image
            const img = posterEl.querySelector('img');
            if (img) {
                img.src = newPoster.posterUrl;
                img.alt = newPoster.title || 'Poster';
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
