var express = require('express');
var router = express.Router();
const db = require('../config/db');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const OTP_TTL_MS = 4 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_KEY_LENGTH = 32;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'heritage-dev-session-secret';
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
const { v2: cloudinary } = require('cloudinary');
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || 'cultural-heritage';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, 'sha256')
    .toString('hex');

  return `pbkdf2$sha256$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function isHashedPassword(storedPassword) {
  return typeof storedPassword === 'string' && storedPassword.startsWith('pbkdf2$sha256$');
}

function verifyPassword(password, storedPassword) {
  if (!isHashedPassword(storedPassword)) {
    return password === storedPassword;
  }

  const parts = storedPassword.split('$');

  if (parts.length !== 5) {
    return false;
  }

  const iterations = Number(parts[2]);
  const salt = parts[3];
  const expectedHash = parts[4];

  if (!Number.isInteger(iterations) || iterations <= 0 || !salt || !expectedHash) {
    return false;
  }

  try {
    const calculatedHash = crypto
      .pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, 'sha256')
      .toString('hex');
    const calculatedBuffer = Buffer.from(calculatedHash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    return calculatedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(calculatedBuffer, expectedBuffer);
  } catch (error) {
    return false;
  }
}

function safeTextEqual(value, expected) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return valueBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function createAuthToken(user) {
  const payload = {
    sub: String(user.id),
    email: user.email,
    name: user.fullName,
    role: user.role || 'user',
    exp: Date.now() + SESSION_TTL_MS
  };
  const payloadText = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadText)
    .digest('base64url');

  return `${payloadText}.${signature}`;
}

function verifyAuthToken(token) {
  const [payloadText, signature] = String(token || '').split('.');

  if (!payloadText || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadText)
    .digest('base64url');

  if (!safeTextEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));

    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const authUser = match ? verifyAuthToken(match[1]) : null;

  if (!authUser) {
    return res.status(401).json({
      status: 'error',
      message: 'Please login before continuing'
    });
  }

  req.authUser = authUser;
  next();
}

function buildAuthResponse(user) {
  return {
    token: createAuthToken(user),
    user: {
      id: String(user.id),
      email: user.email,
      name: user.fullName,
      role: user.role || 'user',
      avatarUrl: user.avatar_url || null
    }
  };
}

function requireAdmin(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const authUser = match ? verifyAuthToken(match[1]) : null;

  if (!authUser) {
    return res.status(401).json({ status: 'error', message: 'Please login before continuing' });
  }

  if (authUser.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin access required' });
  }

  req.authUser = authUser;
  next();
}

let userProfileColumnsPromise = null;

async function ensureUserProfileColumns() {
  if (!userProfileColumnsPromise) {
    userProfileColumnsPromise = (async () => {
      const columns = [
        ['avatar_url', 'VARCHAR(500) NULL'],
        ['phone', 'VARCHAR(50) NULL'],
        ['location', 'VARCHAR(120) NULL'],
        ['bio', 'TEXT NULL']
      ];

      for (const [columnName, definition] of columns) {
        const { rows } = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = $1`,
          [columnName]
        );

        if (rows.length === 0) {
          try {
            await db.query(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
          } catch (error) {
            if (error.code !== '42701') {
              throw error;
            }
          }
        }
      }
    })().catch((error) => {
      userProfileColumnsPromise = null;
      throw error;
    });
  }

  return userProfileColumnsPromise;
}

let eventsModerationColumnsPromise = null;

async function ensureEventsModerationColumns() {
  if (!eventsModerationColumnsPromise) {
    eventsModerationColumnsPromise = (async () => {
      const { rows: statusColumns } = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'status'`
      );

      if (statusColumns.length === 0) {
        try {
          await db.query("ALTER TABLE events ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Approved'");
        } catch (error) {
          if (error.code !== '42701') {
            throw error;
          }
        }
      }
    })().catch((error) => {
      eventsModerationColumnsPromise = null;
      throw error;
    });
  }

  return eventsModerationColumnsPromise;
}

let exploreMediaColumnsPromise = null;

async function ensureExploreMediaColumns() {
  if (!exploreMediaColumnsPromise) {
    exploreMediaColumnsPromise = (async () => {
      const columns = [
        ['media_url', 'VARCHAR(500) NULL'],
        ['media_type', 'VARCHAR(20) NULL']
      ];
      for (const [columnName, definition] of columns) {
        const { rows } = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'explore_items' AND column_name = $1`,
          [columnName]
        );
        if (rows.length === 0) {
          try {
            await db.query(`ALTER TABLE explore_items ADD COLUMN ${columnName} ${definition}`);
          } catch (error) {
            if (error.code !== '42701') throw error;
          }
        }
      }
    })().catch((error) => {
      exploreMediaColumnsPromise = null;
      throw error;
    });
  }
  return exploreMediaColumnsPromise;
}

let savedHomeItemsTablePromise = null;

