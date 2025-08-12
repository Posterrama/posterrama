# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres (informally) to Semantic Versioning.

## [Unreleased]
### Added
- Lazy loading of Plex media libraries and admin background slideshow (loads on first Media tab activation).
- Restart button UX enhancements (progress, completion notification, auto re-enable).
- Ken Burns transition state preservation when toggling Cinema Mode.
- Global help panel toggle (H) hardened against missing key events.
- Data attribute (`data-token-set`) for Plex token presence (replacing fragile placeholder parsing).
- Auto-save microtask + rAF scheduling for smoother, responsive saves.
- UI scaling value sanitation (ignores empty slider values, preserves explicit zero).
- Comprehensive refactor summary header inside `public/admin.js`.

### Changed
- Unified admin interface font to Roboto (public/logs pages untouched).
- Background slideshow logging reduced; detailed logs gated behind `DEBUG` flag.
- Password change validation simplified (removed duplicate mismatch checks).
- Cinema Mode toggle logic refactored to avoid double invocation and preserve previous effect.
- Auto-save logic refined to prevent overwriting values with defaults on empty inputs.
- Clean form submission now removes empty strings as well as nulls.

### Fixed
- Historical issue where only General & Display sections appeared; implemented portal container ensuring all sections render reliably.
- Potential memory leak from background slideshow interval persisting across section switches (timer now cleared when leaving Media section).
- TypeError on key handling (undefined `e.key`) for help shortcut.
- Fragile Plex token placeholder detection (now robust via data attribute).
- Ken Burns option incorrectly lost or forced to Fade after Cinema Mode; now restored on exit.

### Removed
- Legacy preview / PiP and associated debug / timing code (now inert placeholders or fully stripped).
- Excessive background transition debug logs and legacy mutation observers.

### Internal / Maintenance
- Added inline documentation and TODOs for future modularization (splitting `admin.js`), accessibility improvements, and design token centralization.

## [1.3.0] - 2025-08-12
Initial 1.3.0 metadata in repository (pre-refactor baseline captured before the above Unreleased changes).

[Unreleased]: https://example.com/compare/v1.3.0...HEAD
