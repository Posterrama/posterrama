(function () {
    function qs(id) {
        return document.getElementById(id);
    }
    function showPromo() {
        var promo = qs('promo-box');
        if (!promo) return false;
        promo.style.display = '';
        promo.classList.remove('is-hidden');
        return true;
    }
    function hideLoader() {
        var el = qs('loader');
        if (!el) return;
        el.classList.add('is-hidden');
        el.style.opacity = '0';
        setTimeout(function () {
            try {
                el.style.display = 'none';
            } catch (_) {}
        }, 150);
    }

    function init() {
        // Only run on landing page: if a MODE_HINT is set for a specific mode,
        // leave responsibilities entirely to that mode's script.
        var mode =
            typeof window !== 'undefined' && window.MODE_HINT ? String(window.MODE_HINT) : '';
        var path =
            typeof window !== 'undefined' && window.location && window.location.pathname
                ? window.location.pathname
                : '';
        if (
            mode === 'cinema' ||
            mode === 'wallart' ||
            mode === 'screensaver' ||
            /\/(cinema|wallart|screensaver)(\.html)?(\b|\/|$)/.test(path)
        ) {
            return; // do nothing on mode pages
        }
        var revealed = showPromo();
        // Ensure key UI containers are visible when on landing
        var info = qs('info-container');
        if (info) info.style.display = '';
        var branding = qs('branding-container');
        if (branding) branding.style.display = '';
        // Hide the loader only after we reveal promo
        if (revealed) hideLoader();
        // Safety: hide after a delay in case styles blocked earlier
        setTimeout(function () {
            if (qs('loader')) hideLoader();
        }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
