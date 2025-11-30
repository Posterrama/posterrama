/**
 * UI Components Library
 * Reusable vanilla JavaScript components for admin interface
 *
 * @module utils/ui-components
 */

/**
 * Preset color definitions used across color pickers
 */
export const COLOR_PRESETS = [
    {
        color: '#b40f0f',
        name: 'Classic Red',
        gradient: 'linear-gradient(135deg, #b40f0f 0%, #780505 100%)',
    },
    {
        color: '#1e40af',
        name: 'Deep Blue',
        gradient: 'linear-gradient(135deg, #1e40af 0%, #0f2a6e 100%)',
    },
    {
        color: '#15803d',
        name: 'Forest Green',
        gradient: 'linear-gradient(135deg, #15803d 0%, #0d5528 100%)',
    },
    {
        color: '#0e7490',
        name: 'Ocean Teal',
        gradient: 'linear-gradient(135deg, #0e7490 0%, #084c61 100%)',
    },
    {
        color: '#6b21a8',
        name: 'Royal Purple',
        gradient: 'linear-gradient(135deg, #6b21a8 0%, #471670 100%)',
    },
    {
        color: '#be123c',
        name: 'Deep Rose',
        gradient: 'linear-gradient(135deg, #be123c 0%, #7f0c28 100%)',
    },
    {
        color: '#d97706',
        name: 'Golden Amber',
        gradient: 'linear-gradient(135deg, #d97706 0%, #905004 100%)',
    },
];

/**
 * Creates a reusable color picker component with preset colors, live preview,
 * and automatic iframe refresh on color change.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.label - Display label for the color picker
 * @param {string} [options.color='#ffffff'] - Initial hex color value
 * @param {string} options.defaultColor - Default color for reset button
 * @param {Array<Object>} [options.presets=COLOR_PRESETS] - Array of preset color objects
 * @param {Function} options.onColorChange - Callback function when color changes (receives hex color)
 * @param {string} [options.messageType] - Optional postMessage type for iframe communication
 * @param {boolean} [options.refreshIframe=true] - Whether to auto-refresh preview iframe on change
 * @param {string} [options.iframeId='display-preview-frame'] - ID of preview iframe element
 *
 * @returns {HTMLElement} The color picker container element
 *
 * @example
 * const picker = createColorPicker({
 *   label: 'Accent Color',
 *   color: '#b40f0f',
 *   defaultColor: '#b40f0f',
 *   onColorChange: (color) => {
 *     config.accentColor = color;
 *   },
 *   messageType: 'FILMCARDS_ACCENT_COLOR_UPDATE'
 * });
 * document.getElementById('settings-container').appendChild(picker);
 */
