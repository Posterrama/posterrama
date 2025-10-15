/** @jest-environment node */
const path = require('path');

describe('admin-utils.validateBypassParam', () => {
    const utils = require(path.join('..', '..', 'public', 'admin-utils.js'));

    test('allows empty and trims whitespace', () => {
        expect(utils.validateBypassParam('')).toBe(true);
        expect(utils.validateBypassParam('   ')).toBe(true);
        expect(utils.validateBypassParam(null)).toBe(true);
        expect(utils.validateBypassParam(undefined)).toBe(true);
    });

    test('valid tokens', () => {
        const ok = ['landing', 'L', 'flag_1', 'Flag-2', 'x12345', 'A_b-C'];
        ok.forEach(s => expect(utils.validateBypassParam(s)).toBe(true));
    });

    test('invalid when not starting with a letter', () => {
        const bad = ['1start', '_bad', '-bad', ' 1', '  _'];
        bad.forEach(s => expect(utils.validateBypassParam(s)).toBe(false));
    });

    test('invalid characters rejected', () => {
        const bad = ['has space', 'has.dot', 'has@t', 'has*star'];
        bad.forEach(s => expect(utils.validateBypassParam(s)).toBe(false));
    });

    test('max length 32', () => {
        const mk = n => 'A' + 'a'.repeat(n - 1);
        expect(utils.validateBypassParam(mk(32))).toBe(true);
        expect(utils.validateBypassParam(mk(33))).toBe(false);
    });
});
