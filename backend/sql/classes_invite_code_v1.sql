-- 班级邀请码：学生凭码加入班级（在已执行 classes_v1.sql 的库上执行）
-- mysql -u root -p quizwiz < sql/classes_invite_code_v1.sql

USE quizwiz;

ALTER TABLE classes
  ADD COLUMN invite_code VARCHAR(12) NULL COMMENT '学生加入班级用邀请码' AFTER name;

CREATE UNIQUE INDEX uk_classes_invite_code ON classes (invite_code);
