require('dotenv').config();

const db = require('../config/db');

const events = [
  {
    title: 'Ngondo Waterside Ceremony',
    category: 'Ceremony',
    region: 'Littoral',
    city: 'Douala',
    venue: 'Wouri River banks',
    description: 'A gathering around Sawa memory, river rituals, music, canoe displays, and community storytelling.',
    daysFromNow: 8,
    durationHours: 5,
    imageUrl: '/images/plage.png',
    organizer: 'Sawa Cultural Council',
    priceLabel: 'Free entry',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Wouri%20River%20Douala%20Cameroon',
    isFeatured: 1
  },
  {
    title: 'Foumban Royal Craft Exhibition',
    category: 'Exhibition',
    region: 'West',
    city: 'Foumban',
    venue: 'Royal Palace Museum',
    description: 'An exhibition of royal craft, beadwork, sculpture, palace memory, and Bamoun visual heritage.',
    daysFromNow: 14,
    durationHours: 7,
    imageUrl: '/images/house.png',
    organizer: 'Foumban Heritage Office',
    priceLabel: 'Museum pass',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Foumban%20Royal%20Palace',
    isFeatured: 0
  },
  {
    title: 'Grassfields Drum Workshop',
    category: 'Workshop',
    region: 'North-West',
    city: 'Bamenda',
    venue: 'Community Arts Center',
    description: 'Hands-on rhythm lessons, drum history, and performance practice led by local musicians.',
    daysFromNow: 21,
    durationHours: 3,
    imageUrl: '/images/tamtam.png',
    organizer: 'Grassfields Arts Collective',
    priceLabel: 'Registration required',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Bamenda%20Community%20Arts%20Center',
    isFeatured: 0
  },
  {
    title: 'Achu and Ndole Food Memory Day',
    category: 'Festival',
    region: 'Centre',
    city: 'Yaounde',
    venue: 'National Museum Garden',
    description: 'A food heritage day with cooking stories, family recipes, tastings, and intergenerational exchange.',
    daysFromNow: 30,
    durationHours: 6,
    imageUrl: '/images/plantainwithsource.png',
    organizer: 'Heritage Kitchens Cameroon',
    priceLabel: 'Tickets at gate',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=National%20Museum%20Yaounde',
    isFeatured: 0
  },
  {
    title: 'Mount Cameroon Oral History Walk',
    category: 'Tour',
    region: 'South-West',
    city: 'Buea',
    venue: 'Buea Mountain Trail',
    description: 'A guided cultural walk connecting landscape, Bakweri memory, mountain stories, and preservation.',
    daysFromNow: 42,
    durationHours: 4,
    imageUrl: '/images/mountain.png',
    organizer: 'Buea Heritage Guides',
    priceLabel: 'Limited seats',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Mount%20Cameroon%20Buea',
    isFeatured: 0
  }
];

async function seedEventsPage() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL UNIQUE,
      category VARCHAR(100) NOT NULL,
      region VARCHAR(100) NOT NULL,
      city VARCHAR(100) NOT NULL,
      venue VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      event_date TIMESTAMP NOT NULL,
      end_date TIMESTAMP NULL,
      image_url VARCHAR(500) NULL,
      organizer VARCHAR(255) NULL,
      price_label VARCHAR(100) NULL,
      map_url VARCHAR(500) NULL,
      is_featured SMALLINT NOT NULL DEFAULT 0,
      is_active SMALLINT NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL DEFAULT 'Approved',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query('CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_events_category ON events (category)');

  const { rows: statusColumns } = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'status'"
  );

  if (statusColumns.length === 0) {
    await db.query("ALTER TABLE events ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Approved'");
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS event_reminders (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      event_id INT NOT NULL,
      remind_at TIMESTAMP NOT NULL,
      reminder_offset_minutes INT NOT NULL,
      notification_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, event_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    )
  `);

  await db.query('CREATE INDEX IF NOT EXISTS idx_event_reminders_user ON event_reminders (user_id, remind_at)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_event_reminders_event ON event_reminders (event_id)');

  for (const event of events) {
    const daysFromNow = Number(event.daysFromNow);
    const durationHours = Number(event.durationHours);

    await db.query(
      `INSERT INTO events
         (title, category, region, city, venue, description, event_date, end_date,
          image_url, organizer, price_label, map_url, is_featured, is_active, status)
       VALUES ($1, $2, $3, $4, $5, $6,
               NOW() + INTERVAL '${daysFromNow} days',
               NOW() + INTERVAL '${daysFromNow} days' + INTERVAL '${durationHours} hours',
               $7, $8, $9, $10, $11, 1, 'Approved')
       ON CONFLICT (title) DO UPDATE SET
         category = EXCLUDED.category,
         region = EXCLUDED.region,
         city = EXCLUDED.city,
         venue = EXCLUDED.venue,
         description = EXCLUDED.description,
         event_date = EXCLUDED.event_date,
         end_date = EXCLUDED.end_date,
         image_url = EXCLUDED.image_url,
         organizer = EXCLUDED.organizer,
         price_label = EXCLUDED.price_label,
         map_url = EXCLUDED.map_url,
         is_featured = EXCLUDED.is_featured,
         is_active = EXCLUDED.is_active,
         status = EXCLUDED.status`,
      [
        event.title,
        event.category,
        event.region,
        event.city,
        event.venue,
        event.description,
        event.imageUrl,
        event.organizer,
        event.priceLabel,
        event.mapUrl,
        event.isFeatured
      ]
    );
  }
}

seedEventsPage()
  .then(async () => {
    await db.end();
    console.log('Events page database content seeded.');
  })
  .catch(async (error) => {
    console.error('Failed to seed events page content:', error.message);
    await db.end().catch(() => {});
    process.exitCode = 1;
  });
