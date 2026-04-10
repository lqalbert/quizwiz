USE quizwiz;

CREATE TABLE IF NOT EXISTS question_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  reason_type VARCHAR(32) NOT NULL,
  detail VARCHAR(500) NULL,
  status ENUM('open', 'reviewing', 'closed') NOT NULL DEFAULT 'open',
  admin_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_qr_status_created (status, created_at),
  KEY idx_qr_question (question_id),
  KEY idx_qr_student (student_id),
  CONSTRAINT fk_qr_student FOREIGN KEY (student_id) REFERENCES wx_students(id),
  CONSTRAINT fk_qr_question FOREIGN KEY (question_id) REFERENCES questions(id)
);
