CREATE DATABASE IF NOT EXISTS quizwiz CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE quizwiz;

CREATE TABLE IF NOT EXISTS questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  question_type ENUM('single', 'multiple') NOT NULL,
  stem TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NULL,
  option_d TEXT NULL,
  answer_letters VARCHAR(16) NOT NULL,
  answer_texts_json JSON NOT NULL,
  analysis TEXT NULL,
  difficulty TINYINT UNSIGNED NULL,
  chapter VARCHAR(128) NULL,
  status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  content_hash CHAR(64) NOT NULL,
  current_version INT UNSIGNED NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_questions_content_hash (content_hash),
  KEY idx_questions_type_status (question_type, status),
  KEY idx_questions_chapter (chapter),
  KEY idx_questions_difficulty (difficulty),
  KEY idx_questions_deleted (is_deleted)
);

CREATE TABLE IF NOT EXISTS question_versions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_question_version (question_id, version_no),
  KEY idx_question_versions_question_id (question_id),
  CONSTRAINT fk_qv_question_id FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_knowledge_points_name (name)
);

CREATE TABLE IF NOT EXISTS question_knowledge_rel (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  knowledge_point_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qk (question_id, knowledge_point_id),
  KEY idx_qk_knowledge_point_id (knowledge_point_id),
  CONSTRAINT fk_qk_question_id FOREIGN KEY (question_id) REFERENCES questions(id),
  CONSTRAINT fk_qk_knowledge_point_id FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  actor_role VARCHAR(32) NULL,
  action VARCHAR(64) NOT NULL,
  object_type VARCHAR(32) NOT NULL,
  object_id BIGINT UNSIGNED NOT NULL,
  change_summary JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_object (object_type, object_id),
  KEY idx_audit_actor (actor_id),
  KEY idx_audit_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  mode ENUM('preview', 'import') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  success_count INT UNSIGNED NOT NULL DEFAULT 0,
  fail_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('running', 'done', 'failed') NOT NULL DEFAULT 'running',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_import_jobs_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'teacher') NOT NULL DEFAULT 'teacher',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_email (email)
);

CREATE TABLE IF NOT EXISTS import_job_rows (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  `row_number` INT UNSIGNED NOT NULL,
  `status` ENUM('success', 'failed') NOT NULL,
  reason VARCHAR(64) NULL,
  `message` VARCHAR(255) NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_import_rows_job_id (job_id),
  KEY idx_import_rows_status (`status`),
  CONSTRAINT fk_import_rows_job_id FOREIGN KEY (job_id) REFERENCES import_jobs(id)
);
