import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { config } from '../config.js';
import { codeToSession } from '../services/wxMiniAuth.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';

const router = express.Router();

function normalizeSelectedLetters(input) {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .map((x) => String(x || '').trim().toUpperCase())
    .filter((x) => ['A', 'B', 'C', 'D'].includes(x));
  return [...new Set(normalized)].sort();
}

function parseAnswerLetters(answerLetters) {
  return String(answerLetters || '')
    .split(/[,\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter((x) => ['A', 'B', 'C', 'D'].includes(x))
    .sort();
}

function sameLetterSet(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeChapters(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((x) => String(x || '').trim()).filter(Boolean))];
}

function buildQuestionDto(row) {
  return {
    id: row.id,
    questionType: row.questionType,
    stem: row.stem,
    chapter: row.chapter,
    difficulty: row.difficulty,
    options: [
      { letter: 'A', text: row.optionA },
      { letter: 'B', text: row.optionB },
      row.optionC ? { letter: 'C', text: row.optionC } : null,
      row.optionD ? { letter: 'D', text: row.optionD } : null,
    ].filter(Boolean),
  };
}

function isTableMissing(error) {
  return error?.code === 'ER_NO_SUCH_TABLE' || String(error?.message || '').includes("doesn't exist");
}

function isUnknownColumn(error, columnName) {
  if (error?.code !== 'ER_BAD_FIELD_ERROR') return false;
  return String(error?.message || '').includes(String(columnName || ''));
}

function buildPracticeStatsBucket(attempted, correct, sessions) {
  const a = Number(attempted || 0);
  const c = Number(correct || 0);
  const s = Number(sessions || 0);
  return {
    attempted: a,
    correct: c,
    sessions: s,
    accuracy: a > 0 ? Number(((c / a) * 100).toFixed(1)) : 0,
  };
}

function mapSubjectStatRows(rows) {
  return (rows || []).map((row, i) => {
    const attempted = Number(row.attempted || 0);
    const correct = Number(row.correct || 0);
    const sessions = Number(row.sessions || 0);
    const sid = row.subjectId === null || row.subjectId === undefined ? null : Number(row.subjectId);
    return {
      statsKey: `${sid ?? 'x'}-${i}`,
      subjectId: sid,
      subjectName: String(row.subjectName || '未指定学科'),
      ...buildPracticeStatsBucket(attempted, correct, sessions),
    };
  });
}

async function loadPracticeStatsBySubject(studentId, range) {
  let dateCond = '1=1';
  if (range === 'today') dateCond = 'DATE(ps.submitted_at) = CURDATE()';
  if (range === 'week') dateCond = 'ps.submitted_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';

  const [rows] = await pool.query(
    `SELECT ps.subject_id AS subjectId,
            COALESCE(MAX(s.name), '未指定学科') AS subjectName,
            COALESCE(SUM(ps.submitted_count), 0) AS attempted,
            COALESCE(SUM(ps.correct_count), 0) AS correct,
            COUNT(*) AS sessions
     FROM practice_sessions ps
     LEFT JOIN subjects s ON s.id = ps.subject_id
     WHERE ps.student_id = ?
       AND ps.status = 'done'
       AND ps.submitted_at IS NOT NULL
       AND (${dateCond})
     GROUP BY ps.subject_id
     ORDER BY attempted DESC`,
    [studentId]
  );
  return mapSubjectStatRows(rows);
}

async function attachFavoriteFlags(studentId, questionDtos) {
  if (!questionDtos.length) return questionDtos;
  const ids = [...new Set(questionDtos.map((q) => Number(q.id)).filter((x) => x > 0))];
  if (ids.length === 0) return questionDtos.map((q) => ({ ...q, isFavorite: false }));
  try {
    const [rows] = await pool.query(
      'SELECT question_id AS questionId FROM question_favorites WHERE student_id = ? AND question_id IN (?)',
      [studentId, ids]
    );
    const set = new Set(rows.map((r) => Number(r.questionId)));
    return questionDtos.map((q) => ({ ...q, isFavorite: set.has(Number(q.id)) }));
  } catch (e) {
    if (isTableMissing(e)) return questionDtos.map((q) => ({ ...q, isFavorite: false }));
    throw e;
  }
}

async function loadQuestionsForPractice({
  studentId = null,
  mode = 'random',
  subjectId = null,
  chapters = [],
  difficulty = null,
  limit = 10,
  priorityOnly = false,
}) {
  const where = ['q.is_deleted = 0', "q.status = 'published'"];
  const values = [];

  let joinClause = '';
  if (mode === 'wrong') {
    if (!studentId) {
      throw new Error('studentId is required for wrong mode');
    }
    joinClause += ' JOIN wrong_questions wq ON wq.question_id = q.id ';
    where.push('wq.student_id = ?');
    values.push(studentId);
    where.push('wq.mastered = 0');
    if (priorityOnly) {
      where.push('wq.is_priority = 1');
    }
  } else if (mode === 'favorite') {
    if (!studentId) {
      throw new Error('studentId is required for favorite mode');
    }
    joinClause += ' JOIN question_favorites qf ON qf.question_id = q.id ';
    where.push('qf.student_id = ?');
    values.push(studentId);
  }
  if (subjectId) {
    joinClause += ' JOIN question_subject_rel qsr ON qsr.question_id = q.id ';
    where.push('qsr.subject_id = ?');
    values.push(subjectId);
  }
  if (chapters.length > 0) {
    where.push(`q.chapter IN (${chapters.map(() => '?').join(',')})`);
    values.push(...chapters);
  }
  if (difficulty !== null) {
    where.push('q.difficulty = ?');
    values.push(difficulty);
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT q.id, q.question_type AS questionType, q.stem, q.option_a AS optionA, q.option_b AS optionB,
            q.option_c AS optionC, q.option_d AS optionD, q.chapter, q.difficulty
     FROM questions q
     ${joinClause}
     WHERE ${where.join(' AND ')}
     ORDER BY ${mode === 'sequential' ? 'q.id ASC' : 'RAND()'}
     LIMIT ?`,
    [...values, limit]
  );

  return rows.map(buildQuestionDto);
}

async function loadQuestionsForAssignment({ studentId, assignmentId }) {
  const aid = Number(assignmentId);
  if (!aid) {
    throw new Error('assignmentId 无效');
  }
  try {
    const [check] = await pool.query(
      `SELECT ca.id, ca.class_id AS classId
       FROM class_assignments ca
       INNER JOIN class_members m ON m.class_id = ca.class_id AND m.student_id = ?
       WHERE ca.id = ? LIMIT 1`,
      [studentId, aid]
    );
    if (!check.length) {
      throw new Error('作业不存在或您不在该班级中');
    }
    const [rows] = await pool.query(
      `SELECT q.id, q.question_type AS questionType, q.stem, q.option_a AS optionA, q.option_b AS optionB,
              q.option_c AS optionC, q.option_d AS optionD, q.chapter, q.difficulty
       FROM assignment_questions aq
       INNER JOIN questions q ON q.id = aq.question_id
       WHERE aq.assignment_id = ? AND q.is_deleted = 0 AND q.status = 'published'
       ORDER BY aq.sort_order ASC, aq.question_id ASC`,
      [aid]
    );
    if (!rows.length) {
      throw new Error('该作业暂无有效题目');
    }
    return rows.map(buildQuestionDto);
  } catch (error) {
    if (isTableMissing(error)) {
      throw new Error('班级作业未启用');
    }
    throw error;
  }
}

async function evaluateAnswers(answers) {
  const questionIds = [];
  const answerMap = new Map();
  for (const item of answers) {
    const questionId = Number(item?.questionId);
    if (!questionId) continue;
    if (!answerMap.has(questionId)) {
      questionIds.push(questionId);
    }
    answerMap.set(questionId, normalizeSelectedLetters(item?.selectedLetters));
  }
  if (questionIds.length === 0) {
    return {
      questionIds: [],
      details: [],
      score: 0,
    };
  }

  const [rows] = await pool.query(
    `SELECT id, question_type AS questionType, stem, answer_letters AS answerLetters, analysis
     FROM questions
     WHERE is_deleted = 0 AND status = 'published' AND id IN (?)`,
    [questionIds]
  );

  const resultById = new Map(rows.map((row) => [Number(row.id), row]));
  const details = [];
  let score = 0;

  for (const questionId of questionIds) {
    const question = resultById.get(questionId);
    if (!question) {
      details.push({
        questionId,
        isCorrect: false,
        reason: 'QUESTION_NOT_FOUND_OR_UNPUBLISHED',
      });
      continue;
    }
    const selectedLetters = answerMap.get(questionId) || [];
    const correctLetters = parseAnswerLetters(question.answerLetters);
    const isCorrect = sameLetterSet(selectedLetters, correctLetters);
    if (isCorrect) score += 1;
    details.push({
      questionId,
      questionType: question.questionType,
      stem: question.stem,
      selectedLetters,
      correctLetters,
      isCorrect,
      analysis: question.analysis || '',
    });
  }

  return {
    questionIds,
    details,
    score,
  };
}

async function upsertWxStudent(openid, unionid) {
  const [existing] = await pool.query(
    'SELECT id FROM wx_students WHERE openid = ? LIMIT 1',
    [openid]
  );
  if (existing.length > 0) {
    const id = existing[0].id;
    await pool.query(
      `UPDATE wx_students SET last_login_at = NOW(), unionid = COALESCE(?, unionid) WHERE id = ?`,
      [unionid || null, id]
    );
    return id;
  }
  const [result] = await pool.query(
    'INSERT INTO wx_students (openid, unionid) VALUES (?, ?)',
    [openid, unionid || null]
  );
  return result.insertId;
}

/** POST /wx/auth/login { code } */
router.post('/auth/login', async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code) {
    res.status(400).json({ message: '缺少 code，请先 wx.login' });
    return;
  }
  try {
    const session = await codeToSession(code);
    let studentId;
    try {
      studentId = await upsertWxStudent(session.openid, session.unionid);
    } catch (dbErr) {
      if (String(dbErr.message || '').includes("doesn't exist") || dbErr.code === 'ER_NO_SUCH_TABLE') {
        res.status(503).json({
          message: '数据库未初始化 wx_students 表，请在服务器执行 sql/wx_students_v1.sql',
        });
        return;
      }
      throw dbErr;
    }

    const token = jwt.sign({ sub: studentId, role: 'student' }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    res.json({
      token,
      user: {
        id: studentId,
        role: 'student',
      },
    });
  } catch (error) {
    const msg = error.message || '登录失败';
    const status = error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' ? 502 : 401;
    res.status(status).json({ message: msg });
  }
});

/** GET /wx/auth/me */
router.get('/auth/me', requireStudentAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, openid, created_at AS createdAt, last_login_at AS lastLoginAt FROM wx_students WHERE id = ? LIMIT 1',
    [req.student.id]
  );
  if (rows.length === 0) {
    res.status(401).json({ message: '用户不存在' });
    return;
  }
  const row = rows[0];
  const openid = String(row.openid || '');
  const masked = openid.length > 8 ? `${openid.slice(0, 6)}***${openid.slice(-4)}` : '***';
  res.json({
    user: {
      id: row.id,
      role: 'student',
      openidMasked: masked,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt,
    },
  });
});

router.use(requireStudentAuth);

router.get('/subjects', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, sort_order AS sortOrder
       FROM subjects
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    res.json({ data: rows });
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      res.status(503).json({ message: 'subjects 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载学科失败' });
  }
});

/** GET /wx/stats/practice — 汇总 + 按学科（今日 / 近7日 / 累计） */
router.get('/stats/practice', async (req, res) => {
  try {
    const sid = req.student.id;
    const [agg, bySubjectToday, bySubjectLast7Days, bySubjectAll] = await Promise.all([
      pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN DATE(ps.submitted_at) = CURDATE() THEN ps.submitted_count ELSE 0 END), 0) AS todayAttempted,
          COALESCE(SUM(CASE WHEN DATE(ps.submitted_at) = CURDATE() THEN ps.correct_count ELSE 0 END), 0) AS todayCorrect,
          COALESCE(SUM(CASE WHEN DATE(ps.submitted_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS todaySessions,
          COALESCE(SUM(CASE WHEN ps.submitted_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN ps.submitted_count ELSE 0 END), 0) AS weekAttempted,
          COALESCE(SUM(CASE WHEN ps.submitted_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN ps.correct_count ELSE 0 END), 0) AS weekCorrect,
          COALESCE(SUM(CASE WHEN ps.submitted_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN 1 ELSE 0 END), 0) AS weekSessions,
          COALESCE(SUM(ps.submitted_count), 0) AS allAttempted,
          COALESCE(SUM(ps.correct_count), 0) AS allCorrect,
          COUNT(*) AS allSessions
         FROM practice_sessions ps
         WHERE ps.student_id = ?
           AND ps.status = 'done'
           AND ps.submitted_at IS NOT NULL`,
        [sid]
      ),
      loadPracticeStatsBySubject(sid, 'today'),
      loadPracticeStatsBySubject(sid, 'week'),
      loadPracticeStatsBySubject(sid, 'all'),
    ]);
    const rows = agg[0] || [];
    const r = rows[0] || {};
    res.json({
      today: buildPracticeStatsBucket(r.todayAttempted, r.todayCorrect, r.todaySessions),
      last7Days: buildPracticeStatsBucket(r.weekAttempted, r.weekCorrect, r.weekSessions),
      all: buildPracticeStatsBucket(r.allAttempted, r.allCorrect, r.allSessions),
      bySubjectToday,
      bySubjectLast7Days,
      bySubjectAll,
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'practice_sessions 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载练习统计失败' });
  }
});

