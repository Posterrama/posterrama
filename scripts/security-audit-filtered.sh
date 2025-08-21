#!/bin/bash

# Security Audit with Accepted Risks
# This script runs security audits while filtering out accepted risks

echo "🔒 Running security audit with accepted risks..."
echo ""

# List of accepted vulnerabilities (package names)
ACCEPTED_RISKS="plex-api plex-api-credentials request request-promise request-promise-core form-data tough-cookie xml2js"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Accepted Risk Packages:${NC}"
for package in $ACCEPTED_RISKS; do
    echo "  • $package (Plex API dependency - breaking changes if updated)"
done
echo ""

# Run audit and capture output
echo -e "${BLUE}Running npm audit...${NC}"
AUDIT_OUTPUT=$(npm audit --json 2>/dev/null)
AUDIT_EXIT_CODE=$?

if [ $AUDIT_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ No new vulnerabilities found${NC}"
    exit 0
fi

# Parse the audit output to filter accepted risks
echo "$AUDIT_OUTPUT" | jq -r '
.vulnerabilities | 
to_entries[] | 
select(.value.severity == "high" or .value.severity == "critical") |
select(.key | test("^(plex-api|request|form-data|tough-cookie|xml2js)") | not) |
.key + " (" + .value.severity + "): " + .value.title
' > /tmp/filtered_vulnerabilities.txt

if [ -s /tmp/filtered_vulnerabilities.txt ]; then
    echo -e "${RED}❌ High/Critical vulnerabilities found (excluding accepted risks):${NC}"
    cat /tmp/filtered_vulnerabilities.txt
    echo ""
    echo -e "${RED}These vulnerabilities need to be addressed.${NC}"
    rm -f /tmp/filtered_vulnerabilities.txt
    exit 1
else
    echo -e "${YELLOW}⚠️ Only accepted risk vulnerabilities found${NC}"
    echo -e "${GREEN}✅ No new actionable vulnerabilities${NC}"
    rm -f /tmp/filtered_vulnerabilities.txt
    exit 0
fi
