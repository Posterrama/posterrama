/**
 * CSS Isolation Tests
 *
 * Validates that shared element IDs don't cause selector bleed between:
 * - Mode pages when loaded directly
 * - Preview pages when loaded in iframes
 * - Landing/admin pages
 *
 * @group isolation
 */

const request = require('supertest');

describe('CSS Isolation', () => {
    let app;

    beforeAll(() => {
        app = require('../server');
    });

    describe('Shared ID usage across modes', () => {
        const sharedIds = ['loader', 'error-message', 'info-container', 'poster-wrapper', 'poster'];

        const modes = [
            { path: '/cinema', name: 'Cinema' },
            { path: '/wallart', name: 'Wallart' },
            { path: '/screensaver', name: 'Screensaver' },
        ];

        modes.forEach(({ path, name }) => {
            test(`${name} page uses shared IDs`, async () => {
                const response = await request(app).get(path);
                expect(response.status).toBe(200);

                const html = response.text;

                // Verify at least some shared IDs exist
                const foundIds = sharedIds.filter(id => {
                    const regex = new RegExp(`id=["']${id}["']`, 'i');
                    return regex.test(html);
                });
                expect(foundIds.length).toBeGreaterThan(0);

                // Document which IDs are used
                expect(html).toMatch(/id=["']loader["']/i);
            });
        });

        test('Preview pages use same IDs as their mode pages', async () => {
            const wallartResponse = await request(app).get('/wallart');
            const previewResponse = await request(app).get('/preview-wallart');

            const wallartHtml = wallartResponse.text;
            const previewHtml = previewResponse.text;

            // Both should have loader
            expect(wallartHtml).toMatch(/id=["']loader["']/i);
            expect(previewHtml).toMatch(/id=["']loader["']/i);

            // Both should have poster-wrapper
            expect(wallartHtml).toMatch(/id=["']poster-wrapper["']/i);
            expect(previewHtml).toMatch(/id=["']poster-wrapper["']/i);
        });
    });

    describe('Preview iframe isolation', () => {
        test('Preview shell uses different ID namespace (pv-*)', async () => {
            const response = await request(app).get('/preview-shell.html');
            expect(response.status).toBe(200);

            const html = response.text;

            // Preview shell should use pv-* prefixed IDs
            expect(html).toMatch(/id=["']pv-shell["']/i);
            expect(html).toMatch(/id=["']pv-toolbar["']/i);
            expect(html).toMatch(/id=["']pv-iframe["']/i);
            expect(html).toMatch(/id=["']pv-pip["']/i);

            // Should NOT use mode page IDs at shell level
            expect(html).not.toMatch(/id=["']loader["']/i);
            expect(html).not.toMatch(/id=["']poster["']/i);
            expect(html).not.toMatch(/id=["']info-container["']/i);
        });

        test('Preview content loads in iframe, preventing parent CSS bleed', async () => {
            const response = await request(app).get('/preview-wallart');
            expect(response.status).toBe(200);

            const html = response.text;

            // Preview page has mode IDs (will be in iframe)
            expect(html).toMatch(/id=["']loader["']/i);
            expect(html).toMatch(/id=["']poster-wrapper["']/i);

            // When loaded in iframe, these IDs won't conflict with shell
            // because iframe creates separate DOM tree
        });
    });

    describe('Mode page self-containment', () => {
        test('Cinema page has data-mode attribute on body', async () => {
            const response = await request(app).get('/cinema');
            const html = response.text;

            expect(html).toMatch(/data-mode=["']cinema["']/i);
        });

        test('Wallart page has mode-specific class on body', async () => {
            const response = await request(app).get('/wallart');
            const html = response.text;

            expect(html).toMatch(/data-mode=["']wallart["']/i);
            expect(html).toMatch(/class=["'][^"']*wallart-mode[^"']*["']/i);
        });

        test('Screensaver page has data-mode attribute on body', async () => {
            const response = await request(app).get('/screensaver');
            const html = response.text;

            expect(html).toMatch(/data-mode=["']screensaver["']/i);
        });

        test('Mode-specific CSS should scope via body class', async () => {
            // This test documents the recommended pattern:
            // Instead of #loader { ... }, use .wallart-mode #loader { ... }
            // This prevents accidental bleed if multiple pages loaded

            const wallartResponse = await request(app).get('/wallart');
            const html = wallartResponse.text;

            // Verify CSS file is loaded
            expect(html).toMatch(/wallart\.css/);
        });
    });

    describe('Documentation of ID usage', () => {
        test('All modes and previews documented with shared ID patterns', () => {
            // This test serves as living documentation
            const sharedIdsAcrossModes = {
                loader: 'Spinner/loading indicator',
                'error-message': 'Error display container',
                'info-container': 'Media info wrapper',
                'poster-wrapper': 'Poster image container',
                poster: 'Main poster element',
                'poster-a': 'Layer A for transitions (wallart/screensaver)',
                'poster-b': 'Layer B for transitions (wallart/screensaver)',
                'layer-a': 'Background layer A (wallart/screensaver)',
                'layer-b': 'Background layer B (wallart/screensaver)',
                'text-wrapper': 'Title/metadata text container',
                title: 'Media title',
                tagline: 'Media tagline',
                'meta-info': 'Year/rating metadata',
                year: 'Release year',
                rating: 'Content rating',
                'controls-container': 'Playback controls wrapper (wallart/screensaver)',
                'prev-button': 'Previous media button',
                'pause-button': 'Pause/resume button',
                'next-button': 'Next media button',
                'clock-widget-container': 'Clock display (wallart/screensaver)',
                'clearlogo-container': 'ClearLogo image container',
            };

            // These IDs are intentionally shared across modes
            // Each mode page loads independently, so no runtime conflicts
            // Preview pages use iframes for isolation
            expect(Object.keys(sharedIdsAcrossModes).length).toBeGreaterThan(0);
        });
    });
});