async function ensureSavedHomeItemsTable() {
  if (!savedHomeItemsTablePromise) {
    savedHomeItemsTablePromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS user_saved_home_items (
          id SERIAL PRIMARY KEY,
          user_id INT NOT NULL,
          home_item_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, home_item_id)
        )
      `);
      await db.query('CREATE INDEX IF NOT EXISTS idx_saved_home_items_user ON user_saved_home_items (user_id, created_at)');
      await db.query('CREATE INDEX IF NOT EXISTS idx_saved_home_items_item ON user_saved_home_items (home_item_id)');
    })().catch((error) => {
      savedHomeItemsTablePromise = null;
      throw error;
    });
  }

  return savedHomeItemsTablePromise;
}

function mapUserProfile(user, stats = {}) {
  return {
    id: String(user.id),
    email: user.email,
    name: user.fullName,
    avatarUrl: user.avatar_url || null,
    phone: user.phone || '',
    location: user.location || '',
    bio: user.bio || '',
    stats: {
      contributionCount: Number(stats.contributionCount || 0),
      approvedContributionCount: Number(stats.approvedContributionCount || 0),
      reminderCount: Number(stats.reminderCount || 0),
      upcomingReminderCount: Number(stats.upcomingReminderCount || 0),
      savedItemCount: Number(stats.savedItemCount || 0)
    }
  };
}

async function getProfileStats(userId) {
  const stats = {
    contributionCount: 0,
    approvedContributionCount: 0,
    reminderCount: 0,
    upcomingReminderCount: 0,
    savedItemCount: 0
  };

  try {
    const { rows: contributionRows } = await db.query(
      `SELECT COUNT(*)::int AS "contributionCount",
              COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0)::int AS "approvedContributionCount"
       FROM contributions`
    );

    stats.contributionCount = contributionRows[0]?.contributionCount || 0;
    stats.approvedContributionCount = contributionRows[0]?.approvedContributionCount || 0;
  } catch (error) {
    if (error.code !== '42P01') {
      throw error;
    }
  }

  try {
    const { rows: reminderRows } = await db.query(
      `SELECT COUNT(*)::int AS "reminderCount",
              COALESCE(SUM(CASE WHEN remind_at > NOW() THEN 1 ELSE 0 END), 0)::int AS "upcomingReminderCount"
       FROM event_reminders
       WHERE user_id = $1`,
      [userId]
    );

    stats.reminderCount = reminderRows[0]?.reminderCount || 0;
    stats.upcomingReminderCount = reminderRows[0]?.upcomingReminderCount || 0;
  } catch (error) {
    if (error.code !== '42P01') {
      throw error;
    }
  }

  try {
    await ensureSavedHomeItemsTable();

    const { rows: savedRows } = await db.query(
      'SELECT COUNT(*)::int AS "savedItemCount" FROM user_saved_home_items WHERE user_id = $1',
      [userId]
    );

    stats.savedItemCount = savedRows[0]?.savedItemCount || 0;
  } catch (error) {
    if (error.code !== '42P01') {
      throw error;
    }
  }

  return stats;
}

function sanitizeFileName(fileName) {
  return String(fileName || 'upload')
    .replace(/[^a-z0-9._-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'audio/wav') return '.wav';
  if (mimeType === 'video/webm') return '.webm';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType && mimeType.startsWith('image/')) return '.jpg';
  return '.bin';
}

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function cloudinaryResourceType(mediaType) {
  return mediaType === 'photo' ? 'image' : 'video';
}

async function uploadMediaToCloudinary({ base64Data, mimeType, mediaType }) {
  const dataUri = `data:${mimeType};base64,${base64Data}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: CLOUDINARY_FOLDER,
      resource_type: cloudinaryResourceType(mediaType),
      overwrite: false
    });

    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload failed:', error.message);
    throw new Error('Could not upload media. Please try again.');
  }
}

async function saveMediaToLocalUploads({ buffer, mimeType }) {
  await fs.mkdir(uploadDir, { recursive: true });

  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extensionForMimeType(mimeType)}`;
  const filePath = path.join(uploadDir, storedName);

  await fs.writeFile(filePath, buffer);

  return `/uploads/${storedName}`;
}

async function saveContributionMedia({ mediaData, mediaName, mediaMimeType, mediaType }) {
  if (!mediaData) {
    return null;
  }

  const allowedTypes = ['photo', 'audio', 'video'];

  if (!allowedTypes.includes(mediaType)) {
    throw new Error('Unsupported media type');
  }

  const dataMatch = String(mediaData).match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = dataMatch ? dataMatch[1] : String(mediaMimeType || 'application/octet-stream');
  const base64Data = dataMatch ? dataMatch[2] : String(mediaData);

  if (mediaType === 'photo' && !mimeType.startsWith('image/')) {
    throw new Error('Photo uploads must be image files');
  }

  if (mediaType === 'audio' && !mimeType.startsWith('audio/')) {
    throw new Error('Audio uploads must be audio files');
  }

  if (mediaType === 'video' && !mimeType.startsWith('video/')) {
    throw new Error('Video uploads must be video files');
  }

  const buffer = Buffer.from(base64Data, 'base64');

  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new Error('Media files must be 8 MB or smaller');
  }

  if (!hasCloudinaryConfig() && process.env.NODE_ENV === 'production') {
    throw new Error('Cloudinary is not configured on the server');
  }

  const mediaUrl = hasCloudinaryConfig()
    ? await uploadMediaToCloudinary({ base64Data, mimeType, mediaType })
    : await saveMediaToLocalUploads({ buffer, mimeType });

  return {
    media_url: mediaUrl,
    media_name: sanitizeFileName(mediaName),
    media_mime_type: mimeType
  };
}

function mapHomeItem(row) {
  return {
    id: Number(row.id),
    sectionKey: row.section_key,
    eyebrow: row.eyebrow,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    meta: row.meta,
    imageUrl: row.image_url,
    icon: row.icon,
    actionLabel: row.action_label,
    actionRoute: row.action_route,
    sortOrder: Number(row.sort_order)
  };
}

function mapSavedHomeItem(row) {
  return {
    ...mapHomeItem(row),
    savedAt: row.saved_at
  };
}

function mapExploreItem(row) {
  return {
    id: Number(row.id),
    sectionKey: row.section_key,
    eyebrow: row.eyebrow,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    meta: row.meta,
    imageUrl: row.image_url,
    mediaUrl: row.media_url || null,
    mediaType: row.media_type || null,
    icon: row.icon,
    actionLabel: row.action_label,
    actionRoute: row.action_route,
    sortOrder: Number(row.sort_order)
  };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    title: row.title,
    category: row.category,
    region: row.region,
    city: row.city,
    venue: row.venue,
    description: row.description,
    eventDate: row.event_date,
    endDate: row.end_date,
    imageUrl: row.image_url,
    organizer: row.organizer,
    priceLabel: row.price_label,
    mapUrl: row.map_url,
    isFeatured: Boolean(row.is_featured)
  };
}

function mapEventReminder(row) {
  return {
    id: Number(row.id),
    eventId: Number(row.event_id),
    remindAt: row.remind_at,
    reminderOffsetMinutes: Number(row.reminder_offset_minutes),
    notificationId: Number(row.notification_id),
    eventTitle: row.event_title,
    eventDate: row.event_date
  };
}

function getHomeMissingTablesResponse(res) {
  return res.status(500).json({
    status: 'error',
    message: 'Home page database tables are missing. Run npm run seed:home in the backend folder.'
  });
}

function getExploreMissingTablesResponse(res) {
  return res.status(500).json({
    status: 'error',
    message: 'Explore page database tables are missing. Run npm run seed:explore in the backend folder.'
  });
}

function getEventsMissingTablesResponse(res) {
  return res.status(500).json({
    status: 'error',
    message: 'Events database tables are missing. Run npm run seed:events in the backend folder.'
  });
}

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

/* GET test data. */
router.get('/api/test', function(req, res, next) {
  res.json({ message: 'Hello from the backend!', status: 'success' });
});

/* GET database-backed home page content. */
router.get('/api/home', async function(req, res, next) {
  try {
    const { rows: settingRows } = await db.query(
      'SELECT setting_key, setting_value FROM home_settings ORDER BY setting_key'
    );
    const { rows: sectionRows } = await db.query(
      `SELECT section_key, title, subtitle, action_label, action_route, layout, sort_order
       FROM home_sections
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    const { rows: itemRows } = await db.query(
      `SELECT id, section_key, eyebrow, title, subtitle, description, meta, image_url, icon,
              action_label, action_route, sort_order
       FROM home_items
       WHERE is_active = 1
       ORDER BY section_key ASC, sort_order ASC, id ASC`
    );

    const settings = settingRows.reduce((result, row) => {
      result[row.setting_key] = row.setting_value;
      return result;
    }, {});

    const itemsBySection = itemRows.reduce((result, row) => {
      const sectionItems = result.get(row.section_key) || [];
      sectionItems.push(mapHomeItem(row));
      result.set(row.section_key, sectionItems);
      return result;
    }, new Map());

    const sections = sectionRows.map((row) => ({
      key: row.section_key,
      title: row.title,
      subtitle: row.subtitle,
      actionLabel: row.action_label,
      actionRoute: row.action_route,
      layout: row.layout,
      sortOrder: Number(row.sort_order),
      items: itemsBySection.get(row.section_key) || []
    }));

    res.json({
      status: 'success',
      settings,
      sections
    });
  } catch (error) {
    console.error('Home page database error:', error);

    if (error.code === '42P01') {
      return getHomeMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to fetch home page content' });
  }
});

