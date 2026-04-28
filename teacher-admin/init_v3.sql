BEGIN;

-- =====================================================
-- init_v3.sql (reset)
-- 先删旧表，再按最新规则重建
-- 题库采用分列 + 选项子表，便于 Excel 批量导入
-- =====================================================

-- 0) 删除旧表（按依赖倒序）
DROP TABLE IF EXISTS operation_logs CASCADE;
DROP TABLE IF EXISTS resource_class_visibility CASCADE;
DROP TABLE IF EXISTS resources CASCADE;
DROP TABLE IF EXISTS answers CASCADE;
DROP TABLE IF EXISTS exam_submissions CASCADE;
DROP TABLE IF EXISTS exam_questions CASCADE;
DROP TABLE IF EXISTS exam_classes CASCADE;
DROP TABLE IF EXISTS exams CASCADE;
DROP TABLE IF EXISTS question_tag_rel CASCADE;
DROP TABLE IF EXISTS question_tags CASCADE;
DROP TABLE IF EXISTS question_options CASCADE;
DROP TABLE IF EXISTS question_import_logs CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS class_teachers CASCADE;
DROP TABLE IF EXISTS class_members CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS teacher_subjects CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1) users（仅手机号登录）
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status SMALLINT NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_phone ON users(phone);

-- 2) roles
CREATE TABLE roles (
  id SMALLSERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE, -- admin/class_teacher/subject_teacher
  name VARCHAR(32) NOT NULL
);

INSERT INTO roles (code, name) VALUES
('admin', '管理员'),
('class_teacher', '班主任'),
('subject_teacher', '科任老师');

-- 3) user_roles
CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

-- 4) subjects（按你确认顺序）
CREATE TABLE subjects (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  sort_order INT NOT NULL
);

INSERT INTO subjects (name, sort_order) VALUES
('语文', 1),
('数学', 2),
('英语', 3),
('物理', 4),
('化学', 5),
('生物', 6),
('历史', 7),
('政治', 8),
('地理', 9);

-- 5) teacher_subjects
CREATE TABLE teacher_subjects (
  teacher_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  PRIMARY KEY (teacher_id, subject_id)
);
CREATE INDEX idx_teacher_subjects_subject_id ON teacher_subjects(subject_id);

-- 6) classes
CREATE TABLE classes (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  grade VARCHAR(32) NOT NULL,
  invite_code VARCHAR(16) NOT NULL UNIQUE,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_classes_owner_id ON classes(owner_id);

-- 7) students
CREATE TABLE students (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  student_no VARCHAR(64) UNIQUE
);

-- 8) class_members
CREATE TABLE class_members (
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_class_members_student_id ON class_members(student_id);

-- 9) class_teachers
CREATE TABLE class_teachers (
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  PRIMARY KEY (class_id, teacher_id, subject_id)
);
CREATE INDEX idx_class_teachers_teacher_id ON class_teachers(teacher_id);
CREATE INDEX idx_class_teachers_subject_id ON class_teachers(subject_id);

-- 10) questions（分列设计）
CREATE TABLE questions (
  id BIGSERIAL PRIMARY KEY,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  question_type SMALLINT NOT NULL,         -- 1单选 2多选 3判断 4填空 5简答
  stem TEXT NOT NULL,                      -- 题干（分列）
  answer_text TEXT NOT NULL,               -- 答案（分列）
  explanation TEXT,                        -- 解析（分列）
  difficulty SMALLINT NOT NULL DEFAULT 2,  -- 1易 2中 3难
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_questions_subject_creator ON questions(subject_id, creator_id);

-- 11) question_options（选项子表）
CREATE TABLE question_options (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_key VARCHAR(8) NOT NULL,  -- A/B/C/D...
  option_text TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  UNIQUE (question_id, option_key)
);
CREATE INDEX idx_question_options_question_id ON question_options(question_id);

-- 12) 标签
CREATE TABLE question_tags (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE
);

CREATE TABLE question_tag_rel (
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES question_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

-- 13) 导入日志
CREATE TABLE question_import_logs (
  id BIGSERIAL PRIMARY KEY,
  subject_id BIGINT REFERENCES subjects(id) ON DELETE SET NULL,
  uploader_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  file_name VARCHAR(255) NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  success_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  error_report_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14) exams
CREATE TABLE exams (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration INT NOT NULL,
  creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status SMALLINT NOT NULL DEFAULT 1, -- 1未开始 2进行中 3已结束
  description TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_exams_creator_id ON exams(creator_id);
CREATE INDEX idx_exams_time ON exams(start_time, end_time);

-- 15) exam_classes
CREATE TABLE exam_classes (
  exam_id BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, class_id)
);

-- 16) exam_questions
CREATE TABLE exam_questions (
  exam_id BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  score NUMERIC(8,2) NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (exam_id, question_id)
);
CREATE INDEX idx_exam_questions_sort ON exam_questions(exam_id, sort_order);

-- 17) exam_submissions
CREATE TABLE exam_submissions (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  start_time TIMESTAMPTZ NOT NULL,
  status SMALLINT NOT NULL DEFAULT 1, -- 1进行中 2已交卷 3已批阅
  submit_time TIMESTAMPTZ,
  total_score NUMERIC(8,2),
  UNIQUE (exam_id, student_id)
);
CREATE INDEX idx_exam_submissions_exam ON exam_submissions(exam_id);

-- 18) answers
CREATE TABLE answers (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES exam_submissions(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  student_answer JSONB,
  score NUMERIC(8,2),
  is_correct BOOLEAN,
  time_spent INT,
  UNIQUE (submission_id, question_id)
);
CREATE INDEX idx_answers_submission_id ON answers(submission_id);

-- 19) resources
CREATE TABLE resources (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(32) NOT NULL,
  uploader_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  folder VARCHAR(32) NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20) resource_class_visibility
CREATE TABLE resource_class_visibility (
  resource_id BIGINT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, class_id)
);

-- 21) operation_logs
CREATE TABLE operation_logs (
  id BIGSERIAL PRIMARY KEY,
  operator_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64),
  target_id VARCHAR(64),
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_operation_logs_operator_time
ON operation_logs(operator_id, created_at DESC);

COMMIT;
