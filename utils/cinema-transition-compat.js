const LEGACY_TRANSITION_MAP = {
    zoomIn: 'dollyIn',
    spotlight: 'lensIris',
    rackFocus: 'cinematic',
    lightSweep: 'lightFlare',
    smokeFade: 'fade',
};

const mapTransition = t => (LEGACY_TRANSITION_MAP[t] ? LEGACY_TRANSITION_MAP[t] : t);

/**
 * Mutates a config object in-place to migrate deprecated cinematic transition names.
 * Safe to call on partial config objects.
 *
 * @param {any} cfg
 * @returns {{ changed: boolean }}
 */
function normalizeCinematicTransitions(cfg) {
    let changed = false;

    const ct = cfg?.cinema?.poster?.cinematicTransitions;
    if (!ct || typeof ct !== 'object') return { changed };

    // singleTransition
    if (typeof ct.singleTransition === 'string') {
        const mapped = mapTransition(ct.singleTransition);
        if (mapped !== ct.singleTransition) {
            ct.singleTransition = mapped;
            changed = true;
        }
    }

    // enabledTransitions
    if (Array.isArray(ct.enabledTransitions)) {
        const next = [];
        for (const raw of ct.enabledTransitions) {
            if (typeof raw !== 'string') continue;
            const mapped = mapTransition(raw);
            if (mapped !== raw) changed = true;
            if (!next.includes(mapped)) next.push(mapped);
        }
        if (next.length === 0) {
            next.push('dollyIn');
            changed = true;
        }
        ct.enabledTransitions = next;
    }

    // If we're in single mode, ensure singleTransition is non-empty
    if (ct.selectionMode === 'single') {
        if (typeof ct.singleTransition !== 'string' || ct.singleTransition.trim().length === 0) {
            ct.singleTransition = 'dollyIn';
            changed = true;
        }
    }

    return { changed };
}

module.exports = {
    LEGACY_TRANSITION_MAP,
    normalizeCinematicTransitions,
};
