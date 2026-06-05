require('dotenv').config();

const db = require('../config/db');
const fs = require('fs').promises;
const path = require('path');

const mediaStorePath = path.join(__dirname, '..', 'data', 'contribution-media.json');

async function migrateMediaToDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contribution_media (
      contribution_id INT PRIMARY KEY,
      media_url VARCHAR(500) NOT NULL,
      media_name VARCHAR(100) NULL,
      media_mime_type VARCHAR(100) NOT NULL,
      FOREIGN KEY (contribution_id) REFERENCES contributions(id) ON DELETE CASCADE
    )
  `);
  console.log('contribution_media table ready.');

  let store = {};
  try {
    const contents = await fs.readFile(mediaStorePath, 'utf8');
    store = JSON.parse(contents);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('No contribution-media.json found — nothing to migrate.');
    return;
  }

  const entries = Object.entries(store);
  if (entries.length === 0) {
    console.log('contribution-media.json is empty — nothing to migrate.');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  for (const [id, media] of entries) {
    try {
      await db.execute(
        `INSERT IGNORE INTO contribution_media (contribution_id, media_url, media_name, media_mime_type)
         VALUES (?, ?, ?, ?)`,
        [Number(id), media.media_url, media.media_name || null, media.media_mime_type]
      );
      migrated++;
    } catch (error) {
      console.warn(`Skipped contribution ${id}: ${error.message}`);
      skipped++;
    }
  }

  console.log(`Migrated ${migrated} media record(s), skipped ${skipped}.`);
}

migrateMediaToDb()
  .then(async () => {
    await db.end();
    console.log('Migration complete.');
  })
  .catch(async (error) => {
    console.error('Migration failed:', error.message);
    await db.end().catch(() => {});
    process.exitCode = 1;
  });
