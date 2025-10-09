/**
 * Unit tests for the standalone redact function exported from utils/logger.js
 * These tests avoid Winston entirely to get crisp, deterministic coverage of
 * every supported pattern and edge case.
 */

const { redact } = require('../../utils/logger');

describe('logger.redact (pure function)', () => {
    test('returns non-string values unchanged', () => {
        expect(redact(null)).toBe(null);
        expect(redact(undefined)).toBe(undefined);
        const obj = { a: 1 };
        expect(redact(obj)).toBe(obj);
    });

    test('redacts X-Plex-Token query param', () => {
        const input = 'GET /?X-Plex-Token=ABC123XYZ';
        const out = redact(input);
        expect(out).not.toContain('ABC123XYZ');
        expect(out).toMatch(/X-Plex-Token=\*\*\*REDACTED\*\*\*/i);
    });

    test('redacts X_PLEX_TOKEN env style', () => {
        const input = 'Using X_PLEX_TOKEN=PLEXSECRETTOKEN for auth';
        const out = redact(input);
        expect(out).not.toContain('PLEXSECRETTOKEN');
        expect(out).toMatch(/X_PLEX_TOKEN=\*\*\*REDACTED\*\*\*/);
    });

    test('redacts PLEX_TOKEN alternative', () => {
        const input = 'Export PLEX_TOKEN=Z99ZZ';
        const out = redact(input);
        expect(out).not.toContain('Z99ZZ');
        expect(out).toMatch(/PLEX_TOKEN=\*\*\*REDACTED\*\*\*/);
    });

    test('redacts Jellyfin API key', () => {
        const input = 'Set JELLYFIN_API_KEY=JFIN12345';
        const out = redact(input);
        expect(out).not.toContain('JFIN12345');
        expect(out).toMatch(/JELLYFIN_API_KEY=\*\*\*REDACTED\*\*\*/);
    });

    test('redacts Authorization Bearer token', () => {
        const input = 'Authorization: Bearer tokenPART.ONE_two-3';
        const out = redact(input);
        expect(out).not.toContain('tokenPART.ONE_two-3');
        expect(out).toMatch(/Authorization: Bearer \*\*\*REDACTED\*\*\*/);
    });

    test('redacts multiple different tokens in one string', () => {
        const input = 'Authorization: Bearer AAA111 X-Plex-Token=BBB222 JELLYFIN_API_KEY=CCC333';
        const out = redact(input);
        expect(out).not.toMatch(/AAA111|BBB222|CCC333/);
        const count = (out.match(/\*\*\*REDACTED\*\*\*/g) || []).length;
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test('idempotent when applied twice', () => {
        const input = 'Authorization: Bearer AAA111';
        const first = redact(input);
        const second = redact(first);
        expect(second).toBe(first); // no double replacement artifacts
    });
});
