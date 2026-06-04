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
const mediaStorePath = path.join(__dirname, '..', 'data', 'contribution-media.json');

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
      name: user.fullName
    }
  };
}

async function readMediaStore() {
  try {
    const contents = await fs.readFile(mediaStorePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function writeMediaStore(store) {
  await fs.mkdir(path.dirname(mediaStorePath), { recursive: true });
  await fs.writeFile(mediaStorePath, JSON.stringify(store, null, 2));
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

  await fs.mkdir(uploadDir, { recursive: true });

  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extensionForMimeType(mimeType)}`;
  const filePath = path.join(uploadDir, storedName);

  await fs.writeFile(filePath, buffer);

  return {
    media_url: `/uploads/${storedName}`,
    media_name: sanitizeFileName(mediaName),
    media_mime_type: mimeType
  };
}

async function attachContributionMedia(rows) {
  const mediaStore = await readMediaStore();

  return rows.map((row) => ({
    ...row,
    ...(mediaStore[String(row.id)] || {})
  }));
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

function getHomeMissingTablesResponse(res) {
  return res.status(500).json({
    status: 'error',
    message: 'Home page database tables are missing. Run npm run seed:home in the backend folder.'
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
    const [settingRows] = await db.execute(
      'SELECT setting_key, setting_value FROM home_settings ORDER BY setting_key'
    );
    const [sectionRows] = await db.execute(
      `SELECT section_key, title, subtitle, action_label, action_route, layout, sort_order
       FROM home_sections
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    const [itemRows] = await db.execute(
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

    if (error.code === 'ER_NO_SUCH_TABLE') {
      return getHomeMissingTablesResponse(res);
    }

    res.status(500).json({ status: 'error', message: 'Failed to fetch home page content' });
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
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email = ? OR fullName = ? LIMIT 1',
      [identity, identity]
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
      await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashPassword(password), user.id]);
    }

    const [existingOtpRows] = await db.execute(
      'SELECT code, expires_at FROM otps WHERE user_id = ? AND expires_at > NOW() LIMIT 1',
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

      await db.execute(
        'INSERT INTO otps (user_id, code, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE code = ?, expires_at = ?',
        [user.id, otp, expiresAt, otp, expiresAt]
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
    const [rows] = await db.execute(
      'SELECT * FROM otps WHERE user_id = ? AND code = ? AND expires_at > NOW()',
      [userId, code]
    );

    if (rows.length > 0) {
      // Clear OTP after success
      await db.execute('DELETE FROM otps WHERE user_id = ?', [userId]);
      
      // Get user details
      const [userRows] = await db.execute('SELECT id, email, fullName FROM users WHERE id = ?', [userId]);
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
  
  try {
    const [existing] = await db.execute('SELECT * FROM users WHERE fullName = ? OR email = ?', [fullName, email]);
    
    if (existing.length > 0) {
      const isEmail = existing.some(user => user.email === email);
      return res.status(400).json({ 
        status: 'error', 
        message: isEmail ? 'Email already registered' : 'Name already taken' 
      });
    }

    const [result] = await db.execute(
      'INSERT INTO users (fullName, email, password) VALUES (?, ?, ?)',
      [fullName, email, hashPassword(password)]
    );

    const user = { id: result.insertId, email, fullName };

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

/* GET contributions. */
router.get('/api/contributions', async function(req, res, next) {
  try {
    const [rows] = await db.execute('SELECT * FROM contributions ORDER BY created_at DESC');
    res.json(await attachContributionMedia(rows));
  } catch (error) {
    console.error('Database error:', error);
    // If table doesn't exist, return empty array for now to avoid crashing
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    res.status(500).json({ status: 'error', message: 'Failed to fetch contributions' });
  }
});

/* POST contribution. */
router.post('/api/contributions', requireAuth, async function(req, res, next) {
  const tribe = String(req.body.tribe ?? '').trim();
  const story = String(req.body.story ?? '').trim();
  const mediaType = String(req.body.mediaType || 'none');
  
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
    const [result] = await db.execute(
      'INSERT INTO contributions (tribe, story, media_type, status, created_at) VALUES (?, ?, ?, ?, NOW())',
      [tribe, story, media ? mediaType : 'none', 'Pending']
    );

    if (media) {
      const mediaStore = await readMediaStore();
      mediaStore[String(result.insertId)] = media;
      await writeMediaStore(mediaStore);
    }

    res.json({
      status: 'success',
      message: 'Contribution submitted successfully',
      contributionId: result.insertId,
      media
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit contribution' });
  }
});

module.exports = router;
