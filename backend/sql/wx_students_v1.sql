-- 微信小程序学生（openid 维度），在已有 quizwiz 库执行：
-- mysql -u root -p quizwiz < sql/wx_students_v1.sql

USE quizwiz;

CREATE TABLE IF NOT EXISTS wx_students (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(64) NOT NULL,
  unionid VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wx_students_openid (openid),
  KEY idx_wx_students_unionid (unionid)
);
