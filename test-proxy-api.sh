#!/bin/bash
# Test script to check how many versions the proxy API returns

echo "Testing proxy API for mod versions..."
echo "======================================"
echo ""

# Replace with an actual mod ID from your panel
MOD_ID="${1:-66C250A59CC93820}"

echo "1. Testing cached response for mod $MOD_ID:"
echo "--------------------------------------------"
curl -s "http://localhost:3001/proxy/mod/$MOD_ID" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
    const versions = data?.pageProps?.asset?.versions || [];
    console.log('Versions count:', versions.length);
    console.log('Versions:');
    versions.forEach((v, i) => {
      console.log(\`  \${i+1}. v\${v.versionNumber || v.version} (current: \${v.isCurrent || false})\`);
    });
  " 2>&1

echo ""
echo "2. Testing with force refresh:"
echo "-----------------------------"
curl -s "http://localhost:3001/proxy/mod/$MOD_ID?refresh=true" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
    const versions = data?.pageProps?.asset?.versions || [];
    console.log('Versions count:', versions.length);
    console.log('Versions:');
    versions.forEach((v, i) => {
      console.log(\`  \${i+1}. v\${v.versionNumber || v.version} (current: \${v.isCurrent || false})\`);
    });
  " 2>&1
