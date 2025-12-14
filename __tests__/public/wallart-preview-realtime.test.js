/**
 * Wallart Preview Realtime Update Tests
 *
 * Lightweight regression checks to ensure the wallart preview runtime supports
 * live updates for key admin settings (animation, film cards groupBy, music mode).
 *
 * @group wallart
 * @group preview
 * @group regression
 */

const fs = require('fs');
const path = require('path');

describe('Wallart preview realtime updates (regression)', () => {
    test('wallart.html exposes window.fetchMedia(force)', () => {
        const p = path.join(__dirname, '../../public/wallart.html');
        const html = fs.readFileSync(p, 'utf8');

        expect(html).toContain('window.fetchMedia');
        expect(html).toContain('ensureMediaQueue');
        expect(html).toContain('/api/admin/media/preview');
    });

    test('wallart-display reacts to Film Cards groupBy changes', () => {
        const p = path.join(__dirname, '../../public/wallart/wallart-display.js');
        const js = fs.readFileSync(p, 'utf8');

        expect(js).toContain('layoutSettings.filmCards');
        expect(js).toContain("'groupBy'");
    });

    test('wallart-display restarts when switching to/from parallaxDepth', () => {
        const p = path.join(__dirname, '../../public/wallart/wallart-display.js');
        const js = fs.readFileSync(p, 'utf8');

        // Look for the explicit parallaxDepth switch handling to force a rebuild.
        expect(js).toContain('parallaxSwitched');
        expect(js).toContain('parallaxdepth');
    });

    test('wallart-display clears mediaQueue when content source changes', () => {
        const p = path.join(__dirname, '../../public/wallart/wallart-display.js');
        const js = fs.readFileSync(p, 'utf8');

        expect(js).toContain('needsMediaRefetch');
        expect(js).toContain('window.mediaQueue = []');
    });
});
