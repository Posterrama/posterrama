#!/bin/bash
#
# Manual Update Script for Posterrama
# Use this script when automatic updates fail or for troubleshooting
#
# Usage: sudo bash scripts/manual-update.sh [version]
#   If no version is specified, uses latest release
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect installation directory
if [ -d "/var/www/posterrama" ]; then
    INSTALL_DIR="/var/www/posterrama"
elif [ -d "/opt/posterrama" ]; then
    INSTALL_DIR="/opt/posterrama"
else
    echo -e "${RED}Error: Could not find Posterrama installation directory${NC}"
    echo "Expected /var/www/posterrama or /opt/posterrama"
    exit 1
fi

echo -e "${BLUE}=== Posterrama Manual Update ===${NC}"
echo "Installation directory: $INSTALL_DIR"

# Get version to install
if [ -n "$1" ]; then
    VERSION="$1"
    echo -e "${YELLOW}Installing specific version: $VERSION${NC}"
else
    echo -e "${YELLOW}Fetching latest release version...${NC}"
    
    # Try GitHub API first
    VERSION=$(curl -s -f https://api.github.com/repos/Posterrama/posterrama/releases/latest 2>/dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    
    # Fallback: scrape releases page
    if [ -z "$VERSION" ]; then
        echo -e "${YELLOW}API unavailable, trying releases page...${NC}"
        VERSION=$(curl -sL https://github.com/Posterrama/posterrama/releases/latest 2>/dev/null | grep -oP '(?<=releases/tag/)[^"]+' | head -1)
    fi
    
    # Fallback: use hardcoded latest known version
    if [ -z "$VERSION" ]; then
        VERSION="v2.9.5"
        echo -e "${YELLOW}Using fallback version: $VERSION${NC}"
        echo -e "${YELLOW}(Could not fetch from GitHub - network or rate limit issue)${NC}"
    else
        echo -e "${GREEN}Latest version: $VERSION${NC}"
    fi
fi

# Ensure unzip is installed
if ! command -v unzip &> /dev/null; then
    echo -e "${YELLOW}Installing unzip...${NC}"
    apt-get update -qq
    apt-get install -y unzip
fi

# Download release
cd /tmp
echo -e "${YELLOW}Downloading Posterrama $VERSION...${NC}"
rm -f posterrama-*.zip
wget -q --show-progress "https://github.com/Posterrama/posterrama/archive/refs/tags/${VERSION}.zip" -O "posterrama-${VERSION}.zip"

# Extract
echo -e "${YELLOW}Extracting archive...${NC}"
rm -rf "posterrama-${VERSION#v}"  # Remove v prefix if present
unzip -q "posterrama-${VERSION}.zip"

# Backup current config
cd "$INSTALL_DIR"
echo -e "${YELLOW}Backing up configuration...${NC}"
BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp config.json "config.json.backup.${BACKUP_TIMESTAMP}"
[ -f devices.json ] && cp devices.json "devices.json.backup.${BACKUP_TIMESTAMP}"
[ -f groups.json ] && cp groups.json "groups.json.backup.${BACKUP_TIMESTAMP}"
[ -f .env ] && cp .env ".env.backup.${BACKUP_TIMESTAMP}"

# Remove old code (keep data directories)
echo -e "${YELLOW}Removing old code...${NC}"
rm -rf node_modules lib routes sources utils middleware services config/__tests__

# Copy new code
echo -e "${YELLOW}Installing new version...${NC}"
cp -r "/tmp/posterrama-${VERSION#v}"/* .

# Restore configs
echo -e "${YELLOW}Restoring configuration files...${NC}"
cp "config.json.backup.${BACKUP_TIMESTAMP}" config.json
[ -f "devices.json.backup.${BACKUP_TIMESTAMP}" ] && cp "devices.json.backup.${BACKUP_TIMESTAMP}" devices.json
[ -f "groups.json.backup.${BACKUP_TIMESTAMP}" ] && cp "groups.json.backup.${BACKUP_TIMESTAMP}" groups.json
[ -f ".env.backup.${BACKUP_TIMESTAMP}" ] && cp ".env.backup.${BACKUP_TIMESTAMP}" .env

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install --production

# Restart PM2
echo -e "${YELLOW}Restarting Posterrama...${NC}"
if command -v pm2 &> /dev/null; then
    pm2 restart posterrama || pm2 start ecosystem.config.js
    
    echo -e "${GREEN}=== Update Complete ===${NC}"
    echo -e "${BLUE}Checking logs...${NC}"
    sleep 2
    pm2 logs posterrama --lines 30 --nostream
else
    echo -e "${YELLOW}PM2 not found - please restart manually${NC}"
fi

# Cleanup
echo -e "${YELLOW}Cleaning up temporary files...${NC}"
rm -f "/tmp/posterrama-${VERSION}.zip"
rm -rf "/tmp/posterrama-${VERSION#v}"

echo -e "${GREEN}✅ Update to $VERSION complete!${NC}"
echo -e "${BLUE}Config backups saved with timestamp in $INSTALL_DIR${NC}"
