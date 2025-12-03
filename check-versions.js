// Quick script to check versions in database
const mysql = require('mysql2/promise');

const dbConfig = {
  host: '64.44.154.74',
  port: 3306,
  user: 'armamodmanager',
  password: '8f255M}T6kpp',
  database: 'armamod_cache'
};

async function checkVersions() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    // Get a sample mod ID from the database
    const [mods] = await connection.execute('SELECT id FROM mods LIMIT 5');

    console.log('Checking version counts for mods:\n');

    for (const mod of mods) {
      const [versions] = await connection.execute(
        'SELECT version_number, is_current, version_order FROM mod_versions WHERE mod_id = ? ORDER BY version_order',
        [mod.id]
      );

      console.log(`Mod ${mod.id}:`);
      console.log(`  Total versions in DB: ${versions.length}`);

      if (versions.length > 0) {
        versions.forEach((v, i) => {
          console.log(`    ${i + 1}. v${v.version_number} (order: ${v.version_order}, current: ${v.is_current})`);
        });
      } else {
        console.log('    No versions found!');
      }
      console.log('');
    }
  } finally {
    await connection.end();
  }
}

checkVersions().catch(console.error);
