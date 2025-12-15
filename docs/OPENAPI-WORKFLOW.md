# OpenAPI Specification Workflow

## Single Source of Truth

**`swagger.js`** is the single source of truth for API documentation.

- Contains the main description, tags, and schema definitions
- Dynamically generates spec from JSDoc comments in `server.js`
- Served live at `/api-docs/swagger.json`

## Synchronization

**`docs/openapi-latest.json`** is a static snapshot for validation and version control.

### Automatic Sync

The spec is automatically synced in the following scenarios:

1. **Pre-push hook** (when pushing to main):

```bash
git push # Automatically runs openapi:sync
```

2. **Quality pipeline**:

```bash
npm run quality:all # Includes openapi:sync
```

3. **Manual sync**:

```bash
npm run openapi:sync
npm run openapi:export # Same thing
```

### Workflow

```mermaid
graph LR
 A[swagger.js] -->|npm run openapi:export| B[docs/openapi-latest.json]
 B -->|npm run openapi:validate| C[Validation Report]
 A -->|/api-docs/swagger.json| D[/api-docs (Scalar UI)]
```

## Making Changes

### To Update API Documentation:

1. **Edit `swagger.js`** - Update description, tags, or definitions
2. **Run sync** - `npm run openapi:sync`
3. **Validate** - `npm run openapi:validate`
4. **Commit both files** - `swagger.js` and `docs/openapi-latest.json`

### Example: Updating Main Description

```javascript
// swagger.js
description: `**Posterrama** aggregates media from...

## Quick Start

1. Configure media sources...
```

Then:

```bash
npm run openapi:sync
git add swagger.js docs/openapi-latest.json
git commit -m "docs: update API description"
```

## Validation

```bash
# Validate current spec
npm run openapi:validate

# Full validation report
node scripts/validate-openapi.js
```

Checks for:

- 200 responses on all endpoints
- Examples in all responses
- Security definitions
- Schema compliance

## Files

| File                       | Purpose         | Edit?          |
| -------------------------- | --------------- | -------------- |
| `swagger.js`               | Source of truth | Yes            |
| `docs/openapi-latest.json` | Static snapshot | Auto-generated |
| `/api-docs/swagger.json`   | Live endpoint   | Dynamic        |
| `/api-docs`                | Scalar UI       | Uses live spec |

## Tips

- **Always edit `swagger.js`**, never `openapi-latest.json` directly
- Run `openapi:sync` after changes to keep files in sync
- The pre-push hook ensures main branch stays synchronized
- Use `npm run quality:all` before releases to validate everything

---

**Last updated:** December 14, 2025
**Version:** 2.9.9
