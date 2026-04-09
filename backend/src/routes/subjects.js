import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

function normalizeName(raw) {
  return String(raw || '').trim();
}

function normalizeSortOrder(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : NaN;
}

async function writeSubjectAudit(executor, action, objectId, changeSummary) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, object_type, object_id, change_summary)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        executor?.id || null,
        executor?.role || null,
        action,
        'subject',
        objectId || 0,
        changeSummary ? JSON.stringify(changeSummary) : null,
      ]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[audit] subject write failed:', error.message);
  }
}

router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 50, keyword = '', isActive = '' } = req.query;
    const limit = Number(pageSize);
    const offset = (Number(page) - 1) * limit;

    const where = ['1=1'];
    const values = [];
    if (keyword) {
      where.push('name LIKE ?');
      values.push(`%${String(keyword).trim()}%`);
    }
    if (isActive !== '') {
      where.push('is_active = ?');
      values.push(Number(isActive) ? 1 : 0);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const [rows] = await pool.query(
      `SELECT id, name, sort_order AS sortOrder, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM subjects
       ${whereClause}
       ORDER BY sort_order ASC, id ASC
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM subjects
       ${whereClause}`,
      values
    );

    await writeSubjectAudit(req.user, 'READ_SUBJECT_LIST', 0, {
      page: Number(page),
      pageSize: limit,
      keyword: keyword || null,
      isActive: isActive === '' ? null : Number(isActive) ? 1 : 0,
      resultCount: rows.length,
    });

    res.json({
      data: rows,
      page: Number(page),
      pageSize: limit,
      total: countRows[0]?.total || 0,
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'subjects 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '查询学科列表失败' });
  }
});

router.post('/', async (req, res) => {
  const name = normalizeName(req.body?.name);
  const sortOrder = normalizeSortOrder(req.body?.sortOrder);
  if (!name) {
    res.status(400).json({ message: 'name 必填' });
    return;
  }
  if (name.length > 64) {
    res.status(400).json({ message: 'name 长度不能超过 64' });
    return;
  }
  if (Number.isNaN(sortOrder)) {
    res.status(400).json({ message: 'sortOrder 必须是非负整数' });
    return;
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO subjects (name, sort_order, is_active) VALUES (?, ?, 1)',
      [name, sortOrder]
    );
    await writeSubjectAudit(req.user, 'CREATE_SUBJECT', result.insertId, { name, sortOrder });
    res.status(201).json({
      id: result.insertId,
      name,
      sortOrder,
      isActive: 1,
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'subjects 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    if (error?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: '学科名称已存在' });
      return;
    }
    res.status(500).json({ message: error.message || '创建学科失败' });
  }
});

router.patch('/:id', async (req, res) => {
  const subjectId = Number(req.params.id);
  const name = req.body?.name === undefined ? undefined : normalizeName(req.body.name);
  const sortOrder = req.body?.sortOrder === undefined ? undefined : normalizeSortOrder(req.body.sortOrder);
  if (!subjectId) {
    res.status(400).json({ message: 'invalid subject id' });
    return;
  }
  if (name !== undefined) {
    if (!name) {
      res.status(400).json({ message: 'name 不能为空' });
      return;
    }
    if (name.length > 64) {
      res.status(400).json({ message: 'name 长度不能超过 64' });
      return;
    }
  }
  if (sortOrder !== undefined && Number.isNaN(sortOrder)) {
    res.status(400).json({ message: 'sortOrder 必须是非负整数' });
    return;
  }
  if (name === undefined && sortOrder === undefined) {
    res.status(400).json({ message: '至少提供一个可更新字段：name / sortOrder' });
    return;
  }

  try {
    const [rows] = await pool.query('SELECT id, name, sort_order AS sortOrder FROM subjects WHERE id = ? LIMIT 1', [
      subjectId,
    ]);
    if (rows.length === 0) {
      res.status(404).json({ message: '学科不存在' });
      return;
    }
    const current = rows[0];
    const nextName = name === undefined ? current.name : name;
    const nextSortOrder = sortOrder === undefined ? Number(current.sortOrder) : sortOrder;

    await pool.query('UPDATE subjects SET name = ?, sort_order = ? WHERE id = ? LIMIT 1', [
      nextName,
      nextSortOrder,
      subjectId,
    ]);
    await writeSubjectAudit(req.user, 'UPDATE_SUBJECT', subjectId, {
      from: { name: current.name, sortOrder: Number(current.sortOrder) },
      to: { name: nextName, sortOrder: nextSortOrder },
    });
    res.json({
      id: subjectId,
      name: nextName,
      sortOrder: nextSortOrder,
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'subjects 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    if (error?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: '学科名称已存在' });
      return;
    }
    res.status(500).json({ message: error.message || '更新学科失败' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const subjectId = Number(req.params.id);
  const isActive = req.body?.isActive;
  if (!subjectId) {
    res.status(400).json({ message: 'invalid subject id' });
    return;
  }
  if (typeof isActive !== 'boolean') {
    res.status(400).json({ message: 'isActive 必须是 boolean' });
    return;
  }

  try {
    const [result] = await pool.query('UPDATE subjects SET is_active = ? WHERE id = ? LIMIT 1', [
      isActive ? 1 : 0,
      subjectId,
    ]);
    if (result.affectedRows === 0) {
      res.status(404).json({ message: '学科不存在' });
      return;
    }
    await writeSubjectAudit(req.user, 'UPDATE_SUBJECT_STATUS', subjectId, {
      isActive: isActive ? 1 : 0,
    });
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'subjects 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '更新学科状态失败' });
  }
});

export default router;
