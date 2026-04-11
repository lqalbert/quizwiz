import express from 'express';
import crypto from 'crypto';
import { pool } from '../db.js';

const router = express.Router();

function randomInviteCode() {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 8; i += 1) {
    s += chars[crypto.randomInt(chars.length)];
  }
  return s;
}

/** 为旧班级补邀请码；数据库未迁移 invite_code 列时返回 null */
async function ensureInviteCode(classId) {
  let rows;
  try {
    [rows] = await pool.query('SELECT invite_code FROM classes WHERE id = ?', [classId]);
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') return null;
    throw e;
  }
  try {
    if (!rows.length) return null;
    if (rows[0].invite_code) return rows[0].invite_code;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const code = randomInviteCode();
      try {
        const [r] = await pool.query(
          'UPDATE classes SET invite_code = ? WHERE id = ? AND (invite_code IS NULL OR invite_code = "")',
          [code, classId]
        );
        if (r.affectedRows > 0) return code;
        const [chk] = await pool.query('SELECT invite_code FROM classes WHERE id = ?', [classId]);
        if (chk[0]?.invite_code) return chk[0].invite_code;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') continue;
        if (e.code === 'ER_BAD_FIELD_ERROR') return null;
        throw e;
      }
    }
    return null;
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') return null;
    throw e;
  }
}

function parseDays(raw, def = 7) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(366, Math.floor(n));
}

function parseLimit(raw, def = 20, max = 100) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(max, Math.floor(n));
}

/** 班级作业完成率与未完成学生 id（依赖 class_assignments_v1.sql） */
async function buildAssignmentsSummary(classId) {
  try {
    const [assignRows] = await pool.query(
      `SELECT ca.id, ca.title, ca.due_at AS dueAt,
              (SELECT COUNT(*) FROM class_members m WHERE m.class_id = ca.class_id) AS memberCount,
              (SELECT COUNT(DISTINCT ps.student_id) FROM practice_sessions ps
               WHERE ps.assignment_id = ca.id AND ps.status = 'done') AS completedStudentCount
       FROM class_assignments ca
       WHERE ca.class_id = ?
       ORDER BY ca.id DESC
       LIMIT 20`,
      [classId]
    );
    if (!assignRows.length) {
      return { assignmentCount: 0, averageCompletionRate: null, items: [] };
    }
    const aids = assignRows.map((r) => r.id);
    const ph = aids.map(() => '?').join(',');
    const [pairs] = await pool.query(
      `SELECT ca.id AS assignmentId, m.student_id AS studentId
       FROM class_assignments ca
       INNER JOIN class_members m ON m.class_id = ca.class_id
       WHERE ca.id IN (${ph})
         AND NOT EXISTS (
           SELECT 1 FROM practice_sessions ps
           WHERE ps.assignment_id = ca.id AND ps.student_id = m.student_id AND ps.status = 'done'
         )`,
      aids
    );
    const incompleteByAid = new Map();
    for (const p of pairs) {
      const aid = Number(p.assignmentId);
      if (!incompleteByAid.has(aid)) incompleteByAid.set(aid, []);
      incompleteByAid.get(aid).push(Number(p.studentId));
    }
    for (const arr of incompleteByAid.values()) {
      arr.sort((a, b) => a - b);
    }
    const items = assignRows.map((r) => {
      const mc = Number(r.memberCount || 0);
      const cc = Number(r.completedStudentCount || 0);
      const rate = mc > 0 ? Math.round((cc / mc) * 10000) / 10000 : null;
      const inc = incompleteByAid.get(Number(r.id)) || [];
      return {
        assignmentId: r.id,
        title: r.title,
        dueAt: r.dueAt,
        memberCount: mc,
        completedStudentCount: cc,
        completionRate: rate,
        incompleteCount: inc.length,
        incompleteStudentIds: inc,
      };
    });
    const rates = items.map((i) => i.completionRate).filter((x) => x != null);
    const averageCompletionRate =
      rates.length > 0
        ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10000) / 10000
        : null;
    return {
      assignmentCount: items.length,
      averageCompletionRate,
      items,
    };
  } catch (e) {
    if (e?.code === 'ER_NO_SUCH_TABLE') {
      return { assignmentCount: 0, averageCompletionRate: null, items: [], homeworkTableMissing: true };
    }
    throw e;
  }
}

