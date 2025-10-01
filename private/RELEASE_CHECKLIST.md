# Release Checklist

Manual verification steps for Posterrama releases.

## 🚀 Pre-Release Steps

**Run automated checks with auto-fix:**
```bash
cd private/ && ./release-check.sh
```
*Script automatically detects and resolves issues when possible*

## ✅ Manual Verification

### Code Quality
- [x] Check `package.json` for missing dependencies *(automated in release-check.sh)*
- [x] Verify admin defaults are suitable for new installations *(automated in release-check.sh)*
- [ ] Remove any backup files not belonging in repo
- [ ] Update `.gitignore` if needed

### Documentation  
- [x] Is config.schema.json up-to-date? *(automated in release-check.sh)*
- [x] Update `config.example.env` and `config.example.json` *(automated in release-check.sh)*
- [x] Add JSDoc comments to API endpoints missing them *(automated in release-check.sh)*
- [x] Clean up Swagger docs - remove unused endpoints *(automated in release-check.sh)*

### Testing
- [x] All tests pass (`npm test`) *(automated in release-check.sh)*
- [x] Test artifacts cleanup *(automated in release-check.sh)*
- [ ] Admin interface functional
- [x] Media source connections work *(automated in release-check.sh)*
- [ ] Screensaver displays correctly

Kan je de README bijwerken met het aantal tests, coverage en alvast versie XXX van maken?

---
*Use with ./release-check.sh for complete release verification*
