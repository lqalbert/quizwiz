USE quizwiz;

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_subjects_name (name),
  KEY idx_subjects_active_sort (is_active, sort_order)
);

CREATE TABLE IF NOT EXISTS question_subject_rel (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qs (question_id, subject_id),
  KEY idx_qs_subject (subject_id),
  CONSTRAINT fk_qs_question_id FOREIGN KEY (question_id) REFERENCES questions(id),
  CONSTRAINT fk_qs_subject_id FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  mode ENUM('random', 'sequential', 'wrong') NOT NULL DEFAULT 'random',
  subject_id BIGINT UNSIGNED NULL,
  chapter_json JSON NULL,
  difficulty TINYINT UNSIGNED NULL,
  question_count INT UNSIGNED NOT NULL DEFAULT 0,
  submitted_count INT UNSIGNED NOT NULL DEFAULT 0,
  correct_count INT UNSIGNED NOT NULL DEFAULT 0,
  score INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('in_progress', 'done', 'abandoned') NOT NULL DEFAULT 'in_progress',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ps_student_status (student_id, status),
  KEY idx_ps_student_time (student_id, started_at),
  KEY idx_ps_subject (subject_id),
  CONSTRAINT fk_ps_student_id FOREIGN KEY (student_id) REFERENCES wx_students(id),
  CONSTRAINT fk_ps_subject_id FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS practice_answers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  selected_letters VARCHAR(16) NOT NULL,
  correct_letters VARCHAR(16) NOT NULL,
  is_correct TINYINT(1) NOT NULL,
  cost_ms INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pa_session_question (session_id, question_id),
  KEY idx_pa_student_created (student_id, created_at),
  KEY idx_pa_question (question_id),
  CONSTRAINT fk_pa_session_id FOREIGN KEY (session_id) REFERENCES practice_sessions(id),
  CONSTRAINT fk_pa_student_id FOREIGN KEY (student_id) REFERENCES wx_students(id),
  CONSTRAINT fk_pa_question_id FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS wrong_questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  first_wrong_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_wrong_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  wrong_count INT UNSIGNED NOT NULL DEFAULT 1,
  consecutive_correct INT UNSIGNED NOT NULL DEFAULT 0,
  mastered TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wq_student_question (student_id, question_id),
  KEY idx_wq_student_mastered (student_id, mastered),
  KEY idx_wq_student_last_wrong (student_id, last_wrong_at),
  CONSTRAINT fk_wq_student_id FOREIGN KEY (student_id) REFERENCES wx_students(id),
  CONSTRAINT fk_wq_question_id FOREIGN KEY (question_id) REFERENCES questions(id)
);

INSERT IGNORE INTO subjects (name, sort_order, is_active) VALUES
('语文', 10, 1),
('数学', 20, 1),
('英语', 30, 1),
('物理', 40, 1),
('化学', 50, 1),
('生物', 60, 1),
('历史', 70, 1),
('地理', 80, 1),
('政治', 90, 1),
('餐饮服务与管理', 100, 1),
('前厅服务与管理', 110, 1),
('旅游概论', 120, 1),
('旅游地理', 130, 1);