router.get('/favorites', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    const subjectIdRaw = String(req.query.subjectId || '').trim();
    let subjectClause = '';
    const values = [req.student.id];
    if (subjectIdRaw) {
      const subjectId = Number(subjectIdRaw);
      if (!Number.isInteger(subjectId) || subjectId <= 0) {
        res.status(400).json({ message: 'subjectId 必须为正整数' });
        return;
      }
      subjectClause =
        ' AND EXISTS (SELECT 1 FROM question_subject_rel qx WHERE qx.question_id = q.id AND qx.subject_id = ?)';
      values.push(subjectId);
    }

    const [rows] = await pool.query(
      `SELECT qf.id, qf.question_id AS questionId, q.stem, q.chapter, q.question_type AS questionType,
              GROUP_CONCAT(DISTINCT s.name ORDER BY s.sort_order ASC SEPARATOR ',') AS subjects
       FROM question_favorites qf
       JOIN questions q ON q.id = qf.question_id AND q.is_deleted = 0
       LEFT JOIN question_subject_rel qsr ON qsr.question_id = q.id
       LEFT JOIN subjects s ON s.id = qsr.subject_id
       WHERE qf.student_id = ? ${subjectClause}
       GROUP BY qf.id, qf.question_id, q.stem, q.chapter, q.question_type
       ORDER BY qf.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM question_favorites qf
       JOIN questions q ON q.id = qf.question_id AND q.is_deleted = 0
       WHERE qf.student_id = ? ${subjectClause}`,
      values
    );

    const data = rows.map((r) => ({
      id: r.id,
      questionId: r.questionId,
      stem: r.stem,
      chapter: r.chapter,
      questionType: r.questionType,
      subjects: String(r.subjects || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    }));

    res.json({
      data,
      page,
      pageSize,
      total: Number(countRows[0]?.total || 0),
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'question_favorites 表不存在，请执行 sql/question_favorites_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载收藏失败' });
  }
});

