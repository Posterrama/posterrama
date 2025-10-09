# ZIP Streaming Robustness Improvements

**Date**: 2025-10-10  
**Version**: 2.7.0

## Overview

Enhanced the `/local-posterpack` endpoint with comprehensive error handling, security improvements, and test coverage for ZIP streaming operations.

## Changes Implemented

### 1. Enhanced Error Handling

#### GET /local-posterpack

- **Corrupted ZIP Detection**: Now catches and logs ZIP file corruption errors with detailed context
- **Empty ZIP Validation**: Detects and returns appropriate 404 for empty ZIP files
- **Entry Extraction Errors**: Handles failures during data extraction from ZIP entries
- **Empty Entry Detection**: Validates that extracted data is not empty
- **Content-Length Header**: Added proper Content-Length header for better client handling
- **Detailed Logging**: All errors are logged with context (file paths, error messages, stack traces)

#### HEAD /local-posterpack

- **Improved Error Logging**: Added structured logging for corrupted ZIPs and unexpected errors
- **Empty ZIP Handling**: Returns 404 for ZIPs with no entries
- **Consistent Error Responses**: Standardized status codes across all error scenarios

### 2. Security Improvements

Both GET and HEAD endpoints now include:

- **Windows-style Path Blocking**: Detects and rejects Windows absolute paths (e.g., `C:\path`)
- **Enhanced Path Validation**: Checks for:
    - Parent directory traversal (`..`)
    - Unix absolute paths (`/path`)
    - Windows backslash paths (`\path`)
    - Drive letter notation (`C:`, `D:`, etc.)
- **Extended Entry Types**: Added support for `banner` entry type
- **Clear Error Messages**: Descriptive messages for all validation failures

### 3. Response Improvements

- **404 vs 416 Clarity**: Clear distinction between missing resources (404) and server errors (500)
- **Descriptive Error Messages**:
    - "Missing parameters" - for missing query params
    - "Invalid zip path" - for security violations
    - "Invalid entry type" - for unsupported entry types
    - "ZIP not found" - for missing ZIP files
    - "Entry not found in ZIP" - for missing entries
    - "Failed to open ZIP" - for corrupted files
    - "Failed to read entry from ZIP" - for extraction errors
    - "Entry contains no data" - for empty entries

## Test Coverage

Created comprehensive test suite: `__tests__/api/local.posterpack-robustness.test.js`

### Test Categories (20 tests total)

1. **Valid Scenarios** (2 tests)
    - Valid ZIP with existing entry
    - Multiple image format support

2. **Missing Files** (3 tests)
    - Non-existent ZIP file
    - Missing entry in valid ZIP
    - Empty ZIP file

3. **Corrupted Files** (1 test)
    - Truncated/corrupted ZIP file

4. **Invalid Parameters** (5 tests)
    - Missing zip parameter
    - Missing entry parameter
    - Path traversal attempts (`..`)
    - Absolute path attempts (`/path`)
    - Invalid entry type

5. **HEAD Support** (5 tests)
    - Existing entry (no body)
    - Missing entry
    - Non-existent ZIP
    - Corrupted ZIP
    - Invalid parameters

6. **Security & Edge Cases** (3 tests)
    - Windows-style absolute paths
    - Non-ZIP file extension check
    - URL-encoded special characters

7. **Error Logging** (1 test)
    - Verify error logging for corrupted files

### Test Results

```
✓ All 20 tests passing
✓ Backward compatibility maintained
✓ Existing posterpack tests still passing
```

## API Behavior

### GET /local-posterpack

**Query Parameters:**

- `zip` (required): Relative path to ZIP file
- `entry` (required): Entry type (`poster`, `background`, `clearlogo`, `thumbnail`, `banner`)

**Status Codes:**

- `200` - Success with image data
- `400` - Invalid parameters or security violation
- `404` - ZIP not found, entry not found, or empty data
- `500` - Corrupted ZIP or extraction failure

