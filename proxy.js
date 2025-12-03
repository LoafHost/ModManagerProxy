const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const {
  initDatabase,
  getCachedMod,
  cacheMod,
  getCachedMods,
  isCacheExpired,
  cleanExpiredCache,
  getDatabaseStats,
  needsVersionRefresh,
  updateModVersions
} = require('./database');

// Configuration - Now dynamically updated
let BUILD_ID = 'vmu4Pw_jmzBqmxpgPhPRV'; // Initial fallback value
const BUILD_ID_FILE = path.join(__dirname, '.build-id.txt'); 

const app = express();
const PORT = 3001;

// Load saved BUILD_ID if available
const loadBuildId = async () => {
  try {
    const savedId = await fs.readFile(BUILD_ID_FILE, 'utf8');
    if (savedId && savedId.trim()) {
      BUILD_ID = savedId.trim();
      console.log(`📋 Loaded BUILD_ID from file: ${BUILD_ID}`);
    }
  } catch (error) {
    console.log('📋 No saved BUILD_ID found, using default');
  }
};

// Save BUILD_ID to file
const saveBuildId = async (newBuildId) => {
  try {
    await fs.writeFile(BUILD_ID_FILE, newBuildId, 'utf8');
    console.log(`💾 Saved new BUILD_ID to file: ${newBuildId}`);
  } catch (error) {
    console.error('⚠️  Failed to save BUILD_ID:', error.message);
  }
};

// Detect current BUILD_ID from the workshop main page
const detectBuildId = async () => {
  try {
    console.log('🔍 Detecting current BUILD_ID from Arma Reforger Workshop...');
    const response = await axios.get('https://reforger.armaplatform.com/workshop', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });

    // Extract BUILD_ID from the HTML - it's in the Next.js page data
    const html = response.data;
    const buildIdMatch = html.match(/"buildId":"([^"]+)"/);

    if (buildIdMatch && buildIdMatch[1]) {
      const newBuildId = buildIdMatch[1];
      console.log(`✅ Detected BUILD_ID: ${newBuildId}`);

      if (newBuildId !== BUILD_ID) {
        console.log(`🔄 BUILD_ID changed from ${BUILD_ID} to ${newBuildId}`);
        BUILD_ID = newBuildId;
        await saveBuildId(newBuildId);
        return true; // Indicate BUILD_ID was updated
      }
      return false; // BUILD_ID unchanged
    } else {
      console.error('⚠️  Could not extract BUILD_ID from workshop page');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to detect BUILD_ID:', error.message);
    return false;
  }
};

// Fetch version history for a mod using Next.js data API
const fetchModVersionHistory = async (modId) => {
  try {
    // Try the changelog JSON endpoint first
    const changelogUrl = `https://reforger.armaplatform.com/_next/data/${BUILD_ID}/workshop/${modId}/changelog.json`;

    const response = await axios.get(changelogUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://reforger.armaplatform.com/workshop/${modId}/changelog`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-nextjs-data': '1'
      },
      timeout: 15000
    });

    // Extract versions from the API response
    const versionsData = response.data?.pageProps?.versions || [];

    if (versionsData && versionsData.length > 0) {
      // Take the last 5 versions
      const last5Versions = versionsData.slice(0, 5).map((version, index) => ({
        versionNumber: version.version || version.versionNumber || '',
        versionSize: version.totalFileSize || version.versionSize || null,
        releaseDate: version.createdAt || version.releaseDate || null,
        isCurrent: index === 0 // First version is the latest/current
      })).filter(v => v.versionNumber); // Remove any without version numbers

      if (last5Versions.length > 0) {
        const versionNumbers = last5Versions.map(v => v.versionNumber).join(', ');
        console.log(`✅ Found ${last5Versions.length} versions for mod ${modId}: ${versionNumbers}`);
        return last5Versions;
      }
    }

    console.log(`⚠️  No version history found in API for mod ${modId}`);
    return [];
  } catch (error) {
    console.log(`⚠️  Could not fetch version history for ${modId}: ${error.message}`);

    // If the changelog endpoint fails, return empty array (fallback to latest only)
    return [];
  }
};

