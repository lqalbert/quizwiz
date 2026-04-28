import bcrypt from 'bcryptjs'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'fs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

dotenv.config()

const { Pool } = pg
const app = express()

const API_PORT = Number(process.env.API_PORT || 3000)
const JWT_SECRET = process.env.JWT_SECRET || 'quizwiz-dev-secret'
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads')
const UPLOAD_PUBLIC_BASE = process.env.UPLOAD_PUBLIC_BASE || `http://localhost:${API_PORT}`
const UPLOAD_SIZE_LIMIT = 100 * 1024 * 1024

if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
}

const resourceUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_ROOT)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 16)
    const safeBase = path.basename(file.originalname || 'resource', ext).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 60) || 'resource'
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`)
  },
})

const resourceUpload = multer({
  storage: resourceUploadStorage,
  limits: {
    fileSize: UPLOAD_SIZE_LIMIT,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeSet = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
      'audio/mpeg',
      'audio/wav',
    ])
    const allowedExtSet = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.mp3', '.wav'])
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (allowedMimeSet.has(file.mimetype) || allowedExtSet.has(ext)) {
      cb(null, true)
      return
    }
    cb(new Error('文件类型不支持'))
  },
})

const avatarUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_ROOT)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 8).toLowerCase() || '.png'
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

const avatarUpload = multer({
  storage: avatarUploadStorage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.mimetype)
    const ext = path.extname(file.originalname || '').toLowerCase()
    const okExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
    if (okMime || okExt) {
      cb(null, true)
      return
    }
    cb(new Error('仅支持 PNG/JPG/WebP/GIF 图片'))
  },
})

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'quizwiz_app',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || 'quizwiz',
      },
)

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

const difficultyMap = {
  '简单': 1,
  easy: 1,
  '中等': 2,
  medium: 2,
  '困难': 3,
  hard: 3,
}

const difficultyLabelMap = {
  1: '简单',
  2: '中等',
  3: '困难',
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
app.use(
  cors({
    origin: [...defaultCorsOrigins, ...extraCorsOrigins],
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(UPLOAD_ROOT))

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
const canManageResources = (req) => hasRole(req, 'admin') || hasRole(req, 'class_teacher')

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
  if (!hasRole(req, 'class_teacher')) return false
  const executor = client || pool
  const ownedClassResult = await executor.query(`SELECT id FROM classes WHERE owner_id = $1`, [req.auth?.userId || 0])
  const ownedClassSet = new Set(ownedClassResult.rows.map((row) => Number(row.id)))
  return classIds.every((classId) => ownedClassSet.has(classId))
}

const studentAuthRequired = (req, res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
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

const ensureSystemConfigTable = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS system_configs (
      config_key VARCHAR(128) PRIMARY KEY,
      config_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
  )
}

const ensureClassInviteSchema = async () => {
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS invite_enabled BOOLEAN NOT NULL DEFAULT TRUE`)
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS join_audit_mode VARCHAR(16) NOT NULL DEFAULT 'auto'`)
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS class_invite_join_logs (
      id BIGSERIAL PRIMARY KEY,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id BIGINT REFERENCES students(id) ON DELETE SET NULL,
      invite_code VARCHAR(32),
      join_channel VARCHAR(32) NOT NULL DEFAULT 'admin_manual',
      operator_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_class_invite_join_logs_class_time
    ON class_invite_join_logs(class_id, joined_at DESC)
    `,
  )
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS class_join_requests (
      id BIGSERIAL PRIMARY KEY,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_name VARCHAR(64) NOT NULL,
      student_no VARCHAR(64) NOT NULL,
      invite_code VARCHAR(32),
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      source VARCHAR(32) NOT NULL DEFAULT 'mini_program',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      review_note TEXT,
      UNIQUE (class_id, student_no, status)
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_class_join_requests_class_time
    ON class_join_requests(class_id, requested_at DESC)
    `,
  )
}

const ensureStudentWarningSchema = async () => {
  await pool.query(`ALTER TABLE student_warning_cases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS student_warning_cases (
      id BIGSERIAL PRIMARY KEY,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      note TEXT,
      handled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      handled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (class_id, student_id)
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_warning_cases_class_status
    ON student_warning_cases(class_id, status, updated_at DESC)
    `,
  )
}

const ensureQuestionDuplicateMarkSchema = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS question_duplicate_marks (
      question_id BIGINT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      mark_status VARCHAR(16) NOT NULL DEFAULT 'pending',
      note TEXT,
      updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_question_duplicate_marks_status
    ON question_duplicate_marks(mark_status, updated_at DESC)
    `,
  )
}

