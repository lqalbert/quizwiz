-- 班级作业：教师布置题目清单，学生通过 mode=assignment 练习会话完成闭环。
-- 依赖：classes、class_members、questions、users、schema_v2 的 practice_sessions
-- mysql -u root -p quizwiz < sql/class_assignments_v1.sql

USE quizwiz;

CREATE TABLE IF NOT EXISTS class_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  class_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  due_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ca_class (class_id),
  KEY idx_ca_owner (owner_user_id),
  CONSTRAINT fk_ca_class_a FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ca_owner_u FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assignment_questions (
  assignment_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (assignment_id, question_id),
  KEY idx_aq_question (question_id),
  CONSTRAINT fk_aq_assign FOREIGN KEY (assignment_id) REFERENCES class_assignments(id) ON DELETE CASCADE,
  CONSTRAINT fk_aq_question FOREIGN KEY (question_id) REFERENCES questions(id)
);

ALTER TABLE practice_sessions
  ADD COLUMN assignment_id BIGINT UNSIGNED NULL COMMENT '班级作业会话' AFTER difficulty;

ALTER TABLE practice_sessions
  ADD KEY idx_ps_assignment (assignment_id),
  ADD CONSTRAINT fk_ps_assignment FOREIGN KEY (assignment_id) REFERENCES class_assignments(id) ON DELETE SET NULL;

ALTER TABLE practice_sessions
  MODIFY COLUMN mode ENUM('random', 'sequential', 'wrong', 'favorite', 'assignment') NOT NULL DEFAULT 'random';
