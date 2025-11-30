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
        color: '#7c2d12',
        name: 'Warm Brown',
        gradient: 'linear-gradient(135deg, #7c2d12 0%, #531e0c 100%)',
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

    // Build HTML structure
    container.innerHTML = `
        <label for="${pickerId}" style="display: block; margin-bottom: 12px;">
            <i class="fas fa-palette"></i> ${label}
        </label>
        
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <!-- Color Picker Circle + Presets -->
            <div style="display: flex; align-items: center; gap: 16px;">
                <div style="position: relative;">
                    <input type="color" id="${pickerId}" value="${color}" style="opacity: 0; position: absolute; width: 0; height: 0;" />
                    <div id="${circleId}" style="width: 64px; height: 64px; border-radius: 50%; background: ${color}; border: 3px solid rgb(40, 46, 62); box-shadow: 0 4px 12px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.2); cursor: pointer; transition: all 0.2s ease; position: relative; overflow: hidden;">
                        <div style="position: absolute; inset: 0; background: linear-gradient(135deg, transparent 0%, rgba(0,0,0,0.2) 100%);"></div>
                    </div>
                </div>
                
                <!-- Color Presets -->
                <div style="display: flex; gap: 10px; flex-wrap: wrap; flex: 1;">
                    ${presets
                        .map(
                            preset => `
                        <div class="${presetClass}" data-color="${preset.color}" style="width: 40px; height: 40px; border-radius: 50%; background: ${preset.gradient}; cursor: pointer; border: 2px solid transparent; transition: all 0.2s ease; box-shadow: 0 2px 6px rgba(0,0,0,0.2); position: relative;" title="${preset.name}"></div>
                    `
                        )
                        .join('')}
                </div>
            </div>
            
            <!-- Hex Input + Reset Button -->
            <div style="display: flex; align-items: center; gap: 12px;">
                <input type="text" id="${textId}" value="${color.toUpperCase()}" pattern="^#[0-9A-Fa-f]{6}$" maxlength="7" style="flex: 1; font-family: 'Courier New', monospace; text-transform: uppercase; font-size: 14px; font-weight: 600; letter-spacing: 0.5px; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-light);" placeholder="#FFFFFF" />
                <button type="button" id="${resetId}" style="padding: 10px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-light); cursor: pointer; transition: all 0.2s ease; font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap;" title="Reset to default">
                    <i class="fas fa-undo"></i> Reset
                </button>
            </div>
        </div>
    `;

    // Get element references
    const colorPicker = container.querySelector(`#${pickerId}`);
    const colorText = container.querySelector(`#${textId}`);
    const colorCircle = container.querySelector(`#${circleId}`);
    const colorReset = container.querySelector(`#${resetId}`);
    const colorPresets = container.querySelectorAll(`.${presetClass}`);

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
     * Update all color displays and trigger callbacks
     * @param {string} hex - Hex color value
     */
    const updateColor = hex => {
        // Update UI elements
        colorPicker.value = hex;
        colorText.value = hex.toUpperCase();
        colorCircle.style.background = hex;

        // Update preset selection indicators
        colorPresets.forEach(preset => {
            if (preset.dataset.color.toLowerCase() === hex.toLowerCase()) {
                preset.style.border = '2px solid rgb(169, 173, 186)';
                preset.style.transform = 'scale(1.1)';
            } else {
                preset.style.border = '2px solid transparent';
                preset.style.transform = 'scale(1)';
            }
        });

        // Trigger callback
        onColorChange(hex);

        // Send to preview iframe
        sendColorToPreview(hex);

        // Refresh iframe
        refreshPreviewIframe();
    };

    // Initialize with current color
    updateColor(color);

    // Event Listeners

    // Click on circle opens native color picker
    colorCircle.addEventListener('click', () => {
        colorPicker.click();
    });

    // Color picker change
    colorPicker.addEventListener('input', e => {
        updateColor(e.target.value);
    });

    // Text input change (with validation)
    colorText.addEventListener('input', e => {
        const hex = e.target.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            updateColor(hex);
        }
    });

    // Color preset clicks
    colorPresets.forEach(preset => {
        preset.addEventListener('click', () => {
            updateColor(preset.dataset.color);
        });

        // Hover effects
        preset.addEventListener('mouseenter', function () {
            if (this.style.border !== '2px solid rgb(169, 173, 186)') {
                this.style.transform = 'scale(1.15)';
                this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
            }
        });

        preset.addEventListener('mouseleave', function () {
            if (this.style.border !== '2px solid rgb(169, 173, 186)') {
                this.style.transform = 'scale(1)';
                this.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
            }
        });
    });

    // Reset button
    colorReset.addEventListener('click', () => {
        updateColor(defaultColor);
    });

    // Reset button hover effects
    colorReset.addEventListener('mouseenter', function () {
        this.style.background = 'var(--primary)';
        this.style.color = 'white';
        this.style.borderColor = 'var(--primary)';
    });

    colorReset.addEventListener('mouseleave', function () {
        this.style.background = 'var(--bg-light)';
        this.style.color = 'var(--text)';
        this.style.borderColor = 'var(--border)';
    });

    // Circle hover effects
    colorCircle.addEventListener('mouseenter', function () {
        this.style.transform = 'scale(1.1)';
        this.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,255,255,0.2)';
    });

    colorCircle.addEventListener('mouseleave', function () {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.2)';
    });

    // Store references for external access
    container._colorPicker = {
        getColor: () => colorPicker.value,
        setColor: hex => updateColor(hex),
        reset: () => updateColor(defaultColor),
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
