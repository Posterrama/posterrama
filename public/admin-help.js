/**
 * posterrama.app - Admin Help Popup Logic
 *
 * This script transforms static help text paragraphs into interactive help popups.
 * It should be included in the admin HTML page.
 *
 * Author: Mark Frelink
 * Last Modified: 2025-07-26
 * License: GPL-3.0-or-later
 */

document.addEventListener('DOMContentLoaded', () => {
    /**
     * Finds all elements with the class '.help-text' and replaces them
     * with an interactive help icon and a popup.
     */
    function initializeHelpPopups() {
        // Correct selector for the form and the help text class
        const helpTexts = document.querySelectorAll('#config-form .help-text');
        if (helpTexts.length === 0) {
            return; // No help texts found, do nothing.
        }

        // Create a single, shared overlay element for mobile popups.
        const overlay = document.createElement('div');
        overlay.className = 'help-overlay';
        document.body.appendChild(overlay);

        helpTexts.forEach(helpTextEl => {
            // Find the parent .form-group which contains both the label and the help text.
            const formGroup = helpTextEl.closest('.form-group');
            if (!formGroup) return;

            // Find the corresponding label within that group.
            const label = formGroup.querySelector('label');
            if (!label) return;

            // 1. Create the new help icon and its popup.
            const helpIconWrapper = document.createElement('span'); // Use a span for better inline layout with the label text.
            helpIconWrapper.className = 'help-icon-wrapper';

            const helpIcon = document.createElement('span');
            helpIcon.className = 'help-icon';
            helpIcon.textContent = '?';
            helpIcon.setAttribute('role', 'button');
            helpIcon.setAttribute('aria-label', 'Show help');

            const helpPopup = document.createElement('div');
            helpPopup.className = 'help-popup';
            helpPopup.innerHTML = helpTextEl.innerHTML; // Preserve any HTML in the help text.

            helpIconWrapper.appendChild(helpIcon);
            helpIconWrapper.appendChild(helpPopup);

            // 2. Append the icon directly to the label for simple and robust placement.
            label.appendChild(helpIconWrapper);

            // 3. Remove the old, static help text element.
            helpTextEl.remove();

            // 4. Add event listener for click/tap to show the popup.
            helpIcon.addEventListener('click', (e) => {
                // Prevent the label's default action (focusing the input) and stop event propagation.
                // This is crucial for mobile to prevent the on-screen keyboard from appearing.
                e.preventDefault();
                e.stopPropagation();

                // --- Smart Popup Positioning ---
                const wasActive = helpPopup.classList.contains('is-active');
                closeAllPopups();

                if (!wasActive) {
                    // Reset alignment classes before calculating new position
                    helpPopup.classList.remove('align-left', 'align-right');

                    const iconRect = helpIconWrapper.getBoundingClientRect();
                    const viewportWidth = window.innerWidth;
                    const popupWidth = 300; // Must match the width in admin.css
                    const popupHalfWidth = popupWidth / 2;
                    const buffer = 10; // 10px safety buffer from the edge

                    // Check if the centered popup would overflow the right edge of the viewport
                    if (iconRect.left + (iconRect.width / 2) + popupHalfWidth > viewportWidth - buffer) {
                        helpPopup.classList.add('align-right');
                    }

                    // Check if the centered popup would overflow the left edge of the viewport
                    if (iconRect.left + (iconRect.width / 2) - popupHalfWidth < buffer) {
                        helpPopup.classList.add('align-left');
                    }

                    // Activate the popup and overlay
                    helpPopup.classList.add('is-active');
                    helpIconWrapper.classList.add('is-active');
                    overlay.classList.add('is-active');
                }
            });
        });

        const closeAllPopups = () => {
            document.querySelectorAll('.help-popup.is-active').forEach(p => p.classList.remove('is-active'));
            document.querySelectorAll('.help-icon-wrapper.is-active').forEach(w => w.classList.remove('is-active'));
            overlay.classList.remove('is-active');
        };

        // Add listeners to close the popup.
        overlay.addEventListener('click', closeAllPopups);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllPopups();
            }
        });
    }

    initializeHelpPopups();
});