router.post('/favorites', async (req, res) => {
  const questionId = Number(req.body?.questionId);
  if (!questionId) {
    res.status(400).json({ message: 'questionId 必填' });
    return;
  }
  try {
    const [qrows] = await pool.query(
      `SELECT id FROM questions WHERE id = ? AND is_deleted = 0 AND status = 'published' LIMIT 1`,
      [questionId]
    );
    if (qrows.length === 0) {
      res.status(404).json({ message: '题目不存在或未发布' });
      return;
    }
    await pool.query('INSERT IGNORE INTO question_favorites (student_id, question_id) VALUES (?, ?)', [
      req.student.id,
      questionId,
    ]);
    res.json({ ok: true, questionId, favorited: true });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'question_favorites 表不存在，请执行 sql/question_favorites_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '收藏失败' });
  }
});

router.delete('/favorites/:questionId', async (req, res) => {
  const questionId = Number(req.params.questionId);
  if (!questionId) {
    res.status(400).json({ message: 'questionId 无效' });
    return;
  }
  try {
    const [result] = await pool.query(
      'DELETE FROM question_favorites WHERE student_id = ? AND question_id = ? LIMIT 1',
      [req.student.id, questionId]
    );
    res.json({ ok: true, questionId, favorited: false, removed: result.affectedRows > 0 });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'question_favorites 表不存在，请执行 sql/question_favorites_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '取消收藏失败' });
  }
});

