var express = require('express');
var router = express.Router();
const db = require('../config/db');
const nodemailer = require('nodemailer');
require('dotenv').config();

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
      'SELECT * FROM users WHERE (email = ? OR fullName = ?) AND password = ?', 
      [identity, identity, password]
    );

    if (rows.length > 0) {
      const user = rows[0];

      const [existingOtpRows] = await db.execute(
        'SELECT code, expires_at FROM otps WHERE user_id = ? AND expires_at > NOW() LIMIT 1',
        [user.id]
      );

      let otp;

      if (existingOtpRows.length > 0) {
        otp = String(existingOtpRows[0].code);
      } else {
        const expiresAt = new Date(Date.now() + 4 * 60000); // 4 minutes from now
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
        userId: String(user.id)
      });
    } else {
      res.status(401).json({
        status: 'error',
        message: 'Invalid identity (email/username) or password'
      });
    }
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
        user: { id: user.id, email: user.email, name: user.fullName }
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
  const { fullName, email, password } = req.body;
  
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
      [fullName, email, password]
    );

    res.json({
      status: 'success',
      message: 'Registration successful',
      user: { id: result.insertId, email: email, name: fullName }
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
    res.json(rows);
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
router.post('/api/contributions', async function(req, res, next) {
  const { tribe, story, mediaType } = req.body;
  
  if (!tribe || !story) {
    return res.status(400).json({ status: 'error', message: 'Tribe and story are required' });
  }

  try {
    const [result] = await db.execute(
      'INSERT INTO contributions (tribe, story, media_type, status, created_at) VALUES (?, ?, ?, ?, NOW())',
      [tribe, story, mediaType || 'none', 'Pending']
    );

    res.json({
      status: 'success',
      message: 'Contribution submitted successfully',
      contributionId: result.insertId
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit contribution' });
  }
});

module.exports = router;