**Headers (on success):**

- `Content-Type`: Detected MIME type
- `Cache-Control`: `public, max-age=86400`
- `Content-Length`: Size of image data

### HEAD /local-posterpack

**Purpose**: Fast presence check without downloading data

**Query Parameters:** Same as GET

**Status Codes:**

- `200` - Entry exists
- `400` - Invalid parameters
- `404` - ZIP or entry not found
- `500` - Corrupted ZIP or server error

**Body**: Always empty (per HEAD specification)

## Error Logging Format

All errors are logged with structured context:

```javascript
logger.error('[Local Posterpack] <description>', {
    zipPath: '/full/path/to/file.zip',
    entry: 'poster.jpg',
    error: 'Error message',
    stack: 'Stack trace',
});
```

## Security Considerations

### Prevented Attack Vectors

1. **Path Traversal**: `../../etc/passwd` → 400 Invalid zip path
2. **Absolute Paths**: `/etc/passwd` → 400 Invalid zip path
3. **Windows Paths**: `C:\Windows\System32` → 400 Invalid zip path
4. **Backslash Paths**: `\path\to\file` → 400 Invalid zip path
5. **Non-ZIP Files**: Only `.zip` extension accepted
6. **Base Path Validation**: All paths validated against configured base directories

### Safe Operations

- URL-encoded special characters properly handled
- ZIP files with brackets/spaces supported: `Movie [2024].zip`
- Case-insensitive entry matching
- Multiple image format preference order

## Performance Impact

- **Minimal overhead**: Error handling adds negligible latency
- **Early validation**: Security checks happen before file I/O
- **Efficient caching**: 24-hour cache headers reduce repeat requests
- **HEAD optimization**: Presence checks don't load entry data

## Backward Compatibility

✅ All changes are backward compatible:

- Existing valid requests work identically
- Error responses improved but maintain expected status codes
- No breaking changes to API contract
- Existing tests pass without modification

## Future Enhancements (Optional)

While not implemented, these could be considered:

1. **Range Request Support (416 status)**
    - Would require `Accept-Ranges` header
    - Partial content support for large images
    - Resumable downloads

2. **ETag Support**
    - Generate ETag from ZIP modification time + entry name
    - Support `If-None-Match` for 304 responses

3. **Streaming for Large Entries**
    - Current implementation loads entire entry into memory
    - Could stream directly from ZIP for very large files

4. **Compression Negotiation**
    - Support `Accept-Encoding` for on-the-fly compression
    - Useful for uncompressed formats like BMP

## Related Files

- **Implementation**: `/var/www/posterrama/server.js` (lines ~1436-1630)
- **Tests**:
    - `/var/www/posterrama/__tests__/api/local.posterpack-robustness.test.js` (new)
    - `/var/www/posterrama/__tests__/api/local.posterpack-thumbnail.test.js` (existing)
- **Source Integration**: `/var/www/posterrama/sources/local.js` (uses the endpoint)
- **Documentation**: This file

## Testing Commands

```bash
# Run robustness tests
npm test -- __tests__/api/local.posterpack-robustness.test.js

# Run all posterpack tests
npm test -- __tests__/api/local.posterpack

# Verify no regressions
npm test

# Check code quality
npm run lint
```

## Changelog Entry

```
### Fixed
- Enhanced ZIP streaming error handling with detailed logging
- Added validation for empty and corrupted ZIP files
- Improved security with Windows path detection
- Added Content-Length header to ZIP entry responses

### Added
- Comprehensive test suite for ZIP streaming robustness (20 tests)
- Support for 'banner' entry type in posterpacks
- Detailed error messages for all failure scenarios
- Structured logging for all ZIP-related errors

### Security
- Blocked Windows-style absolute paths (C:\, D:\, etc.)
- Enhanced path traversal prevention
- Improved validation against directory escape attempts
```