router.get('/questions', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 10;

    const where = ['q.is_deleted = 0', "q.status = 'published'"];
    const values = [];

    const chapter = String(req.query.chapter || '').trim();
    if (chapter) {
      where.push('q.chapter = ?');
      values.push(chapter);
    }

    const subjectIdRaw = String(req.query.subjectId || '').trim();
    if (subjectIdRaw) {
      const subjectId = Number(subjectIdRaw);
      if (!Number.isInteger(subjectId) || subjectId <= 0) {
        res.status(400).json({ message: 'subjectId must be positive integer' });
        return;
      }
      where.push('qsr.subject_id = ?');
      values.push(subjectId);
    }

    const difficultyRaw = String(req.query.difficulty || '').trim();
    if (difficultyRaw) {
      const difficulty = Number(difficultyRaw);
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
        res.status(400).json({ message: 'difficulty must be integer between 1 and 5' });
        return;
      }
      where.push('q.difficulty = ?');
      values.push(difficulty);
    }

    const knowledgePoint = String(req.query.knowledgePoint || '').trim();
    const needJoinKnowledgePoint = Boolean(knowledgePoint);
    const joinClause = needJoinKnowledgePoint
      ? 'JOIN question_knowledge_rel qkr ON qkr.question_id = q.id JOIN knowledge_points kp ON kp.id = qkr.knowledge_point_id'
      : '';
    if (needJoinKnowledgePoint) {
      where.push('kp.name = ?');
      values.push(knowledgePoint);
    }

    const [rows] = await pool.query(
      `SELECT DISTINCT q.id, q.question_type AS questionType, q.stem, q.option_a AS optionA, q.option_b AS optionB,
              q.option_c AS optionC, q.option_d AS optionD, q.chapter, q.difficulty
       FROM questions q
       ${subjectIdRaw ? 'JOIN question_subject_rel qsr ON qsr.question_id = q.id' : ''}
       ${joinClause}
       WHERE ${where.join(' AND ')}
       ORDER BY RAND()
       LIMIT ?`,
      [...values, limit]
    );

    const data = rows.map(buildQuestionDto);

    res.json({ data, total: data.length });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: '相关表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || 'failed to load questions' });
  }
});

router.post('/practice/start', async (req, res) => {
  try {
    const mode = String(req.body?.mode || 'random');
    if (mode === 'assignment') {
      const assignmentId = Number(req.body?.assignmentId);
      if (!assignmentId) {
        res.status(400).json({ message: '班级作业需传 assignmentId' });
        return;
      }
      let questions;
      try {
        questions = await loadQuestionsForAssignment({
          studentId: req.student.id,
          assignmentId,
        });
      } catch (err) {
        res.status(400).json({ message: err.message || '无法开始作业' });
        return;
      }
      questions = await attachFavoriteFlags(req.student.id, questions);
      try {
        const [result] = await pool.query(
          `INSERT INTO practice_sessions
            (student_id, mode, subject_id, chapter_json, difficulty, question_count, assignment_id, status)
            VALUES (?, 'assignment', NULL, NULL, NULL, ?, ?, 'in_progress')`,
          [req.student.id, questions.length, assignmentId]
        );
        res.json({
          sessionId: result.insertId,
          mode: 'assignment',
          assignmentId,
          filters: { assignmentId },
          total: questions.length,
          questions,
        });
      } catch (error) {
        if (isUnknownColumn(error, 'assignment_id')) {
          res.status(503).json({ message: '请执行 sql/class_assignments_v1.sql 以使用班级作业' });
          return;
        }
        if (String(error?.message || '').includes('Data truncated') || error?.code === 'WARN_DATA_TRUNCATED') {
          res.status(503).json({
            message: 'practice_sessions.mode 需包含 assignment，请执行 sql/class_assignments_v1.sql',
          });
          return;
        }
        throw error;
      }
      return;
    }

    const limitRaw = Number(req.body?.limit ?? 10);
    const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : NaN;
    if (!Number.isInteger(limit)) {
      res.status(400).json({ message: 'limit 必须是 1-100 的整数' });
      return;
    }

    if (!['random', 'sequential', 'wrong', 'favorite'].includes(mode)) {
      res.status(400).json({ message: 'mode 仅支持 random / sequential / wrong / favorite' });
      return;
    }

    const subjectIdRaw = req.body?.subjectId;
    const subjectId = subjectIdRaw === undefined || subjectIdRaw === null || subjectIdRaw === ''
      ? null
      : Number(subjectIdRaw);
    if (subjectId !== null && (!Number.isInteger(subjectId) || subjectId <= 0)) {
      res.status(400).json({ message: 'subjectId 必须是正整数或为空' });
      return;
    }

    const difficultyRaw = req.body?.difficulty;
    const difficulty = difficultyRaw === undefined || difficultyRaw === null || difficultyRaw === ''
      ? null
      : Number(difficultyRaw);
    if (difficulty !== null && (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5)) {
      res.status(400).json({ message: 'difficulty 必须是 1-5 的整数或为空' });
      return;
    }

    const chapters = normalizeChapters(req.body?.chapters);

    const priorityOnly = Boolean(req.body?.priorityOnly);
    if (priorityOnly && mode !== 'wrong') {
      res.status(400).json({ message: 'priorityOnly 仅在与 mode=wrong 联用时有效' });
      return;
    }

    let questions = await loadQuestionsForPractice({
      studentId: req.student.id,
      mode,
      subjectId,
      chapters,
      difficulty,
      limit,
      priorityOnly,
    });
    questions = await attachFavoriteFlags(req.student.id, questions);

    const [result] = await pool.query(
      `INSERT INTO practice_sessions
        (student_id, mode, subject_id, chapter_json, difficulty, question_count, status)
        VALUES (?, ?, ?, ?, ?, ?, 'in_progress')`,
      [
        req.student.id,
        mode,
        subjectId,
        chapters.length > 0 ? JSON.stringify(chapters) : null,
        difficulty,
        questions.length,
      ]
    );

    res.json({
      sessionId: result.insertId,
      mode,
      filters: {
        subjectId,
        chapters,
        difficulty,
        priorityOnly,
      },
      total: questions.length,
      questions,
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'practice 相关表不存在，请先执行 schema_v2.sql' });
      return;
    }
    if (isUnknownColumn(error, 'is_priority')) {
      res.status(503).json({
        message: 'wrong_questions 缺少 is_priority 字段，请在服务器执行 sql/wrong_questions_priority_v1.sql',
      });
      return;
    }
    res.status(500).json({ message: error.message || 'failed to start practice' });
  }
});

