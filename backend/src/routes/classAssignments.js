import express from 'express';
import { pool } from '../db.js';

const router = express.Router({ mergeParams: true });

async function loadClassForTeacher(req, classId) {
  const id = Number(classId);
  if (!id) return null;
  const [rows] = await pool.query(
    `SELECT id, owner_user_id AS ownerUserId FROM classes WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (req.user.role !== 'admin' && Number(row.ownerUserId) !== Number(req.user.id)) {
    return 'forbidden';
  }
  return row;
}

/** GET / 作业列表 */
router.get('/', async (req, res) => {
  const classId = Number(req.params.classId);
  try {
    const access = await loadClassForTeacher(req, classId);
    if (access === 'forbidden') {
      res.status(403).json({ message: '无权访问该班级' });
      return;
    }
    if (!access) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [rows] = await pool.query(
      `SELECT ca.id, ca.title, ca.description, ca.due_at AS dueAt, ca.created_at AS createdAt,
              (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = ca.id) AS questionCount,
              (SELECT COUNT(*) FROM class_members m WHERE m.class_id = ca.class_id) AS memberCount,
              (SELECT COUNT(DISTINCT ps.student_id) FROM practice_sessions ps
                 WHERE ps.assignment_id = ca.id AND ps.status = 'done') AS completedStudentCount
       FROM class_assignments ca
       WHERE ca.class_id = ?
       ORDER BY ca.id DESC`,
      [classId]
    );
    const aids = rows.map((r) => r.id);
    let incompleteByAid = new Map();
    if (aids.length) {
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
      for (const p of pairs) {
        const aid = Number(p.assignmentId);
        if (!incompleteByAid.has(aid)) incompleteByAid.set(aid, []);
        incompleteByAid.get(aid).push(Number(p.studentId));
      }
      for (const arr of incompleteByAid.values()) {
        arr.sort((a, b) => a - b);
      }
    }
    res.json({
      ok: true,
      data: rows.map((r) => {
        const mc = Number(r.memberCount || 0);
        const cc = Number(r.completedStudentCount || 0);
        const rate = mc > 0 ? Math.round((cc / mc) * 10000) / 10000 : null;
        const inc = incompleteByAid.get(Number(r.id)) || [];
        return {
          id: r.id,
          title: r.title,
          description: r.description,
          dueAt: r.dueAt,
          createdAt: r.createdAt,
          questionCount: Number(r.questionCount || 0),
          memberCount: mc,
          completedStudentCount: cc,
          completionRate: rate,
          incompleteCount: inc.length,
          incompleteStudentIds: inc,
        };
      }),
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: '作业表不存在，请执行 sql/class_assignments_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载作业失败' });
  }
});

/** POST / 布置作业 */
router.post('/', async (req, res) => {
  const classId = Number(req.params.classId);
  const title = String(req.body?.title || '').trim();
  const description = req.body?.description != null ? String(req.body.description).trim().slice(0, 2000) : null;
  const dueRaw = req.body?.dueAt;
  let dueAt = null;
  if (dueRaw !== undefined && dueRaw !== null && String(dueRaw).trim() !== '') {
    const d = new Date(String(dueRaw));
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ message: 'dueAt 时间格式无效' });
      return;
    }
    dueAt = d.toISOString().slice(0, 19).replace('T', ' ');
  }
  const qids = Array.isArray(req.body?.questionIds) ? req.body.questionIds : [];
  const questionIds = [...new Set(qids.map((x) => Number(x)).filter((n) => n > 0))];
  if (!title || title.length > 255) {
    res.status(400).json({ message: '标题必填且不超过 255 字' });
    return;
  }
  if (questionIds.length < 1 || questionIds.length > 100) {
    res.status(400).json({ message: 'questionIds 需为 1～100 个题目 id' });
    return;
  }

  const conn = await pool.getConnection();
  try {
    const access = await loadClassForTeacher(req, classId);
    if (access === 'forbidden') {
      res.status(403).json({ message: '无权操作该班级' });
      return;
    }
    if (!access) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }

    const placeholders = questionIds.map(() => '?').join(',');
    const [qrows] = await conn.query(
      `SELECT id FROM questions WHERE id IN (${placeholders}) AND is_deleted = 0 AND status = 'published'`,
      questionIds
    );
    const valid = new Set(qrows.map((r) => Number(r.id)));
    const missing = questionIds.filter((id) => !valid.has(id));
    if (missing.length) {
      res.status(400).json({ message: `以下题目无效或未发布：${missing.slice(0, 10).join(',')}` });
      return;
    }

    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO class_assignments (class_id, owner_user_id, title, description, due_at)
       VALUES (?, ?, ?, ?, ?)`,
      [classId, req.user.id, title, description || null, dueAt]
    );
    const assignmentId = ins.insertId;
    let order = 0;
    for (const qid of questionIds) {
      await conn.query(
        `INSERT INTO assignment_questions (assignment_id, question_id, sort_order) VALUES (?, ?, ?)`,
        [assignmentId, qid, order]
      );
      order += 1;
    }
    await conn.commit();
    res.status(201).json({ ok: true, id: assignmentId, classId, questionCount: questionIds.length });
  } catch (error) {
    await conn.rollback();
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: '作业表不存在，请执行 sql/class_assignments_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '创建作业失败' });
  } finally {
    conn.release();
  }
});

