import express from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { writeAuditLog } from '../auditLog.js';

const router = express.Router();

const ALLOWED_STATUS = ['open', 'reviewing', 'closed'];
const IMPACT_COUNT_SOURCES = [
  {
    key: 'reportCount',
    table: 'question_reports',
    sql: 'SELECT COUNT(*) AS c FROM question_reports WHERE question_id = ?',
  },
  {
    key: 'practiceAnswerCount',
    table: 'practice_answers',
    sql: 'SELECT COUNT(*) AS c FROM practice_answers WHERE question_id = ?',
  },
  {
    key: 'favoriteCount',
    table: 'question_favorites',
    sql: 'SELECT COUNT(*) AS c FROM question_favorites WHERE question_id = ?',
  },
  {
    key: 'wrongQuestionCount',
    table: 'wrong_questions',
    sql: 'SELECT COUNT(*) AS c FROM wrong_questions WHERE question_id = ?',
  },
];

async function getQuestionImpactStats(questionId) {
  const impact = {};
  const missingTables = [];
  for (const source of IMPACT_COUNT_SOURCES) {
    try {
      const [rows] = await pool.query(source.sql, [questionId]);
      impact[source.key] = Number(rows[0]?.c || 0);
    } catch (error) {
      if (error?.code === 'ER_NO_SUCH_TABLE') {
        impact[source.key] = null;
        missingTables.push(source.table);
        continue;
      }
      throw error;
    }
  }
  return { impact, missingTables };
}

router.get('/question-impact/:questionId', requireRole('admin', 'teacher'), async (req, res) => {
  const questionId = Number(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ message: 'invalid question id' });
    return;
  }
  try {
    const [qrows] = await pool.query(
      'SELECT id, is_deleted AS isDeleted, status AS questionStatus FROM questions WHERE id = ? LIMIT 1',
      [questionId]
    );
    if (qrows.length === 0) {
      res.status(404).json({ message: '题目不存在' });
      return;
    }
    const { impact, missingTables } = await getQuestionImpactStats(questionId);
    res.json({
      ok: true,
      questionId,
      isDeleted: Number(qrows[0].isDeleted || 0) === 1,
      questionStatus: qrows[0].questionStatus,
      impact,
      missingTables,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || '加载题目影响面失败' });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const status = String(req.query.status || '').trim();
    const view = String(req.query.view || 'detail').trim().toLowerCase();
    const isAggregate = view === 'question' || view === 'aggregate';
    const sortBy = String(req.query.sortBy || '').trim();
    const sortOrderRaw = String(req.query.sortOrder || 'desc').trim().toLowerCase();
    const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';

    const where = [];
    const values = [];
    if (status && ALLOWED_STATUS.includes(status)) {
      where.push('qr.status = ?');
      values.push(status);
    }
    const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let rows = [];
    let countRows = [];
    if (isAggregate) {
      let aggregateOrderBy = `latestReportedAt ${sortOrder}`;
      if (sortBy === 'reportCount') {
        aggregateOrderBy = `reportCount ${sortOrder}, latestReportedAt DESC`;
      }
      [rows] = await pool.query(
        `SELECT
            qr.question_id AS questionId,
            MAX(qr.id) AS latestReportId,
            MAX(CASE WHEN qr.status IN ('open', 'reviewing') THEN qr.id ELSE 0 END) AS latestActiveReportId,
            MAX(qr.created_at) AS latestReportedAt,
            COUNT(*) AS reportCount,
            SUM(CASE WHEN qr.status = 'open' THEN 1 ELSE 0 END) AS openCount,
            SUM(CASE WHEN qr.status = 'reviewing' THEN 1 ELSE 0 END) AS reviewingCount,
            SUM(CASE WHEN qr.status = 'closed' THEN 1 ELSE 0 END) AS closedCount,
            q.stem, q.question_type AS questionType, q.status AS questionStatus, q.is_deleted AS questionDeleted
         FROM question_reports qr
         JOIN questions q ON q.id = qr.question_id
         ${wc}
         GROUP BY qr.question_id, q.stem, q.question_type, q.status, q.is_deleted
         ORDER BY ${aggregateOrderBy}
         LIMIT ? OFFSET ?`,
        [...values, pageSize, offset]
      );
      [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM (
           SELECT qr.question_id
           FROM question_reports qr
           ${wc}
           GROUP BY qr.question_id
         ) t`,
        values
      );
    } else {
      [rows] = await pool.query(
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
      [countRows] = await pool.query(
        `SELECT COUNT(*) AS total FROM question_reports qr ${wc}`,
        values
      );
    }

    res.json({
      data: rows,
      page,
      pageSize,
      view: isAggregate ? 'question' : 'detail',
      sortBy: isAggregate ? (sortBy === 'reportCount' ? 'reportCount' : 'latestReportedAt') : null,
      sortOrder: isAggregate ? sortOrder.toLowerCase() : null,
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

/** 确认题目有误：软删题目并关闭工单（与 DELETE /admin/questions/:id 一致，仅管理员） */
router.post('/:id/confirm-delete-question', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ message: 'invalid id' });
    return;
  }

  const adminNoteRaw = req.body?.adminNote;
  const defaultNote = '经纠错确认为错误题目，已从题库下架';
  const adminNote =
    adminNoteRaw !== undefined && adminNoteRaw !== null && String(adminNoteRaw).trim() !== ''
      ? String(adminNoteRaw).trim().slice(0, 500)
      : defaultNote;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT qr.id, qr.status AS reportStatus, qr.question_id AS questionId, q.is_deleted AS questionDeleted
       FROM question_reports qr
       LEFT JOIN questions q ON q.id = qr.question_id
       WHERE qr.id = ?
       FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await conn.rollback();
      res.status(404).json({ message: '记录不存在' });
      return;
    }

    const row = rows[0];
    if (row.reportStatus === 'closed') {
      await conn.rollback();
      res.status(400).json({ message: '工单已关闭' });
      return;
    }

    const questionId = Number(row.questionId);
    let deletedNow = false;

    if (questionId && row.questionDeleted === 0) {
      const [upd] = await conn.query(
        'UPDATE questions SET is_deleted = 1, deleted_at = NOW() WHERE id = ? AND is_deleted = 0',
        [questionId]
      );
      deletedNow = upd.affectedRows > 0;
      if (deletedNow) {
        await writeAuditLog(req.user, 'DELETE_QUESTION', 'question', questionId, { softDelete: true }, conn);
      }
    }

    await conn.query(
      `UPDATE question_reports SET status = 'closed', admin_note = ?, updated_at = NOW() WHERE id = ? LIMIT 1`,
      [adminNote, id]
    );

    await conn.commit();
    res.json({ ok: true, id, questionId: questionId || null, deletedNow });
  } catch (error) {
    await conn.rollback();
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'question_reports 表不存在，请执行 sql/question_reports_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '操作失败' });
  } finally {
    conn.release();
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
