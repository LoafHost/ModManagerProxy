#!/usr/bin/env node
/**
 * Fast parallel mod refresh script
 * Refreshes all cached mods with 5-version history using concurrent requests
 */

const mysql = require('mysql2/promise');
const axios = require('axios');

// Configuration
const CONCURRENCY = 15; // Number of parallel requests (adjust based on API limits)
const PROXY_URL = 'http://localhost:3001/proxy/mod/';
const DB_CONFIG = {
  host: '64.44.154.74',
  port: 3306,
  user: 'armamodmanager',
  password: '8f255M}T6kpp',
  database: 'armamod_cache'
};

// Stats tracking
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  startTime: Date.now()
};

// Progress display
function updateProgress() {
  const processed = stats.success + stats.failed + stats.skipped;
  const percent = ((processed / stats.total) * 100).toFixed(1);
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  const rate = (processed / elapsed).toFixed(2);
  const eta = ((stats.total - processed) / rate).toFixed(0);

  process.stdout.write(
    `\r[${processed}/${stats.total}] ${percent}% | ` +
    `✓ ${stats.success} | ✗ ${stats.failed} | ⊘ ${stats.skipped} | ` +
    `${rate}/s | ETA: ${eta}s  `
  );
}

// Refresh a single mod
async function refreshMod(modId) {
  try {
    const response = await axios.get(`${PROXY_URL}${modId}?refresh=true`, {
      timeout: 30000,
      validateStatus: (status) => status < 500 // Accept 4xx as valid
    });

    if (response.status === 200) {
      const versions = response.data?.pageProps?.asset?.versions || [];
      if (versions.length >= 5) {
        stats.success++;
      } else if (versions.length > 0) {
        stats.success++;
        // Still count as success, but mod might not have 5 versions available
      } else {
        stats.skipped++;
      }
    } else {
      stats.failed++;
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('\n\n❌ ERROR: Proxy server is not running on port 3001');
      console.error('Please start it with: pm2 start /home/user/LoafpPanel/Proxy/proxy.js --name proxy\n');
      process.exit(1);
    }
    stats.failed++;
  }

  updateProgress();
}

// Process mods in parallel batches
async function processBatch(modIds) {
  const batches = [];

  for (let i = 0; i < modIds.length; i += CONCURRENCY) {
    const batch = modIds.slice(i, i + CONCURRENCY);
    batches.push(batch);
  }

  for (const batch of batches) {
    await Promise.all(batch.map(modId => refreshMod(modId)));
  }
}

// Main function
async function main() {
  console.log('Fast Parallel Mod Refresh');
  console.log('=========================\n');

  // Check if proxy is accessible
  console.log('Testing proxy connection...');
  try {
    await axios.get('http://localhost:3001/health', { timeout: 5000 });
    console.log('✓ Proxy is running\n');
  } catch (error) {
    console.error('✗ Cannot connect to proxy on port 3001');
    console.error('Please start it with: pm2 start /home/user/LoafpPanel/Proxy/proxy.js --name proxy\n');
    process.exit(1);
  }

  // Connect to database
  console.log('Connecting to database...');
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✓ Database connected\n');
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    console.error('Using proxy-only approach (will refresh all mods in batches)\n');
    // Could fall back to getting mod list from a file or API
    process.exit(1);
  }

  // Get all mod IDs
  console.log('Fetching mod list from database...');
  const [rows] = await connection.execute('SELECT id FROM mods');
  const modIds = rows.map(row => row.id);
  await connection.end();

  stats.total = modIds.length;
  console.log(`Found ${stats.total} mods to refresh\n`);

  console.log(`Configuration:`);
  console.log(`  - Concurrency: ${CONCURRENCY} parallel requests`);
  console.log(`  - Estimated time: ~${Math.ceil(stats.total / CONCURRENCY / 2)} seconds (optimistic)`);
  console.log('');

  // Start processing
  stats.startTime = Date.now();
  await processBatch(modIds);

  // Final summary
  const totalTime = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  const avgRate = (stats.total / totalTime).toFixed(2);

  console.log('\n\n=========================');
  console.log('Refresh Complete!');
  console.log('=========================');
  console.log(`Total:    ${stats.total} mods`);
  console.log(`Success:  ${stats.success} mods`);
  console.log(`Failed:   ${stats.failed} mods`);
  console.log(`Skipped:  ${stats.skipped} mods`);
  console.log(`Time:     ${totalTime}s`);
  console.log(`Rate:     ${avgRate} mods/second`);
  console.log('=========================\n');

  console.log('Next steps:');
  console.log('1. Clear your browser cache (Ctrl+Shift+Delete)');
  console.log('2. Reload the mod manager page');
  console.log('3. Version dropdowns should now show all 5 versions\n');

  if (stats.failed > 0) {
    console.log(`⚠️  ${stats.failed} mods failed to refresh. This is usually due to:`);
    console.log('   - Temporary API errors');
    console.log('   - Deleted/unavailable mods');
    console.log('   - Network timeouts');
    console.log('\nYou can re-run this script to retry failed mods.\n');
  }
}

// Run with error handling
main().catch(error => {
  console.error('\n\n❌ Fatal error:', error.message);
  process.exit(1);
});
