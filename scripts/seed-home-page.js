require('dotenv').config();

const db = require('../config/db');

const settings = [
  ['appTitle', 'Heritage & Horizon'],
  ['searchPlaceholder', 'Search cultural legacies...'],
  ['profileImageUrl', '/images/face1.png']
];

const sections = [
  ['featured', '', null, null, null, 'hero', 1, 1],
  ['trending', 'Trending Now', null, 'View All', '/tabs/explore', 'rail', 2, 1],
  ['recommended', 'Recommended for You', null, null, null, 'grid', 3, 1]
];

const items = [
  {
    sectionKey: 'featured',
    eyebrow: 'Featured Legacy',
    title: 'Bamileke people',
    subtitle: 'Sacred grassfields',
    description: 'The keepers of the sacred grassfields and the legendary Elephant dance.',
    meta: 'West Region',
    imageUrl: '/images/bami.png',
    icon: null,
    actionLabel: 'Explore History',
    actionRoute: '/tabs/explore',
    sortOrder: 1,
    isActive: 1
  },
  {
    sectionKey: 'trending',
    eyebrow: null,
    title: 'Tikar Beadwork',
    subtitle: 'Central Region',
    description: 'Traditional bead artistry preserved through symbols, color, and royal identity.',
    meta: 'Central Region - Artistry',
    imageUrl: '/images/paigne.png',
    icon: 'bookmark',
    actionLabel: null,
    actionRoute: '/tabs/explore',
    sortOrder: 1,
    isActive: 1
  },
  {
    sectionKey: 'trending',
    eyebrow: null,
    title: 'Foumban Palace',
    subtitle: 'West Region',
    description: 'A landmark of Bamoun royal memory and architectural heritage.',
    meta: 'West Region - Landmark',
    imageUrl: '/images/house.png',
    icon: 'bookmark',
    actionLabel: null,
    actionRoute: '/tabs/explore',
    sortOrder: 2,
    isActive: 1
  },
  {
    sectionKey: 'trending',
    eyebrow: null,
    title: 'Buea Highlands',
    subtitle: 'South West',
    description: 'Mountain landscapes, oral traditions, and living communities around Mount Cameroon.',
    meta: 'South West - Nature',
    imageUrl: '/images/mountain.png',
    icon: 'bookmark',
    actionLabel: null,
    actionRoute: '/tabs/explore',
    sortOrder: 3,
    isActive: 1
  },
  {
    sectionKey: 'recommended',
    eyebrow: 'Ritual Textiles',
    title: 'Sacred Ndop Weaving',
    subtitle: 'North-West',
    description: 'Discover the secret language hidden within the blue and white patterns of the North-West.',
    meta: null,
    imageUrl: '/images/tissue.png',
    icon: null,
    actionLabel: null,
    actionRoute: '/tabs/explore',
    sortOrder: 1,
    isActive: 1
  },
  {
    sectionKey: 'recommended',
    eyebrow: null,
    title: 'Makossa Rhythms',
    subtitle: 'Douala',
    description: 'The urban pulse of Douala that carried Cameroonian sound across the world.',
    meta: null,
    imageUrl: null,
    icon: 'music_note',
    actionLabel: null,
    actionRoute: '/tabs/explore',
    sortOrder: 2,
    isActive: 1
  },
  {
    sectionKey: 'recommended',
    eyebrow: null,
    title: 'Taste of Achu',
    subtitle: 'Grassfields',
    description: 'A spicy yellow journey through one of the Grassfields signature meals.',
    meta: null,
    imageUrl: null,
    icon: 'restaurant',
    actionLabel: null,
    actionRoute: '/tabs/explore',
    sortOrder: 3,
    isActive: 1
  }
];

async function seedHomePage() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS home_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS home_sections (
      id SERIAL PRIMARY KEY,
      section_key VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL,
      subtitle VARCHAR(255) NULL,
      action_label VARCHAR(100) NULL,
      action_route VARCHAR(255) NULL,
      layout VARCHAR(50) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active SMALLINT NOT NULL DEFAULT 1
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS home_items (
      id SERIAL PRIMARY KEY,
      section_key VARCHAR(100) NOT NULL,
      eyebrow VARCHAR(100) NULL,
      title VARCHAR(255) NOT NULL,
      subtitle VARCHAR(255) NULL,
      description TEXT NULL,
      meta VARCHAR(255) NULL,
      image_url VARCHAR(500) NULL,
      icon VARCHAR(100) NULL,
      action_label VARCHAR(100) NULL,
      action_route VARCHAR(255) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active SMALLINT NOT NULL DEFAULT 1,
      UNIQUE (section_key, title)
    )
  `);

  await db.query('CREATE INDEX IF NOT EXISTS idx_home_items_section ON home_items (section_key, sort_order)');

  for (const setting of settings) {
    await db.query(
      `INSERT INTO home_settings (setting_key, setting_value)
       VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
      setting
    );
  }

  for (const section of sections) {
    await db.query(
      `INSERT INTO home_sections
         (section_key, title, subtitle, action_label, action_route, layout, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (section_key) DO UPDATE SET
         title = EXCLUDED.title,
         subtitle = EXCLUDED.subtitle,
         action_label = EXCLUDED.action_label,
         action_route = EXCLUDED.action_route,
         layout = EXCLUDED.layout,
         sort_order = EXCLUDED.sort_order,
         is_active = EXCLUDED.is_active`,
      section
    );
  }

  for (const item of items) {
    await db.query(
      `INSERT INTO home_items
         (section_key, eyebrow, title, subtitle, description, meta, image_url, icon,
          action_label, action_route, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (section_key, title) DO UPDATE SET
         eyebrow = EXCLUDED.eyebrow,
         subtitle = EXCLUDED.subtitle,
         description = EXCLUDED.description,
         meta = EXCLUDED.meta,
         image_url = EXCLUDED.image_url,
         icon = EXCLUDED.icon,
         action_label = EXCLUDED.action_label,
         action_route = EXCLUDED.action_route,
         sort_order = EXCLUDED.sort_order,
         is_active = EXCLUDED.is_active`,
      [
        item.sectionKey,
        item.eyebrow,
        item.title,
        item.subtitle,
        item.description,
        item.meta,
        item.imageUrl,
        item.icon,
        item.actionLabel,
        item.actionRoute,
        item.sortOrder,
        item.isActive
      ]
    );
  }
}

seedHomePage()
  .then(async () => {
    await db.end();
    console.log('Home page database content seeded.');
  })
  .catch(async (error) => {
    console.error('Failed to seed home page content:', error.message);
    await db.end().catch(() => {});
    process.exitCode = 1;
  });
