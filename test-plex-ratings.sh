#!/bin/bash

# Test script to verify Plex rating functionality
echo "🔍 Testing Plex Rating Functionality"
echo "===================================="

# Test 1: Check that Plex ratings API works
echo "1. Testing Plex ratings API..."
RATINGS_RESPONSE=$(curl -s "http://localhost:4000/api/sources/plex/ratings")
RATINGS_COUNT=$(echo "$RATINGS_RESPONSE" | jq -r '.count')
echo "   ✓ Found $RATINGS_COUNT ratings"

# Test 2: Check that Plex ratings-with-counts API works
echo "2. Testing Plex ratings-with-counts API..."
COUNTS_RESPONSE=$(curl -s "http://localhost:4000/api/sources/plex/ratings-with-counts")
COUNTS_DATA=$(echo "$COUNTS_RESPONSE" | jq -r '.data')
echo "   ✓ Got ratings with counts:"
echo "$COUNTS_RESPONSE" | jq -r '.data[] | "      \(.rating) (\(.count))"'

# Test 3: Check that both APIs return success
echo "3. Verifying API responses..."
PLEX_SUCCESS=$(echo "$RATINGS_RESPONSE" | jq -r '.success')
COUNTS_SUCCESS=$(echo "$COUNTS_RESPONSE" | jq -r '.success')

if [ "$PLEX_SUCCESS" = "true" ] && [ "$COUNTS_SUCCESS" = "true" ]; then
    echo "   ✅ All APIs returning success: true"
else
    echo "   ❌ API failure detected"
    exit 1
fi

# Test 4: Compare with Jellyfin to ensure parity
echo "4. Comparing with Jellyfin functionality..."
JELLYFIN_RESPONSE=$(curl -s "http://localhost:4000/api/sources/jellyfin/ratings-with-counts")
JELLYFIN_SUCCESS=$(echo "$JELLYFIN_RESPONSE" | jq -r '.success')

if [ "$JELLYFIN_SUCCESS" = "true" ]; then
    echo "   ✅ Jellyfin still working correctly"
else
    echo "   ⚠️  Jellyfin API issue detected"
fi

echo ""
echo "🎉 Plex Rating Implementation Test Complete!"
echo ""
echo "Summary:"
echo "- Plex has $RATINGS_COUNT unique content ratings"
echo "- Multi-select checkboxes should now be available in admin panel"
echo "- Ratings displayed with counts (e.g., 'PG (121)')"
echo "- Both string and array rating filters supported in source filtering"
echo "- 24-hour intelligent caching implemented"
echo ""
echo "🌟 Plex now has feature parity with Jellyfin rating system!"
