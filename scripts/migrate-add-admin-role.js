require('dotenv').config();

const db = require('../config/db');

async function migrateAdminRole() {
  try {
    await db.execute(`
      ALTER TABLE users
      ADD COLUMN role ENUM('user', 'admin') NOT NULL DEFAULT 'user'
    `);
    console.log('Added role column to users table.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('role column already exists — skipping.');
    } else {
      throw err;
    }
  }
}

migrateAdminRole()
  .then(async () => {
    await db.end();
    console.log('Done. To make a user admin run:');
    console.log("  UPDATE users SET role = 'admin' WHERE email = 'your@email.com';");
  })
  .catch(async (err) => {
    console.error('Migration failed:', err.message);
    await db.end().catch(() => {});
    process.exitCode = 1;
  });