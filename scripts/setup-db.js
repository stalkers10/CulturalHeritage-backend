require('dotenv').config();
const db = require('../config/db');

function configuredDatabaseHosts() {
  const hosts = [];

  if (process.env.DATABASE_URL) {
    try {
      hosts.push(new URL(process.env.DATABASE_URL).hostname);
    } catch {
      // Ignore malformed URLs here; the database driver will report the real error.
    }
  }

  if (!process.env.DATABASE_URL && process.env.DB_HOST) {
    hosts.push(process.env.DB_HOST);
  }

  return hosts;
}

function isRenderInternalDatabaseHost(host) {
  return /^dpg-[a-z0-9-]+-a$/i.test(host);
}

function printConnectionHint(error) {
  const errorMessage = String(error.message || '');
  const hosts = configuredDatabaseHosts();
  const localConnectionErrors = new Set(['ENOTFOUND', 'EACCES', 'ETIMEDOUT', 'ECONNREFUSED']);
  const referencesInternalRenderHost = hosts.some(isRenderInternalDatabaseHost) ||
    /dpg-[a-z0-9-]+-a(?!\.)/i.test(errorMessage);

  if (localConnectionErrors.has(error.code) && referencesInternalRenderHost) {
    console.error(
      'That database host is Render-internal, so it only works from a Render service.'
    );
    console.error(
      'Deploy the backend and let Render run setup:db, or use the database External Database URL in your local .env.'
    );
  }
}

async function setupDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      fullname VARCHAR(255) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(500) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'user',
      avatar_url VARCHAR(500) NULL,
      phone VARCHAR(50) NULL,
      location VARCHAR(120) NULL,
      bio TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS otps (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      code VARCHAR(10) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS contributions (
      id SERIAL PRIMARY KEY,
      tribe VARCHAR(255) NOT NULL,
      story TEXT NOT NULL,
      media_type VARCHAR(20) NOT NULL DEFAULT 'none',
      status VARCHAR(20) NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS contribution_media (
      id SERIAL PRIMARY KEY,
      contribution_id INT NOT NULL,
      media_url VARCHAR(500) NOT NULL,
      media_name VARCHAR(255) NULL,
      media_mime_type VARCHAR(100) NULL,
      FOREIGN KEY (contribution_id) REFERENCES contributions(id) ON DELETE CASCADE
    )
  `);

  console.log('Core tables ready.');
}

setupDatabase()
  .then(() => db.end())
  .catch(async (error) => {
    console.error('Database setup failed:', error.message);
    printConnectionHint(error);
    await db.end().catch(() => {});
    process.exitCode = 1;
  });