const ensureQuestionRecycleSchema = async () => {
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL`)
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_questions_deleted_at
    ON questions(deleted_at)
    `,
  )
}

const ensureQuestionVersionSchema = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS question_versions (
      id BIGSERIAL PRIMARY KEY,
      question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      action VARCHAR(32) NOT NULL,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      operator_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_question_versions_question_time
    ON question_versions(question_id, created_at DESC)
    `,
  )
}

const ensureUserProfileSchema = async () => {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`)
}

const ensureResourceSchema = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS resources (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      file_url TEXT NOT NULL,
      file_type VARCHAR(32) NOT NULL,
      uploader_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      folder VARCHAR(32) NOT NULL DEFAULT 'other',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
  )
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS resource_class_visibility (
      resource_id BIGINT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      PRIMARY KEY (resource_id, class_id)
    )
    `,
  )
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
    SELECT t.name
    FROM question_tag_rel r
    JOIN question_tags t ON t.id = r.tag_id
    WHERE r.question_id = $1
    ORDER BY t.name ASC
    `,
    [questionId],
  )
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
    knowledge_points: tagsResult.rows.map((item) => String(item.name)),
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
}) => {
  const existing = await client.query('SELECT id, name, student_no FROM students WHERE student_no = $1 LIMIT 1', [studentNo])
  let studentId = existing.rows[0]?.id
  if (!studentId) {
    const inserted = await client.query(`INSERT INTO students (name, student_no) VALUES ($1, $2) RETURNING id`, [name, studentNo])
    studentId = inserted.rows[0].id
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
    return res.json({
      data: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        status: user.status,
        avatarUrl: user.avatar_url || '',
        roles,
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

app.get('/api/subjects', authRequired, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, name, sort_order
      FROM subjects
      ORDER BY sort_order ASC, id ASC
      `,
    )
    res.json({ data: rows })
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
  const name = String(req.body?.name || '').trim()
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
      return res.status(409).json({ message: '科目名称已存在' })
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

app.get('/api/users', authRequired, async (req, res) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const isClassTeacher = hasRole(req, 'class_teacher')
    if (!isAdmin && !isClassTeacher) {
      return res.status(403).json({ message: '无权限查看教师账号列表' })
    }

    const sql = `
      SELECT
        u.id,
        u.name,
        u.phone,
        u.status,
        u.created_at,
        COALESCE(array_remove(array_agg(DISTINCT r.code), NULL), '{}') AS roles,
        COALESCE(array_remove(array_agg(DISTINCT s.name), NULL), '{}') AS subjects
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN teacher_subjects ts ON ts.teacher_id = u.id
      LEFT JOIN subjects s ON s.id = ts.subject_id
      GROUP BY u.id
    `
    const { rows } = await pool.query(sql)
    const filtered = isAdmin ? rows : rows.filter((row) => Array.isArray(row.roles) && row.roles.includes('subject_teacher'))
    return res.json({ data: filtered })
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
        c.grade,
        c.invite_code,
        c.invite_enabled,
        c.invite_expires_at,
        c.join_audit_mode,
        c.owner_id,
        c.created_at,
        COALESCE(COUNT(cm.student_id), 0)::int AS student_count
      FROM classes c
      LEFT JOIN class_members cm ON cm.class_id = c.id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `
    const { rows } = await pool.query(sql, values)
    res.json({ data: rows })
  } catch (error) {
    res.status(500).json({ message: '班级列表查询失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/classes', authRequired, async (req, res) => {
  const isAdmin = hasRole(req, 'admin')
  const isClassTeacher = hasRole(req, 'class_teacher')
  if (!isAdmin && !isClassTeacher) {
    return res.status(403).json({ message: '仅管理员或班主任可创建班级' })
  }
  const name = String(req.body?.name || '').trim()
  const grade = String(req.body?.grade || '').trim()
  if (!name || !grade) {
    return res.status(400).json({ message: '班级名称和年级不能为空' })
  }
  const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()
  try {
    const result = await pool.query(
      `
      INSERT INTO classes (name, grade, invite_code, owner_id, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, name, grade, invite_code, invite_enabled, invite_expires_at, join_audit_mode, owner_id, created_at
      `,
      [name, grade, inviteCode, req.auth.userId],
    )
    res.status(201).json({ data: result.rows[0] })
  } catch (error) {
    res.status(500).json({ message: '创建班级失败', detail: error instanceof Error ? error.message : String(error) })
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
        s.name AS student_name,
        s.student_no
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
        r.student_no,
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
    return res.json({
      data: {
        ...classResult.rows[0],
        join_logs: logsResult.rows,
        join_requests: requestResult.rows,
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
      SELECT s.id AS student_id, s.name AS student_name, s.student_no, c.id AS class_id, c.name AS class_name, c.grade AS class_grade
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
          grade: row.class_grade,
        },
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '学生登录失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/my-classes', studentAuthRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT c.id, c.name, c.grade
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

app.get('/api/student/resources', studentAuthRequired, async (req, res) => {
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
      SELECT r.id, r.name, r.file_url, r.file_type, r.folder, r.created_at
      FROM resources r
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
        return {
          id: row.id,
          name: row.name,
          file_url: fileUrl,
          file_type: row.file_type,
          folder: row.folder,
          created_at: row.created_at,
          can_system_download: Boolean(fileUrl && fileUrl.startsWith(expectedPrefix)),
        }
      }),
    })
  } catch (error) {
    return res.status(500).json({ message: '加载学生可见资料失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/student/resources/:id/download', studentAuthRequired, async (req, res) => {
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
    await writeOperationLog({
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
    })
    return res.download(absPath, displayName)
  } catch (error) {
    return res.status(500).json({ message: '下载资料失败', detail: error instanceof Error ? error.message : String(error) })
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
        s.name,
        s.student_no,
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
      ranked AS (
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
          ), '{}') AS class_names,
          COUNT(*) OVER() AS __total
        FROM exams e
        JOIN subjects s ON s.id = e.subject_id
        JOIN exam_stat es ON es.id = e.id
        ${combinedWhere}
      )
      SELECT * FROM ranked
      ORDER BY created_at DESC, id DESC
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

    const classResult = await client.query(
      `
      SELECT c.id, c.name, c.grade
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
        s.name AS student_name,
        s.student_no,
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
        c.grade AS class_grade,
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
      GROUP BY c.id, c.name, c.grade
      ORDER BY c.id ASC
      `,
      [examId],
    )

    return res.json({
      data: {
        ...examRow,
        classes: classResult.rows,
        questions: questionResult.rows.map((item) => ({
          ...item,
          question_type_text: questionTypeLabelMap[item.question_type] || String(item.question_type),
          difficulty_text: difficultyLabelMap[item.difficulty] || '中等',
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
        SELECT c.id, c.name, c.grade
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
        vc.grade AS class_grade,
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
        SELECT c.id, c.name, c.grade
        FROM classes c
        ${accessSql}
      ),
      filtered_exams AS (
        SELECT DISTINCT
          vc.id AS class_id,
          vc.name AS class_name,
          vc.grade AS class_grade,
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
          vc.grade AS class_grade,
          COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS student_count
        FROM visible_classes vc
        LEFT JOIN class_members cm ON cm.class_id = vc.id
        ${hasClassFilter ? `WHERE vc.id = ${classFilterPlaceholder}` : ''}
        GROUP BY vc.id, vc.name, vc.grade
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
        cb.class_grade,
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
      class_grade: String(item.class_grade || ''),
    }))
    const selectedClassId = hasClassFilter ? requestedClassId : Number(classOptions[0]?.class_id || 0)
    const trendParams = [...values, selectedClassId, trendLimit]
    const trendResult = await pool.query(
      `
      WITH visible_classes AS (
        SELECT c.id, c.name, c.grade
        FROM classes c
        ${accessSql}
      ),
      filtered_exams AS (
        SELECT DISTINCT
          vc.id AS class_id,
          vc.name AS class_name,
          vc.grade AS class_grade,
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
          c.grade AS class_grade,
          COALESCE(COUNT(DISTINCT cm.student_id), 0)::int AS expected_count
        FROM exam_classes ec
        JOIN classes c ON c.id = ec.class_id
        LEFT JOIN class_members cm ON cm.class_id = c.id
        WHERE ec.exam_id = $1
        GROUP BY c.id, c.name, c.grade
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
        cb.class_grade,
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
        SELECT c.id, c.name, c.grade
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
        SELECT c.id, c.name, c.grade
        FROM classes c
        ${accessSql}
      ),
      class_students AS (
        SELECT
          vc.id AS class_id,
          vc.name AS class_name,
          vc.grade AS class_grade,
          s.id AS student_id,
          s.name AS student_name,
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
          cs.class_grade,
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
          sem.class_grade,
          sem.student_id,
          sem.student_name,
          sem.student_no,
          COALESCE(COUNT(DISTINCT sem.exam_id), 0)::int AS recent_exam_count,
          COALESCE(COUNT(*) FILTER (WHERE sem.total_score IS NULL), 0)::int AS missing_count,
          COALESCE(ROUND(AVG(sem.total_score) FILTER (WHERE sem.total_score IS NOT NULL), 2), 0)::numeric AS recent_avg_score,
          ARRAY_REMOVE(ARRAY_AGG(sem.total_score ORDER BY sem.start_time DESC, sem.exam_id DESC), NULL) AS score_series
        FROM student_exam_matrix sem
        GROUP BY sem.class_id, sem.class_name, sem.class_grade, sem.student_id, sem.student_name, sem.student_no
      )
      SELECT
        ss.class_id,
        ss.class_name,
        ss.class_grade,
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
            class_grade: String(item.class_grade || ''),
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
        SELECT c.id, c.name, c.grade
        FROM classes c
        ${accessSql}
      ),
      class_students AS (
        SELECT
          vc.id AS class_id,
          vc.name AS class_name,
          vc.grade AS class_grade,
          s.id AS student_id,
          s.name AS student_name,
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
          cs.class_grade,
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
          sem.class_grade,
          sem.student_id,
          COALESCE(COUNT(DISTINCT sem.start_time), 0)::int AS recent_exam_count,
          COALESCE(COUNT(*) FILTER (WHERE sem.total_score IS NULL), 0)::int AS missing_count,
          COALESCE(ROUND(AVG(sem.total_score) FILTER (WHERE sem.total_score IS NOT NULL), 2), 0)::numeric AS recent_avg_score,
          ARRAY_REMOVE(ARRAY_AGG(sem.total_score ORDER BY sem.start_time DESC), NULL) AS score_series,
          MAX(sem.start_time) AS latest_exam_time
        FROM student_exam_matrix sem
        GROUP BY sem.class_id, sem.class_name, sem.class_grade, sem.student_id
      )
      SELECT
        ss.class_id,
        ss.class_name,
        ss.class_grade,
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
    const statusResult = await client.query(
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
    const computedStatus = Number(statusResult.rows[0]?.computed_status || 0)
    if (computedStatus !== 1) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: '仅未开始考试允许删除' })
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
  if (requesterIsClassTeacher && (!roles.every((r) => r === 'subject_teacher') || roles.length !== 1)) {
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

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.setHeader('Cache-Control', 'no-store')
    // 若 JSON 里没有 service/auth_profile_me，说明 3000 上不是本仓库当前版 API（端口被其它进程占用或未保存/未重启）
    res.json({ ok: true, service: 'quizwiz-teacher-admin', auth_profile_me: true })
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
        SELECT c.id, c.name, c.grade
        FROM classes c
        ${whereClause}
        ORDER BY c.created_at DESC, c.id DESC
        `,
        values,
      ),
    ])
    return res.json({
      data: {
        folders: [
          { key: 'courseware', label: '课件' },
          { key: 'exercise', label: '习题解析' },
          { key: 'video', label: '视频' },
          { key: 'other', label: '其他' },
        ],
        classes: classResult.rows.map((item) => ({
          id: item.id,
          name: item.name,
          grade: item.grade,
        })),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: '加载资料库元数据失败', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/resources/upload', authRequired, (req, res) => {
  if (!canManageResources(req)) {
    return res.status(403).json({ message: '仅管理员或班主任可上传资料' })
  }
  resourceUpload.single('file')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '文件大小不能超过100MB' })
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
      SELECT * FROM (
        SELECT
          r.id,
          r.name,
          r.file_url,
          r.file_type,
          r.folder,
          r.uploader_id,
          r.created_at,
          COALESCE(u.name, '') AS uploader_name,
          COUNT(*) OVER() AS __total
        FROM resources r
        LEFT JOIN users u ON u.id = r.uploader_id
        ${whereClause}
      ) sub
      ORDER BY sub.created_at DESC, sub.id DESC
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
        SELECT v.resource_id, c.id AS class_id, c.name AS class_name, c.grade AS class_grade
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
          class_grade: String(row.class_grade || ''),
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
  if (!canManageResources(req)) return res.status(403).json({ message: '仅管理员或班主任可新增资料' })
  const name = String(req.body?.name || '').trim()
  const fileUrl = String(req.body?.fileUrl || '').trim()
  const fileType = String(req.body?.fileType || '').trim() || 'file'
  const folder = String(req.body?.folder || '').trim() || 'other'
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : []
  if (!name) return res.status(400).json({ message: '资料名称不能为空' })
  if (!fileUrl) return res.status(400).json({ message: '文件地址不能为空' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!(await validateResourceClassScope({ req, classIds, client }))) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '仅可设置自己负责班级为可见范围' })
    }
    const insertResult = await client.query(
      `
      INSERT INTO resources (name, file_url, file_type, uploader_id, folder, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
      `,
      [name, fileUrl, fileType, req.auth?.userId || null, folder],
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
      detail: { folder, class_ids: uniqueClassIds },
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
  if (!canManageResources(req)) return res.status(403).json({ message: '仅管理员或班主任可编辑资料' })
  const resourceId = Number(req.params.id)
  if (!Number.isInteger(resourceId) || resourceId <= 0) return res.status(400).json({ message: '资料ID不合法' })
  const name = String(req.body?.name || '').trim()
  const folder = String(req.body?.folder || '').trim()
  const classIds = Array.isArray(req.body?.classIds) ? req.body.classIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (classIds && !(await validateResourceClassScope({ req, classIds, client }))) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '仅可设置自己负责班级为可见范围' })
    }
    const exists = await client.query(`SELECT id FROM resources WHERE id = $1 LIMIT 1`, [resourceId])
    if (!exists.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '资料不存在' })
    }
    if (name || folder) {
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
  if (!canManageResources(req)) return res.status(403).json({ message: '仅管理员或班主任可删除资料' })
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

    conditions.unshift('q.deleted_at IS NULL')
    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const explicitPaging = req.query?.page !== undefined && req.query?.page !== ''
    const page = Math.max(1, parseInt(String(req.query?.page ?? '1'), 10) || 1)
    let pageSize = Math.min(500, Math.max(1, parseInt(String(req.query?.pageSize ?? '500'), 10) || 500))
    if (explicitPaging) {
      pageSize = Math.min(100, Math.max(1, parseInt(String(req.query?.pageSize ?? '20'), 10) || 20))
    }
    const offset = (page - 1) * pageSize
    const sql = `
      SELECT * FROM (
        SELECT
          q.id,
          q.question_type,
          q.stem,
          q.difficulty,
          q.updated_at,
          COUNT(*) OVER() AS __total
        FROM questions q
        JOIN subjects s ON s.id = q.subject_id
        ${whereClause}
      ) sub
      ORDER BY sub.updated_at DESC, sub.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const { rows } = await pool.query(sql, values)
    const total = rows.length > 0 ? Number(rows[0].__total ?? 0) : 0
    res.json({
      data: rows.map((row) => {
        const { __total, ...rest } = row
        return {
          id: rest.id,
          question_type: rest.question_type,
          question_type_text: questionTypeLabelMap[rest.question_type] || String(rest.question_type),
          stem: rest.stem,
          difficulty: rest.difficulty,
          difficulty_text: difficultyLabelMap[rest.difficulty] || '中等',
          updated_at: rest.updated_at,
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
  const difficultyValue = String(req.body?.difficulty || '').trim() || '中等'
  const optionA = String(req.body?.optionA || '').trim()
  const optionB = String(req.body?.optionB || '').trim()
  const optionC = String(req.body?.optionC || '').trim()
  const optionD = String(req.body?.optionD || '').trim()
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
  const difficulty = difficultyMap[difficultyValue] || Number(difficultyValue) || 2
  if (![1, 2, 3].includes(difficulty)) {
    return res.status(400).json({ message: '难度不合法' })
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

    for (const rawTag of knowledgePoints) {
      const tag = String(rawTag || '').trim()
      if (!tag) continue
      const tagResult = await client.query(
        `
        INSERT INTO question_tags (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        `,
        [tag],
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
        difficulty_text: difficultyLabelMap[questionResult.rows[0].difficulty] || '中等',
        updated_at: questionResult.rows[0].updated_at,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
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
      SELECT t.name
      FROM question_tag_rel r
      JOIN question_tags t ON t.id = r.tag_id
      WHERE r.question_id = $1
      ORDER BY t.name ASC
      `,
      [questionId],
    )
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
        knowledgePoints: tagsResult.rows.map((item) => String(item.name)),
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
    const knowledgePoints = Array.isArray(snapshot.knowledge_points) ? snapshot.knowledge_points : []
    if (!subjectId || !questionType || !stem || !answerText || ![1, 2, 3].includes(difficulty)) {
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
    for (const rawTag of knowledgePoints) {
      const tag = String(rawTag || '').trim()
      if (!tag) continue
      const tagResult = await client.query(
        `
        INSERT INTO question_tags (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        `,
        [tag],
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
  const difficultyValue = String(req.body?.difficulty || '').trim() || '中等'
  const optionA = String(req.body?.optionA || '').trim()
  const optionB = String(req.body?.optionB || '').trim()
  const optionC = String(req.body?.optionC || '').trim()
  const optionD = String(req.body?.optionD || '').trim()
  const knowledgePoints = Array.isArray(req.body?.knowledgePoints) ? req.body.knowledgePoints : []

  if (!subjectName) return res.status(400).json({ message: '科目不能为空' })
  if (!stem) return res.status(400).json({ message: '题干不能为空' })
  if (!answer) return res.status(400).json({ message: '答案不能为空' })

  const questionType = questionTypeMap[typeValue]
  if (!questionType) return res.status(400).json({ message: '题型不合法' })
  const difficulty = difficultyMap[difficultyValue] || Number(difficultyValue) || 2
  if (![1, 2, 3].includes(difficulty)) return res.status(400).json({ message: '难度不合法' })

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
    for (const rawTag of knowledgePoints) {
      const tag = String(rawTag || '').trim()
      if (!tag) continue
      const tagResult = await client.query(
        `
        INSERT INTO question_tags (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        `,
        [tag],
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
      return res.status(400).json({ message: '该题目已被考试使用，暂不支持删除' })
    }

    await client.query(`UPDATE questions SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW() WHERE id = $2`, [req.auth?.userId || null, questionId])
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
        difficulty_text: difficultyLabelMap[row.difficulty] || '中等',
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
      return res.status(400).json({ message: '该题目已被考试引用，不能彻底删除' })
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
        failed.push({ id: questionId, reason: '已被考试引用，不能彻底删除' })
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
        WHERE q.deleted_at IS NULL
        JOIN subjects s ON s.id = q.subject_id
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
        failed.push({ id: questionId, reason: '已被考试引用' })
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
  const addKnowledgePoints = Array.isArray(req.body?.addKnowledgePoints) ? req.body.addKnowledgePoints : []
  const removeKnowledgePoints = Array.isArray(req.body?.removeKnowledgePoints) ? req.body.removeKnowledgePoints : []
  if (ids.length === 0) {
    return res.status(400).json({ message: 'ids 不能为空' })
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
    difficulty = difficultyMap[difficultyValue] || Number(difficultyValue) || null
    if (![1, 2, 3].includes(Number(difficulty))) {
      return res.status(400).json({ message: '难度不合法' })
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

      for (const rawTag of addKnowledgePoints) {
        const tag = String(rawTag || '').trim()
        if (!tag) continue
        const tagResult = await client.query(
          `
          INSERT INTO question_tags (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [tag],
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
      for (const rawTag of removeKnowledgePoints) {
        const tag = String(rawTag || '').trim()
        if (!tag) continue
        await client.query(
          `
          DELETE FROM question_tag_rel
          WHERE question_id = $1 AND tag_id IN (SELECT id FROM question_tags WHERE name = $2)
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
      const difficultyValue = String(row.difficulty || '').trim() || '中等'
      const knowledgePoints = Array.isArray(row.knowledgePoints) ? row.knowledgePoints : []

      const subjectId = subjectMap.get(subjectAliasMap[subjectName.toLowerCase()] || subjectName)
      const questionType = questionTypeMap[typeValue]
      const difficulty = difficultyMap[difficultyValue] || 2

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

      for (const rawTag of knowledgePoints) {
        const tag = String(rawTag || '').trim()
        if (!tag) continue
        const tagResult = await client.query(
          `
          INSERT INTO question_tags (name)
          VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
          `,
          [tag],
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

const bootPromise = Promise.all([
  ensureSystemConfigTable(),
  ensureClassInviteSchema(),
  ensureStudentWarningSchema(),
  ensureQuestionDuplicateMarkSchema(),
  ensureQuestionRecycleSchema(),
  ensureQuestionVersionSchema(),
  ensureUserProfileSchema(),
  ensureResourceSchema(),
])

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
            '/api/health 应含 "service":"quizwiz-teacher-admin"；GET /api/auth/me 无 Token 时应为 401 而非 404',
        )
      })
    })
    .catch((error) => {
      console.error('Failed to init system config table:', error)
      process.exit(1)
    })
}

export { app, pool }
