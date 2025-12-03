const mysql = require('mysql2/promise');

// Database configuration - uses environment variables with fallbacks
const dbConfig = {
  host: process.env.DB_HOST || '64.44.154.74',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'armamodmanager',
  password: process.env.DB_PASSWORD || '8f255M}T6kpp',
  database: process.env.DB_NAME || 'armamod_cache',
  charset: 'utf8mb4',
  timezone: '+00:00',
  connectTimeout: 60000
};

let pool = null;

// Initialize database connection pool
const initDatabase = async () => {
  try {
    pool = mysql.createPool({
      ...dbConfig,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test connection
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');
    connection.release();

    // Create tables if they don't exist
    await createTables();
    
    return pool;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.log('📝 Database configuration:');
    console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`   Database: ${dbConfig.database}`);
    console.log(`   User: ${dbConfig.user}`);
    console.log('💡 You can set these environment variables:');
    console.log('   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME');
    throw error;
  }
};

// Create database tables
const createTables = async () => {
  const connection = await pool.getConnection();
  
  try {
    // Create mods table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS mods (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        summary TEXT,
        author_username VARCHAR(255),
        current_version_number VARCHAR(100),
        current_version_size BIGINT UNSIGNED,
        created_at DATETIME,
        updated_at DATETIME,
        cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cached_at (cached_at),
        INDEX idx_name (name),
        INDEX idx_author (author_username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create mod_previews table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS mod_previews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mod_id VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        preview_order INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE,
        INDEX idx_mod_id (mod_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create mod_dependencies table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS mod_dependencies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mod_id VARCHAR(255) NOT NULL,
        dependency_mod_id VARCHAR(255) NOT NULL,
        dependency_name VARCHAR(500),
        file_size BIGINT UNSIGNED,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE,
        INDEX idx_mod_id (mod_id),
        INDEX idx_dependency_mod_id (dependency_mod_id),
        UNIQUE KEY unique_dependency (mod_id, dependency_mod_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create mod_versions table for version history
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS mod_versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mod_id VARCHAR(255) NOT NULL,
        version_number VARCHAR(100) NOT NULL,
        version_size BIGINT UNSIGNED,
        release_date DATETIME,
        is_current BOOLEAN DEFAULT FALSE,
        version_order INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE,
        INDEX idx_mod_id (mod_id),
        INDEX idx_version_order (mod_id, version_order),
        INDEX idx_is_current (mod_id, is_current),
        UNIQUE KEY unique_mod_version (mod_id, version_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ Database tables created/verified successfully');
  } catch (error) {
    console.error('❌ Error creating database tables:', error.message);
    throw error;
  } finally {
    connection.release();
  }
};

// Get cached mod data from database
const getCachedMod = async (modId) => {
  if (!pool) {
    throw new Error('Database not initialized');
  }

  try {
    const connection = await pool.getConnection();
    
    try {
      // Get main mod data
      const [modRows] = await connection.execute(
        'SELECT * FROM mods WHERE id = ?',
        [modId]
      );

      if (modRows.length === 0) {
        return null;
      }

      const mod = modRows[0];

      // Get previews
      const [previewRows] = await connection.execute(
        'SELECT url FROM mod_previews WHERE mod_id = ? ORDER BY preview_order',
        [modId]
      );

      // Get dependencies
      const [depRows] = await connection.execute(
        'SELECT dependency_mod_id, dependency_name, file_size FROM mod_dependencies WHERE mod_id = ?',
        [modId]
      );

      // Get version history (past 5 versions ordered by version_order)
      const [versionRows] = await connection.execute(
        'SELECT version_number, version_size, release_date, is_current FROM mod_versions WHERE mod_id = ? ORDER BY version_order LIMIT 5',
        [modId]
      );

      // Format the response to match the expected structure
      return {
        id: mod.id,
        name: mod.name,
        summary: mod.summary || '',
        currentVersionNumber: mod.current_version_number || '',
        currentVersionSize: mod.current_version_size || null,
        previews: previewRows.map(p => ({ url: p.url })),
        author: mod.author_username ? { username: mod.author_username } : null,
        dependencies: depRows.map(dep => ({
          totalFileSize: dep.file_size,
          asset: {
            id: dep.dependency_mod_id,
            name: dep.dependency_name || dep.dependency_mod_id
          }
        })),
        versions: versionRows.map(v => ({
          versionNumber: v.version_number,
          versionSize: v.version_size,
          releaseDate: v.release_date,
          isCurrent: v.is_current
        })),
        cached_at: mod.cached_at
      };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Error getting cached mod ${modId}:`, error.message);
    return null;
  }
};

// Cache mod data in database
const cacheMod = async (modData) => {
  if (!pool) {
    throw new Error('Database not initialized');
  }

  try {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Insert/update main mod data
      await connection.execute(`
        INSERT INTO mods (
          id, name, summary, author_username, current_version_number, 
          current_version_size, created_at, updated_at, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          summary = VALUES(summary),
          author_username = VALUES(author_username),
          current_version_number = VALUES(current_version_number),
          current_version_size = VALUES(current_version_size),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at),
          cached_at = NOW()
      `, [
        modData.id,
        modData.name || modData.id,
        modData.summary || null,
        modData.author?.username || null,
        modData.currentVersionNumber || null,
        modData.currentVersionSize || null,
        modData.createdAt ? new Date(modData.createdAt) : null,
        modData.updatedAt ? new Date(modData.updatedAt) : null
      ]);

      // Delete existing previews and dependencies
      await connection.execute('DELETE FROM mod_previews WHERE mod_id = ?', [modData.id]);
      await connection.execute('DELETE FROM mod_dependencies WHERE mod_id = ?', [modData.id]);

      // Insert previews
      if (modData.previews && modData.previews.length > 0) {
        for (let i = 0; i < modData.previews.length; i++) {
          const preview = modData.previews[i];
          if (preview.url) {
            await connection.execute(
              'INSERT INTO mod_previews (mod_id, url, preview_order) VALUES (?, ?, ?)',
              [modData.id, preview.url, i]
            );
          }
        }
      }

      // Insert dependencies - try multiple field names
      // Based on Arma Reforger workshop showing "Content Packs", prioritize contentPacks
      let dependencies = null;
      let dependencyFieldName = null;
      const possibleFields = ['contentPacks', 'dependencies', 'requiredAssets', 'requiredDependencies', 'dependencyAssets'];

      for (const field of possibleFields) {
        if (modData[field] && Array.isArray(modData[field]) && modData[field].length > 0) {
          dependencies = modData[field];
          dependencyFieldName = field;
          console.log(`  ℹ️  Using '${field}' as dependencies for mod ${modData.id} (${dependencies.length} items)`);
          break;
        }
      }

      if (dependencies && dependencies.length > 0) {
        for (const dep of dependencies) {
          // Support both nested asset format and direct id/name format
          const depId = dep.asset?.id || dep.id;
          const depName = dep.asset?.name || dep.name;
          const fileSize = dep.totalFileSize || dep.fileSize || null;

          if (depId) {
            await connection.execute(
              'INSERT INTO mod_dependencies (mod_id, dependency_mod_id, dependency_name, file_size) VALUES (?, ?, ?, ?)',
              [modData.id, depId, depName || null, fileSize]
            );
          }
        }
        console.log(`  ✓ Cached ${dependencies.length} dependencies for mod ${modData.id}`);
      }

      // Handle version history - delete existing versions first
      await connection.execute('DELETE FROM mod_versions WHERE mod_id = ?', [modData.id]);

      // Insert version history (if available in modData)
      if (modData.versions && Array.isArray(modData.versions) && modData.versions.length > 0) {
        console.log(`💾 Caching ${modData.versions.length} versions for mod ${modData.id}`);

        for (let i = 0; i < Math.min(modData.versions.length, 5); i++) {
          const version = modData.versions[i];
          // Handle both API response format (version) and our internal format (versionNumber)
          const versionNumber = version.versionNumber || version.version;

          if (versionNumber) {
            try {
              await connection.execute(
                'INSERT INTO mod_versions (mod_id, version_number, version_size, release_date, is_current, version_order) VALUES (?, ?, ?, ?, ?, ?)',
                [
                  modData.id,
                  versionNumber,
                  version.versionSize || version.totalFileSize || null,
                  version.releaseDate || version.createdAt ? new Date(version.releaseDate || version.createdAt) : null,
                  version.isCurrent || i === 0, // First version is current if not specified
                  i
                ]
              );
              console.log(`  ✓ Stored version ${versionNumber} (${i + 1}/${modData.versions.length})`);
            } catch (versionError) {
              console.error(`  ✗ Failed to store version ${versionNumber}:`, versionError.message);
            }
          } else {
            console.warn(`  ⚠️  Skipping version ${i} - no version number`);
          }
        }
      } else if (modData.currentVersionNumber) {
        // If no version history but we have current version, store it
        console.log(`💾 No version history, storing current version: ${modData.currentVersionNumber}`);
        await connection.execute(
          'INSERT INTO mod_versions (mod_id, version_number, version_size, release_date, is_current, version_order) VALUES (?, ?, ?, ?, ?, ?)',
          [
            modData.id,
            modData.currentVersionNumber,
            modData.currentVersionSize || null,
            modData.updatedAt ? new Date(modData.updatedAt) : null,
            true,
            0
          ]
        );
      } else {
        console.log(`⚠️  No versions available for mod ${modData.id}`);
      }

      await connection.commit();
      console.log(`✅ Cached mod ${modData.id} in database`);
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Error caching mod ${modData.id}:`, error.message);
    return false;
  }
};

// Get multiple cached mods - optimized with single query
const getCachedMods = async (modIds) => {
  if (!pool || !modIds || modIds.length === 0) {
    return {};
  }

  try {
    const connection = await pool.getConnection();
    
    try {
      const placeholders = modIds.map(() => '?').join(',');
      
      // Single optimized query with LEFT JOINs to get all data at once including versions
      const [rows] = await connection.execute(`
        SELECT 
          m.id, m.name, m.summary, m.author_username, m.current_version_number, 
          m.current_version_size, m.cached_at,
          p.url as preview_url, p.preview_order,
          d.dependency_mod_id, d.dependency_name, d.file_size as dep_file_size,
          v.version_number, v.version_size, v.release_date, v.is_current, v.version_order
        FROM mods m
        LEFT JOIN mod_previews p ON m.id = p.mod_id
        LEFT JOIN mod_dependencies d ON m.id = d.mod_id
        LEFT JOIN mod_versions v ON m.id = v.mod_id
        WHERE m.id IN (${placeholders})
        ORDER BY m.id, p.preview_order, d.dependency_mod_id, v.version_order
      `, modIds);

      if (rows.length === 0) {
        return {};
      }

      // Process results efficiently
      const result = {};
      
      for (const row of rows) {
        const modId = row.id;
        
        // Initialize mod if not exists
        if (!result[modId]) {
          result[modId] = {
            id: modId,
            name: row.name,
            summary: row.summary || '',
            currentVersionNumber: row.current_version_number || '',
            currentVersionSize: row.current_version_size || null,
            author: row.author_username ? { username: row.author_username } : null,
            previews: [],
            dependencies: [],
            versions: [],
            cached_at: row.cached_at
          };
        }
        
        // Add preview if exists and not already added
        if (row.preview_url && !result[modId].previews.some(p => p.url === row.preview_url)) {
          result[modId].previews.push({ url: row.preview_url });
        }
        
        // Add dependency if exists and not already added
        if (row.dependency_mod_id && !result[modId].dependencies.some(d => d.asset.id === row.dependency_mod_id)) {
          result[modId].dependencies.push({
            totalFileSize: row.dep_file_size,
            asset: {
              id: row.dependency_mod_id,
              name: row.dependency_name || row.dependency_mod_id
            }
          });
        }
        
        // Add version if exists and not already added
        if (row.version_number && !result[modId].versions.some(v => v.versionNumber === row.version_number)) {
          result[modId].versions.push({
            versionNumber: row.version_number,
            versionSize: row.version_size,
            releaseDate: row.release_date,
            isCurrent: row.is_current
          });
        }
      }

      return result;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error getting cached mods:', error.message);
    return {};
  }
};

// CACHE FOREVER: Cache never expires unless manually refreshed
const isCacheExpired = (cachedAt) => {
  // Cache is permanent - never expires
  return false;
};

// Clean expired cache entries - DISABLED for permanent caching
// Only clean entries older than 1 year (effectively never)
const cleanExpiredCache = async () => {
  if (!pool) return;

  try {
    const connection = await pool.getConnection();

    try {
      // Only clean VERY old entries (1 year+) to prevent infinite growth
      const [result] = await connection.execute(
        'DELETE FROM mods WHERE cached_at < DATE_SUB(NOW(), INTERVAL 365 DAY)'
      );

      if (result.affectedRows > 0) {
        console.log(`🧹 Cleaned ${result.affectedRows} very old cache entries (1+ year)`);
      }
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error cleaning expired cache:', error.message);
  }
};

// Get database statistics
const getDatabaseStats = async () => {
  if (!pool) return null;

  try {
    const connection = await pool.getConnection();
    
    try {
      const [modCount] = await connection.execute('SELECT COUNT(*) as count FROM mods');
      const [previewCount] = await connection.execute('SELECT COUNT(*) as count FROM mod_previews');
      const [depCount] = await connection.execute('SELECT COUNT(*) as count FROM mod_dependencies');
      const [versionCount] = await connection.execute('SELECT COUNT(*) as count FROM mod_versions');
      const [recentCache] = await connection.execute(
        'SELECT COUNT(*) as count FROM mods WHERE cached_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)'
      );

      return {
        total_mods: modCount[0].count,
        total_previews: previewCount[0].count,
        total_dependencies: depCount[0].count,
        total_versions: versionCount[0].count,
        recent_cache_entries: recentCache[0].count
      };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error getting database stats:', error.message);
    return null;
  }
};

// Check if a mod's versions need refreshing (older than 1 hour)
const needsVersionRefresh = async (modId) => {
  if (!pool) return false;

  try {
    const connection = await pool.getConnection();

    try {
      // Check if we have ANY versions for this mod and when they were last updated
      const [rows] = await connection.execute(
        'SELECT MAX(created_at) as last_version_update FROM mod_versions WHERE mod_id = ?',
        [modId]
      );

      if (rows.length === 0 || !rows[0].last_version_update) {
        // No versions cached, need refresh
        return true;
      }

      // Check if versions are older than 1 hour
      const lastUpdate = new Date(rows[0].last_version_update);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      return lastUpdate < oneHourAgo;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Error checking version refresh need for ${modId}:`, error.message);
    return false;
  }
};

// Update only versions for a mod (without touching other cached data)
const updateModVersions = async (modId, versions) => {
  if (!pool || !versions || versions.length === 0) {
    return false;
  }

  try {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Delete existing versions
      await connection.execute('DELETE FROM mod_versions WHERE mod_id = ?', [modId]);

      // Insert new versions
      for (let i = 0; i < Math.min(versions.length, 5); i++) {
        const version = versions[i];
        const versionNumber = version.versionNumber || version.version;

        if (versionNumber) {
          await connection.execute(
            'INSERT INTO mod_versions (mod_id, version_number, version_size, release_date, is_current, version_order, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [
              modId,
              versionNumber,
              version.versionSize || version.totalFileSize || null,
              version.releaseDate || version.createdAt ? new Date(version.releaseDate || version.createdAt) : null,
              version.isCurrent || i === 0,
              i
            ]
          );
        }
      }

      await connection.commit();
      console.log(`✅ Refreshed ${versions.length} versions for mod ${modId}`);
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Error updating versions for ${modId}:`, error.message);
    return false;
  }
};

module.exports = {
  initDatabase,
  getCachedMod,
  cacheMod,
  getCachedMods,
  isCacheExpired,
  cleanExpiredCache,
  getDatabaseStats,
  needsVersionRefresh,
  updateModVersions
};