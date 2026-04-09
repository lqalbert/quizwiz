USE quizwiz;

ALTER TABLE wrong_questions
  ADD COLUMN is_priority TINYINT(1) NOT NULL DEFAULT 0;

CREATE INDEX idx_wq_student_priority ON wrong_questions (student_id, is_priority);
