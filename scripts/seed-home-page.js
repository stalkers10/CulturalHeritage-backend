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
  await db.execute(`
    CREATE TABLE IF NOT EXISTS home_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS home_sections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      section_key VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL,
      subtitle VARCHAR(255) NULL,
      action_label VARCHAR(100) NULL,
      action_route VARCHAR(255) NULL,
      layout VARCHAR(50) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS home_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
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
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_home_item (section_key, title),
      INDEX idx_home_items_section (section_key, sort_order)
    )
  `);

  for (const setting of settings) {
    await db.execute(
      `INSERT INTO home_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      setting
    );
  }

  for (const section of sections) {
    await db.execute(
      `INSERT INTO home_sections
         (section_key, title, subtitle, action_label, action_route, layout, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         subtitle = VALUES(subtitle),
         action_label = VALUES(action_label),
         action_route = VALUES(action_route),
         layout = VALUES(layout),
         sort_order = VALUES(sort_order),
         is_active = VALUES(is_active)`,
      section
    );
  }

  for (const item of items) {
    await db.execute(
      `INSERT INTO home_items
         (section_key, eyebrow, title, subtitle, description, meta, image_url, icon,
          action_label, action_route, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         eyebrow = VALUES(eyebrow),
         subtitle = VALUES(subtitle),
         description = VALUES(description),
         meta = VALUES(meta),
         image_url = VALUES(image_url),
         icon = VALUES(icon),
         action_label = VALUES(action_label),
         action_route = VALUES(action_route),
         sort_order = VALUES(sort_order),
         is_active = VALUES(is_active)`,
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