// Initialize database on startup
let dbInitialized = false;

// Async initialization
(async () => {
  // Load BUILD_ID first
  await loadBuildId();

  // Try to detect and update BUILD_ID on startup
  await detectBuildId();

  // Initialize database
  try {
    await initDatabase();
    dbInitialized = true;
    console.log('🚀 Database initialized successfully');

    // REMOVED: No automatic cache cleanup - cache forever!
    // cleanExpiredCache();
    // setInterval(cleanExpiredCache, 6 * 60 * 60 * 1000);
  } catch (error) {
    console.error('⚠️  Database initialization failed, running without cache:', error.message);
    dbInitialized = false;
  }
})();

// Configure CORS to allow requests from any origin
app.use(cors({
  origin: '*', // In production, replace with your specific domains
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  credentials: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Enhanced proxy endpoint - handles both generic URLs and workshop-specific requests
app.get('/proxy', async (req, res) => {
  try {
    let url;
    let headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/html, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://reforger.armaplatform.com/'
    };

    // Check if this is a generic proxy request with a URL parameter
    if (req.query.url) {
      // Generic proxy mode - used by the unlisted mods bot
      url = req.query.url;
      console.log(`[${new Date().toISOString()}] Generic proxy request: ${url}`);
      
      // For workshop pages, we might need to handle HTML responses
      if (url.includes('/workshop/') && !url.endsWith('.json')) {
        headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      }
    } else {
      // Original workshop search functionality
      const { page = 1, search = '', sort = 'popularity' } = req.query;
      
      // Build the Arma workshop URL
      const baseUrl = `https://reforger.armaplatform.com/_next/data/${BUILD_ID}/workshop.json`;
      const params = new URLSearchParams();
      
      params.append('page', page);
      if (search) params.append('search', search);
      if (sort !== 'popularity') params.append('sort', sort);
      
      url = `${baseUrl}?${params.toString()}`;
      console.log(`[${new Date().toISOString()}] Workshop search request: ${url}`);
    }

    // Fetch from the target URL with BUILD_ID error handling
    let response;
    try {
      response = await axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: function (status) {
          // Accept any status code for generic proxy requests
          // This allows us to properly handle 404s for non-existent mods
          return req.query.url ? status < 600 : status < 400;
        }
      });
    } catch (fetchError) {
      // If workshop search fails, try to detect and update BUILD_ID
      if (!req.query.url && fetchError.response && [404, 500].includes(fetchError.response.status)) {
        console.log(`⚠️  Workshop API failed with ${fetchError.response.status}, attempting BUILD_ID detection...`);
        const updated = await detectBuildId();

        if (updated) {
          console.log('🔄 BUILD_ID updated, retrying workshop search...');
          // Rebuild URL with new BUILD_ID
          const baseUrl = `https://reforger.armaplatform.com/_next/data/${BUILD_ID}/workshop.json`;
          const params = new URLSearchParams();
          const { page = 1, search = '', sort = 'popularity' } = req.query;
          params.append('page', page);
          if (search) params.append('search', search);
          if (sort !== 'popularity') params.append('sort', sort);
          url = `${baseUrl}?${params.toString()}`;

          // Retry
          response = await axios.get(url, {
            headers,
            timeout: 15000,
            validateStatus: function (status) {
              return status < 400;
            }
          });
        } else {
          throw fetchError;
        }
      } else {
        throw fetchError;
      }
    }
    
    // Log success with appropriate message
    if (req.query.url) {
      console.log(`[${new Date().toISOString()}] Generic proxy success - Status: ${response.status}`);
    } else {
      console.log(`[${new Date().toISOString()}] Workshop search success - Found ${response.data.pageProps?.assets?.rows?.length || 0} mods`);
    }
    
    // Handle different response types
    const contentType = response.headers['content-type'];
    
    if (contentType && contentType.includes('text/html')) {
      // For HTML responses (workshop pages), we'll just return success/failure
      // The unlisted mods bot only needs to know if the page exists
      if (response.status === 200) {
        res.json({ 
          success: true, 
          status: response.status,
          message: 'Page exists',
          isHtml: true
        });
      } else {
        res.status(response.status).json({ 
          success: false, 
          status: response.status,
          message: 'Page not found',
          isHtml: true
        });
      }
    } else {
      // For JSON responses, return the actual data
      res.set({
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      });
      
      // If it's a generic proxy request with non-200 status, include status in response
      if (req.query.url && response.status !== 200) {
        res.status(response.status);
      }
      
      res.json(response.data);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Proxy error:`, error.message);
    
    if (error.response) {
      // For generic proxy requests, we need to handle 404s properly
      if (req.query.url && error.response.status === 404) {
        res.status(404).json({
          error: 'Not found',
          message: 'The requested resource was not found',
          status: 404
        });
      } else {
        res.status(error.response.status).json({
          error: 'Target server error',
          message: error.response.data?.message || error.message,
          status: error.response.status
        });
      }
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({
        error: 'Gateway timeout',
        message: 'The request to the target server timed out'
      });
    } else {
      res.status(500).json({
        error: 'Proxy server error',
        message: error.message
      });
    }
  }
});

// Enhanced endpoint for fetching individual mod details with database caching
app.get('/proxy/mod/:modId', async (req, res) => {
  try {
    const { modId } = req.params;
    const buildId = req.query.buildId || BUILD_ID;
    const forceRefresh = req.query.refresh === 'true';

    console.log(`[${new Date().toISOString()}] Fetching mod details: ${modId} (force refresh: ${forceRefresh})`);

    // Check database cache first (if database is available and not forcing refresh)
    // CACHE FOREVER: No expiration check, only check if exists
    if (dbInitialized && !forceRefresh) {
      const cachedMod = await getCachedMod(modId);
      if (cachedMod) {
        console.log(`[${new Date().toISOString()}] Serving mod ${modId} from permanent cache`);

        // Check if versions need refreshing (even though mod is cached)
        const versionsNeedRefresh = await needsVersionRefresh(modId);
        if (versionsNeedRefresh) {
          console.log(`🔄 Versions for mod ${modId} are stale, fetching fresh versions...`);
          const freshVersions = await fetchModVersionHistory(modId);
          if (freshVersions && freshVersions.length > 0) {
            await updateModVersions(modId, freshVersions);
            cachedMod.versions = freshVersions;
            console.log(`✅ Refreshed ${freshVersions.length} versions for cached mod ${modId}`);
          }
        }

        // Return cached data in the expected API format (with potentially refreshed versions)
        res.set({
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour (since versions can update)
          'X-Cache': 'HIT',
          'X-Versions-Refreshed': versionsNeedRefresh ? 'true' : 'false'
        });

        return res.json({
          pageProps: {
            asset: cachedMod
          }
        });
      }
    }

    // Fetch from API if not cached
    console.log(`[${new Date().toISOString()}] Fetching mod ${modId} from API`);
    const apiUrl = `https://reforger.armaplatform.com/_next/data/${buildId}/workshop/${modId}.json`;

    let response;
    try {
      response = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://reforger.armaplatform.com/'
        },
        timeout: 15000
      });
    } catch (apiError) {
      // If API call fails with 404 or similar, try to detect new BUILD_ID
      if (apiError.response && [404, 500].includes(apiError.response.status)) {
        console.log(`⚠️  API call failed with ${apiError.response.status}, attempting BUILD_ID detection...`);
        const updated = await detectBuildId();

        if (updated) {
          console.log('🔄 BUILD_ID updated, retrying API call...');
          // Retry with new BUILD_ID
          const retryUrl = `https://reforger.armaplatform.com/_next/data/${BUILD_ID}/workshop/${modId}.json`;
          response = await axios.get(retryUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://reforger.armaplatform.com/'
            },
            timeout: 15000
          });
        } else {
          throw apiError; // Re-throw if BUILD_ID detection didn't help
        }
      } else {
        throw apiError;
      }
    }

    console.log(`[${new Date().toISOString()}] Successfully fetched mod ${modId} from API`);

    // Fetch version history for the mod
    const versions = await fetchModVersionHistory(modId);

    // Cache the response in database if available
    if (dbInitialized && response.data?.pageProps?.asset) {
      const modData = response.data.pageProps.asset;

      // Log dependencies if present - check all possible field names
      // Based on Arma Reforger workshop showing "Content Packs", prioritize contentPacks
      const possibleFields = ['contentPacks', 'dependencies', 'requiredAssets', 'requiredDependencies', 'dependencyAssets'];
      let foundDeps = false;

      for (const field of possibleFields) {
        if (modData[field] && Array.isArray(modData[field]) && modData[field].length > 0) {
          console.log(`📦 Found ${modData[field].length} dependencies under field '${field}' for mod ${modId}`);
          console.log(`📦 First ${field} structure:`, JSON.stringify(modData[field][0], null, 2));
          foundDeps = true;
          break;
        }
      }

      if (!foundDeps) {
        console.log(`ℹ️  No dependencies found for mod ${modId} in any expected field`);
      }

      // Add version history to mod data
      if (versions && versions.length > 0) {
        modData.versions = versions;
        console.log(`✅ Fetched ${versions.length} versions for mod ${modId}`);
      } else {
        console.log(`⚠️  No versions fetched for mod ${modId}, will show only current version`);
      }

      await cacheMod(modData);

      // IMPORTANT: Return the modified response with versions
      response.data.pageProps.asset = modData;
    }

    // Return the mod data in the format expected by the controller (now includes versions)
    res.set({
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      'X-Cache': 'MISS'
    });

    res.json(response.data);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching mod ${req.params.modId}:`, error.message);

    if (error.response) {
      res.status(error.response.status).json({
        error: 'Failed to fetch mod details',
        message: error.response.data?.message || error.message,
        status: error.response.status,
        modId: req.params.modId
      });
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({
        error: 'Gateway timeout',
        message: 'The request to fetch mod details timed out',
        modId: req.params.modId
      });
    } else {
      res.status(500).json({
        error: 'Server error',
        message: error.message,
        modId: req.params.modId
      });
    }
  }
});

// NEW: Batch endpoint for fetching multiple mod details (optimized for PHP controller)
app.post('/proxy/mods/batch', express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { modIds } = req.body;
    
    if (!Array.isArray(modIds) || modIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'modIds must be a non-empty array'
      });
    }
    
    console.log(`[${new Date().toISOString()}] Batch fetching ${modIds.length} mods`);
    
    const result = {};
    const uncachedMods = [];
    const dbStartTime = Date.now();
    
    // Check database cache for all mods (CACHE FOREVER - no expiration check)
    if (dbInitialized) {
      const cachedMods = await getCachedMods(modIds);
      const dbTime = Date.now() - dbStartTime;
      const modsNeedingVersionRefresh = [];

      for (const modId of modIds) {
        const cached = cachedMods[modId];
        if (cached) {
          result[modId] = cached;

          // Check if this mod's versions need refreshing
          const needsRefresh = await needsVersionRefresh(modId);
          if (needsRefresh) {
            modsNeedingVersionRefresh.push(modId);
          }
        } else {
          uncachedMods.push(modId);
        }
      }

      console.log(`[${new Date().toISOString()}] Database query took ${dbTime}ms - Found ${Object.keys(result).length} cached, ${uncachedMods.length} need API fetch, ${modsNeedingVersionRefresh.length} need version refresh`);

      // Refresh versions for mods that need it (in background)
      if (modsNeedingVersionRefresh.length > 0) {
        console.log(`🔄 Refreshing versions for ${modsNeedingVersionRefresh.length} mods...`);
        const versionRefreshPromises = modsNeedingVersionRefresh.map(async (modId) => {
          try {
            const freshVersions = await fetchModVersionHistory(modId);
            if (freshVersions && freshVersions.length > 0) {
              await updateModVersions(modId, freshVersions);
              // Update the result with fresh versions
              if (result[modId]) {
                result[modId].versions = freshVersions;
              }
              console.log(`✅ Refreshed ${freshVersions.length} versions for mod ${modId}`);
            }
          } catch (error) {
            console.error(`❌ Failed to refresh versions for mod ${modId}:`, error.message);
          }
        });

        // Wait for all version refreshes to complete
        await Promise.all(versionRefreshPromises);
      }
    } else {
      uncachedMods.push(...modIds);
    }
    
    // Fetch uncached mods from API
    const apiStartTime = Date.now();
    const buildId = req.query.buildId || BUILD_ID;
    const fetchPromises = uncachedMods.map(async (modId) => {
      try {
        const apiUrl = `https://reforger.armaplatform.com/_next/data/${buildId}/workshop/${modId}.json`;
        const response = await axios.get(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://reforger.armaplatform.com/'
          },
          timeout: 15000
        });

        if (response.data?.pageProps?.asset) {
          const modData = response.data.pageProps.asset;

          // Fetch version history for this mod
          const versions = await fetchModVersionHistory(modId);
          if (versions && versions.length > 0) {
            modData.versions = versions;
          }

          // Cache in database if available
          if (dbInitialized) {
            await cacheMod(modData);
          }

          // Convert to our format
          result[modId] = {
            id: modData.id || modId,
            name: modData.name || modId,
            summary: modData.summary || '',
            currentVersionNumber: modData.currentVersionNumber || '',
            currentVersionSize: modData.currentVersionSize || null,
            previews: modData.previews || [],
            author: modData.author || null,
            dependencies: (modData.dependencies || []).map(dep => ({
              totalFileSize: dep.totalFileSize || null,
              asset: {
                id: dep.asset?.id || '',
                name: dep.asset?.name || ''
              }
            })),
            versions: versions || []
          };
        }
      } catch (error) {
        console.error(`Error fetching mod ${modId}:`, error.message);
        // Don't include failed mods in result
      }
    });

    await Promise.all(fetchPromises);
    const apiTime = Date.now() - apiStartTime;
    const totalTime = Date.now() - startTime;
    
    const cached = modIds.length - uncachedMods.length;
    const fetched = Object.keys(result).length - cached;
    
    console.log(`[${new Date().toISOString()}] Batch completed in ${totalTime}ms (DB: ${dbTime || 0}ms, API: ${apiTime}ms) - ${cached} cached, ${fetched} fetched, ${Object.keys(result).length}/${modIds.length} total`);
    
    res.json({
      success: true,
      modDetails: result,
      cached: cached,
      fetched: fetched,
      total: modIds.length,
      performance: {
        totalTime: totalTime,
        dbTime: dbTime || 0,
        apiTime: apiTime
      }
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] Error in batch mod fetch after ${totalTime}ms:`, error.message);
    res.status(500).json({
      error: 'Batch fetch failed',
      message: error.message
    });
  }
});

// NEW: Database statistics endpoint
app.get('/database/stats', async (req, res) => {
  try {
    if (!dbInitialized) {
      return res.json({
        database_enabled: false,
        message: 'Database not initialized'
      });
    }
    
    const stats = await getDatabaseStats();
    res.json({
      database_enabled: true,
      ...stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get database stats',
      message: error.message
    });
  }
});

// NEW: Cache management endpoint
app.post('/database/cleanup', async (req, res) => {
  try {
    if (!dbInitialized) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Database not initialized'
      });
    }
    
    await cleanExpiredCache();
    const stats = await getDatabaseStats();
    
    res.json({
      success: true,
      message: 'Cache cleanup completed',
      stats
    });
  } catch (error) {
    res.status(500).json({
      error: 'Cache cleanup failed',
      message: error.message
    });
  }
});

// Enhanced endpoint for checking if a mod exists (useful for the discovery bot)
app.get('/check-mod/:modId', async (req, res) => {
  try {
    const { modId } = req.params;
    const buildId = req.query.buildId || BUILD_ID;
    
    console.log(`[${new Date().toISOString()}] Checking mod: ${modId}`);
    
    // FIRST: Check if it's in the public API (if it is, we don't care about it for unlisted mod discovery)
    const apiUrl = `https://reforger.armaplatform.com/_next/data/${buildId}/workshop/${modId}.json`;
    
    try {
      const apiResponse = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      // If the API has it, it's a public mod - we don't care about it for unlisted discovery
      if (apiResponse.status === 200) {
        console.log(`[${new Date().toISOString()}] Mod ${modId}: public mod (in API)`);
        return res.json({
          modId,
          exists: true,
          isListed: true,
          isUnlisted: false
        });
      }
    } catch (apiError) {
      // API returned error (likely 404) - now check if workshop page exists
      if (apiError.response?.status === 404) {
        // API doesn't have it - check workshop page
        const pageUrl = `https://reforger.armaplatform.com/workshop/${modId}`;
        
        try {
          const pageResponse = await axios.get(pageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml'
            },
            timeout: 10000,
            maxRedirects: 0,
            validateStatus: function (status) {
              return status < 400; // Accept 200-399
            }
          });
          
          // Workshop page exists but API doesn't = UNLISTED MOD!
          if (pageResponse.status === 200) {
            console.log(`[${new Date().toISOString()}] Mod ${modId}: UNLISTED (page exists, not in API)`);
            return res.json({
              modId,
              exists: true,
              isListed: false,
              isUnlisted: true
            });
          }
        } catch (pageError) {
          // Workshop page doesn't exist either - invalid mod ID
          console.log(`[${new Date().toISOString()}] Mod ${modId}: invalid (no page, no API)`);
          return res.status(404).json({
            modId,
            exists: false,
            isListed: false,
            isUnlisted: false,
            error: 'Mod not found'
          });
        }
      }
    }
    
    // Shouldn't reach here, but just in case
    return res.status(404).json({
      modId,
      exists: false,
      isListed: false,
      isUnlisted: false,
      error: 'Unable to determine mod status'
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error checking mod:`, error.message);
    res.status(500).json({
      error: 'Failed to check mod',
      message: error.message
    });
  }
});

// Stats endpoint for monitoring
app.get('/stats', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    buildId: BUILD_ID,
    cacheMode: 'permanent'
  });
});

// NEW: Manual BUILD_ID detection endpoint
app.post('/update-build-id', async (req, res) => {
  try {
    console.log('🔍 Manual BUILD_ID update requested...');
    const oldBuildId = BUILD_ID;
    const updated = await detectBuildId();

    if (updated) {
      res.json({
        success: true,
        message: 'BUILD_ID updated successfully',
        oldBuildId: oldBuildId,
        newBuildId: BUILD_ID,
        recommendation: 'Restart proxy for best results (optional - already using new BUILD_ID)'
      });
    } else {
      res.json({
        success: true,
        message: 'BUILD_ID is already up to date',
        currentBuildId: BUILD_ID
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update BUILD_ID',
      message: error.message
    });
  }
});

// NEW: Endpoint to get current BUILD_ID
app.get('/build-id', (req, res) => {
  res.json({
    buildId: BUILD_ID,
    buildIdFile: BUILD_ID_FILE
  });
});

// NEW: Test version history endpoint
app.get('/test-versions/:modId', async (req, res) => {
  try {
    const { modId } = req.params;
    console.log(`Testing version history for mod: ${modId}`);

    const versions = await fetchModVersionHistory(modId);

    res.json({
      success: true,
      modId: modId,
      versionsFound: versions.length,
      versions: versions,
      formattedForDropdown: versions.map((v, i) => ({
        label: i === 0 ? `Latest (${v.versionNumber})` : v.versionNumber,
        value: v.versionNumber,
        isDefault: i === 0
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// NEW: Manual restart endpoint (useful after BUILD_ID update)
app.post('/restart', (req, res) => {
  console.log('🔄 Manual restart requested...');
  res.json({
    success: true,
    message: 'Proxy server restarting...',
    note: 'Command: pm2 restart proxy'
  });

  // Give time for response to send, then exit
  // PM2 will automatically restart the service
  setTimeout(() => {
    console.log('💤 Shutting down for restart...');
    process.exit(0);
  }, 1000);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Enhanced Arma Mod Manager proxy server running on http://0.0.0.0:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Workshop search: curl "http://localhost:${PORT}/proxy?page=1"`);
  console.log(`Generic proxy: curl "http://localhost:${PORT}/proxy?url=https://example.com"`);
  console.log(`Fetch mod details: curl "http://localhost:${PORT}/proxy/mod/659527E5E537EAA4"`);
  console.log(`Check mod: curl "http://localhost:${PORT}/check-mod/59727DF1D1F5F51C"`);
});