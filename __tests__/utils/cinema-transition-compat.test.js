const { normalizeCinematicTransitions } = require('../../utils/cinema-transition-compat');

describe('cinema-transition-compat', () => {
    test('maps deprecated cinematic transitions', () => {
        const cfg = {
            cinema: {
                poster: {
                    cinematicTransitions: {
                        selectionMode: 'single',
                        singleTransition: 'zoomIn',
                        enabledTransitions: [
                            'fade',
                            'spotlight',
                            'rackFocus',
                            'lightSweep',
                            'smokeFade',
                        ],
                    },
                },
            },
        };

        const res = normalizeCinematicTransitions(cfg);
        expect(res).toEqual({ changed: true });
        expect(cfg.cinema.poster.cinematicTransitions.singleTransition).toBe('dollyIn');
        expect(cfg.cinema.poster.cinematicTransitions.enabledTransitions).toEqual([
            'fade',
            'lensIris',
            'cinematic',
            'lightFlare',
        ]);
    });

    test('is safe on partial configs', () => {
        expect(normalizeCinematicTransitions({})).toEqual({ changed: false });
        expect(normalizeCinematicTransitions({ cinema: {} })).toEqual({ changed: false });
    });

    test('ensures at least one enabled transition when array becomes empty', () => {
        const cfg = {
            cinema: {
                poster: {
                    cinematicTransitions: {
                        enabledTransitions: [],
                    },
                },
            },
        };

        const res = normalizeCinematicTransitions(cfg);
        expect(res.changed).toBe(true);
        expect(cfg.cinema.poster.cinematicTransitions.enabledTransitions).toEqual(['dollyIn']);
    });
});
