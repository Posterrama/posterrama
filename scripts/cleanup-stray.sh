#!/bin/bash

# Automated housekeeping script for stray & backup artifacts
# Safe actions only (no deletion of unknown large files). Deletions are logged.

set -e

TARGET_ROOT="$(dirname "$0")/.."
cd "$TARGET_ROOT" || exit 1

echo "[cleanup] Scanning for stray backup/editor artifacts..."

DELETE_PATTERNS=("*~" "*.tmp" "*.old" "*.backup")
MOVE_PATTERNS=("*.bak")

BACKUP_DEST="backups/misc"
mkdir -p "$BACKUP_DEST"

deleted=0
moved=0
skipped=0

for pattern in "${DELETE_PATTERNS[@]}"; do
  while IFS= read -r -d '' file; do
    # Skip inside node_modules to avoid accidental vendor deletion
    [[ "$file" == *"node_modules"* ]] && continue
    echo "[cleanup] Deleting $file";
    rm -f "$file" && ((deleted++)) || ((skipped++))
  done < <(find . -type f -name "$pattern" -print0 2>/dev/null)
done

timestamp=$(date +%Y%m%d-%H%M%S)
for pattern in "${MOVE_PATTERNS[@]}"; do
  while IFS= read -r -d '' file; do
    base=$(basename "$file")
    dest="$BACKUP_DEST/${base%.*}.$timestamp.${base##*.}"
    echo "[cleanup] Archiving $file -> $dest"
    mv "$file" "$dest" && ((moved++)) || ((skipped++))
  done < <(find . -maxdepth 3 -type f -name "$pattern" -print0 2>/dev/null)
done

echo "[cleanup] Summary: deleted=$deleted archived=$moved skipped=$skipped"
exit 0
