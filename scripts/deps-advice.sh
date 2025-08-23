#!/usr/bin/env bash
set -euo pipefail

echo "📦 Dependency advice (local-only)"
echo ""

has_cmd() { command -v "$1" >/dev/null 2>&1; }

if ! has_cmd jq; then
  echo "⚠️  'jq' is required for pretty output. Install it for best results."
fi

echo "➡️  Checking outdated packages..."
OUTDATED_JSON=$(npm outdated --json 2>/dev/null || true)

if [[ -z "$OUTDATED_JSON" || "$OUTDATED_JSON" == "{}" ]]; then
  echo "✅ All dependencies are up-to-date"
else
  if has_cmd jq; then
    echo "\n— Patch/Minor candidates (safe to update):"
    echo "$OUTDATED_JSON" | jq -r '
      to_entries
      | map(select(.value.type == "patch" or .value.type == "minor"))
      | if length==0 then "(none)" else .[] | "  • " + .key + ": " + .value.current + " → " + .value.wanted end'

    echo "\n— Major updates (review before merging):"
    echo "$OUTDATED_JSON" | jq -r '
      to_entries
      | map(select(.value.type == "major"))
      | if length==0 then "(none)" else .[] | "  • " + .key + ": " + .value.current + " → " + .value.latest end'
  else
    echo "(Install jq for detailed grouping)"
    echo "$OUTDATED_JSON"
  fi

  echo "\nTips:"
  echo "  - Patch/Minor: npm update"
  echo "  - Major: read release notes, test locally, then 'npm i <name>@latest'"
fi

echo "\n➡️  Running security audit (filtered)..."
"$(dirname "$0")/security-audit-filtered.sh" || true

echo "\nDone."
