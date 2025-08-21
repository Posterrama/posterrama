# 🔒 Security Audit - Accepted Risks

## Overview

This document explains the security vulnerabilities that are accepted as known risks in the Posterrama project.

## Accepted Risk Packages

### Plex API Stack

The following packages contain known vulnerabilities but are accepted due to business requirements:

#### Primary Package

- **plex-api** - Core Plex media server integration
    - Critical for application functionality
    - No suitable alternatives available
    - Updates would cause breaking changes

#### Dependencies

- **plex-api-credentials** - Authentication for Plex API
- **request** - HTTP client (deprecated but functional)
- **request-promise** - Promise wrapper for request
- **request-promise-core** - Core promise functionality
- **form-data** - Multipart form data handling
- **tough-cookie** - HTTP cookie parsing and serialization
- **xml2js** - XML to JavaScript parser

## Risk Assessment

### Vulnerability Analysis

- **Severity**: Moderate to Critical (in isolated context)
- **Exploitability**: Low (server-side only, no direct user input)
- **Impact**: Limited (controlled environment)

### Mitigation Factors

1. **Controlled Environment**: Server runs in isolated environment
2. **No Direct Exposure**: Plex API calls are server-to-server
3. **Input Validation**: All external inputs are validated before processing
4. **Network Security**: Server operates behind firewall/proxy
5. **Monitoring**: Application logs and monitors all Plex interactions

## Security Controls

### Implemented Controls

- Input validation on all user-provided data
- Rate limiting on API endpoints
- Helmet.js security headers
- CORS protection
- Express validator for request sanitization

### Additional Monitoring

- Regular security reviews of Plex integration code
- Monitoring for alternative Plex libraries
- Tracking upstream security fixes

## Decision Rationale

### Business Impact

- Plex integration is core to product functionality
- No viable alternatives exist for Plex API access
- Customer base relies on Plex connectivity

### Technical Impact

- Updating would require complete API rewrite
- Risk of introducing new bugs in critical path
- Potential data loss during migration

### Risk vs Benefit

- Known vulnerabilities are in isolated dependency chain
- Actual exploit risk is minimal in current deployment
- Maintaining functionality outweighs theoretical security risk

## Review Schedule

### Quarterly Review

- Check for new Plex API alternatives
- Review vulnerability status in dependencies
- Assess any new exploit methods

### Immediate Action Triggers

- Critical vulnerabilities with known exploits
- Viable alternative libraries become available
- Customer security requirements change

## Implementation Notes

### Security Audit Filtering

The `scripts/security-audit-filtered.sh` script automatically filters out accepted risks while still reporting new vulnerabilities in other packages.

### CI/CD Integration

The continuous integration pipeline uses the filtered audit to prevent false failures while maintaining security vigilance for actionable vulnerabilities.

### Team Awareness

All team members are aware of these accepted risks and the rationale behind the decisions.

---

_Last Updated: August 2025_
_Next Review: November 2025_