/* GET saved trending items for the logged-in user. */
router.get('/api/saved-home-items', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  try {
    await ensureSavedHomeItemsTable();

    const { rows } = await db.query(
      `SELECT hi.id, hi.section_key, hi.eyebrow, hi.title, hi.subtitle, hi.description, hi.meta,
              hi.image_url, hi.icon, hi.action_label, hi.action_route, hi.sort_order,
              saved.created_at AS saved_at
       FROM user_saved_home_items saved
       INNER JOIN home_items hi ON hi.id = saved.home_item_id
       WHERE saved.user_id = $1 AND hi.is_active = 1
       ORDER BY saved.created_at DESC, saved.id DESC`,
      [userId]
    );

    res.json({
      status: 'success',
      items: rows.map(mapSavedHomeItem)
    });
  } catch (error) {
    console.error('Saved home items error:', error);

    if (error.code === '42P01') {
      return getHomeMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to fetch saved items' });
  }
});

/* Toggle a trending item saved/unsaved for the logged-in user. */
router.post('/api/saved-home-items/:itemId/toggle', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);
  const itemId = Number(req.params.itemId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid item id' });
  }

  try {
    await ensureSavedHomeItemsTable();

    const { rows: itemRows } = await db.query(
      `SELECT id
       FROM home_items
       WHERE id = $1 AND section_key = 'trending' AND is_active = 1
       LIMIT 1`,
      [itemId]
    );

    if (itemRows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Trending item not found' });
    }

    const { rows: savedRows } = await db.query(
      'SELECT id FROM user_saved_home_items WHERE user_id = $1 AND home_item_id = $2 LIMIT 1',
      [userId, itemId]
    );

    if (savedRows.length > 0) {
      await db.query(
        'DELETE FROM user_saved_home_items WHERE user_id = $1 AND home_item_id = $2',
        [userId, itemId]
      );

      return res.json({
        status: 'success',
        saved: false,
        itemId
      });
    }

    await db.query(
      'INSERT INTO user_saved_home_items (user_id, home_item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, itemId]
    );

    res.json({
      status: 'success',
      saved: true,
      itemId
    });
  } catch (error) {
    console.error('Saved home item toggle error:', error);

    if (error.code === '42P01') {
      return getHomeMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to update saved item' });
  }
});

