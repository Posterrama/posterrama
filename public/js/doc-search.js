/**
 * Documentation Search - Help system with navigation to settings
 *
 * Features:
 * - Search through help topics with fuzzy matching
 * - Navigate to settings sections
 * - Preview-only mode switching (doesn't save changes)
 * - Handles hidden/nested settings gracefully
 */

(function () {
    'use strict';

    let docsData = null;
    let searchResults = [];
    let selectedIndex = -1;

    const searchContainer = document.getElementById('doc-search-inline');
    const searchInput = document.getElementById('doc-search-input');
    const searchResultsContainer = document.getElementById('doc-search-results');

    if (!searchContainer || !searchInput || !searchResultsContainer) {
        return;
    }

    async function loadDocsData() {
        try {
            const response = await fetch('/docs-data.json');
            if (!response.ok) throw new Error('Failed to load docs');
            docsData = await response.json();
        } catch (err) {
            console.error('DocSearch: Failed to load documentation data', err);
            docsData = { entries: [] };
        }
    }

    /**
     * Get the currently active display mode
     */
    function getCurrentDisplayMode() {
        const checked = document.querySelector('input[name="display.mode"]:checked');
        return checked?.value || null;
    }

    function matchScore(query, text) {
        const q = query.toLowerCase();
        const t = text.toLowerCase();
        if (!t.includes(q)) return 0;
        if (t === q) return 100;
        if (t.startsWith(q)) return 90;
        const words = t.split(/[\s\-_]+/);
        for (const word of words) {
            if (word.startsWith(q)) return 80;
        }
        return 60;
    }

    function search(query) {
        if (!docsData?.entries || !query.trim() || query.length < 2) {
            return [];
        }

        const q = query.toLowerCase().trim();
        const results = [];

        for (const entry of docsData.entries) {
            let bestScore = 0;

            const titleScore = matchScore(q, entry.title);
            if (titleScore > 0) bestScore = titleScore + 50;

            if (entry.keywords) {
                for (const kw of entry.keywords) {
                    const kwScore = matchScore(q, kw);
                    if (kwScore > 0 && kwScore + 40 > bestScore) {
                        bestScore = kwScore + 40;
                    }
                }
            }

            const catScore = matchScore(q, entry.category);
            if (catScore > 0 && catScore + 20 > bestScore) {
                bestScore = catScore + 20;
            }

            if (bestScore > 0) {
                results.push({ entry, score: bestScore });
            }
        }

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map(r => r.entry);
    }

    function renderResults(results, query) {
        searchResults = results;
        selectedIndex = results.length > 0 ? 0 : -1;

        if (!query.trim() || query.length < 2) {
            searchResultsContainer.hidden = true;
            return;
        }

        if (results.length === 0) {
            searchResultsContainer.innerHTML = `
        <div class="doc-search-empty">
          <i class="fas fa-question-circle"></i>
          <p>No help found for "${escapeHtml(query)}"</p>
        </div>`;
            searchResultsContainer.hidden = false;
            return;
        }

        let html = `<div class="doc-search-header">${results.length} help topic${results.length > 1 ? 's' : ''}</div>`;

        results.forEach((entry, i) => {
            const hasSection = entry.section && entry.section !== 'null';
            const hasSetting = entry.setting && entry.setting.length > 0;
            const hasShowMode = entry.showMode && entry.showMode.length > 0;
            let actionText = '';
            if (hasSetting) {
                actionText = 'Go to this setting';
            } else if (hasShowMode) {
                actionText =
                    'Go to ' +
                    entry.showMode.charAt(0).toUpperCase() +
                    entry.showMode.slice(1) +
                    ' settings';
            } else if (hasSection) {
                actionText = 'Go to section';
            }

            html += `
        <div class="doc-search-result${i === 0 ? ' selected' : ''}"
             data-index="${i}"
             data-section="${entry.section || ''}"
             data-setting="${entry.setting || ''}"
             data-show-mode="${entry.showMode || ''}">
          <div class="doc-search-result-header">
            <span class="doc-search-result-category">${escapeHtml(entry.category)}</span>
            <span class="doc-search-result-title">${escapeHtml(entry.title)}</span>
          </div>
          <div class="doc-search-result-desc">${escapeHtml(entry.description)}</div>
          <div class="doc-search-result-details">
            <div class="doc-search-result-help">${escapeHtml(entry.help || entry.description)}</div>
            ${entry.example ? `<div class="doc-search-result-example">${escapeHtml(entry.example)}</div>` : ''}
          </div>
          ${actionText ? `<div class="doc-search-result-action"><i class="fas fa-arrow-right"></i> ${actionText}</div>` : ''}
        </div>`;
        });

        html += `
      <div class="doc-search-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> browse</span>
        <span><kbd>↵</kbd> go to setting</span>
        <span><kbd>esc</kbd> close</span>
      </div>`;

        searchResultsContainer.innerHTML = html;
        searchResultsContainer.hidden = false;

        searchResultsContainer.querySelectorAll('.doc-search-result').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index, 10);
                if (idx === selectedIndex) {
                    selectResult(idx);
                } else {
                    selectedIndex = idx;
                    updateSelection();
                }
            });
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateSelection() {
        searchResultsContainer.querySelectorAll('.doc-search-result').forEach((el, i) => {
            el.classList.toggle('selected', i === selectedIndex);
            if (i === selectedIndex) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });
    }

    /**
     * Switch to a display mode (screensaver, wallart, cinema) for PREVIEW only.
     * This visually shows the settings without triggering a save.
     * Returns true if mode was switched, false if already in that mode.
     */
    function switchDisplayMode(mode) {
        if (!mode) return false;

        const currentMode = getCurrentDisplayMode();

        // If already in the correct mode, no switch needed
        if (currentMode === mode) {
            return false;
        }

        // The radio buttons are named "display.mode" with values screensaver, wallart, cinema
        const modeRadio = document.getElementById(`mode-${mode}`);
        if (modeRadio) {
            // Set the radio button
            modeRadio.checked = true;

            // Trigger change event to update the UI (this updates visibility)
            modeRadio.dispatchEvent(new Event('change', { bubbles: true }));

            // Label IDs are: seg-saver, seg-wallart, seg-cinema
            const labelId = mode === 'screensaver' ? 'seg-saver' : `seg-${mode}`;
            const label = document.getElementById(labelId);
            if (label) {
                label.click();
            }

            // Also directly unhide the card as a fallback
            const cardId =
                mode === 'screensaver'
                    ? 'card-screensaver'
                    : mode === 'wallart'
                      ? 'card-wallart'
                      : 'card-cinema';
            const card = document.getElementById(cardId);
            if (card) {
                card.hidden = false;
            }

            return true; // Mode was changed
        }
        return false;
    }

    /**
     * Show a preview banner when we've temporarily switched modes
     */
    function showPreviewBanner(targetMode, originalMode) {
        // Remove any existing banner
        removePreviewBanner();

        const banner = document.createElement('div');
        banner.id = 'doc-search-preview-banner';
        banner.className = 'doc-search-preview-banner';

        const modeLabel = targetMode.charAt(0).toUpperCase() + targetMode.slice(1);
        const originalLabel = originalMode.charAt(0).toUpperCase() + originalMode.slice(1);

        banner.innerHTML = `
      <i class="fas fa-eye"></i>
      <span>Previewing <strong>${modeLabel}</strong> settings (your active mode is ${originalLabel})</span>
      <button type="button" class="btn btn-sm btn-secondary" id="doc-search-restore-mode">
        <i class="fas fa-undo"></i> Back to ${originalLabel}
      </button>
    `;

        // Insert at the top of the display section content
        const displaySection = document.getElementById('section-display');
        if (displaySection) {
            const firstChild = displaySection.querySelector(
                '.section-content, .form-grid, fieldset'
            );
            if (firstChild) {
                firstChild.parentNode.insertBefore(banner, firstChild);
            } else {
                displaySection.insertBefore(banner, displaySection.firstChild);
            }
        }

        // Add click handler to restore original mode
        document.getElementById('doc-search-restore-mode')?.addEventListener('click', () => {
            switchDisplayMode(originalMode);
            removePreviewBanner();
        });
    }

    /**
     * Remove the preview banner
     */
    function removePreviewBanner() {
        document.getElementById('doc-search-preview-banner')?.remove();
    }

    /**
     * Find the setting element and its highlightable container.
     * Also detects if the setting is hidden due to a parent toggle.
     */
    function findSettingElement(settingId) {
        if (!settingId) return null;

        // Try direct ID lookup first
        let el = document.getElementById(settingId);

        if (!el) {
            // Try other selectors
            el =
                document.querySelector(`[name="${settingId}"]`) ||
                document.querySelector(`[data-setting="${settingId}"]`);
        }

        if (!el) return null;

        // Check if element is in a hidden nested settings container
        const nestedParent = el.closest(
            '.cinema-nested-settings, .screensaver-nested-settings, .wallart-nested-settings, [class*="-nested-settings"]'
        );
        let isNestedHidden = false;

        if (nestedParent) {
            // Check computed style - this is more reliable than inline style
            const computedStyle = getComputedStyle(nestedParent);
            isNestedHidden =
                computedStyle.display === 'none' ||
                nestedParent.style.display === 'none' ||
                nestedParent.hidden;
        }

        // Check if element is in any other hidden parent (not just the mode card)
        const hiddenParent = el.closest('[hidden]:not([id^="card-"])');

        // Find the toggle that controls this nested section
        let controllingToggle = null;
        let controllingToggleLabel = null;

        if (isNestedHidden && nestedParent) {
            // The toggle is in the .form-row immediately before the nested settings container
            let prevEl = nestedParent.previousElementSibling;

            // Skip any non-form-row elements (whitespace, comments, etc.)
            while (prevEl && !prevEl.classList?.contains('form-row')) {
                prevEl = prevEl.previousElementSibling;
            }

            if (prevEl) {
                // Look for checkbox in this form-row
                controllingToggle = prevEl.querySelector('input[type="checkbox"]');

                if (controllingToggle) {
                    // Get the label text - multiple strategies
                    // 1. Look for span inside checkbox label (most common pattern)
                    const checkboxLabel = prevEl.querySelector('.checkbox span:last-child');
                    // 2. Look for the first label (section label like "Trailer")
                    const formLabel = prevEl.querySelector('label:first-child:not(.checkbox)');
                    // 3. Use the checkbox's own label
                    const checkboxText = prevEl.querySelector('label.checkbox');

                    controllingToggleLabel =
                        formLabel?.textContent?.trim() ||
                        checkboxLabel?.textContent?.trim() ||
                        checkboxText?.textContent?.trim() ||
                        'this option';

                    // Clean up the label (remove "Show " prefix if present)
                    if (controllingToggleLabel.toLowerCase().startsWith('show ')) {
                        controllingToggleLabel = controllingToggleLabel.substring(5);
                    }
                }
            }
        }

        // Find the best container to highlight (form-row, form-group, or parent container)
        const container = el.closest('.form-row') || el.closest('.form-group') || nestedParent;

        return {
            input: el,
            container: container || el,
            isHidden: !!(hiddenParent || isNestedHidden),
            controllingToggle,
            controllingToggleLabel,
            nestedParent,
        };
    }

    /**
     * Show an info tooltip near an element
     * Waits for scroll to complete before positioning
     */
    function showSettingTooltip(el, message, type = 'info') {
        // Remove any existing tooltip
        removeSettingTooltip();

        // Wait for scroll animation to complete before positioning
        setTimeout(() => {
            const tooltip = document.createElement('div');
            tooltip.id = 'doc-search-tooltip';
            tooltip.className = `doc-search-tooltip doc-search-tooltip-${type}`;

            const icon =
                type === 'info'
                    ? 'fa-info-circle'
                    : type === 'warning'
                      ? 'fa-exclamation-triangle'
                      : 'fa-lightbulb';

            tooltip.innerHTML = `<i class="fas ${icon}"></i> ${message}`;

            // Position near the element (after scroll completed)
            const rect = el.getBoundingClientRect();
            const tooltipTop = Math.max(10, rect.top - 50);
            const tooltipLeft = Math.max(10, rect.left);

            tooltip.style.position = 'fixed';
            tooltip.style.top = `${tooltipTop}px`;
            tooltip.style.left = `${tooltipLeft}px`;
            tooltip.style.zIndex = '10000';

            document.body.appendChild(tooltip);

            // Auto-remove after 7 seconds
            setTimeout(removeSettingTooltip, 7000);
        }, 400); // Wait for smooth scroll to complete
    }

    /**
     * Remove the setting tooltip
     */
    function removeSettingTooltip() {
        document.getElementById('doc-search-tooltip')?.remove();
    }

    /**
     * Highlight an element with a pulsing animation
     */
    function highlightElement(el) {
        // Remove any existing highlights
        document.querySelectorAll('.doc-search-highlight').forEach(e => {
            e.classList.remove('doc-search-highlight');
        });

        // Add highlight class
        el.classList.add('doc-search-highlight');

        // Scroll into view
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Remove highlight after animation (5 repeats × 2s = 10s)
        setTimeout(() => {
            el.classList.remove('doc-search-highlight');
        }, 10500);
    }

    function selectResult(index) {
        if (index < 0 || index >= searchResults.length) return;
        const entry = searchResults[index];

        // Close search
        searchInput.value = '';
        searchInput.setAttribute('readonly', '');
        searchResultsContainer.hidden = true;
        searchResults = [];

        // Only navigate if there's a section to go to
        if (!entry.section || entry.section === 'null') {
            return;
        }

        // Remember the original mode before any switching
        const originalMode = getCurrentDisplayMode();

        // Navigate to section first
        const navItem = document.querySelector(`[data-nav="${entry.section}"]`);

        if (navItem) {
            navItem.click();

            // Wait for section to load (needs more time for DOM updates)
            setTimeout(() => {
                // Handle showPanel for media sources (click on dropdown item to open panel)
                if (entry.showPanel) {
                    const panelItem = document.querySelector(`[data-panel="${entry.showPanel}"]`);
                    if (panelItem) {
                        panelItem.click();
                        // Wait for panel to open, then highlight it
                        requestAnimationFrame(() => {
                            setTimeout(() => {
                                const panel = document.getElementById(entry.showPanel);
                                if (panel) {
                                    highlightElement(panel);
                                }
                            }, 300);
                        });
                    }
                    return;
                }

                // If there's a showMode, check if we need to switch
                if (entry.showMode) {
                    const modeChanged = switchDisplayMode(entry.showMode);

                    // If we changed mode, show a preview banner
                    if (modeChanged && originalMode && originalMode !== entry.showMode) {
                        showPreviewBanner(entry.showMode, originalMode);
                    }

                    // Wait longer for mode switch animations to complete
                    // Use requestAnimationFrame to ensure DOM is ready
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            findAndHighlightSetting(entry.setting, entry);
                        }, 400);
                    });
                } else {
                    requestAnimationFrame(() => {
                        findAndHighlightSetting(entry.setting, entry);
                    });
                }
            }, 300);
        }
    }

    /**
     * Find and highlight a setting element
     * Handles hidden settings gracefully with tooltips
     */
    function findAndHighlightSetting(settingId, entry) {
        if (!settingId) return;

        const found = findSettingElement(settingId);
        if (!found) return;

        // If the setting is hidden due to a toggle being off, show a helpful message
        if (found.isHidden) {
            if (found.controllingToggle) {
                // Find the form-row containing the controlling toggle
                const toggleRow = found.controllingToggle.closest('.form-row');
                if (toggleRow) {
                    highlightElement(toggleRow);

                    const toggleName = found.controllingToggleLabel || 'this option';
                    showSettingTooltip(
                        toggleRow,
                        `Enable "${toggleName}" to access ${entry?.title || 'this setting'}`,
                        'info'
                    );
                    return;
                }
            }

            // Fallback: if we couldn't find the controlling toggle,
            // try to find the previous form-row before the nested container
            if (found.nestedParent) {
                let prevRow = found.nestedParent.previousElementSibling;
                while (prevRow && !prevRow.classList?.contains('form-row')) {
                    prevRow = prevRow.previousElementSibling;
                }
                if (prevRow) {
                    highlightElement(prevRow);
                    showSettingTooltip(
                        prevRow,
                        `Enable the toggle above to access ${entry?.title || 'this setting'}`,
                        'info'
                    );
                    return;
                }
            }

            // Last fallback: just show a generic message
            // This shouldn't happen but handles edge cases
            return;
        }

        // Small delay to allow any animations/transitions to complete
        setTimeout(() => {
            highlightElement(found.container);

            // For select/dropdown elements, briefly open them to show options
            if (found.input.tagName === 'SELECT') {
                // Just focus - don't change the value
                found.input.focus();
                // Show a tooltip hint
                showSettingTooltip(
                    found.container,
                    'Use this dropdown to change the setting',
                    'info'
                );
            } else if (found.input !== found.container) {
                found.input.focus();
                setTimeout(() => found.input.blur(), 100);
            }
        }, 50);
    }

    searchInput.addEventListener('input', () => {
        renderResults(search(searchInput.value), searchInput.value);
    });

    searchInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && searchResults.length) {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % searchResults.length;
            updateSelection();
        } else if (e.key === 'ArrowUp' && searchResults.length) {
            e.preventDefault();
            selectedIndex = selectedIndex <= 0 ? searchResults.length - 1 : selectedIndex - 1;
            updateSelection();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            selectResult(selectedIndex);
        } else if (e.key === 'Escape') {
            searchInput.value = '';
            searchInput.setAttribute('readonly', '');
            searchResultsContainer.hidden = true;
            searchInput.blur();
        }
    });

    document.addEventListener('click', e => {
        if (!searchContainer.contains(e.target)) {
            searchResultsContainer.hidden = true;
        }
    });

    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            searchInput.removeAttribute('readonly');
            searchInput.focus();
        }
    });

    loadDocsData();
})();
