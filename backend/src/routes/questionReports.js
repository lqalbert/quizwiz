import express from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { writeAuditLog } from '../auditLog.js';

const router = express.Router();

const ALLOWED_STATUS = ['open', 'reviewing', 'closed'];

/** 反馈工单 SLA：超过该小时数仍未关闭的 open/reviewing 视为超时（可被 ?staleHours= 覆盖） */
function defaultStaleHoursFromEnv() {
  const n = Number(process.env.QUESTION_REPORT_STALE_HOURS);
  if (!Number.isFinite(n) || n < 1) return 48;
  return Math.min(720, Math.floor(n));
}

const STALE_ACTIVE_AGE_EXPR = `CASE WHEN qr.status IN ('open','reviewing') THEN CAST(TIMESTAMPDIFF(HOUR, qr.created_at, NOW()) AS SIGNED) ELSE NULL END`;
const STALE_AGG_EXPR = `MAX(CASE WHEN qr.status IN ('open','reviewing') THEN CAST(TIMESTAMPDIFF(HOUR, qr.created_at, NOW()) AS SIGNED) END)`;
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

/** 质量看板：反馈概览、近7日趋势、学科分布 */
router.get('/dashboard', requireRole('admin', 'teacher'), async (req, res) => {
  try {
    let staleHours = Number(req.query.staleHours);
    if (!Number.isFinite(staleHours) || staleHours < 1) staleHours = defaultStaleHoursFromEnv();
    else staleHours = Math.min(720, Math.floor(staleHours));

    const [statusRows] = await pool.query(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS openCount,
          SUM(CASE WHEN status = 'reviewing' THEN 1 ELSE 0 END) AS reviewingCount,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closedCount
       FROM question_reports`
    );
    const [slaStaleRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM question_reports
       WHERE status IN ('open','reviewing')
         AND CAST(TIMESTAMPDIFF(HOUR, created_at, NOW()) AS SIGNED) >= ?`,
      [staleHours]
    );
    const [avgRows] = await pool.query(
      `SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, updated_at)) AS avgCloseHours
       FROM question_reports
       WHERE status = 'closed'`
    );
    const [trendRows] = await pool.query(
      `SELECT DATE(created_at) AS d, COUNT(*) AS cnt
       FROM question_reports
       WHERE created_at >= (CURDATE() - INTERVAL 6 DAY)
       GROUP BY DATE(created_at)
       ORDER BY d ASC`
    );

    let subjectRows = [];
    let subjectMissing = false;
    try {
      const [rows] = await pool.query(
        `SELECT s.name AS subjectName, COUNT(*) AS cnt
         FROM question_reports qr
         JOIN question_subject_rel qsr ON qsr.question_id = qr.question_id
         JOIN subjects s ON s.id = qsr.subject_id
         GROUP BY s.id, s.name
         ORDER BY cnt DESC
         LIMIT 10`
      );
      subjectRows = rows;
    } catch (error) {
      if (error?.code === 'ER_NO_SUCH_TABLE') {
        subjectMissing = true;
      } else {
        throw error;
      }
    }

    const trendMap = new Map(trendRows.map((x) => [String(x.d).slice(0, 10), Number(x.cnt || 0)]));
    const trend7d = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      trend7d.push({ date: key, count: trendMap.get(key) || 0 });
    }

    const row = statusRows[0] || {};
    res.json({
      ok: true,
      overview: {
        total: Number(row.total || 0),
        openCount: Number(row.openCount || 0),
        reviewingCount: Number(row.reviewingCount || 0),
        closedCount: Number(row.closedCount || 0),
        avgCloseHours: avgRows[0]?.avgCloseHours == null ? null : Number(avgRows[0].avgCloseHours),
        slaStaleHours: staleHours,
        slaStaleReportCount: Number(slaStaleRows[0]?.c || 0),
      },
      trend7d,
      bySubject: subjectRows.map((x) => ({ subjectName: x.subjectName, count: Number(x.cnt || 0) })),
      subjectMissing,
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'question_reports 表不存在，请执行 sql/question_reports_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载看板失败' });
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
    const highRiskOnlyRaw = String(req.query.highRiskOnly || '').trim().toLowerCase();
    const highRiskOnly = highRiskOnlyRaw === '1' || highRiskOnlyRaw === 'true';
    const staleOnlyRaw = String(req.query.staleOnly || '').trim().toLowerCase();
    const staleOnly = staleOnlyRaw === '1' || staleOnlyRaw === 'true';
    let staleHours = Number(req.query.staleHours);
    if (!Number.isFinite(staleHours) || staleHours < 1) staleHours = defaultStaleHoursFromEnv();
    else staleHours = Math.min(720, Math.floor(staleHours));

    const where = [];
    const values = [];
    if (status && ALLOWED_STATUS.includes(status)) {
      where.push('qr.status = ?');
      values.push(status);
    }
    if (staleOnly && !isAggregate) {
      where.push("qr.status IN ('open','reviewing')");
      where.push('CAST(TIMESTAMPDIFF(HOUR, qr.created_at, NOW()) AS SIGNED) >= ?');
      values.push(staleHours);
    }
    const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let rows = [];
    let countRows = [];
    if (isAggregate) {
      const highRiskExpr = `(
                SUM(CASE WHEN qr.status = 'open' THEN 1 ELSE 0 END) * 100 +
                SUM(CASE WHEN qr.status = 'reviewing' THEN 1 ELSE 0 END) * 40 +
                SUM(CASE WHEN qr.created_at >= (NOW() - INTERVAL 7 DAY) THEN 1 ELSE 0 END) * 20 +
                COUNT(*) * 5
              )`;
      const havingParts = [];
      if (highRiskOnly) havingParts.push(`${highRiskExpr} >= 200`);
      if (staleOnly) havingParts.push(`${STALE_AGG_EXPR} >= ?`);
      const havingClause = havingParts.length ? `HAVING ${havingParts.join(' AND ')}` : '';
      const aggregateExtraValues = staleOnly ? [staleHours] : [];
      // 优先级评分：待处理数量、处理中数量、近 7 天新增、历史总量综合打分。
      let aggregateOrderBy = `priorityScore ${sortOrder}, latestReportedAt DESC`;
      if (sortBy === 'reportCount') {
        aggregateOrderBy = `reportCount ${sortOrder}, latestReportedAt DESC`;
      } else if (sortBy === 'latestReportedAt') {
        aggregateOrderBy = `latestReportedAt ${sortOrder}`;
      }
      [rows] = await pool.query(
        `SELECT
            qr.question_id AS questionId,
            MAX(qr.id) AS latestReportId,
            MAX(CASE WHEN qr.status IN ('open', 'reviewing') THEN qr.id ELSE 0 END) AS latestActiveReportId,
            MAX(qr.created_at) AS latestReportedAt,
            COUNT(*) AS reportCount,
            SUM(CASE WHEN qr.created_at >= (NOW() - INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS recent7dCount,
            SUM(CASE WHEN qr.status = 'open' THEN 1 ELSE 0 END) AS openCount,
            SUM(CASE WHEN qr.status = 'reviewing' THEN 1 ELSE 0 END) AS reviewingCount,
            SUM(CASE WHEN qr.status = 'closed' THEN 1 ELSE 0 END) AS closedCount,
            ${STALE_AGG_EXPR} AS stalestActiveHours,
            ${highRiskExpr} AS priorityScore,
            CASE
              WHEN ${highRiskExpr} >= 200 THEN 'high'
              WHEN ${highRiskExpr} >= 80 THEN 'medium'
              ELSE 'low'
            END AS priorityLevel,
            q.stem, q.question_type AS questionType, q.status AS questionStatus, q.is_deleted AS questionDeleted
         FROM question_reports qr
         JOIN questions q ON q.id = qr.question_id
         ${wc}
         GROUP BY qr.question_id, q.stem, q.question_type, q.status, q.is_deleted
         ${havingClause}
         ORDER BY ${aggregateOrderBy}
         LIMIT ? OFFSET ?`,
        [...values, ...aggregateExtraValues, pageSize, offset]
      );
      [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM (
           SELECT qr.question_id
           FROM question_reports qr
           ${wc}
           GROUP BY qr.question_id
           ${havingClause}
         ) t`,
        [...values, ...aggregateExtraValues]
      );
    } else {
      [rows] = await pool.query(
        `SELECT qr.id, qr.student_id AS studentId, qr.question_id AS questionId, qr.reason_type AS reasonType,
                qr.detail, qr.status, qr.admin_note AS adminNote, qr.created_at AS createdAt, qr.updated_at AS updatedAt,
                ${STALE_ACTIVE_AGE_EXPR} AS activeAgeHours,
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
      sortBy: isAggregate ? (sortBy === 'reportCount' || sortBy === 'latestReportedAt' ? sortBy : 'priorityScore') : null,
      sortOrder: isAggregate ? sortOrder.toLowerCase() : null,
      highRiskOnly: isAggregate ? highRiskOnly : null,
      staleOnly,
      staleHours,
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

/** 批量处理工单 */
router.post('/batch', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0) : [];
  const action = String(req.body?.action || '').trim();
  const statusRaw = req.body?.status;
  const adminNoteRaw = req.body?.adminNote;
  if (!ids.length) {
    res.status(400).json({ message: 'ids 不能为空' });
    return;
  }
  if (!action || !['setStatus', 'setNote', 'markFixNeeded'].includes(action)) {
    res.status(400).json({ message: 'action 仅支持 setStatus / setNote / markFixNeeded' });
    return;
  }
  if (action === 'markFixNeeded' && req.user?.role !== 'admin') {
    res.status(403).json({ message: '当前账号无权限执行该操作' });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const placeholders = ids.map(() => '?').join(',');
    let affected = 0;
    let archivedCount = 0;
    if (action === 'setStatus') {
      const status = String(statusRaw || '').trim();
      if (!ALLOWED_STATUS.includes(status)) {
        await conn.rollback();
        res.status(400).json({ message: 'status 仅支持 open / reviewing / closed' });
        return;
      }
      const [result] = await conn.query(
        `UPDATE question_reports SET status = ?, updated_at = NOW() WHERE id IN (${placeholders})`,
        [status, ...ids]
      );
      affected = Number(result.affectedRows || 0);
    } else if (action === 'setNote') {
      const adminNote = String(adminNoteRaw || '').trim().slice(0, 500);
      const [result] = await conn.query(
        `UPDATE question_reports SET admin_note = ?, updated_at = NOW() WHERE id IN (${placeholders})`,
        [adminNote, ...ids]
      );
      affected = Number(result.affectedRows || 0);
    } else if (action === 'markFixNeeded') {
      const adminNote = String(adminNoteRaw || '批量标记待修复并暂时下架').trim().slice(0, 500);
      const [rows] = await conn.query(
        `SELECT qr.id, qr.question_id AS questionId, qr.status, q.is_deleted AS questionDeleted
         FROM question_reports qr
         LEFT JOIN questions q ON q.id = qr.question_id
         WHERE qr.id IN (${placeholders})
         FOR UPDATE`,
        ids
      );
      const validRows = rows.filter((r) => r.status !== 'closed');
      const questionIds = [...new Set(validRows.map((r) => Number(r.questionId)).filter((x) => x > 0))];
      if (questionIds.length) {
        const qPlaceholders = questionIds.map(() => '?').join(',');
        const [updQ] = await conn.query(
          `UPDATE questions SET status = 'archived', updated_at = NOW()
           WHERE id IN (${qPlaceholders}) AND is_deleted = 0 AND status <> 'archived'`,
          questionIds
        );
        archivedCount = Number(updQ.affectedRows || 0);
      }
      const reportIds = validRows.map((r) => Number(r.id));
      if (reportIds.length) {
        const rPlaceholders = reportIds.map(() => '?').join(',');
        const [updR] = await conn.query(
          `UPDATE question_reports
           SET status = 'reviewing', admin_note = ?, updated_at = NOW()
           WHERE id IN (${rPlaceholders})`,
          [adminNote, ...reportIds]
        );
        affected = Number(updR.affectedRows || 0);
      }
    }

    await conn.commit();
    res.json({ ok: true, action, affected, archivedCount });
  } catch (error) {
    await conn.rollback();
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'question_reports 表不存在，请执行 sql/question_reports_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '批量处理失败' });
  } finally {
    conn.release();
  }
});

/** 修复闭环：archived 题目重新上架，并关闭该题下所有未关闭工单（仅管理员） */
router.post('/republish-question', requireRole('admin'), async (req, res) => {
  const questionId = Number(req.body?.questionId);
  if (!questionId) {
    res.status(400).json({ message: 'questionId 必填' });
    return;
  }
  const adminNoteRaw = req.body?.adminNote;
  const defaultNote = '题目已修复并重新上架，关联工单已关闭';
  const adminNote =
    adminNoteRaw !== undefined && adminNoteRaw !== null && String(adminNoteRaw).trim() !== ''
      ? String(adminNoteRaw).trim().slice(0, 500)
      : defaultNote;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [qrows] = await conn.query(
      'SELECT id, status, is_deleted AS isDeleted FROM questions WHERE id = ? LIMIT 1 FOR UPDATE',
      [questionId]
    );
    if (qrows.length === 0) {
      await conn.rollback();
      res.status(404).json({ message: '题目不存在' });
      return;
    }
    const q = qrows[0];
    if (Number(q.isDeleted || 0) === 1) {
      await conn.rollback();
      res.status(400).json({ message: '题目已删除，无法上架' });
      return;
    }
    if (q.status !== 'archived') {
      await conn.rollback();
      res.status(400).json({ message: '仅 archived（待修复下架）题目可通过此接口重新上架' });
      return;
    }

    await conn.query(
      "UPDATE questions SET status = 'published', updated_at = NOW() WHERE id = ? LIMIT 1",
      [questionId]
    );
    const [repResult] = await conn.query(
      `UPDATE question_reports
       SET status = 'closed', admin_note = ?, updated_at = NOW()
       WHERE question_id = ? AND status IN ('open', 'reviewing')`,
      [adminNote, questionId]
    );
    const reportsClosed = Number(repResult.affectedRows || 0);

    await writeAuditLog(req.user, 'REPUBLISH_QUESTION', 'question', questionId, {
      reportsClosed,
    }, conn);

    await conn.commit();
    res.json({ ok: true, questionId, reportsClosed });
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

/** 标记待修复：题目下架为 archived，工单置为 reviewing（不删题，仅管理员） */
router.post('/:id/mark-fix-needed', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ message: 'invalid id' });
    return;
  }

  const adminNoteRaw = req.body?.adminNote;
  const defaultNote = '题目已标记待修复并暂时下架';
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
    let archivedNow = false;
    if (questionId && row.questionDeleted === 0) {
      const [upd] = await conn.query(
        "UPDATE questions SET status = 'archived', updated_at = NOW() WHERE id = ? AND is_deleted = 0 AND status <> 'archived'",
        [questionId]
      );
      archivedNow = upd.affectedRows > 0;
      if (archivedNow) {
        await writeAuditLog(req.user, 'ARCHIVE_QUESTION', 'question', questionId, { source: 'question_report' }, conn);
      }
    }

    await conn.query(
      `UPDATE question_reports
       SET status = 'reviewing', admin_note = ?, updated_at = NOW()
       WHERE id = ? LIMIT 1`,
      [adminNote, id]
    );
    await conn.commit();
    res.json({ ok: true, id, questionId: questionId || null, archivedNow });
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

/** 替换题目：将工单指向 replacementQuestionId，并关闭工单（不删除原题，仅管理员） */
router.post('/:id/replace-question', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const replacementQuestionId = Number(req.body?.replacementQuestionId);
  if (!id || !replacementQuestionId) {
    res.status(400).json({ message: 'invalid id or replacementQuestionId' });
    return;
  }
  const adminNoteRaw = req.body?.adminNote;
  const defaultNote = `已替换为题目 #${replacementQuestionId}`;
  const adminNote =
    adminNoteRaw !== undefined && adminNoteRaw !== null && String(adminNoteRaw).trim() !== ''
      ? String(adminNoteRaw).trim().slice(0, 500)
      : defaultNote;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT qr.id, qr.status AS reportStatus, qr.question_id AS questionId
       FROM question_reports qr
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

    const [targetRows] = await conn.query(
      "SELECT id FROM questions WHERE id = ? AND is_deleted = 0 AND status = 'published' LIMIT 1",
      [replacementQuestionId]
    );
    if (targetRows.length === 0) {
      await conn.rollback();
      res.status(400).json({ message: '替换题目不存在、已删除或未发布' });
      return;
    }

    await conn.query(
      `UPDATE question_reports
       SET status = 'closed', question_id = ?, admin_note = ?, updated_at = NOW()
       WHERE id = ? LIMIT 1`,
      [replacementQuestionId, adminNote, id]
    );
    await writeAuditLog(
      req.user,
      'REPLACE_REPORTED_QUESTION',
      'question_report',
      id,
      { fromQuestionId: Number(row.questionId || 0), toQuestionId: replacementQuestionId },
      conn
    );
    await conn.commit();
    res.json({ ok: true, id, fromQuestionId: Number(row.questionId || 0), toQuestionId: replacementQuestionId });
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
