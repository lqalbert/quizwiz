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
       ${joinClause}
       WHERE ${where.join(' AND ')}
       ORDER BY RAND()
       LIMIT ?`,
      [...values, limit]
    );

    const data = rows.map((row) => ({
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
    }));

    res.json({ data, total: data.length });
  } catch (error) {
    res.status(500).json({ message: error.message || 'failed to load questions' });
  }
});

router.post('/quiz/submit', async (req, res) => {
  try {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
    if (!answers || answers.length === 0) {
      res.status(400).json({ message: 'answers is required' });
      return;
    }

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
      res.status(400).json({ message: 'no valid questionId found in answers' });
      return;
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

    res.json({
      total: questionIds.length,
      correct: score,
      score,
      details,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'failed to submit answers' });
  }
});

export default router;
