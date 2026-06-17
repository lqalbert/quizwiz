import { DEFAULT_KNOWLEDGE_UNIT_NAME } from '../config/constants.js'
import { pool } from '../db/pool.js'

const ensureKnowledgeUnitSchema = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS knowledge_units (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT knowledge_units_name_uidx UNIQUE (name)
    )
    `,
  )
  /** 须先于含 subject_id / sort_order 的 INSERT，且先于 question_tags 回填 unit_id（依赖全局「未分类」行） */
  await pool.query(`ALTER TABLE knowledge_units ADD COLUMN IF NOT EXISTS subject_id BIGINT REFERENCES subjects(id) ON DELETE CASCADE`)
  await pool.query(`ALTER TABLE knowledge_units ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE knowledge_units DROP CONSTRAINT IF EXISTS knowledge_units_name_uidx`)
  await pool.query(`ALTER TABLE knowledge_units DROP CONSTRAINT IF EXISTS knowledge_units_name_key`)
  await pool.query(`DROP INDEX IF EXISTS knowledge_units_name_uidx`)
  await pool.query(`DROP INDEX IF EXISTS knowledge_units_name_key`)
  /**
   * 旧版曾在整表上 UNIQUE(name)，导致不同科目下知识单元不能重名、插入误报「已存在」。
   * 清理遗留的唯一约束 / 非条件唯一索引（保留带 WHERE 的 partial unique 与主键）。
   */
  await pool.query(`
DO $migration$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = 'knowledge_units'
      AND n.nspname = 'public'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) !~* 'subject_id'
      AND pg_get_constraintdef(c.oid) ~* 'unique.*\\(name\\)'
  LOOP
    EXECUTE format('ALTER TABLE knowledge_units DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_units'
      AND indexname <> 'knowledge_units_pkey'
      AND indexdef ~* '^CREATE UNIQUE INDEX'
      AND indexdef !~* 'WHERE'
      AND indexdef ~* 'USING btree \\(name\\)'
      AND indexdef !~* 'subject_id'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', 'public', r.indexname);
  END LOOP;
END
$migration$;
  `)
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS knowledge_units_global_name_uidx ON knowledge_units (name) WHERE subject_id IS NULL`,
  )
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS knowledge_units_subject_name_uidx ON knowledge_units (subject_id, name) WHERE subject_id IS NOT NULL`,
  )
  await pool.query(
    `
    INSERT INTO knowledge_units (name, subject_id, sort_order)
    SELECT $1::varchar(128), NULL, 0
    WHERE NOT EXISTS (
      SELECT 1 FROM knowledge_units ku
      WHERE ku.name = $1::varchar(128) AND ku.subject_id IS NULL
    )
    `,
    [DEFAULT_KNOWLEDGE_UNIT_NAME],
  )
  await pool.query(`ALTER TABLE question_tags ADD COLUMN IF NOT EXISTS unit_id BIGINT REFERENCES knowledge_units(id) ON DELETE RESTRICT`)
  await pool.query(
    `
    UPDATE question_tags qt
    SET unit_id = ku.id
    FROM knowledge_units ku
    WHERE qt.unit_id IS NULL AND ku.name = $1::varchar(128)
    `,
    [DEFAULT_KNOWLEDGE_UNIT_NAME],
  )
  await pool.query(`ALTER TABLE question_tags ALTER COLUMN unit_id SET NOT NULL`)
  await pool.query(`ALTER TABLE question_tags DROP CONSTRAINT IF EXISTS question_tags_name_key`)
  await pool.query(`DROP INDEX IF EXISTS question_tags_name_key`)
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS question_tags_unit_id_name_uidx ON question_tags (unit_id, name)`,
  )
  await pool.query(
    `
    INSERT INTO knowledge_units (name, subject_id, sort_order)
    SELECT '未分类', s.id, 0
    FROM subjects s
    WHERE NOT EXISTS (
      SELECT 1 FROM knowledge_units ku WHERE ku.subject_id = s.id AND ku.name = '未分类'
    )
    `,
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

/** 班级名称全局唯一（trim 后）；若库内已有重名则跳过建索引，仍由创建接口校验 */
const ensureClassNameUniqueIndex = async () => {
  await pool.query(`
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM classes c1
    INNER JOIN classes c2 ON c1.id < c2.id AND btrim(c1.name) = btrim(c2.name)
  ) THEN
    RAISE NOTICE 'quizwiz: duplicate class names exist; skipped idx_classes_name_btrim_unique';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_name_btrim_unique ON public.classes ((btrim(name)))';
  END IF;
END
$migration$;
  `)
}

const ensureClassLeaveRequestSchema = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS class_leave_requests (
      id BIGSERIAL PRIMARY KEY,
      class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      review_note TEXT
    )
    `,
  )
  await pool.query(
    `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_class_leave_requests_one_pending
    ON class_leave_requests (class_id, student_id)
    WHERE status = 'pending'
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_class_leave_requests_class_time
    ON class_leave_requests (class_id, requested_at DESC)
    `,
  )
}

const ensureStudentWarningSchema = async () => {
  /** 须先建表再 ALTER：空库若先 ALTER 会报 relation does not exist */
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
  await pool.query(`ALTER TABLE student_warning_cases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
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
  await pool.query(`ALTER TABLE resources ADD COLUMN IF NOT EXISTS subject_id BIGINT REFERENCES subjects(id) ON DELETE SET NULL`)
}

