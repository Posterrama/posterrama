/** @jest-environment node */
const fs = require('fs');
const path = require('path');

describe('Cinema footer marquee offsets', () => {
    test('cinema marquee keyframes use CSS vars for deterministic 5% offsets', () => {
        const cssPath = path.join(__dirname, '../../public/cinema/cinema-display.css');
        const css = fs.readFileSync(cssPath, 'utf8');

        // Extract the full @keyframes block (regex is tricky due to nested braces).
        const startIdx = css.indexOf('@keyframes marquee');
        expect(startIdx).toBeGreaterThanOrEqual(0);
        const firstBraceIdx = css.indexOf('{', startIdx);
        expect(firstBraceIdx).toBeGreaterThan(startIdx);

        let depth = 0;
        let endIdx = -1;
        for (let i = firstBraceIdx; i < css.length; i++) {
            const ch = css[i];
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) {
                    endIdx = i + 1;
                    break;
                }
            }
        }
        expect(endIdx).toBeGreaterThan(firstBraceIdx);
        const keyframes = css.slice(startIdx, endIdx);

        // Ensure we are no longer mixing vw/percent in the keyframes.
        expect(keyframes).toContain('@keyframes marquee');
        expect(keyframes).toContain('var(--marquee-start-x');
        expect(keyframes).toContain('var(--marquee-end-x');
        expect(keyframes).not.toContain('100vw');
    });

    test('cinema display computes marquee start/end vars', () => {
        const jsPath = path.join(__dirname, '../../public/cinema/cinema-display.js');
        const js = fs.readFileSync(jsPath, 'utf8');

        expect(js).toContain("'--marquee-start-x'");
        expect(js).toContain("'--marquee-end-x'");
        // Guard that we are encoding the 5% rule in code.
        expect(js).toMatch(/containerWidth\s*\*\s*0\.95/);
        expect(js).toMatch(/containerWidth\s*\*\s*0\.05/);
    });
});
