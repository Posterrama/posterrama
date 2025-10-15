// Small shared utilities for Admin UI
// UMD-lite: usable in Node (tests) and attached to window in browser

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.__adminUtils = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Validate a bypass flag token for rootRoute.bypassParam.
     * Rules:
     * - Empty string is allowed (means feature disabled; server defaults may apply elsewhere)
     * - Must start with a letter (A-Z or a-z)
     * - Subsequent chars may be letters, numbers, underscore or hyphen
     * - Max length 32
     */
    function validateBypassParam(flag) {
        if (flag == null) return true; // treat undefined/null as acceptable (caller can default)
        const s = String(flag).trim();
        if (s === '') return true;
        if (s.length > 32) return false;
        return /^[A-Za-z][A-Za-z0-9_-]*$/.test(s);
    }

    /**
     * Apply UI state for the Redirect status select based on behavior.
     * If behavior !== 'redirect', the select is disabled and wrapper gets a tooltip.
     * This function is DOM-light for testability; pass concrete elements.
     *
     * @param {string} behavior - 'landing' | 'redirect'
     * @param {HTMLSelectElement|undefined|null} statusEl - The select element for status code
     * @param {HTMLElement|undefined|null} wrapEl - The container for visual cues (optional)
     */
    function applyRedirectStatusState(behavior, statusEl, wrapEl) {
        const isRedirect = behavior === 'redirect';
        if (statusEl) {
            statusEl.disabled = !isRedirect;
            statusEl.setAttribute('aria-disabled', String(!isRedirect));
        }
        if (wrapEl) {
            if (!isRedirect) {
                wrapEl.setAttribute(
                    'title',
                    'Only active when Behavior is set to "Redirect to a mode"'
                );
                wrapEl.classList.add('is-disabled');
            } else {
                wrapEl.removeAttribute('title');
                wrapEl.classList.remove('is-disabled');
            }
        }
    }

    /**
     * Update the "/?…" link used to open landing with a bypass flag.
     * Accepts the anchor element and a raw flag value (may be empty).
     */
    function updateBypassOpenLink(anchorEl, rawFlag) {
        if (!anchorEl) return;
        const flag = String(rawFlag || '').trim();
        const q = flag ? `?${encodeURIComponent(flag)}` : '';
        anchorEl.setAttribute('href', `/${q}`);
        anchorEl.textContent = q ? `Open /${q}` : 'Open /';
        anchorEl.title = q ? 'Open landing (bypass)' : 'Open / (landing if landing behavior)';
    }

    return { validateBypassParam, applyRedirectStatusState, updateBypassOpenLink };
});
