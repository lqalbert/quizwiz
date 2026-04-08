import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();
const usernameRegex = /^[A-Za-z0-9\u4e00-\u9fff]+$/;
const minUsernameLength = 2;
const maxUsernameLength = 20;

async function writeAuthAudit(executor, action, changeSummary) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, object_type, object_id, change_summary)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        executor?.id || null,
        executor?.role || null,
        action,
        'auth',
        executor?.id || 0,
        changeSummary ? JSON.stringify(changeSummary) : null,
      ]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[audit] auth write failed:', error.message);
  }
}

router.post('/login', async (req, res) => {
  const username = String(req.body?.username || req.body?.email || '').trim();
  const password = req.body?.password || '';
  if (!username || !password) {
    res.status(400).json({ message: '请填写用户名和密码' });
    return;
  }
  if (username.length < minUsernameLength || username.length > maxUsernameLength) {
    res.status(400).json({ message: '用户名长度需为 2-20 位' });
    return;
  }
  if (!usernameRegex.test(username)) {
    res.status(400).json({ message: '用户名仅支持汉字、字母、数字' });
    return;
  }

  const [rows] = await pool.query(
    'SELECT id, email, password_hash, role FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
    [username]
  );
  if (rows.length === 0) {
    res.status(401).json({ message: '用户名或密码错误' });
    return;
  }
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ message: '用户名或密码错误' });
    return;
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  res.json({
    token,
    user: { id: user.id, username: user.email, role: user.role },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, email, role FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
    [req.user.id]
  );
  if (rows.length === 0) {
    res.status(401).json({ message: '用户不存在或已禁用' });
    return;
  }
  const u = rows[0];
  await writeAuthAudit(req.user, 'READ_PROFILE', { username: u.email });
  res.json({ user: { id: u.id, username: u.email, role: u.role } });
});

export default router;
