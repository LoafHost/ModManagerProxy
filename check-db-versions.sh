#!/bin/bash
# Check if versions are actually stored in the database

MOD_ID="${1:-5965550F24A0C152}"

echo "Checking database for mod versions"
echo "===================================="
echo "Mod ID: $MOD_ID"
echo ""

# First check if the mod exists in cache at all
echo "1. Checking if mod is cached..."
CACHED=$(echo "SELECT id, name, current_version_number FROM mods WHERE id = '$MOD_ID';" | \
    mysql -h 64.44.154.74 -u armamodmanager -p'8f255M}T6kpp' armamod_cache -N 2>/dev/null)

if [ -z "$CACHED" ]; then
    echo "❌ Mod NOT found in database cache"
    echo ""
    echo "This mod needs to be refreshed:"
    echo "  curl 'http://localhost:3001/proxy/mod/$MOD_ID?refresh=true'"
    exit 1
else
    echo "✓ Mod is cached"
    echo "  Data: $CACHED"
    echo ""
fi

# Check versions
echo "2. Checking versions in database..."
VERSIONS=$(echo "SELECT version_number, is_current, version_order FROM mod_versions WHERE mod_id = '$MOD_ID' ORDER BY version_order;" | \
    mysql -h 64.44.154.74 -u armamodmanager -p'8f255M}T6kpp' armamod_cache -N 2>/dev/null)

if [ -z "$VERSIONS" ]; then
    echo "❌ NO versions found in database for this mod"
    echo ""
    echo "The mod was cached but without version history."
    echo "Force refresh it:"
    echo "  curl 'http://localhost:3001/proxy/mod/$MOD_ID?refresh=true'"
else
    VERSION_COUNT=$(echo "$VERSIONS" | wc -l)
    echo "✓ Found $VERSION_COUNT version(s) in database:"
    echo ""
    echo "Version Number | Current | Order"
    echo "---------------|---------|------"
    echo "$VERSIONS" | while IFS=$'\t' read -r ver_num is_current ver_order; do
        printf "%-14s | %-7s | %s\n" "$ver_num" "$is_current" "$ver_order"
    done
    echo ""

    if [ "$VERSION_COUNT" -lt 5 ]; then
        echo "⚠️  Only $VERSION_COUNT version(s) found (expected 5)"
        echo "Force refresh to get full version history:"
        echo "  curl 'http://localhost:3001/proxy/mod/$MOD_ID?refresh=true'"
    else
        echo "✓ Full version history present!"
    fi
fi

echo ""
echo "3. Testing proxy API response..."
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "✓ Proxy is running"

    API_RESPONSE=$(curl -s "http://localhost:3001/proxy/mod/$MOD_ID" 2>&1)
    API_VERSIONS=$(echo "$API_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    versions = data.get('pageProps', {}).get('asset', {}).get('versions', [])
    print(len(versions))
except:
    print('ERROR')
" 2>/dev/null)

    if [ "$API_VERSIONS" = "ERROR" ]; then
        echo "❌ Proxy API returned invalid response"
    else
        echo "  API returns $API_VERSIONS versions"

        if [ "$API_VERSIONS" != "$VERSION_COUNT" ]; then
            echo "  ⚠️  MISMATCH: DB has $VERSION_COUNT but API returns $API_VERSIONS"
        fi
    fi
else
    echo "❌ Proxy is NOT running!"
    echo "Start it with: pm2 start /home/user/LoafpPanel/Proxy/proxy.js --name proxy"
fi
