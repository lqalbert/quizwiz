import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'fs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'node:url'

import { API_REVISION, DEFAULT_KNOWLEDGE_UNIT_NAME } from './config/constants.js'
import { pool } from './db/pool.js'
import { runBootMigrations } from './migrations/runBootMigrations.js'
import { avatarUpload, resourceUpload, UPLOAD_ROOT } from './upload/multers.js'

dotenv.config()

const app = express()

const API_PORT = Number(process.env.API_PORT || 3000)
const JWT_SECRET = process.env.JWT_SECRET || 'quizwiz-dev-secret'
/** 小程序登录：微信公众平台 → 开发 → 开发管理 → 开发设置 */
const WECHAT_MINI_APPID = String(process.env.WECHAT_MINI_APPID || '').trim()
const WECHAT_MINI_SECRET = String(process.env.WECHAT_MINI_SECRET || '').trim()
const UPLOAD_PUBLIC_BASE = process.env.UPLOAD_PUBLIC_BASE || `http://localhost:${API_PORT}`

/** 按科目解析知识单元 id（须已在字典中存在；全局仅「未分类」subject_id 为空） */
const resolveKnowledgeUnitId = async (executor, subjectId, unitNameRaw) => {
  const name = String(unitNameRaw || '').trim() || DEFAULT_KNOWLEDGE_UNIT_NAME
  const sid = Number(subjectId)
  if (Number.isInteger(sid) && sid > 0) {
    const r = await executor.query(
      `
      SELECT id
      FROM knowledge_units
      WHERE name = $1 AND (subject_id = $2 OR (subject_id IS NULL AND name = $3))
      ORDER BY CASE WHEN subject_id = $2 THEN 0 ELSE 1 END
      LIMIT 1
      `,
      [name, sid, DEFAULT_KNOWLEDGE_UNIT_NAME],
    )
    return r.rows[0]?.id != null ? Number(r.rows[0].id) : null
  }
  const g = await executor.query(
    `
    SELECT id FROM knowledge_units WHERE name = $1 AND subject_id IS NULL LIMIT 1
    `,
    [name],
  )
  return g.rows[0]?.id != null ? Number(g.rows[0].id) : null
}

const upsertKnowledgePointTagAndLink = async (client, questionId, unitId, rawTag) => {
  const point = String(rawTag || '').trim()
  if (!point) return
  const tagResult = await client.query(
    `
    INSERT INTO question_tags (unit_id, name)
    VALUES ($1, $2)
    ON CONFLICT (unit_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
    `,
    [unitId, point],
  )
  const tagId = tagResult.rows[0]?.id
  if (tagId) {
    await client.query(
      `
      INSERT INTO question_tag_rel (question_id, tag_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [questionId, tagId],
    )
  }
}

const linkKnowledgePointsForQuestion = async (client, questionId, subjectId, unitNameRaw, pointNames) => {
  const names = Array.isArray(pointNames) ? pointNames : []
  if (names.length === 0) return
  const unitId = await resolveKnowledgeUnitId(client, subjectId, unitNameRaw)
  if (!unitId) {
    const err = new Error('KNOWLEDGE_UNIT_NOT_IN_DICTIONARY')
    throw err
  }
  for (const raw of names) {
    await upsertKnowledgePointTagAndLink(client, questionId, unitId, raw)
  }
}

const questionTypeMap = {
  '单选': 1,
  single: 1,
  '多选': 2,
  multiple: 2,
  '判断': 3,
  judge: 3,
  '填空': 4,
  fill: 4,
  '简答': 5,
  short: 5,
}

const questionTypeLabelMap = {
  1: '单选',
  2: '多选',
  3: '判断',
  4: '填空',
  5: '简答',
}

/** 旧版中文/英文难度 → 约略映射到 1–5 档（兼容历史数据与旧模板） */
const legacyDifficultyZhMap = {
  简单: 2,
  中等: 3,
  困难: 4,
  easy: 2,
  medium: 3,
  hard: 4,
}

/** 解析为库存难度等级 1–5；无法识别返回 null */
const parseDifficultyLevel = (value) => {
  const s = String(value ?? '').trim()
  if (!s) return null
  const n = Number(s)
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n
  const legacy = legacyDifficultyZhMap[s] ?? legacyDifficultyZhMap[s.toLowerCase()]
  if (legacy != null) return legacy
  return null
}

/** API 展示的 difficulty_text：与库存数值一致为 "1"…"5"；兼容旧版中英文（与 parseDifficultyLevel 一致） */
const difficultyTextFromDb = (d) => {
  if (d == null || d === '') return '3'
  const parsed = parseDifficultyLevel(d)
  if (parsed != null) return String(parsed)
  const n = Number(d)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? String(n) : '3'
}

const subjectAliasMap = {
  chinese: '语文',
  math: '数学',
  english: '英语',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  history: '历史',
  politics: '政治',
  geography: '地理',
}

const defaultCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']
const extraCorsOrigins = String(process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
/** 仅本地联调：微信开发者工具 / 局域网 IP 等任意 Origin（勿在线上 .env 开启） */
const devCorsAny = String(process.env.QUIZWIZ_DEV_CORS_ANY || '').trim() === '1'
app.use(
  cors(
    devCorsAny
      ? { origin: true }
      : {
          origin: [...defaultCorsOrigins, ...extraCorsOrigins],
        },
  ),
)
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', etag: true, lastModified: true }))

const authRequired = (req, res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    return res.status(401).json({ message: '未登录或登录已过期' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.auth = payload
    return next()
  } catch {
    return res.status(401).json({ message: '登录凭证无效，请重新登录' })
  }
}

const hasRole = (req, roleCode) => Array.isArray(req.auth?.roles) && req.auth.roles.includes(roleCode)
const canAccessTeacherAccounts = (req) => hasRole(req, 'admin') || hasRole(req, 'class_teacher')
const canCreateClass = (req) => hasRole(req, 'admin') || hasRole(req, 'class_teacher')
const canManageResources = (req) =>
  hasRole(req, 'admin') || hasRole(req, 'class_teacher') || hasRole(req, 'subject_teacher')

const loadTeacherSubjectIds = async (executor, userId) => {
  const { rows } = await executor.query(
    `SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1 ORDER BY subject_id ASC`,
    [userId],
  )
  return rows.map((row) => Number(row.subject_id)).filter((id) => Number.isInteger(id) && id > 0)
}

/** 学情/概览等：非管理员可见班级 = 任班主任(owner) 或任课(class_teachers)；兼任两种角色取并集 */
const buildVisibleClassesAccessSql = (req) => {
  if (hasRole(req, 'admin')) return { accessSql: '', values: [] }
  const uid = Number(req.auth?.userId) || 0
  const parts = []
  if (hasRole(req, 'class_teacher')) parts.push('c.owner_id = $1')
  if (hasRole(req, 'subject_teacher')) {
    parts.push('EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = c.id AND ct.teacher_id = $1)')
  }
  if (parts.length === 0) return { accessSql: 'WHERE 1 = 0', values: [uid] }
  if (parts.length === 1) return { accessSql: `WHERE ${parts[0]}`, values: [uid] }
  return { accessSql: `WHERE (${parts.join(' OR ')})`, values: [uid] }
}

const validateResourceClassScope = async ({ req, classIds, client }) => {
  if (hasRole(req, 'admin') || classIds.length === 0) return true
  const executor = client || pool
  const uid = Number(req.auth?.userId) || 0
  if (hasRole(req, 'class_teacher')) {
    const ownedClassResult = await executor.query(`SELECT id FROM classes WHERE owner_id = $1`, [uid])
    const ownedClassSet = new Set(ownedClassResult.rows.map((row) => Number(row.id)))
    if (classIds.every((classId) => ownedClassSet.has(classId))) return true
  }
  if (hasRole(req, 'subject_teacher')) {
    const memberResult = await executor.query(
      `SELECT DISTINCT class_id FROM class_teachers WHERE teacher_id = $1`,
      [uid],
    )
    const memberSet = new Set(memberResult.rows.map((row) => Number(row.class_id)))
    if (classIds.every((classId) => memberSet.has(classId))) return true
  }
  return false
}

/** 学生 JWT：优先 Authorization，其次 query（小程序 wx.downloadFile 在部分网关下会丢 Header，可用 access_token 兜底） */
const extractStudentBearerToken = (req) => {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  const q = req.query && typeof req.query === 'object' ? req.query : {}
  const fromQuery = String(q.access_token || q.student_token || '').trim()
  return fromQuery
}

const studentAuthRequired = (req, res, next) => {
  const token = extractStudentBearerToken(req)
  if (!token) {
    return res.status(401).json({ message: '未登录或登录已过期' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (!Array.isArray(payload.roles) || !payload.roles.includes('student')) {
      return res.status(403).json({ message: '请使用学生身份凭证' })
    }
    const studentId = Number(payload.studentId)
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(403).json({ message: '学生凭证无效' })
    }
    req.studentAuth = { studentId }
    return next()
  } catch {
    return res.status(401).json({ message: '登录凭证无效，请重新登录' })
  }
}

/** 已登录学生须至少加入一个班级，否则不可使用业务接口（资料 / 入班 / 班级列表除外） */
const studentClassMembershipRequired = async (req, res, next) => {
  const studentId = req.studentAuth.studentId
  try {
    const r = await pool.query(`SELECT 1 FROM class_members WHERE student_id = $1 LIMIT 1`, [studentId])
    if (!r.rows[0]) {
      return res.status(403).json({
        message: '请先加入至少一个班级后再使用',
        code: 'NEED_JOIN_CLASS',
      })
    }
    return next()
  } catch (error) {
    return res.status(500).json({
      message: '校验班级失败',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

const writeOperationLog = async ({
  client,
  operatorId,
  action,
  targetType,
  targetId,
  detail,
}) => {
  const executor = client || pool
  await executor.query(
    `
    INSERT INTO operation_logs (operator_id, action, target_type, target_id, detail, created_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
    `,
    [operatorId || null, action, targetType || null, targetId || null, JSON.stringify(detail || {})],
  )
}

const wechatMiniCode2Session = async (jsCode) => {
  const appid = WECHAT_MINI_APPID
  const secret = WECHAT_MINI_SECRET
  if (!appid || !secret) {
    throw new Error('服务端未配置 WECHAT_MINI_APPID / WECHAT_MINI_SECRET，无法使用微信登录')
  }
  const code = String(jsCode || '').trim()
  if (!code) throw new Error('code 不能为空')
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (json.errcode) {
    throw new Error(String(json.errmsg || `微信接口错误 ${json.errcode}`))
  }
  const openid = String(json.openid || '').trim()
  if (!openid) throw new Error('微信未返回 openid')
  return {
    openid,
    unionid: String(json.unionid || '').trim() || null,
    session_key: json.session_key,
  }
}

const studentNoFromWechatOpenid = (openid) => {
  const h = crypto.createHash('sha256').update(openid, 'utf8').digest('hex').slice(0, 20)
  const sn = `wx${h}`
  return sn.length <= 64 ? sn : sn.slice(0, 64)
}

/** 学生作答是否与题库答案一致（与教师端题型约定一致） */
const isStudentAnswerCorrect = (questionType, correctText, userRaw) => {
  const c0 = String(correctText ?? '').trim()
  const u0 = String(userRaw ?? '').trim()
  const t = Number(questionType)
  if (t === 1) {
    const c = c0.toUpperCase().slice(0, 1)
    const u = u0.toUpperCase().slice(0, 1)
    if (!u) return false
    return c === u
  }
  if (t === 2) {
    const norm = (s) =>
      Array.from(
        new Set(
          String(s || '')
            .replace(/，/g, ',')
            .split(',')
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean),
        ),
      )
        .sort()
        .join(',')
    if (!u0) return false
    return norm(c0) === norm(u0)
  }
  if (t === 3) {
    const normJudge = (s) => {
      const x = String(s || '').trim()
      if (x === '对' || x.toUpperCase() === 'A' || x === '正确' || x === 'TRUE' || x === 'T' || x === '1') return 'A'
      if (x === '错' || x.toUpperCase() === 'B' || x === '错误' || x === 'FALSE' || x === 'F' || x === '0') return 'B'
      return x.toUpperCase().slice(0, 1)
    }
    if (!u0) return false
    return normJudge(c0) === normJudge(u0)
  }
  const soft = (s) =>
    String(s || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  if (!u0) return false
  return soft(c0) === soft(u0)
}

/** 正式考试 answers.student_answer JSONB */
const packExamStudentAnswer = (raw) => JSON.stringify({ v: raw == null ? '' : String(raw) })

const unpackExamStudentAnswer = (jsonbVal) => {
  if (jsonbVal == null || jsonbVal === '') return ''
  if (typeof jsonbVal === 'string') {
    try {
      const o = JSON.parse(jsonbVal)
      if (o && typeof o.v === 'string') return o.v
    } catch (_) {
      return jsonbVal
    }
  }
  if (typeof jsonbVal === 'object' && jsonbVal && typeof jsonbVal.v === 'string') return String(jsonbVal.v)
  return String(jsonbVal)
}

const examPhaseFromRow = (row) => {
  const now = Date.now()
  const s = new Date(row.start_time).getTime()
  const e = new Date(row.end_time).getTime()
  if (now < s) return 'upcoming'
  if (now <= e) return 'ongoing'
  return 'ended'
}

/** 刷题错题间隔复习：答错次日再练；答对仍错题则按 ladder 推进 1/3/7/14/30 天（上海日历） */
const bumpWrongReviewAfterPractice = async (client, studentId, questionId, isCorrect) => {
  const shExpr = `(timezone('Asia/Shanghai', now()))::date`
  if (!isCorrect) {
    await client.query(
      `
      INSERT INTO student_wrong_review (student_id, question_id, next_review_date, ladder, updated_at)
      VALUES ($1, $2, ${shExpr} + INTERVAL '1 day', 0, NOW())
      ON CONFLICT (student_id, question_id) DO UPDATE SET
        next_review_date = ${shExpr} + INTERVAL '1 day',
        ladder = 0,
        updated_at = NOW()
      `,
      [studentId, questionId],
    )
    return
  }
  const wcR = await client.query(
    `SELECT wrong_count FROM student_question_stats WHERE student_id = $1 AND question_id = $2 LIMIT 1`,
    [studentId, questionId],
  )
  const wc = Number(wcR.rows[0]?.wrong_count || 0)
  if (wc <= 0) {
    await client.query(`DELETE FROM student_wrong_review WHERE student_id = $1 AND question_id = $2`, [
      studentId,
      questionId,
    ])
    return
  }
  const rr = await client.query(
    `SELECT ladder FROM student_wrong_review WHERE student_id = $1 AND question_id = $2 LIMIT 1`,
    [studentId, questionId],
  )
  const L = rr.rows[0] ? Number(rr.rows[0].ladder || 0) : 0
  const addDays = L <= 0 ? 1 : L === 1 ? 3 : L === 2 ? 7 : L === 3 ? 14 : 30
  const newLadder = L + 1
  await client.query(
    `
    INSERT INTO student_wrong_review (student_id, question_id, next_review_date, ladder, updated_at)
    VALUES ($1, $2, ${shExpr} + ($3::int * INTERVAL '1 day'), $4, NOW())
    ON CONFLICT (student_id, question_id) DO UPDATE SET
      ladder = EXCLUDED.ladder,
      next_review_date = EXCLUDED.next_review_date,
      updated_at = NOW()
    `,
    [studentId, questionId, addDays, newLadder],
  )
}

const incrementStudentQuestionStats = async (client, studentId, questionId, isCorrect, source = 'practice_check') => {
  const correctInc = isCorrect ? 1 : 0
  const wrongInc = isCorrect ? 0 : 1
  const src = String(source || 'practice_check').trim() || 'practice_check'
  await client.query(
    `
    INSERT INTO student_question_stats (student_id, question_id, attempts, correct_count, wrong_count, updated_at)
    VALUES ($1, $2, 1, $3, $4, NOW())
    ON CONFLICT (student_id, question_id) DO UPDATE SET
      attempts = student_question_stats.attempts + 1,
      correct_count = student_question_stats.correct_count + EXCLUDED.correct_count,
      wrong_count = student_question_stats.wrong_count + EXCLUDED.wrong_count,
      updated_at = NOW()
    `,
    [studentId, questionId, correctInc, wrongInc],
  )
  await client.query(
    `
    INSERT INTO student_practice_events (student_id, question_id, is_correct, source)
    VALUES ($1, $2, $3, $4)
    `,
    [studentId, questionId, isCorrect, src],
  )
  if (src === 'practice_check' || src === 'practice_exam') {
    await client.query(
      `
      INSERT INTO student_practice_day (student_id, practice_date, attempts)
      VALUES ($1, (timezone('Asia/Shanghai', now()))::date, 1)
      ON CONFLICT (student_id, practice_date) DO UPDATE SET
        attempts = student_practice_day.attempts + 1
      `,
      [studentId],
    )
    await bumpWrongReviewAfterPractice(client, studentId, questionId, isCorrect)
  }
}

const getQuestionSnapshot = async (executor, questionId) => {
  const questionResult = await executor.query(
    `
    SELECT q.id, q.subject_id, q.question_type, q.stem, q.answer_text, q.explanation, q.difficulty, q.deleted_at, q.updated_at, s.name AS subject_name
    FROM questions q
    JOIN subjects s ON s.id = q.subject_id
    WHERE q.id = $1
    LIMIT 1
    `,
    [questionId],
  )
  const row = questionResult.rows[0]
  if (!row) return null
  const optionsResult = await executor.query(
    `
    SELECT option_key, option_text, sort_order
    FROM question_options
    WHERE question_id = $1
    ORDER BY sort_order ASC, option_key ASC
    `,
    [questionId],
  )
  const tagsResult = await executor.query(
    `
    SELECT COALESCE(ku.name, '') AS unit_name, t.name AS point_name
    FROM question_tag_rel r
    JOIN question_tags t ON t.id = r.tag_id
    LEFT JOIN knowledge_units ku ON ku.id = t.unit_id
    WHERE r.question_id = $1
    ORDER BY ku.name ASC NULLS LAST, t.name ASC
    `,
    [questionId],
  )
  const unitNames = [...new Set(tagsResult.rows.map((item) => String(item.unit_name || '').trim()).filter(Boolean))]
  const knowledgeUnit = unitNames.length === 1 ? unitNames[0] : unitNames[0] || DEFAULT_KNOWLEDGE_UNIT_NAME
  const knowledgePoints = tagsResult.rows.map((item) => String(item.point_name || '').trim()).filter(Boolean)
  return {
    id: row.id,
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    question_type: row.question_type,
    stem: row.stem,
    answer_text: row.answer_text,
    explanation: row.explanation || '',
    difficulty: row.difficulty,
    deleted_at: row.deleted_at,
    updated_at: row.updated_at,
    options: optionsResult.rows.map((item) => ({
      option_key: item.option_key,
      option_text: item.option_text,
      sort_order: item.sort_order,
    })),
    knowledge_unit: knowledgeUnit,
    knowledge_points: knowledgePoints,
  }
}

const writeQuestionVersion = async ({ client, questionId, action, operatorId, meta }) => {
  const snapshot = await getQuestionSnapshot(client || pool, questionId)
  if (!snapshot) return
  await (client || pool).query(
    `
    INSERT INTO question_versions (question_id, action, snapshot, operator_id, created_at)
    VALUES ($1, $2, $3::jsonb, $4, NOW())
    `,
    [questionId, action, JSON.stringify({ ...snapshot, meta: meta || {} }), operatorId || null],
  )
}

const upsertStudentAndJoinClass = async ({
  client,
  classId,
  name,
  studentNo,
  operatorId,
  inviteCode,
  joinChannel,
  realName,
}) => {
  const existing = await client.query('SELECT id, name, student_no FROM students WHERE student_no = $1 LIMIT 1', [studentNo])
  let studentId = existing.rows[0]?.id
  const trimmedReal =
    realName != null && String(realName).trim() ? String(realName).trim().slice(0, 64) : null
  if (!studentId) {
    const inserted = await client.query(
      `INSERT INTO students (name, student_no, real_name) VALUES ($1, $2, $3) RETURNING id`,
      [name, studentNo, trimmedReal],
    )
    studentId = inserted.rows[0].id
  } else if (trimmedReal) {
    await client.query(`UPDATE students SET real_name = $1 WHERE id = $2`, [trimmedReal, studentId])
  }
  await client.query(
    `
    INSERT INTO class_members (class_id, student_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    `,
    [classId, studentId],
  )
  await client.query(
    `
    INSERT INTO class_invite_join_logs (class_id, student_id, invite_code, join_channel, operator_id)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [classId, studentId, inviteCode || null, joinChannel || 'admin_manual', operatorId || null],
  )
  return { studentId }
}

/** 学生已在其它班级时不可直接加入新班（须先申请退班） */
const listStudentClassMemberships = async (client, studentId) => {
  const result = await client.query(
    `
    SELECT c.id, c.name
    FROM class_members cm
    JOIN classes c ON c.id = cm.class_id
    WHERE cm.student_id = $1
    ORDER BY c.name ASC
    `,
    [studentId],
  )
  return result.rows
}

const findOtherClassMemberships = (memberships, targetClassId) =>
  memberships.filter((row) => Number(row.id) !== Number(targetClassId))

/**
 * 学生退出某班级时：凡考试曾在 exam_classes 中关联过该班，即删除该生该场考试的答卷（answers 随 exam_submissions 级联删除），
 * 不区分该生是否仍在其它班级。删除本班学业预警个案。个人刷题统计（student_question_stats / practice_events 等）一律保留。
 */
const clearExamDataWhenLeavingClass = async (client, studentId, classIdLeaving) => {
  await client.query(`DELETE FROM student_warning_cases WHERE class_id = $1 AND student_id = $2`, [
    classIdLeaving,
    studentId,
  ])
  await client.query(
    `
    DELETE FROM exam_submissions es
    WHERE es.student_id = $1
      AND EXISTS (
        SELECT 1 FROM exam_classes ec
        WHERE ec.exam_id = es.exam_id AND ec.class_id = $2
      )
    `,
    [studentId, classIdLeaving],
  )
}

const getExamDefaultConfig = async (client) => {
  const executor = client || pool
  const result = await executor.query(
    `
    SELECT config_value
    FROM system_configs
    WHERE config_key = 'exam_default'
    LIMIT 1
    `,
  )
  const config = (result.rows[0]?.config_value && typeof result.rows[0].config_value === 'object'
    ? result.rows[0].config_value
    : {}) || {}
  return {
    defaultDurationMinutes: Math.max(Number(config.defaultDurationMinutes) || 60, 1),
    defaultQuestionScore: Math.max(Number(config.defaultQuestionScore) || 1, 1),
    copyStartOffsetMinutes: Math.max(Number(config.copyStartOffsetMinutes) || 10, 1),
  }
}

const getWarningRuleConfig = async (client) => {
  const executor = client || pool
  const result = await executor.query(
    `
    SELECT config_value
    FROM system_configs
    WHERE config_key = 'warning_rule'
    LIMIT 1
    `,
  )
  const config = (result.rows[0]?.config_value && typeof result.rows[0].config_value === 'object'
    ? result.rows[0].config_value
    : {}) || {}
  return {
    recentExamCount: Math.min(Math.max(Number(config.recentExamCount) || 5, 3), 12),
    avgScoreThreshold: Math.max(Number(config.avgScoreThreshold) || 60, 0),
    missingThreshold: Math.max(Number(config.missingThreshold) || 2, 1),
  }
}

const assertUserIsActiveClassTeacher = async (client, userId) => {
  const result = await client.query(
    `
    SELECT u.id, u.name
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id AND r.code = 'class_teacher'
    WHERE u.id = $1 AND u.status = 1
    LIMIT 1
    `,
    [userId],
  )
  return result.rows[0] || null
}

const assertClassManageAccess = async (client, classId, auth) => {
  const classResult = await client.query('SELECT id, owner_id FROM classes WHERE id = $1 LIMIT 1', [classId])
  const classRow = classResult.rows[0]
  if (!classRow) return { ok: false, code: 404, message: '班级不存在' }
  const isAdmin = Array.isArray(auth?.roles) && auth.roles.includes('admin')
  const isOwner = Number(classRow.owner_id) === Number(auth?.userId)
  if (!isAdmin && !isOwner) return { ok: false, code: 403, message: '无权限操作该班级' }
  return { ok: true, classRow }
}

const assertClassReadAccess = async (client, classId, auth) => {
  const classResult = await client.query('SELECT id, owner_id FROM classes WHERE id = $1 LIMIT 1', [classId])
  const classRow = classResult.rows[0]
  if (!classRow) return { ok: false, code: 404, message: '班级不存在' }
  const isAdmin = Array.isArray(auth?.roles) && auth.roles.includes('admin')
  const isOwner = Number(classRow.owner_id) === Number(auth?.userId)
  if (isAdmin || isOwner) return { ok: true, classRow }
  const membership = await client.query(
    'SELECT 1 FROM class_teachers WHERE class_id = $1 AND teacher_id = $2 LIMIT 1',
    [classId, auth?.userId],
  )
  if (membership.rowCount > 0) return { ok: true, classRow }
  return { ok: false, code: 403, message: '无权限查看该班级' }
}

const assertExamManageAccess = async (client, examId, auth) => {
  const result = await client.query('SELECT id, creator_id FROM exams WHERE id = $1 LIMIT 1', [examId])
  const exam = result.rows[0]
  if (!exam) return { ok: false, code: 404, message: '考试不存在' }
  const isAdmin = Array.isArray(auth?.roles) && auth.roles.includes('admin')
  const isCreator = Number(exam.creator_id) === Number(auth?.userId)
  if (!isAdmin && !isCreator) return { ok: false, code: 403, message: '无权限操作该考试' }
  return { ok: true, exam }
}

const assertExamReadAccess = async (client, examId, auth) => {
  const result = await client.query('SELECT id, creator_id FROM exams WHERE id = $1 LIMIT 1', [examId])
  const exam = result.rows[0]
  if (!exam) return { ok: false, code: 404, message: '考试不存在' }
  const isAdmin = Array.isArray(auth?.roles) && auth.roles.includes('admin')
  const isCreator = Number(exam.creator_id) === Number(auth?.userId)
  if (isAdmin || isCreator) return { ok: true, exam }
  const member = await client.query(
    `
    SELECT 1
    FROM exam_classes ec
    WHERE ec.exam_id = $1
      AND (
        EXISTS (
          SELECT 1 FROM class_teachers ct
          WHERE ct.class_id = ec.class_id AND ct.teacher_id = $2
        )
        OR EXISTS (
          SELECT 1 FROM classes c
          WHERE c.id = ec.class_id AND c.owner_id = $2
        )
      )
    LIMIT 1
    `,
    [examId, auth?.userId],
  )
  if (member.rowCount > 0) return { ok: true, exam }
  return { ok: false, code: 403, message: '无权限查看该考试' }
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim()
    const password = String(req.body?.password || '')
    if (!phone || !password) {
      return res.status(400).json({ message: '手机号和密码不能为空' })
    }

    const userResult = await pool.query(
      `
      SELECT id, name, phone, password_hash, status, avatar_url
      FROM users
      WHERE phone = $1
      LIMIT 1
      `,
      [phone],
    )
    const user = userResult.rows[0]
    if (!user) {
      return res.status(401).json({ message: '手机号或密码错误' })
    }
    if (Number(user.status) !== 1) {
      return res.status(403).json({ message: '账号已禁用，请联系管理员' })
    }

    const isBcryptHash = typeof user.password_hash === 'string' && user.password_hash.startsWith('$2')
    const passOk = isBcryptHash
      ? await bcrypt.compare(password, user.password_hash)
      : password === user.password_hash
    if (!passOk) {
      return res.status(401).json({ message: '手机号或密码错误' })
    }

    const rolesResult = await pool.query(
      `
      SELECT r.code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.id
      `,
      [user.id],
    )
    const roleCodes = rolesResult.rows.map((row) => row.code)
    const subjectIds = await loadTeacherSubjectIds(pool, user.id)

    const token = jwt.sign(
      {
        userId: user.id,
        phone: user.phone,
        roles: roleCodes,
      },
      JWT_SECRET,
      { expiresIn: '24h' },
    )

    await pool.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id])

    return res.json({
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          roles: roleCodes,
          avatarUrl: user.avatar_url || '',
          subjectIds,
        },
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '登录失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

const resolveTeacherAuthUserId = (req) => {
  if (!req.auth || typeof req.auth !== 'object') return null
  const raw = req.auth.userId ?? req.auth.user_id ?? req.auth.id
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

const handleTeacherGetMe = async (req, res) => {
  const userId = resolveTeacherAuthUserId(req)
  if (!userId) {
    return res.status(401).json({ message: '登录状态无效，请重新登录教师账号' })
  }
  try {
    const userResult = await pool.query(
      `
      SELECT u.id, u.name, u.phone, u.status, u.avatar_url, u.created_at
      FROM users u
      WHERE u.id = $1
      LIMIT 1
      `,
      [userId],
    )
    const user = userResult.rows[0]
    if (!user) {
      return res.status(401).json({ message: '账号已失效，请重新登录' })
    }
    const rolesResult = await pool.query(
      `
      SELECT r.code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.id
      `,
      [userId],
    )
    const roles = rolesResult.rows.map((row) => row.code)
    const subjectIds = await loadTeacherSubjectIds(pool, userId)
    return res.json({
      data: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        status: user.status,
        avatarUrl: user.avatar_url || '',
        roles,
        subjectIds,
        created_at: user.created_at,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载个人信息失败', detail: error instanceof Error ? error.message : String(error) })
  }
}

app.get('/api/auth/me', authRequired, handleTeacherGetMe)
app.get('/api/users/me', authRequired, handleTeacherGetMe)

app.patch('/api/auth/me', authRequired, async (req, res) => {
  const userId = resolveTeacherAuthUserId(req)
  if (!userId) {
    return res.status(401).json({ message: '登录状态无效，请重新登录教师账号' })
  }
  const name = String(req.body?.name || '').trim()
  const avatarRaw = req.body?.avatarUrl !== undefined ? String(req.body.avatarUrl || '').trim() : undefined
  if (!name) return res.status(400).json({ message: '姓名不能为空' })
  try {
    const setParts = ['name = $1', 'updated_at = NOW()']
    const values = [name]
    if (avatarRaw !== undefined) {
      values.push(avatarRaw || null)
      setParts.push(`avatar_url = $${values.length}`)
    }
    values.push(userId)
    const result = await pool.query(
      `
      UPDATE users SET ${setParts.join(', ')}
      WHERE id = $${values.length}
      RETURNING id, name, phone, avatar_url
      `,
      values,
    )
    const row = result.rows[0]
    if (!row) return res.status(401).json({ message: '账号已失效，请重新登录' })
    const rolesResult = await pool.query(
      `
      SELECT r.code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.id
      `,
      [userId],
    )
    const roles = rolesResult.rows.map((r) => r.code)
    await writeOperationLog({
      operatorId: userId,
      action: 'user.self_profile_update',
      targetType: 'user',
      targetId: String(userId),
      detail: { name, avatar_updated: avatarRaw !== undefined },
    })
    return res.json({
      data: {
        id: row.id,
        name: row.name,
        phone: row.phone,
        roles,
        avatarUrl: row.avatar_url || '',
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '保存个人信息失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.patch('/api/auth/me/password', authRequired, async (req, res) => {
  const userId = resolveTeacherAuthUserId(req)
  if (!userId) {
    return res.status(401).json({ message: '登录状态无效，请重新登录教师账号' })
  }
  const currentPassword = String(req.body?.currentPassword || '')
  const newPassword = String(req.body?.newPassword || '')
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: '当前密码与新密码均不能为空' })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: '新密码长度至少 6 位' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userResult = await client.query(
      `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [userId],
    )
    const user = userResult.rows[0]
    if (!user) {
      await client.query('ROLLBACK')
      return res.status(401).json({ message: '账号已失效，请重新登录' })
    }
    const isBcryptHash = typeof user.password_hash === 'string' && user.password_hash.startsWith('$2')
    const passOk = isBcryptHash
      ? await bcrypt.compare(currentPassword, user.password_hash)
      : currentPassword === user.password_hash
    if (!passOk) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '当前密码不正确' })
    }
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await client.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, user.id])
    await writeOperationLog({
      client,
      operatorId: userId,
      action: 'user.self_password_change',
      targetType: 'user',
      targetId: String(user.id),
      detail: {},
    })
    await client.query('COMMIT')
    return res.json({ data: { ok: true } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '修改密码失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/auth/me/avatar-upload', authRequired, (req, res) => {
  const userId = resolveTeacherAuthUserId(req)
  if (!userId) {
    return res.status(401).json({ message: '登录状态无效，请重新登录教师账号' })
  }
  avatarUpload.single('file')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '头像图片不能超过 2MB' })
      }
      return res.status(400).json({ message: error instanceof Error ? error.message : '上传失败' })
    }
    const file = req.file
    if (!file) return res.status(400).json({ message: '未检测到上传文件' })
    const fileUrl = `${UPLOAD_PUBLIC_BASE}/uploads/${file.filename}`
    return res.json({ data: { avatarUrl: fileUrl } })
  })
})

/** Express 对重复 query 可能给出 string[]，取第一个非空值 */
const firstQueryParam = (value) => {
  if (value == null) return undefined
  if (Array.isArray(value)) {
    const hit = value.find((item) => item != null && String(item).trim() !== '')
    return hit == null ? undefined : hit
  }
  return value
}

app.get('/api/subjects', authRequired, async (req, res) => {
  /**
   * 与科目列表同一路径；须显式 scope，避免误把「仅带其它 query」的请求当成知识单元（也避免与将来筛选参数混淆）。
   * 推荐：GET /api/subjects?scope=knowledge_units&subjectId=<科目id>
   * 兼容：knowledgeUnitsSubjectId=…（旧前端）
   */
  const scope = String(firstQueryParam(req.query?.scope) ?? '').trim()
  if (scope === 'knowledge_units' || scope === 'units') {
    const sid = firstQueryParam(req.query?.subjectId ?? req.query?.subject_id)
    if (sid == null || String(sid).trim() === '') {
      return res.status(400).json({ message: '查询知识单元须同时传 subjectId（所属科目 id）' })
    }
    return listKnowledgeUnitsForSubjectHandler(req, res, sid)
  }
  if (scope === 'knowledge_tags' || scope === 'tags') {
    const sid = firstQueryParam(req.query?.subjectId ?? req.query?.subject_id)
    if (sid == null || String(sid).trim() === '') {
      return res.status(400).json({ message: '查询知识点须同时传 subjectId（所属科目 id）' })
    }
    return listKnowledgeTagsForSubjectHandler(req, res, sid)
  }
  const legacyKu = firstQueryParam(
    req.query?.knowledgeUnitsSubjectId ?? req.query?.knowledge_units_subject_id ?? req.query?.knowledgeUnitsFor,
  )
  if (legacyKu != null && String(legacyKu).trim() !== '') {
    return listKnowledgeUnitsForSubjectHandler(req, res, legacyKu)
  }
  try {
    const { rows } = await pool.query(
      `
      SELECT id, name, sort_order
      FROM subjects
      ORDER BY sort_order ASC, id ASC
      `,
    )
    res.json({ data: rows, meta: { resource: 'subjects' } })
  } catch (error) {
    res.status(500).json({ message: '科目列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/operation-logs', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可查看操作日志' })
  }
  try {
    const { action, keyword, operatorId, startTime, endTime, page, pageSize } = req.query
    const values = []
    const conditions = []
    const safePage = Math.max(Number(page) || 1, 1)
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
    if (action && String(action).trim()) {
      values.push(String(action).trim())
      conditions.push(`l.action = $${values.length}`)
    }
    if (operatorId && !Number.isNaN(Number(operatorId))) {
      values.push(Number(operatorId))
      conditions.push(`l.operator_id = $${values.length}`)
    }
    if (startTime && !Number.isNaN(new Date(String(startTime)).getTime())) {
      values.push(new Date(String(startTime)).toISOString())
      conditions.push(`l.created_at >= $${values.length}`)
    }
    if (endTime && !Number.isNaN(new Date(String(endTime)).getTime())) {
      values.push(new Date(String(endTime)).toISOString())
      conditions.push(`l.created_at <= $${values.length}`)
    }
    if (keyword && String(keyword).trim()) {
      values.push(`%${String(keyword).trim()}%`)
      conditions.push(`(l.action ILIKE $${values.length} OR COALESCE(u.name, '') ILIKE $${values.length} OR COALESCE(l.target_type, '') ILIKE $${values.length})`)
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM operation_logs l
      LEFT JOIN users u ON u.id = l.operator_id
      ${whereClause}
    `
    const countResult = await pool.query(countSql, values)
    const total = Number(countResult.rows[0]?.total || 0)
    const queryValues = [...values, safePageSize, (safePage - 1) * safePageSize]
    const { rows } = await pool.query(
      `
      SELECT
        l.id,
        l.operator_id,
        COALESCE(u.name, '系统') AS operator_name,
        l.action,
        l.target_type,
        l.target_id,
        l.detail,
        l.created_at
      FROM operation_logs l
      LEFT JOIN users u ON u.id = l.operator_id
      ${whereClause}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
      `,
      queryValues,
    )
    return res.json({
      data: rows,
      pagination: {
        total,
        page: safePage,
        pageSize: safePageSize,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '操作日志查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/system-configs/exam-default', authRequired, async (_req, res) => {
  try {
    const config = await getExamDefaultConfig()
    return res.json({ data: config })
  } catch (error) {
    return res.status(500).json({ message: '加载考试默认参数失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.put('/api/system-configs/exam-default', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可修改系统参数' })
  }
  const defaultDurationMinutes = Math.max(Number(req.body?.defaultDurationMinutes) || 0, 1)
  const defaultQuestionScore = Math.max(Number(req.body?.defaultQuestionScore) || 0, 1)
  const copyStartOffsetMinutes = Math.max(Number(req.body?.copyStartOffsetMinutes) || 0, 1)
  try {
    const payload = {
      defaultDurationMinutes,
      defaultQuestionScore,
      copyStartOffsetMinutes,
    }
    await pool.query(
      `
      INSERT INTO system_configs (config_key, config_value, updated_by, updated_at)
      VALUES ('exam_default', $1::jsonb, $2, NOW())
      ON CONFLICT (config_key)
      DO UPDATE SET config_value = EXCLUDED.config_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      `,
      [JSON.stringify(payload), req.auth?.userId || null],
    )
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'system_config.exam_default.update',
      targetType: 'system_config',
      targetId: 'exam_default',
      detail: payload,
    })
    return res.json({ data: payload })
  } catch (error) {
    return res.status(500).json({ message: '保存考试默认参数失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/system-configs/warning-rule', authRequired, async (_req, res) => {
  try {
    const config = await getWarningRuleConfig()
    return res.json({ data: config })
  } catch (error) {
    return res.status(500).json({ message: '加载预警规则参数失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.put('/api/system-configs/warning-rule', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可修改系统参数' })
  }
  const recentExamCount = Math.min(Math.max(Number(req.body?.recentExamCount) || 0, 3), 12)
  const avgScoreThreshold = Math.max(Number(req.body?.avgScoreThreshold) || 0, 0)
  const missingThreshold = Math.max(Number(req.body?.missingThreshold) || 0, 1)
  try {
    const payload = {
      recentExamCount,
      avgScoreThreshold,
      missingThreshold,
    }
    await pool.query(
      `
      INSERT INTO system_configs (config_key, config_value, updated_by, updated_at)
      VALUES ('warning_rule', $1::jsonb, $2, NOW())
      ON CONFLICT (config_key)
      DO UPDATE SET config_value = EXCLUDED.config_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      `,
      [JSON.stringify(payload), req.auth?.userId || null],
    )
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'system_config.warning_rule.update',
      targetType: 'system_config',
      targetId: 'warning_rule',
      detail: payload,
    })
    return res.json({ data: payload })
  } catch (error) {
    return res.status(500).json({ message: '保存预警规则参数失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/subjects', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可新增科目' })
  }
  /**
   * 推荐：在科目下新增知识单元用查询串（与 GET 一样不易被网关剥 body 字段）
   * POST /api/subjects?op=add_knowledge_unit&subjectId=<科目数字id>  Body: { "name": "单元名" }
   */
  const op = String(firstQueryParam(req.query?.op) ?? '')
    .trim()
    .toLowerCase()
  const sidQRaw = firstQueryParam(req.query?.subjectId ?? req.query?.subject_id)
  const sidQ = Number(sidQRaw)
  if (op === 'add_knowledge_unit' || op === 'addknowledgeunit') {
    if (!Number.isInteger(sidQ) || sidQ <= 0) {
      return res.status(400).json({ message: '新增知识单元须在 URL 中附带 subjectId=所属科目数字 id（与 op=add_knowledge_unit 同时使用）' })
    }
    return createKnowledgeUnitHandler(req, res, sidQ)
  }

  const nameTrim = String(req.body?.name || '').trim()
  const sidRaw = req.body?.subjectId ?? req.body?.subject_id
  const sidNum = Number(sidRaw)
  const hasParentSubject = Number.isInteger(sidNum) && sidNum > 0
  const kuExplicit =
    req.body?._kind === 'knowledge_unit' ||
    req.body?.kind === 'knowledge_unit' ||
    req.body?.action === 'create_knowledge_unit'
  /** 仅新增科目：显式 intent，避免与「科目 id + 单元名」混淆 */
  const forceNewSubjectOnly = req.body?.intent === 'subject' || req.body?.createSubject === true
  /**
   * 在科目下新增知识单元（兼容旧 body）：须带所属科目 id + 单元名称。
   * 若网关会剥 JSON 里的 subjectId/kind，请改用 URL：?op=add_knowledge_unit&subjectId=…
   */
  if (!forceNewSubjectOnly && (kuExplicit || (hasParentSubject && nameTrim))) {
    if (!hasParentSubject) {
      return res.status(400).json({ message: '新增知识单元须指定 subjectId（所属科目），或使用 URL ?op=add_knowledge_unit&subjectId=…' })
    }
    return createKnowledgeUnitHandler(req, res, sidNum)
  }
  const name = nameTrim
  if (!name) {
    return res.status(400).json({ message: '科目名称不能为空' })
  }
  try {
    const maxResult = await pool.query('SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM subjects')
    const nextSort = Number(maxResult.rows[0]?.max_sort || 0) + 1
    const result = await pool.query(
      `
      INSERT INTO subjects (name, sort_order)
      VALUES ($1, $2)
      RETURNING id, name, sort_order
      `,
      [name, nextSort],
    )
    const newSubjectId = Number(result.rows[0]?.id)
    await pool.query(
      `
      INSERT INTO knowledge_units (name, subject_id, sort_order)
      SELECT '未分类', $1, 0
      WHERE NOT EXISTS (SELECT 1 FROM knowledge_units WHERE subject_id = $1 AND name = '未分类')
      `,
      [newSubjectId],
    )
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'subject.create',
      targetType: 'subject',
      targetId: String(result.rows[0]?.id || ''),
      detail: { name },
    })
    return res.status(201).json({ data: result.rows[0] })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return res.status(409).json({
        message:
          '科目名称已存在。若您实际在添加「知识单元」却看到本提示，多半是请求被当成新增科目：请改用 POST /api/subjects?op=add_knowledge_unit&subjectId=科目id，且 JSON 体只传 name。',
      })
    }
    return res.status(500).json({ message: '新增科目失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.delete('/api/subjects/:id', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可删除科目' })
  }
  const id = Number(req.params.id)
  if (Number.isNaN(id) || id <= 0) {
    return res.status(400).json({ message: '科目ID不合法' })
  }
  try {
    const result = await pool.query('DELETE FROM subjects WHERE id = $1 RETURNING id, name', [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ message: '科目不存在' })
    }
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'subject.delete',
      targetType: 'subject',
      targetId: String(id),
      detail: { name: result.rows[0]?.name || '' },
    })
    return res.json({ data: result.rows[0] })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23503') {
      return res.status(400).json({ message: '该科目已被使用，无法删除' })
    }
    return res.status(500).json({ message: '删除科目失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 列表：扁平路径优先（部分网关对 /api/subjects/:id/knowledge-units 返回 404） */
const listKnowledgeUnitsForSubjectHandler = async (req, res, subjectIdRaw) => {
  const subjectId = Number(subjectIdRaw)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: '科目ID不合法' })
  }
  try {
    const subjectCheck = await pool.query(`SELECT id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
    if (!subjectCheck.rows[0]) {
      return res.status(404).json({ message: '科目不存在' })
    }
    const { rows } = await pool.query(
      `
      SELECT id, name, sort_order, subject_id
      FROM knowledge_units
      WHERE subject_id = $1
      ORDER BY sort_order ASC, id ASC
      `,
      [subjectId],
    )
    return res.json({
      data: rows,
      meta: { resource: 'knowledge_units', subjectId },
    })
  } catch (error) {
    return res.status(500).json({ message: '知识单元列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
}

/** 某科目下题目已用到的知识点标签（question_tags.name），供考试/题库筛选下拉 */
const listKnowledgeTagsForSubjectHandler = async (req, res, subjectIdRaw) => {
  const subjectId = Number(subjectIdRaw)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: '科目ID不合法' })
  }
  try {
    const subjectCheck = await pool.query(`SELECT id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
    if (!subjectCheck.rows[0]) {
      return res.status(404).json({ message: '科目不存在' })
    }
    const { rows } = await pool.query(
      `
      SELECT DISTINCT qt.name AS name
      FROM question_tags qt
      INNER JOIN question_tag_rel qtr ON qtr.tag_id = qt.id
      INNER JOIN questions q ON q.id = qtr.question_id AND q.deleted_at IS NULL
      WHERE q.subject_id = $1
      ORDER BY qt.name ASC
      `,
      [subjectId],
    )
    return res.json({
      data: rows.map((r) => ({ name: String(r.name || '') })).filter((r) => r.name),
      meta: { resource: 'knowledge_tags', subjectId },
    })
  } catch (error) {
    return res.status(500).json({ message: '知识点列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
}

app.get('/api/knowledge-units', authRequired, async (req, res) => {
  const raw = req.query?.subjectId ?? req.query?.subject_id
  return listKnowledgeUnitsForSubjectHandler(req, res, raw)
})

/** 与 GET /api/subjects 同前缀，便于只放行了 /api/subjects/* 的网关 */
app.get('/api/subjects/knowledge-units', authRequired, async (req, res) => {
  const raw = req.query?.subjectId ?? req.query?.subject_id
  return listKnowledgeUnitsForSubjectHandler(req, res, raw)
})

app.get('/api/subjects/:id/knowledge-units', authRequired, async (req, res) => {
  return listKnowledgeUnitsForSubjectHandler(req, res, req.params.id)
})

const createKnowledgeUnitHandler = async (req, res, subjectIdRaw) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可维护知识单元字典' })
  }
  const subjectId = Number(subjectIdRaw)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: '科目ID不合法' })
  }
  const name = String(req.body?.name || '').trim()
  if (!name) {
    return res.status(400).json({ message: '知识单元名称不能为空' })
  }
  if (name.length > 128) {
    return res.status(400).json({ message: '知识单元名称过长' })
  }
  const sortOrder = Math.max(0, parseInt(String(req.body?.sortOrder ?? '0'), 10) || 0)
  try {
    const subjectCheck = await pool.query(`SELECT id, name FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
    if (!subjectCheck.rows[0]) {
      return res.status(404).json({ message: '科目不存在' })
    }
    const maxResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM knowledge_units WHERE subject_id = $1`,
      [subjectId],
    )
    const nextSort = sortOrder > 0 ? sortOrder : Number(maxResult.rows[0]?.max_sort || 0) + 1
    const result = await pool.query(
      `
      INSERT INTO knowledge_units (name, subject_id, sort_order)
      VALUES ($1, $2, $3)
      RETURNING id, name, sort_order
      `,
      [name, subjectId, nextSort],
    )
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'knowledge_unit.create',
      targetType: 'knowledge_unit',
      targetId: String(result.rows[0]?.id || ''),
      detail: { subject_id: subjectId, subject_name: subjectCheck.rows[0]?.name || '', name },
    })
    return res.status(201).json({ data: result.rows[0] })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const c = 'constraint' in error ? String(error.constraint || '') : ''
      const legacyGlobalName =
        c === 'knowledge_units_name_key' ||
        c === 'knowledge_units_name_uidx' ||
        (/knowledge_units/i.test(c) &&
          /name/i.test(c) &&
          !/subject_id|subject_name|global_name/i.test(c))
      return res.status(409).json({
        message: legacyGlobalName
          ? '知识单元名称与库内其他记录冲突：数据库可能仍为「全局按名称唯一」的旧结构。请重启后端以执行迁移（去掉全局 UNIQUE(name)，改为按科目唯一）；或临时换一个全局未出现过的名称。'
          : '该科目下已存在同名「知识单元」（与科目名称无关，请换单元名或勿重复添加「未分类」）。',
      })
    }
    return res.status(500).json({ message: '新增知识单元失败', detail: error instanceof Error ? error.message : String(error) })
  }
}

app.post('/api/knowledge-units', authRequired, async (req, res) => {
  const sid = req.body?.subjectId ?? req.body?.subject_id
  return createKnowledgeUnitHandler(req, res, sid)
})

app.post('/api/subjects/knowledge-units', authRequired, async (req, res) => {
  const sid = req.body?.subjectId ?? req.body?.subject_id
  return createKnowledgeUnitHandler(req, res, sid)
})

app.post('/api/subjects/:id/knowledge-units', authRequired, async (req, res) => {
  return createKnowledgeUnitHandler(req, res, req.params.id)
})

app.delete('/api/knowledge-units/:id', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可删除知识单元' })
  }
  const unitId = Number(req.params.id)
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return res.status(400).json({ message: '知识单元ID不合法' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const rowResult = await client.query(
      `SELECT id, name, subject_id FROM knowledge_units WHERE id = $1 LIMIT 1`,
      [unitId],
    )
    const row = rowResult.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '知识单元不存在' })
    }
    if (row.subject_id == null) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '系统保留的全局知识单元不可删除' })
    }
    if (String(row.name || '') === DEFAULT_KNOWLEDGE_UNIT_NAME) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '默认「未分类」知识单元不可删除' })
    }
    const useResult = await client.query(
      `
      SELECT COUNT(*)::int AS c
      FROM question_tag_rel qtr
      INNER JOIN question_tags qt ON qt.id = qtr.tag_id
      WHERE qt.unit_id = $1
      `,
      [unitId],
    )
    const used = Number(useResult.rows[0]?.c || 0)
    if (used > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该知识单元下已有题目关联的知识点，无法删除' })
    }
    const orphanTags = await client.query(`SELECT COUNT(*)::int AS c FROM question_tags WHERE unit_id = $1`, [unitId])
    if (Number(orphanTags.rows[0]?.c || 0) > 0) {
      await client.query(`DELETE FROM question_tags WHERE unit_id = $1`, [unitId])
    }
    await client.query(`DELETE FROM knowledge_units WHERE id = $1`, [unitId])
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'knowledge_unit.delete',
      targetType: 'knowledge_unit',
      targetId: String(unitId),
      detail: { name: row.name, subject_id: row.subject_id },
    })
    await client.query('COMMIT')
    return res.json({ data: { id: unitId } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error && typeof error === 'object' && 'code' in error && error.code === '23503') {
      return res.status(400).json({ message: '该知识单元仍被引用，无法删除' })
    }
    return res.status(500).json({ message: '删除知识单元失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

const parsePositiveIntIds = (raw) => {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const ids = []
  for (const item of raw) {
    const n = Number(item)
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    ids.push(n)
  }
  return ids
}

app.patch('/api/subjects/reorder', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可调整科目排序' })
  }
  const ids = parsePositiveIntIds(req.body?.ids)
  if (!ids.length) {
    return res.status(400).json({ message: 'ids 不能为空' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query(`SELECT id FROM subjects ORDER BY id ASC`)
    const existingIds = existing.rows.map((r) => Number(r.id))
    if (ids.length !== existingIds.length || !ids.every((id) => existingIds.includes(id))) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ids 须包含全部科目且不可重复' })
    }
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(`UPDATE subjects SET sort_order = $1 WHERE id = $2`, [i + 1, ids[i]])
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'subject.reorder',
      targetType: 'subject',
      targetId: 'batch',
      detail: { ids },
    })
    await client.query('COMMIT')
    return res.json({ data: { ok: true } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '科目排序保存失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/knowledge-units/reorder', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可调整知识单元排序' })
  }
  const subjectId = Number(req.body?.subjectId ?? req.body?.subject_id)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: 'subjectId 不合法' })
  }
  const ids = parsePositiveIntIds(req.body?.ids)
  if (!ids.length) {
    return res.status(400).json({ message: 'ids 不能为空' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const subjectCheck = await client.query(`SELECT id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
    if (!subjectCheck.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '科目不存在' })
    }
    const existing = await client.query(
      `
      SELECT id, name
      FROM knowledge_units
      WHERE subject_id = $1
      ORDER BY id ASC
      `,
      [subjectId],
    )
    const pinnedIds = existing.rows
      .filter((r) => String(r.name || '') === DEFAULT_KNOWLEDGE_UNIT_NAME)
      .map((r) => Number(r.id))
    const draggableIds = existing.rows
      .filter((r) => String(r.name || '') !== DEFAULT_KNOWLEDGE_UNIT_NAME)
      .map((r) => Number(r.id))
    if (ids.length !== draggableIds.length || !ids.every((id) => draggableIds.includes(id))) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'ids 须包含该科目下全部可排序知识单元且不可重复（不含「未分类」）' })
    }
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(`UPDATE knowledge_units SET sort_order = $1 WHERE id = $2 AND subject_id = $3`, [
        i + 1,
        ids[i],
        subjectId,
      ])
    }
    for (const pinnedId of pinnedIds) {
      await client.query(`UPDATE knowledge_units SET sort_order = 0 WHERE id = $1 AND subject_id = $2`, [
        pinnedId,
        subjectId,
      ])
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'knowledge_unit.reorder',
      targetType: 'knowledge_unit',
      targetId: String(subjectId),
      detail: { subjectId, ids },
    })
    await client.query('COMMIT')
    return res.json({ data: { ok: true } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '知识单元排序保存失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/users', authRequired, async (req, res) => {
  try {
    if (!canAccessTeacherAccounts(req)) {
      return res.status(403).json({ message: '无权限查看教师账号列表' })
    }
    const isAdmin = hasRole(req, 'admin')
    const ownerId = Number(req.auth?.userId) || 0

    const sql = isAdmin
      ? `
      SELECT
        u.id,
        u.name,
        u.phone,
        u.status,
        u.created_at,
        COALESCE(array_remove(array_agg(DISTINCT r.code), NULL), '{}') AS roles,
        COALESCE(array_remove(array_agg(DISTINCT s.id), NULL), '{}') AS subject_ids,
        COALESCE(array_remove(array_agg(DISTINCT s.name), NULL), '{}') AS subjects
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN teacher_subjects ts ON ts.teacher_id = u.id
      LEFT JOIN subjects s ON s.id = ts.subject_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `
      : `
      SELECT
        u.id,
        u.name,
        u.phone,
        u.status,
        u.created_at,
        COALESCE(array_remove(array_agg(DISTINCT r.code), NULL), '{}') AS roles,
        COALESCE(array_remove(array_agg(DISTINCT s.id), NULL), '{}') AS subject_ids,
        COALESCE(array_remove(array_agg(DISTINCT s.name), NULL), '{}') AS subjects
      FROM users u
      INNER JOIN user_roles ur ON ur.user_id = u.id
      INNER JOIN roles r ON r.id = ur.role_id AND r.code = 'subject_teacher'
      LEFT JOIN teacher_subjects ts ON ts.teacher_id = u.id
      LEFT JOIN subjects s ON s.id = ts.subject_id
      WHERE EXISTS (
        SELECT 1
        FROM class_teachers ct
        JOIN classes c ON c.id = ct.class_id
        WHERE ct.teacher_id = u.id AND c.owner_id = $1
      )
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `
    const { rows } = await pool.query(sql, isAdmin ? [] : [ownerId])
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '教师账号列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/classes', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const isClassTeacher = hasRole(req, 'class_teacher')
    const isSubjectTeacher = hasRole(req, 'subject_teacher')
    const values = []
    let whereClause = ''
    if (!isAdmin) {
      const parts = []
      if (isClassTeacher) {
        values.push(req.auth.userId)
        parts.push(`c.owner_id = $${values.length}`)
      }
      if (isSubjectTeacher) {
        if (values.length === 0) values.push(req.auth.userId)
        const uidIdx = values.length
        parts.push(`EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = c.id AND ct.teacher_id = $${uidIdx})`)
      }
      if (parts.length === 0) {
        whereClause = 'WHERE 1 = 0'
      } else if (parts.length === 1) {
        whereClause = `WHERE ${parts[0]}`
      } else {
        whereClause = `WHERE (${parts.join(' OR ')})`
      }
    }
    const sql = `
      SELECT
        c.id,
        c.name,
        c.invite_code,
        c.invite_enabled,
        c.invite_expires_at,
        c.join_audit_mode,
        c.owner_id,
        MAX(ou.name) AS owner_name,
        BOOL_OR(
          EXISTS (
            SELECT 1
            FROM user_roles our
            JOIN roles orr ON orr.id = our.role_id AND orr.code = 'class_teacher'
            WHERE our.user_id = c.owner_id
          )
        ) AS owner_is_class_teacher,
        c.created_at,
        COALESCE(COUNT(cm.student_id), 0)::int AS student_count
      FROM classes c
      LEFT JOIN users ou ON ou.id = c.owner_id
      LEFT JOIN class_members cm ON cm.class_id = c.id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `
    const { rows } = await pool.query(sql, values)
    const userId = Number(req.auth?.userId) || 0
    const data = rows.map((row) => ({
      ...row,
      can_manage: Boolean(isAdmin || Number(row.owner_id) === userId),
    }))
    res.json({ data })
  } catch (error) {
    res.status(500).json({ message: '班级列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/classes', authRequired, async (req, res) => {
  if (!canCreateClass(req)) {
    return res.status(403).json({ message: '仅管理员或班主任可创建班级' })
  }
  const name = String(req.body?.name || '').trim()
  if (!name) {
    return res.status(400).json({ message: '班级名称不能为空' })
  }
  const dup = await pool.query(`SELECT id FROM classes WHERE btrim(name) = $1 LIMIT 1`, [name])
  if (dup.rows[0]) {
    return res.status(400).json({ message: '班级名称已存在，请使用其他名称' })
  }
  const grade = String(req.body?.grade ?? '').trim()
  const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()
  let ownerId = Number(req.auth.userId)
  if (hasRole(req, 'admin')) {
    const requestedOwnerId = Number(req.body?.ownerId ?? req.body?.owner_id)
    if (Number.isInteger(requestedOwnerId) && requestedOwnerId > 0) {
      const ownerUser = await assertUserIsActiveClassTeacher(pool, requestedOwnerId)
      if (!ownerUser) {
        return res.status(400).json({ message: '班主任账号不存在或未具备班主任角色' })
      }
      ownerId = requestedOwnerId
    }
  }
  try {
    const result = await pool.query(
      `
      INSERT INTO classes (name, grade, invite_code, owner_id, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, name, grade, invite_code, invite_enabled, invite_expires_at, join_audit_mode, owner_id, created_at
      `,
      [name, grade, inviteCode, ownerId],
    )
    const row = result.rows[0] || {}
    const { grade: _omitGrade, ...createdPublic } = row
    res.status(201).json({ data: createdPublic })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return res.status(400).json({ message: '班级名称已存在，请使用其他名称' })
    }
    res.status(500).json({ message: '创建班级失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.patch('/api/classes/:id/owner', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可分配班主任' })
  }
  const classId = Number(req.params.id)
  const ownerId = Number(req.body?.ownerId ?? req.body?.owner_id)
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ message: '班级ID不合法' })
  }
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    return res.status(400).json({ message: '请选择班主任' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const classResult = await client.query('SELECT id, name, owner_id FROM classes WHERE id = $1 LIMIT 1', [classId])
    const classRow = classResult.rows[0]
    if (!classRow) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '班级不存在' })
    }
    const ownerUser = await assertUserIsActiveClassTeacher(client, ownerId)
    if (!ownerUser) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '班主任账号不存在或未具备班主任角色' })
    }
    if (Number(classRow.owner_id) === ownerId) {
      await client.query('ROLLBACK')
      return res.json({
        data: {
          id: classId,
          owner_id: ownerId,
          owner_name: ownerUser.name,
        },
      })
    }
    const updated = await client.query(
      `
      UPDATE classes
      SET owner_id = $2
      WHERE id = $1
      RETURNING id, name, owner_id
      `,
      [classId, ownerId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.assign_owner',
      targetType: 'class',
      targetId: String(classId),
      detail: {
        class_name: classRow.name,
        from_owner_id: Number(classRow.owner_id),
        to_owner_id: ownerId,
        to_owner_name: ownerUser.name,
      },
    })
    await client.query('COMMIT')
    return res.json({
      data: {
        id: updated.rows[0]?.id,
        owner_id: ownerId,
        owner_name: ownerUser.name,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '分配班主任失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.delete('/api/classes/:id', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId) || classId <= 0) return res.status(400).json({ message: '班级ID不合法' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }
    const del = await client.query('DELETE FROM classes WHERE id = $1 RETURNING id, name', [classId])
    if (del.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '班级不存在' })
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.delete',
      targetType: 'class',
      targetId: String(classId),
      detail: { name: del.rows[0]?.name || '' },
    })
    await client.query('COMMIT')
    return res.json({ data: { id: classId } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error && typeof error === 'object' && 'code' in error && error.code === '23503') {
      return res.status(400).json({ message: '该班级仍有关联数据无法删除，请先解除关联' })
    }
    return res.status(500).json({ message: '删除班级失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/classes/:id/invite-code/reset', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId)) return res.status(400).json({ message: '班级ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()
    const result = await client.query(
      `
      UPDATE classes
      SET invite_code = $1, invite_enabled = TRUE
      WHERE id = $2
      RETURNING id, invite_code, invite_enabled, invite_expires_at
      `,
      [inviteCode, classId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.invite_code.reset',
      targetType: 'class',
      targetId: String(classId),
      detail: { invite_code: inviteCode },
    })
    return res.json({ data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ message: '重置邀请码失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/classes/:id/invite-config', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId)) return res.status(400).json({ message: '班级ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertClassReadAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const classResult = await client.query(
      `
      SELECT id, invite_code, invite_enabled, invite_expires_at
      , join_audit_mode
      FROM classes
      WHERE id = $1
      LIMIT 1
      `,
      [classId],
    )
    if (classResult.rowCount === 0) return res.status(404).json({ message: '班级不存在' })
    const logsResult = await client.query(
      `
      SELECT
        l.id,
        l.join_channel,
        l.invite_code,
        l.joined_at,
        s.id AS student_id,
        COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS student_name,
        NULLIF(TRIM(s.wechat_avatar_url), '') AS student_avatar_url
      FROM class_invite_join_logs l
      LEFT JOIN students s ON s.id = l.student_id
      WHERE l.class_id = $1
      ORDER BY l.joined_at DESC, l.id DESC
      LIMIT 50
      `,
      [classId],
    )
    const requestResult = await client.query(
      `
      SELECT
        r.id,
        r.student_name,
        r.status,
        r.source,
        r.requested_at
      FROM class_join_requests r
      WHERE r.class_id = $1 AND r.status = 'pending'
      ORDER BY r.requested_at DESC, r.id DESC
      LIMIT 50
      `,
      [classId],
    )
    const leaveRequestResult = await client.query(
      `
      SELECT
        lr.id,
        lr.student_id,
        lr.requested_at,
        COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS student_name,
        NULLIF(TRIM(s.wechat_avatar_url), '') AS student_avatar_url
      FROM class_leave_requests lr
      JOIN students s ON s.id = lr.student_id
      WHERE lr.class_id = $1 AND lr.status = 'pending'
      ORDER BY lr.requested_at DESC, lr.id DESC
      LIMIT 50
      `,
      [classId],
    )
    return res.json({
      data: {
        ...classResult.rows[0],
        join_logs: logsResult.rows,
        join_requests: requestResult.rows,
        leave_requests: leaveRequestResult.rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '邀请码配置查询失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/classes/:id/invite-config', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId)) return res.status(400).json({ message: '班级ID不合法' })
  const inviteEnabled = req.body?.inviteEnabled
  const joinAuditMode = String(req.body?.joinAuditMode || '').trim()
  const inviteExpiresAtRaw = req.body?.inviteExpiresAt
  const inviteExpiresAt =
    inviteExpiresAtRaw === null || inviteExpiresAtRaw === ''
      ? null
      : new Date(String(inviteExpiresAtRaw))
  if (inviteExpiresAt && Number.isNaN(inviteExpiresAt.getTime())) {
    return res.status(400).json({ message: '邀请码有效期时间格式不合法' })
  }
  if (joinAuditMode && !['auto', 'manual'].includes(joinAuditMode)) {
    return res.status(400).json({ message: 'joinAuditMode 仅支持 auto 或 manual' })
  }
  const client = await pool.connect()
  try {
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const result = await client.query(
      `
      UPDATE classes
      SET
        invite_enabled = COALESCE($1, invite_enabled),
        invite_expires_at = $2,
        join_audit_mode = COALESCE($4, join_audit_mode)
      WHERE id = $3
      RETURNING id, invite_code, invite_enabled, invite_expires_at, join_audit_mode
      `,
      [
        typeof inviteEnabled === 'boolean' ? inviteEnabled : null,
        inviteExpiresAt ? inviteExpiresAt.toISOString() : null,
        classId,
        joinAuditMode || null,
      ],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.invite_config.update',
      targetType: 'class',
      targetId: String(classId),
      detail: {
        inviteEnabled: typeof inviteEnabled === 'boolean' ? inviteEnabled : undefined,
        inviteExpiresAt: inviteExpiresAt ? inviteExpiresAt.toISOString() : null,
        joinAuditMode: joinAuditMode || undefined,
      },
    })
    return res.json({ data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ message: '邀请码配置更新失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/public/class-join-requests', async (req, res) => {
  const inviteCode = String(req.body?.inviteCode || '').trim().toUpperCase()
  const name = String(req.body?.name || '').trim()
  const studentNo = String(req.body?.studentNo || '').trim()
  if (!inviteCode || !name || !studentNo) {
    return res.status(400).json({ message: 'inviteCode、name、studentNo 必填' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const classResult = await client.query(
      `
      SELECT id, name, invite_code, invite_enabled, invite_expires_at, join_audit_mode
      FROM classes
      WHERE UPPER(invite_code) = $1
      LIMIT 1
      `,
      [inviteCode],
    )
    const classRow = classResult.rows[0]
    if (!classRow) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '邀请码无效' })
    }
    if (!classRow.invite_enabled) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该班级邀请码已停用' })
    }
    if (classRow.invite_expires_at && new Date(classRow.invite_expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该班级邀请码已过期' })
    }
    const joinMode = String(classRow.join_audit_mode || 'auto')
    if (joinMode === 'manual') {
      const requestResult = await client.query(
        `
        INSERT INTO class_join_requests (class_id, student_name, student_no, invite_code, status, source, requested_at)
        VALUES ($1, $2, $3, $4, 'pending', 'mini_program', NOW())
        RETURNING id, class_id, status
        `,
        [classRow.id, name, studentNo, inviteCode],
      )
      await writeOperationLog({
        client,
        operatorId: null,
        action: 'class.join_request.submit',
        targetType: 'class',
        targetId: String(classRow.id),
        detail: { requestId: requestResult.rows[0]?.id, studentNo, source: 'mini_program' },
      })
      await client.query('COMMIT')
      return res.status(201).json({
        data: {
          mode: 'manual',
          request_id: requestResult.rows[0]?.id,
          class_id: classRow.id,
          class_name: classRow.name,
          status: 'pending',
        },
      })
    }

    const joinResult = await upsertStudentAndJoinClass({
      client,
      classId: Number(classRow.id),
      name,
      studentNo,
      operatorId: null,
      inviteCode,
      joinChannel: 'mini_program_auto',
      realName: name,
    })
    await writeOperationLog({
      client,
      operatorId: null,
      action: 'class.student.add',
      targetType: 'class',
      targetId: String(classRow.id),
      detail: { studentId: joinResult.studentId, studentNo, source: 'mini_program_auto' },
    })
    await client.query('COMMIT')
    return res.status(201).json({
      data: {
        mode: 'auto',
        class_id: classRow.id,
        class_name: classRow.name,
        student_id: joinResult.studentId,
        status: 'joined',
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '提交入班申请失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/public/student/login', async (req, res) => {
  const classId = Number(req.body?.classId)
  const studentNo = String(req.body?.studentNo || '').trim()
  if (!Number.isInteger(classId) || classId <= 0 || !studentNo) {
    return res.status(400).json({ message: 'classId 与 studentNo 必填' })
  }
  try {
    const result = await pool.query(
      `
      SELECT s.id AS student_id, COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS student_name, s.student_no, c.id AS class_id, c.name AS class_name
      FROM students s
      JOIN class_members cm ON cm.student_id = s.id
      JOIN classes c ON c.id = cm.class_id
      WHERE s.student_no = $1 AND cm.class_id = $2
      LIMIT 1
      `,
      [studentNo, classId],
    )
    const row = result.rows[0]
    if (!row) {
      return res.status(401).json({ message: '学号与班级不匹配，或尚未加入该班级' })
    }
    const studentId = Number(row.student_id)
    const token = jwt.sign({ studentId, roles: ['student'] }, JWT_SECRET, { expiresIn: '30d' })
    return res.json({
      data: {
        token,
        student: {
          id: studentId,
          name: row.student_name,
          student_no: row.student_no,
        },
        class: {
          id: Number(row.class_id),
          name: row.class_name,
        },
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '学生登录失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/public/student/wechat-login', async (req, res) => {
  const code = String(req.body?.code || '').trim()
  const nickname = String(req.body?.nickname || '').trim().slice(0, 32)
  const avatarUrl = String(req.body?.avatarUrl || req.body?.avatar_url || '').trim().slice(0, 512)
  try {
    const { openid, unionid } = await wechatMiniCode2Session(code)
    const displayName = nickname || '微信用户'
    let studentRow = null
    const found = await pool.query(
      `SELECT id, name, student_no, wechat_openid FROM students WHERE wechat_openid = $1 LIMIT 1`,
      [openid],
    )
    if (found.rows[0]) {
      studentRow = found.rows[0]
      const updates = []
      const vals = []
      if (unionid) {
        vals.push(unionid)
        updates.push(`wechat_unionid = COALESCE(NULLIF(wechat_unionid, ''), $${vals.length})`)
      }
      if (nickname) {
        vals.push(displayName)
        updates.push(`name = $${vals.length}`)
      }
      if (avatarUrl) {
        vals.push(avatarUrl)
        updates.push(`wechat_avatar_url = $${vals.length}`)
      }
      if (updates.length > 0) {
        vals.push(studentRow.id)
        await pool.query(`UPDATE students SET ${updates.join(', ')} WHERE id = $${vals.length}`, vals)
        const again = await pool.query(`SELECT id, name, student_no FROM students WHERE id = $1`, [studentRow.id])
        studentRow = again.rows[0]
      }
    } else {
      const studentNo = studentNoFromWechatOpenid(openid)
      try {
        const ins = await pool.query(
          `
          INSERT INTO students (name, student_no, wechat_openid, wechat_unionid, wechat_avatar_url)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name, student_no
          `,
          [displayName, studentNo, openid, unionid || null, avatarUrl || null],
        )
        studentRow = ins.rows[0]
      } catch (e) {
        if (e && e.code === '23505') {
          const dup = await pool.query(`SELECT id, name, student_no FROM students WHERE wechat_openid = $1 LIMIT 1`, [openid])
          studentRow = dup.rows[0]
        } else {
          throw e
        }
      }
    }
    const studentId = Number(studentRow.id)
    const classCountResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM class_members WHERE student_id = $1`,
      [studentId],
    )
    const classCount = Number(classCountResult.rows[0]?.c || 0)
    const classesResult = await pool.query(
      `
      SELECT c.id, c.name
      FROM class_members cm
      JOIN classes c ON c.id = cm.class_id
      WHERE cm.student_id = $1
      ORDER BY c.name ASC
      `,
      [studentId],
    )
    const token = jwt.sign({ studentId, roles: ['student'] }, JWT_SECRET, { expiresIn: '30d' })
    return res.json({
      data: {
        token,
        need_join_class: classCount === 0,
        student: {
          id: studentId,
          name: studentRow.name,
        },
        classes: classesResult.rows,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('未配置 WECHAT')) {
      return res.status(503).json({ message: msg })
    }
    return res.status(400).json({ message: msg })
  }
})

/** 备案合规：未登录可浏览题库目录（科目 / 知识单元 / 单元详情），不含答题与统计 */
app.get('/api/public/catalog/subjects', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, sort_order FROM subjects ORDER BY sort_order ASC, id ASC`,
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '加载科目失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/public/catalog/knowledge-units', async (req, res) => {
  const subjectId = Number(req.query.subject_id)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: 'subject_id 不合法' })
  }
  try {
    const { rows } = await pool.query(
      `
      SELECT id, name, sort_order
      FROM knowledge_units
      WHERE subject_id = $1 AND name <> '未分类'
      ORDER BY sort_order ASC, id ASC
      `,
      [subjectId],
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '加载知识单元失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/public/catalog/unit-detail', async (req, res) => {
  const unitId = Number(req.query.unit_id)
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return res.status(400).json({ message: 'unit_id 不合法' })
  }
  try {
    const unitRes = await pool.query(
      `
      SELECT ku.id, ku.name, ku.subject_id, ku.sort_order, s.name AS subject_name
      FROM knowledge_units ku
      JOIN subjects s ON s.id = ku.subject_id
      WHERE ku.id = $1
      LIMIT 1
      `,
      [unitId],
    )
    const unitRow = unitRes.rows[0]
    if (!unitRow) return res.status(404).json({ message: '知识单元不存在' })

    const countRes = await pool.query(
      `
      SELECT COUNT(DISTINCT q.id)::int AS c
      FROM questions q
      INNER JOIN question_tag_rel qtr ON qtr.question_id = q.id
      INNER JOIN question_tags qt ON qt.id = qtr.tag_id AND qt.unit_id = $1
      WHERE q.deleted_at IS NULL AND q.subject_id = $2
      `,
      [unitId, unitRow.subject_id],
    )
    const unitQuestionCount = Number(countRes.rows[0]?.c || 0)

    const tagsRes = await pool.query(
      `
      SELECT qt.id, qt.name,
        (
          SELECT COUNT(DISTINCT q2.id)
          FROM questions q2
          INNER JOIN question_tag_rel qtr2 ON qtr2.question_id = q2.id AND qtr2.tag_id = qt.id
          WHERE q2.deleted_at IS NULL AND q2.subject_id = $2
        )::int AS question_count
      FROM question_tags qt
      WHERE qt.unit_id = $1
      ORDER BY qt.name ASC
      `,
      [unitId, unitRow.subject_id],
    )

    return res.json({
      data: {
        unit: {
          id: unitRow.id,
          name: unitRow.name,
          subject_id: unitRow.subject_id,
          sort_order: unitRow.sort_order,
        },
        subject: { id: unitRow.subject_id, name: unitRow.subject_name },
        unit_question_count: unitQuestionCount,
        tags: tagsRes.rows.map((r) => ({
          id: r.id,
          name: r.name,
          question_count: Number(r.question_count || 0),
        })),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载单元详情失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 备案合规：未登录可浏览未限定班级的公开资料（仅列表，下载/预览须登录） */
app.get('/api/public/study/resources', async (_req, res) => {
  try {
    const resourceResult = await pool.query(
      `
      SELECT r.id, r.name, r.file_url, r.file_type, r.folder, r.subject_id, COALESCE(s.name, '') AS subject_name, r.created_at
      FROM resources r
      LEFT JOIN subjects s ON s.id = r.subject_id
      WHERE NOT EXISTS (SELECT 1 FROM resource_class_visibility rv WHERE rv.resource_id = r.id)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 500
      `,
    )
    return res.json({
      data: resourceResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        file_url: String(row.file_url || ''),
        file_type: row.file_type,
        folder: row.folder,
        subject_id: row.subject_id != null ? Number(row.subject_id) : null,
        subject_name: String(row.subject_name || ''),
        created_at: row.created_at,
        can_system_download: false,
        direct_download_url: '',
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: '加载公开资料失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/profile', studentAuthRequired, async (req, res) => {
  try {
    const studentId = req.studentAuth.studentId
    const sres = await pool.query(
      `SELECT id, name, real_name, student_no, wechat_openid, wechat_avatar_url FROM students WHERE id = $1 LIMIT 1`,
      [studentId],
    )
    const student = sres.rows[0]
    if (!student) return res.status(404).json({ message: '学生不存在' })
    const rn = String(student.real_name || '').trim()
    const nn = String(student.name || '').trim()
    const displayName = rn || nn || '同学'
    const classesResult = await pool.query(
      `
      SELECT c.id, c.name
      FROM class_members cm
      JOIN classes c ON c.id = cm.class_id
      WHERE cm.student_id = $1
      ORDER BY c.name ASC
      `,
      [studentId],
    )
    const classes = classesResult.rows
    const leavePendingResult = await pool.query(
      `
      SELECT r.id, r.class_id, c.name AS class_name, r.requested_at
      FROM class_leave_requests r
      JOIN classes c ON c.id = r.class_id
      WHERE r.student_id = $1 AND r.status = 'pending'
      ORDER BY r.requested_at DESC
      `,
      [studentId],
    )
    const wxNick = nn || '微信用户'
    const wxAvatar = String(student.wechat_avatar_url || '').trim()
    return res.json({
      data: {
        student: {
          id: student.id,
          name: student.name,
          real_name: student.real_name,
          display_name: displayName,
          wx_nickname: wxNick,
          wx_avatar_url: wxAvatar,
          has_wechat: Boolean(String(student.wechat_openid || '').trim()),
        },
        classes,
        need_join_class: classes.length === 0,
        pending_leave_requests: leavePendingResult.rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载学生资料失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 学生修改资料：name 为昵称（微信侧展示名），real_name 为老师端优先展示的真实姓名 */
app.patch('/api/student/profile', studentAuthRequired, async (req, res) => {
  const nameRaw = req.body?.name ?? req.body?.displayName
  const realRaw = req.body?.realName ?? req.body?.real_name
  const avatarRaw = req.body?.avatarUrl ?? req.body?.avatar_url ?? req.body?.wxAvatarUrl
  const hasName = nameRaw !== undefined && nameRaw !== null
  const hasReal = realRaw !== undefined && realRaw !== null
  const hasAvatar = avatarRaw !== undefined && avatarRaw !== null
  if (!hasName && !hasReal && !hasAvatar) return res.status(400).json({ message: '请提供要修改的昵称、真实姓名或头像地址' })
  const parts = []
  const vals = []
  if (hasName) {
    const name = String(nameRaw ?? '').trim()
    if (!name) return res.status(400).json({ message: '昵称不能为空' })
    if (name.length > 64) return res.status(400).json({ message: '昵称不能超过 64 个字' })
    vals.push(name)
    parts.push(`name = $${vals.length}`)
  }
  if (hasReal) {
    const realName = String(realRaw ?? '').trim()
    if (!realName) return res.status(400).json({ message: '真实姓名不能为空' })
    if (realName.length > 64) return res.status(400).json({ message: '真实姓名不能超过 64 个字' })
    vals.push(realName)
    parts.push(`real_name = $${vals.length}`)
  }
  if (hasAvatar) {
    const url = String(avatarRaw ?? '').trim().slice(0, 512)
    vals.push(url || null)
    parts.push(`wechat_avatar_url = $${vals.length}`)
  }
  vals.push(req.studentAuth.studentId)
  try {
    const r = await pool.query(
      `UPDATE students SET ${parts.join(', ')} WHERE id = $${vals.length} RETURNING id, name, real_name, student_no, wechat_avatar_url`,
      vals,
    )
    const row = r.rows[0]
    if (!row) return res.status(404).json({ message: '学生不存在' })
    const rn = String(row.real_name || '').trim()
    const nn = String(row.name || '').trim()
    const wxAvatar = String(row.wechat_avatar_url || '').trim()
    return res.json({
      data: {
        student: {
          id: row.id,
          name: row.name,
          real_name: row.real_name,
          display_name: rn || nn || '同学',
          wx_nickname: nn || '微信用户',
          wx_avatar_url: wxAvatar,
        },
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '更新资料失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 学生头像上传（chooseAvatar 返回本地临时路径，须上传后持久化） */
app.post('/api/student/profile/avatar-upload', studentAuthRequired, (req, res) => {
  const studentId = req.studentAuth.studentId
  avatarUpload.single('file')(req, res, async (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '头像图片不能超过 2MB' })
      }
      return res.status(400).json({ message: error instanceof Error ? error.message : '上传失败' })
    }
    const file = req.file
    if (!file) return res.status(400).json({ message: '未检测到上传文件' })
    const fileUrl = `${UPLOAD_PUBLIC_BASE}/uploads/${file.filename}`
    try {
      const r = await pool.query(
        `UPDATE students SET wechat_avatar_url = $1 WHERE id = $2 RETURNING id, name, real_name, wechat_avatar_url`,
        [fileUrl, studentId],
      )
      const row = r.rows[0]
      if (!row) return res.status(404).json({ message: '学生不存在' })
      const rn = String(row.real_name || '').trim()
      const nn = String(row.name || '').trim()
      const wxAvatar = String(row.wechat_avatar_url || '').trim()
      return res.json({
        data: {
          avatarUrl: fileUrl,
          student: {
            id: row.id,
            name: row.name,
            real_name: row.real_name,
            display_name: rn || nn || '同学',
            wx_nickname: nn || '微信用户',
            wx_avatar_url: wxAvatar,
          },
        },
      })
    } catch (dbErr) {
      return res.status(500).json({
        message: '保存头像失败',
        detail: dbErr instanceof Error ? dbErr.message : String(dbErr),
      })
    }
  })
})

/** 学生申请退出某班级（须教师审核通过后才会真正退班；通过后删除「考试曾关联该班」的答卷，与是否仍在别班无关；个人刷题数据保留） */
app.post('/api/student/leave-class-request', studentAuthRequired, async (req, res) => {
  const classId = Number(req.body?.class_id ?? req.body?.classId)
  const studentId = req.studentAuth.studentId
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ message: 'class_id 不合法' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const member = await client.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 LIMIT 1`,
      [classId, studentId],
    )
    if (!member.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '您不在该班级中' })
    }
    const dup = await client.query(
      `SELECT id FROM class_leave_requests WHERE class_id = $1 AND student_id = $2 AND status = 'pending' LIMIT 1`,
      [classId, studentId],
    )
    if (dup.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该班级已有待审核的退班申请' })
    }
    const ins = await client.query(
      `
      INSERT INTO class_leave_requests (class_id, student_id, status, requested_at)
      VALUES ($1, $2, 'pending', NOW())
      RETURNING id, class_id, requested_at
      `,
      [classId, studentId],
    )
    const row = ins.rows[0]
    const cname = await client.query(`SELECT name FROM classes WHERE id = $1 LIMIT 1`, [classId])
    await writeOperationLog({
      client,
      operatorId: null,
      action: 'class.leave_request.submit',
      targetType: 'class',
      targetId: String(classId),
      detail: { requestId: row?.id, studentId, source: 'mini_program' },
    })
    await client.query('COMMIT')
    return res.status(201).json({
      data: {
        id: row?.id,
        class_id: classId,
        class_name: String(cname.rows[0]?.name || ''),
        status: 'pending',
        requested_at: row?.requested_at,
        message: '已提交退班申请，请等待老师审核',
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    const code = error && error.code
    if (code === '23505') {
      return res.status(400).json({ message: '该班级已有待审核的退班申请' })
    }
    return res.status(500).json({ message: '提交退班申请失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/student/join-by-invite', studentAuthRequired, async (req, res) => {
  const inviteCode = String(req.body?.inviteCode || req.body?.invite_code || '').trim().toUpperCase()
  const realName = String(req.body?.realName || req.body?.real_name || '').trim()
  if (!inviteCode) return res.status(400).json({ message: 'inviteCode 必填' })
  if (!realName) return res.status(400).json({ message: '请填写真实姓名' })
  if (realName.length > 64) return res.status(400).json({ message: '真实姓名不能超过 64 个字' })
  const studentId = req.studentAuth.studentId
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sres = await client.query(`SELECT id, name, student_no FROM students WHERE id = $1 LIMIT 1`, [studentId])
    const student = sres.rows[0]
    if (!student) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '学生不存在' })
    }
    const classResult = await client.query(
      `
      SELECT id, name, invite_code, invite_enabled, invite_expires_at, join_audit_mode
      FROM classes
      WHERE UPPER(btrim(invite_code)) = $1
      LIMIT 1
      `,
      [inviteCode],
    )
    const classRow = classResult.rows[0]
    if (!classRow) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '邀请码无效' })
    }
    if (!classRow.invite_enabled) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该班级邀请码已停用' })
    }
    if (classRow.invite_expires_at && new Date(classRow.invite_expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该班级邀请码已过期' })
    }
    const member = await client.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 LIMIT 1`,
      [classRow.id, studentId],
    )
    if (member.rows[0]) {
      await client.query('COMMIT')
      return res.json({
        data: {
          already_member: true,
          class_id: Number(classRow.id),
          class_name: classRow.name,
        },
      })
    }
    const memberships = await listStudentClassMemberships(client, studentId)
    const otherClasses = findOtherClassMemberships(memberships, classRow.id)
    if (otherClasses.length > 0) {
      await client.query('ROLLBACK')
      const names =
        otherClasses
          .map((c) => String(c.name || '').trim())
          .filter(Boolean)
          .join('、') || '当前班级'
      return res.status(409).json({
        code: 'ALREADY_IN_CLASS',
        message: `你已在「${names}」中，须先申请退出并通过教师审核后，才能加入新班级`,
        data: { classes: otherClasses },
      })
    }
    await client.query(`UPDATE students SET real_name = $1 WHERE id = $2`, [realName, studentId])
    const joinMode = String(classRow.join_audit_mode || 'auto')
    if (joinMode === 'manual') {
      await client.query(
        `
        INSERT INTO class_join_requests (class_id, student_name, student_no, invite_code, status, source, requested_at)
        VALUES ($1, $2, $3, $4, 'pending', 'mini_program_wechat', NOW())
        `,
        [classRow.id, realName, student.student_no, inviteCode],
      )
      await writeOperationLog({
        client,
        operatorId: null,
        action: 'class.join_request.submit',
        targetType: 'class',
        targetId: String(classRow.id),
        detail: { studentId, student_no: student.student_no, source: 'mini_program_wechat' },
      })
      await client.query('COMMIT')
      return res.status(201).json({
        data: {
          mode: 'manual',
          class_id: Number(classRow.id),
          class_name: classRow.name,
          status: 'pending',
          message: '已提交入班申请，请等待老师审核',
        },
      })
    }
    await upsertStudentAndJoinClass({
      client,
      classId: Number(classRow.id),
      name: String(student.name || '微信用户'),
      studentNo: String(student.student_no || ''),
      operatorId: null,
      inviteCode,
      joinChannel: 'mini_program_wechat_auto',
      realName,
    })
    await writeOperationLog({
      client,
      operatorId: null,
      action: 'class.student.add',
      targetType: 'class',
      targetId: String(classRow.id),
      detail: { studentId, student_no: student.student_no, source: 'mini_program_wechat_invite' },
    })
    await client.query('COMMIT')
    return res.status(201).json({
      data: {
        mode: 'auto',
        class_id: Number(classRow.id),
        class_name: classRow.name,
        status: 'joined',
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '加入班级失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/student/my-classes', studentAuthRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT c.id, c.name
      FROM class_members cm
      JOIN classes c ON c.id = cm.class_id
      WHERE cm.student_id = $1
      ORDER BY c.name ASC
      `,
      [req.studentAuth.studentId],
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '加载学生班级失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 小程序直链下载：用当前请求的 Host/Proto 拼 /uploads/，避免 DB 里 UPLOAD_PUBLIC_BASE 与小程序 api_base 不一致导致永远走慢速 API */
function buildStudentPublicUploadUrl(req, fileUrl, expectedPrefix) {
  try {
    const fu = String(fileUrl || '')
    const pre = String(expectedPrefix || '')
    if (!fu.startsWith(pre)) return null
    const tail = fu.slice(pre.length)
    const safeFileName = path.basename(String(tail.split('?')[0] || '').replace(/\\/g, '/'))
    if (!safeFileName || safeFileName === '.' || safeFileName === '..') return null
    const rawProto = String(req.get('x-forwarded-proto') || req.protocol || 'https')
    const proto = rawProto.split(',')[0].trim().replace(/:+$/, '').toLowerCase() || 'https'
    const host = String(req.get('x-forwarded-host') || req.get('host') || '')
      .split(',')[0]
      .trim()
    if (!host) return null
    // 磁盘名多为字母数字；整段 encode 少数网关/静态服务与小程序下载栈组合会异常，仅对非安全字符编码
    const pathSeg = /^[a-zA-Z0-9._~-]+$/.test(safeFileName) ? safeFileName : encodeURIComponent(safeFileName)
    return `${proto}://${host}/uploads/${pathSeg}`
  } catch {
    return null
  }
}

app.get('/api/student/resources', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const classId = Number(req.query.class_id)
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ message: '请传入 class_id 查询参数' })
  }
  const keyword = String(req.query.keyword || '').trim()
  try {
    const member = await pool.query(
      `SELECT 1 FROM class_members WHERE student_id = $1 AND class_id = $2 LIMIT 1`,
      [req.studentAuth.studentId, classId],
    )
    if (!member.rows[0]) {
      return res.status(403).json({ message: '无权限查看该班级资料' })
    }
    const values = [classId]
    const visibilityClause = `
      (
        NOT EXISTS (SELECT 1 FROM resource_class_visibility rv WHERE rv.resource_id = r.id)
        OR EXISTS (
          SELECT 1 FROM resource_class_visibility rv2
          WHERE rv2.resource_id = r.id AND rv2.class_id = $1
        )
      )
    `
    const conditions = [visibilityClause]
    if (keyword) {
      values.push(`%${keyword}%`)
      conditions.push(`r.name ILIKE $${values.length}`)
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const resourceResult = await pool.query(
      `
      SELECT r.id, r.name, r.file_url, r.file_type, r.folder, r.subject_id, COALESCE(s.name, '') AS subject_name, r.created_at
      FROM resources r
      LEFT JOIN subjects s ON s.id = r.subject_id
      ${whereClause}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 500
      `,
      values,
    )
    const expectedPrefix = `${UPLOAD_PUBLIC_BASE.replace(/\/$/, '')}/uploads/`
    return res.json({
      data: resourceResult.rows.map((row) => {
        const fileUrl = String(row.file_url || '')
        const canSystemDl = Boolean(fileUrl && fileUrl.startsWith(expectedPrefix))
        const fromReq = canSystemDl ? buildStudentPublicUploadUrl(req, fileUrl, expectedPrefix) : null
        const fromDb = canSystemDl && /^https:\/\//i.test(fileUrl) ? fileUrl : null
        return {
          id: row.id,
          name: row.name,
          file_url: fileUrl,
          file_type: row.file_type,
          folder: row.folder,
          subject_id: row.subject_id != null ? Number(row.subject_id) : null,
          subject_name: String(row.subject_name || ''),
          created_at: row.created_at,
          can_system_download: canSystemDl,
          direct_download_url: fromReq || fromDb,
        }
      }),
    })
  } catch (error) {
    return res.status(500).json({ message: '加载学生可见资料失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/resources/:id/download', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const resourceId = Number(req.params.id)
  const classId = Number(req.query.class_id)
  if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ message: '资料ID不合法' })
  if (!Number.isInteger(classId) || classId <= 0) return res.status(400).json({ message: '请传入 class_id 查询参数' })
  try {
    const member = await pool.query(
      `SELECT 1 FROM class_members WHERE student_id = $1 AND class_id = $2 LIMIT 1`,
      [req.studentAuth.studentId, classId],
    )
    if (!member.rows[0]) {
      return res.status(403).json({ message: '无权限下载该班级资料' })
    }
    const accessResult = await pool.query(
      `
      SELECT r.id, r.name, r.file_url
      FROM resources r
      WHERE r.id = $1
        AND (
          NOT EXISTS (SELECT 1 FROM resource_class_visibility rv WHERE rv.resource_id = r.id)
          OR EXISTS (
            SELECT 1 FROM resource_class_visibility rv2
            WHERE rv2.resource_id = r.id AND rv2.class_id = $2
          )
        )
      LIMIT 1
      `,
      [resourceId, classId],
    )
    const resource = accessResult.rows[0]
    if (!resource) {
      return res.status(404).json({ message: '资料不存在或对该班级不可见' })
    }
    const fileUrl = String(resource.file_url || '')
    const expectedPrefix = `${UPLOAD_PUBLIC_BASE.replace(/\/$/, '')}/uploads/`
    if (!fileUrl.startsWith(expectedPrefix)) {
      return res.status(400).json({ message: '该资料非本地上传文件，请使用列表中的 file_url 自行打开' })
    }
    const fileName = fileUrl.slice(expectedPrefix.length)
    const safeFileName = path.basename(fileName)
    const absPath = path.resolve(UPLOAD_ROOT, safeFileName)
    if (!absPath.startsWith(UPLOAD_ROOT)) {
      return res.status(400).json({ message: '文件路径非法' })
    }
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ message: '文件不存在，可能已被移除' })
    }
    const displayName = String(resource.name || safeFileName)
    void writeOperationLog({
      operatorId: null,
      action: 'resource.student_download',
      targetType: 'resource',
      targetId: String(resourceId),
      detail: {
        file_name: safeFileName,
        resource_name: displayName,
        resource_id: resourceId,
        student_id: req.studentAuth.studentId,
        class_id: classId,
      },
    }).catch(() => {})
    return res.download(absPath, displayName)
  } catch (error) {
    return res.status(500).json({ message: '下载资料失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/subjects', studentAuthRequired, studentClassMembershipRequired, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, sort_order FROM subjects ORDER BY sort_order ASC, id ASC`,
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '加载科目失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 某科目下的知识单元（不含占位「未分类」） */
app.get('/api/student/catalog/knowledge-units', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const subjectId = Number(req.query.subject_id)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: 'subject_id 不合法' })
  }
  try {
    const { rows } = await pool.query(
      `
      SELECT id, name, sort_order
      FROM knowledge_units
      WHERE subject_id = $1 AND name <> '未分类'
      ORDER BY sort_order ASC, id ASC
      `,
      [subjectId],
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '加载知识单元失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 某知识单元下的知识点（question_tags）及题量 */
app.get('/api/student/catalog/unit-detail', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const unitId = Number(req.query.unit_id)
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return res.status(400).json({ message: 'unit_id 不合法' })
  }
  try {
    const unitRes = await pool.query(
      `
      SELECT ku.id, ku.name, ku.subject_id, ku.sort_order, s.name AS subject_name
      FROM knowledge_units ku
      JOIN subjects s ON s.id = ku.subject_id
      WHERE ku.id = $1
      LIMIT 1
      `,
      [unitId],
    )
    const unitRow = unitRes.rows[0]
    if (!unitRow) return res.status(404).json({ message: '知识单元不存在' })

    const countRes = await pool.query(
      `
      SELECT COUNT(DISTINCT q.id)::int AS c
      FROM questions q
      INNER JOIN question_tag_rel qtr ON qtr.question_id = q.id
      INNER JOIN question_tags qt ON qt.id = qtr.tag_id AND qt.unit_id = $1
      WHERE q.deleted_at IS NULL AND q.subject_id = $2
      `,
      [unitId, unitRow.subject_id],
    )
    const unitQuestionCount = Number(countRes.rows[0]?.c || 0)

    const tagsRes = await pool.query(
      `
      SELECT qt.id, qt.name,
        (
          SELECT COUNT(DISTINCT q2.id)
          FROM questions q2
          INNER JOIN question_tag_rel qtr2 ON qtr2.question_id = q2.id AND qtr2.tag_id = qt.id
          WHERE q2.deleted_at IS NULL AND q2.subject_id = $2
        )::int AS question_count
      FROM question_tags qt
      WHERE qt.unit_id = $1
      ORDER BY qt.name ASC
      `,
      [unitId, unitRow.subject_id],
    )

    return res.json({
      data: {
        unit: {
          id: unitRow.id,
          name: unitRow.name,
          subject_id: unitRow.subject_id,
          sort_order: unitRow.sort_order,
        },
        subject: { id: unitRow.subject_id, name: unitRow.subject_name },
        unit_question_count: unitQuestionCount,
        tags: tagsRes.rows.map((r) => ({
          id: r.id,
          name: r.name,
          question_count: Number(r.question_count || 0),
        })),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载单元详情失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/practice/tags', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const subjectId = Number(req.query.subject_id)
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: 'subject_id 不合法' })
  }
  try {
    const { rows } = await pool.query(
      `
      SELECT DISTINCT COALESCE(ku.name, '') AS unit_name, qt.name AS name
      FROM question_tags qt
      JOIN question_tag_rel qtr ON qtr.tag_id = qt.id
      JOIN questions q ON q.id = qtr.question_id
      LEFT JOIN knowledge_units ku ON ku.id = qt.unit_id
      WHERE q.subject_id = $1 AND q.deleted_at IS NULL
      ORDER BY unit_name ASC, qt.name ASC
      `,
      [subjectId],
    )
    return res.json({
      data: rows
        .map((r, idx) => ({
          name: String(r.name || ''),
          unit_name: String(r.unit_name || ''),
          key: `${String(r.unit_name || '')}::${String(r.name || '')}::${idx}`,
        }))
        .filter((r) => r.name),
    })
  } catch (error) {
    return res.status(500).json({ message: '加载知识点失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 统计某科目下题目数量；可选 unit_id（知识单元）、tag_name（知识点，可与 unit_id 联用） */
app.get('/api/student/practice/count', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const subjectId = Number(req.query.subject_id)
  const unitId = Number(req.query.unit_id)
  const tagNameRaw = req.query.tag_name
  const tagName =
    tagNameRaw === undefined || tagNameRaw === null ? '' : String(tagNameRaw).trim()
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: 'subject_id 不合法' })
  }
  const hasUnit = Number.isInteger(unitId) && unitId > 0
  try {
    if (hasUnit) {
      const ur = await pool.query(`SELECT subject_id FROM knowledge_units WHERE id = $1 LIMIT 1`, [unitId])
      if (!ur.rows[0]) return res.status(404).json({ message: '知识单元不存在' })
      if (Number(ur.rows[0].subject_id) !== subjectId) {
        return res.status(400).json({ message: 'unit_id 与 subject_id 不匹配' })
      }
    }
    const params = [subjectId]
    let sql = `
      SELECT COUNT(DISTINCT q.id)::int AS c
      FROM questions q
      WHERE q.deleted_at IS NULL AND q.subject_id = $1
    `
    if (hasUnit && tagName) {
      params.push(unitId, tagName)
      sql += `
        AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.unit_id = $2 AND qt.name = $3
        )
      `
    } else if (hasUnit) {
      params.push(unitId)
      sql += `
        AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.unit_id = $2
        )
      `
    } else if (tagName) {
      params.push(tagName)
      sql += `
        AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.name = $2
        )
      `
    }
    const { rows } = await pool.query(sql, params)
    const count = Number(rows[0]?.c || 0)
    return res.json({ data: { count } })
  } catch (error) {
    return res.status(500).json({ message: '统计题目失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/student/practice/build', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const tagNames = Array.isArray(req.body?.tag_names) ? req.body.tag_names.map((x) => String(x || '').trim()).filter(Boolean) : []
  const practiceModule = String(req.body?.practice_module || '').trim()
  const sectionTag = String(req.body?.section_tag || '').trim()
  const sectionTagsFromBody = Array.isArray(req.body?.section_tags)
    ? req.body.section_tags.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const sectionFilterNames =
    sectionTagsFromBody.length > 0 ? sectionTagsFromBody : sectionTag ? [sectionTag] : []
  const mockAllocation = Array.isArray(req.body?.mock_allocation) ? req.body.mock_allocation : []
  const limitRaw = parseInt(String(req.body?.limit ?? ''), 10)
  /** limit <= 0 表示不限制题量（顺序/随机/知识小节拉全量）；否则上限 10000 */
  const useLimit = Number.isFinite(limitRaw) && limitRaw > 0
  const limit = useLimit ? Math.min(10000, limitRaw) : 0
  const unitIdBody = Number(req.body?.unit_id)

  /** 错题再练等：按题目 ID 组卷（须为本生错题本中 wrong_count>0 的题目） */
  const rawFixedIds = Array.isArray(req.body?.question_ids) ? req.body.question_ids : []
  const fixedOrderedIds = []
  const seenFixed = new Set()
  for (const x of rawFixedIds) {
    const id = Number(x)
    if (!Number.isInteger(id) || id <= 0) continue
    if (seenFixed.has(id)) continue
    seenFixed.add(id)
    fixedOrderedIds.push(id)
  }

  try {
    if (fixedOrderedIds.length > 0) {
      const studentId = req.studentAuth.studentId
      const sliceInput = (useLimit ? fixedOrderedIds.slice(0, limit) : fixedOrderedIds)
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0 && id <= Number.MAX_SAFE_INTEGER)
      if (sliceInput.length === 0) {
        return res.status(400).json({ message: 'question_ids 不合法' })
      }
      const params = [studentId]
      const placeholders = sliceInput.map((id) => {
        params.push(id)
        return `$${params.length}`
      })
      const inClause = placeholders.join(', ')
      const literalArr = sliceInput.map((id) => String(id)).join(', ')
      const { rows: fixedRows } = await pool.query(
        `
        SELECT q.id
        FROM questions q
        INNER JOIN student_question_stats s ON s.question_id = q.id AND s.student_id = $1
        WHERE q.deleted_at IS NULL AND q.id IN (${inClause})
        ORDER BY array_position(ARRAY[${literalArr}]::bigint[], q.id) NULLS LAST
        `,
        params,
      )
      const outIds = fixedRows.map((row) => Number(row.id)).filter((id) => !Number.isNaN(id))
      if (outIds.length === 0) {
        return res.status(400).json({
          message: '无法组卷：题目已删除，或你尚未做过该题（请刷新错题本后重试）',
        })
      }
      return res.json({ data: { question_ids: outIds } })
    }

    const subjectId = Number(req.body?.subject_id)
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      return res.status(400).json({ message: 'subject_id 不合法' })
    }
    const allowedModules = new Set(['sequential', 'random', 'section', 'mock'])
    if (!allowedModules.has(practiceModule)) {
      return res.status(400).json({ message: 'practice_module 须为 sequential | random | section | mock' })
    }
    if (practiceModule === 'section' && sectionFilterNames.length === 0) {
      return res.status(400).json({ message: '知识小节练习须传 section_tag 或 section_tags' })
    }
    if (practiceModule === 'mock') {
      if (mockAllocation.length === 0) {
        return res.status(400).json({ message: '模拟练习须传 mock_allocation，如 [{\"tag_name\":\"…\",\"count\":3}]' })
      }
    }

    const subOk = await pool.query(`SELECT 1 FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
    if (!subOk.rows[0]) return res.status(404).json({ message: '科目不存在' })

    const hasUnit = Number.isInteger(unitIdBody) && unitIdBody > 0
    if (hasUnit) {
      const ur = await pool.query(`SELECT subject_id FROM knowledge_units WHERE id = $1 LIMIT 1`, [unitIdBody])
      if (!ur.rows[0]) return res.status(404).json({ message: '知识单元不存在' })
      if (Number(ur.rows[0].subject_id) !== subjectId) {
        return res.status(400).json({ message: 'unit_id 与 subject_id 不匹配' })
      }
    }

    if (practiceModule === 'mock') {
      const seen = new Set()
      const orderedIds = []
      for (const raw of mockAllocation) {
        const tagName = String(raw?.tag_name ?? raw?.tagName ?? '').trim()
        const cnt = Math.min(50, Math.max(0, parseInt(String(raw?.count ?? 0), 10) || 0))
        if (!tagName || cnt <= 0) continue
        const params = [subjectId, tagName]
        let existsCond = 'qt.name = $2'
        if (hasUnit) {
          params.push(unitIdBody)
          existsCond += ` AND qt.unit_id = $3`
        }
        params.push(cnt)
        const limIdx = params.length
        const r = await pool.query(
          `
          SELECT q.id
          FROM questions q
          WHERE q.deleted_at IS NULL AND q.subject_id = $1
            AND EXISTS (
              SELECT 1 FROM question_tag_rel qtr
              JOIN question_tags qt ON qt.id = qtr.tag_id
              WHERE qtr.question_id = q.id AND ${existsCond}
            )
          ORDER BY random()
          LIMIT $${limIdx}
          `,
          params,
        )
        for (const row of r.rows) {
          const id = Number(row.id)
          if (!seen.has(id)) {
            seen.add(id)
            orderedIds.push(id)
          }
        }
      }
      if (orderedIds.length === 0) {
        return res.status(400).json({ message: '未匹配到题目，请检查知识点名称与题量' })
      }
      return res.json({ data: { question_ids: orderedIds } })
    }

    const values = [subjectId]
    let whereExtra = ''
    if (practiceModule === 'section') {
      if (hasUnit) {
        values.push(unitIdBody, sectionFilterNames)
        whereExtra = `AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.unit_id = $2 AND qt.name = ANY($3::text[])
        )`
      } else if (sectionFilterNames.length === 1) {
        values.push(sectionFilterNames[0])
        whereExtra = `AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.name = $2
        )`
      } else {
        values.push(sectionFilterNames)
        whereExtra = `AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.name = ANY($2::text[])
        )`
      }
    } else if (tagNames.length > 0) {
      if (hasUnit) {
        values.push(unitIdBody, tagNames)
        whereExtra = `AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.unit_id = $2 AND qt.name = ANY($3::text[])
        )`
      } else {
        values.push(tagNames)
        whereExtra = `AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.name = ANY($2::text[])
        )`
      }
    } else if (hasUnit) {
      values.push(unitIdBody)
      whereExtra = `AND EXISTS (
        SELECT 1 FROM question_tag_rel qtr
        JOIN question_tags qt ON qt.id = qtr.tag_id
        WHERE qtr.question_id = q.id AND qt.unit_id = $2
      )`
    } else {
      return res.status(400).json({ message: '须指定 unit_id、tag_names 或 section_tag（知识小节）' })
    }

    const orderSql =
      practiceModule === 'random' ? 'ORDER BY random()' : 'ORDER BY q.id ASC'
    const limitSql = useLimit ? ` LIMIT $${values.length + 1}` : ''
    if (useLimit) values.push(limit)

    const sql = `
      SELECT q.id
      FROM questions q
      WHERE q.deleted_at IS NULL AND q.subject_id = $1
      ${whereExtra}
      ${orderSql}${limitSql}
    `
    const { rows } = await pool.query(sql, values)
    const questionIds = rows.map((row) => Number(row.id)).filter((id) => !Number.isNaN(id))
    if (questionIds.length === 0) {
      return res.status(400).json({ message: '当前条件下没有题目，请换科目或知识点' })
    }
    return res.json({ data: { question_ids: questionIds } })
  } catch (error) {
    return res.status(500).json({ message: '组卷失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/questions/:id', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  try {
    const questionResult = await pool.query(
      `
      SELECT q.id, q.question_type, q.stem, q.difficulty, s.name AS subject_name
      FROM questions q
      JOIN subjects s ON s.id = q.subject_id
      WHERE q.id = $1 AND q.deleted_at IS NULL
      LIMIT 1
      `,
      [questionId],
    )
    const row = questionResult.rows[0]
    if (!row) return res.status(404).json({ message: '题目不存在' })
    const optionsResult = await pool.query(
      `
      SELECT option_key, option_text, sort_order
      FROM question_options
      WHERE question_id = $1
      ORDER BY sort_order ASC, option_key ASC
      `,
      [questionId],
    )
    const tagsResult = await pool.query(
      `
      SELECT COALESCE(ku.name, '') AS unit_name, t.name AS point_name
      FROM question_tag_rel r
      JOIN question_tags t ON t.id = r.tag_id
      LEFT JOIN knowledge_units ku ON ku.id = t.unit_id
      WHERE r.question_id = $1
      ORDER BY ku.name ASC NULLS LAST, t.name ASC
      `,
      [questionId],
    )
    const unitNames = [...new Set(tagsResult.rows.map((item) => String(item.unit_name || '').trim()).filter(Boolean))]
    const knowledgeUnit = unitNames.length === 1 ? unitNames[0] : unitNames[0] || ''
    const knowledgePoints = tagsResult.rows.map((item) => String(item.point_name || '').trim()).filter(Boolean)
    return res.json({
      data: {
        id: row.id,
        subject: row.subject_name,
        question_type: row.question_type,
        question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
        stem: row.stem,
        difficulty: row.difficulty,
        options: optionsResult.rows,
        knowledge_unit: knowledgeUnit,
        knowledge_points: knowledgePoints,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载题目失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/student/questions/:id/check', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  const userAnswer = req.body?.user_answer ?? req.body?.userAnswer ?? ''
  const client = await pool.connect()
  try {
    const qres = await client.query(
      `SELECT question_type, answer_text, explanation FROM questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [questionId],
    )
    const qrow = qres.rows[0]
    if (!qrow) return res.status(404).json({ message: '题目不存在' })
    const ok = isStudentAnswerCorrect(Number(qrow.question_type), qrow.answer_text, userAnswer)
    await incrementStudentQuestionStats(client, req.studentAuth.studentId, questionId, ok)
    return res.json({
      data: {
        correct: ok,
        correct_answer: String(qrow.answer_text || ''),
        explanation: String(qrow.explanation || ''),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '判题失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/student/practice/exam-submit', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : []
  if (answers.length === 0) {
    return res.status(400).json({ message: 'answers 不能为空' })
  }
  const client = await pool.connect()
  try {
    const results = []
    for (const item of answers) {
      const qid = Number(item?.question_id ?? item?.questionId)
      const ua = item?.user_answer ?? item?.userAnswer ?? ''
      if (!Number.isInteger(qid) || qid <= 0) continue
      const qres = await client.query(
        `SELECT question_type, stem, answer_text, explanation FROM questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [qid],
      )
      const qrow = qres.rows[0]
      if (!qrow) {
        results.push({ question_id: qid, missing: true })
        continue
      }
      const ok = isStudentAnswerCorrect(Number(qrow.question_type), qrow.answer_text, ua)
      await incrementStudentQuestionStats(client, req.studentAuth.studentId, qid, ok, 'practice_exam')
      results.push({
        question_id: qid,
        correct: ok,
        user_answer: String(ua),
        correct_answer: String(qrow.answer_text || ''),
        explanation: String(qrow.explanation || ''),
        stem: String(qrow.stem || ''),
        question_type: Number(qrow.question_type),
      })
    }
    return res.json({ data: { results } })
  } catch (error) {
    return res.status(500).json({ message: '交卷失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

/** 学生可见的班级考试列表 */
app.get('/api/student/exams', studentAuthRequired, async (req, res) => {
  const studentId = req.studentAuth.studentId
  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM (
        SELECT DISTINCT ON (e.id)
          e.id,
          e.title,
          e.subject_id,
          s.name AS subject_name,
          e.start_time,
          e.end_time,
          e.duration,
          e.description,
          es.id AS submission_id,
          es.status AS submission_status,
          es.submit_time,
          es.total_score
        FROM exams e
        JOIN subjects s ON s.id = e.subject_id
        JOIN exam_classes ec ON ec.exam_id = e.id
        JOIN class_members cm ON cm.class_id = ec.class_id AND cm.student_id = $1
        LEFT JOIN exam_submissions es ON es.exam_id = e.id AND es.student_id = $1
        WHERE e.end_time >= NOW() - INTERVAL '120 days'
        ORDER BY e.id, e.start_time DESC
      ) deduped
      ORDER BY start_time DESC, id DESC
      `,
      [studentId],
    )
    const data = rows.map((row) => {
      const phase = examPhaseFromRow(row)
      const st = Number(row.submission_status || 0)
      let submission_label = '未开始'
      if (st === 1) submission_label = '答题中'
      else if (st === 2 || st === 3) submission_label = '已交卷'
      return {
        id: row.id,
        title: row.title,
        subject_id: row.subject_id,
        subject_name: row.subject_name,
        start_time: row.start_time,
        end_time: row.end_time,
        duration: row.duration,
        description: row.description,
        phase,
        submission_id: row.submission_id,
        submission_status: st || null,
        submission_label,
        submit_time: row.submit_time,
        total_score: row.total_score != null ? Number(row.total_score) : null,
      }
    })
    return res.json({ data })
  } catch (error) {
    return res.status(500).json({ message: '加载考试列表失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 考试会话：题目（无答案）、草稿、截止时间；必要时自动创建 submission */
app.get('/api/student/exams/:examId/session', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const examId = Number(req.params.examId)
  const studentId = req.studentAuth.studentId
  if (!Number.isInteger(examId) || examId <= 0) {
    return res.status(400).json({ message: '考试ID不合法' })
  }
  const client = await pool.connect()
  try {
    const examR = await client.query(
      `
      SELECT e.id, e.title, e.subject_id, e.start_time, e.end_time, e.duration, e.description
      FROM exams e
      WHERE e.id = $1
        AND EXISTS (
          SELECT 1 FROM exam_classes ec
          JOIN class_members cm ON cm.class_id = ec.class_id AND cm.student_id = $2
          WHERE ec.exam_id = e.id
        )
      LIMIT 1
      `,
      [examId, studentId],
    )
    const exam = examR.rows[0]
    if (!exam) return res.status(403).json({ message: '无权参加该考试' })

    const phase = examPhaseFromRow(exam)
    if (phase === 'upcoming') {
      return res.status(403).json({ message: '考试尚未开始', data: { phase } })
    }

    let subR = await client.query(
      `SELECT id, status, start_time, submit_time, total_score FROM exam_submissions WHERE exam_id = $1 AND student_id = $2 LIMIT 1`,
      [examId, studentId],
    )
    let submission = subR.rows[0]

    if (!submission && phase === 'ongoing') {
      const ins = await client.query(
        `
        INSERT INTO exam_submissions (exam_id, student_id, start_time, status)
        VALUES ($1, $2, NOW(), 1)
        ON CONFLICT (exam_id, student_id) DO UPDATE SET start_time = exam_submissions.start_time
        RETURNING id, status, start_time, submit_time, total_score
        `,
        [examId, studentId],
      )
      submission = ins.rows[0]
    }

    if (!submission) {
      return res.status(403).json({ message: '考试已结束或未分配答卷', data: { phase } })
    }

    const st = Number(submission.status)
    if (st === 2 || st === 3) {
      const ansR = await client.query(
        `
        SELECT
          a.question_id,
          a.student_answer,
          a.score,
          a.is_correct,
          q.stem,
          q.question_type,
          q.answer_text,
          q.explanation
        FROM answers a
        JOIN questions q ON q.id = a.question_id AND q.deleted_at IS NULL
        LEFT JOIN exam_questions eq ON eq.exam_id = $2 AND eq.question_id = a.question_id
        WHERE a.submission_id = $1
        ORDER BY eq.sort_order ASC NULLS LAST, a.question_id ASC
        `,
        [submission.id, examId],
      )
      const qids = ansR.rows.map((r) => Number(r.question_id)).filter((id) => Number.isInteger(id) && id > 0)
      const optsByQ = new Map()
      if (qids.length) {
        const optR = await client.query(
          `
          SELECT question_id, option_key, option_text, sort_order
          FROM question_options
          WHERE question_id = ANY($1::bigint[])
          ORDER BY question_id ASC, sort_order ASC, option_key ASC
          `,
          [qids],
        )
        for (const o of optR.rows) {
          const k = Number(o.question_id)
          if (!optsByQ.has(k)) optsByQ.set(k, [])
          optsByQ.get(k).push({
            option_key: o.option_key,
            option_text: o.option_text,
            sort_order: o.sort_order,
          })
        }
      }
      return res.json({
        data: {
          mode: 'submitted',
          phase,
          exam: {
            id: exam.id,
            title: exam.title,
            duration: exam.duration,
            end_time: exam.end_time,
          },
          submission: {
            id: submission.id,
            status: st,
            submit_time: submission.submit_time,
            total_score: submission.total_score != null ? Number(submission.total_score) : null,
          },
          review: ansR.rows.map((a) => ({
            question_id: a.question_id,
            stem: a.stem,
            question_type: a.question_type,
            question_type_text: questionTypeLabelMap[a.question_type] || String(a.question_type),
            user_answer: unpackExamStudentAnswer(a.student_answer),
            correct: Boolean(a.is_correct),
            score: a.score != null ? Number(a.score) : null,
            correct_answer: String(a.answer_text || ''),
            explanation: String(a.explanation || ''),
            options: optsByQ.get(Number(a.question_id)) || [],
          })),
        },
      })
    }

    if (phase === 'ended' && st === 1) {
      return res.status(403).json({ message: '考试已结束，请等待成绩公布' })
    }

    const endMs = new Date(exam.end_time).getTime()
    const startMs = new Date(submission.start_time).getTime()
    const durMs = Math.max(1, Number(exam.duration) || 60) * 60 * 1000
    const deadlineMs = Math.min(endMs, startMs + durMs)
    const deadlineIso = new Date(deadlineMs).toISOString()

    const qR = await client.query(
      `
      SELECT eq.question_id, eq.score, eq.sort_order, q.question_type, q.stem
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id AND q.deleted_at IS NULL
      WHERE eq.exam_id = $1
      ORDER BY eq.sort_order ASC, eq.question_id ASC
      `,
      [examId],
    )
    const qids = qR.rows.map((r) => r.question_id)
    if (!qids.length) {
      return res.status(400).json({ message: '该考试暂无题目' })
    }
    const optR = await client.query(
      `
      SELECT question_id, option_key, option_text, sort_order
      FROM question_options
      WHERE question_id = ANY($1::bigint[])
      ORDER BY question_id ASC, sort_order ASC, option_key ASC
      `,
      [qids],
    )
    const optsByQ = new Map()
    for (const o of optR.rows) {
      const k = Number(o.question_id)
      if (!optsByQ.has(k)) optsByQ.set(k, [])
      optsByQ.get(k).push({
        option_key: o.option_key,
        option_text: o.option_text,
        sort_order: o.sort_order,
      })
    }

    const draftR = await client.query(
      `SELECT question_id, student_answer FROM answers WHERE submission_id = $1`,
      [submission.id],
    )
    const draft = {}
    for (const d of draftR.rows) {
      draft[String(d.question_id)] = unpackExamStudentAnswer(d.student_answer)
    }

    const questions = qR.rows.map((row) => ({
      question_id: row.question_id,
      score: Number(row.score || 0),
      sort_order: row.sort_order,
      question_type: row.question_type,
      question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
      stem: row.stem,
      options: optsByQ.get(Number(row.question_id)) || [],
    }))

    return res.json({
      data: {
        mode: 'take',
        phase,
        exam: {
          id: exam.id,
          title: exam.title,
          duration: exam.duration,
          end_time: exam.end_time,
        },
        submission: {
          id: submission.id,
          status: st,
          start_time: submission.start_time,
        },
        deadline_iso: deadlineIso,
        questions,
        draft_answers: draft,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

/** 保存作答草稿（考试中） */
app.put('/api/student/exams/:examId/answers', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const examId = Number(req.params.examId)
  const studentId = req.studentAuth.studentId
  if (!Number.isInteger(examId) || examId <= 0) {
    return res.status(400).json({ message: '考试ID不合法' })
  }
  const items = Array.isArray(req.body?.answers) ? req.body.answers : []
  const client = await pool.connect()
  try {
    const examR = await client.query(
      `SELECT id, start_time, end_time, duration FROM exams e
       WHERE e.id = $1 AND EXISTS (
         SELECT 1 FROM exam_classes ec
         JOIN class_members cm ON cm.class_id = ec.class_id AND cm.student_id = $2
         WHERE ec.exam_id = e.id
       ) LIMIT 1`,
      [examId, studentId],
    )
    const exam = examR.rows[0]
    if (!exam) return res.status(403).json({ message: '无权参加该考试' })

    const phase = examPhaseFromRow(exam)
    if (phase !== 'ongoing') return res.status(403).json({ message: '当前不可保存作答' })

    const subR = await client.query(
      `SELECT id, status, start_time FROM exam_submissions WHERE exam_id = $1 AND student_id = $2 LIMIT 1`,
      [examId, studentId],
    )
    const sub = subR.rows[0]
    if (!sub || Number(sub.status) !== 1) return res.status(400).json({ message: '未在答题中' })

    const endMs = new Date(exam.end_time).getTime()
    const startMs = new Date(sub.start_time).getTime()
    const durMs = Math.max(1, Number(exam.duration) || 60) * 60 * 1000
    if (Date.now() > Math.min(endMs, startMs + durMs)) {
      return res.status(403).json({ message: '考试时间已结束' })
    }

    const validIds = new Set()
    const idRows = await client.query(`SELECT question_id FROM exam_questions WHERE exam_id = $1`, [examId])
    for (const r of idRows.rows) validIds.add(Number(r.question_id))

    await client.query('BEGIN')
    for (const it of items) {
      const qid = Number(it?.question_id ?? it?.questionId)
      if (!Number.isInteger(qid) || qid <= 0 || !validIds.has(qid)) continue
      const ua = it?.user_answer ?? it?.userAnswer ?? ''
      await client.query(
        `
        INSERT INTO answers (submission_id, question_id, student_answer, score, is_correct, time_spent)
        VALUES ($1, $2, $3::jsonb, NULL, NULL, NULL)
        ON CONFLICT (submission_id, question_id) DO UPDATE SET
          student_answer = EXCLUDED.student_answer
        `,
        [sub.id, qid, packExamStudentAnswer(ua)],
      )
    }
    await client.query('COMMIT')
    return res.json({ data: { ok: true } })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (_) {}
    return res.status(500).json({ message: '保存失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

/** 考试中防作弊事件上报（切离小程序、离开考试页等），仅 status=进行中 可写 */
app.post('/api/student/exams/:examId/proctor-events', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const examId = Number(req.params.examId)
  const studentId = req.studentAuth.studentId
  if (!Number.isInteger(examId) || examId <= 0) {
    return res.status(400).json({ message: '考试ID不合法' })
  }
  const event = String(req.body?.event || '').trim()
  const source = String(req.body?.source || 'unknown').trim().slice(0, 24)
  const allowed = new Set(['leave', 'enter', 'page_hide', 'page_show'])
  if (!allowed.has(event)) {
    return res.status(400).json({ message: '事件类型无效' })
  }
  const client = await pool.connect()
  try {
    const examR = await client.query(
      `SELECT id, start_time, end_time, duration FROM exams e
       WHERE e.id = $1 AND EXISTS (
         SELECT 1 FROM exam_classes ec
         JOIN class_members cm ON cm.class_id = ec.class_id AND cm.student_id = $2
         WHERE ec.exam_id = e.id
       ) LIMIT 1`,
      [examId, studentId],
    )
    const exam = examR.rows[0]
    if (!exam) return res.status(403).json({ message: '无权参加该考试' })
    const phase = examPhaseFromRow(exam)
    if (phase !== 'ongoing') {
      return res.status(403).json({ message: '当前不在考试开放答题阶段' })
    }
    const subR = await client.query(
      `SELECT id, status, proctor_events FROM exam_submissions WHERE exam_id = $1 AND student_id = $2 LIMIT 1`,
      [examId, studentId],
    )
    const sub = subR.rows[0]
    if (!sub || Number(sub.status) !== 1) {
      return res.status(400).json({ message: '未在答题中' })
    }
    const endMs = new Date(exam.end_time).getTime()
    const startMs = new Date(sub.start_time).getTime()
    const durMs = Math.max(1, Number(exam.duration) || 60) * 60 * 1000
    if (Date.now() > Math.min(endMs, startMs + durMs)) {
      return res.status(403).json({ message: '考试时间已结束' })
    }
    let arr = sub.proctor_events
    if (typeof arr === 'string') {
      try {
        arr = JSON.parse(arr)
      } catch (_) {
        arr = []
      }
    }
    if (!Array.isArray(arr)) arr = []
    arr.push({
      event,
      source,
      at: new Date().toISOString(),
      client_ts: req.body?.clientTs != null ? Number(req.body.clientTs) : null,
    })
    if (arr.length > 400) arr = arr.slice(-400)
    await client.query(`UPDATE exam_submissions SET proctor_events = $1::jsonb WHERE id = $2`, [JSON.stringify(arr), sub.id])
    return res.json({ data: { ok: true, stored: arr.length } })
  } catch (error) {
    return res.status(500).json({ message: '记录失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

/** 交卷（客观题自动判分） */
app.post('/api/student/exams/:examId/submit', studentAuthRequired, studentClassMembershipRequired, async (req, res) => {
  const examId = Number(req.params.examId)
  const studentId = req.studentAuth.studentId
  if (!Number.isInteger(examId) || examId <= 0) {
    return res.status(400).json({ message: '考试ID不合法' })
  }
  const client = await pool.connect()
  try {
    const examR = await client.query(
      `SELECT e.id, e.start_time, e.end_time, e.duration FROM exams e
       WHERE e.id = $1 AND EXISTS (
         SELECT 1 FROM exam_classes ec
         JOIN class_members cm ON cm.class_id = ec.class_id AND cm.student_id = $2
         WHERE ec.exam_id = e.id
       ) LIMIT 1`,
      [examId, studentId],
    )
    const exam = examR.rows[0]
    if (!exam) return res.status(403).json({ message: '无权参加该考试' })
    const phase = examPhaseFromRow(exam)
    if (phase === 'upcoming') return res.status(403).json({ message: '考试尚未开始' })

    const subR = await client.query(
      `SELECT id, status, start_time FROM exam_submissions WHERE exam_id = $1 AND student_id = $2 LIMIT 1`,
      [examId, studentId],
    )
    const sub = subR.rows[0]
    if (!sub) return res.status(400).json({ message: '未开始答题' })
    if (Number(sub.status) !== 1) return res.status(400).json({ message: '已交卷' })

    const endMs = new Date(exam.end_time).getTime()
    const startMs = new Date(sub.start_time).getTime()
    const durMs = Math.max(1, Number(exam.duration) || 60) * 60 * 1000
    if (Date.now() > Math.min(endMs, startMs + durMs)) {
      return res.status(403).json({ message: '考试时间已结束' })
    }

    const qRows = await client.query(
      `
      SELECT eq.question_id, eq.score, q.question_type, q.answer_text, q.stem, q.explanation
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id AND q.deleted_at IS NULL
      WHERE eq.exam_id = $1
      ORDER BY eq.sort_order ASC, eq.question_id ASC
      `,
      [examId],
    )
    if (!qRows.rows.length) return res.status(400).json({ message: '该考试暂无题目' })

    const draftR = await client.query(`SELECT question_id, student_answer FROM answers WHERE submission_id = $1`, [sub.id])
    const draftMap = new Map()
    for (const d of draftR.rows) draftMap.set(Number(d.question_id), unpackExamStudentAnswer(d.student_answer))

    const finalItems = Array.isArray(req.body?.answers) ? req.body.answers : []
    for (const it of finalItems) {
      const qid = Number(it?.question_id ?? it?.questionId)
      if (!Number.isInteger(qid) || qid <= 0) continue
      draftMap.set(qid, it?.user_answer ?? it?.userAnswer ?? '')
    }

    await client.query('BEGIN')
    let total = 0
    const results = []
    for (const row of qRows.rows) {
      const qid = Number(row.question_id)
      const ua = draftMap.get(qid) ?? ''
      const ok = isStudentAnswerCorrect(Number(row.question_type), row.answer_text, ua)
      const sc = ok ? Number(row.score || 0) : 0
      total += sc
      await client.query(
        `
        INSERT INTO answers (submission_id, question_id, student_answer, score, is_correct, time_spent)
        VALUES ($1, $2, $3::jsonb, $4, $5, NULL)
        ON CONFLICT (submission_id, question_id) DO UPDATE SET
          student_answer = EXCLUDED.student_answer,
          score = EXCLUDED.score,
          is_correct = EXCLUDED.is_correct
        `,
        [sub.id, qid, packExamStudentAnswer(ua), sc, ok],
      )
      await incrementStudentQuestionStats(client, studentId, qid, ok, 'class_exam')
      results.push({
        question_id: qid,
        correct: ok,
        user_answer: String(ua),
        correct_answer: String(row.answer_text || ''),
        explanation: String(row.explanation || ''),
        stem: String(row.stem || ''),
        question_type: Number(row.question_type),
        score: sc,
      })
    }

    await client.query(
      `UPDATE exam_submissions SET status = 3, submit_time = NOW(), total_score = $1 WHERE id = $2`,
      [total, sub.id],
    )
    await client.query('COMMIT')
    return res.json({
      data: {
        total_score: total,
        results: results.map((r) => ({
          ...r,
          stem: r.stem,
          question_type_text: questionTypeLabelMap[r.question_type] || String(r.question_type),
        })),
      },
    })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (_) {}
    return res.status(500).json({ message: '交卷失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

async function fetchOptionsMapForQuestionIds(executor, questionIds) {
  const ids = []
  const seen = new Set()
  for (const x of questionIds) {
    const id = Number(x)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  const map = new Map()
  if (!ids.length) return map
  const { rows } = await executor.query(
    `
    SELECT question_id, option_key, option_text, sort_order
    FROM question_options
    WHERE question_id = ANY($1::bigint[])
    ORDER BY question_id ASC, sort_order ASC, option_key ASC
    `,
    [ids],
  )
  for (const row of rows) {
    const qid = Number(row.question_id)
    if (!map.has(qid)) map.set(qid, [])
    map.get(qid).push({
      option_key: row.option_key,
      option_text: row.option_text,
      sort_order: row.sort_order,
    })
  }
  return map
}

function defaultJudgeOptions() {
  return [
    { option_key: 'A', option_text: '对', sort_order: 1 },
    { option_key: 'B', option_text: '错', sort_order: 2 },
  ]
}

function optionsForQuestionFromMap(optionsMap, questionId, questionType) {
  const opts = optionsMap.get(Number(questionId)) || []
  if (opts.length) return opts
  if (Number(questionType) === 3) return defaultJudgeOptions()
  return []
}

app.post('/api/student/stats/question-options-batch', studentAuthRequired, async (req, res) => {
  const rawIds = Array.isArray(req.body?.question_ids) ? req.body.question_ids : []
  const questionIds = []
  const seen = new Set()
  for (const x of rawIds) {
    const id = Number(x)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    questionIds.push(id)
  }
  if (questionIds.length === 0) {
    return res.status(400).json({ message: '请提供 question_ids' })
  }
  if (questionIds.length > 100) {
    return res.status(400).json({ message: '单次最多 100 题' })
  }
  try {
    const optionsMap = await fetchOptionsMapForQuestionIds(pool, questionIds)
    const typeR = await pool.query(
      `
      SELECT id, question_type
      FROM questions
      WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
      `,
      [questionIds],
    )
    const typeById = new Map(typeR.rows.map((row) => [Number(row.id), Number(row.question_type)]))
    const data = {}
    for (const qid of questionIds) {
      const opts = optionsForQuestionFromMap(optionsMap, qid, typeById.get(qid))
      data[String(qid)] = opts
    }
    return res.json({ data })
  } catch (error) {
    return res.status(500).json({ message: '加载选项失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/stats/wrong-book', studentAuthRequired, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20))
  const offset = (page - 1) * pageSize
  const subjectId = Number(req.query.subject_id)
  const unitId = Number(req.query.unit_id)
  const hasSid = Number.isInteger(subjectId) && subjectId > 0
  const hasUid = Number.isInteger(unitId) && unitId > 0
  try {
    const baseFrom = `
      FROM student_question_stats s
      JOIN questions q ON q.id = s.question_id AND q.deleted_at IS NULL
      WHERE s.student_id = $1 AND s.wrong_count > 0
    `
    const baseParams = [req.studentAuth.studentId]
    let whereExtra = ''

    if (hasUid) {
      const ur = await pool.query(`SELECT subject_id FROM knowledge_units WHERE id = $1 LIMIT 1`, [unitId])
      if (!ur.rows[0]) {
        return res.status(404).json({ message: '知识单元不存在' })
      }
      const sidFromUnit = Number(ur.rows[0].subject_id)
      if (hasSid && subjectId !== sidFromUnit) {
        return res.status(400).json({ message: 'unit_id 与 subject_id 不匹配' })
      }
      const sidForQuery = hasSid ? subjectId : sidFromUnit
      baseParams.push(sidForQuery, unitId)
      whereExtra = `
        AND q.subject_id = $2
        AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          INNER JOIN question_tags qt ON qt.id = qtr.tag_id AND qt.unit_id = $3
          WHERE qtr.question_id = q.id
        )
      `
    } else if (hasSid) {
      baseParams.push(subjectId)
      whereExtra = ` AND q.subject_id = $2 `
    }

    const countSql = `SELECT COUNT(*)::int AS c ${baseFrom} ${whereExtra}`
    const countResult = await pool.query(countSql, baseParams)
    const total = Number(countResult.rows[0]?.c || 0)

    const listParams = [...baseParams, pageSize, offset]
    const lim = baseParams.length + 1
    const off = baseParams.length + 2
    const { rows } = await pool.query(
      `
      SELECT
        s.question_id,
        s.attempts,
        s.correct_count,
        s.wrong_count,
        s.updated_at,
        q.stem,
        q.question_type
      ${baseFrom}
      ${whereExtra}
      ORDER BY s.updated_at DESC, s.question_id DESC
      LIMIT $${lim} OFFSET $${off}
      `,
      listParams,
    )
    const optionsMap = await fetchOptionsMapForQuestionIds(pool, rows.map((row) => row.question_id))
    return res.json({
      data: rows.map((row) => ({
        question_id: row.question_id,
        stem: row.stem,
        question_type: row.question_type,
        question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
        attempts: row.attempts,
        correct_count: row.correct_count,
        wrong_count: row.wrong_count,
        updated_at: row.updated_at,
        options: optionsForQuestionFromMap(optionsMap, row.question_id, row.question_type),
      })),
      pagination: { total, page, pageSize },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载错题失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 将题目移出错题本：wrong_count 置 0（仍保留 attempts 等已做记录） */
app.post('/api/student/stats/wrong-book/remove', studentAuthRequired, async (req, res) => {
  const body = req.body || {}
  const rawIds = Array.isArray(body.question_ids) ? body.question_ids : []
  const questionIds = []
  const seen = new Set()
  for (const x of rawIds) {
    const id = Number(x)
    if (!Number.isInteger(id) || id <= 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    questionIds.push(id)
  }
  if (questionIds.length === 0 && body.question_id != null && body.question_id !== '') {
    const id = Number(body.question_id)
    if (Number.isInteger(id) && id > 0) questionIds.push(id)
  }
  if (questionIds.length === 0) {
    return res.status(400).json({ message: '请提供 question_id 或 question_ids' })
  }
  try {
    await pool.query(`DELETE FROM student_wrong_review WHERE student_id = $1 AND question_id = ANY($2::bigint[])`, [
      req.studentAuth.studentId,
      questionIds,
    ])
    const r = await pool.query(
      `
      UPDATE student_question_stats
      SET wrong_count = 0, updated_at = NOW()
      WHERE student_id = $1 AND question_id = ANY($2::bigint[])
      `,
      [req.studentAuth.studentId, questionIds],
    )
    return res.json({ data: { ok: true, updated: Number(r.rowCount || 0) } })
  } catch (error) {
    return res.status(500).json({ message: '移出错题本失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 今日待复习错题列表（与首页 review_due_count 同一口径） */
app.get('/api/student/stats/review-due-today', studentAuthRequired, async (req, res) => {
  const studentId = req.studentAuth.studentId
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20))
  const offset = (page - 1) * pageSize
  try {
    const dR = await pool.query(`SELECT (timezone('Asia/Shanghai', now()))::date AS d`)
    const shDate = dR.rows[0]?.d
    const countR = await pool.query(
      `
      SELECT COUNT(*)::int AS cnt
      ${REVIEW_DUE_STATS_FROM_SQL}
      WHERE s.student_id = $1 AND s.wrong_count > 0
        AND (r.next_review_date IS NULL OR r.next_review_date <= $2::date)
      `,
      [studentId, shDate],
    )
    const totalCount = Number(countR.rows[0]?.cnt || 0)
    const listR = await pool.query(
      `
      SELECT s.question_id, s.wrong_count, s.attempts, s.correct_count, s.updated_at,
        q.stem, q.question_type,
        to_char(r.next_review_date, 'YYYY-MM-DD') AS next_review_date,
        COALESCE(r.ladder, 0)::int AS ladder
      ${REVIEW_DUE_STATS_FROM_SQL}
      WHERE s.student_id = $1 AND s.wrong_count > 0
        AND (r.next_review_date IS NULL OR r.next_review_date <= $2::date)
      ORDER BY r.next_review_date NULLS FIRST, s.updated_at DESC
      LIMIT $3 OFFSET $4
      `,
      [studentId, shDate, pageSize, offset],
    )
    const rows = listR.rows || []
    const optionsMap = await fetchOptionsMapForQuestionIds(pool, rows.map((row) => row.question_id))
    return res.json({
      data: {
        count: totalCount,
        questions: rows.map((row) => ({
          question_id: row.question_id,
          stem: row.stem,
          question_type: row.question_type,
          question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
          wrong_count: row.wrong_count,
          attempts: row.attempts,
          correct_count: row.correct_count,
          next_review_date: row.next_review_date,
          ladder: row.ladder,
          updated_at: row.updated_at,
          options: optionsForQuestionFromMap(optionsMap, row.question_id, row.question_type),
        })),
        pagination: { total: totalCount, page, pageSize },
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载待复习失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/stats/done-questions', studentAuthRequired, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20))
  const offset = (page - 1) * pageSize
  const subjectId = Number(req.query.subject_id)
  const unitId = Number(req.query.unit_id)
  const hasSid = Number.isInteger(subjectId) && subjectId > 0
  const hasUid = Number.isInteger(unitId) && unitId > 0
  try {
    const baseFrom = `
      FROM student_question_stats s
      JOIN questions q ON q.id = s.question_id AND q.deleted_at IS NULL
      WHERE s.student_id = $1 AND s.attempts > 0
    `
    const baseParams = [req.studentAuth.studentId]
    let whereExtra = ''

    if (hasUid) {
      const ur = await pool.query(`SELECT subject_id FROM knowledge_units WHERE id = $1 LIMIT 1`, [unitId])
      if (!ur.rows[0]) {
        return res.status(404).json({ message: '知识单元不存在' })
      }
      const sidFromUnit = Number(ur.rows[0].subject_id)
      if (hasSid && subjectId !== sidFromUnit) {
        return res.status(400).json({ message: 'unit_id 与 subject_id 不匹配' })
      }
      const sidForQuery = hasSid ? subjectId : sidFromUnit
      baseParams.push(sidForQuery, unitId)
      whereExtra = `
        AND q.subject_id = $2
        AND EXISTS (
          SELECT 1 FROM question_tag_rel qtr
          INNER JOIN question_tags qt ON qt.id = qtr.tag_id AND qt.unit_id = $3
          WHERE qtr.question_id = q.id
        )
      `
    } else if (hasSid) {
      baseParams.push(subjectId)
      whereExtra = ` AND q.subject_id = $2 `
    }

    const countSql = `SELECT COUNT(*)::int AS c ${baseFrom} ${whereExtra}`
    const countResult = await pool.query(countSql, baseParams)
    const total = Number(countResult.rows[0]?.c || 0)

    const listParams = [...baseParams, pageSize, offset]
    const lim = baseParams.length + 1
    const off = baseParams.length + 2
    const { rows } = await pool.query(
      `
      SELECT
        s.question_id,
        s.attempts,
        s.correct_count,
        s.wrong_count,
        s.updated_at,
        q.stem,
        q.question_type
      ${baseFrom}
      ${whereExtra}
      ORDER BY s.updated_at DESC, s.question_id DESC
      LIMIT $${lim} OFFSET $${off}
      `,
      listParams,
    )
    const optionsMap = await fetchOptionsMapForQuestionIds(pool, rows.map((row) => row.question_id))
    return res.json({
      data: rows.map((row) => ({
        question_id: row.question_id,
        stem: row.stem,
        question_type: row.question_type,
        question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
        attempts: row.attempts,
        correct_count: row.correct_count,
        wrong_count: row.wrong_count,
        updated_at: row.updated_at,
        options: optionsForQuestionFromMap(optionsMap, row.question_id, row.question_type),
      })),
      pagination: { total, page, pageSize },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载已做题失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

const loadStudentClassPeerIds = async (executor, studentId) => {
  const r = await executor.query(
    `
    SELECT DISTINCT cm2.student_id AS sid
    FROM class_members cm1
    INNER JOIN class_members cm2 ON cm2.class_id = cm1.class_id
    WHERE cm1.student_id = $1
    `,
    [studentId],
  )
  return r.rows.map((x) => Number(x.sid)).filter((n) => Number.isInteger(n) && n > 0)
}

const PRACTICE_EVENT_SOURCES = `('practice_check', 'practice_exam')`

/** 题目删除后：清除各学生错题本、已做统计、刷题事件（软删时 question 行仍在，须主动清理） */
const purgeStudentPracticeDataForQuestionIds = async (client, rawQuestionIds) => {
  const questionIds = []
  const seen = new Set()
  for (const x of rawQuestionIds) {
    const id = Number(x)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    questionIds.push(id)
  }
  if (questionIds.length === 0) {
    return { stats: 0, wrongReview: 0, practiceEvents: 0 }
  }

  const dayRows = await client.query(
    `
    SELECT student_id, (timezone('Asia/Shanghai', created_at))::date AS practice_date, COUNT(*)::int AS c
    FROM student_practice_events
    WHERE question_id = ANY($1::bigint[])
      AND source IN ${PRACTICE_EVENT_SOURCES}
    GROUP BY student_id, (timezone('Asia/Shanghai', created_at))::date
    `,
    [questionIds],
  )

  const wrongR = await client.query(`DELETE FROM student_wrong_review WHERE question_id = ANY($1::bigint[])`, [
    questionIds,
  ])
  const statsR = await client.query(`DELETE FROM student_question_stats WHERE question_id = ANY($1::bigint[])`, [
    questionIds,
  ])
  const eventsR = await client.query(`DELETE FROM student_practice_events WHERE question_id = ANY($1::bigint[])`, [
    questionIds,
  ])

  for (const row of dayRows.rows) {
    const c = Math.max(0, Number(row.c) || 0)
    if (c <= 0) continue
    await client.query(
      `
      UPDATE student_practice_day
      SET attempts = GREATEST(0, attempts - $3)
      WHERE student_id = $1 AND practice_date = $2
      `,
      [row.student_id, row.practice_date, c],
    )
  }
  await client.query(`DELETE FROM student_practice_day WHERE attempts <= 0`)

  return {
    stats: Number(statsR.rowCount || 0),
    wrongReview: Number(wrongR.rowCount || 0),
    practiceEvents: Number(eventsR.rowCount || 0),
  }
}

/** PG date / timestamptz → 北京日历 YYYY-MM-DD */
const toShanghaiDateKey = (value) => {
  if (value == null || value === '') return ''
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    return ''
  }
}

const addShanghaiCalendarDays = (dateKey, deltaDays) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim())
  if (!m) return String(dateKey || '')
  const anchor = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`)
  anchor.setTime(anchor.getTime() + deltaDays * 86400000)
  return toShanghaiDateKey(anchor)
}

/**
 * 连续打卡天数：按北京日历日，当日至少 1 次刷题（practice_check / practice_exam）。
 * 若今日尚未打卡，则统计至昨日为止的连续天数（当日结束前仍展示昨日 streak）。
 * @returns {{ streak: number, checked_in_today: boolean }}
 */
const loadPracticeCheckinStreak = async (executor, studentId) => {
  const [datesR, todayR] = await Promise.all([
    executor.query(
      `
      SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS d
      FROM student_practice_events
      WHERE student_id = $1 AND source IN ${PRACTICE_EVENT_SOURCES}
      ORDER BY d DESC
      LIMIT 400
      `,
      [studentId],
    ),
    executor.query(`SELECT (timezone('Asia/Shanghai', now()))::date AS d`),
  ])
  const daySet = new Set(datesR.rows.map((row) => toShanghaiDateKey(row.d)).filter(Boolean))
  const today = toShanghaiDateKey(todayR.rows[0]?.d)
  const checked_in_today = Boolean(today && daySet.has(today))
  if (daySet.size === 0) return { streak: 0, checked_in_today: false }
  if (!today) return { streak: 0, checked_in_today: false }
  let cursor = checked_in_today ? today : addShanghaiCalendarDays(today, -1)
  if (!daySet.has(cursor)) return { streak: 0, checked_in_today }
  let streak = 0
  while (daySet.has(cursor)) {
    streak += 1
    cursor = addShanghaiCalendarDays(cursor, -1)
  }
  return { streak, checked_in_today }
}

/** 待复习错题：wrong_count>0 且（无排期或 next_review_date ≤ 上海当日），仅统计未删除题目 */
const REVIEW_DUE_STATS_FROM_SQL = `
  FROM student_question_stats s
  INNER JOIN questions q ON q.id = s.question_id AND q.deleted_at IS NULL
  LEFT JOIN student_wrong_review r ON r.student_id = s.student_id AND r.question_id = s.question_id
`

/** 今日待复习错题数：与 /api/student/stats/review-due-today 列表同一口径 */
const loadReviewDueWrongCountsByStudentIds = async (executor, peerIdsForQuery) => {
  if (!peerIdsForQuery || peerIdsForQuery.length === 0) return { rows: [] }
  return executor.query(
    `
    SELECT s.student_id, COUNT(*)::int AS cnt
    ${REVIEW_DUE_STATS_FROM_SQL}
    WHERE s.student_id = ANY($1::bigint[])
      AND s.wrong_count > 0
      AND (r.next_review_date IS NULL OR r.next_review_date <= (timezone('Asia/Shanghai', now()))::date)
    GROUP BY s.student_id
    `,
    [peerIdsForQuery],
  )
}

const mergePeerPracticeRows = (peerIds, rows) => {
  const byId = new Map()
  for (const row of rows || []) {
    byId.set(Number(row.student_id), row)
  }
  return peerIds.map((id) => {
    const row = byId.get(id)
    const wc = Number(row?.wrong_count || 0)
    const wa = row?.wrong_attempts != null && row?.wrong_attempts !== '' ? Number(row.wrong_attempts) : wc
    return {
      student_id: id,
      practice_questions: Number(row?.practice_questions || 0),
      wrong_count: wc,
      wrong_attempts: wa,
      total_attempts: Number(row?.total_attempts || 0),
    }
  })
}

const rawWrongAttempts = (r) => {
  const w = Number(r.wrong_attempts != null ? r.wrong_attempts : r.wrong_count || 0)
  return Number.isFinite(w) && w >= 0 ? w : 0
}

const practiceCorrectAttempts = (r) => {
  const total = Number(r.total_attempts || 0)
  if (total <= 0) return 0
  return Math.max(0, total - rawWrongAttempts(r))
}

/** 排名得分：答题正确数 × 正确率（正确率按本周期判题次数） */
const practiceRankScore = (r) => {
  const total = Number(r.total_attempts || 0)
  if (total <= 0) return -1
  const correct = practiceCorrectAttempts(r)
  return correct * (correct / total)
}

const comparePracticeRankRows = (a, b) => {
  const d = practiceRankScore(b) - practiceRankScore(a)
  if (Math.abs(d) > 1e-9) return d
  const cb = practiceCorrectAttempts(b)
  const ca = practiceCorrectAttempts(a)
  if (cb !== ca) return cb - ca
  if (b.practice_questions !== a.practice_questions) return b.practice_questions - a.practice_questions
  return a.wrong_count - b.wrong_count
}

/** 班级内排名：按 答题正确数×正确率；平局：正确次数多、答题数多、错题数少者靠前 */
const calcPracticeRankPayload = (studentId, merged, inClassPeerCount) => {
  const mine = merged.find((x) => x.student_id === studentId) || {
    student_id: studentId,
    practice_questions: 0,
    wrong_count: 0,
    wrong_attempts: 0,
    total_attempts: 0,
  }
  const total = mine.total_attempts
  const rw = rawWrongAttempts(mine)
  const correct = Math.max(0, total - rw)
  const accuracy_pct = total > 0 ? Math.round((100 * correct) / total) : 0
  const practice_questions = mine.practice_questions
  const wrong = mine.wrong_count

  const active = merged.filter((r) => r.total_attempts > 0)
  active.sort(comparePracticeRankRows)
  const idx = active.findIndex((r) => r.student_id === studentId)
  const inClass = Number(inClassPeerCount || 0) > 0
  const class_rank = inClass && idx >= 0 ? idx + 1 : null
  const rank_in_denominator = inClass ? active.length : 0
  const class_peers = inClass ? Number(inClassPeerCount) : 0
  return {
    practice_questions,
    wrong_count: wrong,
    correct_count: correct,
    total_attempts: total,
    accuracy_pct,
    class_rank,
    rank_in_denominator,
    class_peers,
    in_class: inClass,
    had_practice: total > 0,
  }
}

/**
 * 今日：练习题数=当天练习过的题数（去重）；错题数=当天每题最后一次判题为错的题数。
 * 周/月：按自然日汇总（每日口径与「今日」一致后累加）；正确率/答对次数按本周期全部判题次数。
 */
const loadPracticePeerAggregatesForPeriod = async (executor, peerIdsForQuery, period, dayStr = null) => {
  const p = String(period || '').toLowerCase()
  const calendarDay = parseShanghaiCalendarDateInput(dayStr)
  const base = `
    e.source IN ${PRACTICE_EVENT_SOURCES}
    AND e.student_id = ANY($1::bigint[])
  `
  const todayEq = `(e.created_at AT TIME ZONE 'Asia/Shanghai')::date = (now() AT TIME ZONE 'Asia/Shanghai')::date`
  const weekEq = `date_trunc('week', (e.created_at AT TIME ZONE 'Asia/Shanghai')) = date_trunc('week', (now() AT TIME ZONE 'Asia/Shanghai'))`
  const monthEq = `date_trunc('month', (e.created_at AT TIME ZONE 'Asia/Shanghai')) = date_trunc('month', (now() AT TIME ZONE 'Asia/Shanghai'))`

  if (calendarDay) {
    return executor.query(
      `
      WITH today_ev AS (
        SELECT e.student_id, e.question_id, e.is_correct, e.created_at
        FROM student_practice_events e
        WHERE ${base}
          AND (e.created_at AT TIME ZONE 'Asia/Shanghai')::date = $2::date
      ),
      last_try AS (
        SELECT DISTINCT ON (student_id, question_id)
          student_id,
          question_id,
          is_correct
        FROM today_ev
        ORDER BY student_id, question_id, created_at DESC
      )
      SELECT ev.student_id,
        (SELECT COUNT(DISTINCT question_id)::int FROM today_ev t WHERE t.student_id = ev.student_id) AS practice_questions,
        (SELECT COUNT(*)::int FROM last_try l WHERE l.student_id = ev.student_id AND NOT l.is_correct) AS wrong_count,
        COUNT(*)::int AS total_attempts,
        COUNT(*) FILTER (WHERE NOT ev.is_correct)::int AS wrong_attempts
      FROM today_ev ev
      GROUP BY ev.student_id
      `,
      [peerIdsForQuery, calendarDay],
    )
  }

  if (p === 'today') {
    return executor.query(
      `
      WITH today_ev AS (
        SELECT e.student_id, e.question_id, e.is_correct, e.created_at
        FROM student_practice_events e
        WHERE ${base} AND ${todayEq}
      ),
      last_try AS (
        SELECT DISTINCT ON (student_id, question_id)
          student_id,
          question_id,
          is_correct
        FROM today_ev
        ORDER BY student_id, question_id, created_at DESC
      )
      SELECT ev.student_id,
        (SELECT COUNT(DISTINCT question_id)::int FROM today_ev t WHERE t.student_id = ev.student_id) AS practice_questions,
        (SELECT COUNT(*)::int FROM last_try l WHERE l.student_id = ev.student_id AND NOT l.is_correct) AS wrong_count,
        COUNT(*)::int AS total_attempts,
        COUNT(*) FILTER (WHERE NOT ev.is_correct)::int AS wrong_attempts
      FROM today_ev ev
      GROUP BY ev.student_id
      `,
      [peerIdsForQuery],
    )
  }

  const periodPred = p === 'week' ? weekEq : p === 'month' ? monthEq : 'TRUE'
  return executor.query(
    `
    WITH ev AS (
      SELECT e.student_id, e.question_id, e.is_correct, e.created_at
      FROM student_practice_events e
      WHERE ${base} AND ${periodPred}
    ),
    daily_last AS (
      SELECT DISTINCT ON (
        ev.student_id,
        ev.question_id,
        (ev.created_at AT TIME ZONE 'Asia/Shanghai')::date
      )
        ev.student_id,
        ev.question_id,
        (ev.created_at AT TIME ZONE 'Asia/Shanghai')::date AS d,
        ev.is_correct
      FROM ev ev
      ORDER BY
        ev.student_id,
        ev.question_id,
        (ev.created_at AT TIME ZONE 'Asia/Shanghai')::date,
        ev.created_at DESC
    ),
    daily AS (
      SELECT student_id,
        d,
        COUNT(*)::int AS dq,
        COUNT(*) FILTER (WHERE NOT is_correct)::int AS dw
      FROM daily_last
      GROUP BY student_id, d
    ),
    summed AS (
      SELECT student_id,
        COALESCE(SUM(dq), 0)::int AS practice_questions,
        COALESCE(SUM(dw), 0)::int AS wrong_count
      FROM daily
      GROUP BY student_id
    ),
    raw_tot AS (
      SELECT ev.student_id,
        COUNT(*)::int AS total_attempts,
        COUNT(*) FILTER (WHERE NOT ev.is_correct)::int AS wrong_attempts
      FROM ev ev
      GROUP BY ev.student_id
    )
    SELECT r.student_id,
      COALESCE(s.practice_questions, 0)::int AS practice_questions,
      COALESCE(s.wrong_count, 0)::int AS wrong_count,
      COALESCE(r.total_attempts, 0)::int AS total_attempts,
      COALESCE(r.wrong_attempts, 0)::int AS wrong_attempts
    FROM raw_tot r
    LEFT JOIN summed s ON s.student_id = r.student_id
    `,
    [peerIdsForQuery],
  )
}

/** 首页：刷题/考试相关汇总 */
app.get('/api/student/stats/home-summary', studentAuthRequired, async (req, res) => {
  const studentId = req.studentAuth.studentId
  try {
    const totalsR = await pool.query(
      `
      SELECT
        COUNT(*)::int AS questions_touched,
        COALESCE(SUM(attempts), 0)::int AS attempts,
        COALESCE(SUM(correct_count), 0)::int AS correct,
        COALESCE(SUM(wrong_count), 0)::int AS wrong,
        COUNT(*) FILTER (WHERE wrong_count > 0)::int AS wrong_questions
      FROM student_question_stats
      WHERE student_id = $1
      `,
      [studentId],
    )
    const t = totalsR.rows[0] || {}
    const attempts = Number(t.attempts || 0)
    const correct = Number(t.correct || 0)
    const wrong = Number(t.wrong || 0)
    const denom = correct + wrong
    const accuracy_pct = denom > 0 ? Math.round((100 * correct) / denom) : 0

    const classPeerIds = await loadStudentClassPeerIds(pool, studentId)
    const inClassPeerCount = classPeerIds.length
    const peerIdsForQuery = inClassPeerCount > 0 ? classPeerIds : [studentId]

    const todayEvR = await loadPracticePeerAggregatesForPeriod(pool, peerIdsForQuery, 'today')
    const weekEvR = await loadPracticePeerAggregatesForPeriod(pool, peerIdsForQuery, 'week')
    const monthEvR = await loadPracticePeerAggregatesForPeriod(pool, peerIdsForQuery, 'month')

    const evSelfR = await pool.query(
      `SELECT 1 FROM student_practice_events WHERE student_id = $1 AND source IN ${PRACTICE_EVENT_SOURCES} LIMIT 1`,
      [studentId],
    )
    const hasPracticeEvents = Boolean(evSelfR.rows[0])
    let allMergedRows = (await loadPracticePeerAggregatesForPeriod(pool, peerIdsForQuery, 'all')).rows
    if (!hasPracticeEvents) {
      const allStatsR = await pool.query(
        `
        SELECT student_id,
          COUNT(*) FILTER (WHERE attempts > 0)::int AS practice_questions,
          COUNT(*) FILTER (WHERE wrong_count > 0)::int AS wrong_count,
          COALESCE(SUM(attempts), 0)::int AS total_attempts,
          COALESCE(SUM(wrong_count), 0)::int AS wrong_attempts
        FROM student_question_stats
        WHERE student_id = ANY($1::bigint[])
        GROUP BY student_id
        `,
        [peerIdsForQuery],
      )
      allMergedRows = allStatsR.rows
    }

    const todayMergedBase = mergePeerPracticeRows(peerIdsForQuery, todayEvR.rows)
    const todayDueR = await loadReviewDueWrongCountsByStudentIds(pool, peerIdsForQuery)
    const todayDueMap = new Map(todayDueR.rows.map((row) => [Number(row.student_id), Number(row.cnt || 0)]))
    const today = calcPracticeRankPayload(studentId, todayMergedBase, inClassPeerCount)
    const selfRow = todayMergedBase.find((m) => m.student_id === studentId)
    today.review_due_count = todayDueMap.get(studentId) || 0
    today.today_wrong_count = Number(selfRow?.wrong_count || today.wrong_count || 0)
    const week = calcPracticeRankPayload(
      studentId,
      mergePeerPracticeRows(peerIdsForQuery, weekEvR.rows),
      inClassPeerCount,
    )
    const month = calcPracticeRankPayload(
      studentId,
      mergePeerPracticeRows(peerIdsForQuery, monthEvR.rows),
      inClassPeerCount,
    )
    const all = calcPracticeRankPayload(
      studentId,
      mergePeerPracticeRows(peerIdsForQuery, allMergedRows),
      inClassPeerCount,
    )

    const practice_periods = { today, week, month, all }
    const checkin = await loadPracticeCheckinStreak(pool, studentId)

    return res.json({
      data: {
        totals: {
          questions_touched: Number(t.questions_touched || 0),
          attempts,
          correct,
          wrong,
          wrong_questions: Number(t.wrong_questions || 0),
          accuracy_pct,
        },
        practice_periods,
        checkin_streak: checkin.streak,
        checked_in_today: checkin.checked_in_today,
        timezone_note:
          '刷题 Tab 按 Asia/Shanghai。今日：答题数为当天练习过的题数（去重）；错题数为当天每题最后一次判题为错的题数；今日收获「待复习」为 review_due_count，与待复习列表一致。本周/月/全部错题数为各日错题数累加。正确率按本周期全部判题次数。不含班级正式考试。',
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载学习概况失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 班级刷题排名行（与小程序 practice-class-rank 同一套排序口径） */
const buildPracticeClassRankRows = async (executor, peerIds, period, { meStudentId = null } = {}) => {
  const p = String(period || 'today').toLowerCase()
  const classPeerIds = (peerIds || []).filter((id) => Number.isInteger(id) && id > 0)
  if (classPeerIds.length === 0) return { period: p, rows: [] }

  let aggRows = (await loadPracticePeerAggregatesForPeriod(executor, classPeerIds, p)).rows
  if (p === 'all') {
    let useStatsFallback = false
    if (meStudentId != null) {
      const evSelfR = await executor.query(
        `SELECT 1 FROM student_practice_events WHERE student_id = $1 AND source IN ${PRACTICE_EVENT_SOURCES} LIMIT 1`,
        [meStudentId],
      )
      useStatsFallback = !evSelfR.rows[0]
    } else {
      const evAnyR = await executor.query(
        `SELECT 1 FROM student_practice_events WHERE student_id = ANY($1::bigint[]) AND source IN ${PRACTICE_EVENT_SOURCES} LIMIT 1`,
        [classPeerIds],
      )
      useStatsFallback = !evAnyR.rows[0]
    }
    if (useStatsFallback) {
      const fallR = await executor.query(
        `
        SELECT student_id,
          COUNT(*) FILTER (WHERE attempts > 0)::int AS practice_questions,
          COUNT(*) FILTER (WHERE wrong_count > 0)::int AS wrong_count,
          COALESCE(SUM(attempts), 0)::int AS total_attempts,
          COALESCE(SUM(wrong_count), 0)::int AS wrong_attempts
        FROM student_question_stats
        WHERE student_id = ANY($1::bigint[])
        GROUP BY student_id
        `,
        [classPeerIds],
      )
      aggRows = fallR.rows
    }
  }

  const merged = mergePeerPracticeRows(classPeerIds, aggRows)
  const active = merged.filter((r) => r.total_attempts > 0)
  active.sort(comparePracticeRankRows)
  const nameR = await executor.query(
    `SELECT id, name, real_name, student_no, COALESCE(NULLIF(TRIM(real_name), ''), name) AS display_name FROM students WHERE id = ANY($1::bigint[])`,
    [classPeerIds],
  )
  const nameMap = new Map(
    nameR.rows.map((row) => [
      Number(row.id),
      {
        name: String(row.display_name || row.name || '').trim() || '同学',
        student_no: String(row.student_no || '').trim(),
      },
    ]),
  )
  const rows = active.map((r, i) => {
    const total = Number(r.total_attempts || 0)
    const correct = practiceCorrectAttempts(r)
    const accuracy_pct = total > 0 ? Math.round((100 * correct) / total) : 0
    const meta = nameMap.get(r.student_id) || { name: '同学', student_no: '' }
    return {
      rank: i + 1,
      student_id: r.student_id,
      name: meta.name,
      student_no: meta.student_no,
      practice_questions: r.practice_questions,
      correct_count: correct,
      wrong_count: r.wrong_count,
      total_attempts: total,
      accuracy_pct,
      rank_score: Math.round(practiceRankScore(r) * 100) / 100,
      is_me: meStudentId != null && r.student_id === meStudentId,
    }
  })
  return { period: p, rows }
}

/** 单会话绝对上限（防异常）；正常统计以心跳末次时间为准 */
const ONLINE_SESSION_MAX_SECONDS = 4 * 3600
/** 超过该秒数未心跳，视为已离线 */
const ONLINE_HEARTBEAT_STALE_SECONDS = 180
/** 末次心跳后再计入的缓冲秒数（覆盖一次心跳间隔） */
const ONLINE_HEARTBEAT_TAIL_SECONDS = 90
/** 切出后该秒数内再次进入，视为同一会话（续接而非新建） */
const ONLINE_SESSION_RESUME_SECONDS = 90
/** 时间轴展示：相邻会话间隔小于该值则合并为一段在线 */
const ONLINE_SESSION_TIMELINE_MERGE_GAP_SECONDS = 90

const onlineSessionEffectiveEndSql = (alias = 'sos', windowEndSql = 'NOW()') => `CASE
  WHEN ${alias}.ended_at IS NOT NULL THEN LEAST(
    ${alias}.ended_at,
    ${windowEndSql},
    COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
  )
  WHEN COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at) < LEAST(NOW(), ${windowEndSql}) - (${ONLINE_HEARTBEAT_STALE_SECONDS} * INTERVAL '1 second')
    THEN LEAST(
      COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second'),
      ${windowEndSql}
    )
  ELSE LEAST(NOW(), ${windowEndSql})
END`

const onlineSessionEffectiveSecondsSql = (windowEndSql = 'NOW()') => `CASE
  WHEN sos.ended_at IS NOT NULL THEN GREATEST(0, LEAST(
    ${ONLINE_SESSION_MAX_SECONDS},
    EXTRACT(EPOCH FROM (LEAST(sos.ended_at, ${windowEndSql}) - sos.started_at))::int
  ))
  ELSE GREATEST(0, LEAST(
    ${ONLINE_SESSION_MAX_SECONDS},
    EXTRACT(EPOCH FROM (${onlineSessionEffectiveEndSql('sos', windowEndSql)} - sos.started_at))::int
  ))
END`

/** 会话与统计窗口 [startSql, endSql) 的重叠秒数；未结束会话仅在窗口包含当前时刻时计入 */
const onlineSessionOverlapStartSql = (startSql, endSql) => `CASE
  WHEN sos.ended_at IS NOT NULL THEN GREATEST(sos.started_at, ${startSql})
  WHEN sos.started_at >= ${startSql} THEN sos.started_at
  WHEN COALESCE(sos.last_heartbeat_at, sos.started_at) >= ${startSql} THEN GREATEST(
    ${startSql},
    COALESCE(sos.last_heartbeat_at, sos.started_at) - (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
  )
  ELSE ${endSql}
END`

const onlineSessionOverlapSecondsSql = (startSql, endSql) => `CASE
  WHEN sos.ended_at IS NULL AND NOW() >= ${endSql} THEN 0
  WHEN sos.ended_at IS NULL AND NOW() < ${startSql} THEN 0
  WHEN sos.ended_at IS NULL
    AND sos.started_at < ${startSql}
    AND COALESCE(sos.last_heartbeat_at, sos.started_at) < ${startSql} THEN 0
  ELSE GREATEST(0, EXTRACT(EPOCH FROM (
    LEAST((${onlineSessionEffectiveEndSql('sos', endSql)}), ${endSql})
    - (${onlineSessionOverlapStartSql(startSql, endSql)})
  ))::int)
END`

const onlineSessionIntersectsWindowSql = (startSql, endSql) => `(
  sos.started_at < ${endSql}
  AND (${onlineSessionEffectiveEndSql('sos', endSql)}) > ${startSql}
  AND (
    sos.ended_at IS NOT NULL
    OR (
      NOW() >= ${startSql}
      AND NOW() < ${endSql}
      AND (
        sos.started_at >= ${startSql}
        OR COALESCE(sos.last_heartbeat_at, sos.started_at) >= ${startSql}
      )
    )
  )
)`

const SHANGHAI_CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const parseShanghaiCalendarDateInput = (raw) => {
  const s = String(raw || '').trim()
  return SHANGHAI_CALENDAR_DATE_RE.test(s) ? s : null
}

/** 统计窗口 [startSql, endSql) 的上海时区 timestamptz 表达式 */
const getOnlineStatsWindowSql = (period, dayStr) => {
  if (dayStr) {
    return {
      startSql: `('${dayStr}'::date::timestamp AT TIME ZONE 'Asia/Shanghai')`,
      endSql: `(('${dayStr}'::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')`,
    }
  }
  const p = String(period || 'today').toLowerCase()
  if (p === 'all') {
    return {
      startSql: `'1970-01-01'::timestamptz`,
      endSql: `NOW()`,
    }
  }
  if (p === 'week') {
    return {
      startSql: `(date_trunc('week', timezone('Asia/Shanghai', now())) AT TIME ZONE 'Asia/Shanghai')`,
      endSql: `NOW()`,
    }
  }
  if (p === 'month') {
    return {
      startSql: `(date_trunc('month', timezone('Asia/Shanghai', now())) AT TIME ZONE 'Asia/Shanghai')`,
      endSql: `NOW()`,
    }
  }
  return {
    startSql: `(date_trunc('day', timezone('Asia/Shanghai', now())) AT TIME ZONE 'Asia/Shanghai')`,
    endSql: `((date_trunc('day', timezone('Asia/Shanghai', now())) + interval '1 day') AT TIME ZONE 'Asia/Shanghai')`,
  }
}

/** 关闭会话时写入 ended_at：用户主动结束用 NOW()，僵尸会话用心跳收口时刻 */
const onlineSessionCloseEndedAtSql = (alias = 'sos') => `CASE
  WHEN COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at)
    < NOW() - (${ONLINE_HEARTBEAT_STALE_SECONDS} * INTERVAL '1 second')
    THEN LEAST(
      NOW(),
      COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
    )
  ELSE NOW()
END`

/** 某学生在指定上海日历日的在线秒数（实时 overlap，含进行中会话） */
const queryStudentDayOnlineLive = async (executor, studentId, dayStr) => {
  const { startSql, endSql } = getOnlineStatsWindowSql('today', dayStr)
  const overlapSecondsSql = onlineSessionOverlapSecondsSql(startSql, endSql)
  const intersectSql = onlineSessionIntersectsWindowSql(startSql, endSql)
  const r = await executor.query(
    `
    SELECT
      COALESCE(SUM(${overlapSecondsSql}), 0)::int AS total_seconds,
      COUNT(sos.id) FILTER (WHERE ${intersectSql})::int AS session_count,
      COUNT(sos.id) FILTER (WHERE sos.ended_at IS NULL AND ${intersectSql})::int AS open_session_count
    FROM student_online_sessions sos
    WHERE sos.student_id = $1
      AND ${intersectSql}
    `,
    [studentId],
  )
  const row = r.rows[0] || {}
  return {
    total_seconds: Number(row.total_seconds || 0),
    session_count: Number(row.session_count || 0),
    has_open_session: Number(row.open_session_count || 0) > 0,
  }
}

/** 班级在某日的在线总秒数（实时 overlap） */
const queryClassDayOnlineLiveTotal = async (executor, classId, dayStr) => {
  const { startSql, endSql } = getOnlineStatsWindowSql('today', dayStr)
  const overlapSecondsSql = onlineSessionOverlapSecondsSql(startSql, endSql)
  const intersectSql = onlineSessionIntersectsWindowSql(startSql, endSql)
  const r = await executor.query(
    `
    SELECT COALESCE(SUM(${overlapSecondsSql}), 0)::int AS total_seconds
    FROM student_online_sessions sos
    INNER JOIN class_members cm ON cm.student_id = sos.student_id AND cm.class_id = $1
    WHERE ${intersectSql}
    `,
    [classId],
  )
  return Number(r.rows[0]?.total_seconds || 0)
}

const queryClassOnlineStatsRows = async (pool, classId, { period, dayStr }) => {
  const todayR = await pool.query(`SELECT (timezone('Asia/Shanghai', now()))::date::text AS d`)
  const todayStr = String(todayR.rows[0]?.d || '')
  const p = String(period || 'today').toLowerCase()

  let startSql
  let endSql
  if (dayStr) {
    ;({ startSql, endSql } = getOnlineStatsWindowSql('today', dayStr))
  } else if (p === 'week' || p === 'month' || p === 'all') {
    ;({ startSql, endSql } = getOnlineStatsWindowSql(p, null))
  } else {
    ;({ startSql, endSql } = getOnlineStatsWindowSql('today', todayStr))
  }

  const overlapSecondsSql = onlineSessionOverlapSecondsSql(startSql, endSql)
  const intersectSql = onlineSessionIntersectsWindowSql(startSql, endSql)

  return pool.query(
    `
    SELECT
      cm.student_id,
      COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS display_name,
      s.student_no,
      COALESCE(SUM(${overlapSecondsSql}), 0)::int AS total_seconds,
      COUNT(sos.id) FILTER (WHERE sos.id IS NOT NULL AND ${intersectSql})::int AS session_count
    FROM class_members cm
    INNER JOIN students s ON s.id = cm.student_id
    LEFT JOIN student_online_sessions sos
      ON sos.student_id = cm.student_id
      AND ${intersectSql}
    WHERE cm.class_id = $1
    GROUP BY cm.student_id, display_name, s.student_no
    ORDER BY total_seconds DESC, display_name ASC
    `,
    [classId],
  )
}

/** 按上海日历日切分会话，重建 student_online_day（仅已结束会话） */
const rebuildAllStudentOnlineDayFromSessions = async (client) => {
  await client.query(`DELETE FROM student_online_day`)
  await client.query(
    `
    INSERT INTO student_online_day (student_id, online_date, total_seconds, session_count)
    SELECT
      sos.student_id,
      d.online_date,
      SUM(
        GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(
            sos.ended_at,
            ((d.online_date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'),
            COALESCE(sos.last_heartbeat_at, sos.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
          )
          - GREATEST(
            sos.started_at,
            (d.online_date::timestamp AT TIME ZONE 'Asia/Shanghai')
          )
        ))::int)
      )::int AS total_seconds,
      COUNT(*)::int AS session_count
    FROM student_online_sessions sos
    CROSS JOIN LATERAL (
      SELECT generate_series(
        (timezone('Asia/Shanghai', sos.started_at))::date,
        (timezone('Asia/Shanghai', LEAST(
          sos.ended_at,
          COALESCE(sos.last_heartbeat_at, sos.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
        )))::date,
        interval '1 day'
      )::date AS online_date
    ) d
    WHERE sos.ended_at IS NOT NULL
      AND sos.ended_at > sos.started_at
    GROUP BY sos.student_id, d.online_date
    HAVING SUM(
      GREATEST(0, EXTRACT(EPOCH FROM (
        LEAST(
          sos.ended_at,
          ((d.online_date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'),
          COALESCE(sos.last_heartbeat_at, sos.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
        )
        - GREATEST(
          sos.started_at,
          (d.online_date::timestamp AT TIME ZONE 'Asia/Shanghai')
        )
      ))::int)
    ) > 0
    `,
  )
}

const refreshStudentOnlineDayForStudent = async (client, studentId) => {
  await client.query(`DELETE FROM student_online_day WHERE student_id = $1`, [studentId])
  await client.query(
    `
    INSERT INTO student_online_day (student_id, online_date, total_seconds, session_count)
    SELECT
      sos.student_id,
      d.online_date,
      SUM(
        GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(
            sos.ended_at,
            ((d.online_date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'),
            COALESCE(sos.last_heartbeat_at, sos.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
          )
          - GREATEST(
            sos.started_at,
            (d.online_date::timestamp AT TIME ZONE 'Asia/Shanghai')
          )
        ))::int)
      )::int AS total_seconds,
      COUNT(*)::int AS session_count
    FROM student_online_sessions sos
    CROSS JOIN LATERAL (
      SELECT generate_series(
        (timezone('Asia/Shanghai', sos.started_at))::date,
        (timezone('Asia/Shanghai', LEAST(
          sos.ended_at,
          COALESCE(sos.last_heartbeat_at, sos.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
        )))::date,
        interval '1 day'
      )::date AS online_date
    ) d
    WHERE sos.student_id = $1
      AND sos.ended_at IS NOT NULL
      AND sos.ended_at > sos.started_at
    GROUP BY sos.student_id, d.online_date
    HAVING SUM(
      GREATEST(0, EXTRACT(EPOCH FROM (
        LEAST(
          sos.ended_at,
          ((d.online_date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'),
          COALESCE(sos.last_heartbeat_at, sos.started_at) + (${ONLINE_HEARTBEAT_TAIL_SECONDS} * INTERVAL '1 second')
        )
        - GREATEST(
          sos.started_at,
          (d.online_date::timestamp AT TIME ZONE 'Asia/Shanghai')
        )
      ))::int)
    ) > 0
    `,
    [studentId],
  )
}

const closeStudentOnlineSession = async (client, sessionId, studentId) => {
  const endedAtExpr = onlineSessionCloseEndedAtSql('student_online_sessions')
  const durationExpr = `GREATEST(0, LEAST($3::int, EXTRACT(EPOCH FROM ((${onlineSessionEffectiveEndSql('student_online_sessions')}) - started_at))::int))`
  const upd = await client.query(
    `
    UPDATE student_online_sessions
    SET ended_at = ${endedAtExpr},
        duration_seconds = ${durationExpr}
    WHERE id = $1 AND student_id = $2 AND ended_at IS NULL
    RETURNING duration_seconds, online_date
    `,
    [sessionId, studentId, ONLINE_SESSION_MAX_SECONDS],
  )
  const row = upd.rows[0]
  if (!row) return null
  await refreshStudentOnlineDayForStudent(client, studentId)
  return row
}

const closeStaleStudentOnlineSessions = async (client) => {
  await closePriorDayOpenStudentOnlineSessions(client)
  const openR = await client.query(
    `
    SELECT id, student_id
    FROM student_online_sessions
    WHERE ended_at IS NULL
      AND COALESCE(last_heartbeat_at, started_at) < NOW() - ($1::int * INTERVAL '1 second')
    ORDER BY started_at ASC
    `,
    [ONLINE_HEARTBEAT_STALE_SECONDS],
  )
  for (const row of openR.rows) {
    await closeStudentOnlineSession(client, Number(row.id), Number(row.student_id))
  }
  return openR.rows.length
}

/** 跨自然日仍未结束的会话：按末次心跳收口，避免从今天 0 点误计到当前时刻 */
const closePriorDayOpenStudentOnlineSessions = async (client) => {
  const openR = await client.query(
    `
    SELECT id, student_id
    FROM student_online_sessions
    WHERE ended_at IS NULL
      AND (timezone('Asia/Shanghai', started_at))::date
        < (timezone('Asia/Shanghai', now()))::date
    ORDER BY started_at ASC
    `,
  )
  for (const row of openR.rows) {
    await closeStudentOnlineSession(client, Number(row.id), Number(row.student_id))
  }
  return openR.rows.length
}

/** 学情日表：历史日用 student_online_day，今日用实时 overlap（避免续接会话双计） */
const loadStudentOnlineDailyRowsWithOpen = async (executor, studentId, { limit = 21 } = {}) => {
  const todayR = await executor.query(`SELECT (timezone('Asia/Shanghai', now()))::date::text AS d`)
  const todayStr = String(todayR.rows[0]?.d || '')
  const onlineDailyR = await executor.query(
    `
    SELECT online_date::text AS online_date, total_seconds::int AS total_seconds, session_count::int AS session_count
    FROM student_online_day
    WHERE student_id = $1
      AND online_date < (timezone('Asia/Shanghai', now()))::date
    ORDER BY online_date DESC
    LIMIT $2
    `,
    [studentId, Math.max(limit - 1, 0)],
  )

  const byDate = new Map(
    onlineDailyR.rows.map((row) => [
      String(row.online_date),
      {
        online_date: String(row.online_date),
        total_seconds: Number(row.total_seconds || 0),
        session_count: Number(row.session_count || 0),
        has_open_session: false,
      },
    ]),
  )

  const todayLive = await queryStudentDayOnlineLive(executor, studentId, todayStr)
  if (todayLive.total_seconds > 0 || todayLive.session_count > 0 || todayLive.has_open_session) {
    byDate.set(todayStr, {
      online_date: todayStr,
      total_seconds: todayLive.total_seconds,
      session_count: todayLive.session_count,
      has_open_session: todayLive.has_open_session,
    })
  }

  return Array.from(byDate.values()).sort((a, b) => (a.online_date < b.online_date ? 1 : -1))
}

const onlinePeriodStartExpr = (period) => getOnlineStatsWindowSql(period, null).startSql

/** 小程序进入前台：开始在线会话 */
app.post('/api/student/online-sessions/start', studentAuthRequired, async (req, res) => {
  const studentId = req.studentAuth.studentId
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const openTodayR = await client.query(
      `
      SELECT id
      FROM student_online_sessions
      WHERE student_id = $1
        AND ended_at IS NULL
        AND (timezone('Asia/Shanghai', started_at))::date = (timezone('Asia/Shanghai', now()))::date
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [studentId],
    )
    const openTodayId = openTodayR.rows[0] ? Number(openTodayR.rows[0].id) : 0
    if (openTodayId > 0) {
      await client.query(
        `
        UPDATE student_online_sessions
        SET last_heartbeat_at = NOW()
        WHERE id = $1 AND student_id = $2 AND ended_at IS NULL
        `,
        [openTodayId, studentId],
      )
      await client.query('COMMIT')
      return res.json({ data: { session_id: openTodayId, resumed: true } })
    }
    await closePriorDayOpenStudentOnlineSessions(client)
    const openR = await client.query(
      `SELECT id FROM student_online_sessions WHERE student_id = $1 AND ended_at IS NULL ORDER BY started_at ASC`,
      [studentId],
    )
    for (const row of openR.rows) {
      await closeStudentOnlineSession(client, Number(row.id), studentId)
    }
    const recentR = await client.query(
      `
      SELECT id
      FROM student_online_sessions
      WHERE student_id = $1
        AND ended_at IS NOT NULL
        AND ended_at > NOW() - ($2::int * INTERVAL '1 second')
        AND (timezone('Asia/Shanghai', ended_at))::date = (timezone('Asia/Shanghai', now()))::date
      ORDER BY ended_at DESC
      LIMIT 1
      `,
      [studentId, ONLINE_SESSION_RESUME_SECONDS],
    )
    const recentId = recentR.rows[0] ? Number(recentR.rows[0].id) : 0
    if (recentId > 0) {
      await client.query(
        `
        UPDATE student_online_sessions
        SET ended_at = NULL,
            duration_seconds = NULL,
            last_heartbeat_at = NOW()
        WHERE id = $1 AND student_id = $2
        `,
        [recentId, studentId],
      )
      await refreshStudentOnlineDayForStudent(client, studentId)
      await client.query('COMMIT')
      return res.json({ data: { session_id: recentId, resumed: true } })
    }
    const dateR = await client.query(`SELECT (timezone('Asia/Shanghai', now()))::date AS d`)
    const onlineDate = dateR.rows[0]?.d
    const ins = await client.query(
      `
      INSERT INTO student_online_sessions (student_id, started_at, online_date, last_heartbeat_at)
      VALUES ($1, NOW(), $2, NOW())
      RETURNING id
      `,
      [studentId, onlineDate],
    )
    await client.query('COMMIT')
    return res.json({ data: { session_id: Number(ins.rows[0]?.id || 0) } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '开始在线会话失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

/** 小程序切出前台：结束在线会话 */
app.post('/api/student/online-sessions/end', studentAuthRequired, async (req, res) => {
  const studentId = req.studentAuth.studentId
  const sessionId = Number(req.body?.session_id ?? req.body?.sessionId)
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ message: 'session_id 不合法' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existingR = await client.query(
      `
      SELECT id, duration_seconds, ended_at
      FROM student_online_sessions
      WHERE id = $1 AND student_id = $2
      LIMIT 1
      `,
      [sessionId, studentId],
    )
    const existing = existingR.rows[0]
    if (!existing) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '会话不存在或已结束' })
    }
    if (existing.ended_at) {
      await client.query('COMMIT')
      return res.json({
        data: {
          session_id: sessionId,
          duration_seconds: Number(existing.duration_seconds || 0),
          already_ended: true,
        },
      })
    }
    const row = await closeStudentOnlineSession(client, sessionId, studentId)
    if (!row) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '会话不存在或已结束' })
    }
    await client.query('COMMIT')
    return res.json({ data: { session_id: sessionId, duration_seconds: Number(row.duration_seconds || 0) } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '结束在线会话失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

/** 小程序前台心跳：用于准确统计在线时长，避免未触发 onHide 时整段后台时间被计入 */
app.post('/api/student/online-sessions/heartbeat', studentAuthRequired, async (req, res) => {
  const studentId = req.studentAuth.studentId
  const sessionId = Number(req.body?.session_id ?? req.body?.sessionId)
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ message: 'session_id 不合法' })
  }
  try {
    const upd = await pool.query(
      `
      UPDATE student_online_sessions
      SET last_heartbeat_at = NOW()
      WHERE id = $1 AND student_id = $2 AND ended_at IS NULL
        AND COALESCE(last_heartbeat_at, started_at) <= NOW() - INTERVAL '10 seconds'
      RETURNING id
      `,
      [sessionId, studentId],
    )
    if (!upd.rows[0]) {
      const stillOpen = await pool.query(
        `
        SELECT id FROM student_online_sessions
        WHERE id = $1 AND student_id = $2 AND ended_at IS NULL
        LIMIT 1
        `,
        [sessionId, studentId],
      )
      if (!stillOpen.rows[0]) {
        return res.status(404).json({ message: '会话不存在或已结束' })
      }
      return res.json({ data: { session_id: sessionId, ok: true, throttled: true } })
    }
    return res.json({ data: { session_id: sessionId, ok: true } })
  } catch (error) {
    return res.status(500).json({ message: '心跳上报失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 本周期班级刷题排名列表（含姓名），period=today|week|month|all */
app.get('/api/student/stats/practice-class-rank', studentAuthRequired, async (req, res) => {
  const period = String(req.query.period || 'today').toLowerCase()
  if (!['today', 'week', 'month', 'all'].includes(period)) {
    return res.status(400).json({ message: 'period 仅支持 today、week、month、all' })
  }
  const studentId = req.studentAuth.studentId
  try {
    const classPeerIds = await loadStudentClassPeerIds(pool, studentId)
    if (classPeerIds.length === 0) {
      return res.json({ data: { period, rows: [] } })
    }
    const { rows } = await buildPracticeClassRankRows(pool, classPeerIds, period, { meStudentId: studentId })
    return res.json({ data: { period, rows } })
  } catch (error) {
    return res.status(500).json({ message: '加载班级排名失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.patch('/api/classes/:id/join-requests/:requestId', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  const requestId = Number(req.params.requestId)
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (Number.isNaN(classId) || Number.isNaN(requestId)) {
    return res.status(400).json({ message: '参数不合法' })
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'action 仅支持 approve 或 reject' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }
    const requestResult = await client.query(
      `
      SELECT id, class_id, student_name, student_no, invite_code, status
      FROM class_join_requests
      WHERE id = $1 AND class_id = $2
      FOR UPDATE
      `,
      [requestId, classId],
    )
    const requestRow = requestResult.rows[0]
    if (!requestRow) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '入班申请不存在' })
    }
    if (String(requestRow.status) !== 'pending') {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该入班申请已处理' })
    }

    if (action === 'approve') {
    const joinResult = await upsertStudentAndJoinClass({
      client,
      classId,
      name: String(requestRow.student_name),
      studentNo: String(requestRow.student_no),
      operatorId: req.auth?.userId || null,
      inviteCode: String(requestRow.invite_code || ''),
      joinChannel: 'mini_program_approved',
      realName: String(requestRow.student_name),
    })
      await client.query(
        `
        UPDATE class_join_requests
        SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1
        WHERE id = $2
        `,
        [req.auth?.userId || null, requestId],
      )
      await writeOperationLog({
        client,
        operatorId: req.auth?.userId,
        action: 'class.join_request.approve',
        targetType: 'class',
        targetId: String(classId),
        detail: { requestId, studentId: joinResult.studentId },
      })
      await client.query('COMMIT')
      return res.json({ data: { id: requestId, status: 'approved' } })
    }

    await client.query(
      `
      UPDATE class_join_requests
      SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1
      WHERE id = $2
      `,
      [req.auth?.userId || null, requestId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.join_request.reject',
      targetType: 'class',
      targetId: String(classId),
      detail: { requestId },
    })
    await client.query('COMMIT')
    return res.json({ data: { id: requestId, status: 'rejected' } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '处理入班申请失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/classes/:id/leave-requests/:requestId', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  const requestId = Number(req.params.requestId)
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (Number.isNaN(classId) || Number.isNaN(requestId)) {
    return res.status(400).json({ message: '参数不合法' })
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'action 仅支持 approve 或 reject' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }
    const requestResult = await client.query(
      `
      SELECT id, class_id, student_id, status
      FROM class_leave_requests
      WHERE id = $1 AND class_id = $2
      FOR UPDATE
      `,
      [requestId, classId],
    )
    const requestRow = requestResult.rows[0]
    if (!requestRow) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '退班申请不存在' })
    }
    if (String(requestRow.status) !== 'pending') {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该退班申请已处理' })
    }
    const studentId = Number(requestRow.student_id)

    if (action === 'reject') {
      await client.query(
        `
        UPDATE class_leave_requests
        SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1
        WHERE id = $2
        `,
        [req.auth?.userId || null, requestId],
      )
      await writeOperationLog({
        client,
        operatorId: req.auth?.userId,
        action: 'class.leave_request.reject',
        targetType: 'class',
        targetId: String(classId),
        detail: { requestId, studentId },
      })
      await client.query('COMMIT')
      return res.json({ data: { id: requestId, status: 'rejected' } })
    }

    const mem = await client.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 LIMIT 1`,
      [classId, studentId],
    )
    if (!mem.rows[0]) {
      await client.query(
        `
        UPDATE class_leave_requests
        SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1, review_note = '学生已不在该班级'
        WHERE id = $2
        `,
        [req.auth?.userId || null, requestId],
      )
      await writeOperationLog({
        client,
        operatorId: req.auth?.userId,
        action: 'class.leave_request.reject',
        targetType: 'class',
        targetId: String(classId),
        detail: { requestId, studentId, reason: 'not_member' },
      })
      await client.query('COMMIT')
      return res.json({ data: { id: requestId, status: 'rejected', message: '学生已不在该班，申请已关闭' } })
    }

    await clearExamDataWhenLeavingClass(client, studentId, classId)
    await client.query(`DELETE FROM class_members WHERE class_id = $1 AND student_id = $2`, [classId, studentId])
    await client.query(
      `
      UPDATE class_leave_requests
      SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1
      WHERE id = $2
      `,
      [req.auth?.userId || null, requestId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.leave_request.approve',
      targetType: 'class',
      targetId: String(classId),
      detail: { requestId, studentId },
    })
    await client.query('COMMIT')
    return res.json({ data: { id: requestId, status: 'approved' } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '处理退班申请失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/classes/:id/students', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId)) return res.status(400).json({ message: '班级ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertClassReadAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const { rows } = await client.query(
      `
      SELECT
        s.id,
        s.name AS nickname,
        s.real_name,
        COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS name,
        NULLIF(TRIM(s.wechat_avatar_url), '') AS avatar_url,
        cm.class_id
      FROM class_members cm
      JOIN students s ON s.id = cm.student_id
      WHERE cm.class_id = $1
      ORDER BY s.id DESC
      `,
      [classId],
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '学生列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/classes/:id/teachers', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId)) return res.status(400).json({ message: '班级ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertClassReadAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const { rows } = await client.query(
      `
      SELECT
        ct.class_id,
        ct.teacher_id,
        u.name AS teacher_name,
        u.phone AS teacher_phone,
        ct.subject_id,
        s.name AS subject_name
      FROM class_teachers ct
      JOIN users u ON u.id = ct.teacher_id
      JOIN subjects s ON s.id = ct.subject_id
      WHERE ct.class_id = $1
      ORDER BY ct.teacher_id DESC, ct.subject_id ASC
      `,
      [classId],
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '科任教师列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/classes/:id/teachers', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId)) return res.status(400).json({ message: '班级ID不合法' })
  const teacherId = Number(req.body?.teacherId)
  const subjectId = Number(req.body?.subjectId)
  if (Number.isNaN(teacherId) || Number.isNaN(subjectId)) {
    return res.status(400).json({ message: 'teacherId 和 subjectId 必填' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }

    const roleCheck = await client.query(
      `
      SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.code = 'subject_teacher'
      LIMIT 1
      `,
      [teacherId],
    )
    if (roleCheck.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该账号不是科任教师' })
    }

    const permissionCheck = await client.query(
      `
      SELECT 1
      FROM teacher_subjects
      WHERE teacher_id = $1 AND subject_id = $2
      LIMIT 1
      `,
      [teacherId, subjectId],
    )
    if (permissionCheck.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该科任教师未被分配此科目' })
    }

    await client.query(
      `
      INSERT INTO class_teachers (class_id, teacher_id, subject_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      `,
      [classId, teacherId, subjectId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.teacher.add',
      targetType: 'class',
      targetId: String(classId),
      detail: { teacherId, subjectId },
    })
    await client.query('COMMIT')
    return res.status(201).json({ data: { class_id: classId, teacher_id: teacherId, subject_id: subjectId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '添加科任教师失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.delete('/api/classes/:id/teachers/:teacherId/:subjectId', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  const teacherId = Number(req.params.teacherId)
  const subjectId = Number(req.params.subjectId)
  if (Number.isNaN(classId) || Number.isNaN(teacherId) || Number.isNaN(subjectId)) {
    return res.status(400).json({ message: '参数不合法' })
  }
  const client = await pool.connect()
  try {
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const result = await client.query(
      `
      DELETE FROM class_teachers
      WHERE class_id = $1 AND teacher_id = $2 AND subject_id = $3
      `,
      [classId, teacherId, subjectId],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ message: '班级中不存在该科任教师科目关联' })
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.teacher.remove',
      targetType: 'class',
      targetId: String(classId),
      detail: { teacherId, subjectId },
    })
    return res.json({ data: { class_id: classId, teacher_id: teacherId, subject_id: subjectId } })
  } catch (error) {
    return res.status(500).json({ message: '移除科任教师失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/teachers', authRequired, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.phone,
        COALESCE(array_remove(array_agg(DISTINCT s.id), NULL), '{}') AS subject_ids,
        COALESCE(array_remove(array_agg(DISTINCT s.name), NULL), '{}') AS subject_names
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id AND r.code = 'subject_teacher'
      LEFT JOIN teacher_subjects ts ON ts.teacher_id = u.id
      LEFT JOIN subjects s ON s.id = ts.subject_id
      GROUP BY u.id
      ORDER BY u.id DESC
      `,
    )
    return res.json({ data: rows })
  } catch (error) {
    return res.status(500).json({ message: '科任教师查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/classes/:id/students', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  if (Number.isNaN(classId)) return res.status(400).json({ message: '班级ID不合法' })
  const name = String(req.body?.name || '').trim()
  const studentNo = String(req.body?.studentNo || '').trim()
  if (!name || !studentNo) return res.status(400).json({ message: '学生姓名和学号不能为空' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }

    const classInfo = await client.query('SELECT invite_code FROM classes WHERE id = $1 LIMIT 1', [classId])
    const joinResult = await upsertStudentAndJoinClass({
      client,
      classId,
      name,
      studentNo,
      operatorId: req.auth?.userId || null,
      inviteCode: String(classInfo.rows[0]?.invite_code || ''),
      joinChannel: 'admin_manual',
      realName: name,
    })
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.student.add',
      targetType: 'class',
      targetId: String(classId),
      detail: { studentId: joinResult.studentId, studentNo },
    })
    await client.query('COMMIT')
    return res.status(201).json({ data: { class_id: classId, student_id: joinResult.studentId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '新增学生失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.delete('/api/classes/:id/students/:studentId', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  const studentId = Number(req.params.studentId)
  if (Number.isNaN(classId) || Number.isNaN(studentId)) {
    return res.status(400).json({ message: '参数不合法' })
  }
  const client = await pool.connect()
  try {
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const memCheck = await client.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 LIMIT 1`,
      [classId, studentId],
    )
    if (!memCheck.rows[0]) {
      return res.status(404).json({ message: '该学生不在当前班级中' })
    }
    await clearExamDataWhenLeavingClass(client, studentId, classId)
    const result = await client.query(
      `
      DELETE FROM class_members
      WHERE class_id = $1 AND student_id = $2
      `,
      [classId, studentId],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ message: '该学生不在当前班级中' })
    }
    await client.query(
      `
      UPDATE class_leave_requests
      SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $3, review_note = '教师已将学生移出班级'
      WHERE class_id = $1 AND student_id = $2 AND status = 'pending'
      `,
      [classId, studentId, req.auth?.userId || null],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'class.student.remove',
      targetType: 'class',
      targetId: String(classId),
      detail: { studentId },
    })
    return res.json({ data: { class_id: classId, student_id: studentId } })
  } catch (error) {
    return res.status(500).json({ message: '移出学生失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

/** 班级内某学生的刷题与考试概况（须能查看该班级） */
app.get('/api/classes/:id/students/:studentId/insights', authRequired, async (req, res) => {
  const classId = Number(req.params.id)
  const studentId = Number(req.params.studentId)
  if (Number.isNaN(classId) || Number.isNaN(studentId)) {
    return res.status(400).json({ message: '班级或学生参数不合法' })
  }
  const client = await pool.connect()
  try {
    try {
      await client.query('BEGIN')
      await closeStaleStudentOnlineSessions(client)
      await client.query('COMMIT')
    } catch (staleError) {
      await client.query('ROLLBACK')
      throw staleError
    }
    const access = await assertClassReadAccess(client, classId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const mem = await client.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 LIMIT 1`,
      [classId, studentId],
    )
    if (!mem.rows[0]) {
      return res.status(404).json({ message: '该学生不在当前班级中' })
    }
    const studentR = await client.query(
      `
      SELECT
        s.id,
        s.name AS nickname,
        s.real_name,
        COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS name,
        NULLIF(TRIM(s.wechat_avatar_url), '') AS avatar_url
      FROM students s
      WHERE s.id = $1
      LIMIT 1
      `,
      [studentId],
    )
    const student = studentR.rows[0]
    if (!student) return res.status(404).json({ message: '学生不存在' })

    const statsR = await client.query(
      `
      SELECT
        COUNT(*)::int AS questions_touched,
        COALESCE(SUM(attempts), 0)::int AS attempts,
        COALESCE(SUM(correct_count), 0)::int AS correct,
        COALESCE(SUM(wrong_count), 0)::int AS wrong,
        COUNT(*) FILTER (WHERE wrong_count > 0)::int AS wrong_questions
      FROM student_question_stats
      WHERE student_id = $1
      `,
      [studentId],
    )
    const st = statsR.rows[0] || {}
    const correct = Number(st.correct || 0)
    const wrong = Number(st.wrong || 0)
    const denom = correct + wrong
    const accuracy_pct = denom > 0 ? Math.round((100 * correct) / denom) : 0

    const ev30R = await client.query(
      `
      SELECT COUNT(*)::int AS c
      FROM student_practice_events
      WHERE student_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      `,
      [studentId],
    )
    const practiceEvents30d = Number(ev30R.rows[0]?.c || 0)

    const dailyR = await client.query(
      `
      SELECT practice_date::text AS practice_date, attempts::int AS attempts
      FROM student_practice_day
      WHERE student_id = $1
      ORDER BY practice_date DESC
      LIMIT 21
      `,
      [studentId],
    )

    const onlineDailyRows = await loadStudentOnlineDailyRowsWithOpen(client, studentId, { limit: 21 })
    const todayStrR = await client.query(`SELECT (timezone('Asia/Shanghai', now()))::date::text AS d`)
    const insightTodayStr = String(todayStrR.rows[0]?.d || '')
    const online30R = await client.query(
      `
      SELECT COALESCE(SUM(total_seconds), 0)::int AS total_seconds
      FROM student_online_day
      WHERE student_id = $1
        AND online_date >= ((timezone('Asia/Shanghai', now()))::date - 29)
        AND online_date < (timezone('Asia/Shanghai', now()))::date
      `,
      [studentId],
    )
    const todayLiveFor30 = await queryStudentDayOnlineLive(client, studentId, insightTodayStr)
    const online30Seconds = Number(online30R.rows[0]?.total_seconds || 0) + todayLiveFor30.total_seconds

    const examsR = await client.query(
      `
      SELECT
        e.id AS exam_id,
        e.title,
        e.status AS exam_status,
        s.name AS subject_name,
        e.start_time,
        e.end_time,
        e.duration,
        es.id AS submission_id,
        es.status AS submission_status,
        es.start_time AS submission_start_time,
        es.submit_time,
        es.total_score
      FROM exam_classes ec
      JOIN exams e ON e.id = ec.exam_id
      JOIN subjects s ON s.id = e.subject_id
      LEFT JOIN exam_submissions es ON es.exam_id = e.id AND es.student_id = $2
      WHERE ec.class_id = $1
      ORDER BY e.start_time DESC NULLS LAST, e.id DESC
      LIMIT 100
      `,
      [classId, studentId],
    )

    const examPhaseLabel = (row) => {
      const examStatus = Number(row.exam_status || 0)
      if (examStatus === 1) return '未开始'
      if (examStatus === 2) return '进行中'
      if (examStatus === 3) return '已结束'
      return '—'
    }
    const submissionStatusText = (stRaw) => {
      const n = Number(stRaw)
      if (!n) return '未作答'
      if (n === 3 || n === 2) return '已出分'
      if (n === 1) return '进行中'
      return `状态${n}`
    }

    return res.json({
      data: {
        student: {
          id: Number(student.id),
          name: student.name,
          nickname: student.nickname,
          real_name: student.real_name,
          avatar_url: student.avatar_url || '',
        },
        practice_summary: {
          questions_touched: Number(st.questions_touched || 0),
          attempts: Number(st.attempts || 0),
          correct,
          wrong,
          wrong_questions: Number(st.wrong_questions || 0),
          accuracy_pct,
          practice_events_30d: practiceEvents30d,
        },
        practice_daily: dailyR.rows.map((r) => ({
          practice_date: r.practice_date,
          attempts: Number(r.attempts || 0),
        })),
        online_summary: {
          total_seconds_30d: online30Seconds,
        },
        online_daily: onlineDailyRows.map((r) => ({
          online_date: r.online_date,
          total_seconds: Number(r.total_seconds || 0),
          session_count: Number(r.session_count || 0),
          has_open_session: Boolean(r.has_open_session),
        })),
        exams: examsR.rows.map((row) => ({
          exam_id: Number(row.exam_id),
          title: row.title,
          exam_status: Number(row.exam_status || 0),
          exam_phase_label: examPhaseLabel(row),
          subject_name: row.subject_name,
          start_time: row.start_time,
          end_time: row.end_time,
          duration: Number(row.duration || 0),
          submission_id: row.submission_id != null ? Number(row.submission_id) : null,
          submission_status: row.submission_status != null ? Number(row.submission_status) : null,
          submission_status_text: submissionStatusText(row.submission_status),
          submission_start_time: row.submission_start_time,
          submit_time: row.submit_time,
          total_score: row.total_score != null ? Number(row.total_score) : null,
        })),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载学生学情失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/exams', authRequired, async (req, res) => {
  try {
    const status = Number(req.query?.status)
    const manageableOnly = String(req.query?.manageableOnly || '0') === '1'
    const explicitPaging = req.query?.page !== undefined && req.query?.page !== ''
    const page = Math.max(1, parseInt(String(req.query?.page ?? '1'), 10) || 1)
    let pageSize = Math.min(200, Math.max(1, parseInt(String(req.query?.pageSize ?? '200'), 10) || 200))
    if (explicitPaging) {
      pageSize = Math.min(100, Math.max(1, parseInt(String(req.query?.pageSize ?? '20'), 10) || 20))
    }
    const offset = (page - 1) * pageSize

    const values = [req.auth.userId]
    const isAdmin = hasRole(req, 'admin')
    let accessClause = ''
    if (isAdmin) {
      accessClause = ''
      values.length = 0
    } else {
      const orParts = []
      const uidIdx = 1
      if (hasRole(req, 'class_teacher')) {
        orParts.push(`e.creator_id = $${uidIdx}`)
        orParts.push(`EXISTS (
          SELECT 1 FROM exam_classes ec
          JOIN classes c ON c.id = ec.class_id
          WHERE ec.exam_id = e.id AND c.owner_id = $${uidIdx}
        )`)
      }
      if (hasRole(req, 'subject_teacher')) {
        orParts.push(`EXISTS (
          SELECT 1
          FROM exam_classes ec
          JOIN class_teachers ct ON ct.class_id = ec.class_id
          WHERE ec.exam_id = e.id AND ct.teacher_id = $${uidIdx}
        )`)
      }
      if (orParts.length === 0) {
        accessClause = 'WHERE 1 = 0'
      } else {
        accessClause = `WHERE (${orParts.join(' OR ')})`
      }
    }

    const whereParts = []
    if (accessClause.trim()) {
      whereParts.push(accessClause.replace(/^\s*WHERE\s+/i, '').trim())
    }
    if (!Number.isNaN(status) && status > 0) {
      whereParts.push(`es.computed_status = ${status}`)
    }
    if (manageableOnly && !isAdmin) {
      whereParts.push('e.creator_id = $1')
    }
    const combinedWhere = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

    const sql = `
      WITH exam_stat AS (
        SELECT
          e.id,
          CASE
            WHEN e.status = 3 THEN 3
            WHEN NOW() < e.start_time THEN 1
            WHEN NOW() >= e.start_time AND NOW() <= e.end_time THEN 2
            ELSE 3
          END AS computed_status,
          COALESCE((
            SELECT COUNT(DISTINCT cm.student_id)::int
            FROM exam_classes ec
            JOIN class_members cm ON cm.class_id = ec.class_id
            WHERE ec.exam_id = e.id
          ), 0) AS expected_count,
          COALESCE((
            SELECT COUNT(DISTINCT es.student_id)::int
            FROM exam_submissions es
            WHERE es.exam_id = e.id AND es.status IN (2, 3)
          ), 0) AS submitted_count
        FROM exams e
      ),
      ranked_base AS (
        SELECT
          e.id,
          e.title,
          e.subject_id,
          s.name AS subject_name,
          e.start_time,
          e.end_time,
          e.duration,
          e.description,
          e.creator_id,
          e.created_at,
          ${isAdmin ? 'TRUE' : 'e.creator_id = $1'} AS can_manage,
          es.computed_status AS status,
          es.expected_count,
          es.submitted_count,
          COALESCE((
            SELECT array_remove(array_agg(DISTINCT c.name), NULL)
            FROM exam_classes ec
            JOIN classes c ON c.id = ec.class_id
            WHERE ec.exam_id = e.id
          ), '{}') AS class_names
        FROM exams e
        JOIN subjects s ON s.id = e.subject_id
        JOIN exam_stat es ON es.id = e.id
        ${combinedWhere}
      ),
      tot AS (SELECT COUNT(*)::int AS c FROM ranked_base)
      SELECT rb.*, tot.c AS __total
      FROM ranked_base rb
      CROSS JOIN tot
      ORDER BY rb.created_at DESC, rb.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const { rows } = await pool.query(sql, values)
    const total = rows.length > 0 ? Number(rows[0].__total ?? 0) : 0
    const data = rows.map((row) => {
      const { __total, ...rest } = row
      return rest
    })
    return res.json({ data, pagination: { total, page, pageSize } })
  } catch (error) {
    return res.status(500).json({ message: '考试列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/exams/:id', authRequired, async (req, res) => {
  const examId = Number(req.params.id)
  if (Number.isNaN(examId)) return res.status(400).json({ message: '考试ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertExamReadAccess(client, examId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })

    const examResult = await client.query(
      `
      SELECT
        e.id,
        e.title,
        e.subject_id,
        s.name AS subject_name,
        e.start_time,
        e.end_time,
        e.duration,
        e.description,
        e.creator_id,
        e.created_at,
        CASE
          WHEN e.status = 3 THEN 3
          WHEN NOW() < e.start_time THEN 1
          WHEN NOW() >= e.start_time AND NOW() <= e.end_time THEN 2
          ELSE 3
        END AS status
      FROM exams e
      JOIN subjects s ON s.id = e.subject_id
      WHERE e.id = $1
      LIMIT 1
      `,
      [examId],
    )
    const examRow = examResult.rows[0]
    if (!examRow) return res.status(404).json({ message: '考试不存在' })
    const isAdmin = Array.isArray(req.auth?.roles) && req.auth.roles.includes('admin')
    const canManage = Boolean(isAdmin || Number(examRow.creator_id) === Number(req.auth?.userId))

    const classResult = await client.query(
      `
      SELECT c.id, c.name
      FROM exam_classes ec
      JOIN classes c ON c.id = ec.class_id
      WHERE ec.exam_id = $1
      ORDER BY c.id ASC
      `,
      [examId],
    )

    const questionResult = await client.query(
      `
      SELECT
        eq.question_id,
        eq.score,
        eq.sort_order,
        q.question_type,
        q.stem,
        q.difficulty
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id
      WHERE eq.exam_id = $1
      ORDER BY eq.sort_order ASC, eq.question_id ASC
      `,
      [examId],
    )

    const submissionResult = await client.query(
      `
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE es.status IN (2, 3)), 0)::int AS submitted_count,
        COALESCE(COUNT(*) FILTER (WHERE es.status IN (2, 3)), 0)::int AS reviewed_count
      FROM exam_submissions es
      WHERE es.exam_id = $1
      `,
      [examId],
    )

    const expectedResult = await client.query(
      `
      SELECT COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS expected_count
      FROM exam_classes ec
      JOIN class_members cm ON cm.class_id = ec.class_id
      WHERE ec.exam_id = $1
      `,
      [examId],
    )

    const studentDetailResult = await client.query(
      `
      SELECT
        s.id AS student_id,
        COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS student_name,
        NULLIF(TRIM(s.wechat_avatar_url), '') AS student_avatar_url,
        es.id AS submission_id,
        es.status AS submission_status,
        es.start_time AS submission_start_time,
        es.submit_time,
        es.total_score
      FROM exam_classes ec
      JOIN class_members cm ON cm.class_id = ec.class_id
      JOIN students s ON s.id = cm.student_id
      LEFT JOIN exam_submissions es ON es.exam_id = ec.exam_id AND es.student_id = s.id
      WHERE ec.exam_id = $1
      ORDER BY s.student_no ASC, s.id ASC
      `,
      [examId],
    )

    const classStatResult = await client.query(
      `
      SELECT
        c.id AS class_id,
        c.name AS class_name,
        COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS expected_count,
        COALESCE(COUNT(DISTINCT CASE WHEN es.status IN (2, 3) THEN s.id END), 0)::int AS submitted_count,
        COALESCE(COUNT(DISTINCT CASE WHEN es.total_score IS NOT NULL THEN s.id END), 0)::int AS scored_count,
        COALESCE(ROUND(AVG(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 2), 0)::numeric AS avg_score,
        COALESCE(MAX(es.total_score), 0)::numeric AS max_score,
        COALESCE(MIN(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 0)::numeric AS min_score
      FROM exam_classes ec
      JOIN classes c ON c.id = ec.class_id
      LEFT JOIN class_members cm ON cm.class_id = c.id
      LEFT JOIN students s ON s.id = cm.student_id
      LEFT JOIN exam_submissions es ON es.exam_id = ec.exam_id AND es.student_id = s.id
      WHERE ec.exam_id = $1
      GROUP BY c.id
      ORDER BY c.id ASC
      `,
      [examId],
    )

    return res.json({
      data: {
        ...examRow,
        can_manage: canManage,
        classes: classResult.rows,
        questions: questionResult.rows.map((item) => ({
          ...item,
          question_type_text: questionTypeLabelMap[item.question_type] || String(item.question_type),
          difficulty_text: difficultyTextFromDb(item.difficulty),
        })),
        expected_count: Number(expectedResult.rows[0]?.expected_count || 0),
        submitted_count: Number(submissionResult.rows[0]?.submitted_count || 0),
        reviewed_count: Number(submissionResult.rows[0]?.reviewed_count || 0),
        class_stats: classStatResult.rows.map((item) => ({
          ...item,
          avg_score: Number(item.avg_score || 0),
          max_score: Number(item.max_score || 0),
          min_score: Number(item.min_score || 0),
        })),
        student_submissions: studentDetailResult.rows.map((item) => ({
          ...item,
          submission_status_text:
            Number(item.submission_status) === 3 || Number(item.submission_status) === 2
              ? '已出分'
              : Number(item.submission_status) === 1
                ? '进行中'
                : '未作答',
        })),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '考试详情查询失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.put('/api/exams/:id', authRequired, async (req, res) => {
  const examId = Number(req.params.id)
  if (Number.isNaN(examId)) return res.status(400).json({ message: '考试ID不合法' })
  const title = String(req.body?.title || '').trim()
  const description = String(req.body?.description || '').trim()
  const subjectId = Number(req.body?.subjectId)
  const startTimeRaw = String(req.body?.startTime || '').trim()
  const endTimeRaw = String(req.body?.endTime || '').trim()
  const duration = Number(req.body?.duration || 0)
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id)) : []
  const questionItems = Array.isArray(req.body?.questionItems)
    ? req.body.questionItems
        .map((item) => ({
          questionId: Number(item?.questionId),
          score: Number(item?.score),
        }))
        .filter((item) => !Number.isNaN(item.questionId))
    : []
  const questionIds = questionItems.map((item) => item.questionId)
  if (!title || Number.isNaN(subjectId) || !startTimeRaw || !endTimeRaw || Number.isNaN(duration) || duration <= 0) {
    return res.status(400).json({ message: '考试基础信息不完整' })
  }
  if (classIds.length === 0) return res.status(400).json({ message: '至少选择一个班级' })
  if (questionIds.length === 0) return res.status(400).json({ message: '至少选择一道题目' })
  if (questionItems.some((item) => Number.isNaN(item.score) || item.score <= 0)) {
    return res.status(400).json({ message: '题目分值必须大于0' })
  }
  const startTime = new Date(startTimeRaw)
  const endTime = new Date(endTimeRaw)
  const now = new Date()
  if (!Number.isNaN(startTime.getTime()) && startTime < now) {
    return res.status(400).json({ message: '开始时间不能早于当前时间' })
  }
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    return res.status(400).json({ message: '考试时间范围不合法' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const examDefaults = await getExamDefaultConfig(client)
    const access = await assertExamManageAccess(client, examId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }
    const editableCheck = await client.query(
      `
      SELECT
        CASE
          WHEN e.status = 3 THEN 3
          WHEN NOW() < e.start_time THEN 1
          WHEN NOW() >= e.start_time AND NOW() <= e.end_time THEN 2
          ELSE 3
        END AS computed_status
      FROM exams e
      WHERE e.id = $1
      `,
      [examId],
    )
    const computedStatus = Number(editableCheck.rows[0]?.computed_status || 0)
    if (computedStatus !== 1) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '仅未开始考试允许编辑' })
    }

    const isAdmin = hasRole(req, 'admin')
    const isClassTeacher = hasRole(req, 'class_teacher')
    const isSubjectTeacher = hasRole(req, 'subject_teacher')
    if (!isAdmin && !isClassTeacher && !isSubjectTeacher) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '无权限编辑考试' })
    }
    for (const classId of classIds) {
      const classCheck = await client.query('SELECT id, owner_id FROM classes WHERE id = $1 LIMIT 1', [classId])
      if (classCheck.rowCount === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: `班级不存在(${classId})` })
      }
      if (!isAdmin && isClassTeacher && Number(classCheck.rows[0].owner_id) !== Number(req.auth.userId)) {
        await client.query('ROLLBACK')
        return res.status(403).json({ message: `班级(${classId})不属于当前班主任` })
      }
      if (!isAdmin && !isClassTeacher && isSubjectTeacher) {
        const memberCheck = await client.query(
          'SELECT 1 FROM class_teachers WHERE class_id = $1 AND teacher_id = $2 AND subject_id = $3 LIMIT 1',
          [classId, req.auth.userId, subjectId],
        )
        if (memberCheck.rowCount === 0) {
          await client.query('ROLLBACK')
          return res.status(403).json({ message: `你未加入班级(${classId})该科目，无法编辑考试` })
        }
      }
    }

    const uniqueQuestionIds = Array.from(new Set(questionIds))
    const questionCheck = await client.query(
      `
      SELECT id
      FROM questions
      WHERE id = ANY($1::bigint[]) AND subject_id = $2
      `,
      [uniqueQuestionIds, subjectId],
    )
    if (questionCheck.rowCount !== uniqueQuestionIds.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '所选题目中存在无效题目或跨科目题目' })
    }

    const dupTitle = await client.query(`SELECT id FROM exams WHERE trim(title) = $1 AND id <> $2 LIMIT 1`, [title, examId])
    if (dupTitle.rowCount > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '考试名称已存在，请更换名称' })
    }

    await client.query(
      `
      UPDATE exams
      SET
        title = $1,
        subject_id = $2,
        start_time = $3,
        end_time = $4,
        duration = $5,
        description = $6
      WHERE id = $7
      `,
      [title, subjectId, startTime.toISOString(), endTime.toISOString(), duration, description || null, examId],
    )

    await client.query('DELETE FROM exam_classes WHERE exam_id = $1', [examId])
    await client.query('DELETE FROM exam_questions WHERE exam_id = $1', [examId])

    for (const classId of Array.from(new Set(classIds))) {
      await client.query(
        `
        INSERT INTO exam_classes (exam_id, class_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [examId, classId],
      )
    }
    const questionScoreMap = new Map(questionItems.map((item) => [Number(item.questionId), Number(item.score)]))
    for (let index = 0; index < uniqueQuestionIds.length; index += 1) {
      const questionId = uniqueQuestionIds[index]
      const score = questionScoreMap.get(questionId) ?? examDefaults.defaultQuestionScore
      await client.query(
        `
        INSERT INTO exam_questions (exam_id, question_id, score, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        `,
        [examId, questionId, score, index + 1],
      )
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'exam.create',
      targetType: 'exam',
      targetId: String(examId),
      detail: { title, classCount: classIds.length, questionCount: uniqueQuestionIds.length },
    })

    await client.query('COMMIT')
    return res.json({ data: { id: examId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '编辑考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

const dashboardClassStatsSql = (accessSql) => `
      WITH visible_classes AS (
        SELECT c.id, c.name
        FROM classes c
        ${accessSql}
      ),
      class_students AS (
        SELECT vc.id AS class_id, COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS student_count
        FROM visible_classes vc
        LEFT JOIN class_members cm ON cm.class_id = vc.id
        GROUP BY vc.id
      ),
      class_exams AS (
        SELECT vc.id AS class_id, COALESCE(COUNT(DISTINCT ec.exam_id), 0)::int AS exam_count
        FROM visible_classes vc
        LEFT JOIN exam_classes ec ON ec.class_id = vc.id
        GROUP BY vc.id
      ),
      class_scores AS (
        SELECT
          vc.id AS class_id,
          COALESCE(COUNT(es.id), 0)::int AS submission_count,
          COALESCE(ROUND(AVG(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 2), 0)::numeric AS avg_score,
          COALESCE(MAX(es.total_score), 0)::numeric AS max_score,
          COALESCE(MIN(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 0)::numeric AS min_score
        FROM visible_classes vc
        LEFT JOIN exam_classes ec ON ec.class_id = vc.id
        LEFT JOIN exam_submissions es ON es.exam_id = ec.exam_id
        GROUP BY vc.id
      )
      SELECT
        vc.id AS class_id,
        vc.name AS class_name,
        cs.student_count,
        ce.exam_count,
        sc.submission_count,
        CASE
          WHEN (cs.student_count * ce.exam_count) > 0
            THEN ROUND((sc.submission_count::numeric / (cs.student_count * ce.exam_count)) * 100, 2)
          ELSE 0
        END AS submission_rate,
        sc.avg_score,
        sc.max_score,
        sc.min_score
      FROM visible_classes vc
      JOIN class_students cs ON cs.class_id = vc.id
      JOIN class_exams ce ON ce.class_id = vc.id
      JOIN class_scores sc ON sc.class_id = vc.id
      ORDER BY vc.id ASC
      `

const mapDashboardClassStatRows = (rows) =>
  rows.map((item) => ({
    ...item,
    submission_rate: Number(item.submission_rate || 0),
    avg_score: Number(item.avg_score || 0),
    max_score: Number(item.max_score || 0),
    min_score: Number(item.min_score || 0),
    submission_count: Number(item.submission_count || 0),
    student_count: Number(item.student_count || 0),
    exam_count: Number(item.exam_count || 0),
  }))

/** 概览顶部指标：与可见班级范围一致；题目总数为全库未删除题量 */
const buildDashboardOverviewMetrics = async (accessSql, values, classRows) => {
  const pendingSql = `
      WITH visible_classes AS (
        SELECT c.id FROM classes c
        ${accessSql}
      )
      SELECT COUNT(*)::int AS n
      FROM exam_submissions es
      JOIN exams e ON e.id = es.exam_id
      WHERE es.total_score IS NULL
        AND es.status = 2
        AND EXISTS (
          SELECT 1 FROM exam_classes ec
          INNER JOIN visible_classes vc ON vc.id = ec.class_id
          WHERE ec.exam_id = e.id
        )
    `
  const ongoingSql = `
      WITH visible_classes AS (
        SELECT c.id FROM classes c
        ${accessSql}
      )
      SELECT COUNT(DISTINCT e.id)::int AS n
      FROM exams e
      INNER JOIN exam_classes ec ON ec.exam_id = e.id
      INNER JOIN visible_classes vc ON vc.id = ec.class_id
      WHERE NOW() >= e.start_time AND NOW() <= e.end_time
    `
  const [pendingResult, ongoingResult, questionResult] = await Promise.all([
    pool.query(pendingSql, values),
    pool.query(ongoingSql, values),
    pool.query(`SELECT COUNT(*)::int AS n FROM questions WHERE deleted_at IS NULL`),
  ])
  let denom = 0
  let num = 0
  let studentMembers = 0
  for (const r of classRows) {
    const w = r.student_count * r.exam_count
    denom += w
    num += r.submission_count
    studentMembers += r.student_count
  }
  const weightedSubmissionRate = denom > 0 ? Math.round((num / denom) * 10000) / 100 : 0
  return {
    class_count: classRows.length,
    student_members_total: studentMembers,
    weighted_submission_rate: weightedSubmissionRate,
    question_total: Number(questionResult.rows[0]?.n || 0),
    pending_grade_count: Number(pendingResult.rows[0]?.n || 0),
    ongoing_exam_count: Number(ongoingResult.rows[0]?.n || 0),
  }
}

app.get('/api/dashboard/class-stats', authRequired, async (req, res) => {
  try {
    const { accessSql, values } = buildVisibleClassesAccessSql(req)
    const { rows } = await pool.query(dashboardClassStatsSql(accessSql), values)
    const data = mapDashboardClassStatRows(rows)
    const withOverview = String(req.query?.withOverview || req.query?.overview || '') === '1'
    if (withOverview) {
      const overview_metrics = await buildDashboardOverviewMetrics(accessSql, values, data)
      return res.json({ data, overview_metrics })
    }
    return res.json({ data })
  } catch (error) {
    return res.status(500).json({ message: '班级维度统计查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 教师端：指定班级的刷题排行榜（口径与小程序 practice-class-rank 一致） */
app.get('/api/dashboard/practice-class-rank', authRequired, async (req, res) => {
  const period = String(req.query.period || 'today').toLowerCase()
  const classId = Number(req.query.classId ?? req.query.class_id)
  if (!['today', 'week', 'month', 'all'].includes(period)) {
    return res.status(400).json({ message: 'period 仅支持 today、week、month、all' })
  }
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ message: 'classId 不合法' })
  }
  try {
    const { accessSql, values } = buildVisibleClassesAccessSql(req)
    const checkValues = [...values, classId]
    const classIdPh = `$${checkValues.length}`
    const classWhere = accessSql ? `${accessSql} AND c.id = ${classIdPh}` : `WHERE c.id = ${classIdPh}`
    const classResult = await pool.query(
      `SELECT c.id, c.name FROM classes c ${classWhere} LIMIT 1`,
      checkValues,
    )
    const classRow = classResult.rows[0]
    if (!classRow) {
      return res.status(404).json({ message: '班级不存在或无权查看' })
    }
    const membersResult = await pool.query(
      `SELECT student_id FROM class_members WHERE class_id = $1`,
      [classId],
    )
    const peerIds = membersResult.rows
      .map((row) => Number(row.student_id))
      .filter((id) => Number.isInteger(id) && id > 0)
    const { rows } = await buildPracticeClassRankRows(pool, peerIds, period)
    const activeCount = rows.length
    const totalPracticeQuestions = rows.reduce((sum, row) => sum + Number(row.practice_questions || 0), 0)
    return res.json({
      data: {
        period,
        class_id: Number(classRow.id),
        class_name: String(classRow.name || ''),
        student_count: peerIds.length,
        active_count: activeCount,
        total_practice_questions: totalPracticeQuestions,
        rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载班级刷题排行失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 教师端：班级学生小程序在线时长（切出即断开） */
app.get('/api/dashboard/student-online-stats', authRequired, async (req, res) => {
  const period = String(req.query.period || 'today').toLowerCase()
  const classId = Number(req.query.classId ?? req.query.class_id)
  if (!['today', 'week', 'month', 'all'].includes(period)) {
    return res.status(400).json({ message: 'period 仅支持 today、week、month、all' })
  }
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ message: 'classId 不合法' })
  }
  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await closeStaleStudentOnlineSessions(client)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    const { accessSql, values } = buildVisibleClassesAccessSql(req)
    const checkValues = [...values, classId]
    const classIdPh = `$${checkValues.length}`
    const classWhere = accessSql ? `${accessSql} AND c.id = ${classIdPh}` : `WHERE c.id = ${classIdPh}`
    const classResult = await pool.query(
      `SELECT c.id, c.name FROM classes c ${classWhere} LIMIT 1`,
      checkValues,
    )
    const classRow = classResult.rows[0]
    if (!classRow) {
      return res.status(404).json({ message: '班级不存在或无权查看' })
    }

    const dayStr = parseShanghaiCalendarDateInput(req.query.date)
    const todayR = await pool.query(`SELECT (timezone('Asia/Shanghai', now()))::date::text AS d`)
    const todayStr = String(todayR.rows[0]?.d || '')
    const statsResult = await queryClassOnlineStatsRows(pool, classId, { period, dayStr })

    const membersResult = await pool.query(`SELECT student_id FROM class_members WHERE class_id = $1`, [classId])
    const peerIds = membersResult.rows
      .map((row) => Number(row.student_id))
      .filter((id) => Number.isInteger(id) && id > 0)
    const practiceAgg = await loadPracticePeerAggregatesForPeriod(pool, peerIds, period, dayStr)
    const practiceActiveIds = new Set(
      practiceAgg.rows
        .filter((row) => Number(row.total_attempts || 0) > 0)
        .map((row) => Number(row.student_id)),
    )

    const dailyResult = await pool.query(
      `
      SELECT
        sod.online_date::text AS day,
        COALESCE(SUM(sod.total_seconds), 0)::int AS total_seconds
      FROM student_online_day sod
      INNER JOIN class_members cm ON cm.student_id = sod.student_id AND cm.class_id = $1
      WHERE sod.online_date >= ((timezone('Asia/Shanghai', now()))::date - 13)
        AND sod.online_date < (timezone('Asia/Shanghai', now()))::date
      GROUP BY sod.online_date
      ORDER BY sod.online_date ASC
      `,
      [classId],
    )
    const todayLiveTotal = await queryClassDayOnlineLiveTotal(pool, classId, todayStr)
    const dailyMap = new Map(dailyResult.rows.map((row) => [String(row.day), Number(row.total_seconds || 0)]))
    if (todayLiveTotal > 0 || dailyMap.has(todayStr)) {
      dailyMap.set(todayStr, todayLiveTotal)
    }
    const dailyTotals = Array.from(dailyMap.entries())
      .map(([day, total_seconds]) => ({ day, total_seconds }))
      .sort((a, b) => (a.day < b.day ? -1 : 1))

    const rows = statsResult.rows.map((row, index) => ({
      rank: index + 1,
      student_id: Number(row.student_id),
      name: String(row.display_name || '').trim() || '同学',
      student_no: String(row.student_no || '').trim(),
      total_seconds: Number(row.total_seconds || 0),
      session_count: Number(row.session_count || 0),
    }))
    const classTotalSeconds = rows.reduce((sum, row) => sum + row.total_seconds, 0)
    const onlineActiveCount = rows.filter((row) => row.total_seconds > 0).length
    const activeCount = rows.filter(
      (row) => row.total_seconds > 0 || practiceActiveIds.has(row.student_id),
    ).length

    return res.json({
      data: {
        period,
        stats_date: dayStr || null,
        class_id: Number(classRow.id),
        class_name: String(classRow.name || ''),
        student_count: rows.length,
        active_count: activeCount,
        online_active_count: onlineActiveCount,
        practice_active_count: practiceActiveIds.size,
        class_total_seconds: classTotalSeconds,
        rows,
        daily_totals: dailyTotals,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载在线时长统计失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 将某日上海日历 00:00 转为 UTC 时刻（用于与 timestamptz 比较） */
const shanghaiDayStartParam = (dayStr) => `${dayStr}T00:00:00+08:00`

const sessionEffectiveEndMs = (row, nowMs, dayCapEndMs) => {
  if (row.ended_at) {
    const endedMs = new Date(row.ended_at).getTime()
    const hbMs = row.last_heartbeat_at
      ? new Date(row.last_heartbeat_at).getTime()
      : new Date(row.started_at).getTime()
    const cappedMs = Math.min(endedMs, hbMs + ONLINE_HEARTBEAT_TAIL_SECONDS * 1000)
    return Math.min(cappedMs, dayCapEndMs)
  }
  const startedMs = new Date(row.started_at).getTime()
  const hbMs = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : startedMs
  if (nowMs - hbMs > ONLINE_HEARTBEAT_STALE_SECONDS * 1000) {
    return Math.min(hbMs + ONLINE_HEARTBEAT_TAIL_SECONDS * 1000, dayCapEndMs)
  }
  return Math.min(nowMs, dayCapEndMs)
}

const sessionIsActivelyOpen = (row, nowMs) => {
  if (row.ended_at) return false
  const hbMs = row.last_heartbeat_at
    ? new Date(row.last_heartbeat_at).getTime()
    : new Date(row.started_at).getTime()
  return nowMs - hbMs <= ONLINE_HEARTBEAT_STALE_SECONDS * 1000
}

const buildStudentOnlineTimelinePayload = (sessionRows, dayStr, isToday, now = new Date()) => {
  const dayStartMs = Date.parse(shanghaiDayStartParam(dayStr))
  const dayEndExclusiveMs = dayStartMs + 86400000
  const dayEndMs = dayEndExclusiveMs - 1
  const nowMs = now.getTime()
  const dayCapEndMs = isToday ? Math.min(nowMs, dayEndMs) : dayEndMs

  const emptyPayload = () => ({
    date: dayStr,
    is_today: isToday,
    range_start: null,
    range_end: null,
    first_online_at: null,
    last_offline_at: null,
    is_still_online: false,
    span_seconds: 0,
    online_seconds: 0,
    sessions: [],
    segments: [],
    events: [],
  })

  if (!Number.isFinite(dayStartMs)) return emptyPayload()

  const clipped = []
  for (const row of sessionRows || []) {
    const startedMs = new Date(row.started_at).getTime()
    const endedMs = sessionEffectiveEndMs(row, nowMs, dayCapEndMs)
    let clipStartMs
    if (row.ended_at) {
      clipStartMs = Math.max(startedMs, dayStartMs)
    } else if (startedMs >= dayStartMs) {
      clipStartMs = startedMs
    } else {
      const hbMs = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : startedMs
      if (hbMs < dayStartMs) continue
      clipStartMs = Math.max(dayStartMs, hbMs - ONLINE_HEARTBEAT_TAIL_SECONDS * 1000)
    }
    const clipEndMs = Math.min(endedMs, dayCapEndMs)
    if (clipEndMs <= clipStartMs) continue
    clipped.push({
      id: Number(row.id),
      started_at: row.started_at,
      ended_at: row.ended_at,
      is_open: sessionIsActivelyOpen(row, nowMs),
      duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
      clip_start: new Date(clipStartMs).toISOString(),
      clip_end: new Date(clipEndMs).toISOString(),
    })
  }
  clipped.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())

  const mergeGapMs = ONLINE_SESSION_TIMELINE_MERGE_GAP_SECONDS * 1000
  const merged = []
  for (const sess of clipped) {
    const prev = merged[merged.length - 1]
    const gapMs = prev
      ? new Date(sess.clip_start).getTime() - new Date(prev.clip_end).getTime()
      : Infinity
    if (prev && gapMs >= 0 && gapMs <= mergeGapMs) {
      prev.clip_end = sess.clip_end
      prev.ended_at = sess.ended_at
      prev.is_open = sess.is_open
      if (sess.is_open) prev.ended_at = null
    } else {
      merged.push({ ...sess })
    }
  }

  if (merged.length === 0) return emptyPayload()

  const rangeStartMs = new Date(merged[0].clip_start).getTime()
  const lastSess = merged[merged.length - 1]
  const isStillOnline = Boolean(lastSess.is_open && isToday)
  const lastClipEndMs = new Date(lastSess.clip_end).getTime()
  const lastOfflineMs = lastSess.ended_at
    ? new Date(lastSess.ended_at).getTime()
    : isStillOnline
      ? nowMs
      : lastClipEndMs
  const rangeEndMs = Math.max(lastOfflineMs, lastClipEndMs, rangeStartMs + 1)

  const segments = []
  let cursor = rangeStartMs
  for (const sess of merged) {
    const s = Math.max(new Date(sess.clip_start).getTime(), rangeStartMs)
    const e = Math.min(new Date(sess.clip_end).getTime(), rangeEndMs)
    if (e <= s) continue
    if (s > cursor) {
      segments.push({
        type: 'offline',
        start: new Date(cursor).toISOString(),
        end: new Date(s).toISOString(),
      })
    }
    segments.push({
      type: 'online',
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      session_id: sess.id,
    })
    cursor = e
  }
  if (cursor < rangeEndMs) {
    segments.push({
      type: 'offline',
      start: new Date(cursor).toISOString(),
      end: new Date(rangeEndMs).toISOString(),
    })
  }

  let onlineSeconds = 0
  for (const seg of segments) {
    if (seg.type !== 'online') continue
    onlineSeconds += Math.max(
      0,
      Math.round((new Date(seg.end).getTime() - new Date(seg.start).getTime()) / 1000),
    )
  }

  const events = []
  for (const sess of merged) {
    const clipStartMs = new Date(sess.clip_start).getTime()
    const startedMs = new Date(sess.started_at).getTime()
    const onlineAtMs = startedMs >= dayStartMs && startedMs <= rangeEndMs ? startedMs : clipStartMs
    if (onlineAtMs >= rangeStartMs && onlineAtMs <= rangeEndMs) {
      events.push({
        kind: 'online',
        at: new Date(onlineAtMs).toISOString(),
        label:
          startedMs < dayStartMs
            ? '上线（续）'
            : sess.is_open && isToday
              ? '上线（进行中）'
              : '上线',
      })
    }
    if (sess.ended_at) {
      const rawEndMs = new Date(sess.ended_at).getTime()
      const clipEndMs = new Date(sess.clip_end).getTime()
      const offlineAtMs = Math.min(rawEndMs, clipEndMs)
      if (offlineAtMs >= rangeStartMs && offlineAtMs <= rangeEndMs) {
        events.push({ kind: 'offline', at: new Date(offlineAtMs).toISOString(), label: '切出' })
      }
    }
  }
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return {
    date: dayStr,
    is_today: isToday,
    range_start: new Date(rangeStartMs).toISOString(),
    range_end: new Date(rangeEndMs).toISOString(),
    first_online_at: new Date(rangeStartMs).toISOString(),
    last_offline_at: lastSess.ended_at || null,
    is_still_online: isStillOnline,
    span_seconds: Math.max(0, Math.round((rangeEndMs - rangeStartMs) / 1000)),
    online_seconds: onlineSeconds,
    sessions: merged,
    segments,
    events,
  }
}

/** 教师端：学生某日在线时间轴（绿=在线，红=离线，标注上下线时刻） */
app.get('/api/dashboard/student-online-timeline', authRequired, async (req, res) => {
  const classId = Number(req.query.classId ?? req.query.class_id)
  const studentId = Number(req.query.studentId ?? req.query.student_id)
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ message: 'classId 不合法' })
  }
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return res.status(400).json({ message: 'studentId 不合法' })
  }
  try {
    const todayR = await pool.query(`SELECT (timezone('Asia/Shanghai', now()))::date::text AS d`)
    const todayStr = String(todayR.rows[0]?.d || '')
    let dayStr = parseShanghaiCalendarDateInput(req.query.date) || todayStr
    const isToday = dayStr === todayStr

    const janitorClient = await pool.connect()
    try {
      await janitorClient.query('BEGIN')
      await closeStaleStudentOnlineSessions(janitorClient)
      await janitorClient.query('COMMIT')
    } catch (staleErr) {
      await janitorClient.query('ROLLBACK')
      throw staleErr
    } finally {
      janitorClient.release()
    }

    const { accessSql, values } = buildVisibleClassesAccessSql(req)
    const checkValues = [...values, classId]
    const classIdPh = `$${checkValues.length}`
    const classWhere = accessSql ? `${accessSql} AND c.id = ${classIdPh}` : `WHERE c.id = ${classIdPh}`
    const classResult = await pool.query(
      `SELECT c.id, c.name FROM classes c ${classWhere} LIMIT 1`,
      checkValues,
    )
    if (!classResult.rows[0]) {
      return res.status(404).json({ message: '班级不存在或无权查看' })
    }

    const mem = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 LIMIT 1`,
      [classId, studentId],
    )
    if (!mem.rows[0]) {
      return res.status(404).json({ message: '该学生不在当前班级中' })
    }

    const studentR = await pool.query(
      `
      SELECT id, COALESCE(NULLIF(TRIM(real_name), ''), name) AS display_name
      FROM students WHERE id = $1 LIMIT 1
      `,
      [studentId],
    )
    const studentRow = studentR.rows[0]
    if (!studentRow) {
      return res.status(404).json({ message: '学生不存在' })
    }

    const dayStart = shanghaiDayStartParam(dayStr)
    const dayEndExclusive = `${dayStr}T24:00:00+08:00`
    const sessionsR = await pool.query(
      `
      SELECT id, started_at, ended_at, duration_seconds, last_heartbeat_at
      FROM student_online_sessions
      WHERE student_id = $1
        AND started_at < $3::timestamptz
        AND (ended_at IS NULL OR ended_at > $2::timestamptz)
      ORDER BY started_at ASC
      `,
      [studentId, dayStart, dayEndExclusive],
    )

    const timeline = buildStudentOnlineTimelinePayload(sessionsR.rows, dayStr, isToday)
    return res.json({
      data: {
        class_id: classId,
        class_name: String(classResult.rows[0].name || ''),
        student_id: studentId,
        student_name: String(studentRow.display_name || '').trim() || '同学',
        ...timeline,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载在线时间轴失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

/** 兼容旧前端；新前端请用 GET /api/dashboard/class-stats?withOverview=1 */
app.get('/api/dashboard/overview', authRequired, async (req, res) => {
  try {
    const { accessSql, values } = buildVisibleClassesAccessSql(req)
    const { rows } = await pool.query(dashboardClassStatsSql(accessSql), values)
    const class_stats = mapDashboardClassStatRows(rows)
    const metrics = await buildDashboardOverviewMetrics(accessSql, values, class_stats)
    return res.json({ data: { metrics, class_stats } })
  } catch (error) {
    return res.status(500).json({ message: '概览数据查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/analytics/class-performance', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const requestedClassId = Number(req.query?.classId)
    const subjectId = Number(req.query?.subjectId)
    const startTimeRaw = String(req.query?.startTime || '').trim()
    const endTimeRaw = String(req.query?.endTime || '').trim()
    const passLineInput = Number(req.query?.passLine)
    const excellentLineInput = Number(req.query?.excellentLine)
    const trendLimitInput = Number(req.query?.trendLimit)
    const passLine = Number.isNaN(passLineInput) ? 60 : Math.max(passLineInput, 0)
    const excellentLine = Number.isNaN(excellentLineInput) ? 85 : Math.max(excellentLineInput, 0)
    const trendLimit = Number.isNaN(trendLimitInput) ? 8 : Math.min(Math.max(trendLimitInput, 3), 20)
    const hasClassFilter = !Number.isNaN(requestedClassId) && requestedClassId > 0
    const hasSubjectFilter = !Number.isNaN(subjectId) && subjectId > 0
    const hasStartTime = Boolean(startTimeRaw)
    const hasEndTime = Boolean(endTimeRaw)

    const { accessSql, values } = buildVisibleClassesAccessSql(req)

    const classFilterPlaceholder = `$${values.length + 1}`
    const classCondition = hasClassFilter ? `AND vc.id = ${classFilterPlaceholder}` : ''
    if (hasClassFilter) values.push(requestedClassId)
    const subjectFilterPlaceholder = `$${values.length + 1}`
    const subjectCondition = hasSubjectFilter ? `AND e.subject_id = ${subjectFilterPlaceholder}` : ''
    if (hasSubjectFilter) values.push(subjectId)
    const startTimePlaceholder = `$${values.length + 1}`
    const startTimeCondition = hasStartTime ? `AND e.start_time >= ${startTimePlaceholder}::timestamptz` : ''
    if (hasStartTime) values.push(startTimeRaw)
    const endTimePlaceholder = `$${values.length + 1}`
    const endTimeCondition = hasEndTime ? `AND e.end_time <= ${endTimePlaceholder}::timestamptz` : ''
    if (hasEndTime) values.push(endTimeRaw)

    const summaryResult = await pool.query(
      `
      WITH visible_classes AS (
        SELECT c.id, c.name
        FROM classes c
        ${accessSql}
      ),
      filtered_exams AS (
        SELECT DISTINCT
          vc.id AS class_id,
          vc.name AS class_name,
          e.id AS exam_id,
          e.title AS exam_title,
          e.start_time,
          e.end_time,
          e.subject_id,
          s.name AS subject_name
        FROM visible_classes vc
        JOIN exam_classes ec ON ec.class_id = vc.id
        JOIN exams e ON e.id = ec.exam_id
        JOIN subjects s ON s.id = e.subject_id
        WHERE 1 = 1
          ${classCondition}
          ${subjectCondition}
          ${startTimeCondition}
          ${endTimeCondition}
      ),
      class_base AS (
        SELECT
          vc.id AS class_id,
          vc.name AS class_name,
          COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS student_count
        FROM visible_classes vc
        LEFT JOIN class_members cm ON cm.class_id = vc.id
        ${hasClassFilter ? `WHERE vc.id = ${classFilterPlaceholder}` : ''}
        GROUP BY vc.id, vc.name
      ),
      class_score AS (
        SELECT
          fe.class_id,
          COALESCE(COUNT(DISTINCT fe.exam_id), 0)::int AS exam_count,
          COALESCE(COUNT(es.id) FILTER (WHERE es.total_score IS NOT NULL), 0)::int AS scored_count,
          COALESCE(ROUND(AVG(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 2), 0)::numeric AS avg_score,
          COALESCE(MAX(es.total_score), 0)::numeric AS max_score,
          COALESCE(MIN(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 0)::numeric AS min_score,
          COALESCE(COUNT(es.id) FILTER (WHERE es.total_score IS NOT NULL AND es.total_score >= $${values.length + 1}), 0)::int AS pass_count,
          COALESCE(COUNT(es.id) FILTER (WHERE es.total_score IS NOT NULL AND es.total_score >= $${values.length + 2}), 0)::int AS excellent_count
        FROM filtered_exams fe
        LEFT JOIN class_members cm ON cm.class_id = fe.class_id
        LEFT JOIN exam_submissions es ON es.exam_id = fe.exam_id AND es.student_id = cm.student_id
        GROUP BY fe.class_id
      )
      SELECT
        cb.class_id,
        cb.class_name,
        cb.student_count,
        COALESCE(cs.exam_count, 0)::int AS exam_count,
        COALESCE(cs.scored_count, 0)::int AS scored_count,
        COALESCE(cs.avg_score, 0)::numeric AS avg_score,
        COALESCE(cs.max_score, 0)::numeric AS max_score,
        COALESCE(cs.min_score, 0)::numeric AS min_score,
        CASE WHEN COALESCE(cs.scored_count, 0) > 0 THEN ROUND((cs.pass_count::numeric / cs.scored_count) * 100, 2) ELSE 0 END AS pass_rate,
        CASE WHEN COALESCE(cs.scored_count, 0) > 0 THEN ROUND((cs.excellent_count::numeric / cs.scored_count) * 100, 2) ELSE 0 END AS excellent_rate
      FROM class_base cb
      LEFT JOIN class_score cs ON cs.class_id = cb.class_id
      ORDER BY cb.class_id ASC
      `,
      [...values, passLine, excellentLine],
    )

    const classOptions = summaryResult.rows.map((item) => ({
      class_id: Number(item.class_id),
      class_name: String(item.class_name || ''),
    }))
    const selectedClassId = hasClassFilter ? requestedClassId : Number(classOptions[0]?.class_id || 0)
    const trendParams = [...values, selectedClassId, trendLimit]
    const trendResult = await pool.query(
      `
      WITH visible_classes AS (
        SELECT c.id, c.name
        FROM classes c
        ${accessSql}
      ),
      filtered_exams AS (
        SELECT DISTINCT
          vc.id AS class_id,
          vc.name AS class_name,
          e.id AS exam_id,
          e.title AS exam_title,
          e.start_time,
          e.end_time,
          e.subject_id,
          s.name AS subject_name
        FROM visible_classes vc
        JOIN exam_classes ec ON ec.class_id = vc.id
        JOIN exams e ON e.id = ec.exam_id
        JOIN subjects s ON s.id = e.subject_id
        WHERE 1 = 1
          ${classCondition}
          ${subjectCondition}
          ${startTimeCondition}
          ${endTimeCondition}
      ),
      exam_scores AS (
        SELECT
          fe.class_id,
          fe.class_name,
          fe.exam_id,
          fe.exam_title,
          fe.start_time,
          COALESCE(COUNT(es.id) FILTER (WHERE es.total_score IS NOT NULL), 0)::int AS scored_count,
          COALESCE(ROUND(AVG(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 2), 0)::numeric AS avg_score
        FROM filtered_exams fe
        LEFT JOIN class_members cm ON cm.class_id = fe.class_id
        LEFT JOIN exam_submissions es ON es.exam_id = fe.exam_id AND es.student_id = cm.student_id
        GROUP BY fe.class_id, fe.class_name, fe.exam_id, fe.exam_title, fe.start_time
      )
      SELECT
        class_id,
        class_name,
        exam_id,
        exam_title,
        start_time,
        scored_count,
        avg_score
      FROM exam_scores
      WHERE class_id = $${values.length + 1}
      ORDER BY start_time DESC
      LIMIT $${values.length + 2}
      `,
      trendParams,
    )

    return res.json({
      data: {
        class_options: classOptions,
        selected_class_id: selectedClassId || null,
        summary_rows: summaryResult.rows.map((item) => ({
          ...item,
          avg_score: Number(item.avg_score || 0),
          max_score: Number(item.max_score || 0),
          min_score: Number(item.min_score || 0),
          pass_rate: Number(item.pass_rate || 0),
          excellent_rate: Number(item.excellent_rate || 0),
        })),
        trend_rows: trendResult.rows
          .map((item) => ({
            ...item,
            scored_count: Number(item.scored_count || 0),
            avg_score: Number(item.avg_score || 0),
          }))
          .reverse(),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '班级成绩分析查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/analytics/exam-quality-overview', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const requestedClassId = Number(req.query?.classId)
    const subjectId = Number(req.query?.subjectId)
    const startTimeRaw = String(req.query?.startTime || '').trim()
    const endTimeRaw = String(req.query?.endTime || '').trim()
    const hasClassFilter = !Number.isNaN(requestedClassId) && requestedClassId > 0
    const hasSubjectFilter = !Number.isNaN(subjectId) && subjectId > 0
    const hasStartTime = Boolean(startTimeRaw)
    const hasEndTime = Boolean(endTimeRaw)

    const { accessSql, values } = buildVisibleClassesAccessSql(req)

    const classFilterPlaceholder = `$${values.length + 1}`
    const classCondition = hasClassFilter ? `AND vc.id = ${classFilterPlaceholder}` : ''
    if (hasClassFilter) values.push(requestedClassId)
    const subjectFilterPlaceholder = `$${values.length + 1}`
    const subjectCondition = hasSubjectFilter ? `AND e.subject_id = ${subjectFilterPlaceholder}` : ''
    if (hasSubjectFilter) values.push(subjectId)
    const startTimePlaceholder = `$${values.length + 1}`
    const startTimeCondition = hasStartTime ? `AND e.start_time >= ${startTimePlaceholder}::timestamptz` : ''
    if (hasStartTime) values.push(startTimeRaw)
    const endTimePlaceholder = `$${values.length + 1}`
    const endTimeCondition = hasEndTime ? `AND e.end_time <= ${endTimePlaceholder}::timestamptz` : ''
    if (hasEndTime) values.push(endTimeRaw)

    const { rows } = await pool.query(
      `
      WITH visible_classes AS (
        SELECT c.id
        FROM classes c
        ${accessSql}
      ),
      visible_exams AS (
        SELECT DISTINCT
          e.id AS exam_id,
          e.title AS exam_title,
          e.subject_id,
          s.name AS subject_name,
          e.start_time,
          e.end_time
        FROM exams e
        JOIN subjects s ON s.id = e.subject_id
        JOIN exam_classes ec ON ec.exam_id = e.id
        JOIN visible_classes vc ON vc.id = ec.class_id
        WHERE 1 = 1
          ${classCondition}
          ${subjectCondition}
          ${startTimeCondition}
          ${endTimeCondition}
      ),
      expected AS (
        SELECT
          ve.exam_id,
          COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS expected_count
        FROM visible_exams ve
        JOIN exam_classes ec ON ec.exam_id = ve.exam_id
        LEFT JOIN class_members cm ON cm.class_id = ec.class_id
        GROUP BY ve.exam_id
      ),
      scored AS (
        SELECT
          ve.exam_id,
          COALESCE(COUNT(DISTINCT es.student_id) FILTER (WHERE es.status IN (2, 3)), 0)::int AS submitted_count,
          COALESCE(COUNT(DISTINCT es.student_id) FILTER (WHERE es.total_score IS NOT NULL), 0)::int AS scored_count,
          COALESCE(ROUND(AVG(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 2), 0)::numeric AS avg_score,
          COALESCE(ROUND(STDDEV_POP(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 2), 0)::numeric AS score_stddev,
          COALESCE(COUNT(*) FILTER (WHERE es.total_score IS NOT NULL AND es.total_score >= 60), 0)::int AS pass_count,
          COALESCE(COUNT(*) FILTER (WHERE es.total_score IS NOT NULL AND es.total_score >= 85), 0)::int AS excellent_count
        FROM visible_exams ve
        LEFT JOIN exam_submissions es ON es.exam_id = ve.exam_id
        GROUP BY ve.exam_id
      )
      SELECT
        ve.exam_id,
        ve.exam_title,
        ve.subject_id,
        ve.subject_name,
        ve.start_time,
        ve.end_time,
        ex.expected_count,
        sc.submitted_count,
        sc.scored_count,
        sc.avg_score,
        sc.score_stddev,
        CASE WHEN ex.expected_count > 0 THEN ROUND(((ex.expected_count - sc.submitted_count)::numeric / ex.expected_count) * 100, 2) ELSE 0 END AS absence_rate,
        CASE WHEN sc.scored_count > 0 THEN ROUND((sc.pass_count::numeric / sc.scored_count) * 100, 2) ELSE 0 END AS pass_rate,
        CASE WHEN sc.scored_count > 0 THEN ROUND((sc.excellent_count::numeric / sc.scored_count) * 100, 2) ELSE 0 END AS excellent_rate
      FROM visible_exams ve
      JOIN expected ex ON ex.exam_id = ve.exam_id
      JOIN scored sc ON sc.exam_id = ve.exam_id
      ORDER BY ve.start_time DESC, ve.exam_id DESC
      `,
      values,
    )

    const dataRows = rows.map((item) => ({
      ...item,
      expected_count: Number(item.expected_count || 0),
      submitted_count: Number(item.submitted_count || 0),
      scored_count: Number(item.scored_count || 0),
      avg_score: Number(item.avg_score || 0),
      score_stddev: Number(item.score_stddev || 0),
      absence_rate: Number(item.absence_rate || 0),
      pass_rate: Number(item.pass_rate || 0),
      excellent_rate: Number(item.excellent_rate || 0),
    }))
    const summary = {
      exam_count: dataRows.length,
      expected_count: dataRows.reduce((sum, item) => sum + item.expected_count, 0),
      submitted_count: dataRows.reduce((sum, item) => sum + item.submitted_count, 0),
      avg_score:
        dataRows.length > 0 ? Number((dataRows.reduce((sum, item) => sum + item.avg_score, 0) / dataRows.length).toFixed(2)) : 0,
      pass_rate:
        dataRows.length > 0 ? Number((dataRows.reduce((sum, item) => sum + item.pass_rate, 0) / dataRows.length).toFixed(2)) : 0,
      excellent_rate:
        dataRows.length > 0 ? Number((dataRows.reduce((sum, item) => sum + item.excellent_rate, 0) / dataRows.length).toFixed(2)) : 0,
    }

    return res.json({ data: { summary, rows: dataRows } })
  } catch (error) {
    return res.status(500).json({ message: '考试质量分析查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/analytics/exam-item-quality', authRequired, async (req, res) => {
  const examId = Number(req.query?.examId)
  if (Number.isNaN(examId) || examId <= 0) {
    return res.status(400).json({ message: 'examId 必填' })
  }
  const client = await pool.connect()
  try {
    const access = await assertExamReadAccess(client, examId, req.auth)
    if (!access.ok) {
      return res.status(access.code).json({ message: access.message })
    }

    const examMetaResult = await client.query(
      `
      SELECT e.id, e.title, e.subject_id, s.name AS subject_name
      FROM exams e
      JOIN subjects s ON s.id = e.subject_id
      WHERE e.id = $1
      LIMIT 1
      `,
      [examId],
    )
    if (examMetaResult.rowCount === 0) return res.status(404).json({ message: '考试不存在' })

    const itemResult = await client.query(
      `
      WITH base_submissions AS (
        SELECT es.id AS submission_id, es.total_score
        FROM exam_submissions es
        WHERE es.exam_id = $1 AND es.total_score IS NOT NULL
      ),
      ranked_submissions AS (
        SELECT
          bs.submission_id,
          bs.total_score,
          ROW_NUMBER() OVER (ORDER BY bs.total_score DESC, bs.submission_id DESC) AS rank_no,
          COUNT(*) OVER () AS total_count
        FROM base_submissions bs
      ),
      grouped_submissions AS (
        SELECT
          rs.*,
          GREATEST(1, CEIL(rs.total_count * 0.27))::int AS group_size
        FROM ranked_submissions rs
      ),
      submission_group AS (
        SELECT
          gs.submission_id,
          CASE
            WHEN gs.rank_no <= gs.group_size THEN 'high'
            WHEN gs.rank_no > gs.total_count - gs.group_size THEN 'low'
            ELSE 'mid'
          END AS score_group
        FROM grouped_submissions gs
      ),
      item_base AS (
        SELECT
          eq.question_id,
          q.stem,
          q.question_type,
          q.difficulty,
          a.is_correct,
          sg.score_group
        FROM exam_questions eq
        JOIN questions q ON q.id = eq.question_id
        LEFT JOIN answers a ON a.question_id = eq.question_id AND a.submission_id IN (SELECT submission_id FROM base_submissions)
        LEFT JOIN submission_group sg ON sg.submission_id = a.submission_id
        WHERE eq.exam_id = $1
      )
      SELECT
        ib.question_id,
        MAX(ib.stem) AS stem,
        MAX(ib.question_type) AS question_type,
        MAX(ib.difficulty) AS difficulty,
        COALESCE(COUNT(*) FILTER (WHERE ib.is_correct IS NOT NULL), 0)::int AS attempt_count,
        COALESCE(COUNT(*) FILTER (WHERE ib.is_correct = TRUE), 0)::int AS correct_count,
        COALESCE(ROUND((COUNT(*) FILTER (WHERE ib.is_correct = TRUE)::numeric / NULLIF(COUNT(*) FILTER (WHERE ib.is_correct IS NOT NULL), 0)) * 100, 2), 0)::numeric AS correct_rate,
        COALESCE(ROUND((COUNT(*) FILTER (WHERE ib.score_group = 'high' AND ib.is_correct = TRUE)::numeric / NULLIF(COUNT(*) FILTER (WHERE ib.score_group = 'high' AND ib.is_correct IS NOT NULL), 0)) * 100, 2), 0)::numeric AS high_group_rate,
        COALESCE(ROUND((COUNT(*) FILTER (WHERE ib.score_group = 'low' AND ib.is_correct = TRUE)::numeric / NULLIF(COUNT(*) FILTER (WHERE ib.score_group = 'low' AND ib.is_correct IS NOT NULL), 0)) * 100, 2), 0)::numeric AS low_group_rate
      FROM item_base ib
      GROUP BY ib.question_id
      ORDER BY ib.question_id ASC
      `,
      [examId],
    )

    const rows = itemResult.rows.map((item) => {
      const correctRate = Number(item.correct_rate || 0)
      const highRate = Number(item.high_group_rate || 0)
      const lowRate = Number(item.low_group_rate || 0)
      const discrimination = Number((highRate - lowRate).toFixed(2))
      let qualityLevel = 'normal'
      if (discrimination >= 20 && correctRate >= 40 && correctRate <= 85) qualityLevel = 'excellent'
      else if (discrimination < 10 || correctRate < 20 || correctRate > 90) qualityLevel = 'risk'
      return {
        ...item,
        correct_rate: correctRate,
        high_group_rate: highRate,
        low_group_rate: lowRate,
        discrimination_index: discrimination,
        quality_level: qualityLevel,
      }
    })

    const k = rows.length
    const scoredSubmissionResult = await client.query(
      `
      SELECT total_score
      FROM exam_submissions
      WHERE exam_id = $1 AND total_score IS NOT NULL
      `,
      [examId],
    )
    const totalScores = scoredSubmissionResult.rows.map((r) => Number(r.total_score || 0))
    const n = totalScores.length
    const mean = n > 0 ? totalScores.reduce((sum, v) => sum + v, 0) / n : 0
    const variance = n > 0 ? totalScores.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n : 0
    const sumPQ = rows.reduce((sum, r) => {
      const p = Number(r.correct_rate || 0) / 100
      return sum + p * (1 - p)
    }, 0)
    const reliability =
      k > 1 && variance > 0
        ? Number(((k / (k - 1)) * (1 - sumPQ / variance)).toFixed(4))
        : 0

    return res.json({
      data: {
        exam: examMetaResult.rows[0],
        summary: {
          question_count: k,
          reliability_index: reliability,
          excellent_count: rows.filter((r) => r.quality_level === 'excellent').length,
          risk_count: rows.filter((r) => r.quality_level === 'risk').length,
        },
        rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '题目质量分析查询失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/analytics/exam-class-ranking', authRequired, async (req, res) => {
  const examId = Number(req.query?.examId)
  if (Number.isNaN(examId) || examId <= 0) {
    return res.status(400).json({ message: 'examId 必填' })
  }
  const client = await pool.connect()
  try {
    const access = await assertExamReadAccess(client, examId, req.auth)
    if (!access.ok) {
      return res.status(access.code).json({ message: access.message })
    }

    const examMetaResult = await client.query(
      `
      SELECT e.id, e.title, s.name AS subject_name
      FROM exams e
      JOIN subjects s ON s.id = e.subject_id
      WHERE e.id = $1
      LIMIT 1
      `,
      [examId],
    )
    if (examMetaResult.rowCount === 0) return res.status(404).json({ message: '考试不存在' })

    const rankingResult = await client.query(
      `
      WITH class_base AS (
        SELECT
          c.id AS class_id,
          c.name AS class_name,
          COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS expected_count
        FROM exam_classes ec
        JOIN classes c ON c.id = ec.class_id
        LEFT JOIN class_members cm ON cm.class_id = c.id
        WHERE ec.exam_id = $1
        GROUP BY c.id
      ),
      class_score AS (
        SELECT
          c.id AS class_id,
          COALESCE(COUNT(DISTINCT es.student_id) FILTER (WHERE es.status IN (2, 3)), 0)::int AS submitted_count,
          COALESCE(COUNT(DISTINCT es.student_id) FILTER (WHERE es.total_score IS NOT NULL), 0)::int AS scored_count,
          COALESCE(ROUND(AVG(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 2), 0)::numeric AS avg_score,
          COALESCE(MAX(es.total_score), 0)::numeric AS max_score,
          COALESCE(MIN(es.total_score) FILTER (WHERE es.total_score IS NOT NULL), 0)::numeric AS min_score,
          COALESCE(COUNT(*) FILTER (WHERE es.total_score IS NOT NULL AND es.total_score >= 60), 0)::int AS pass_count,
          COALESCE(COUNT(*) FILTER (WHERE es.total_score IS NOT NULL AND es.total_score >= 85), 0)::int AS excellent_count
        FROM exam_classes ec
        JOIN classes c ON c.id = ec.class_id
        LEFT JOIN class_members cm ON cm.class_id = c.id
        LEFT JOIN exam_submissions es ON es.exam_id = ec.exam_id AND es.student_id = cm.student_id
        WHERE ec.exam_id = $1
        GROUP BY c.id
      )
      SELECT
        cb.class_id,
        cb.class_name,
        cb.expected_count,
        cs.submitted_count,
        cs.scored_count,
        cs.avg_score,
        cs.max_score,
        cs.min_score,
        CASE WHEN cb.expected_count > 0 THEN ROUND(((cb.expected_count - cs.submitted_count)::numeric / cb.expected_count) * 100, 2) ELSE 0 END AS absence_rate,
        CASE WHEN cs.scored_count > 0 THEN ROUND((cs.pass_count::numeric / cs.scored_count) * 100, 2) ELSE 0 END AS pass_rate,
        CASE WHEN cs.scored_count > 0 THEN ROUND((cs.excellent_count::numeric / cs.scored_count) * 100, 2) ELSE 0 END AS excellent_rate
      FROM class_base cb
      JOIN class_score cs ON cs.class_id = cb.class_id
      ORDER BY cs.avg_score DESC, cs.pass_count DESC, cb.class_id ASC
      `,
      [examId],
    )

    const rows = rankingResult.rows.map((item, index) => ({
      rank_no: index + 1,
      ...item,
      expected_count: Number(item.expected_count || 0),
      submitted_count: Number(item.submitted_count || 0),
      scored_count: Number(item.scored_count || 0),
      avg_score: Number(item.avg_score || 0),
      max_score: Number(item.max_score || 0),
      min_score: Number(item.min_score || 0),
      absence_rate: Number(item.absence_rate || 0),
      pass_rate: Number(item.pass_rate || 0),
      excellent_rate: Number(item.excellent_rate || 0),
    }))

    return res.json({
      data: {
        exam: examMetaResult.rows[0],
        rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '班级对比排名查询失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/analytics/question-insights', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const requestedClassId = Number(req.query?.classId)
    const subjectId = Number(req.query?.subjectId)
    const startTimeRaw = String(req.query?.startTime || '').trim()
    const endTimeRaw = String(req.query?.endTime || '').trim()
    const limitInput = Number(req.query?.limit)
    const resultLimit = Number.isNaN(limitInput) ? 20 : Math.min(Math.max(limitInput, 5), 100)
    const hasClassFilter = !Number.isNaN(requestedClassId) && requestedClassId > 0
    const hasSubjectFilter = !Number.isNaN(subjectId) && subjectId > 0
    const hasStartTime = Boolean(startTimeRaw)
    const hasEndTime = Boolean(endTimeRaw)

    const { accessSql, values } = buildVisibleClassesAccessSql(req)

    const classFilterPlaceholder = `$${values.length + 1}`
    const classCondition = hasClassFilter ? `AND vc.id = ${classFilterPlaceholder}` : ''
    if (hasClassFilter) values.push(requestedClassId)
    const subjectFilterPlaceholder = `$${values.length + 1}`
    const subjectCondition = hasSubjectFilter ? `AND e.subject_id = ${subjectFilterPlaceholder}` : ''
    if (hasSubjectFilter) values.push(subjectId)
    const startTimePlaceholder = `$${values.length + 1}`
    const startTimeCondition = hasStartTime ? `AND e.start_time >= ${startTimePlaceholder}::timestamptz` : ''
    if (hasStartTime) values.push(startTimeRaw)
    const endTimePlaceholder = `$${values.length + 1}`
    const endTimeCondition = hasEndTime ? `AND e.end_time <= ${endTimePlaceholder}::timestamptz` : ''
    if (hasEndTime) values.push(endTimeRaw)

    const { rows } = await pool.query(
      `
      WITH visible_classes AS (
        SELECT c.id, c.name
        FROM classes c
        ${accessSql}
      ),
      filtered_exams AS (
        SELECT DISTINCT
          vc.id AS class_id,
          vc.name AS class_name,
          e.id AS exam_id,
          e.title AS exam_title,
          e.subject_id
        FROM visible_classes vc
        JOIN exam_classes ec ON ec.class_id = vc.id
        JOIN exams e ON e.id = ec.exam_id
        WHERE 1 = 1
          ${classCondition}
          ${subjectCondition}
          ${startTimeCondition}
          ${endTimeCondition}
      ),
      question_base AS (
        SELECT
          fe.class_id,
          fe.class_name,
          eq.question_id,
          q.stem,
          q.question_type,
          q.difficulty,
          a.is_correct,
          a.student_answer
        FROM filtered_exams fe
        JOIN exam_questions eq ON eq.exam_id = fe.exam_id
        JOIN questions q ON q.id = eq.question_id
        LEFT JOIN exam_submissions es ON es.exam_id = fe.exam_id
        LEFT JOIN answers a ON a.submission_id = es.id AND a.question_id = eq.question_id
      ),
      question_summary AS (
        SELECT
          qb.question_id,
          MAX(qb.stem) AS stem,
          MAX(qb.question_type) AS question_type,
          MAX(qb.difficulty) AS difficulty,
          COALESCE(COUNT(*) FILTER (WHERE qb.is_correct IS NOT NULL), 0)::int AS attempt_count,
          COALESCE(COUNT(*) FILTER (WHERE qb.is_correct = TRUE), 0)::int AS correct_count,
          COALESCE(COUNT(*) FILTER (WHERE qb.is_correct = FALSE), 0)::int AS wrong_count
        FROM question_base qb
        GROUP BY qb.question_id
      ),
      wrong_answers AS (
        SELECT
          qb.question_id,
          COALESCE(qb.student_answer::text, '未作答') AS answer_text,
          COUNT(*)::int AS wrong_times
        FROM question_base qb
        WHERE qb.is_correct = FALSE
        GROUP BY qb.question_id, COALESCE(qb.student_answer::text, '未作答')
      ),
      wrong_ranked AS (
        SELECT
          wa.*,
          ROW_NUMBER() OVER (PARTITION BY wa.question_id ORDER BY wa.wrong_times DESC, wa.answer_text ASC) AS rn
        FROM wrong_answers wa
      ),
      class_breakdown AS (
        SELECT
          qb.question_id,
          qb.class_id,
          MAX(qb.class_name) AS class_name,
          COALESCE(COUNT(*) FILTER (WHERE qb.is_correct IS NOT NULL), 0)::int AS attempt_count,
          COALESCE(COUNT(*) FILTER (WHERE qb.is_correct = TRUE), 0)::int AS correct_count
        FROM question_base qb
        GROUP BY qb.question_id, qb.class_id
      )
      SELECT
        qs.question_id,
        qs.stem,
        qs.question_type,
        qs.difficulty,
        qs.attempt_count,
        qs.correct_count,
        qs.wrong_count,
        CASE WHEN qs.attempt_count > 0 THEN ROUND((qs.correct_count::numeric / qs.attempt_count) * 100, 2) ELSE 0 END AS correct_rate,
        COALESCE(
          (
            SELECT json_agg(json_build_object('answer_text', wr.answer_text, 'wrong_times', wr.wrong_times) ORDER BY wr.wrong_times DESC, wr.answer_text ASC)
            FROM wrong_ranked wr
            WHERE wr.question_id = qs.question_id AND wr.rn <= 3
          ),
          '[]'::json
        ) AS top_wrong_answers,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'class_id', cb.class_id,
                'class_name', cb.class_name,
                'attempt_count', cb.attempt_count,
                'correct_count', cb.correct_count,
                'correct_rate', CASE WHEN cb.attempt_count > 0 THEN ROUND((cb.correct_count::numeric / cb.attempt_count) * 100, 2) ELSE 0 END
              )
              ORDER BY cb.class_id ASC
            )
            FROM class_breakdown cb
            WHERE cb.question_id = qs.question_id
          ),
          '[]'::json
        ) AS class_breakdown
      FROM question_summary qs
      ORDER BY correct_rate ASC, qs.wrong_count DESC, qs.question_id ASC
      LIMIT $${values.length + 1}
      `,
      [...values, resultLimit],
    )

    return res.json({
      data: rows.map((item) => ({
        ...item,
        correct_rate: Number(item.correct_rate || 0),
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: '错题分析查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/analytics/student-warnings', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const requestedClassId = Number(req.query?.classId)
    const subjectId = Number(req.query?.subjectId)
    const startTimeRaw = String(req.query?.startTime || '').trim()
    const endTimeRaw = String(req.query?.endTime || '').trim()
    const warningLevelFilter = String(req.query?.warningLevel || '').trim()
    const handleStatusFilter = String(req.query?.handleStatus || '').trim()
    const warningRule = await getWarningRuleConfig()
    const recentExamCountInput = Number(req.query?.recentExamCount)
    const avgScoreThresholdInput = Number(req.query?.avgScoreThreshold)
    const missingThresholdInput = Number(req.query?.missingThreshold)
    const recentExamCount = Number.isNaN(recentExamCountInput) ? warningRule.recentExamCount : Math.min(Math.max(recentExamCountInput, 3), 12)
    const avgScoreThreshold = Number.isNaN(avgScoreThresholdInput) ? warningRule.avgScoreThreshold : Math.max(avgScoreThresholdInput, 0)
    const missingThreshold = Number.isNaN(missingThresholdInput) ? warningRule.missingThreshold : Math.max(missingThresholdInput, 1)
    const hasClassFilter = !Number.isNaN(requestedClassId) && requestedClassId > 0
    const hasSubjectFilter = !Number.isNaN(subjectId) && subjectId > 0
    const hasStartTime = Boolean(startTimeRaw)
    const hasEndTime = Boolean(endTimeRaw)

    const { accessSql, values } = buildVisibleClassesAccessSql(req)

    const classFilterPlaceholder = `$${values.length + 1}`
    const classCondition = hasClassFilter ? `AND vc.id = ${classFilterPlaceholder}` : ''
    if (hasClassFilter) values.push(requestedClassId)
    const subjectFilterPlaceholder = `$${values.length + 1}`
    const subjectCondition = hasSubjectFilter ? `AND e.subject_id = ${subjectFilterPlaceholder}` : ''
    if (hasSubjectFilter) values.push(subjectId)
    const startTimePlaceholder = `$${values.length + 1}`
    const startTimeCondition = hasStartTime ? `AND e.start_time >= ${startTimePlaceholder}::timestamptz` : ''
    if (hasStartTime) values.push(startTimeRaw)
    const endTimePlaceholder = `$${values.length + 1}`
    const endTimeCondition = hasEndTime ? `AND e.end_time <= ${endTimePlaceholder}::timestamptz` : ''
    if (hasEndTime) values.push(endTimeRaw)

    const { rows } = await pool.query(
      `
      WITH visible_classes AS (
        SELECT c.id, c.name
        FROM classes c
        ${accessSql}
      ),
      class_students AS (
        SELECT
          vc.id AS class_id,
          vc.name AS class_name,
          s.id AS student_id,
          COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS student_name,
          s.student_no
        FROM visible_classes vc
        JOIN class_members cm ON cm.class_id = vc.id
        JOIN students s ON s.id = cm.student_id
        WHERE 1 = 1
          ${classCondition}
      ),
      class_latest_exams AS (
        SELECT *
        FROM (
          SELECT
            vc.id AS class_id,
            e.id AS exam_id,
            e.title AS exam_title,
            e.start_time,
            ROW_NUMBER() OVER (PARTITION BY vc.id ORDER BY e.start_time DESC, e.id DESC) AS rn
          FROM visible_classes vc
          JOIN exam_classes ec ON ec.class_id = vc.id
          JOIN exams e ON e.id = ec.exam_id
          WHERE 1 = 1
            ${classCondition}
            ${subjectCondition}
            ${startTimeCondition}
            ${endTimeCondition}
        ) ranked
        WHERE ranked.rn <= $${values.length + 1}
      ),
      student_exam_matrix AS (
        SELECT
          cs.class_id,
          cs.class_name,
          cs.student_id,
          cs.student_name,
          cs.student_no,
          cle.exam_id,
          cle.exam_title,
          cle.start_time,
          es.total_score
        FROM class_students cs
        JOIN class_latest_exams cle ON cle.class_id = cs.class_id
        LEFT JOIN exam_submissions es ON es.exam_id = cle.exam_id AND es.student_id = cs.student_id
      ),
      student_summary AS (
        SELECT
          sem.class_id,
          sem.class_name,
          sem.student_id,
          sem.student_name,
          sem.student_no,
          COALESCE(COUNT(DISTINCT sem.exam_id), 0)::int AS recent_exam_count,
          COALESCE(COUNT(*) FILTER (WHERE sem.total_score IS NULL), 0)::int AS missing_count,
          COALESCE(ROUND(AVG(sem.total_score) FILTER (WHERE sem.total_score IS NOT NULL), 2), 0)::numeric AS recent_avg_score,
          ARRAY_REMOVE(ARRAY_AGG(sem.total_score ORDER BY sem.start_time DESC, sem.exam_id DESC), NULL) AS score_series
        FROM student_exam_matrix sem
        GROUP BY sem.class_id, sem.class_name, sem.student_id, sem.student_name, sem.student_no
      )
      SELECT
        ss.class_id,
        ss.class_name,
        ss.student_id,
        ss.student_name,
        ss.student_no,
        ss.recent_exam_count,
        ss.missing_count,
        ss.recent_avg_score,
        COALESCE(ss.score_series[1], NULL) AS latest_score_1,
        COALESCE(ss.score_series[2], NULL) AS latest_score_2,
        COALESCE(ss.score_series[3], NULL) AS latest_score_3,
        (ss.recent_avg_score < $${values.length + 2}) AS low_avg_flag,
        (ss.missing_count >= $${values.length + 3}) AS missing_flag,
        (
          COALESCE(array_length(ss.score_series, 1), 0) >= 3
          AND ss.score_series[1] < ss.score_series[2]
          AND ss.score_series[2] < ss.score_series[3]
        ) AS downtrend_flag,
        swc.status AS handle_status,
        swc.note AS handle_note,
        swc.handled_at,
        swc.handled_by
      FROM student_summary ss
      LEFT JOIN student_warning_cases swc ON swc.class_id = ss.class_id AND swc.student_id = ss.student_id
      WHERE ss.recent_exam_count > 0
      ORDER BY ss.class_id ASC, ss.recent_avg_score ASC, ss.missing_count DESC, ss.student_no ASC
      `,
      [...values, recentExamCount, avgScoreThreshold, missingThreshold],
    )

    const warningRows = rows
      .map((item) => {
        const reasons = []
        if (item.low_avg_flag) reasons.push(`近${recentExamCount}次平均分低于${avgScoreThreshold}`)
        if (item.downtrend_flag) reasons.push('最近3次成绩连续下滑')
        if (item.missing_flag) reasons.push(`近${recentExamCount}次未提交次数≥${missingThreshold}`)
        const hitCount = reasons.length
        const warningLevel = hitCount >= 2 ? 'high' : hitCount === 1 ? 'medium' : 'none'
        return {
          ...item,
          recent_avg_score: Number(item.recent_avg_score || 0),
          latest_score_1: item.latest_score_1 == null ? null : Number(item.latest_score_1),
          latest_score_2: item.latest_score_2 == null ? null : Number(item.latest_score_2),
          latest_score_3: item.latest_score_3 == null ? null : Number(item.latest_score_3),
          warning_level: warningLevel,
          warning_reasons: reasons,
          handle_status: ['pending', 'in_progress', 'resolved'].includes(String(item.handle_status)) ? String(item.handle_status) : 'pending',
          handle_note: String(item.handle_note || ''),
          handled_at: item.handled_at || null,
          handled_by: item.handled_by == null ? null : Number(item.handled_by),
        }
      })
      .filter((item) => item.warning_level !== 'none')
      .filter((item) => (warningLevelFilter ? item.warning_level === warningLevelFilter : true))
      .filter((item) => (handleStatusFilter ? item.handle_status === handleStatusFilter : true))

    const classOptions = Array.from(
      new Map(
        warningRows.map((item) => [
          Number(item.class_id),
          {
            class_id: Number(item.class_id),
            class_name: String(item.class_name || ''),
          },
        ]),
      ).values(),
    )

    return res.json({
      data: {
        class_options: classOptions,
        rows: warningRows,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '学生预警查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.patch('/api/analytics/student-warnings/handle', authRequired, async (req, res) => {
  const classId = Number(req.body?.classId)
  const studentId = Number(req.body?.studentId)
  const status = String(req.body?.status || '').trim()
  const note = String(req.body?.note || '').trim()
  if (Number.isNaN(classId) || Number.isNaN(studentId)) {
    return res.status(400).json({ message: 'classId 和 studentId 必填' })
  }
  if (!['pending', 'in_progress', 'resolved'].includes(status)) {
    return res.status(400).json({ message: 'status 仅支持 pending/in_progress/resolved' })
  }
  if (!hasRole(req, 'admin') && !hasRole(req, 'class_teacher')) {
    return res.status(403).json({ message: '仅管理员或班主任可处理预警' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await assertClassManageAccess(client, classId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }
    await client.query(
      `
      INSERT INTO student_warning_cases (class_id, student_id, status, note, handled_by, handled_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (class_id, student_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        handled_by = EXCLUDED.handled_by,
        handled_at = EXCLUDED.handled_at,
        updated_at = NOW()
      `,
      [classId, studentId, status, note || null, req.auth?.userId || null],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'student_warning.handle',
      targetType: 'class',
      targetId: String(classId),
      detail: { classId, studentId, status, note },
    })
    await client.query('COMMIT')
    return res.json({ data: { class_id: classId, student_id: studentId, status, note } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '处理学生预警失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/analytics/student-warnings/overview', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const requestedClassId = Number(req.query?.classId)
    const subjectId = Number(req.query?.subjectId)
    const startTimeRaw = String(req.query?.startTime || '').trim()
    const endTimeRaw = String(req.query?.endTime || '').trim()
    const warningLevelFilter = String(req.query?.warningLevel || '').trim()
    const handleStatusFilter = String(req.query?.handleStatus || '').trim()
    const warningRule = await getWarningRuleConfig()
    const recentExamCount = warningRule.recentExamCount
    const avgScoreThreshold = warningRule.avgScoreThreshold
    const missingThreshold = warningRule.missingThreshold
    const hasClassFilter = !Number.isNaN(requestedClassId) && requestedClassId > 0
    const hasSubjectFilter = !Number.isNaN(subjectId) && subjectId > 0
    const hasStartTime = Boolean(startTimeRaw)
    const hasEndTime = Boolean(endTimeRaw)

    const { accessSql, values } = buildVisibleClassesAccessSql(req)

    const classFilterPlaceholder = `$${values.length + 1}`
    const classCondition = hasClassFilter ? `AND vc.id = ${classFilterPlaceholder}` : ''
    if (hasClassFilter) values.push(requestedClassId)
    const subjectFilterPlaceholder = `$${values.length + 1}`
    const subjectCondition = hasSubjectFilter ? `AND e.subject_id = ${subjectFilterPlaceholder}` : ''
    if (hasSubjectFilter) values.push(subjectId)
    const startTimePlaceholder = `$${values.length + 1}`
    const startTimeCondition = hasStartTime ? `AND e.start_time >= ${startTimePlaceholder}::timestamptz` : ''
    if (hasStartTime) values.push(startTimeRaw)
    const endTimePlaceholder = `$${values.length + 1}`
    const endTimeCondition = hasEndTime ? `AND e.end_time <= ${endTimePlaceholder}::timestamptz` : ''
    if (hasEndTime) values.push(endTimeRaw)

    const { rows } = await pool.query(
      `
      WITH visible_classes AS (
        SELECT c.id, c.name
        FROM classes c
        ${accessSql}
      ),
      class_students AS (
        SELECT
          vc.id AS class_id,
          vc.name AS class_name,
          s.id AS student_id,
          COALESCE(NULLIF(TRIM(s.real_name), ''), s.name) AS student_name,
          s.student_no
        FROM visible_classes vc
        JOIN class_members cm ON cm.class_id = vc.id
        JOIN students s ON s.id = cm.student_id
        WHERE 1 = 1
          ${classCondition}
      ),
      class_latest_exams AS (
        SELECT *
        FROM (
          SELECT
            vc.id AS class_id,
            e.id AS exam_id,
            e.start_time,
            ROW_NUMBER() OVER (PARTITION BY vc.id ORDER BY e.start_time DESC, e.id DESC) AS rn
          FROM visible_classes vc
          JOIN exam_classes ec ON ec.class_id = vc.id
          JOIN exams e ON e.id = ec.exam_id
          WHERE 1 = 1
            ${classCondition}
            ${subjectCondition}
            ${startTimeCondition}
            ${endTimeCondition}
        ) ranked
        WHERE ranked.rn <= $${values.length + 1}
      ),
      student_exam_matrix AS (
        SELECT
          cs.class_id,
          cs.class_name,
          cs.student_id,
          cle.start_time,
          es.total_score
        FROM class_students cs
        JOIN class_latest_exams cle ON cle.class_id = cs.class_id
        LEFT JOIN exam_submissions es ON es.exam_id = cle.exam_id AND es.student_id = cs.student_id
      ),
      student_summary AS (
        SELECT
          sem.class_id,
          sem.class_name,
          sem.student_id,
          COALESCE(COUNT(DISTINCT sem.start_time), 0)::int AS recent_exam_count,
          COALESCE(COUNT(*) FILTER (WHERE sem.total_score IS NULL), 0)::int AS missing_count,
          COALESCE(ROUND(AVG(sem.total_score) FILTER (WHERE sem.total_score IS NOT NULL), 2), 0)::numeric AS recent_avg_score,
          ARRAY_REMOVE(ARRAY_AGG(sem.total_score ORDER BY sem.start_time DESC), NULL) AS score_series,
          MAX(sem.start_time) AS latest_exam_time
        FROM student_exam_matrix sem
        GROUP BY sem.class_id, sem.class_name, sem.student_id
      )
      SELECT
        ss.class_id,
        ss.class_name,
        ss.student_id,
        ss.latest_exam_time,
        swc.status AS handle_status,
        (ss.recent_avg_score < $${values.length + 2}) AS low_avg_flag,
        (ss.missing_count >= $${values.length + 3}) AS missing_flag,
        (
          COALESCE(array_length(ss.score_series, 1), 0) >= 3
          AND ss.score_series[1] < ss.score_series[2]
          AND ss.score_series[2] < ss.score_series[3]
        ) AS downtrend_flag
      FROM student_summary ss
      LEFT JOIN student_warning_cases swc ON swc.class_id = ss.class_id AND swc.student_id = ss.student_id
      WHERE ss.recent_exam_count > 0
      `,
      [...values, recentExamCount, avgScoreThreshold, missingThreshold],
    )

    const warnings = rows
      .map((item) => {
        const reasonCount = [item.low_avg_flag, item.missing_flag, item.downtrend_flag].filter(Boolean).length
        const warningLevel = reasonCount >= 2 ? 'high' : reasonCount === 1 ? 'medium' : 'none'
        const handleStatus = ['pending', 'in_progress', 'resolved'].includes(String(item.handle_status))
          ? String(item.handle_status)
          : 'pending'
        return {
          class_id: Number(item.class_id),
          class_name: String(item.class_name || ''),
          warning_level: warningLevel,
          handle_status: handleStatus,
          latest_exam_time: item.latest_exam_time ? String(item.latest_exam_time) : '',
        }
      })
      .filter((item) => item.warning_level !== 'none')
      .filter((item) => (warningLevelFilter ? item.warning_level === warningLevelFilter : true))
      .filter((item) => (handleStatusFilter ? item.handle_status === handleStatusFilter : true))

    const classMap = new Map()
    warnings.forEach((item) => {
      const key = `${item.class_id}`
      classMap.set(key, {
        class_id: item.class_id,
        class_name: item.class_name,
        warning_count: Number((classMap.get(key)?.warning_count || 0) + 1),
      })
    })
    const classDistribution = Array.from(classMap.values()).sort((a, b) => b.warning_count - a.warning_count)

    const levelDistribution = [
      { level: '高预警', key: 'high', count: warnings.filter((item) => item.warning_level === 'high').length },
      { level: '中预警', key: 'medium', count: warnings.filter((item) => item.warning_level === 'medium').length },
    ]

    const trend7d = []
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const day = date.toISOString().slice(0, 10)
      const count = warnings.filter((item) => item.latest_exam_time && item.latest_exam_time.slice(0, 10) === day).length
      trend7d.push({ day, warning_count: count })
    }

    return res.json({
      data: {
        class_distribution: classDistribution,
        level_distribution: levelDistribution,
        trend_7d: trend7d,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '预警看板查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/exams', authRequired, async (req, res) => {
  const title = String(req.body?.title || '').trim()
  const description = String(req.body?.description || '').trim()
  const subjectId = Number(req.body?.subjectId)
  const startTimeRaw = String(req.body?.startTime || '').trim()
  const endTimeRaw = String(req.body?.endTime || '').trim()
  const durationInput = Number(req.body?.duration || 0)
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id)) : []
  const questionItems = Array.isArray(req.body?.questionItems)
    ? req.body.questionItems
        .map((item) => ({
          questionId: Number(item?.questionId),
          score: Number(item?.score),
        }))
        .filter((item) => !Number.isNaN(item.questionId))
    : []
  const questionIds =
    questionItems.length > 0
      ? questionItems.map((item) => item.questionId)
      : Array.isArray(req.body?.questionIds)
        ? req.body.questionIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
        : []
  if (!title || Number.isNaN(subjectId) || !startTimeRaw || !endTimeRaw) {
    return res.status(400).json({ message: '考试基础信息不完整' })
  }
  if (classIds.length === 0) return res.status(400).json({ message: '至少选择一个班级' })
  if (questionIds.length === 0) return res.status(400).json({ message: '至少选择一道题目' })
  if (questionItems.some((item) => Number.isNaN(item.score) || item.score <= 0)) {
    return res.status(400).json({ message: '题目分值必须大于0' })
  }
  const startTime = new Date(startTimeRaw)
  const endTime = new Date(endTimeRaw)
  const now = new Date()
  if (!Number.isNaN(startTime.getTime()) && startTime < now) {
    return res.status(400).json({ message: '开始时间不能早于当前时间' })
  }
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    return res.status(400).json({ message: '考试时间范围不合法' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const examDefaults = await getExamDefaultConfig(client)
    const duration = Number.isNaN(durationInput) || durationInput <= 0 ? examDefaults.defaultDurationMinutes : durationInput
    const isAdmin = hasRole(req, 'admin')
    const isClassTeacher = hasRole(req, 'class_teacher')
    const isSubjectTeacher = hasRole(req, 'subject_teacher')
    if (!isAdmin && !isClassTeacher && !isSubjectTeacher) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '无权限创建考试' })
    }

    for (const classId of classIds) {
      const classCheck = await client.query('SELECT id, owner_id FROM classes WHERE id = $1 LIMIT 1', [classId])
      if (classCheck.rowCount === 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: `班级不存在(${classId})` })
      }
      if (!isAdmin && isClassTeacher && Number(classCheck.rows[0].owner_id) !== Number(req.auth.userId)) {
        await client.query('ROLLBACK')
        return res.status(403).json({ message: `班级(${classId})不属于当前班主任` })
      }
      if (!isAdmin && !isClassTeacher && isSubjectTeacher) {
        const memberCheck = await client.query(
          'SELECT 1 FROM class_teachers WHERE class_id = $1 AND teacher_id = $2 AND subject_id = $3 LIMIT 1',
          [classId, req.auth.userId, subjectId],
        )
        if (memberCheck.rowCount === 0) {
          await client.query('ROLLBACK')
          return res.status(403).json({ message: `你未加入班级(${classId})该科目，无法创建考试` })
        }
      }
    }

    const uniqueQuestionIds = Array.from(new Set(questionIds))
    const questionCheck = await client.query(
      `
      SELECT id
      FROM questions
      WHERE id = ANY($1::bigint[]) AND subject_id = $2
      `,
      [uniqueQuestionIds, subjectId],
    )
    if (questionCheck.rowCount !== uniqueQuestionIds.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '所选题目中存在无效题目或跨科目题目' })
    }

    const dupTitle = await client.query(`SELECT id FROM exams WHERE trim(title) = $1 LIMIT 1`, [title])
    if (dupTitle.rowCount > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '考试名称已存在，请更换名称' })
    }

    const examResult = await client.query(
      `
      INSERT INTO exams (title, subject_id, start_time, end_time, duration, creator_id, status, description, settings, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 1, $7, '{}'::jsonb, NOW())
      RETURNING id, title, subject_id, start_time, end_time, duration, status
      `,
      [title, subjectId, startTime.toISOString(), endTime.toISOString(), duration, req.auth.userId, description || null],
    )
    const examId = Number(examResult.rows[0].id)

    for (const classId of Array.from(new Set(classIds))) {
      await client.query(
        `
        INSERT INTO exam_classes (exam_id, class_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [examId, classId],
      )
    }
    const questionScoreMap = new Map(
      questionItems.map((item) => [Number(item.questionId), Number(item.score)]),
    )
    for (let index = 0; index < uniqueQuestionIds.length; index += 1) {
      const questionId = uniqueQuestionIds[index]
      const score = questionScoreMap.get(questionId) ?? examDefaults.defaultQuestionScore
      await client.query(
        `
        INSERT INTO exam_questions (exam_id, question_id, score, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        `,
        [examId, questionId, score, index + 1],
      )
    }

    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'exam.update',
      targetType: 'exam',
      targetId: String(examId),
      detail: { title, classCount: classIds.length, questionCount: uniqueQuestionIds.length },
    })

    await client.query('COMMIT')
    return res.status(201).json({ data: examResult.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '创建考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/exams/:id/publish', authRequired, async (req, res) => {
  const examId = Number(req.params.id)
  if (Number.isNaN(examId)) return res.status(400).json({ message: '考试ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertExamManageAccess(client, examId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const update = await client.query('UPDATE exams SET status = 1 WHERE id = $1 RETURNING id, status', [examId])
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'exam.publish',
      targetType: 'exam',
      targetId: String(examId),
    })
    return res.json({ data: update.rows[0] })
  } catch (error) {
    return res.status(500).json({ message: '发布考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/exams/:id/finish', authRequired, async (req, res) => {
  const examId = Number(req.params.id)
  if (Number.isNaN(examId)) return res.status(400).json({ message: '考试ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertExamManageAccess(client, examId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const update = await client.query(
      `
      UPDATE exams
      SET status = 3, end_time = NOW()
      WHERE id = $1
      RETURNING id, status, end_time
      `,
      [examId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'exam.finish',
      targetType: 'exam',
      targetId: String(examId),
    })
    return res.json({ data: update.rows[0] })
  } catch (error) {
    return res.status(500).json({ message: '提前结束考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/exams/:id/reopen', authRequired, async (req, res) => {
  const examId = Number(req.params.id)
  if (Number.isNaN(examId)) return res.status(400).json({ message: '考试ID不合法' })
  const client = await pool.connect()
  try {
    const access = await assertExamManageAccess(client, examId, req.auth)
    if (!access.ok) return res.status(access.code).json({ message: access.message })
    const update = await client.query(
      `
      UPDATE exams
      SET
        status = 2,
        start_time = CASE WHEN start_time > NOW() THEN NOW() ELSE start_time END,
        end_time = CASE
          WHEN end_time <= NOW() THEN NOW() + (duration || ' minutes')::interval
          ELSE end_time
        END
      WHERE id = $1
      RETURNING id, status, start_time, end_time
      `,
      [examId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'exam.reopen',
      targetType: 'exam',
      targetId: String(examId),
    })
    return res.json({ data: update.rows[0] })
  } catch (error) {
    return res.status(500).json({ message: '重新开启考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/exams/:id/copy', authRequired, async (req, res) => {
  const examId = Number(req.params.id)
  if (Number.isNaN(examId)) return res.status(400).json({ message: '考试ID不合法' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const examDefaults = await getExamDefaultConfig(client)
    const access = await assertExamManageAccess(client, examId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }

    const sourceExamResult = await client.query(
      `
      SELECT id, title, subject_id, start_time, end_time, duration, description
      FROM exams
      WHERE id = $1
      LIMIT 1
      `,
      [examId],
    )
    const sourceExam = sourceExamResult.rows[0]
    if (!sourceExam) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '原考试不存在' })
    }

    const now = new Date()
    const sourceStart = new Date(sourceExam.start_time)
    const sourceEnd = new Date(sourceExam.end_time)
    const sourceDurationMs = Math.max(sourceEnd.getTime() - sourceStart.getTime(), Number(sourceExam.duration || 60) * 60000)
    const newStart =
      sourceStart.getTime() > now.getTime()
        ? new Date(sourceStart.getTime())
        : new Date(now.getTime() + examDefaults.copyStartOffsetMinutes * 60 * 1000)
    const newEnd = new Date(newStart.getTime() + sourceDurationMs)

    const insertExam = await client.query(
      `
      INSERT INTO exams (title, subject_id, start_time, end_time, duration, creator_id, status, description, settings, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 1, $7, '{}'::jsonb, NOW())
      RETURNING id, title, subject_id, start_time, end_time, duration, status
      `,
      [
        `${String(sourceExam.title)}-副本`,
        Number(sourceExam.subject_id),
        newStart.toISOString(),
        newEnd.toISOString(),
        Number(sourceExam.duration || 60),
        req.auth.userId,
        sourceExam.description || null,
      ],
    )
    const newExamId = Number(insertExam.rows[0].id)

    const classRows = await client.query('SELECT class_id FROM exam_classes WHERE exam_id = $1', [examId])
    for (const row of classRows.rows) {
      await client.query(
        `
        INSERT INTO exam_classes (exam_id, class_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [newExamId, Number(row.class_id)],
      )
    }

    const questionRows = await client.query(
      `
      SELECT question_id, score, sort_order
      FROM exam_questions
      WHERE exam_id = $1
      ORDER BY sort_order ASC
      `,
      [examId],
    )
    for (const row of questionRows.rows) {
      await client.query(
        `
        INSERT INTO exam_questions (exam_id, question_id, score, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        `,
        [newExamId, Number(row.question_id), Number(row.score || examDefaults.defaultQuestionScore), Number(row.sort_order || 1)],
      )
    }

    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'exam.copy',
      targetType: 'exam',
      targetId: String(newExamId),
      detail: { sourceExamId: examId },
    })

    await client.query('COMMIT')
    return res.status(201).json({ data: insertExam.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '复制考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.delete('/api/exams/:id', authRequired, async (req, res) => {
  const examId = Number(req.params.id)
  if (Number.isNaN(examId)) return res.status(400).json({ message: '考试ID不合法' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await assertExamManageAccess(client, examId, req.auth)
    if (!access.ok) {
      await client.query('ROLLBACK')
      return res.status(access.code).json({ message: access.message })
    }

    await client.query('DELETE FROM exams WHERE id = $1', [examId])
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'exam.delete',
      targetType: 'exam',
      targetId: String(examId),
    })
    await client.query('COMMIT')
    return res.json({ data: { id: examId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '删除考试失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/users', authRequired, async (req, res) => {
  const requesterIsAdmin = hasRole(req, 'admin')
  const requesterIsClassTeacher = hasRole(req, 'class_teacher')
  if (!requesterIsAdmin && !requesterIsClassTeacher) {
    return res.status(403).json({ message: '无权限新增教师账号' })
  }

  const name = String(req.body?.name || '').trim()
  const phone = String(req.body?.phone || '').trim()
  const password = String(req.body?.password || '').trim()
  const requestedRoles = Array.isArray(req.body?.roles) ? req.body.roles.map((r) => String(r)) : []
  const subjectIds = Array.isArray(req.body?.subjectIds) ? req.body.subjectIds.map((id) => Number(id)).filter((n) => !Number.isNaN(n)) : []

  if (!name || !phone || !password) {
    return res.status(400).json({ message: '姓名、手机号、密码不能为空' })
  }

  const allowedRoleSet = new Set(['admin', 'class_teacher', 'subject_teacher'])
  const roles = requestedRoles.filter((role) => allowedRoleSet.has(role))
  if (roles.length === 0) {
    return res.status(400).json({ message: '至少选择一个角色' })
  }
  if (!requesterIsAdmin && requesterIsClassTeacher && (!roles.every((r) => r === 'subject_teacher') || roles.length !== 1)) {
    return res.status(403).json({ message: '班主任仅可新增科任老师账号' })
  }
  if (roles.includes('subject_teacher') && subjectIds.length === 0) {
    return res.status(400).json({ message: '科任老师账号必须绑定至少一个科目' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const exists = await client.query('SELECT id FROM users WHERE phone = $1 LIMIT 1', [phone])
    if (exists.rowCount > 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({ message: '手机号已存在' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const userResult = await client.query(
      `
      INSERT INTO users (name, phone, password_hash, status, created_at, updated_at)
      VALUES ($1, $2, $3, 1, NOW(), NOW())
      RETURNING id, name, phone
      `,
      [name, phone, passwordHash],
    )
    const userId = userResult.rows[0]?.id

    for (const roleCode of roles) {
      const roleResult = await client.query('SELECT id FROM roles WHERE code = $1 LIMIT 1', [roleCode])
      const roleId = roleResult.rows[0]?.id
      if (!roleId) {
        throw new Error(`角色不存在: ${roleCode}`)
      }
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, roleId])
    }

    if (roles.includes('subject_teacher')) {
      for (const subjectId of subjectIds) {
        await client.query(
          `
          INSERT INTO teacher_subjects (teacher_id, subject_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [userId, subjectId],
        )
      }
    }

    await client.query('COMMIT')
    return res.status(201).json({
      data: {
        id: userId,
        name,
        phone,
        roles,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '新增教师账号失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/users/:id/reset-password', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可重置密码' })
  }
  const targetUserId = Number(req.params.id)
  if (Number.isNaN(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: '用户ID不合法' })
  }
  try {
    const newHash = await bcrypt.hash('123456', 10)
    const result = await pool.query(
      `
      UPDATE users
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, name, phone
      `,
      [newHash, targetUserId],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ message: '用户不存在' })
    }
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'user.reset_password',
      targetType: 'user',
      targetId: String(targetUserId),
      detail: { phone: result.rows[0]?.phone || '' },
    })
    return res.json({
      data: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        phone: result.rows[0].phone,
        reset_password: '123456',
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '重置密码失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.patch('/api/users/:id/status', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可修改账号状态' })
  }
  const targetUserId = Number(req.params.id)
  const nextStatus = Number(req.body?.status)
  if (Number.isNaN(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: '用户ID不合法' })
  }
  if (![0, 1].includes(nextStatus)) {
    return res.status(400).json({ message: 'status 仅支持 0 或 1' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userResult = await client.query(
      `
      SELECT
        u.id,
        u.name,
        u.phone,
        u.status,
        EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id AND r.code = 'admin'
        ) AS is_admin
      FROM users u
      WHERE u.id = $1
      FOR UPDATE
      `,
      [targetUserId],
    )
    const user = userResult.rows[0]
    if (!user) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '用户不存在' })
    }

    if (nextStatus === 0 && user.is_admin) {
      const activeAdminResult = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
        WHERE r.code = 'admin' AND u.status = 1
        `,
      )
      const activeAdminCount = Number(activeAdminResult.rows[0]?.count || 0)
      if (activeAdminCount <= 1) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: '不能禁用最后一个管理员账户' })
      }
    }

    const updateResult = await client.query(
      `
      UPDATE users
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, name, phone, status
      `,
      [nextStatus, targetUserId],
    )
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'user.update_status',
      targetType: 'user',
      targetId: String(targetUserId),
      detail: { status: nextStatus },
    })
    await client.query('COMMIT')
    return res.json({ data: updateResult.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '更新账号状态失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/users/:id/roles', authRequired, async (req, res) => {
  if (!hasRole(req, 'admin')) {
    return res.status(403).json({ message: '仅管理员可修改教师角色' })
  }
  const targetUserId = Number(req.params.id)
  const requestedRoles = Array.isArray(req.body?.roles) ? req.body.roles.map((r) => String(r)) : []
  const subjectIds = Array.isArray(req.body?.subjectIds)
    ? req.body.subjectIds.map((id) => Number(id)).filter((n) => !Number.isNaN(n))
    : []

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: '用户ID不合法' })
  }

  const allowedRoleSet = new Set(['admin', 'class_teacher', 'subject_teacher'])
  const roles = requestedRoles.filter((role) => allowedRoleSet.has(role))
  if (roles.length === 0) {
    return res.status(400).json({ message: '至少选择一个角色' })
  }
  if (roles.includes('subject_teacher') && subjectIds.length === 0) {
    return res.status(400).json({ message: '科任老师账号必须绑定至少一个科目' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userResult = await client.query(
      'SELECT id, name, phone FROM users WHERE id = $1 FOR UPDATE',
      [targetUserId],
    )
    const user = userResult.rows[0]
    if (!user) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '用户不存在' })
    }

    const currentRolesResult = await client.query(
      `
      SELECT r.code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      `,
      [targetUserId],
    )
    const currentRoles = currentRolesResult.rows.map((row) => row.code)

    if (currentRoles.includes('admin') && !roles.includes('admin')) {
      const activeAdminResult = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
        WHERE r.code = 'admin' AND u.status = 1
        `,
      )
      const activeAdminCount = Number(activeAdminResult.rows[0]?.count || 0)
      if (activeAdminCount <= 1) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: '不能移除最后一个管理员的角色' })
      }
    }

    if (currentRoles.includes('class_teacher') && !roles.includes('class_teacher')) {
      const ownedClassesResult = await client.query(
        'SELECT COUNT(*)::int AS count FROM classes WHERE owner_id = $1',
        [targetUserId],
      )
      if (Number(ownedClassesResult.rows[0]?.count || 0) > 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: '该用户仍为部分班级的班主任，请先在班级管理中重新分配班主任' })
      }
    }

    await client.query('DELETE FROM user_roles WHERE user_id = $1', [targetUserId])
    for (const roleCode of roles) {
      const roleResult = await client.query('SELECT id FROM roles WHERE code = $1 LIMIT 1', [roleCode])
      const roleId = roleResult.rows[0]?.id
      if (!roleId) {
        throw new Error(`角色不存在: ${roleCode}`)
      }
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [targetUserId, roleId])
    }

    await client.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [targetUserId])
    if (roles.includes('subject_teacher')) {
      for (const subjectId of subjectIds) {
        await client.query(
          `
          INSERT INTO teacher_subjects (teacher_id, subject_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [targetUserId, subjectId],
        )
      }
    }

    if (currentRoles.includes('subject_teacher') && !roles.includes('subject_teacher')) {
      await client.query('DELETE FROM class_teachers WHERE teacher_id = $1', [targetUserId])
    }

    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'user.update_roles',
      targetType: 'user',
      targetId: String(targetUserId),
      detail: {
        name: user.name,
        phone: user.phone,
        from_roles: currentRoles,
        to_roles: roles,
        subject_ids: roles.includes('subject_teacher') ? subjectIds : [],
      },
    })
    await client.query('COMMIT')
    return res.json({
      data: {
        id: targetUserId,
        roles,
        subjectIds: roles.includes('subject_teacher') ? subjectIds : [],
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '更新教师角色失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.setHeader('Cache-Control', 'no-store')
    // 若 JSON 里没有 service/auth_profile_me，说明 3000 上不是本仓库当前版 API（端口被其它进程占用或未保存/未重启）
    res.json({
      ok: true,
      service: 'quizwiz-teacher-admin',
      auth_profile_me: true,
      api_revision: API_REVISION,
      /** api_revision >= 2 时 GET /api/questions 列表体含 knowledge_points；>=3 增加 knowledge_unit */
      questions_list_knowledge_fields: true,
    })
  } catch (error) {
    res.status(500).json({ ok: false, message: 'database unavailable' })
  }
})

app.get('/api/resources/meta', authRequired, async (_req, res) => {
  try {
    const { accessSql: whereClause, values } = buildVisibleClassesAccessSql(_req)
    const [classResult] = await Promise.all([
      pool.query(
        `
        SELECT c.id, c.name
        FROM classes c
        ${whereClause}
        ORDER BY c.created_at DESC, c.id DESC
        `,
        values,
      ),
    ])
    const subjectResult = await pool.query(`SELECT id, name FROM subjects ORDER BY sort_order ASC, id ASC`)
    return res.json({
      data: {
        subjects: subjectResult.rows.map((item) => ({
          id: Number(item.id),
          name: String(item.name || ''),
        })),
        classes: classResult.rows.map((item) => ({
          id: item.id,
          name: item.name,
        })),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载资料库元数据失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/resources/upload', authRequired, (req, res) => {
  if (!canManageResources(req)) {
    return res.status(403).json({ message: '无权限上传资料' })
  }
  resourceUpload.single('file')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '文件大小不能超过 1GB' })
      }
      return res.status(400).json({ message: error instanceof Error ? error.message : '上传失败' })
    }
    const file = req.file
    if (!file) return res.status(400).json({ message: '未检测到上传文件' })
    const fileUrl = `${UPLOAD_PUBLIC_BASE}/uploads/${file.filename}`
    const ext = path.extname(file.originalname || '').toLowerCase()
    let fileType = 'file'
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) fileType = 'image'
    else if (['.mp4', '.mov'].includes(ext)) fileType = 'video'
    else if (['.pdf'].includes(ext)) fileType = 'pdf'
    else if (['.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) fileType = 'doc'
    return res.json({
      data: {
        fileName: file.originalname,
        fileUrl,
        fileType,
        size: file.size,
      },
    })
  })
})

app.get('/api/resources', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const isClassTeacher = hasRole(req, 'class_teacher')
    const isSubjectTeacher = hasRole(req, 'subject_teacher')
    const folder = String(req.query?.folder || '').trim()
    const keyword = String(req.query?.keyword || '').trim()
    const values = []
    const conditions = []
    if (!isAdmin) {
      if (!isClassTeacher && !isSubjectTeacher) {
        conditions.push('1 = 0')
      } else {
        values.push(req.auth?.userId || 0)
        const uidIndex = values.length
        const classAccessParts = []
        if (isClassTeacher) {
          classAccessParts.push(`EXISTS (SELECT 1 FROM classes c WHERE c.id = v.class_id AND c.owner_id = $${uidIndex})`)
        }
        if (isSubjectTeacher) {
          classAccessParts.push(`EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = v.class_id AND ct.teacher_id = $${uidIndex})`)
        }
        conditions.push(`
          (
            NOT EXISTS (SELECT 1 FROM resource_class_visibility rv WHERE rv.resource_id = r.id)
            OR EXISTS (
              SELECT 1
              FROM resource_class_visibility v
              WHERE v.resource_id = r.id
                AND (${classAccessParts.join(' OR ')})
            )
          )
        `)
      }
    }
    if (folder) {
      values.push(folder)
      conditions.push(`r.folder = $${values.length}`)
    }
    if (keyword) {
      values.push(`%${keyword}%`)
      conditions.push(`r.name ILIKE $${values.length}`)
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const explicitPaging = req.query?.page !== undefined && req.query?.page !== ''
    const page = Math.max(1, parseInt(String(req.query?.page ?? '1'), 10) || 1)
    let pageSize = Math.min(1000, Math.max(1, parseInt(String(req.query?.pageSize ?? '1000'), 10) || 1000))
    if (explicitPaging) {
      pageSize = Math.min(100, Math.max(1, parseInt(String(req.query?.pageSize ?? '20'), 10) || 20))
    }
    const offset = (page - 1) * pageSize
    const resourceResult = await pool.query(
      `
      WITH base AS (
        SELECT
          r.id,
          r.name,
          r.file_url,
          r.file_type,
          r.folder,
          r.subject_id,
          COALESCE(s.name, '') AS subject_name,
          r.uploader_id,
          r.created_at,
          COALESCE(u.name, '') AS uploader_name
        FROM resources r
        LEFT JOIN users u ON u.id = r.uploader_id
        LEFT JOIN subjects s ON s.id = r.subject_id
        ${whereClause}
      ),
      tot AS (SELECT COUNT(*)::int AS c FROM base)
      SELECT b.*, tot.c AS __total
      FROM base b
      CROSS JOIN tot
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
      `,
      values,
    )
    const total = resourceResult.rows.length > 0 ? Number(resourceResult.rows[0].__total ?? 0) : 0
    const ids = resourceResult.rows.map((item) => Number(item.id)).filter((item) => item > 0)
    const visibilityMap = new Map()
    if (ids.length > 0) {
      const visibilityResult = await pool.query(
        `
        SELECT v.resource_id, c.id AS class_id, c.name AS class_name
        FROM resource_class_visibility v
        JOIN classes c ON c.id = v.class_id
        WHERE v.resource_id = ANY($1::bigint[])
        ORDER BY v.resource_id ASC, c.name ASC
        `,
        [ids],
      )
      visibilityResult.rows.forEach((row) => {
        const key = Number(row.resource_id)
        if (!visibilityMap.has(key)) visibilityMap.set(key, [])
        visibilityMap.get(key).push({
          class_id: Number(row.class_id),
          class_name: String(row.class_name || ''),
        })
      })
    }
    return res.json({
      data: resourceResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        file_url: row.file_url,
        file_type: row.file_type,
        folder: row.folder,
        subject_id: row.subject_id != null ? Number(row.subject_id) : null,
        subject_name: String(row.subject_name || ''),
        uploader_id: row.uploader_id,
        uploader_name: row.uploader_name || '',
        created_at: row.created_at,
        visible_classes: visibilityMap.get(Number(row.id)) || [],
      })),
      pagination: { total, page, pageSize },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载资料库失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/resources/download-logs', authRequired, async (req, res) => {
  const isAdmin = hasRole(req, 'admin')
  const isClassTeacher = hasRole(req, 'class_teacher')
  if (!isAdmin && !isClassTeacher) {
    return res.status(403).json({ message: '仅管理员或班主任可查看资料下载审计' })
  }
  try {
    const { keyword, operatorId, startTime, endTime, page, pageSize } = req.query
    const values = []
    const conditions = [`l.action = 'resource.download'`, `l.target_type = 'resource'`, `l.target_id ~ '^[0-9]+$'`]
    if (!isAdmin && isClassTeacher) {
      values.push(req.auth?.userId || 0)
      const scopeIdx = values.length
      conditions.push(`
        EXISTS (
          SELECT 1 FROM resources r_scope
          WHERE r_scope.id = l.target_id::bigint
            AND (
              r_scope.uploader_id = $${scopeIdx}
              OR EXISTS (
                SELECT 1 FROM resource_class_visibility rv
                JOIN classes c ON c.id = rv.class_id AND c.owner_id = $${scopeIdx}
                WHERE rv.resource_id = r_scope.id
              )
            )
        )
      `)
    }
    if (operatorId && !Number.isNaN(Number(operatorId))) {
      values.push(Number(operatorId))
      conditions.push(`l.operator_id = $${values.length}`)
    }
    if (startTime && !Number.isNaN(new Date(String(startTime)).getTime())) {
      values.push(new Date(String(startTime)).toISOString())
      conditions.push(`l.created_at >= $${values.length}`)
    }
    if (endTime && !Number.isNaN(new Date(String(endTime)).getTime())) {
      values.push(new Date(String(endTime)).toISOString())
      conditions.push(`l.created_at <= $${values.length}`)
    }
    if (keyword && String(keyword).trim()) {
      values.push(`%${String(keyword).trim()}%`)
      const kwIdx = values.length
      conditions.push(`
        (
          COALESCE(u.name, '') ILIKE $${kwIdx}
          OR COALESCE(u.phone, '') ILIKE $${kwIdx}
          OR COALESCE(l.target_id, '') ILIKE $${kwIdx}
          OR COALESCE(r.name, '') ILIKE $${kwIdx}
          OR COALESCE(l.detail->>'file_name', '') ILIKE $${kwIdx}
          OR COALESCE(l.detail->>'resource_name', '') ILIKE $${kwIdx}
        )
      `)
    }
    const safePage = Math.max(Number(page) || 1, 1)
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM operation_logs l
      LEFT JOIN users u ON u.id = l.operator_id
      LEFT JOIN resources r ON r.id = l.target_id::bigint
      ${whereClause}
    `
    const countResult = await pool.query(countSql, values)
    const total = Number(countResult.rows[0]?.total || 0)
    const queryValues = [...values, safePageSize, (safePage - 1) * safePageSize]
    const listSql = `
      SELECT
        l.id,
        l.operator_id,
        COALESCE(u.name, '') AS operator_name,
        COALESCE(u.phone, '') AS operator_phone,
        l.target_id AS resource_id,
        COALESCE(r.name, l.detail->>'resource_name', '') AS resource_name,
        COALESCE(l.detail->>'file_name', '') AS file_name,
        l.created_at
      FROM operation_logs l
      LEFT JOIN users u ON u.id = l.operator_id
      LEFT JOIN resources r ON r.id = l.target_id::bigint
      ${whereClause}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `
    const { rows } = await pool.query(listSql, queryValues)
    return res.json({
      data: rows.map((row) => ({
        id: row.id,
        operator_id: row.operator_id,
        operator_name: row.operator_name,
        operator_phone: row.operator_phone,
        resource_id: String(row.resource_id || ''),
        resource_name: row.resource_name || '',
        file_name: row.file_name || '',
        created_at: row.created_at,
      })),
      pagination: { total, page: safePage, pageSize: safePageSize },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载资料下载审计失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/resources', authRequired, async (req, res) => {
  if (!canManageResources(req)) return res.status(403).json({ message: '无权限新增资料' })
  const name = String(req.body?.name || '').trim()
  const fileUrl = String(req.body?.fileUrl || '').trim()
  const fileType = String(req.body?.fileType || '').trim() || 'file'
  const folder = 'other'
  const subjectId = Number(req.body?.subjectId ?? req.body?.subject_id)
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : []
  if (!name) return res.status(400).json({ message: '资料名称不能为空' })
  if (!fileUrl) return res.status(400).json({ message: '文件地址不能为空' })
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    return res.status(400).json({ message: '请选择文件科目' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const subOk = await client.query(`SELECT 1 FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
    if (!subOk.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '科目不存在' })
    }
    if (!(await validateResourceClassScope({ req, classIds, client }))) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '仅可设置自己负责班级为可见范围' })
    }
    const insertResult = await client.query(
      `
      INSERT INTO resources (name, file_url, file_type, uploader_id, folder, subject_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id
      `,
      [name, fileUrl, fileType, req.auth?.userId || null, folder, subjectId],
    )
    const resourceId = Number(insertResult.rows[0]?.id || 0)
    const uniqueClassIds = Array.from(new Set(classIds))
    for (const classId of uniqueClassIds) {
      await client.query(
        `
        INSERT INTO resource_class_visibility (resource_id, class_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [resourceId, classId],
      )
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'resource.create',
      targetType: 'resource',
      targetId: String(resourceId),
      detail: { folder, subject_id: subjectId, class_ids: uniqueClassIds },
    })
    await client.query('COMMIT')
    return res.json({ data: { id: resourceId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '新增资料失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/resources/:id', authRequired, async (req, res) => {
  if (!canManageResources(req)) return res.status(403).json({ message: '无权限编辑资料' })
  const resourceId = Number(req.params.id)
  if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ message: '资料ID不合法' })
  const name = String(req.body?.name || '').trim()
  const folder = String(req.body?.folder || '').trim()
  const rawSubject = req.body?.subjectId ?? req.body?.subject_id
  const hasSubjectUpdate = rawSubject !== undefined && rawSubject !== null && String(rawSubject).trim() !== ''
  const subjectId = hasSubjectUpdate ? Number(rawSubject) : null
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (classIds && !(await validateResourceClassScope({ req, classIds, client }))) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '仅可设置自己负责班级为可见范围' })
    }
    if (hasSubjectUpdate && (!Number.isInteger(subjectId) || subjectId <= 0)) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '科目参数不合法' })
    }
    if (hasSubjectUpdate) {
      const subOk = await client.query(`SELECT 1 FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
      if (!subOk.rows[0]) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: '科目不存在' })
      }
    }
    const exists = await client.query(`SELECT id FROM resources WHERE id = $1 LIMIT 1`, [resourceId])
    if (!exists.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '资料不存在' })
    }
    if (name || folder || hasSubjectUpdate) {
      const updates = []
      const values = []
      if (name) {
        values.push(name)
        updates.push(`name = $${values.length}`)
      }
      if (folder) {
        values.push(folder)
        updates.push(`folder = $${values.length}`)
      }
      if (hasSubjectUpdate) {
        values.push(subjectId)
        updates.push(`subject_id = $${values.length}`)
      }
      values.push(resourceId)
      await client.query(`UPDATE resources SET ${updates.join(', ')} WHERE id = $${values.length}`, values)
    }
    if (classIds) {
      await client.query(`DELETE FROM resource_class_visibility WHERE resource_id = $1`, [resourceId])
      for (const classId of Array.from(new Set(classIds))) {
        await client.query(
          `
          INSERT INTO resource_class_visibility (resource_id, class_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [resourceId, classId],
        )
      }
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'resource.update',
      targetType: 'resource',
      targetId: String(resourceId),
      detail: {
        name: name || undefined,
        folder: folder || undefined,
        subject_id: hasSubjectUpdate ? subjectId : undefined,
        class_ids: classIds || undefined,
      },
    })
    await client.query('COMMIT')
    return res.json({ data: { id: resourceId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '更新资料失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/resources/:id/download', authRequired, async (req, res) => {
  const resourceId = Number(req.params.id)
  if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ message: '资料ID不合法' })
  try {
    const isAdmin = hasRole(req, 'admin')
    const isClassTeacher = hasRole(req, 'class_teacher')
    const isSubjectTeacher = hasRole(req, 'subject_teacher')
    const resourceResult = await pool.query(
      `
      SELECT id, name, file_url
      FROM resources
      WHERE id = $1
      LIMIT 1
      `,
      [resourceId],
    )
    const resource = resourceResult.rows[0]
    if (!resource) return res.status(404).json({ message: '资料不存在' })
    if (!isAdmin) {
      if (!isClassTeacher && !isSubjectTeacher) {
        return res.status(403).json({ message: '无权限下载该资料' })
      }
      const accessParts = []
      if (isClassTeacher) {
        accessParts.push(`EXISTS (SELECT 1 FROM classes c WHERE c.id = v.class_id AND c.owner_id = $2)`)
      }
      if (isSubjectTeacher) {
        accessParts.push(`EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = v.class_id AND ct.teacher_id = $2)`)
      }
      const accessResult = await pool.query(
        `
        SELECT
          NOT EXISTS (SELECT 1 FROM resource_class_visibility rv WHERE rv.resource_id = $1) AS is_global,
          EXISTS (
            SELECT 1
            FROM resource_class_visibility v
            WHERE v.resource_id = $1
              AND (${accessParts.join(' OR ')})
          ) AS matched
        `,
        [resourceId, req.auth?.userId || 0],
      )
      const access = accessResult.rows[0]
      if (!access?.is_global && !access?.matched) {
        return res.status(403).json({ message: '无权限下载该资料' })
      }
    }

    const fileUrl = String(resource.file_url || '')
    const expectedPrefix = `${UPLOAD_PUBLIC_BASE.replace(/\/$/, '')}/uploads/`
    if (!fileUrl.startsWith(expectedPrefix)) {
      return res.status(400).json({ message: '该资料非本地上传文件，无法通过系统下载' })
    }

    const fileName = fileUrl.slice(expectedPrefix.length)
    const safeFileName = path.basename(fileName)
    const absPath = path.resolve(UPLOAD_ROOT, safeFileName)
    if (!absPath.startsWith(UPLOAD_ROOT)) {
      return res.status(400).json({ message: '文件路径非法' })
    }
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ message: '文件不存在，可能已被移除' })
    }

    const displayName = String(resource.name || safeFileName)
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'resource.download',
      targetType: 'resource',
      targetId: String(resourceId),
      detail: { file_name: safeFileName, resource_name: displayName, resource_id: resourceId },
    })
    return res.download(absPath, displayName)
  } catch (error) {
    return res.status(500).json({ message: '下载资料失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.delete('/api/resources/:id', authRequired, async (req, res) => {
  if (!canManageResources(req)) return res.status(403).json({ message: '无权限删除资料' })
  const resourceId = Number(req.params.id)
  if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ message: '资料ID不合法' })
  const client = await pool.connect()
  let deletedFilePath = ''
  try {
    await client.query('BEGIN')
    const del = await client.query(`DELETE FROM resources WHERE id = $1 RETURNING id, file_url`, [resourceId])
    if (!del.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '资料不存在' })
    }
    const deletedFileUrl = String(del.rows[0].file_url || '')
    const expectedPrefix = `${UPLOAD_PUBLIC_BASE.replace(/\/$/, '')}/uploads/`
    if (deletedFileUrl.startsWith(expectedPrefix)) {
      const fileName = deletedFileUrl.slice(expectedPrefix.length)
      const safeFileName = path.basename(fileName)
      const absPath = path.resolve(UPLOAD_ROOT, safeFileName)
      if (absPath.startsWith(UPLOAD_ROOT)) {
        deletedFilePath = absPath
      }
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'resource.delete',
      targetType: 'resource',
      targetId: String(resourceId),
      detail: { local_file_deleted: Boolean(deletedFilePath) },
    })
    await client.query('COMMIT')
    if (deletedFilePath && fs.existsSync(deletedFilePath)) {
      try {
        fs.unlinkSync(deletedFilePath)
      } catch (unlinkError) {
        console.warn(`Failed to remove resource file: ${deletedFilePath}`, unlinkError)
      }
    }
    return res.json({ data: { id: resourceId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '删除资料失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/questions', authRequired, async (req, res) => {
  try {
    const { subject, type, keyword } = req.query
    const knowledgePoint = String(req.query?.knowledgePoint ?? req.query?.knowledge ?? '').trim()
    /** 仅按知识单元名称（knowledge_units.name）筛选 */
    const knowledgeUnitOnly = String(req.query?.knowledgeUnit ?? '').trim()
    /** 仅按知识点标签名（question_tags.name）筛选，与 knowledgePoint 区分：后者兼容题库模糊（单元或点） */
    const knowledgeTagOnly = String(req.query?.knowledgeTag ?? req.query?.tagName ?? '').trim()
    const collectMultiQuery = (key) => {
      const raw = req.query[key]
      if (raw == null) return []
      const arr = Array.isArray(raw) ? raw : [raw]
      const out = []
      for (const x of arr) {
        const s = String(x ?? '').trim()
        if (!s) continue
        for (const part of s.split(',')) {
          const t = part.trim()
          if (t) out.push(t)
        }
      }
      return [...new Set(out)]
    }
    const knowledgeUnitsMulti = collectMultiQuery('knowledgeUnits')
    const knowledgeTagsMulti = collectMultiQuery('knowledgeTags')
    const values = []
    const conditions = []

    if (subject) {
      const requested = String(subject).trim()
      const mappedSubject = subjectAliasMap[requested.toLowerCase()] || requested
      values.push(mappedSubject)
      conditions.push(`s.name = $${values.length}`)
    }

    if (type) {
      const typeNo = questionTypeMap[String(type)] || Number(type)
      if (!Number.isNaN(typeNo) && typeNo > 0) {
        values.push(typeNo)
        conditions.push(`q.question_type = $${values.length}`)
      }
    }

    if (keyword && String(keyword).trim()) {
      values.push(`%${String(keyword).trim()}%`)
      conditions.push(`q.stem ILIKE $${values.length}`)
    }

    if (knowledgePoint) {
      values.push(`%${knowledgePoint}%`)
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          LEFT JOIN knowledge_units ku ON ku.id = qt.unit_id
          WHERE qtr.question_id = q.id
            AND (qt.name ILIKE $${values.length} OR COALESCE(ku.name, '') ILIKE $${values.length})
        )`,
      )
    }

    if (knowledgeUnitsMulti.length > 0) {
      const parts = knowledgeUnitsMulti.map((unitName) => {
        values.push(unitName)
        return `
          EXISTS (
            SELECT 1
            FROM question_tag_rel qtr
            JOIN question_tags qt ON qt.id = qtr.tag_id
            JOIN knowledge_units ku ON ku.id = qt.unit_id
            WHERE qtr.question_id = q.id AND ku.name = $${values.length}
          )
        `
      })
      conditions.push(`(${parts.join(' OR ')})`)
    } else if (knowledgeUnitOnly) {
      values.push(`%${knowledgeUnitOnly}%`)
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          JOIN knowledge_units ku ON ku.id = qt.unit_id
          WHERE qtr.question_id = q.id AND ku.name ILIKE $${values.length}
        )`,
      )
    }

    if (knowledgeTagsMulti.length > 0) {
      const parts = knowledgeTagsMulti.map((tagName) => {
        values.push(tagName)
        return `
          EXISTS (
            SELECT 1
            FROM question_tag_rel qtr
            JOIN question_tags qt ON qt.id = qtr.tag_id
            WHERE qtr.question_id = q.id AND qt.name = $${values.length}
          )
        `
      })
      conditions.push(`(${parts.join(' OR ')})`)
    } else if (knowledgeTagOnly) {
      values.push(`%${knowledgeTagOnly}%`)
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM question_tag_rel qtr
          JOIN question_tags qt ON qt.id = qtr.tag_id
          WHERE qtr.question_id = q.id AND qt.name ILIKE $${values.length}
        )`,
      )
    }

    conditions.unshift('q.deleted_at IS NULL')
    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const explicitPaging = req.query?.page !== undefined && req.query?.page !== ''
    const page = Math.max(1, parseInt(String(req.query?.page ?? '1'), 10) || 1)
    let pageSize = Math.min(500, Math.max(1, parseInt(String(req.query?.pageSize ?? '500'), 10) || 500))
    if (explicitPaging) {
      pageSize = Math.min(100, Math.max(1, parseInt(String(req.query?.pageSize ?? '20'), 10) || 20))
    }
    const offset = (page - 1) * pageSize
    /** 先 materialize 筛选结果再 COUNT，避免窗口函数与外层 LIMIT 组合在部分计划下总条数不准 */
    const sql = `
      WITH base AS (
        SELECT
          q.id,
          q.question_type,
          q.stem,
          q.difficulty,
          q.updated_at,
          COALESCE(
            (
              SELECT MIN(ku.name)
              FROM question_tag_rel qtr
              JOIN question_tags qt ON qt.id = qtr.tag_id
              LEFT JOIN knowledge_units ku ON ku.id = qt.unit_id
              WHERE qtr.question_id = q.id
            ),
            ''
          ) AS knowledge_unit,
          COALESCE(
            (
              SELECT string_agg(qt.name, '、' ORDER BY qt.name)
              FROM question_tag_rel qtr
              JOIN question_tags qt ON qt.id = qtr.tag_id
              WHERE qtr.question_id = q.id
            ),
            ''
          ) AS knowledge_points
        FROM questions q
        JOIN subjects s ON s.id = q.subject_id
        ${whereClause}
      ),
      tot AS (SELECT COUNT(*)::int AS c FROM base)
      SELECT b.*, tot.c AS __total
      FROM base b
      CROSS JOIN tot
      ORDER BY b.updated_at DESC, b.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const { rows } = await pool.query(sql, values)
    const total = rows.length > 0 ? Number(rows[0].__total ?? 0) : 0
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-QuizWiz-Api-Revision', String(API_REVISION))
    res.json({
      meta: { api_revision: API_REVISION },
      data: rows.map((row) => {
        const ku = String(row?.knowledge_unit ?? row?.knowledgeUnit ?? '').trim()
        const kp = String(
          row?.knowledge_points ??
            row?.Knowledge_points ??
            row?.knowledgePoints ??
            row?.knowledgepoints ??
            '',
        ).trim()
        const tagList = kp
          ? kp
              .split('、')
              .map((s) => s.trim())
              .filter(Boolean)
          : []
        const qType = row?.question_type
        return {
          id: row?.id,
          question_type: qType,
          question_type_text: questionTypeLabelMap[qType] || String(qType),
          stem: row?.stem,
          difficulty: row?.difficulty,
          difficulty_text: difficultyTextFromDb(row?.difficulty),
          /** 列表与详情对齐：字符串摘要 + 标签名数组（无标签时为空串 / 空数组） */
          knowledge_unit: ku,
          knowledgeUnit: ku,
          knowledge_points: kp,
          knowledgePoints: kp,
          knowledgePointTags: tagList,
          updated_at: row?.updated_at,
        }
      }),
      pagination: { total, page, pageSize },
    })
  } catch (error) {
    res.status(500).json({ message: '题库列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/questions/quality-audit', authRequired, async (_req, res) => {
  try {
    const result = await pool.query(
      `
      WITH option_agg AS (
        SELECT
          question_id,
          COUNT(*)::int AS option_count,
          ARRAY_AGG(UPPER(option_key)) AS option_keys
        FROM question_options
        GROUP BY question_id
      ),
      base AS (
        SELECT
          q.id AS question_id,
          s.name AS subject_name,
          q.question_type,
          q.stem,
          q.answer_text,
          COALESCE(oa.option_count, 0) AS option_count,
          COALESCE(oa.option_keys, ARRAY[]::text[]) AS option_keys
        FROM questions q
        JOIN subjects s ON s.id = q.subject_id
        LEFT JOIN option_agg oa ON oa.question_id = q.id
        WHERE q.deleted_at IS NULL
      ),
      issues AS (
        SELECT question_id, subject_name, question_type, stem, 'empty_stem'::text AS issue_code, '题干为空'::text AS issue_label FROM base WHERE COALESCE(TRIM(stem), '') = ''
        UNION ALL
        SELECT question_id, subject_name, question_type, stem, 'empty_answer'::text AS issue_code, '答案为空'::text AS issue_label FROM base WHERE COALESCE(TRIM(answer_text), '') = ''
        UNION ALL
        SELECT question_id, subject_name, question_type, stem, 'missing_options'::text AS issue_code, '选择/判断题选项不足2个'::text AS issue_label
        FROM base WHERE question_type IN (1,2,3) AND option_count < 2
        UNION ALL
        SELECT question_id, subject_name, question_type, stem, 'answer_not_in_options'::text AS issue_code, '答案不在选项内'::text AS issue_label
        FROM base
        WHERE question_type = 1
          AND COALESCE(TRIM(answer_text), '') <> ''
          AND NOT (UPPER(TRIM(answer_text)) = ANY(option_keys))
        UNION ALL
        SELECT question_id, subject_name, question_type, stem, 'invalid_multi_answer'::text AS issue_code, '多选答案格式非法或不在选项内'::text AS issue_label
        FROM base
        WHERE question_type = 2
          AND COALESCE(TRIM(answer_text), '') <> ''
          AND EXISTS (
            SELECT 1
            FROM unnest(regexp_split_to_array(replace(UPPER(answer_text), '，', ','), ',')) AS a(raw_item)
            WHERE TRIM(raw_item) = '' OR NOT (TRIM(raw_item) = ANY(option_keys))
          )
      )
      SELECT * FROM issues
      ORDER BY issue_code, question_id DESC
      LIMIT 2000
      `,
    )
    const rows = result.rows.map((row) => ({
      question_id: row.question_id,
      subject_name: row.subject_name,
      question_type: row.question_type,
      question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
      stem: row.stem || '',
      issue_code: row.issue_code,
      issue_label: row.issue_label,
    }))
    const summaryMap = new Map()
    rows.forEach((item) => {
      const prev = summaryMap.get(item.issue_code) || { issue_code: item.issue_code, issue_label: item.issue_label, count: 0 }
      prev.count += 1
      summaryMap.set(item.issue_code, prev)
    })
    return res.json({
      data: {
        summary: Array.from(summaryMap.values()).sort((a, b) => b.count - a.count),
        rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '题库结构巡检失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/questions/quality-audit/fix', authRequired, async (req, res) => {
  const issueCode = String(req.body?.issueCode || '').trim()
  const fixableIssueCodes = ['missing_options', 'answer_not_in_options', 'invalid_multi_answer']
  if (issueCode && !fixableIssueCodes.includes(issueCode)) {
    return res.status(400).json({ message: 'issueCode 不支持自动修复' })
  }
  const targetIssueCodes = issueCode ? [issueCode] : fixableIssueCodes
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const baseResult = await client.query(
      `
      WITH option_agg AS (
        SELECT
          question_id,
          ARRAY_AGG(UPPER(option_key)) AS option_keys
        FROM question_options
        GROUP BY question_id
      )
      SELECT
        q.id AS question_id,
        q.question_type,
        q.answer_text,
        COALESCE(oa.option_keys, ARRAY[]::text[]) AS option_keys
      FROM questions q
      LEFT JOIN option_agg oa ON oa.question_id = q.id
      WHERE q.deleted_at IS NULL
      `,
    )

    let fixedCount = 0
    const fixedRows = []

    const hasIssueTarget = (code) => targetIssueCodes.includes(code)

    for (const row of baseResult.rows) {
      const questionId = Number(row.question_id || 0)
      const questionType = Number(row.question_type || 0)
      const answerText = String(row.answer_text || '').trim()
      const optionKeys = Array.isArray(row.option_keys) ? row.option_keys.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean) : []

      // 1) 判断题缺选项：自动补A=对，B=错，并标准化答案
      if (questionType === 3 && hasIssueTarget('missing_options') && optionKeys.length < 2) {
        await client.query(`DELETE FROM question_options WHERE question_id = $1`, [questionId])
        await client.query(
          `
          INSERT INTO question_options (question_id, option_key, option_text, sort_order)
          VALUES
            ($1, 'A', '对', 1),
            ($1, 'B', '错', 2)
          `,
          [questionId],
        )
        const normalizedJudgeAnswer =
          answerText === '对' || answerText.toUpperCase() === 'A'
            ? 'A'
            : answerText === '错' || answerText.toUpperCase() === 'B'
              ? 'B'
              : 'A'
        await client.query(`UPDATE questions SET answer_text = $1, updated_at = NOW() WHERE id = $2`, [normalizedJudgeAnswer, questionId])
        await writeQuestionVersion({
          client,
          questionId,
          action: 'quality_audit_fix',
          operatorId: req.auth?.userId,
          meta: { issue_code: 'missing_options' },
        })
        fixedCount += 1
        fixedRows.push({ question_id: questionId, issue_code: 'missing_options' })
        continue
      }

      // 2) 单选答案不在选项内：自动转大写并校正到首个可用选项
      if (questionType === 1 && hasIssueTarget('answer_not_in_options') && optionKeys.length > 0) {
        const upper = answerText.toUpperCase()
        if (!optionKeys.includes(upper)) {
          const normalizedSingleAnswer = optionKeys.includes('A') ? 'A' : optionKeys[0]
          await client.query(`UPDATE questions SET answer_text = $1, updated_at = NOW() WHERE id = $2`, [normalizedSingleAnswer, questionId])
          await writeQuestionVersion({
            client,
            questionId,
            action: 'quality_audit_fix',
            operatorId: req.auth?.userId,
            meta: { issue_code: 'answer_not_in_options' },
          })
          fixedCount += 1
          fixedRows.push({ question_id: questionId, issue_code: 'answer_not_in_options' })
          continue
        }
      }

      // 3) 多选答案格式非法/不在选项内：自动规范化（去重、过滤无效项、排序）
      if (questionType === 2 && hasIssueTarget('invalid_multi_answer') && answerText) {
        const parsed = Array.from(
          new Set(
            answerText
              .replace(/，/g, ',')
              .split(',')
              .map((item) => item.trim().toUpperCase())
              .filter(Boolean)
              .filter((item) => optionKeys.includes(item)),
          ),
        ).sort()
        if (parsed.length >= 2) {
          const normalizedMultiAnswer = parsed.join(',')
          if (normalizedMultiAnswer !== answerText) {
            await client.query(`UPDATE questions SET answer_text = $1, updated_at = NOW() WHERE id = $2`, [normalizedMultiAnswer, questionId])
            await writeQuestionVersion({
              client,
              questionId,
              action: 'quality_audit_fix',
              operatorId: req.auth?.userId,
              meta: { issue_code: 'invalid_multi_answer' },
            })
            fixedCount += 1
            fixedRows.push({ question_id: questionId, issue_code: 'invalid_multi_answer' })
            continue
          }
        }
      }
    }

    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.quality_audit_fix',
      targetType: 'question',
      targetId: issueCode || 'all',
      detail: {
        issue_codes: targetIssueCodes,
        fixed_count: fixedCount,
      },
    })

    await client.query('COMMIT')
    return res.json({
      data: {
        issue_codes: targetIssueCodes,
        fixed_count: fixedCount,
        rows: fixedRows,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '结构问题自动修复失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/questions', authRequired, async (req, res) => {
  const subjectName = String(req.body?.subject || '').trim()
  const typeValue = String(req.body?.type || '').trim()
  const stem = String(req.body?.stem || '').trim()
  const answer = String(req.body?.answer || '').trim()
  const explanation = String(req.body?.explanation || '').trim()
  const difficultyRaw = String(req.body?.difficulty ?? '').trim()
  const optionA = String(req.body?.optionA || '').trim()
  const optionB = String(req.body?.optionB || '').trim()
  const optionC = String(req.body?.optionC || '').trim()
  const optionD = String(req.body?.optionD || '').trim()
  const knowledgeUnit = String(req.body?.knowledgeUnit ?? '').trim()
  const knowledgePoints = Array.isArray(req.body?.knowledgePoints) ? req.body.knowledgePoints : []

  if (!subjectName) {
    return res.status(400).json({ message: '科目不能为空' })
  }
  if (!stem) {
    return res.status(400).json({ message: '题干不能为空' })
  }
  if (!answer) {
    return res.status(400).json({ message: '答案不能为空' })
  }

  const questionType = questionTypeMap[typeValue]
  if (!questionType) {
    return res.status(400).json({ message: '题型不合法' })
  }
  const difficulty = parseDifficultyLevel(difficultyRaw === '' ? '3' : difficultyRaw)
  if (difficulty === null) {
    return res.status(400).json({ message: '难度不合法，请使用 1–5 的整数（1 最易，5 最难；仍兼容 简单/中等/困难）' })
  }
  if (knowledgePoints.length > 0 && !knowledgeUnit) {
    return res.status(400).json({ message: '填写知识点时须同时填写知识单元' })
  }
  const optionMap = {
    A: optionA,
    B: optionB,
    C: optionC,
    D: optionD,
  }
  const availableOptionKeys = Object.entries(optionMap)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
  let normalizedAnswer = answer
  if (questionType === 3) {
    const upper = answer.toUpperCase()
    if (answer === '对' || upper === 'A') {
      normalizedAnswer = 'A'
    } else if (answer === '错' || upper === 'B') {
      normalizedAnswer = 'B'
    } else {
      return res.status(400).json({ message: '判断题答案仅支持 A/B 或 对/错' })
    }
  } else if (questionType === 1) {
    const upper = answer.toUpperCase()
    if (!['A', 'B', 'C', 'D'].includes(upper)) {
      return res.status(400).json({ message: '单选题答案仅支持 A/B/C/D' })
    }
    if (!availableOptionKeys.includes(upper)) {
      return res.status(400).json({ message: '单选题答案必须落在已填写选项内' })
    }
    normalizedAnswer = upper
  } else if (questionType === 2) {
    const picked = Array.from(
      new Set(
        answer
          .replace(/，/g, ',')
          .split(',')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      ),
    )
    if (picked.length < 2) {
      return res.status(400).json({ message: '多选题答案至少包含2个选项' })
    }
    if (picked.some((item) => !['A', 'B', 'C', 'D'].includes(item))) {
      return res.status(400).json({ message: '多选题答案仅支持 A/B/C/D，使用逗号分隔' })
    }
    if (picked.some((item) => !availableOptionKeys.includes(item))) {
      return res.status(400).json({ message: '多选题答案必须落在已填写选项内' })
    }
    normalizedAnswer = picked.join(',')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const mappedSubject = subjectAliasMap[subjectName.toLowerCase()] || subjectName
    const subjectResult = await client.query(
      `
      SELECT id, name
      FROM subjects
      WHERE name = $1
      LIMIT 1
      `,
      [mappedSubject],
    )
    const subjectId = subjectResult.rows[0]?.id
    if (!subjectId) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: `科目不存在(${subjectName})` })
    }

    const questionResult = await client.query(
      `
      INSERT INTO questions (
        subject_id, creator_id, question_type, stem, answer_text, explanation, difficulty, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, question_type, stem, difficulty, updated_at
      `,
      [subjectId, req.auth?.userId || 1, questionType, stem, normalizedAnswer, explanation || null, difficulty],
    )
    const questionId = questionResult.rows[0]?.id

    if (questionType === 1 || questionType === 2 || questionType === 3) {
      const options = [
        { key: 'A', value: optionA },
        { key: 'B', value: optionB },
        { key: 'C', value: optionC },
        { key: 'D', value: optionD },
      ].filter((item) => item.value)
      if (options.length < 2) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: '选择题/判断题至少填写2个选项' })
      }
      for (let index = 0; index < options.length; index += 1) {
        const option = options[index]
        await client.query(
          `
          INSERT INTO question_options (question_id, option_key, option_text, sort_order)
          VALUES ($1, $2, $3, $4)
          `,
          [questionId, option.key, option.value, index + 1],
        )
      }
    }

    await linkKnowledgePointsForQuestion(client, questionId, subjectId, knowledgeUnit, knowledgePoints)

    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.create',
      targetType: 'question',
      targetId: String(questionId),
      detail: {
        subject_id: subjectId,
        question_type: questionType,
        difficulty,
      },
    })
    await writeQuestionVersion({
      client,
      questionId,
      action: 'create',
      operatorId: req.auth?.userId,
      meta: { source: 'manual' },
    })

    await client.query('COMMIT')
    return res.json({
      data: {
        id: questionResult.rows[0].id,
        question_type: questionResult.rows[0].question_type,
        question_type_text: questionTypeLabelMap[questionResult.rows[0].question_type] || String(questionResult.rows[0].question_type),
        stem: questionResult.rows[0].stem,
        difficulty: questionResult.rows[0].difficulty,
        difficulty_text: difficultyTextFromDb(questionResult.rows[0].difficulty),
        updated_at: questionResult.rows[0].updated_at,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message === 'KNOWLEDGE_UNIT_NOT_IN_DICTIONARY') {
      return res.status(400).json({
        message: '知识单元不在该科目的字典中，请先在「系统设置 → 科目字典 → 知识单元」中配置后再选题',
      })
    }
    return res.status(500).json({ message: '新增题目失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/questions/:id', authRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  try {
    const questionResult = await pool.query(
      `
      SELECT
        q.id,
        q.question_type,
        q.stem,
        q.answer_text,
        q.explanation,
        q.difficulty,
        q.updated_at,
        s.name AS subject_name
      FROM questions q
      JOIN subjects s ON s.id = q.subject_id
      WHERE q.id = $1 AND q.deleted_at IS NULL
      LIMIT 1
      `,
      [questionId],
    )
    const row = questionResult.rows[0]
    if (!row) return res.status(404).json({ message: '题目不存在' })
    const optionsResult = await pool.query(
      `
      SELECT option_key, option_text, sort_order
      FROM question_options
      WHERE question_id = $1
      ORDER BY sort_order ASC, option_key ASC
      `,
      [questionId],
    )
    const tagsResult = await pool.query(
      `
      SELECT COALESCE(ku.name, '') AS unit_name, t.name AS point_name
      FROM question_tag_rel r
      JOIN question_tags t ON t.id = r.tag_id
      LEFT JOIN knowledge_units ku ON ku.id = t.unit_id
      WHERE r.question_id = $1
      ORDER BY ku.name ASC NULLS LAST, t.name ASC
      `,
      [questionId],
    )
    const unitNames = [...new Set(tagsResult.rows.map((item) => String(item.unit_name || '').trim()).filter(Boolean))]
    const knowledgeUnit = unitNames.length === 1 ? unitNames[0] : unitNames[0] || ''
    const knowledgePoints = tagsResult.rows.map((item) => String(item.point_name || '').trim()).filter(Boolean)
    return res.json({
      data: {
        id: row.id,
        subject: row.subject_name,
        type: row.question_type,
        stem: row.stem,
        answer: row.answer_text,
        explanation: row.explanation || '',
        difficulty: row.difficulty,
        updated_at: row.updated_at,
        options: optionsResult.rows,
        knowledgeUnit,
        knowledgePoints,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载题目详情失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/questions/:id/versions', authRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  try {
    const result = await pool.query(
      `
      SELECT
        v.id,
        v.action,
        v.snapshot,
        v.operator_id,
        COALESCE(u.name, '') AS operator_name,
        v.created_at
      FROM question_versions v
      LEFT JOIN users u ON u.id = v.operator_id
      WHERE v.question_id = $1
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT 100
      `,
      [questionId],
    )
    return res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        snapshot: row.snapshot || {},
        operator_id: row.operator_id,
        operator_name: row.operator_name || '',
        created_at: row.created_at,
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: '加载题目版本历史失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/questions/:id/versions/:versionId/restore', authRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  const versionId = Number(req.params.versionId)
  if (!Number.isInteger(questionId) || questionId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
    return res.status(400).json({ message: '参数不合法' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existsResult = await client.query(`SELECT id FROM questions WHERE id = $1 LIMIT 1`, [questionId])
    if (!existsResult.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '题目不存在' })
    }
    const versionResult = await client.query(
      `
      SELECT id, snapshot
      FROM question_versions
      WHERE id = $1 AND question_id = $2
      LIMIT 1
      `,
      [versionId, questionId],
    )
    const versionRow = versionResult.rows[0]
    if (!versionRow) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '版本不存在' })
    }
    const snapshot = versionRow.snapshot && typeof versionRow.snapshot === 'object' ? versionRow.snapshot : {}
    const subjectId = Number(snapshot.subject_id || 0)
    const questionType = Number(snapshot.question_type || 0)
    const stem = String(snapshot.stem || '').trim()
    const answerText = String(snapshot.answer_text || '').trim()
    const explanation = String(snapshot.explanation || '').trim()
    const difficulty = Number(snapshot.difficulty || 0)
    const options = Array.isArray(snapshot.options) ? snapshot.options : []
    const knowledgeUnit = String(snapshot.knowledge_unit || '').trim()
    const knowledgePoints = Array.isArray(snapshot.knowledge_points) ? snapshot.knowledge_points : []
    if (!subjectId || !questionType || !stem || !answerText || ![1, 2, 3, 4, 5].includes(difficulty)) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '版本快照不完整，无法回滚' })
    }
    const subjectCheck = await client.query(`SELECT id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId])
    if (!subjectCheck.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '版本中的科目已不存在，无法回滚' })
    }
    await client.query(
      `
      UPDATE questions
      SET subject_id = $1, question_type = $2, stem = $3, answer_text = $4, explanation = $5, difficulty = $6, deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
      WHERE id = $7
      `,
      [subjectId, questionType, stem, answerText, explanation || null, difficulty, questionId],
    )
    await client.query(`DELETE FROM question_options WHERE question_id = $1`, [questionId])
    for (const item of options) {
      const optionKey = String(item?.option_key || '').trim().toUpperCase()
      const optionText = String(item?.option_text || '').trim()
      const sortOrder = Number(item?.sort_order || 0)
      if (!optionKey || !optionText) continue
      await client.query(
        `
        INSERT INTO question_options (question_id, option_key, option_text, sort_order)
        VALUES ($1, $2, $3, $4)
        `,
        [questionId, optionKey, optionText, sortOrder > 0 ? sortOrder : 1],
      )
    }
    await client.query(`DELETE FROM question_tag_rel WHERE question_id = $1`, [questionId])
    await linkKnowledgePointsForQuestion(client, questionId, subjectId, knowledgeUnit, knowledgePoints)
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.version_restore',
      targetType: 'question',
      targetId: String(questionId),
      detail: { version_id: versionId },
    })
    await writeQuestionVersion({
      client,
      questionId,
      action: 'version_restore',
      operatorId: req.auth?.userId,
      meta: { from_version_id: versionId },
    })
    await client.query('COMMIT')
    return res.json({ data: { id: questionId, version_id: versionId } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message === 'KNOWLEDGE_UNIT_NOT_IN_DICTIONARY') {
      return res.status(400).json({
        message: '快照中的知识单元已不在当前科目字典中，请先在系统设置维护知识单元后再回滚',
      })
    }
    return res.status(500).json({ message: '版本回滚失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.put('/api/questions/:id', authRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  const subjectName = String(req.body?.subject || '').trim()
  const typeValue = String(req.body?.type || '').trim()
  const stem = String(req.body?.stem || '').trim()
  const answer = String(req.body?.answer || '').trim()
  const explanation = String(req.body?.explanation || '').trim()
  const difficultyRaw = String(req.body?.difficulty ?? '').trim()
  const optionA = String(req.body?.optionA || '').trim()
  const optionB = String(req.body?.optionB || '').trim()
  const optionC = String(req.body?.optionC || '').trim()
  const optionD = String(req.body?.optionD || '').trim()
  const knowledgeUnit = String(req.body?.knowledgeUnit ?? '').trim()
  const knowledgePoints = Array.isArray(req.body?.knowledgePoints) ? req.body.knowledgePoints : []

  if (!subjectName) return res.status(400).json({ message: '科目不能为空' })
  if (!stem) return res.status(400).json({ message: '题干不能为空' })
  if (!answer) return res.status(400).json({ message: '答案不能为空' })

  const questionType = questionTypeMap[typeValue]
  if (!questionType) return res.status(400).json({ message: '题型不合法' })
  const difficulty = parseDifficultyLevel(difficultyRaw === '' ? '3' : difficultyRaw)
  if (difficulty === null) {
    return res.status(400).json({ message: '难度不合法，请使用 1–5 的整数（仍兼容 简单/中等/困难）' })
  }
  if (knowledgePoints.length > 0 && !knowledgeUnit) {
    return res.status(400).json({ message: '填写知识点时须同时填写知识单元' })
  }

  const optionMap = { A: optionA, B: optionB, C: optionC, D: optionD }
  const availableOptionKeys = Object.entries(optionMap).filter(([, value]) => Boolean(value)).map(([key]) => key)
  let normalizedAnswer = answer
  if (questionType === 3) {
    const upper = answer.toUpperCase()
    if (answer === '对' || upper === 'A') normalizedAnswer = 'A'
    else if (answer === '错' || upper === 'B') normalizedAnswer = 'B'
    else return res.status(400).json({ message: '判断题答案仅支持 A/B 或 对/错' })
  } else if (questionType === 1) {
    const upper = answer.toUpperCase()
    if (!['A', 'B', 'C', 'D'].includes(upper)) return res.status(400).json({ message: '单选题答案仅支持 A/B/C/D' })
    if (!availableOptionKeys.includes(upper)) return res.status(400).json({ message: '单选题答案必须落在已填写选项内' })
    normalizedAnswer = upper
  } else if (questionType === 2) {
    const picked = Array.from(new Set(answer.replace(/，/g, ',').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)))
    if (picked.length < 2) return res.status(400).json({ message: '多选题答案至少包含2个选项' })
    if (picked.some((item) => !['A', 'B', 'C', 'D'].includes(item))) return res.status(400).json({ message: '多选题答案仅支持 A/B/C/D，使用逗号分隔' })
    if (picked.some((item) => !availableOptionKeys.includes(item))) return res.status(400).json({ message: '多选题答案必须落在已填写选项内' })
    normalizedAnswer = picked.join(',')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existsResult = await client.query(`SELECT id FROM questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [questionId])
    if (!existsResult.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '题目不存在' })
    }
    const mappedSubject = subjectAliasMap[subjectName.toLowerCase()] || subjectName
    const subjectResult = await client.query(`SELECT id FROM subjects WHERE name = $1 LIMIT 1`, [mappedSubject])
    const subjectId = subjectResult.rows[0]?.id
    if (!subjectId) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: `科目不存在(${subjectName})` })
    }

    await client.query(
      `
      UPDATE questions
      SET subject_id = $1, question_type = $2, stem = $3, answer_text = $4, explanation = $5, difficulty = $6, updated_at = NOW()
      WHERE id = $7
      `,
      [subjectId, questionType, stem, normalizedAnswer, explanation || null, difficulty, questionId],
    )

    await client.query(`DELETE FROM question_options WHERE question_id = $1`, [questionId])
    if (questionType === 1 || questionType === 2 || questionType === 3) {
      const options = [
        { key: 'A', value: optionA },
        { key: 'B', value: optionB },
        { key: 'C', value: optionC },
        { key: 'D', value: optionD },
      ].filter((item) => item.value)
      if (options.length < 2) {
        await client.query('ROLLBACK')
        return res.status(400).json({ message: '选择题/判断题至少填写2个选项' })
      }
      for (let index = 0; index < options.length; index += 1) {
        const option = options[index]
        await client.query(
          `
          INSERT INTO question_options (question_id, option_key, option_text, sort_order)
          VALUES ($1, $2, $3, $4)
          `,
          [questionId, option.key, option.value, index + 1],
        )
      }
    }

    await client.query(`DELETE FROM question_tag_rel WHERE question_id = $1`, [questionId])
    await linkKnowledgePointsForQuestion(client, questionId, subjectId, knowledgeUnit, knowledgePoints)

    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.update',
      targetType: 'question',
      targetId: String(questionId),
      detail: { subject_id: subjectId, question_type: questionType, difficulty },
    })
    await writeQuestionVersion({
      client,
      questionId,
      action: 'update',
      operatorId: req.auth?.userId,
      meta: {},
    })

    await client.query('COMMIT')
    return res.json({ data: { id: questionId } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message === 'KNOWLEDGE_UNIT_NOT_IN_DICTIONARY') {
      return res.status(400).json({
        message: '知识单元不在该科目的字典中，请先在「系统设置 → 科目字典 → 知识单元」中配置',
      })
    }
    return res.status(500).json({ message: '编辑题目失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.delete('/api/questions/:id', authRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existsResult = await client.query(`SELECT id FROM questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [questionId])
    if (!existsResult.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '题目不存在' })
    }
    const bindResult = await client.query(`SELECT COUNT(*)::int AS count FROM exam_questions WHERE question_id = $1`, [questionId])
    const bindCount = Number(bindResult.rows[0]?.count || 0)
    if (bindCount > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该题目仍被考试引用，请先删除或调整相关考试后再删除题目' })
    }

    await client.query(`UPDATE questions SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW() WHERE id = $2`, [req.auth?.userId || null, questionId])
    await purgeStudentPracticeDataForQuestionIds(client, [questionId])
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.delete',
      targetType: 'question',
      targetId: String(questionId),
      detail: {},
    })
    await writeQuestionVersion({
      client,
      questionId,
      action: 'soft_delete',
      operatorId: req.auth?.userId,
      meta: {},
    })
    await client.query('COMMIT')
    return res.json({ data: { id: questionId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '删除题目失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/question-recycle-bin', authRequired, async (req, res) => {
  try {
    const subject = String(req.query?.subject || '').trim()
    const values = []
    const conditions = ['q.deleted_at IS NOT NULL']
    if (subject) {
      const mapped = subjectAliasMap[subject.toLowerCase()] || subject
      values.push(mapped)
      conditions.push(`s.name = $${values.length}`)
    }
    const result = await pool.query(
      `
      SELECT
        q.id,
        q.question_type,
        q.stem,
        q.difficulty,
        q.deleted_at,
        q.updated_at,
        s.name AS subject_name
      FROM questions q
      JOIN subjects s ON s.id = q.subject_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY q.deleted_at DESC, q.id DESC
      LIMIT 1000
      `,
      values,
    )
    return res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        subject_name: row.subject_name,
        question_type: row.question_type,
        question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
        stem: row.stem,
        difficulty: row.difficulty,
        difficulty_text: difficultyTextFromDb(row.difficulty),
        deleted_at: row.deleted_at,
        updated_at: row.updated_at,
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: '加载回收站失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.patch('/api/questions/:id/restore', authRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  try {
    const result = await pool.query(
      `
      UPDATE questions
      SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING id
      `,
      [questionId],
    )
    if (!result.rows[0]) return res.status(404).json({ message: '回收站中未找到该题目' })
    await writeOperationLog({
      operatorId: req.auth?.userId,
      action: 'question.restore',
      targetType: 'question',
      targetId: String(questionId),
      detail: {},
    })
    await writeQuestionVersion({
      questionId,
      action: 'restore',
      operatorId: req.auth?.userId,
      meta: {},
    })
    return res.json({ data: { id: questionId } })
  } catch (error) {
    return res.status(500).json({ message: '恢复题目失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.delete('/api/questions/:id/permanent', authRequired, async (req, res) => {
  const questionId = Number(req.params.id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return res.status(400).json({ message: '题目ID不合法' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existsResult = await client.query(`SELECT id FROM questions WHERE id = $1 AND deleted_at IS NOT NULL LIMIT 1`, [questionId])
    if (!existsResult.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '回收站中未找到该题目' })
    }
    const bindResult = await client.query(`SELECT COUNT(*)::int AS count FROM exam_questions WHERE question_id = $1`, [questionId])
    if (Number(bindResult.rows[0]?.count || 0) > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该题目仍被考试引用，请先删除或调整相关考试后再彻底删除' })
    }
    await client.query(`DELETE FROM questions WHERE id = $1`, [questionId])
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.permanent_delete',
      targetType: 'question',
      targetId: String(questionId),
      detail: {},
    })
    await client.query('COMMIT')
    return res.json({ data: { id: questionId } })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '彻底删除题目失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/questions/recycle-bin/batch-restore', authRequired, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : []
  if (ids.length === 0) {
    return res.status(400).json({ message: 'ids 不能为空' })
  }
  const uniqueIds = Array.from(new Set(ids))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const successIds = []
    const failed = []
    for (const questionId of uniqueIds) {
      const result = await client.query(
        `
        UPDATE questions
        SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NOT NULL
        RETURNING id
        `,
        [questionId],
      )
      if (!result.rows[0]) {
        failed.push({ id: questionId, reason: '回收站中未找到该题目' })
        continue
      }
      await writeOperationLog({
        client,
        operatorId: req.auth?.userId,
        action: 'question.restore',
        targetType: 'question',
        targetId: String(questionId),
        detail: { from_batch: true },
      })
      await writeQuestionVersion({
        client,
        questionId,
        action: 'restore',
        operatorId: req.auth?.userId,
        meta: { from_batch: true },
      })
      successIds.push(questionId)
    }
    await client.query('COMMIT')
    return res.json({
      data: {
        total: uniqueIds.length,
        success_ids: successIds,
        failed,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '批量恢复题目失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/questions/recycle-bin/batch-permanent-delete', authRequired, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : []
  if (ids.length === 0) {
    return res.status(400).json({ message: 'ids 不能为空' })
  }
  const uniqueIds = Array.from(new Set(ids))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const successIds = []
    const failed = []
    for (const questionId of uniqueIds) {
      const existsResult = await client.query(`SELECT id FROM questions WHERE id = $1 AND deleted_at IS NOT NULL LIMIT 1`, [questionId])
      if (!existsResult.rows[0]) {
        failed.push({ id: questionId, reason: '回收站中未找到该题目' })
        continue
      }
      const bindResult = await client.query(`SELECT COUNT(*)::int AS count FROM exam_questions WHERE question_id = $1`, [questionId])
      if (Number(bindResult.rows[0]?.count || 0) > 0) {
        failed.push({ id: questionId, reason: '仍被考试引用，请先删除相关考试' })
        continue
      }
      await client.query(`DELETE FROM questions WHERE id = $1`, [questionId])
      await writeOperationLog({
        client,
        operatorId: req.auth?.userId,
        action: 'question.permanent_delete',
        targetType: 'question',
        targetId: String(questionId),
        detail: { from_batch: true },
      })
      successIds.push(questionId)
    }
    await client.query('COMMIT')
    return res.json({
      data: {
        total: uniqueIds.length,
        success_ids: successIds,
        failed,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '批量彻底删除题目失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.get('/api/question-duplicates', authRequired, async (req, res) => {
  try {
    const subject = String(req.query?.subject || '').trim()
    const markStatus = String(req.query?.markStatus || '').trim()
    const values = []
    const extraConditions = []
    if (subject) {
      const mapped = subjectAliasMap[subject.toLowerCase()] || subject
      values.push(mapped)
      extraConditions.push(`s.name = $${values.length}`)
    }
    if (markStatus) {
      values.push(markStatus)
      extraConditions.push(`COALESCE(dm.mark_status, 'pending') = $${values.length}`)
    }
    const whereExtra = extraConditions.length > 0 ? `AND ${extraConditions.join(' AND ')}` : ''
    const sql = `
      WITH normalized AS (
        SELECT
          q.id,
          q.subject_id,
          s.name AS subject_name,
          q.question_type,
          q.stem,
          q.updated_at,
          regexp_replace(lower(COALESCE(q.stem, '')), '[[:space:][:punct:]，。！？；：、“”‘’（）《》【】]+', '', 'g') AS norm_stem
        FROM questions q
        JOIN subjects s ON s.id = q.subject_id
        WHERE q.deleted_at IS NULL
      ),
      grouped AS (
        SELECT subject_id, norm_stem, COUNT(*) AS duplicate_count
        FROM normalized
        WHERE norm_stem <> ''
        GROUP BY subject_id, norm_stem
        HAVING COUNT(*) > 1
      )
      SELECT
        n.id AS question_id,
        n.subject_name,
        n.question_type,
        n.stem,
        n.updated_at,
        g.duplicate_count,
        md5(CONCAT(n.subject_id, ':', n.norm_stem)) AS duplicate_group_key,
        COALESCE(dm.mark_status, 'pending') AS mark_status,
        COALESCE(dm.note, '') AS note
      FROM normalized n
      JOIN grouped g ON g.subject_id = n.subject_id AND g.norm_stem = n.norm_stem
      LEFT JOIN question_duplicate_marks dm ON dm.question_id = n.id
      WHERE 1=1
      ${whereExtra}
      ORDER BY duplicate_group_key, n.updated_at DESC, n.id DESC
      LIMIT 1000
    `
    const result = await pool.query(sql, values)
    return res.json({
      data: result.rows.map((row) => ({
        question_id: row.question_id,
        subject_name: row.subject_name,
        question_type: row.question_type,
        question_type_text: questionTypeLabelMap[row.question_type] || String(row.question_type),
        stem: row.stem,
        updated_at: row.updated_at,
        duplicate_count: Number(row.duplicate_count || 0),
        duplicate_group_key: row.duplicate_group_key,
        mark_status: row.mark_status || 'pending',
        note: row.note || '',
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: '重复题检测失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.patch('/api/question-duplicates/mark', authRequired, async (req, res) => {
  const questionIds = Array.isArray(req.body?.questionIds)
    ? req.body.questionIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : []
  const markStatus = String(req.body?.markStatus || '').trim() || 'marked'
  const note = String(req.body?.note || '').trim()
  if (questionIds.length === 0) {
    return res.status(400).json({ message: 'questionIds 不能为空' })
  }
  if (!['pending', 'marked', 'ignored'].includes(markStatus)) {
    return res.status(400).json({ message: 'markStatus 不合法' })
  }
  const uniqueIds = Array.from(new Set(questionIds))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const successIds = []
    const failed = []
    for (const questionId of uniqueIds) {
      const exists = await client.query(`SELECT id FROM questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [questionId])
      if (!exists.rows[0]) {
        failed.push({ id: questionId, reason: '题目不存在' })
        continue
      }
      await client.query(
        `
        INSERT INTO question_duplicate_marks (question_id, mark_status, note, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (question_id)
        DO UPDATE SET mark_status = EXCLUDED.mark_status, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        `,
        [questionId, markStatus, note || null, req.auth?.userId || null],
      )
      successIds.push(questionId)
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.duplicate_mark',
      targetType: 'question',
      targetId: uniqueIds.join(','),
      detail: { mark_status: markStatus, note, success_count: successIds.length },
    })
    await client.query('COMMIT')
    return res.json({
      data: {
        total: uniqueIds.length,
        success_ids: successIds,
        failed,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '重复题标记失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/question-duplicates/merge-group', authRequired, async (req, res) => {
  const duplicateGroupKey = String(req.body?.duplicateGroupKey || '').trim()
  const keepQuestionId = Number(req.body?.keepQuestionId)
  if (!duplicateGroupKey) {
    return res.status(400).json({ message: 'duplicateGroupKey 不能为空' })
  }
  if (!Number.isInteger(keepQuestionId) || keepQuestionId <= 0) {
    return res.status(400).json({ message: 'keepQuestionId 不合法' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const groupResult = await client.query(
      `
      WITH normalized AS (
        SELECT
          q.id,
          q.subject_id,
          q.question_type,
          regexp_replace(lower(COALESCE(q.stem, '')), '[[:space:][:punct:]，。！？；：、“”‘’（）《》【】]+', '', 'g') AS norm_stem
        FROM questions q
        WHERE q.deleted_at IS NULL
      )
      SELECT
        id,
        subject_id,
        question_type
      FROM normalized
      WHERE md5(CONCAT(subject_id, ':', norm_stem)) = $1
      ORDER BY id ASC
      `,
      [duplicateGroupKey],
    )
    const groupRows = groupResult.rows
    if (groupRows.length < 2) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该分组重复题不足2条，无法合并' })
    }
    const keepRow = groupRows.find((item) => Number(item.id) === keepQuestionId)
    if (!keepRow) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '保留题目不在该重复组内' })
    }
    const hasMismatch = groupRows.some(
      (item) =>
        Number(item.subject_id) !== Number(keepRow.subject_id) ||
        Number(item.question_type) !== Number(keepRow.question_type),
    )
    if (hasMismatch) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '该组题目存在科目或题型不一致，不能合并' })
    }

    const mergeIds = groupRows.map((item) => Number(item.id)).filter((id) => id !== keepQuestionId)
    for (const mergeId of mergeIds) {
      await client.query(
        `
        INSERT INTO exam_questions (exam_id, question_id, score, sort_order)
        SELECT exam_id, $1, score, sort_order
        FROM exam_questions
        WHERE question_id = $2
        ON CONFLICT (exam_id, question_id)
        DO UPDATE SET score = GREATEST(exam_questions.score, EXCLUDED.score)
        `,
        [keepQuestionId, mergeId],
      )
      await client.query(`DELETE FROM exam_questions WHERE question_id = $1`, [mergeId])

      await client.query(
        `
        INSERT INTO answers (submission_id, question_id, student_answer, score, is_correct, time_spent)
        SELECT submission_id, $1, student_answer, score, is_correct, time_spent
        FROM answers
        WHERE question_id = $2
        ON CONFLICT (submission_id, question_id)
        DO UPDATE SET
          student_answer = COALESCE(answers.student_answer, EXCLUDED.student_answer),
          score = COALESCE(answers.score, EXCLUDED.score),
          is_correct = COALESCE(answers.is_correct, EXCLUDED.is_correct),
          time_spent = COALESCE(answers.time_spent, EXCLUDED.time_spent)
        `,
        [keepQuestionId, mergeId],
      )
      await client.query(`DELETE FROM answers WHERE question_id = $1`, [mergeId])

      await client.query(
        `
        INSERT INTO question_tag_rel (question_id, tag_id)
        SELECT $1, tag_id
        FROM question_tag_rel
        WHERE question_id = $2
        ON CONFLICT DO NOTHING
        `,
        [keepQuestionId, mergeId],
      )
    }

    if (mergeIds.length > 0) {
      await purgeStudentPracticeDataForQuestionIds(client, mergeIds)
      await client.query(`UPDATE questions SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW() WHERE id = ANY($2::bigint[])`, [req.auth?.userId || null, mergeIds])
    }
    await client.query(
      `
      INSERT INTO question_duplicate_marks (question_id, mark_status, note, updated_by, updated_at)
      VALUES ($1, 'marked', 'duplicate merged as keep item', $2, NOW())
      ON CONFLICT (question_id)
      DO UPDATE SET mark_status = 'marked', note = 'duplicate merged as keep item', updated_by = EXCLUDED.updated_by, updated_at = NOW()
      `,
      [keepQuestionId, req.auth?.userId || null],
    )

    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.duplicate_merge',
      targetType: 'question',
      targetId: String(keepQuestionId),
      detail: {
        duplicate_group_key: duplicateGroupKey,
        keep_question_id: keepQuestionId,
        merged_question_ids: mergeIds,
      },
    })

    await client.query('COMMIT')
    return res.json({
      data: {
        duplicate_group_key: duplicateGroupKey,
        keep_question_id: keepQuestionId,
        merged_question_ids: mergeIds,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '重复题合并失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/questions/batch-delete', authRequired, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : []
  if (ids.length === 0) {
    return res.status(400).json({ message: 'ids 不能为空' })
  }
  const uniqueIds = Array.from(new Set(ids))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const successIds = []
    const failed = []
    for (const questionId of uniqueIds) {
      const existsResult = await client.query(`SELECT id FROM questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [questionId])
      if (!existsResult.rows[0]) {
        failed.push({ id: questionId, reason: '题目不存在' })
        continue
      }
      const bindResult = await client.query(`SELECT COUNT(*)::int AS count FROM exam_questions WHERE question_id = $1`, [questionId])
      const bindCount = Number(bindResult.rows[0]?.count || 0)
      if (bindCount > 0) {
        failed.push({ id: questionId, reason: '仍被考试引用，请先删除相关考试' })
        continue
      }
      await client.query(`UPDATE questions SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW() WHERE id = $2`, [req.auth?.userId || null, questionId])
      await writeOperationLog({
        client,
        operatorId: req.auth?.userId,
        action: 'question.delete',
        targetType: 'question',
        targetId: String(questionId),
        detail: { from_batch: true },
      })
      successIds.push(questionId)
    }
    if (successIds.length > 0) {
      await purgeStudentPracticeDataForQuestionIds(client, successIds)
    }
    await client.query('COMMIT')
    return res.json({
      data: {
        total: uniqueIds.length,
        success_ids: successIds,
        failed,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({ message: '批量删除题目失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.patch('/api/questions/batch-attrs', authRequired, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : []
  const subjectName = String(req.body?.subject || '').trim()
  const difficultyValue = String(req.body?.difficulty || '').trim()
  const addKnowledgeUnit = String(req.body?.addKnowledgeUnit || '').trim()
  const addKnowledgePoints = Array.isArray(req.body?.addKnowledgePoints) ? req.body.addKnowledgePoints : []
  const removeKnowledgePoints = Array.isArray(req.body?.removeKnowledgePoints) ? req.body.removeKnowledgePoints : []
  if (ids.length === 0) {
    return res.status(400).json({ message: 'ids 不能为空' })
  }
  if (addKnowledgePoints.length > 0 && !addKnowledgeUnit) {
    return res.status(400).json({ message: '批量新增知识点时须在请求体中提供 addKnowledgeUnit（知识单元名称）' })
  }
  const hasUpdates = Boolean(subjectName || difficultyValue || addKnowledgePoints.length > 0 || removeKnowledgePoints.length > 0)
  if (!hasUpdates) {
    return res.status(400).json({ message: '至少提供一个需要更新的属性' })
  }
  let subjectId = null
  if (subjectName) {
    const mappedSubject = subjectAliasMap[subjectName.toLowerCase()] || subjectName
    const subjectResult = await pool.query(`SELECT id FROM subjects WHERE name = $1 LIMIT 1`, [mappedSubject])
    subjectId = subjectResult.rows[0]?.id || null
    if (!subjectId) {
      return res.status(400).json({ message: `科目不存在(${subjectName})` })
    }
  }
  let difficulty = null
  if (difficultyValue) {
    difficulty = parseDifficultyLevel(difficultyValue)
    if (difficulty === null) {
      return res.status(400).json({ message: '难度不合法，请使用 1–5（仍兼容 简单/中等/困难）' })
    }
  }
  const uniqueIds = Array.from(new Set(ids))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const successIds = []
    const failed = []
    for (const questionId of uniqueIds) {
      const existsResult = await client.query(`SELECT id FROM questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [questionId])
      if (!existsResult.rows[0]) {
        failed.push({ id: questionId, reason: '题目不存在' })
        continue
      }
      const fields = []
      const values = []
      if (subjectId) {
        values.push(subjectId)
        fields.push(`subject_id = $${values.length}`)
      }
      if (difficulty) {
        values.push(difficulty)
        fields.push(`difficulty = $${values.length}`)
      }
      values.push(questionId)
      await client.query(
        `
        UPDATE questions
        SET ${fields.length > 0 ? `${fields.join(', ')},` : ''} updated_at = NOW()
        WHERE id = $${values.length} AND deleted_at IS NULL
        `,
        values,
      )

      if (addKnowledgePoints.length > 0) {
        const sidRow = await client.query(`SELECT subject_id FROM questions WHERE id = $1 LIMIT 1`, [questionId])
        const qSubjectId = Number(sidRow.rows[0]?.subject_id)
        await linkKnowledgePointsForQuestion(client, questionId, qSubjectId, addKnowledgeUnit, addKnowledgePoints)
      }
      for (const rawTag of removeKnowledgePoints) {
        const tag = String(rawTag || '').trim()
        if (!tag) continue
        await client.query(
          `
          DELETE FROM question_tag_rel
          WHERE question_id = $1 AND tag_id IN (
            SELECT qtr.tag_id
            FROM question_tag_rel qtr
            JOIN question_tags qt ON qt.id = qtr.tag_id
            WHERE qtr.question_id = $1 AND qt.name = $2
          )
          `,
          [questionId, tag],
        )
      }
      successIds.push(questionId)
    }
    await writeOperationLog({
      client,
      operatorId: req.auth?.userId,
      action: 'question.batch_update',
      targetType: 'question',
      targetId: uniqueIds.join(','),
      detail: {
        subject_id: subjectId,
        difficulty,
        add_knowledge_unit: addKnowledgeUnit,
        add_knowledge_points: addKnowledgePoints,
        remove_knowledge_points: removeKnowledgePoints,
        success_count: successIds.length,
      },
    })
    for (const questionId of successIds) {
      await writeQuestionVersion({
        client,
        questionId,
        action: 'batch_update',
        operatorId: req.auth?.userId,
        meta: {
          subject_id: subjectId,
          difficulty,
          add_knowledge_unit: addKnowledgeUnit,
          add_knowledge_points: addKnowledgePoints,
          remove_knowledge_points: removeKnowledgePoints,
        },
      })
    }
    await client.query('COMMIT')
    return res.json({
      data: {
        total: uniqueIds.length,
        success_ids: successIds,
        failed,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message === 'KNOWLEDGE_UNIT_NOT_IN_DICTIONARY') {
      return res.status(400).json({
        message: '批量新增失败：知识单元不在对应题目的科目字典中，请先在系统设置中配置',
      })
    }
    return res.status(500).json({ message: '批量更新题目属性失败', detail: error instanceof Error ? error.message : String(error) })
  } finally {
    client.release()
  }
})

app.post('/api/questions/import', authRequired, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
  if (rows.length === 0) {
    return res.status(400).json({ message: 'rows 不能为空' })
  }

  const client = await pool.connect()
  const errors = []
  let successRows = 0

  try {
    await client.query('BEGIN')
    const subjectResult = await client.query('SELECT id, name FROM subjects')
    const subjectMap = new Map(subjectResult.rows.map((s) => [String(s.name).trim(), s.id]))

    for (let i = 0; i < rows.length; i += 1) {
      const rowNo = i + 1
      const row = rows[i] || {}
      const subjectName = String(row.subject || '').trim()
      const typeValue = String(row.type || '').trim()
      const stem = String(row.stem || '').trim()
      const answer = String(row.answer || '').trim()
      const explanation = String(row.explanation || '').trim()
      const difficultyValue = String(row.difficulty || '').trim() || '3'
      const knowledgeUnit = String(row.knowledgeUnit || '').trim()
      const knowledgePoints = Array.isArray(row.knowledgePoints) ? row.knowledgePoints : []

      const subjectId = subjectMap.get(subjectAliasMap[subjectName.toLowerCase()] || subjectName)
      const questionType = questionTypeMap[typeValue]
      const difficulty = parseDifficultyLevel(difficultyValue)
      if (difficulty === null) {
        errors.push(`第${rowNo}行: 难度须为 1–5 的整数（仍兼容 简单/中等/困难）`)
        continue
      }

      if (!subjectId) {
        errors.push(`第${rowNo}行: 科目不存在(${subjectName || '空'})`)
        continue
      }
      if (!questionType) {
        errors.push(`第${rowNo}行: 题型非法(${typeValue || '空'})`)
        continue
      }
      if (!stem) {
        errors.push(`第${rowNo}行: 题干为空`)
        continue
      }
      if (!answer) {
        errors.push(`第${rowNo}行: 答案为空`)
        continue
      }
      if (knowledgePoints.length > 0 && !knowledgeUnit) {
        errors.push(`第${rowNo}行: 填写知识点时须同时填写知识单元`)
        continue
      }

      const insertQuestion = await client.query(
        `
        INSERT INTO questions (
          subject_id, creator_id, question_type, stem, answer_text, explanation, difficulty, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id
        `,
        [subjectId, req.auth?.userId || 1, questionType, stem, answer, explanation || null, difficulty],
      )

      const questionId = insertQuestion.rows[0]?.id
      if (!questionId) {
        errors.push(`第${rowNo}行: 题目插入失败`)
        continue
      }

      if (questionType === 1 || questionType === 2 || questionType === 3) {
        const options = [
          { key: 'A', value: String(row.optionA || '').trim() },
          { key: 'B', value: String(row.optionB || '').trim() },
          { key: 'C', value: String(row.optionC || '').trim() },
          { key: 'D', value: String(row.optionD || '').trim() },
        ].filter((opt) => opt.value)

        if (options.length < 2) {
          errors.push(`第${rowNo}行: 选择题至少需要2个选项`)
          continue
        }

        for (let j = 0; j < options.length; j += 1) {
          const option = options[j]
          await client.query(
            `
            INSERT INTO question_options (question_id, option_key, option_text, sort_order)
            VALUES ($1, $2, $3, $4)
            `,
            [questionId, option.key, option.value, j + 1],
          )
        }
      }

      try {
        await linkKnowledgePointsForQuestion(client, questionId, subjectId, knowledgeUnit, knowledgePoints)
      } catch (linkErr) {
        if (linkErr instanceof Error && linkErr.message === 'KNOWLEDGE_UNIT_NOT_IN_DICTIONARY') {
          await client.query(`DELETE FROM question_options WHERE question_id = $1`, [questionId])
          await client.query(`DELETE FROM questions WHERE id = $1`, [questionId])
          errors.push(`第${rowNo}行: 知识单元不在该科目字典中，请先在系统设置中配置`)
          continue
        }
        throw linkErr
      }

      successRows += 1
    }

    await client.query('COMMIT')
    return res.json({
      data: {
        total_rows: rows.length,
        success_rows: successRows,
        failed_rows: rows.length - successRows,
        errors,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return res.status(500).json({
      message: '批量导入失败',
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    client.release()
  }
})

/** 默认在启动时串行执行幂等迁移（与 `npm run db:migrate` 相同）。生产可设 QUIZWIZ_RUN_MIGRATIONS_ON_BOOT=0，仅在部署脚本中执行 db:migrate 后再启动 API。 */
const runMigrationsOnBoot = String(process.env.QUIZWIZ_RUN_MIGRATIONS_ON_BOOT ?? '1').trim() !== '0'
const bootPromise = runMigrationsOnBoot ? runBootMigrations() : Promise.resolve()

export const appReady = bootPromise

const isMainModule = Boolean(process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)))

if (isMainModule) {
  bootPromise
    .then(() => {
      app.listen(API_PORT, () => {
        console.log(`API running at http://localhost:${API_PORT}`)
        console.log(
          '[quizwiz-teacher-admin] 自检: curl -s http://127.0.0.1:' +
            API_PORT +
            '/api/health 应含 service、api_revision>=' +
            API_REVISION +
            '；GET /api/auth/me 无 Token 时应为 401 而非 404',
        )
        const ONLINE_JANITOR_MS = Number(process.env.ONLINE_SESSION_JANITOR_MS || 60_000)
        setInterval(() => {
          void (async () => {
            const client = await pool.connect()
            try {
              await client.query('BEGIN')
              const closed = await closeStaleStudentOnlineSessions(client)
              await client.query('COMMIT')
              if (closed > 0) {
                console.log(`[online-janitor] 已收口 ${closed} 个僵尸在线会话`)
              }
            } catch (err) {
              await client.query('ROLLBACK').catch(() => {})
              console.error('[online-janitor] 扫描失败', err)
            } finally {
              client.release()
            }
          })()
        }, ONLINE_JANITOR_MS)
        console.log(`[online-janitor] 已启动，间隔 ${ONLINE_JANITOR_MS}ms`)
      })
    })
    .catch((error) => {
      console.error('Failed to run boot migrations (schema / system config):', error)
      process.exit(1)
    })
}

export { app, pool }