/* GET database-backed explore page content. */
router.get('/api/explore', async function(req, res, next) {
  try {
    await ensureExploreMediaColumns();
    const { rows: settingRows } = await db.query(
      'SELECT setting_key, setting_value FROM explore_settings ORDER BY setting_key'
    );
    const { rows: sectionRows } = await db.query(
      `SELECT section_key, eyebrow, title, subtitle, action_label, action_route, layout, sort_order
       FROM explore_sections
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    const { rows: itemRows } = await db.query(
      `SELECT id, section_key, eyebrow, title, subtitle, description, meta, image_url, media_url, media_type, icon,
              action_label, action_route, sort_order
       FROM explore_items
       WHERE is_active = 1
       ORDER BY section_key ASC, sort_order ASC, id ASC`
    );

    const settings = settingRows.reduce((result, row) => {
      result[row.setting_key] = row.setting_value;
      return result;
    }, {});

    const itemsBySection = itemRows.reduce((result, row) => {
      const sectionItems = result.get(row.section_key) || [];
      sectionItems.push(mapExploreItem(row));
      result.set(row.section_key, sectionItems);
      return result;
    }, new Map());

    const sections = sectionRows.map((row) => ({
      key: row.section_key,
      eyebrow: row.eyebrow,
      title: row.title,
      subtitle: row.subtitle,
      actionLabel: row.action_label,
      actionRoute: row.action_route,
      layout: row.layout,
      sortOrder: Number(row.sort_order),
      items: itemsBySection.get(row.section_key) || []
    }));

    res.json({
      status: 'success',
      settings,
      sections
    });
  } catch (error) {
    console.error('Explore page database error:', error);

    if (error.code === '42P01') {
      return getExploreMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to fetch explore page content' });
  }
});

/* GET single explore item by id. */
router.get('/api/explore/:id', async function(req, res, next) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid item id' });
  }
  try {
    await ensureExploreMediaColumns();
    const { rows: [row] } = await db.query(
      `SELECT id, section_key, eyebrow, title, subtitle, description, meta, image_url, media_url, media_type, icon,
              action_label, action_route, sort_order
       FROM explore_items
       WHERE id = $1 AND is_active = 1
       LIMIT 1`,
      [id]
    );
    if (!row) {
      return res.status(404).json({ status: 'error', message: 'Item not found' });
    }
    res.json({ status: 'success', item: mapExploreItem(row) });
  } catch (error) {
    console.error('Explore item detail error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch item' });
  }
});

/* GET database-backed cultural events. */
router.get('/api/events', async function(req, res, next) {
  try {
    await ensureEventsModerationColumns();

    const { rows } = await db.query(
      `SELECT id, title, category, region, city, venue, description, event_date, end_date,
              image_url, organizer, price_label, map_url, is_featured
       FROM events
       WHERE is_active = 1 AND status = 'Approved'
       ORDER BY event_date ASC, id ASC`
    );

    res.json({
      status: 'success',
      events: rows.map(mapEvent)
    });
  } catch (error) {
    console.error('Events database error:', error);

    if (error.code === '42P01') {
      return getEventsMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to fetch events' });
  }
});

/* POST cultural event submission. Admin submissions publish immediately. */
router.post('/api/events', requireAuth, async function(req, res, next) {
  const title = String(req.body.title ?? '').trim();
  const category = String(req.body.category ?? '').trim();
  const region = String(req.body.region ?? '').trim();
  const city = String(req.body.city ?? '').trim();
  const venue = String(req.body.venue ?? '').trim();
  const description = String(req.body.description ?? '').trim();
  const eventDate = new Date(String(req.body.eventDate || ''));
  const endDateValue = String(req.body.endDate || '').trim();
  const endDate = endDateValue ? new Date(endDateValue) : null;
  const organizer = String(req.body.organizer ?? '').trim() || null;
  const priceLabel = String(req.body.priceLabel ?? '').trim() || null;
  const mapUrl = String(req.body.mapUrl ?? '').trim() || null;
  const reviewStatus = req.authUser.role === 'admin' ? 'Approved' : 'Pending';
  const isActive = reviewStatus === 'Approved' ? 1 : 0;

  if (!title || !category || !region || !city || !venue || !description) {
    return res.status(400).json({ status: 'error', message: 'Title, category, location, venue, and description are required' });
  }

  if (Number.isNaN(eventDate.getTime()) || eventDate.getTime() <= Date.now()) {
    return res.status(400).json({ status: 'error', message: 'Event date must be a valid future date' });
  }

  if (endDate && (Number.isNaN(endDate.getTime()) || endDate.getTime() <= eventDate.getTime())) {
    return res.status(400).json({ status: 'error', message: 'End date must be after the event start date' });
  }

  if (
    title.length > 255 ||
    category.length > 100 ||
    region.length > 100 ||
    city.length > 100 ||
    venue.length > 255 ||
    description.length > 1200 ||
    (organizer && organizer.length > 255) ||
    (priceLabel && priceLabel.length > 100) ||
    (mapUrl && mapUrl.length > 500)
  ) {
    return res.status(400).json({ status: 'error', message: 'Event details are too long' });
  }

  let imageUrl = null;

  if (req.body.imageData) {
    try {
      const saved = await saveContributionMedia({
        mediaData: req.body.imageData,
        mediaName: req.body.imageName,
        mediaMimeType: req.body.imageMimeType,
        mediaType: 'photo'
      });
      imageUrl = saved.media_url;
    } catch (error) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
  }

  try {
    await ensureEventsModerationColumns();

    const result = await db.query(
      `INSERT INTO events
         (title, category, region, city, venue, description, event_date, end_date,
          image_url, organizer, price_label, map_url, is_featured, is_active, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, $13, $14)
       RETURNING id`,
      [
        title,
        category,
        region,
        city,
        venue,
        description,
        eventDate,
        endDate,
        imageUrl,
        organizer,
        priceLabel,
        mapUrl,
        isActive,
        reviewStatus
      ]
    );

    const eventId = result.rows[0].id;
    let event = null;

    if (reviewStatus === 'Approved') {
      const { rows } = await db.query(
        `SELECT id, title, category, region, city, venue, description, event_date, end_date,
                image_url, organizer, price_label, map_url, is_featured
         FROM events
         WHERE id = $1
         LIMIT 1`,
        [eventId]
      );
      event = rows[0] ? mapEvent(rows[0]) : null;
    }

    res.json({
      status: 'success',
      message: reviewStatus === 'Approved'
        ? 'Event published successfully'
        : 'Event submitted for admin approval',
      eventId,
      reviewStatus,
      event
    });
  } catch (error) {
    console.error('Submit event error:', error);

    if (error.code === '42P01') {
      return getEventsMissingTablesResponse(res);
    }

    if (error.code === '23505') {
      return res.status(400).json({ status: 'error', message: 'An event with this title already exists' });
    }

    res.status(500).json({ status: 'error', message: 'Failed to submit event' });
  }
});

/* GET reminders for the logged-in user. */
router.get('/api/event-reminders', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  try {
    const { rows } = await db.query(
      `SELECT er.id, er.event_id, er.remind_at, er.reminder_offset_minutes, er.notification_id,
              e.title AS event_title, e.event_date
       FROM event_reminders er
       INNER JOIN events e ON e.id = er.event_id
       WHERE er.user_id = $1
       ORDER BY er.remind_at ASC, er.id ASC`,
      [userId]
    );

    res.json({
      status: 'success',
      reminders: rows.map(mapEventReminder)
    });
  } catch (error) {
    console.error('Event reminders database error:', error);

    if (error.code === '42P01') {
      return getEventsMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to fetch reminders' });
  }
});

/* POST/replace a reminder for one event. */
router.post('/api/event-reminders', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);
  const eventId = Number(req.body.eventId);
  const remindAt = new Date(String(req.body.remindAt || ''));
  const reminderOffsetMinutes = Number(req.body.reminderOffsetMinutes);
  const notificationId = Number(req.body.notificationId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  if (!Number.isInteger(eventId) || eventId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Valid event is required' });
  }

  if (Number.isNaN(remindAt.getTime()) || remindAt.getTime() <= Date.now()) {
    return res.status(400).json({ status: 'error', message: 'Reminder time must be in the future' });
  }

  if (!Number.isInteger(reminderOffsetMinutes) || reminderOffsetMinutes < 0) {
    return res.status(400).json({ status: 'error', message: 'Valid reminder offset is required' });
  }

  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Valid notification id is required' });
  }

  try {
    const { rows: eventRows } = await db.query(
      'SELECT id, title, event_date FROM events WHERE id = $1 AND is_active = 1 LIMIT 1',
      [eventId]
    );

    if (eventRows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Event not found' });
    }

    await db.query(
      `INSERT INTO event_reminders (user_id, event_id, remind_at, reminder_offset_minutes, notification_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, event_id) DO UPDATE SET
         remind_at = EXCLUDED.remind_at,
         reminder_offset_minutes = EXCLUDED.reminder_offset_minutes,
         notification_id = EXCLUDED.notification_id`,
      [userId, eventId, remindAt, reminderOffsetMinutes, notificationId]
    );

    const { rows: reminderRows } = await db.query(
      `SELECT er.id, er.event_id, er.remind_at, er.reminder_offset_minutes, er.notification_id,
              e.title AS event_title, e.event_date
       FROM event_reminders er
       INNER JOIN events e ON e.id = er.event_id
       WHERE er.user_id = $1 AND er.event_id = $2
       LIMIT 1`,
      [userId, eventId]
    );

    res.json({
      status: 'success',
      message: 'Reminder saved',
      reminder: mapEventReminder(reminderRows[0])
    });
  } catch (error) {
    console.error('Save event reminder error:', error);

    if (error.code === '42P01') {
      return getEventsMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to save reminder' });
  }
});

/* DELETE a reminder for the logged-in user. */
router.delete('/api/event-reminders/:id', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);
  const reminderId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  if (!Number.isInteger(reminderId) || reminderId <= 0) {
    return res.status(400).json({ status: 'error', message: 'Valid reminder is required' });
  }

  try {
    const result = await db.query(
      'DELETE FROM event_reminders WHERE id = $1 AND user_id = $2',
      [reminderId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'Reminder not found' });
    }

    res.json({ status: 'success', message: 'Reminder removed' });
  } catch (error) {
    console.error('Delete event reminder error:', error);

    if (error.code === '42P01') {
      return getEventsMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to remove reminder' });
  }
});

/* POST login. */
router.post('/api/login', async function(req, res, next) {
  const identity = String(req.body.email ?? '').trim();
  const password = String(req.body.password ?? '');

  if (!identity || !password) {
    return res.status(400).json({
      status: 'error',
      message: 'Email/username and password are required'
    });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, email, fullname, password, role, avatar_url FROM users WHERE email = $1 OR fullname = $1 LIMIT 1',
      [identity]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid identity (email/username) or password'
      });
    }

    const user = rows[0];
    const storedPassword = String(user.password || '');

    if (!verifyPassword(password, storedPassword)) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid identity (email/username) or password'
      });
    }

    if (!isHashedPassword(storedPassword)) {
      await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(password), user.id]);
    }

    const { rows: existingOtpRows } = await db.query(
      'SELECT code, expires_at FROM otps WHERE user_id = $1 AND expires_at > NOW() LIMIT 1',
      [user.id]
    );

    let otp;
    let expiresAt;

    if (existingOtpRows.length > 0) {
      otp = String(existingOtpRows[0].code);
      expiresAt = existingOtpRows[0].expires_at;
    } else {
      expiresAt = new Date(Date.now() + OTP_TTL_MS);
      otp = Math.floor(100000 + Math.random() * 900000).toString();

      await db.query(
        'INSERT INTO otps (user_id, code, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at',
        [user.id, otp, expiresAt]
      );
    }

    // Send OTP via Email
    const mailOptions = {
      from: `"Heritage of Cameroon" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Your Login Verification Code',
      text: `Your OTP is: ${otp}. It expires in a few minutes.`,
      html: `<h3>Heritage of Cameroon</h3><p>Your verification code is: <b>${otp}</b></p><p>This code expires in a few minutes.</p>`,
    };

    await transporter.sendMail(mailOptions);

    res.json({
      status: 'otp_sent',
      message: 'OTP sent to your email',
      email: user.email,
      userId: String(user.id),
      expiresAt: new Date(expiresAt).toISOString()
    });
  } catch (error) {
    console.error('Database/Email error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to process login' });
  }
});

