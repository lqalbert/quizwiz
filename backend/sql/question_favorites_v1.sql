USE quizwiz;

CREATE TABLE IF NOT EXISTS question_favorites (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qf_student_question (student_id, question_id),
  KEY idx_qf_student_created (student_id, created_at),
  CONSTRAINT fk_qf_student FOREIGN KEY (student_id) REFERENCES wx_students(id),
  CONSTRAINT fk_qf_question FOREIGN KEY (question_id) REFERENCES questions(id)
);
