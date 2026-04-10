import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

const ALLOWED_STATUS = ['open', 'reviewing', 'closed'];

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const status = String(req.query.status || '').trim();

    const where = [];
    const values = [];
    if (status && ALLOWED_STATUS.includes(status)) {
      where.push('qr.status = ?');
      values.push(status);
    }
    const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT qr.id, qr.student_id AS studentId, qr.question_id AS questionId, qr.reason_type AS reasonType,
              qr.detail, qr.status, qr.admin_note AS adminNote, qr.created_at AS createdAt, qr.updated_at AS updatedAt,
              q.stem, q.question_type AS questionType, q.status AS questionStatus, q.is_deleted AS questionDeleted
       FROM question_reports qr
       JOIN questions q ON q.id = qr.question_id
       ${wc}
       ORDER BY qr.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM question_reports qr ${wc}`,
      values
    );

    res.json({
      data: rows,
      page,
      pageSize,
      total: Number(countRows[0]?.total || 0),
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'question_reports 表不存在，请执行 sql/question_reports_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载题目反馈失败' });
  }
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ message: 'invalid id' });
    return;
  }

  const statusRaw = req.body?.status;
  const adminNoteRaw = req.body?.adminNote;

  const updates = [];
  const vals = [];

  if (statusRaw !== undefined && statusRaw !== null && statusRaw !== '') {
    const s = String(statusRaw).trim();
    if (!ALLOWED_STATUS.includes(s)) {
      res.status(400).json({ message: 'status 仅支持 open / reviewing / closed' });
      return;
    }
    updates.push('status = ?');
    vals.push(s);
  }

  if (adminNoteRaw !== undefined) {
    updates.push('admin_note = ?');
    vals.push(String(adminNoteRaw).slice(0, 500));
  }

  if (updates.length === 0) {
    res.status(400).json({ message: '请提供 status 或 adminNote' });
    return;
  }

  updates.push('updated_at = NOW()');
  vals.push(id);

  try {
    const [result] = await pool.query(
      `UPDATE question_reports SET ${updates.join(', ')} WHERE id = ? LIMIT 1`,
      vals
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ message: '记录不存在' });
      return;
    }
    res.json({ ok: true, id });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'question_reports 表不存在，请执行 sql/question_reports_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '更新失败' });
  }
});

export default router;
