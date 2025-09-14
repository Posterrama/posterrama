/*
 Unified Notification Module for Posterrama Admin and Theme Demo
 - Exposes window.notify.toast(...) and window.notify.banner(...)
 - Backwards-compatible wrappers: window.showToast(...) and window.showNotification(...)
 - Automatically creates containers if missing (toast: #toast-container, banner: #notification-area)
*/
(function () {
    // Font Awesome icon classes for each toast type
    const ICONS = {
        success: 'fas fa-check-circle',
        info: 'fas fa-info-circle',
        warning: 'fas fa-exclamation-triangle',
        error: 'fas fa-times-circle',
    };

    function ensureToastContainer() {
        let c = document.getElementById('toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toast-container';
            c.className = 'toast-container';
            c.setAttribute('aria-live', 'polite');
            c.setAttribute('role', 'status');
            document.body.appendChild(c);
        }
        return c;
    }

    function ensureBannerContainer() {
        let c = document.getElementById('notification-area');
        if (!c) {
            c = document.createElement('div');
            c.id = 'notification-area';
            c.className = 'notification-container';
            c.setAttribute('role', 'region');
            c.setAttribute('aria-live', 'polite');
            document.body.appendChild(c);
        }
        return c;
    }

    function coerceToastArgs(a, b, c, d) {
        // Support multiple signatures:
        // 1) (message, type = 'info', duration)
        // 2) (type, title, message, duration)
        // 3) ({ type, title, message, duration })
        if (typeof a === 'object' && a !== null) {
            const { type = 'info', title = '', message = '', duration = 3500 } = a;
            return { type, title, message, duration };
        }
        if (typeof b === 'string' && typeof c === 'string') {
            // (type, title, message, duration)
            return { type: a || 'info', title: b || '', message: c || '', duration: d ?? 3500 };
        }
        // (message, type, duration)
        return { type: b || 'info', title: '', message: a || '', duration: c ?? 3500 };
    }

    function renderToast({ type = 'info', title = '', message = '', duration = 3500 }) {
        const container = ensureToastContainer();
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;

        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        // Use Font Awesome icons; fall back to a generic info icon if type missing
        const i = document.createElement('i');
        i.className = ICONS[type] || ICONS.info;
        i.setAttribute('aria-hidden', 'true');
        icon.appendChild(i);
        el.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'toast-content';
        if (title) {
            const h = document.createElement('strong');
            h.className = 'toast-title';
            h.textContent = title;
            content.appendChild(h);
        }
        const p = document.createElement('div');
        p.className = 'toast-message';
        p.textContent = message;
        content.appendChild(p);
        el.appendChild(content);

        const close = document.createElement('button');
        close.className = 'toast-close';
        close.setAttribute('aria-label', 'Close');
        close.innerHTML = '&times;';
        close.addEventListener('click', () => dismiss());
        el.appendChild(close);

        container.appendChild(el);
        // trigger CSS transition
        void el.offsetWidth; // reflow
        el.classList.add('show');

        // Match icon color to the left indicator (border-left color)
        try {
            const cs = getComputedStyle(el);
            const c = cs && cs.borderLeftColor;
            if (c) icon.style.color = c;
        } catch (_) {
            /* non-fatal */
        }

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            el.classList.remove('show');
            el.addEventListener('transitionend', () => el.remove(), { once: true });
            // Fallback removal in case no transition
            setTimeout(() => el.remove(), 600);
        };
        if (duration > 0) setTimeout(dismiss, Math.max(1200, duration));

        return { element: el, dismiss };
    }

    function renderBanner(message, type = 'info', { duration = 5000 } = {}) {
        const container = ensureBannerContainer();
        const el = document.createElement('div');
        el.className = `notification ${type}`;
        el.textContent = message;

        container.appendChild(el);
        // trigger CSS transition
        void el.offsetWidth; // reflow
        el.classList.add('show');

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            el.classList.remove('show');
            el.addEventListener('transitionend', () => el.remove(), { once: true });
            setTimeout(() => el.remove(), 600);
        };
        if (duration > 0) setTimeout(dismiss, Math.max(1200, duration));

        return { element: el, dismiss };
    }

    window.notify = {
        toast: (a, b, c, d) => renderToast(coerceToastArgs(a, b, c, d)),
        banner: (message, type = 'info', opts) => renderBanner(message, type, opts),
        // helpers
        success: (msg, mode = 'toast') =>
            mode === 'banner'
                ? renderBanner(msg, 'success')
                : renderToast({ type: 'success', message: msg }),
        info: (msg, mode = 'toast') =>
            mode === 'banner'
                ? renderBanner(msg, 'info')
                : renderToast({ type: 'info', message: msg }),
        warning: (msg, mode = 'toast') =>
            mode === 'banner'
                ? renderBanner(msg, 'warning')
                : renderToast({ type: 'warning', message: msg }),
        error: (msg, mode = 'toast') =>
            mode === 'banner'
                ? renderBanner(msg, 'error')
                : renderToast({ type: 'error', message: msg }),
    };

    // Back-compat wrappers
    window.showToast = function () {
        return window.notify.toast.apply(null, arguments);
    };
    window.showNotification = function (message, type) {
        return window.notify.banner(message, type || 'success');
    };
})();