router.post('/practice/submit', async (req, res) => {
  const sessionId = Number(req.body?.sessionId);
  if (!sessionId) {
    res.status(400).json({ message: 'sessionId 必填且必须为正整数' });
    return;
  }
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
  if (!answers || answers.length === 0) {
    res.status(400).json({ message: 'answers is required' });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sessionRows] = await conn.query(
      `SELECT id, student_id AS studentId, question_count AS questionCount, status
       FROM practice_sessions
       WHERE id = ? LIMIT 1`,
      [sessionId]
    );
    if (sessionRows.length === 0) {
      await conn.rollback();
      res.status(404).json({ message: 'practice session not found' });
      return;
    }
    const session = sessionRows[0];
    if (Number(session.studentId) !== Number(req.student.id)) {
      await conn.rollback();
      res.status(403).json({ message: '无权提交该练习会话' });
      return;
    }
    if (session.status !== 'in_progress') {
      await conn.rollback();
      res.status(409).json({ message: '该练习会话已提交或不可用' });
      return;
    }

    const evaluated = await evaluateAnswers(answers);
    if (evaluated.questionIds.length === 0) {
      await conn.rollback();
      res.status(400).json({ message: 'no valid questionId found in answers' });
      return;
    }

    const costByQuestion = new Map();
    for (const item of answers) {
      const qid = Number(item?.questionId);
      if (!qid) continue;
      const raw = item?.costMs;
      if (raw === undefined || raw === null || raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 3600000) continue;
      costByQuestion.set(qid, Math.round(n));
    }

    let totalCostMs = 0;
    let timedQuestionCount = 0;

    for (const d of evaluated.details) {
      if (!d.questionId || !Array.isArray(d.correctLetters)) {
        continue;
      }

      const costMs = costByQuestion.has(d.questionId) ? costByQuestion.get(d.questionId) : null;
      if (costMs != null) {
        totalCostMs += costMs;
        timedQuestionCount += 1;
      }

      await conn.query(
        `INSERT INTO practice_answers
          (session_id, student_id, question_id, selected_letters, correct_letters, is_correct, cost_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           selected_letters = VALUES(selected_letters),
           correct_letters = VALUES(correct_letters),
           is_correct = VALUES(is_correct),
           cost_ms = IFNULL(VALUES(cost_ms), cost_ms)`,
        [
          sessionId,
          req.student.id,
          d.questionId,
          d.selectedLetters.join(','),
          d.correctLetters.join(','),
          d.isCorrect ? 1 : 0,
          costMs != null ? costMs : null,
        ]
      );

      if (d.isCorrect) {
        await conn.query(
          `UPDATE wrong_questions
           SET consecutive_correct = consecutive_correct + 1, updated_at = NOW()
           WHERE student_id = ? AND question_id = ?`,
          [req.student.id, d.questionId]
        );
      } else {
        await conn.query(
          `INSERT INTO wrong_questions
            (student_id, question_id, first_wrong_at, last_wrong_at, wrong_count, consecutive_correct, mastered)
           VALUES (?, ?, NOW(), NOW(), 1, 0, 0)
           ON DUPLICATE KEY UPDATE
             last_wrong_at = NOW(),
             wrong_count = wrong_count + 1,
             consecutive_correct = 0,
             mastered = 0,
             updated_at = NOW()`,
          [req.student.id, d.questionId]
        );
      }
    }

    await conn.query(
      `UPDATE practice_sessions
       SET submitted_count = ?, correct_count = ?, score = ?, status = 'done', submitted_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [evaluated.questionIds.length, evaluated.score, evaluated.score, sessionId]
    );

    await conn.commit();
    res.json({
      sessionId,
      total: evaluated.questionIds.length,
      plannedQuestionCount: Number(session.questionCount || 0),
      correct: evaluated.score,
      score: evaluated.score,
      details: evaluated.details,
      totalCostMs: timedQuestionCount > 0 ? totalCostMs : null,
      timedQuestions: timedQuestionCount,
    });
  } catch (error) {
    await conn.rollback();
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'practice 相关表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || 'failed to submit answers' });
  } finally {
    conn.release();
  }
});

// 兼容旧接口：映射到新提交流程（无 session）
router.post('/quiz/submit', async (req, res) => {
  try {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
    if (!answers || answers.length === 0) {
      res.status(400).json({ message: 'answers is required' });
      return;
    }
    const evaluated = await evaluateAnswers(answers);
    if (evaluated.questionIds.length === 0) {
      res.status(400).json({ message: 'no valid questionId found in answers' });
      return;
    }
    res.json({
      total: evaluated.questionIds.length,
      correct: evaluated.score,
      score: evaluated.score,
      details: evaluated.details,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'failed to submit answers' });
  }
});

router.get('/wrong-questions', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    const where = ['wq.student_id = ?'];
    const values = [req.student.id];

    const subjectIdRaw = String(req.query.subjectId || '').trim();
    let needJoinSubject = false;
    if (subjectIdRaw) {
      const subjectId = Number(subjectIdRaw);
      if (!Number.isInteger(subjectId) || subjectId <= 0) {
        res.status(400).json({ message: 'subjectId 必须为正整数' });
        return;
      }
      needJoinSubject = true;
      where.push('qsr.subject_id = ?');
      values.push(subjectId);
    }

    const chapter = String(req.query.chapter || '').trim();
    if (chapter) {
      where.push('q.chapter = ?');
      values.push(chapter);
    }

    const masteredRaw = String(req.query.mastered || '').trim();
    if (masteredRaw === 'true' || masteredRaw === 'false') {
      where.push('wq.mastered = ?');
      values.push(masteredRaw === 'true' ? 1 : 0);
    }

    const priorityOnlyRaw = String(req.query.priorityOnly || '').trim().toLowerCase();
    if (priorityOnlyRaw === 'true' || priorityOnlyRaw === '1') {
      where.push('wq.is_priority = 1');
    }

    const joinSubject = needJoinSubject
      ? 'LEFT JOIN question_subject_rel qsr ON qsr.question_id = q.id LEFT JOIN subjects s ON s.id = qsr.subject_id'
      : 'LEFT JOIN question_subject_rel qsr ON qsr.question_id = q.id LEFT JOIN subjects s ON s.id = qsr.subject_id';

    const [rows] = await pool.query(
      `SELECT DISTINCT wq.id, wq.question_id AS questionId, wq.wrong_count AS wrongCount, wq.mastered, wq.is_priority AS is_priority,
              wq.last_wrong_at AS lastWrongAt, q.stem, q.chapter, q.question_type AS questionType, q.analysis,
              q.answer_letters AS answerLetters,
              GROUP_CONCAT(DISTINCT s.name ORDER BY s.sort_order ASC SEPARATOR ',') AS subjects
       FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id
       ${joinSubject}
       WHERE ${where.join(' AND ')}
       GROUP BY wq.id
       ORDER BY wq.last_wrong_at DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id
       ${needJoinSubject ? 'LEFT JOIN question_subject_rel qsr ON qsr.question_id = q.id' : ''}
       WHERE ${where.join(' AND ')}`,
      values
    );

    const data = rows.map((r) => ({
      id: r.id,
      questionId: r.questionId,
      stem: r.stem,
      chapter: r.chapter,
      questionType: r.questionType,
      answerLetters: parseAnswerLetters(r.answerLetters),
      analysis: r.analysis || '',
      wrongCount: Number(r.wrongCount || 0),
      mastered: Number(r.mastered || 0) === 1,
      isPriority: Number(r.is_priority || 0) === 1,
      lastWrongAt: r.lastWrongAt,
      subjects: String(r.subjects || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    }));

    res.json({
      data,
      page,
      pageSize,
      total: Number(countRows[0]?.total || 0),
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'wrong_questions 或 subjects 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    if (isUnknownColumn(error, 'is_priority')) {
      res.status(503).json({
        message: 'wrong_questions 缺少 is_priority 字段，请在服务器执行 sql/wrong_questions_priority_v1.sql',
      });
      return;
    }
    res.status(500).json({ message: error.message || '加载错题本失败' });
  }
});

router.post('/wrong-questions/:id/mastered', async (req, res) => {
  const wrongId = Number(req.params.id);
  if (!wrongId) {
    res.status(400).json({ message: 'invalid wrong question id' });
    return;
  }
  const mastered = req.body?.mastered === undefined ? true : Boolean(req.body.mastered);

  try {
    const [result] = await pool.query(
      'UPDATE wrong_questions SET mastered = ?, updated_at = NOW() WHERE id = ? AND student_id = ? LIMIT 1',
      [mastered ? 1 : 0, wrongId, req.student.id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ message: '错题记录不存在' });
      return;
    }
    res.json({ ok: true, id: wrongId, mastered });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'wrong_questions 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '更新错题状态失败' });
  }
});

router.post('/wrong-questions/:id/priority', async (req, res) => {
  const wrongId = Number(req.params.id);
  if (!wrongId) {
    res.status(400).json({ message: 'invalid wrong question id' });
    return;
  }
  const isPriority = req.body?.isPriority === undefined ? true : Boolean(req.body.isPriority);

  try {
    const [result] = await pool.query(
      'UPDATE wrong_questions SET is_priority = ?, updated_at = NOW() WHERE id = ? AND student_id = ? LIMIT 1',
      [isPriority ? 1 : 0, wrongId, req.student.id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ message: '错题记录不存在' });
      return;
    }
    res.json({ ok: true, id: wrongId, isPriority });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'wrong_questions 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '更新重点复习状态失败' });
  }
});

router.get('/practice/sessions', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 20);
    const limit = Math.min(100, Math.max(1, Number.isInteger(limitRaw) ? limitRaw : 20));

    const [rows] = await pool.query(
      `SELECT ps.id, ps.mode, ps.question_count AS questionCount, ps.submitted_count AS submittedCount,
              ps.correct_count AS correctCount, ps.score, ps.status, ps.started_at AS startedAt, ps.submitted_at AS submittedAt,
              s.name AS subjectName
       FROM practice_sessions ps
       LEFT JOIN subjects s ON s.id = ps.subject_id
       WHERE ps.student_id = ?
       ORDER BY ps.id DESC
       LIMIT ?`,
      [req.student.id, limit]
    );

    const data = rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      subjectName: r.subjectName || '',
      questionCount: Number(r.questionCount || 0),
      submittedCount: Number(r.submittedCount || 0),
      correctCount: Number(r.correctCount || 0),
      score: Number(r.score || 0),
      status: r.status,
      startedAt: r.startedAt,
      submittedAt: r.submittedAt,
      accuracy:
        Number(r.submittedCount || 0) > 0
          ? Number(((Number(r.correctCount || 0) / Number(r.submittedCount || 1)) * 100).toFixed(1))
          : 0,
    }));

    res.json({ data, total: data.length });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'practice_sessions 或 subjects 表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载练习历史失败' });
  }
});

router.get('/practice/sessions/:id', async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!sessionId) {
      res.status(400).json({ message: 'invalid session id' });
      return;
    }

    const [sessionRows] = await pool.query(
      `SELECT ps.id, ps.mode, ps.question_count AS questionCount, ps.submitted_count AS submittedCount,
              ps.correct_count AS correctCount, ps.score, ps.status, ps.started_at AS startedAt, ps.submitted_at AS submittedAt,
              s.name AS subjectName
       FROM practice_sessions ps
       LEFT JOIN subjects s ON s.id = ps.subject_id
       WHERE ps.id = ? AND ps.student_id = ?
       LIMIT 1`,
      [sessionId, req.student.id]
    );
    if (sessionRows.length === 0) {
      res.status(404).json({ message: 'practice session not found' });
      return;
    }
    const session = sessionRows[0];

    const [answerRows] = await pool.query(
      `SELECT pa.question_id AS questionId, pa.selected_letters AS selectedLetters, pa.correct_letters AS correctLetters,
              pa.is_correct AS isCorrect, pa.cost_ms AS costMs, q.stem, q.analysis, q.question_type AS questionType,
              wq.id AS wrongId, wq.is_priority AS isPriority
       FROM practice_answers pa
       JOIN questions q ON q.id = pa.question_id
       LEFT JOIN wrong_questions wq ON wq.student_id = pa.student_id AND wq.question_id = pa.question_id
       WHERE pa.session_id = ? AND pa.student_id = ?
       ORDER BY pa.id ASC`,
      [sessionId, req.student.id]
    );

    const details = answerRows.map((r) => ({
      questionId: r.questionId,
      questionType: r.questionType,
      stem: r.stem,
      selectedLetters: parseAnswerLetters(r.selectedLetters),
      correctLetters: parseAnswerLetters(r.correctLetters),
      isCorrect: Number(r.isCorrect || 0) === 1,
      analysis: r.analysis || '',
      costMs: r.costMs != null ? Number(r.costMs) : null,
      wrongId: r.wrongId ? Number(r.wrongId) : null,
      isPriority: Number(r.isPriority || 0) === 1,
    }));

    res.json({
      session: {
        id: session.id,
        mode: session.mode,
        subjectName: session.subjectName || '',
        questionCount: Number(session.questionCount || 0),
        submittedCount: Number(session.submittedCount || 0),
        correctCount: Number(session.correctCount || 0),
        score: Number(session.score || 0),
        status: session.status,
        startedAt: session.startedAt,
        submittedAt: session.submittedAt,
      },
      details,
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'practice 相关表不存在，请先执行 schema_v2.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载练习详情失败' });
  }
});

const REPORT_REASON_TYPES = ['answer_wrong', 'stem_error', 'option_error', 'typo', 'other'];
const REPORT_AUTO_ESCALATE_DISTINCT_STUDENTS_24H = 3;

async function tryAutoEscalateQuestionReports(questionId) {
  const [hotRows] = await pool.query(
    `SELECT COUNT(DISTINCT student_id) AS studentCount
     FROM question_reports
     WHERE question_id = ?
       AND created_at >= (NOW() - INTERVAL 24 HOUR)
       AND status IN ('open', 'reviewing')`,
    [questionId]
  );
  const studentCount = Number(hotRows[0]?.studentCount || 0);
  if (studentCount < REPORT_AUTO_ESCALATE_DISTINCT_STUDENTS_24H) {
    return { autoEscalated: false, studentCount };
  }
  const [upd] = await pool.query(
    `UPDATE question_reports
     SET status = 'reviewing', updated_at = NOW()
     WHERE question_id = ? AND status = 'open'`,
    [questionId]
  );
  return {
    autoEscalated: Number(upd.affectedRows || 0) > 0,
    studentCount,
  };
}

/** GET /wx/question-reports?status=&page=&pageSize= */
router.get('/question-reports', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));
  const offset = (page - 1) * pageSize;
  const statusRaw = String(req.query.status || '').trim();
  const statusFilter = ['open', 'reviewing', 'closed'].includes(statusRaw) ? statusRaw : '';
  const where = ['qr.student_id = ?'];
  const values = [req.student.id];
  if (statusFilter) {
    where.push('qr.status = ?');
    values.push(statusFilter);
  }
  const wc = `WHERE ${where.join(' AND ')}`;
  try {
    const [rows] = await pool.query(
      `SELECT qr.id, qr.question_id AS questionId, qr.reason_type AS reasonType, qr.detail,
              qr.status, qr.admin_note AS adminNote, qr.created_at AS createdAt, qr.updated_at AS updatedAt,
              q.stem, q.question_type AS questionType
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
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'question_reports 表不存在，请执行 sql/question_reports_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载反馈记录失败' });
  }
});

