require('dotenv').config();

const db = require('../config/db');

const settings = [
  ['appTitle', 'Heritage & Horizon'],
  ['searchPlaceholder', 'Search regions, traditions...'],
  ['profileImageUrl', '/images/face1.png']
];

const sections = [
  ['hero', null, 'Explore the Soul of Cameroon', 'Search cultural places, people, food, music, and regional memory.', null, null, 'hero', 1, 1],
  ['categories', null, 'Discover Categories', 'Browse living culture by theme and practice.', null, null, 'categories', 2, 1],
  ['spotlight', 'Featured Heritage', 'Regional Highlights', 'Places and traditions currently highlighted by the system.', 'View Maps', '/tabs/explore', 'spotlight', 3, 1]
];

const items = [
  {
    sectionKey: 'hero',
    eyebrow: 'Cameroon Heritage',
    title: 'Living cultural landscape',
    subtitle: 'National archive',
    description: 'A system-curated path through regions, traditions, memories, and cultural contributions.',
    meta: 'Cameroon',
    imageUrl: '/images/mountain.png',
    icon: null,
    actionLabel: null,
    actionRoute: null,
    sortOrder: 1,
    isActive: 1
  },
  {
    sectionKey: 'categories',
    eyebrow: 'Preservation',
    title: 'Ethnic Groups',
    subtitle: 'People and memory',
    description: 'Discover the history of communities, lineages, symbols, and oral traditions preserved across Cameroon.',
    meta: 'Cultural identity',
    imageUrl: '/images/bami.png',
    icon: 'groups',
    actionLabel: null,
    actionRoute: null,
    sortOrder: 1,
    isActive: 1
  },
  {
    sectionKey: 'categories',
    eyebrow: 'Culinary',
    title: 'Cuisine',
    subtitle: 'Food heritage',
    description: 'Explore meals, ingredients, and food customs carried through homes, festivals, and markets.',
    meta: 'Taste and ritual',
    imageUrl: '/images/plantainwithsource.png',
    icon: 'restaurant',
    actionLabel: null,
    actionRoute: null,
    sortOrder: 2,
    isActive: 1
  },
  {
    sectionKey: 'categories',
    eyebrow: 'Rhythm',
    title: 'Traditional Music',
    subtitle: 'Sound and ceremony',
    description: 'Listen through drums, songs, dances, and ceremonial rhythms kept alive by communities.',
    meta: 'Sound archive',
    imageUrl: '/images/tamtam.png',
    icon: 'play_arrow',
    actionLabel: 'Listen Now',
    actionRoute: null,
    sortOrder: 3,
    isActive: 1
  },
  {
    sectionKey: 'categories',
    eyebrow: 'Artisanship',
    title: 'Handicrafts',
    subtitle: 'Made by hand',
    description: 'Follow beadwork, pottery, textile weaving, mask carving, and the craft knowledge behind them.',
    meta: 'Craft legacy',
    imageUrl: '/images/tissue.png',
    icon: 'palette',
    actionLabel: null,
    actionRoute: null,
    sortOrder: 4,
    isActive: 1
  },
  {
    sectionKey: 'spotlight',
    eyebrow: null,
    title: 'Southwest Region',
    subtitle: 'Buea, Mount Cameroon',
    description: 'Mountain memory, coastal crossings, and living traditions around the volcanic highlands.',
    meta: 'Buea, Mount Cameroon',
    imageUrl: '/images/mountain.png',
    icon: 'location_on',
    actionLabel: null,
    actionRoute: null,
    sortOrder: 1,
    isActive: 1
  },
  {
    sectionKey: 'spotlight',
    eyebrow: null,
    title: 'West Region',
    subtitle: 'Foumban Royal Palace',
    description: 'Royal architecture, symbols, archives, and craft traditions from the Grassfields.',
    meta: 'Foumban Royal Palace',
    imageUrl: '/images/house.png',
    icon: 'location_on',
    actionLabel: null,
    actionRoute: null,
    sortOrder: 2,
    isActive: 1
  },
  {
    sectionKey: 'spotlight',
    eyebrow: null,
    title: 'South Region',
    subtitle: 'Kribi Seaside Heritage',
    description: 'Coastal heritage, shoreline memory, and stories shaped by the Atlantic edge.',
    meta: 'Kribi Seaside Heritage',
    imageUrl: '/images/plage.png',
    icon: 'location_on',
    actionLabel: null,
    actionRoute: null,
    sortOrder: 3,
    isActive: 1
  }
];

async function seedExplorePage() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS explore_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS explore_sections (
      id SERIAL PRIMARY KEY,
      section_key VARCHAR(100) NOT NULL UNIQUE,
      eyebrow VARCHAR(100) NULL,
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
    CREATE TABLE IF NOT EXISTS explore_items (
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

  await db.query('CREATE INDEX IF NOT EXISTS idx_explore_items_section ON explore_items (section_key, sort_order)');

  for (const setting of settings) {
    await db.query(
      `INSERT INTO explore_settings (setting_key, setting_value)
       VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
      setting
    );
  }

  for (const section of sections) {
    await db.query(
      `INSERT INTO explore_sections
         (section_key, eyebrow, title, subtitle, action_label, action_route, layout, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (section_key) DO UPDATE SET
         eyebrow = EXCLUDED.eyebrow,
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
      `INSERT INTO explore_items
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

seedExplorePage()
  .then(async () => {
    await db.end();
    console.log('Explore page database content seeded.');
  })
  .catch(async (error) => {
    console.error('Failed to seed explore page content:', error.message);
    await db.end().catch(() => {});
    process.exitCode = 1;
  });
