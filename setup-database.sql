-- MariaDB setup script for Arma Mod Manager Cache
-- Run this script as root user to create the database, user, and tables
-- Connect to MariaDB: mysql -u root -p

-- Create database
CREATE DATABASE IF NOT EXISTS armamod_cache 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Create user for the application
-- Allow connections from any host (%) for remote access
CREATE USER IF NOT EXISTS 'armamodmanager'@'%' IDENTIFIED BY '8f255M}T6kpp';

-- Grant permissions on the database
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER ON armamod_cache.* TO 'armamodmanager'@'%';
FLUSH PRIVILEGES;

-- Use the database
USE armamod_cache;

-- Create mods table for storing core mod information
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create mod_previews table for storing preview images
CREATE TABLE IF NOT EXISTS mod_previews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mod_id VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    preview_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE,
    INDEX idx_mod_id (mod_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create mod_dependencies table for storing mod dependencies
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create mod_versions table for storing version history (past 5 versions for mod manager)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Show table structure
SHOW TABLES;
DESCRIBE mods;
DESCRIBE mod_previews;
DESCRIBE mod_dependencies;
DESCRIBE mod_versions;

-- Show user permissions
SHOW GRANTS FOR 'armamodmanager'@'%';

-- Show initial stats
SELECT 'Database setup completed successfully!' as status;
SELECT 'User: armamodmanager' as user_info;
SELECT 'Password: 8f255M}T6kpp' as password_info;
SELECT 'Database: armamod_cache' as database_info;
SELECT 'Host: 64.44.154.74:3306 (or localhost if running on same server)' as host_info;