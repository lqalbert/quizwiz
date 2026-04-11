-- 班级：教师管理学生分组，用于练习看板、时间线、班级易错题统计。
-- 在已有 quizwiz 库执行：mysql -u root -p quizwiz < sql/classes_v1.sql

USE quizwiz;

CREATE TABLE IF NOT EXISTS classes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  invite_code VARCHAR(12) NULL COMMENT '学生加入班级用邀请码',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_classes_owner (owner_user_id),
  UNIQUE KEY uk_classes_invite_code (invite_code),
  CONSTRAINT fk_classes_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS class_members (
  class_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  note VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (class_id, student_id),
  KEY idx_cm_student (student_id),
  CONSTRAINT fk_cm_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_student FOREIGN KEY (student_id) REFERENCES wx_students(id) ON DELETE CASCADE
);
