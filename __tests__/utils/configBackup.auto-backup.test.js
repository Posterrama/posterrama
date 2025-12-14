/**
 * Obsolete test suite: Auto-backup-on-save was explicitly rejected and the
 * implementation was reverted.
 *
 * Keeping this file (skipped) avoids accidentally re-introducing filesystem
 * side-effects in Jest runs while preserving historical context.
 */

describe.skip('Config Auto-Backup on Save (obsolete)', () => {
    it('feature intentionally disabled', () => {
        // no-op
    });
});
