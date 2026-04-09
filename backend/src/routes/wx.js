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

async function loadQuestionsForPractice({ subjectId = null, chapters = [], difficulty = null, limit = 10 }) {
  const where = ['q.is_deleted = 0', "q.status = 'published'"];
  const values = [];

  let joinClause = '';
  if (subjectId) {
    joinClause = 'JOIN question_subject_rel qsr ON qsr.question_id = q.id';
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
     ORDER BY RAND()
     LIMIT ?`,
    [...values, limit]
  );

  return rows.map(buildQuestionDto);
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
    const limitRaw = Number(req.body?.limit ?? 10);
    const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : NaN;
    if (!Number.isInteger(limit)) {
      res.status(400).json({ message: 'limit 必须是 1-100 的整数' });
      return;
    }

    const mode = String(req.body?.mode || 'random');
    if (!['random', 'sequential', 'wrong'].includes(mode)) {
      res.status(400).json({ message: 'mode 仅支持 random / sequential / wrong' });
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

    const questions = await loadQuestionsForPractice({
      subjectId,
      chapters,
      difficulty,
      limit,
    });

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
      },
      total: questions.length,
      questions,
    });
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({ message: 'practice 相关表不存在，请先执行 schema_v2.sql' });
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

    for (const d of evaluated.details) {
      if (!d.questionId || !Array.isArray(d.correctLetters)) {
        continue;
      }

      await conn.query(
        `INSERT INTO practice_answers
          (session_id, student_id, question_id, selected_letters, correct_letters, is_correct)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           selected_letters = VALUES(selected_letters),
           correct_letters = VALUES(correct_letters),
           is_correct = VALUES(is_correct)`,
        [
          sessionId,
          req.student.id,
          d.questionId,
          d.selectedLetters.join(','),
          d.correctLetters.join(','),
          d.isCorrect ? 1 : 0,
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

    const joinSubject = needJoinSubject
      ? 'LEFT JOIN question_subject_rel qsr ON qsr.question_id = q.id LEFT JOIN subjects s ON s.id = qsr.subject_id'
      : 'LEFT JOIN question_subject_rel qsr ON qsr.question_id = q.id LEFT JOIN subjects s ON s.id = qsr.subject_id';

    const [rows] = await pool.query(
      `SELECT DISTINCT wq.id, wq.question_id AS questionId, wq.wrong_count AS wrongCount, wq.mastered,
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

export default router;