/* POST verify-otp. */
router.post('/api/verify-otp', async function(req, res, next) {
  const userId = String(req.body.userId ?? '').trim();
  const code = String(req.body.code ?? '').replace(/\D/g, '').slice(0, 6);

  if (!userId || code.length !== 6) {
    return res.status(400).json({
      status: 'error',
      message: 'Please enter a valid 6-digit code'
    });
  }

  try {
    const { rows } = await db.query(
      'SELECT * FROM otps WHERE user_id = $1 AND code = $2 AND expires_at > NOW()',
      [userId, code]
    );

    if (rows.length > 0) {
      await db.query('DELETE FROM otps WHERE user_id = $1', [userId]);

      const { rows: userRows } = await db.query(
        'SELECT id, email, fullname AS "fullName", role, avatar_url FROM users WHERE id = $1',
        [userId]
      );
      const user = userRows[0];

      res.json({
        status: 'success',
        message: 'OTP verified successfully',
        ...buildAuthResponse(user)
      });
    } else {
      res.status(400).json({
        status: 'error',
        message: 'Invalid or expired OTP'
      });
    }
  } catch (error) {
    console.error('OTP Verification error:', error);
    res.status(500).json({ status: 'error', message: 'Verification failed' });
  }
});

/* POST signup. */
router.post('/api/signup', async function(req, res, next) {
  const fullName = String(req.body.fullName ?? '').trim();
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  const requestedRole = String(req.body.role ?? 'user').trim().toLowerCase();
  const adminKey = String(req.body.adminKey ?? '').trim();

  if (!fullName || !email || !password) {
    return res.status(400).json({
      status: 'error',
      message: 'Full name, email, and password are required'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      status: 'error',
      message: 'Please enter a valid email address'
    });
  }

  const role = requestedRole === 'admin' ? 'admin' : 'user';

  if (role === 'admin') {
    const secretKey = process.env.ADMIN_SECRET_KEY || '';
    if (!adminKey || adminKey !== secretKey) {
      return res.status(403).json({
        status: 'error',
        message: 'Invalid admin security key'
      });
    }
  }

  try {
    const { rows: existing } = await db.query(
      'SELECT id, email, fullname FROM users WHERE fullname = $1 OR email = $2',
      [fullName, email]
    );

    if (existing.length > 0) {
      const isEmail = existing.some(user => user.email === email);
      return res.status(400).json({
        status: 'error',
        message: isEmail ? 'Email already registered' : 'Name already taken'
      });
    }

    const result = await db.query(
      'INSERT INTO users (fullname, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [fullName, email, hashPassword(password), role]
    );

    const user = { id: result.rows[0].id, email, fullName, role };

    res.json({
      status: 'success',
      message: 'Registration successful',
      ...buildAuthResponse(user)
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

/* POST forgot-password. */
router.post('/api/forgot-password', async function(req, res, next) {
  const identity = String(req.body.identity ?? '').trim();

  if (!identity) {
    return res.status(400).json({ status: 'error', message: 'Email or username is required' });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, email FROM users WHERE email = $1 OR fullname = $1 LIMIT 1',
      [identity]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'No account found with that email or username' });
    }

    const user = rows[0];
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await db.query(
      'INSERT INTO otps (user_id, code, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at',
      [user.id, otp, expiresAt]
    );

    const mailOptions = {
      from: `"Heritage of Cameroon" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Password Reset Code',
      text: `Your password reset code is: ${otp}. It expires in 4 minutes. If you did not request this, ignore this email.`,
      html: `<h3>Heritage of Cameroon</h3><p>Your password reset code is: <b>${otp}</b></p><p>This code expires in 4 minutes. If you did not request a password reset, please ignore this email.</p>`
    };

    await transporter.sendMail(mailOptions);

    res.json({
      status: 'otp_sent',
      message: 'Password reset code sent to your email',
      email: user.email,
      userId: String(user.id),
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to process request' });
  }
});

/* POST reset-password. */
router.post('/api/reset-password', async function(req, res, next) {
  const token = String(req.body.token ?? '');
  const newPassword = String(req.body.newPassword ?? '');

  if (!token || !newPassword) {
    return res.status(400).json({ status: 'error', message: 'Token and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
  }

  const payload = verifyAuthToken(token);

  if (!payload) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired session. Please restart the process.' });
  }

  try {
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(newPassword), payload.sub]);
    res.json({ status: 'success', message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reset password' });
  }
});

/* GET current user profile. */
router.get('/api/profile', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  try {
    await ensureUserProfileColumns();

    const { rows } = await db.query(
      'SELECT id, fullname AS "fullName", email, role, avatar_url, phone, location, bio FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }

    const stats = await getProfileStats(userId);

    res.json({
      status: 'success',
      profile: mapUserProfile(rows[0], stats)
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch profile' });
  }
});

/* PATCH current user profile. */
router.patch('/api/profile', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);
  const fullName = String(req.body.name ?? req.body.fullName ?? '').trim();
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const phone = String(req.body.phone ?? '').trim();
  const location = String(req.body.location ?? '').trim();
  const bio = String(req.body.bio ?? '').trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  if (!fullName || !email) {
    return res.status(400).json({ status: 'error', message: 'Name and email are required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ status: 'error', message: 'Please enter a valid email address' });
  }

  if (phone.length > 50 || location.length > 120 || bio.length > 600) {
    return res.status(400).json({ status: 'error', message: 'Profile details are too long' });
  }

  try {
    await ensureUserProfileColumns();

    const { rows: existingRows } = await db.query(
      'SELECT id, email, fullname FROM users WHERE (email = $1 OR fullname = $2) AND id <> $3 LIMIT 1',
      [email, fullName, userId]
    );

    if (existingRows.length > 0) {
      const conflict = existingRows[0];
      return res.status(400).json({
        status: 'error',
        message: conflict.email === email ? 'Email already registered' : 'Name already taken'
      });
    }

    await db.query(
      'UPDATE users SET fullname = $1, email = $2, phone = $3, location = $4, bio = $5 WHERE id = $6',
      [fullName, email, phone || null, location || null, bio || null, userId]
    );

    const { rows } = await db.query(
      'SELECT id, fullname AS "fullName", email, role, avatar_url, phone, location, bio FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    const stats = await getProfileStats(userId);

    res.json({
      status: 'success',
      message: 'Profile updated',
      profile: mapUserProfile(rows[0], stats),
      ...buildAuthResponse(rows[0])
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update profile' });
  }
});

/* POST current user avatar. */
router.post('/api/profile/avatar', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  if (!req.body.mediaData) {
    return res.status(400).json({ status: 'error', message: 'Avatar image is required' });
  }

  try {
    await ensureUserProfileColumns();

    const media = await saveContributionMedia({
      mediaData: req.body.mediaData,
      mediaName: req.body.mediaName || 'avatar',
      mediaMimeType: req.body.mediaMimeType,
      mediaType: 'photo'
    });

    await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [media.media_url, userId]);

    const { rows } = await db.query(
      'SELECT id, fullname AS "fullName", email, role, avatar_url, phone, location, bio FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    const stats = await getProfileStats(userId);

    res.json({
      status: 'success',
      message: 'Avatar updated',
      profile: mapUserProfile(rows[0], stats),
      ...buildAuthResponse(rows[0])
    });
  } catch (error) {
    console.error('Avatar update error:', error);
    res.status(500).json({ status: 'error', message: error.message || 'Failed to update avatar' });
  }
});

/* PATCH current user password. */
router.patch('/api/profile/password', requireAuth, async function(req, res, next) {
  const userId = Number(req.authUser.sub);
  const currentPassword = String(req.body.currentPassword ?? '');
  const newPassword = String(req.body.newPassword ?? '');

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid user session' });
  }

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ status: 'error', message: 'Current and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters' });
  }

  try {
    const { rows } = await db.query('SELECT id, password FROM users WHERE id = $1 LIMIT 1', [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }

    if (!verifyPassword(currentPassword, String(rows[0].password || ''))) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
    }

    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(newPassword), userId]);

    res.json({ status: 'success', message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change password' });
  }
});

/* GET contributions. */
router.get('/api/contributions', async function(req, res, next) {
  try {
    const { rows } = await db.query(`
      SELECT c.*, cm.media_url, cm.media_name, cm.media_mime_type
      FROM contributions c
      LEFT JOIN contribution_media cm ON c.id = cm.contribution_id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Database error:', error);
    if (error.code === '42P01') {
      return res.json([]);
    }
    res.status(500).json({ status: 'error', message: 'Failed to fetch contributions' });
  }
});

/* GET published contributions for public feeds. */
router.get('/api/contributions/published', async function(req, res, next) {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 50)
    : 0;
  const limitClause = limit ? ` LIMIT ${limit}` : '';

  try {
    const { rows } = await db.query(`
      SELECT c.*, cm.media_url, cm.media_name, cm.media_mime_type
      FROM contributions c
      LEFT JOIN contribution_media cm ON c.id = cm.contribution_id
      WHERE c.status = 'Approved'
      ORDER BY c.created_at DESC, c.id DESC
      ${limitClause}
    `);
    res.json({ status: 'success', contributions: rows });
  } catch (error) {
    console.error('Published contributions error:', error);
    if (error.code === '42P01') {
      return res.json({ status: 'success', contributions: [] });
    }
    res.status(500).json({ status: 'error', message: 'Failed to fetch published contributions' });
  }
});

/* POST contribution. */
router.post('/api/contributions', requireAuth, async function(req, res, next) {
  const tribe = String(req.body.tribe ?? '').trim();
  const story = String(req.body.story ?? '').trim();
  const mediaType = String(req.body.mediaType || 'none');
  const reviewStatus = req.authUser.role === 'admin' ? 'Approved' : 'Pending';

  if (!tribe || !story) {
    return res.status(400).json({ status: 'error', message: 'Tribe and story are required' });
  }

  let media = null;

  try {
    media = await saveContributionMedia({
      mediaData: req.body.mediaData,
      mediaName: req.body.mediaName,
      mediaMimeType: req.body.mediaMimeType,
      mediaType
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }

  try {
    const result = await db.query(
      'INSERT INTO contributions (tribe, story, media_type, status, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id',
      [tribe, story, media ? mediaType : 'none', reviewStatus]
    );

    const contributionId = result.rows[0].id;

    if (media) {
      await db.query(
        'INSERT INTO contribution_media (contribution_id, media_url, media_name, media_mime_type) VALUES ($1, $2, $3, $4)',
        [contributionId, media.media_url, media.media_name, media.media_mime_type]
      );
    }

    res.json({
      status: 'success',
      message: reviewStatus === 'Approved'
        ? 'Contribution approved and published'
        : 'Contribution submitted for admin approval',
      contributionId,
      reviewStatus,
      media
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit contribution' });
  }
});

/* ADMIN ENDPOINTS */

/* GET pending contributions (admin). */
router.get('/api/admin/contributions', requireAdmin, async function(req, res, next) {
  try {
    const { rows } = await db.query(`
      SELECT c.*, cm.media_url, cm.media_name, cm.media_mime_type
      FROM contributions c
      LEFT JOIN contribution_media cm ON c.id = cm.contribution_id
      WHERE c.status = 'Pending'
      ORDER BY c.created_at ASC
    `);
    res.json({ status: 'success', contributions: rows });
  } catch (error) {
    console.error('Admin contributions error:', error);
    if (error.code === '42P01') return res.json({ status: 'success', contributions: [] });
    res.status(500).json({ status: 'error', message: 'Failed to fetch contributions' });
  }
});

/* PATCH contribution status (admin). */
router.patch('/api/admin/contributions/:id', requireAdmin, async function(req, res, next) {
  const id = Number(req.params.id);
  const status = String(req.body.status ?? '');

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid contribution id' });
  }

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ status: 'error', message: 'Status must be Approved or Rejected' });
  }

  try {
    const result = await db.query(
      'UPDATE contributions SET status = $1 WHERE id = $2',
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'Contribution not found' });
    }

    res.json({ status: 'success', message: `Contribution ${status.toLowerCase()}` });
  } catch (error) {
    console.error('Admin contribution update error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update contribution' });
  }
});