/** POST /wx/question-reports { questionId, reasonType, detail? } */
router.post('/question-reports', async (req, res) => {
  const questionId = Number(req.body?.questionId);
  if (!questionId) {
    res.status(400).json({ message: 'questionId 必填' });
    return;
  }
  const reasonType = String(req.body?.reasonType || '').trim();
  if (!REPORT_REASON_TYPES.includes(reasonType)) {
    res.status(400).json({
      message: `reasonType 须为：${REPORT_REASON_TYPES.join('、')}`,
    });
    return;
  }
  const detail = String(req.body?.detail || '').trim().slice(0, 500);

  try {
    const [qrows] = await pool.query(
      `SELECT id FROM questions WHERE id = ? AND is_deleted = 0 AND status = 'published' LIMIT 1`,
      [questionId]
    );
    if (qrows.length === 0) {
      res.status(404).json({ message: '题目不存在或已删除' });
      return;
    }
    // 去重：同一学生对同一题目若存在未关闭反馈，则更新该条而非重复插入。
    const [existingRows] = await pool.query(
      `SELECT id, status FROM question_reports
       WHERE student_id = ? AND question_id = ? AND status IN ('open', 'reviewing')
       ORDER BY id DESC
       LIMIT 1`,
      [req.student.id, questionId]
    );
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      await pool.query(
        `UPDATE question_reports
         SET reason_type = ?, detail = ?, updated_at = NOW()
         WHERE id = ? LIMIT 1`,
        [reasonType, detail || null, existing.id]
      );
      const escalate = await tryAutoEscalateQuestionReports(questionId);
      const [statusRows] = await pool.query('SELECT status FROM question_reports WHERE id = ? LIMIT 1', [existing.id]);
      res.json({
        ok: true,
        id: Number(existing.id),
        merged: true,
        status: statusRows[0]?.status || existing.status,
        autoEscalated: escalate.autoEscalated,
        recentDistinctStudents24h: escalate.studentCount,
      });
      return;
    }
    const [result] = await pool.query(
      `INSERT INTO question_reports (student_id, question_id, reason_type, detail, status)
       VALUES (?, ?, ?, ?, 'open')`,
      [req.student.id, questionId, reasonType, detail || null]
    );
    const escalate = await tryAutoEscalateQuestionReports(questionId);
    const [statusRows] = await pool.query('SELECT status FROM question_reports WHERE id = ? LIMIT 1', [result.insertId]);
    res.json({
      ok: true,
      id: result.insertId,
      merged: false,
      status: statusRows[0]?.status || 'open',
      autoEscalated: escalate.autoEscalated,
      recentDistinctStudents24h: escalate.studentCount,
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'question_reports 表不存在，请执行 sql/question_reports_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '提交反馈失败' });
  }
});

/** POST /wx/classes/join { inviteCode } — 学生凭教师提供的邀请码加入班级 */
router.post('/classes/join', async (req, res) => {
  const raw = String(req.body?.inviteCode || '')
    .trim()
    .replace(/\s+/g, '');
  const inviteCode = raw.toUpperCase();
  if (!inviteCode || inviteCode.length > 16) {
    res.status(400).json({ message: '请填写邀请码' });
    return;
  }
  try {
    const [rows] = await pool.query('SELECT id, name FROM classes WHERE invite_code = ? LIMIT 1', [
      inviteCode,
    ]);
    if (rows.length === 0) {
      res.status(404).json({ message: '邀请码无效' });
      return;
    }
    const cls = rows[0];
    try {
      await pool.query('INSERT INTO class_members (class_id, student_id) VALUES (?, ?)', [
        cls.id,
        req.student.id,
      ]);
      res.status(201).json({
        ok: true,
        classId: cls.id,
        className: cls.name,
        alreadyMember: false,
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        res.json({
          ok: true,
          classId: cls.id,
          className: cls.name,
          alreadyMember: true,
        });
        return;
      }
      throw e;
    }
  } catch (error) {
    if (isUnknownColumn(error, 'invite_code')) {
      res.status(503).json({ message: '请执行 sql/classes_invite_code_v1.sql 启用班级邀请码' });
      return;
    }
    if (isTableMissing(error)) {
      res.status(503).json({ message: '班级表未就绪，请执行 sql/classes_v1.sql 与 sql/classes_invite_code_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加入班级失败' });
  }
});

/** GET /wx/classes/mine — 当前学生已加入的班级 */
router.get('/classes/mine', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id AS classId, c.name AS className, m.created_at AS joinedAt
       FROM class_members m
       INNER JOIN classes c ON c.id = m.class_id
       WHERE m.student_id = ?
       ORDER BY m.created_at DESC`,
      [req.student.id]
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: '班级表未就绪' });
      return;
    }
    res.status(500).json({ message: error.message || '加载班级失败' });
  }
});

/** GET /wx/assignments — 已加入班级下的作业列表（含是否已完成一次提交） */
router.get('/assignments', async (req, res) => {
  const sid = req.student.id;
  try {
    const [rows] = await pool.query(
      `SELECT ca.id AS assignmentId, ca.class_id AS classId, c.name AS className,
              ca.title, ca.description, ca.due_at AS dueAt, ca.created_at AS createdAt,
              (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = ca.id) AS questionCount,
              IF((SELECT COUNT(*) FROM practice_sessions ps
                  WHERE ps.assignment_id = ca.id AND ps.student_id = ? AND ps.status = 'done') > 0, 1, 0) AS completed
       FROM class_assignments ca
       INNER JOIN class_members m ON m.class_id = ca.class_id AND m.student_id = ?
       INNER JOIN classes c ON c.id = ca.class_id
       ORDER BY (ca.due_at IS NULL) ASC, ca.due_at ASC, ca.id DESC`,
      [sid, sid]
    );
    const now = Date.now();
    res.json({
      ok: true,
      data: rows.map((r) => {
        const due = r.dueAt ? new Date(r.dueAt).getTime() : null;
        const completed = Number(r.completed) === 1;
        return {
          assignmentId: r.assignmentId,
          classId: r.classId,
          className: r.className,
          title: r.title,
          description: r.description,
          dueAt: r.dueAt,
          createdAt: r.createdAt,
          questionCount: Number(r.questionCount || 0),
          completed,
          overdue: Boolean(due && due < now && !completed),
        };
      }),
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: '班级作业未启用，请执行 sql/class_assignments_v1.sql' });
      return;
    }
    res.status(500).json({ message: error.message || '加载作业列表失败' });
  }
});

export default router;
