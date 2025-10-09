# API Validation Scripts

This directory contains scripts for validating API documentation and responses.

## Scripts

- `validate-api-responses.js` - Tests actual API responses against documented schemas
- `verify-api-docs.js` - Analyzes server.js and swagger.js to identify missing documentation and inconsistencies

## Usage

```bash
# From project root
node scripts/validation/validate-api-responses.js
node scripts/validation/verify-api-docs.js
```

These scripts help ensure API documentation stays in sync with implementation.
