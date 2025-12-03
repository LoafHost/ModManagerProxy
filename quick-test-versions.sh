#!/bin/bash
# Quick test to verify proxy API returns versions for a specific mod

MOD_ID="${1:-5965550F24A0C152}"

echo "Testing proxy API for mod: $MOD_ID"
echo "=========================================="
echo ""

# Test the actual endpoint the panel uses
echo "1. Testing /proxy/mod/{modId} endpoint:"
echo "--------------------------------------"
curl -s "http://localhost:3001/proxy/mod/$MOD_ID" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    asset = data.get('pageProps', {}).get('asset', {})
    versions = asset.get('versions', [])

    print(f'Response structure: {list(data.keys())}')
    print(f'Asset keys: {list(asset.keys())}')
    print(f'Versions count: {len(versions)}')
    print('')

    if len(versions) > 0:
        print('✓ Versions found:')
        for i, v in enumerate(versions[:5]):
            ver_num = v.get('versionNumber', v.get('version', 'unknown'))
            print(f'  {i+1}. {ver_num}')
    else:
        print('❌ NO VERSIONS in API response')
        print('')
        print('Checking if mod has currentVersionNumber:', asset.get('currentVersionNumber', 'NOT FOUND'))
except Exception as e:
    print(f'❌ Error: {e}')
    print('Raw response:', sys.stdin.read()[:500])
"

echo ""
echo "2. Force refresh and check again:"
echo "--------------------------------"
curl -s "http://localhost:3001/proxy/mod/$MOD_ID?refresh=true" >/dev/null 2>&1
echo "Refreshed mod $MOD_ID, checking response..."
sleep 1

curl -s "http://localhost:3001/proxy/mod/$MOD_ID" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    versions = data.get('pageProps', {}).get('asset', {}).get('versions', [])
    print(f'Versions after refresh: {len(versions)}')
    if len(versions) > 0:
        print('✓ Versions:')
        for i, v in enumerate(versions[:5]):
            print(f'  {i+1}. {v.get(\"versionNumber\", v.get(\"version\", \"unknown\"))}')
    else:
        print('❌ Still no versions after force refresh!')
except Exception as e:
    print(f'❌ Error: {e}')
"

echo ""
echo "3. Check proxy logs for errors:"
echo "-------------------------------"
pm2 logs proxy --lines 20 --nostream 2>/dev/null | grep -E "version|error|failed|⚠️|❌" | tail -10