export function createColorPicker(options) {
    const {
        label,
        color = '#ffffff',
        defaultColor,
        presets = COLOR_PRESETS,
        onColorChange,
        messageType,
        refreshIframe = true,
        iframeId = 'display-preview-frame',
    } = options;

    // Validate required options
    if (!label) throw new Error('createColorPicker: label is required');
    if (!defaultColor) throw new Error('createColorPicker: defaultColor is required');
    if (typeof onColorChange !== 'function') {
        throw new Error('createColorPicker: onColorChange must be a function');
    }

    // Color conversion utilities
    const hexToRgb = hex => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? {
                  r: parseInt(result[1], 16),
                  g: parseInt(result[2], 16),
                  b: parseInt(result[3], 16),
              }
            : null;
    };

    const rgbToHex = (r, g, b) => {
        return (
            '#' +
            [r, g, b]
                .map(x => {
                    const hex = Math.round(x).toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                })
                .join('')
        );
    };

    const rgbToHsv = (r, g, b) => {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b),
            min = Math.min(r, g, b);
        const d = max - min;
        const s = max === 0 ? 0 : d / max;
        const v = max;
        let h = 0;

        if (max !== min) {
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }

        return { h: h * 360, s: s * 100, v: v * 100 };
    };

    const hsvToRgb = (h, s, v) => {
        h /= 360;
        s /= 100;
        v /= 100;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);

        let r, g, b;
        switch (i % 6) {
            case 0:
                r = v;
                g = t;
                b = p;
                break;
            case 1:
                r = q;
                g = v;
                b = p;
                break;
            case 2:
                r = p;
                g = v;
                b = t;
                break;
            case 3:
                r = p;
                g = q;
                b = v;
                break;
            case 4:
                r = t;
                g = p;
                b = v;
                break;
            case 5:
                r = v;
                g = p;
                b = q;
                break;
        }

        return { r: r * 255, g: g * 255, b: b * 255 };
    };

    // Create unique IDs for this instance
    const instanceId = `color-picker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const pickerId = `${instanceId}-picker`;
    const textId = `${instanceId}-text`;
    const circleId = `${instanceId}-circle`;
    const resetId = `${instanceId}-reset`;
    const presetClass = `${instanceId}-preset`;

    // Create container
    const container = document.createElement('div');
    container.className = 'form-row color-picker-component';
    container.style.display = 'block';

    // Add styles to hide number input spinners
    const styleId = `${pickerId}-styles`;
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #${pickerId}-r::-webkit-inner-spin-button,
            #${pickerId}-r::-webkit-outer-spin-button,
            #${pickerId}-g::-webkit-inner-spin-button,
            #${pickerId}-g::-webkit-outer-spin-button,
            #${pickerId}-b::-webkit-inner-spin-button,
            #${pickerId}-b::-webkit-outer-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
        `;
        document.head.appendChild(style);
    }

    // Build HTML structure with custom picker popup
    container.innerHTML = `
        <label style="display: block; margin-bottom: 12px; font-weight: 600;">
            <i class="fas fa-palette"></i> ${label}
        </label>
        
        <div style="display: flex; align-items: center; gap: 16px; position: relative;">
            <!-- Color Circle Preview -->
            <div id="${circleId}" style="width: 48px; height: 48px; flex-shrink: 0; border-radius: 50%; background: ${color}; border: 2px solid var(--color-border); box-shadow: 0 2px 8px rgba(0,0,0,0.2); cursor: pointer; transition: all 0.2s ease; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                <div style="position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(0,0,0,0.2) 100%);"></div>
                <i class="fas fa-paint-brush" style="color: white; font-size: 1.2rem; opacity: 0; transform: scale(0.8); transition: all 0.2s ease; text-shadow: 0 2px 4px rgba(0,0,0,0.5); position: relative; z-index: 2;"></i>
            </div>
            
            <!-- Hex Input -->
            <input type="text" id="${textId}" value="${color.toUpperCase()}" pattern="^#[0-9A-Fa-f]{6}$" maxlength="7" style="flex: 1; font-family: 'Courier New', monospace; font-weight: 600; letter-spacing: 0.5px; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--color-border); background: var(--color-bg-tertiary);" placeholder="#FFFFFF" />
            
            <!-- Reset Button -->
            <button type="button" id="${resetId}" style="padding: 10px 16px; border-radius: 8px; border: 1px solid var(--color-border); background: var(--color-bg-tertiary); cursor: pointer; transition: all 0.2s ease; font-weight: 600; color: var(--color-text-secondary);" title="Reset to default">
                <i class="fas fa-undo"></i>
            </button>
            
            <!-- Custom Color Picker Popup -->
            <div id="${pickerId}-popup" style="display: none; position: absolute; top: 100%; left: 0; margin-top: 8px; background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: 12px; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 1000; min-width: 320px;">
                <!-- Saturation/Value Gradient -->
                <div id="${pickerId}-sv-container" style="position: relative; width: 280px; height: 200px; margin-bottom: 16px; border-radius: 8px; cursor: crosshair; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);">
                    <div id="${pickerId}-sv-gradient" style="position: absolute; inset: 0; background: linear-gradient(to right, #fff, hsl(0, 100%, 50%));">
                        <div style="position: absolute; inset: 0; background: linear-gradient(to top, #000, transparent);"></div>
                    </div>
                    <div id="${pickerId}-sv-cursor" style="position: absolute; width: 16px; height: 16px; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2); pointer-events: none; transform: translate(-50%, -50%);"></div>
                </div>
                
                <!-- Hue Slider -->
                <div id="${pickerId}-hue-container" style="position: relative; width: 280px; height: 12px; margin-bottom: 20px; border-radius: 6px; cursor: pointer; background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);">
                    <div id="${pickerId}-hue-cursor" style="position: absolute; top: 50%; width: 16px; height: 16px; background: #fff; border: 2px solid var(--color-border); border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transform: translate(-50%, -50%); pointer-events: none;"></div>
                </div>
                
                <!-- RGB Inputs -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">
                    <div>
                        <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--color-text-secondary);">R</label>
                        <input type="number" id="${pickerId}-r" min="0" max="255" style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg-tertiary); text-align: center; font-weight: 600; -moz-appearance: textfield;" />
                    </div>
                    <div>
                        <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--color-text-secondary);">G</label>
                        <input type="number" id="${pickerId}-g" min="0" max="255" style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg-tertiary); text-align: center; font-weight: 600; -moz-appearance: textfield;" />
                    </div>
                    <div>
                        <label style="display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--color-text-secondary);">B</label>
                        <input type="number" id="${pickerId}-b" min="0" max="255" style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg-tertiary); text-align: center; font-weight: 600; -moz-appearance: textfield;" />
                    </div>
                </div>
                
                <!-- Color Presets -->
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${presets
                        .map(
                            preset => `
                        <div class="${presetClass}" data-color="${preset.color}" style="width: 32px; height: 32px; border-radius: 6px; background: ${preset.gradient}; cursor: pointer; border: 2px solid transparent; transition: all 0.2s ease;" title="${preset.name}"></div>
                    `
                        )
                        .join('')}
                </div>
            </div>
        </div>
    `;

    // Get element references
    const colorCircle = container.querySelector(`#${circleId}`);
    const colorText = container.querySelector(`#${textId}`);
    const colorReset = container.querySelector(`#${resetId}`);
    const popup = container.querySelector(`#${pickerId}-popup`);
    const svContainer = container.querySelector(`#${pickerId}-sv-container`);
    const svGradient = container.querySelector(`#${pickerId}-sv-gradient`);
    const svCursor = container.querySelector(`#${pickerId}-sv-cursor`);
    const hueContainer = container.querySelector(`#${pickerId}-hue-container`);
    const hueCursor = container.querySelector(`#${pickerId}-hue-cursor`);
    const rInput = container.querySelector(`#${pickerId}-r`);
    const gInput = container.querySelector(`#${pickerId}-g`);
    const bInput = container.querySelector(`#${pickerId}-b`);
    const colorPresets = container.querySelectorAll(`.${presetClass}`);

    // State
    let currentHSV = { h: 0, s: 100, v: 100 };
    let isDraggingSV = false;
    let isDraggingHue = false;

    /**
     * Send color update to preview iframe via postMessage
     * @param {string} hex - Hex color value
     */
    const sendColorToPreview = hex => {
        if (!messageType) return;

        const previewIframe = document.getElementById(iframeId);
        if (previewIframe && previewIframe.contentWindow) {
            previewIframe.contentWindow.postMessage(
                {
                    type: messageType,
                    color: hex,
                },
                '*'
            );
        }
    };

    /**
     * Refresh preview iframe with cache-busting parameter
     */
    const refreshPreviewIframe = () => {
        if (!refreshIframe) return;

        const previewIframe = document.getElementById(iframeId);
        if (previewIframe) {
            const url = new URL(previewIframe.src);
            url.searchParams.set('cb', Date.now());
            previewIframe.src = url.toString();
        }
    };

    /**
     * Update picker UI from HSV values
     */
    const updatePickerUI = () => {
        const rgb = hsvToRgb(currentHSV.h, currentHSV.s, currentHSV.v);
        const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

        // Update displays
        colorCircle.style.background = hex;
        colorText.value = hex.toUpperCase();
        rInput.value = Math.round(rgb.r);
        gInput.value = Math.round(rgb.g);
        bInput.value = Math.round(rgb.b);

        // Update SV gradient hue
        const hueColor = `hsl(${currentHSV.h}, 100%, 50%)`;
        svGradient.style.background = `linear-gradient(to right, #fff, ${hueColor})`;

        // Update SV cursor position
        const svX = (currentHSV.s / 100) * svContainer.offsetWidth;
        const svY = ((100 - currentHSV.v) / 100) * svContainer.offsetHeight;
        svCursor.style.left = `${svX}px`;
        svCursor.style.top = `${svY}px`;

        // Update hue cursor position
        const hueX = (currentHSV.h / 360) * hueContainer.offsetWidth;
        hueCursor.style.left = `${hueX}px`;

        // Trigger callbacks
        onColorChange(hex);
        sendColorToPreview(hex);
    };

    /**
     * Update from hex value
     */
    const setColorFromHex = hex => {
        const rgb = hexToRgb(hex);
        if (!rgb) return;

        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        currentHSV = hsv;
        updatePickerUI();
    };

    // Initialize with current color
    setColorFromHex(color);

    // Event Listeners

    // Toggle popup on circle click
    colorCircle.addEventListener('click', () => {
        const isOpening = popup.style.display === 'none';
        popup.style.display = isOpening ? 'block' : 'none';

        // Recalculate cursor positions when opening (containers now have dimensions)
        if (isOpening) {
            // Check if popup fits below, otherwise open above
            const circleRect = colorCircle.getBoundingClientRect();
            const popupHeight = 420; // Approximate popup height
            const viewportHeight = window.innerHeight;
            const spaceBelow = viewportHeight - circleRect.bottom;
            const spaceAbove = circleRect.top;

            if (spaceBelow < popupHeight && spaceAbove > spaceBelow) {
                // Open above
                popup.style.top = 'auto';
                popup.style.bottom = '100%';
                popup.style.marginTop = '0';
                popup.style.marginBottom = '8px';
            } else {
                // Open below (default)
                popup.style.top = '100%';
                popup.style.bottom = 'auto';
                popup.style.marginTop = '8px';
                popup.style.marginBottom = '0';
            }

            // Force update of cursor positions after popup is visible
            setTimeout(() => {
                const svX = (currentHSV.s / 100) * svContainer.offsetWidth;
                const svY = ((100 - currentHSV.v) / 100) * svContainer.offsetHeight;
                svCursor.style.left = `${svX}px`;
                svCursor.style.top = `${svY}px`;

                const hueX = (currentHSV.h / 360) * hueContainer.offsetWidth;
                hueCursor.style.left = `${hueX}px`;
            }, 0);
        }
    });

    // Close popup when clicking outside
    document.addEventListener('click', e => {
        if (!container.contains(e.target)) {
            popup.style.display = 'none';
        }
    });

    // Saturation/Value picker
    const updateSV = e => {
        const rect = svContainer.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

        currentHSV.s = (x / rect.width) * 100;
        currentHSV.v = 100 - (y / rect.height) * 100;
        updatePickerUI();
    };

    svContainer.addEventListener('mousedown', e => {
        isDraggingSV = true;
        updateSV(e);
    });

    // Hue slider
    const updateHue = e => {
        const rect = hueContainer.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        currentHSV.h = (x / rect.width) * 360;
        updatePickerUI();
    };

    hueContainer.addEventListener('mousedown', e => {
        isDraggingHue = true;
        updateHue(e);
    });

    // Global mouse events for dragging
    document.addEventListener('mousemove', e => {
        if (isDraggingSV) updateSV(e);
        if (isDraggingHue) updateHue(e);
    });

    document.addEventListener('mouseup', () => {
        isDraggingSV = false;
        isDraggingHue = false;
        if (popup.style.display !== 'none') {
            refreshPreviewIframe();
        }
    });

    // RGB inputs
    const updateFromRGB = () => {
        const r = parseInt(rInput.value) || 0;
        const g = parseInt(gInput.value) || 0;
        const b = parseInt(bInput.value) || 0;
        const hsv = rgbToHsv(r, g, b);
        currentHSV = hsv;
        updatePickerUI();
    };

    rInput.addEventListener('input', updateFromRGB);
    gInput.addEventListener('input', updateFromRGB);
    bInput.addEventListener('input', updateFromRGB);

    // Text input change (with validation)
    colorText.addEventListener('input', e => {
        const hex = e.target.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            setColorFromHex(hex);
            refreshPreviewIframe();
        }
    });

    // Color preset clicks
    colorPresets.forEach(preset => {
        preset.addEventListener('click', () => {
            setColorFromHex(preset.dataset.color);
            refreshPreviewIframe();
        });

        // Hover effects
        preset.addEventListener('mouseenter', function () {
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        });

        preset.addEventListener('mouseleave', function () {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
        });
    });

    // Reset button
    colorReset.addEventListener('click', () => {
        setColorFromHex(defaultColor);
        refreshPreviewIframe();
    });

    // Circle hover effects
    colorCircle.addEventListener('mouseenter', function () {
        this.style.transform = 'scale(1.05)';
        this.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
        const icon = this.querySelector('i');
        if (icon) {
            icon.style.opacity = '1';
            icon.style.transform = 'scale(1)';
        }
    });

    colorCircle.addEventListener('mouseleave', function () {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.2)';
        const icon = this.querySelector('i');
        if (icon) {
            icon.style.opacity = '0';
            icon.style.transform = 'scale(0.8)';
        }
    });

    // Store references for external access
    container._colorPicker = {
        getColor: () => colorText.value,
        setColor: hex => setColorFromHex(hex),
        reset: () => setColorFromHex(defaultColor),
        openPicker: () => {
            popup.style.display = 'block';
        },
        closePicker: () => {
            popup.style.display = 'none';
        },
    };

    return container;
}

/**
 * Example usage and exports for future components
 */

// Placeholder for future components
export const FormComponents = {
    // createTextInput: function(options) { /* TODO */ },
    // createNumberInput: function(options) { /* TODO */ },
    // createSelect: function(options) { /* TODO */ },
    // createCheckbox: function(options) { /* TODO */ },
    // createToggle: function(options) { /* TODO */ }
};

export const LayoutComponents = {
    // createSection: function(options) { /* TODO */ },
    // createTabs: function(options) { /* TODO */ },
    // createModal: function(options) { /* TODO */ },
    // showToast: function(options) { /* TODO */ }
};

export const ComplexComponents = {
    // createPreviewFrame: function(options) { /* TODO */ },
    // createDeviceCard: function(options) { /* TODO */ },
    // createSourceStatus: function(options) { /* TODO */ },
    // createGenreFilter: function(options) { /* TODO */ }
};