/* GET pending events (admin). */
router.get('/api/admin/events', requireAdmin, async function(req, res, next) {
  try {
    await ensureEventsModerationColumns();

    const { rows } = await db.query(
      `SELECT id, title, category, region, city, venue, description, event_date, end_date,
              image_url, organizer, price_label, map_url, is_featured, status
       FROM events
       WHERE status = 'Pending'
       ORDER BY created_at ASC`
    );
    res.json({
      status: 'success',
      events: rows.map((row) => ({
        ...mapEvent(row),
        status: row.status
      }))
    });
  } catch (error) {
    console.error('Admin events error:', error);
    if (error.code === '42P01') return res.json({ status: 'success', events: [] });
    res.status(500).json({ status: 'error', message: 'Failed to fetch events' });
  }
});

/* PATCH event status (admin). */
router.patch('/api/admin/events/:id', requireAdmin, async function(req, res, next) {
  const id = Number(req.params.id);
  const status = String(req.body.status ?? '');

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid event id' });
  }

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ status: 'error', message: 'Status must be Approved or Rejected' });
  }

  try {
    await ensureEventsModerationColumns();

    const result = await db.query(
      'UPDATE events SET status = $1, is_active = $2 WHERE id = $3',
      [status, status === 'Approved' ? 1 : 0, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'Event not found' });
    }

    res.json({ status: 'success', message: `Event ${status.toLowerCase()}` });
  } catch (error) {
    console.error('Admin event update error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update event' });
  }
});