/** GET /:assignmentId 完成情况明细 */
router.get('/:assignmentId(\\d+)', async (req, res) => {
  const classId = Number(req.params.classId);
  const assignmentId = Number(req.params.assignmentId);
  try {
    const access = await loadClassForTeacher(req, classId);
    if (access === 'forbidden') {
      res.status(403).json({ message: '无权访问该班级' });
      return;
    }
    if (!access) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [arows] = await pool.query(
      `SELECT id, title, description, due_at AS dueAt, created_at AS createdAt
       FROM class_assignments WHERE id = ? AND class_id = ? LIMIT 1`,
      [assignmentId, classId]
    );
    if (!arows.length) {
      res.status(404).json({ message: '作业不存在' });
      return;
    }
    const a = arows[0];
    const [members] = await pool.query(
      `SELECT m.student_id AS studentId, m.note,
              (SELECT MAX(ps.submitted_at) FROM practice_sessions ps
               WHERE ps.assignment_id = ? AND ps.student_id = m.student_id AND ps.status = 'done') AS submittedAt,
              IF((SELECT COUNT(*) FROM practice_sessions ps
                  WHERE ps.assignment_id = ? AND ps.student_id = m.student_id AND ps.status = 'done') > 0, 1, 0) AS completed
       FROM class_members m
       WHERE m.class_id = ?
       ORDER BY m.student_id ASC`,
      [assignmentId, assignmentId, classId]
    );
    const memDtos = members.map((m) => ({
      studentId: m.studentId,
      note: m.note,
      completed: Number(m.completed) === 1,
      submittedAt: m.submittedAt,
    }));
    const mc = memDtos.length;
    const cc = memDtos.filter((x) => x.completed).length;
    const incompleteStudentIds = memDtos.filter((x) => !x.completed).map((x) => x.studentId);
    res.json({
      ok: true,
      assignment: {
        id: a.id,
        title: a.title,
        description: a.description,
        dueAt: a.dueAt,
        createdAt: a.createdAt,
      },
      memberCount: mc,
      completedStudentCount: cc,
      completionRate: mc > 0 ? Math.round((cc / mc) * 10000) / 10000 : null,
      incompleteStudentIds,
      members: memDtos,
    });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: '作业表不存在，请执行 sql/class_assignments_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载失败' });
  }
});

/** DELETE /:assignmentId */
router.delete('/:assignmentId(\\d+)', async (req, res) => {
  const classId = Number(req.params.classId);
  const assignmentId = Number(req.params.assignmentId);
  try {
    const access = await loadClassForTeacher(req, classId);
    if (access === 'forbidden') {
      res.status(403).json({ message: '无权操作该班级' });
      return;
    }
    if (!access) {
      res.status(404).json({ message: '班级不存在' });
      return;
    }
    const [r] = await pool.query(
      `DELETE FROM class_assignments WHERE id = ? AND class_id = ?`,
      [assignmentId, classId]
    );
    if (!r.affectedRows) {
      res.status(404).json({ message: '作业不存在' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: '作业表不存在' });
      return;
    }
    res.status(500).json({ message: error.message || '删除失败' });
  }
});

export default router;
