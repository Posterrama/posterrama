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
            height: 100%;
            transform: translateZ(${translateZ}px) scale(${scale});
            transform-style: preserve-3d;
            will-change: transform;
        `;

        // Create two columns for seamless infinite scroll
        const column1 = createColumn();
        const column2 = createColumn();
        container.appendChild(column1);
        container.appendChild(column2);

        // Fill initial posters
        fillColumn(column1, layerIndex);
        fillColumn(column2, layerIndex);

        return {
            container,
            column1,
            column2,
            layerIndex,
            speedMultiplier,
            scrollPosition: 0,
            translateZ,
            scale,
        };
    }

    /**
     * Create a column container for posters
     */
    function createColumn() {
        const column = document.createElement('div');
        column.className = 'parallax-column';
        column.style.cssText = `
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            gap: 20px;
            padding: 20px;
        `;
        return column;
    }

    /**
     * Fill a column with posters
     * @param {HTMLElement} column - Column container
     * @param {number} layerIndex - Layer index for poster selection
     */
    function fillColumn(column, layerIndex) {
        const posterCount = 6; // Posters per column
        const posterWidth = Math.min(300, window.innerWidth * 0.25);
        const posterHeight = posterWidth * 1.5;

        for (let i = 0; i < posterCount; i++) {
            const poster = getNextPoster(layerIndex);
            if (!poster) continue;

            const posterEl = document.createElement('div');
            posterEl.className = 'parallax-poster';
            posterEl.style.cssText = `
                width: ${posterWidth}px;
                height: ${posterHeight}px;
                background: #111;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                flex-shrink: 0;
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
            column.appendChild(posterEl);
        }
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

            // Get column height
            const columnHeight = layer.column1.offsetHeight;

            // Update column positions for infinite scroll
            const offset1 = -layer.scrollPosition % columnHeight;
            const offset2 = offset1 + columnHeight;

            layer.column1.style.transform = `translateX(-50%) translateY(${offset1}px)`;
            layer.column2.style.transform = `translateX(-50%) translateY(${offset2}px)`;

            // Recycle posters when they scroll off screen
            if (layer.scrollPosition > columnHeight) {
                layer.scrollPosition -= columnHeight;
                recyclePoster(layer.column1, layer.layerIndex);
            }
        });
    }

    /**
     * Recycle a poster by moving it from top to bottom of column
     * @param {HTMLElement} column - Column container
     * @param {number} layerIndex - Layer index
     */
    function recyclePoster(column, layerIndex) {
        const firstPoster = column.firstElementChild;
        if (!firstPoster) return;

        // Get new poster
        const poster = getNextPoster(layerIndex);
        if (!poster) return;

        // Update image
        const img = firstPoster.querySelector('img');
        if (img) {
            img.src = poster.posterUrl;
            img.alt = poster.title || 'Poster';
        }

        // Move to end
        column.appendChild(firstPoster);
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