async function getAccessibleClass(req, classId) {
  const id = Number(classId);
  if (!id) return null;
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT id, owner_user_id AS ownerUserId, name, invite_code AS inviteCode,
              created_at AS createdAt, updated_at AS updatedAt
       FROM classes WHERE id = ? LIMIT 1`,
      [id]
    );
  } catch (error) {
    if (error?.code === 'ER_BAD_FIELD_ERROR') {
      [rows] = await pool.query(
        `SELECT id, owner_user_id AS ownerUserId, name, created_at AS createdAt, updated_at AS updatedAt
         FROM classes WHERE id = ? LIMIT 1`,
        [id]
      );
      if (rows.length) rows[0].inviteCode = null;
    } else {
      throw error;
    }
  }
  if (!rows.length) return null;
  const row = rows[0];
  if (req.user.role !== 'admin' && Number(row.ownerUserId) !== Number(req.user.id)) {
    return 'forbidden';
  }
  return row;
}

/** GET / 班级列表 */
router.get('/', async (req, res) => {
  try {
    let sql = `SELECT c.id, c.owner_user_id AS ownerUserId, c.name, c.invite_code AS inviteCode,
                      c.created_at AS createdAt,
                      (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS memberCount
               FROM classes c`;
    const values = [];
    if (req.user.role !== 'admin') {
      sql += ' WHERE c.owner_user_id = ?';
      values.push(req.user.id);
    }
    sql += ' ORDER BY c.id DESC';
    let rows;
    try {
      [rows] = await pool.query(sql, values);
    } catch (error) {
      if (error?.code === 'ER_BAD_FIELD_ERROR') {
        let fallbackSql = `SELECT c.id, c.owner_user_id AS ownerUserId, c.name, c.created_at AS createdAt,
                      (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS memberCount
               FROM classes c`;
        const fbValues = [];
        if (req.user.role !== 'admin') {
          fallbackSql += ' WHERE c.owner_user_id = ?';
          fbValues.push(req.user.id);
        }
        fallbackSql += ' ORDER BY c.id DESC';
        [rows] = await pool.query(fallbackSql, fbValues);
      } else {
        throw error;
      }
    }
    const data = await Promise.all(
      rows.map(async (row) => {
        const inviteCode = row.inviteCode || (await ensureInviteCode(row.id));
        return {
          id: row.id,
          ownerUserId: row.ownerUserId,
          name: row.name,
          inviteCode: inviteCode || null,
          createdAt: row.createdAt,
          memberCount: row.memberCount,
        };
      })
    );
    res.json({ ok: true, data });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'classes 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载班级失败' });
  }
});

/** POST / 创建班级 */
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 128) {
    res.status(400).json({ message: '班级名称必填且不超过 128 字' });
    return;
  }
  try {
    for (let i = 0; i < 25; i += 1) {
      const code = randomInviteCode();
      try {
        const [r] = await pool.query(
          `INSERT INTO classes (owner_user_id, name, invite_code) VALUES (?, ?, ?)`,
          [req.user.id, name, code]
        );
        res.status(201).json({ ok: true, id: r.insertId, name, inviteCode: code });
        return;
      } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') continue;
        if (error?.code === 'ER_BAD_FIELD_ERROR') {
          const [r2] = await pool.query(`INSERT INTO classes (owner_user_id, name) VALUES (?, ?)`, [
            req.user.id,
            name,
          ]);
          res.status(201).json({
            ok: true,
            id: r2.insertId,
            name,
            inviteCode: null,
            hint: '请执行 sql/classes_invite_code_v1.sql 后重新创建班级以启用邀请码',
          });
          return;
        }
        throw error;
      }
    }
    res.status(500).json({ message: '创建失败：邀请码冲突过多，请重试' });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'classes 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '创建失败' });
  }
});

/** GET /:id 详情 */
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权访问该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [mc] = await pool.query(
      `SELECT COUNT(*) AS c FROM class_members WHERE class_id = ?`,
      [c.id]
    );
    const inviteCode = c.inviteCode || (await ensureInviteCode(c.id));
    res.json({
      ok: true,
      class: {
        id: c.id,
        ownerUserId: c.ownerUserId,
        name: c.name,
        inviteCode: inviteCode || null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        memberCount: Number(mc[0]?.c || 0),
      },
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'classes 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载失败' });
  }
});

/** PATCH /:id */
router.patch('/:id(\\d+)', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 128) {
    res.status(400).json({ message: '班级名称必填且不超过 128 字' });
    return;
  }
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权操作该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    await pool.query(`UPDATE classes SET name = ? WHERE id = ?`, [name, c.id]);
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'classes 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '更新失败' });
  }
});

/** DELETE /:id */
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权操作该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    await pool.query(`DELETE FROM classes WHERE id = ?`, [c.id]);
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'classes 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '删除失败' });
  }
});

/** GET /:id/members */
router.get('/:id(\\d+)/members', async (req, res) => {
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权访问该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [rows] = await pool.query(
      `SELECT m.student_id AS studentId, m.note, m.created_at AS joinedAt
       FROM class_members m
       WHERE m.class_id = ?
       ORDER BY m.student_id ASC`,
      [c.id]
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'class_members 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载成员失败' });
  }
});

/** POST /:id/members body: { studentId, note? } */
router.post('/:id(\\d+)/members', async (req, res) => {
  const studentId = Number(req.body?.studentId);
  const note = req.body?.note != null ? String(req.body.note).slice(0, 64) : null;
  if (!studentId) {
    res.status(400).json({ message: 'studentId 无效（需为 wx_students.id）' });
    return;
  }
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权操作该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [st] = await pool.query(`SELECT id FROM wx_students WHERE id = ? LIMIT 1`, [studentId]);
    if (!st.length) {
      res.status(400).json({ message: '学生不存在，请确认小程序用户 id' });
      return;
    }
    await pool.query(
      `INSERT INTO class_members (class_id, student_id, note) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE note = VALUES(note)`,
      [c.id, studentId, note]
    );
    res.status(201).json({ ok: true, classId: c.id, studentId });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'class_members 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '添加成员失败' });
  }
});

/** DELETE /:id/members/:studentId */
router.delete('/:id(\\d+)/members/:studentId(\\d+)', async (req, res) => {
  const studentId = Number(req.params.studentId);
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权操作该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [r] = await pool.query(
      `DELETE FROM class_members WHERE class_id = ? AND student_id = ?`,
      [c.id, studentId]
    );
    if (!r.affectedRows) {
      res.status(404).json({ message: '该学生不在班级中' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'class_members 表不存在，请执行 sql/classes_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '移除失败' });
  }
});

/** GET /:id/dashboard?days=7 */
router.get('/:id(\\d+)/dashboard', async (req, res) => {
  const days = parseDays(req.query.days, 7);
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权访问该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [memberRows] = await pool.query(
      `SELECT student_id AS studentId FROM class_members WHERE class_id = ?`,
      [c.id]
    );
    const ids = memberRows.map((x) => Number(x.studentId));
    if (!ids.length) {
      res.json({
        ok: true,
        classId: c.id,
        days,
        overview: {
          memberCount: 0,
          activeStudentCount: 0,
          totalAttempts: 0,
          correctCount: 0,
          wrongCount: 0,
          accuracy: null,
          sessionsDone: 0,
        },
        byStudent: [],
        daily: [],
      });
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    const rangeParams = [...ids, days];

    const [agg] = await pool.query(
      `SELECT
          COUNT(DISTINCT pa.student_id) AS activeStudentCount,
          COUNT(*) AS totalAttempts,
          SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END) AS correctCount,
          SUM(CASE WHEN pa.is_correct = 0 THEN 1 ELSE 0 END) AS wrongCount
       FROM practice_answers pa
       WHERE pa.student_id IN (${placeholders})
         AND pa.created_at >= (NOW() - INTERVAL ? DAY)`,
      rangeParams
    );
    const row = agg[0] || {};
    const totalAttempts = Number(row.totalAttempts || 0);
    const correctCount = Number(row.correctCount || 0);
    const wrongCount = Number(row.wrongCount || 0);
    const accuracy = totalAttempts > 0 ? correctCount / totalAttempts : null;

    const [sess] = await pool.query(
      `SELECT COUNT(*) AS c FROM practice_sessions
       WHERE student_id IN (${placeholders})
         AND status = 'done'
         AND COALESCE(submitted_at, updated_at) >= (NOW() - INTERVAL ? DAY)`,
      rangeParams
    );

    const [dailyRows] = await pool.query(
      `SELECT DATE(pa.created_at) AS d,
              COUNT(*) AS attempts,
              SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM practice_answers pa
       WHERE pa.student_id IN (${placeholders})
         AND pa.created_at >= (NOW() - INTERVAL ? DAY)
       GROUP BY DATE(pa.created_at)
       ORDER BY d ASC`,
      rangeParams
    );

    const [byStudentRows] = await pool.query(
      `SELECT pa.student_id AS studentId,
              COUNT(*) AS attempts,
              SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM practice_answers pa
       WHERE pa.student_id IN (${placeholders})
         AND pa.created_at >= (NOW() - INTERVAL ? DAY)
       GROUP BY pa.student_id
       ORDER BY attempts DESC`,
      rangeParams
    );
    const byStudent = byStudentRows.map((x) => {
      const att = Number(x.attempts || 0);
      const cor = Number(x.correct || 0);
      return {
        studentId: x.studentId,
        attempts: att,
        correct: cor,
        accuracy: att > 0 ? Math.round((cor / att) * 10000) / 10000 : null,
      };
    });

    const assignmentsSummary = await buildAssignmentsSummary(c.id);

    res.json({
      ok: true,
      classId: c.id,
      days,
      overview: {
        memberCount: ids.length,
        activeStudentCount: Number(row.activeStudentCount || 0),
        totalAttempts,
        correctCount,
        wrongCount,
        accuracy: accuracy == null ? null : Math.round(accuracy * 10000) / 10000,
        sessionsDone: Number(sess[0]?.c || 0),
      },
      byStudent,
      daily: dailyRows.map((x) => ({
        date: String(x.d).slice(0, 10),
        attempts: Number(x.attempts || 0),
        correct: Number(x.correct || 0),
      })),
      assignmentsSummary,
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: '练习相关表不存在，请执行 sql/schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载看板失败' });
  }
});

/** GET /:id/wrong-questions?days=30&limit=20 */
router.get('/:id(\\d+)/wrong-questions', async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const limit = parseLimit(req.query.limit, 20, 50);
  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权访问该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [memberRows] = await pool.query(
      `SELECT student_id AS studentId FROM class_members WHERE class_id = ?`,
      [c.id]
    );
    const ids = memberRows.map((x) => Number(x.studentId));
    if (!ids.length) {
      res.json({ ok: true, classId: c.id, days, limit, data: [] });
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    const params = [...ids, days, limit];
    const [rows] = await pool.query(
      `SELECT
          pa.question_id AS questionId,
          COUNT(*) AS attemptCount,
          SUM(CASE WHEN pa.is_correct = 0 THEN 1 ELSE 0 END) AS wrongCount,
          SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END) AS correctCount
       FROM practice_answers pa
       WHERE pa.student_id IN (${placeholders})
         AND pa.created_at >= (NOW() - INTERVAL ? DAY)
       GROUP BY pa.question_id
       HAVING wrongCount > 0
       ORDER BY wrongCount DESC, attemptCount DESC
       LIMIT ?`,
      params
    );

    const qids = rows.map((r) => r.questionId);
    let stemMap = new Map();
    if (qids.length) {
      const [qrows] = await pool.query(
        `SELECT id, stem, question_type AS questionType FROM questions WHERE id IN (${qids.map(() => '?').join(',')})`,
        qids
      );
      stemMap = new Map(qrows.map((q) => [q.id, q]));
    }

    const data = rows.map((r) => {
      const attemptCount = Number(r.attemptCount || 0);
      const wrongCount = Number(r.wrongCount || 0);
      const q = stemMap.get(r.questionId);
      return {
        questionId: r.questionId,
        attemptCount,
        wrongCount,
        correctCount: Number(r.correctCount || 0),
        wrongRate: attemptCount > 0 ? Math.round((wrongCount / attemptCount) * 10000) / 10000 : null,
        stem: q ? String(q.stem || '').slice(0, 200) : '',
        questionType: q?.questionType || null,
      };
    });

    res.json({ ok: true, classId: c.id, days, limit, data });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: '练习相关表不存在，请执行 sql/schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载易错题失败' });
  }
});

/** GET /:id/students/:studentId/timeline?days=30&page=1&pageSize=50 */
router.get('/:id(\\d+)/students/:studentId(\\d+)/timeline', async (req, res) => {
  const studentId = Number(req.params.studentId);
  const days = parseDays(req.query.days, 30);
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 50)));
  const offset = (page - 1) * pageSize;

  try {
    const c = await getAccessibleClass(req, req.params.id);
    if (c === 'forbidden') {
      res.status(403).json({ message: '无权访问该班级' });
      return;
    }
    if (!c) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [mem] = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = ? AND student_id = ? LIMIT 1`,
      [c.id, studentId]
    );
    if (!mem.length) {
      res.status(403).json({ message: '该学生不在本班级中' });
      return;
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM practice_answers pa
       WHERE pa.student_id = ?
         AND pa.created_at >= (NOW() - INTERVAL ? DAY)`,
      [studentId, days]
    );
    const total = Number(countRows[0]?.c || 0);

    const [rows] = await pool.query(
      `SELECT pa.id AS answerId, pa.created_at AS createdAt, pa.question_id AS questionId,
              pa.is_correct AS isCorrect, pa.selected_letters AS selectedLetters,
              pa.cost_ms AS costMs,
              ps.id AS sessionId, ps.mode AS sessionMode, ps.status AS sessionStatus,
              q.stem, q.question_type AS questionType,
              subj.name AS subjectName
       FROM practice_answers pa
       INNER JOIN practice_sessions ps ON ps.id = pa.session_id
       INNER JOIN questions q ON q.id = pa.question_id
       LEFT JOIN subjects subj ON subj.id = ps.subject_id
       WHERE pa.student_id = ?
         AND pa.created_at >= (NOW() - INTERVAL ? DAY)
       ORDER BY pa.created_at DESC
       LIMIT ? OFFSET ?`,
      [studentId, days, pageSize, offset]
    );

    res.json({
      ok: true,
      classId: c.id,
      studentId,
      days,
      page,
      pageSize,
      total,
      data: rows.map((r) => ({
        answerId: r.answerId,
        createdAt: r.createdAt,
        questionId: r.questionId,
        isCorrect: Number(r.isCorrect) === 1,
        selectedLetters: r.selectedLetters,
        costMs: r.costMs,
        sessionId: r.sessionId,
        sessionMode: r.sessionMode,
        sessionStatus: r.sessionStatus,
        stem: String(r.stem || '').slice(0, 300),
        questionType: r.questionType,
        subjectName: r.subjectName,
      })),
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: '练习相关表不存在，请执行 sql/schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载时间线失败' });
  }
});

export default router;