const ensureStudentPracticeSchema = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS student_question_stats (
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      attempts INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (student_id, question_id)
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_question_stats_student
    ON student_question_stats(student_id, updated_at DESC)
    `,
  )
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS student_practice_day (
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      practice_date DATE NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (student_id, practice_date)
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_practice_day_student_date
    ON student_practice_day (student_id, practice_date DESC)
    `,
  )
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS student_practice_events (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      is_correct BOOLEAN NOT NULL,
      source VARCHAR(24) NOT NULL DEFAULT 'practice_check',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_practice_events_student_time
    ON student_practice_events (student_id, created_at DESC)
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_practice_events_time_source
    ON student_practice_events (created_at DESC, source)
    `,
  )
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS student_wrong_review (
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      next_review_date DATE NOT NULL,
      ladder INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (student_id, question_id)
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_wrong_review_student_next
    ON student_wrong_review (student_id, next_review_date)
    `,
  )
  await pool.query(
    `
    INSERT INTO student_wrong_review (student_id, question_id, next_review_date, ladder, updated_at)
    SELECT s.student_id, s.question_id, (timezone('Asia/Shanghai', now()))::date, 0, NOW()
    FROM student_question_stats s
    WHERE s.wrong_count > 0
      AND NOT EXISTS (
        SELECT 1 FROM student_wrong_review r
        WHERE r.student_id = s.student_id AND r.question_id = s.question_id
      )
    `,
  )
}

const ensureStudentWechatSchema = async () => {
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS wechat_openid VARCHAR(128)`)
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS wechat_unionid VARCHAR(128)`)
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS real_name VARCHAR(64)`)
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS wechat_avatar_url TEXT`)
  await pool.query(
    `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_wechat_openid_unique
    ON students(wechat_openid)
    WHERE wechat_openid IS NOT NULL AND btrim(wechat_openid) <> ''
    `,
  )
}

/** 考试防作弊：切离小程序 / 页面等事件 JSON 数组，供教师端审计 */
const ensureExamProctorSchema = async () => {
  await pool.query(
    `ALTER TABLE exam_submissions ADD COLUMN IF NOT EXISTS proctor_events jsonb NOT NULL DEFAULT '[]'::jsonb`,
  )
}

/** 小程序前台在线时长：onAppShow 开始会话，onAppHide 结束 */
const ensureStudentOnlineSchema = async () => {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS student_online_sessions (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      duration_seconds INT,
      online_date DATE NOT NULL
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_online_sessions_student_started
    ON student_online_sessions (student_id, started_at DESC)
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_online_sessions_student_open
    ON student_online_sessions (student_id)
    WHERE ended_at IS NULL
    `,
  )
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS student_online_day (
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      online_date DATE NOT NULL,
      total_seconds INT NOT NULL DEFAULT 0,
      session_count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (student_id, online_date)
    )
    `,
  )
  await pool.query(
    `
    CREATE INDEX IF NOT EXISTS idx_student_online_day_student_date
    ON student_online_day (student_id, online_date DESC)
    `,
  )
  await pool.query(
    `ALTER TABLE student_online_sessions ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ`,
  )
  await pool.query(
    `
    UPDATE student_online_sessions
    SET last_heartbeat_at = COALESCE(last_heartbeat_at, ended_at, started_at)
    WHERE last_heartbeat_at IS NULL
    `,
  )
  /** v2：按日历日切分会话重建日汇总，修复「有 4h 汇总但当日无上线」 */
  const v2R = await pool.query(
    `SELECT 1 FROM system_configs WHERE config_key = 'student_online_day_overlap_v2' LIMIT 1`,
  )
  if (!v2R.rows.length) {
    await pool.query(
      `
      UPDATE student_online_sessions
      SET
        ended_at = COALESCE(last_heartbeat_at, started_at) + interval '90 seconds',
        duration_seconds = GREATEST(0, LEAST(
          14400,
          EXTRACT(EPOCH FROM (
            (COALESCE(last_heartbeat_at, started_at) + interval '90 seconds') - started_at
          ))::int
        ))
      WHERE ended_at IS NULL
        AND COALESCE(last_heartbeat_at, started_at) < NOW() - interval '180 seconds'
      `,
    )
    await pool.query(
      `
      UPDATE student_online_sessions
      SET duration_seconds = GREATEST(0, LEAST(
        14400,
        EXTRACT(EPOCH FROM (ended_at - started_at))::int
      ))
      WHERE ended_at IS NOT NULL
      `,
    )
    await pool.query(`DELETE FROM student_online_day`)
    await pool.query(
      `
      INSERT INTO student_online_day (student_id, online_date, total_seconds, session_count)
      SELECT
        sos.student_id,
        d.online_date,
        SUM(
          GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(
              sos.ended_at,
              ((d.online_date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
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
          (timezone('Asia/Shanghai', sos.ended_at))::date,
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
            ((d.online_date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
          )
          - GREATEST(
            sos.started_at,
            (d.online_date::timestamp AT TIME ZONE 'Asia/Shanghai')
          )
        ))::int)
      ) > 0
      `,
    )
    await pool.query(
      `
      INSERT INTO system_configs (config_key, config_value, updated_at)
      VALUES ('student_online_day_overlap_v2', 'true'::jsonb, NOW())
      ON CONFLICT (config_key) DO NOTHING
      `,
    )
  }
}

/** 串行执行，避免启动时 Promise.all 并发占满连接池导致部分连接被服务端掐断 */
export async function runBootMigrations() {
  await ensureKnowledgeUnitSchema()
  await ensureSystemConfigTable()
  await ensureClassInviteSchema()
  await ensureClassNameUniqueIndex()
  await ensureClassLeaveRequestSchema()
  await ensureStudentWarningSchema()
  await ensureQuestionDuplicateMarkSchema()
  await ensureQuestionRecycleSchema()
  await ensureQuestionVersionSchema()
  await ensureUserProfileSchema()
  await ensureResourceSchema()
  await ensureStudentPracticeSchema()
  await ensureStudentWechatSchema()
  await ensureExamProctorSchema()
  await ensureStudentOnlineSchema()
}
