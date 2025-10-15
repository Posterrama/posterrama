/*
  Deprecated legacy orchestrator (script.js)
  -----------------------------------------
  This file used to contain the legacy front-end orchestrator for all display modes.
  As of the cinema/wallart/screensaver migrations, it is no longer referenced at runtime.

  We keep a tiny stub for a short transition period to avoid breaking external automation
  or forks that might still reference /public/script.js directly.

  If you see this in production, something is still loading script.js; please remove that include.
*/
(function warnIfLoaded() {
    try {
        // eslint-disable-next-line no-console
        console.warn(
            '[Posterrama] Deprecated: public/script.js is no longer used. Remove any includes.'
        );
    } catch (_) {
        // no-op
    }
})();

/* LEGACY REMAINDER — All deprecated code removed to prevent parse errors.
   Original orchestrator logic has been migrated to:
   - public/cinema/cinema-display.js
   - public/wallart/wallart-display.js
   This file is kept only to avoid breaking external references. */
