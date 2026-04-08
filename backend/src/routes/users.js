import express from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db.js';

const router = express.Router();
const usernameRegex = /^[A-Za-z0-9\u4e00-\u9fff]+$/;
const minUsernameLength = 2;
const maxUsernameLength = 20;

async function writeUserAudit(executor, action, objectId, changeSummary) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, object_type, object_id, change_summary)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        executor?.id || null,
        executor?.role || null,
        action,
        'user',
        objectId || 0,
        changeSummary ? JSON.stringify(changeSummary) : null,
      ]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[audit] user write failed:', error.message);
  }
}

router.get('/', async (req, res) => {
  const { page = 1, pageSize = 20, keyword = '', role = '', isActive = '' } = req.query;
  const limit = Number(pageSize);
  const offset = (Number(page) - 1) * limit;

  const where = ['1 = 1'];
  const values = [];
  if (keyword) {
    where.push('email LIKE ?');
    values.push(`%${keyword}%`);
  }
  if (role) {
    where.push('role = ?');
    values.push(role);
  }
  if (isActive !== '') {
    where.push('is_active = ?');
    values.push(Number(isActive) ? 1 : 0);
  }

  const whereClause = `WHERE ${where.join(' AND ')}`;
  const [rows] = await pool.query(
    `SELECT id, email, role, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM users
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM users
       ${whereClause}`,
    values
  );

  await writeUserAudit(req.user, 'READ_USER_LIST', 0, {
    page: Number(page),
    pageSize: limit,
    keyword: keyword || null,
    role: role || null,
    isActive: isActive === '' ? null : Number(isActive) ? 1 : 0,
    resultCount: rows.length,
  });

  res.json({
    data: rows,
    page: Number(page),
    pageSize: limit,
    total: countRows[0]?.total || 0,
  });
});

router.post('/', async (req, res) => {
  const username = String(req.body?.username || req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || 'teacher');
  if (!username || !password) {
    res.status(400).json({ message: 'username 和 password 必填' });
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
  if (!['admin', 'teacher'].includes(role)) {
    res.status(400).json({ message: 'role 仅支持 admin 或 teacher' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ message: '密码至少 6 位' });
    return;
  }
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [username]);
  if (existing.length > 0) {
    res.status(409).json({ message: '用户名已存在' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, role, is_active) VALUES (?, ?, ?, 1)',
      [username, passwordHash, role]
    );
    const userId = result.insertId;
    await writeUserAudit(req.user, 'CREATE_USER', userId, { username, role });
    res.status(201).json({ id: userId, username, role, isActive: 1 });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: '用户名已存在' });
      return;
    }
    res.status(500).json({ message: error.message || '创建用户失败' });
  }
});

router.patch('/:id/password', async (req, res) => {
  const userId = Number(req.params.id);
  const newPassword = String(req.body?.password || '');
  if (!userId) {
    res.status(400).json({ message: 'invalid user id' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ message: '密码至少 6 位' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const [result] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ? LIMIT 1', [
    passwordHash,
    userId,
  ]);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: '用户不存在' });
    return;
  }

  await writeUserAudit(req.user, 'RESET_USER_PASSWORD', userId, {});
  res.json({ ok: true });
});

router.patch('/:id/status', async (req, res) => {
  const userId = Number(req.params.id);
  const isActive = req.body?.isActive;
  if (!userId) {
    res.status(400).json({ message: 'invalid user id' });
    return;
  }
  if (typeof isActive !== 'boolean') {
    res.status(400).json({ message: 'isActive 必须是 boolean' });
    return;
  }
  const statusValue = isActive ? 1 : 0;

  // 防止管理员误操作：不允许禁用自己
  if (req.user?.id === userId && statusValue === 0) {
    res.status(400).json({ message: '不能禁用当前登录账号' });
    return;
  }

  // 防止系统无管理员：当目标用户是 admin 且要禁用时，必须保留至少 1 个启用 admin
  if (statusValue === 0) {
    const [targetRows] = await pool.query(
      'SELECT id, role, is_active AS isActive FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (targetRows.length === 0) {
      res.status(404).json({ message: '用户不存在' });
      return;
    }
    const target = targetRows[0];
    if (target.role === 'admin' && Number(target.isActive) === 1) {
      const [adminCountRows] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND is_active = 1"
      );
      const activeAdminCount = Number(adminCountRows[0]?.cnt || 0);
      if (activeAdminCount <= 1) {
        res.status(400).json({ message: '系统至少需要保留一个启用中的管理员账号' });
        return;
      }
    }
  }

  const [result] = await pool.query('UPDATE users SET is_active = ? WHERE id = ? LIMIT 1', [
    statusValue,
    userId,
  ]);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: '用户不存在' });
    return;
  }

  await writeUserAudit(req.user, 'UPDATE_USER_STATUS', userId, { isActive: statusValue });
  res.json({ ok: true });
});

router.patch('/:id/role', async (req, res) => {
  const userId = Number(req.params.id);
  const nextRole = String(req.body?.role || '');
  if (!userId) {
    res.status(400).json({ message: 'invalid user id' });
    return;
  }
  if (!['admin', 'teacher'].includes(nextRole)) {
    res.status(400).json({ message: 'role 仅支持 admin 或 teacher' });
    return;
  }

  const [targetRows] = await pool.query(
    'SELECT id, role, is_active AS isActive FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  if (targetRows.length === 0) {
    res.status(404).json({ message: '用户不存在' });
    return;
  }
  const target = targetRows[0];
  if (target.role === nextRole) {
    res.json({ ok: true });
    return;
  }

  // 禁止把最后一个启用中的管理员降级为 teacher
  if (target.role === 'admin' && nextRole === 'teacher' && Number(target.isActive) === 1) {
    const [adminCountRows] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND is_active = 1"
    );
    const activeAdminCount = Number(adminCountRows[0]?.cnt || 0);
    if (activeAdminCount <= 1) {
      res.status(400).json({ message: '不能将最后一个启用中的管理员降级为 teacher' });
      return;
    }
  }

  const [result] = await pool.query('UPDATE users SET role = ? WHERE id = ? LIMIT 1', [
    nextRole,
    userId,
  ]);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: '用户不存在' });
    return;
  }

  await writeUserAudit(req.user, 'UPDATE_USER_ROLE', userId, {
    fromRole: target.role,
    toRole: nextRole,
  });
  res.json({ ok: true });
});

export default router;
