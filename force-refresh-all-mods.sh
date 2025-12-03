#!/bin/bash
# Force refresh all cached mods to populate 5-version history

echo "Force Refreshing All Cached Mods"
echo "=================================="
echo ""
echo "This script will force-refresh all mods in the database to fetch"
echo "the full 5-version history for each mod."
echo ""

# Check if mysql client is available
if ! command -v mysql &> /dev/null; then
    echo "ERROR: mysql client not found. Please install it first:"
    echo "  sudo apt-get install mysql-client"
    exit 1
fi

# Database credentials
DB_HOST="64.44.154.74"
DB_USER="armamodmanager"
DB_PASS="8f255M}T6kpp"
DB_NAME="armamod_cache"

# Check if proxy is running
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "WARNING: Proxy server doesn't appear to be running on port 3001"
    echo "Please start it first with: pm2 start /home/user/LoafpPanel/Proxy/proxy.js --name proxy"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "Fetching list of all mods from database..."
MOD_IDS=$(mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "SELECT id FROM mods;")

if [ -z "$MOD_IDS" ]; then
    echo "No mods found in database."
    exit 0
fi

MOD_COUNT=$(echo "$MOD_IDS" | wc -l)
echo "Found $MOD_COUNT mods to refresh"
echo ""

COUNTER=0
SUCCESS=0
FAILED=0

for MOD_ID in $MOD_IDS; do
    ((COUNTER++))
    echo "[$COUNTER/$MOD_COUNT] Refreshing mod $MOD_ID..."

    RESPONSE=$(curl -s -w "\n%{http_code}" "http://localhost:3001/proxy/mod/$MOD_ID?refresh=true" 2>&1)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    if [ "$HTTP_CODE" = "200" ]; then
        ((SUCCESS++))
        echo "  ✓ Success"
    else
        ((FAILED++))
        echo "  ✗ Failed (HTTP $HTTP_CODE)"
    fi

    # Small delay to avoid overwhelming the API
    sleep 0.5
done

echo ""
echo "=================================="
echo "Refresh Complete!"
echo "Success: $SUCCESS"
echo "Failed: $FAILED"
echo "=================================="
echo ""
echo "Now refresh your browser cache and reload the mod manager page."
echo "The version dropdowns should now show all 5 versions."