/* GET explore sections list for admin form dropdown. */
router.get('/api/admin/explore-sections', requireAdmin, async function(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT section_key, title, layout FROM explore_sections
       WHERE layout != 'hero' AND is_active = 1
       ORDER BY sort_order ASC`
    );
    res.json({ status: 'success', sections: rows });
  } catch (error) {
    console.error('Admin explore sections error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch sections' });
  }
});

/* POST new explore item (admin) — also pushes to home trending. */
router.post('/api/admin/explore-items', requireAdmin, async function(req, res, next) {
  const sectionKey = String(req.body.sectionKey ?? '').trim();
  const title = String(req.body.title ?? '').trim();
  const eyebrow = String(req.body.eyebrow ?? '').trim() || null;
  const subtitle = String(req.body.subtitle ?? '').trim() || null;
  const description = String(req.body.description ?? '').trim() || null;
  const meta = String(req.body.meta ?? '').trim() || null;
  const rawMediaType = String(req.body.mediaType || 'none');

  if (!sectionKey || !title) {
    return res.status(400).json({ status: 'error', message: 'Section and title are required' });
  }

  let imageUrl = null;
  let mediaUrl = null;
  let mediaType = null;

  if (['photo', 'audio', 'video'].includes(rawMediaType) && req.body.mediaData) {
    let saved;
    try {
      saved = await saveContributionMedia({
        mediaData: req.body.mediaData,
        mediaName: req.body.mediaName,
        mediaMimeType: req.body.mediaMimeType,
        mediaType: rawMediaType
      });
    } catch (error) {
      return res.status(400).json({ status: 'error', message: error.message });
    }

    if (rawMediaType === 'photo') {
      imageUrl = saved.media_url;
    } else {
      mediaUrl = saved.media_url;
      mediaType = rawMediaType;
    }
  }

  // Auto-derive icon from media type
  const icon = rawMediaType === 'audio' ? 'audiotrack'
    : rawMediaType === 'video' ? 'movie'
    : rawMediaType === 'photo' ? 'image'
    : null;

  try {
    await ensureExploreMediaColumns();
    const exploreResult = await db.query(
      `INSERT INTO explore_items
         (section_key, eyebrow, title, subtitle, description, meta, image_url, media_url, media_type, icon,
          action_label, action_route, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, 1, 1)
       RETURNING id`,
      [sectionKey, eyebrow, title, subtitle, description, meta, imageUrl, mediaUrl, mediaType, icon]
    );

    const exploreItemId = exploreResult.rows[0].id;

    // Push to home trending section at the front (lowest sort_order)
    const { rows: [minRow] } = await db.query(
      "SELECT MIN(sort_order) AS min_order FROM home_items WHERE section_key = 'trending'"
    );
    const trendingSortOrder = (minRow.min_order ?? 1) - 1;
    const trendingActionRoute = `/tabs/explore/${exploreItemId}`;

    await db.query(
      `INSERT INTO home_items
         (section_key, eyebrow, title, subtitle, description, meta, image_url, icon,
          action_label, action_route, sort_order, is_active)
       VALUES ('trending', $1, $2, $3, $4, $5, $6, $7, 'View', $8, $9, 1)`,
      [eyebrow, title, subtitle, description, meta, imageUrl, icon, trendingActionRoute, trendingSortOrder]
    );

    res.json({
      status: 'success',
      message: 'Item added to Explore and pushed to Trending',
      exploreItemId
    });
  } catch (error) {
    console.error('Admin add explore item error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add item' });
  }
});

module.exports = router;
