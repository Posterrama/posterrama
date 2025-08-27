/**
 * Lazy Loading Implementation for Posterrama
 * Uses Intersection Observer API for optimal performance
 */

class LazyLoader {
    constructor(options = {}) {
        this.options = {
            rootMargin: '50px 0px', // Load images 50px before they enter viewport
            threshold: 0.01, // Trigger when 1% of image is visible
            enableRetry: true,
            retryDelay: 1000,
            maxRetries: 3,
            ...options,
        };

        this.observer = null;
        this.loadingImages = new Set();
        this.failedImages = new Map(); // Track retry counts

        this.init();
    }

    init() {
        // Check if Intersection Observer is supported
        if (!('IntersectionObserver' in window)) {
            console.warn(
                '[LazyLoader] IntersectionObserver not supported, falling back to immediate loading'
            );
            this.loadAllImages();
            return;
        }

        // Create observer
        this.observer = new IntersectionObserver(this.handleIntersection.bind(this), this.options);

        // Find and observe all lazy images
        this.observeImages();
    }

    observeImages() {
        const lazyImages = document.querySelectorAll('img[data-lazy-src]');
        lazyImages.forEach(img => {
            this.observer.observe(img);
        });

        console.log(`[LazyLoader] Observing ${lazyImages.length} lazy images`);
    }

    handleIntersection(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                this.loadImage(entry.target);
                this.observer.unobserve(entry.target);
            }
        });
    }

    async loadImage(img) {
        if (this.loadingImages.has(img)) {
            return; // Already loading
        }

        const lazySrc = img.getAttribute('data-lazy-src');
        if (!lazySrc) {
            return;
        }

        this.loadingImages.add(img);

        try {
            // Add loading class for styling
            img.classList.add('lazy-loading');

            // Create new image to preload
            const newImg = new Image();

            // Set up load handlers
            await new Promise((resolve, reject) => {
                newImg.onload = () => {
                    // Successfully loaded, update src
                    img.src = lazySrc;
                    img.removeAttribute('data-lazy-src');
                    img.classList.remove('lazy-loading');
                    img.classList.add('lazy-loaded');

                    // Remove from failed images if it was there
                    this.failedImages.delete(img);

                    resolve();
                };

                newImg.onerror = () => {
                    reject(new Error(`Failed to load image: ${lazySrc}`));
                };

                // Start loading
                newImg.src = lazySrc;
            });

            console.log(`[LazyLoader] Successfully loaded: ${lazySrc}`);
        } catch (error) {
            console.warn(`[LazyLoader] Failed to load image: ${lazySrc}`, error);

            img.classList.remove('lazy-loading');
            img.classList.add('lazy-error');

            // Handle retry logic
            if (this.options.enableRetry) {
                this.handleRetry(img, lazySrc);
            }
        } finally {
            this.loadingImages.delete(img);
        }
    }

    handleRetry(img, src) {
        const retryCount = this.failedImages.get(img) || 0;

        if (retryCount < this.options.maxRetries) {
            this.failedImages.set(img, retryCount + 1);

            setTimeout(
                () => {
                    console.log(
                        `[LazyLoader] Retrying image load (${retryCount + 1}/${this.options.maxRetries}): ${src}`
                    );
                    this.loadImage(img);
                },
                this.options.retryDelay * (retryCount + 1)
            ); // Exponential backoff
        } else {
            console.error(`[LazyLoader] Max retries exceeded for: ${src}`);
            this.failedImages.delete(img);
        }
    }

    // Fallback for browsers without Intersection Observer
    loadAllImages() {
        const lazyImages = document.querySelectorAll('img[data-lazy-src]');
        lazyImages.forEach(img => {
            const src = img.getAttribute('data-lazy-src');
            if (src) {
                img.src = src;
                img.removeAttribute('data-lazy-src');
            }
        });
    }

    // Add new images to be observed (useful for dynamic content)
    observe(img) {
        if (this.observer && img.hasAttribute('data-lazy-src')) {
            this.observer.observe(img);
        }
    }

    // Manually trigger loading for specific images
    loadNow(selector) {
        const images =
            typeof selector === 'string' ? document.querySelectorAll(selector) : [selector];

        images.forEach(img => {
            if (img.hasAttribute('data-lazy-src')) {
                this.loadImage(img);
                if (this.observer) {
                    this.observer.unobserve(img);
                }
            }
        });
    }

    // Clean up observer
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.loadingImages.clear();
        this.failedImages.clear();
    }
}

// Global instance
window.lazyLoader = new LazyLoader();

// Auto-reinitialize when new content is added
const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
Object.defineProperty(Element.prototype, 'innerHTML', {
    set: function (value) {
        originalDescriptor.set.call(this, value);

        // Re-observe new lazy images after a short delay
        setTimeout(() => {
            if (window.lazyLoader && window.lazyLoader.observer) {
                window.lazyLoader.observeImages();
            }
        }, 100);
    },
    get: function () {
        return originalDescriptor.get.call(this);
    },
});

// Utility function to convert regular images to lazy images
function makeLazy(img, src) {
    if (img && src) {
        img.setAttribute('data-lazy-src', src);
        img.src =
            'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB2aWV3Qm94PSIwIDAgMSAxIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9InRyYW5zcGFyZW50Ii8+PC9zdmc+'; // 1x1 transparent SVG
        window.lazyLoader?.observe(img);
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LazyLoader, makeLazy };
}
