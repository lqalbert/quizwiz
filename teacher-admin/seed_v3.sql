BEGIN;

-- =========================================
-- seed_v3.sql
-- 适配 init_v3.sql 的测试数据
-- =========================================

-- 1) 用户
-- password_hash 这里先放占位，后续由后端用 bcrypt 真正生成
INSERT INTO users (name, phone, password_hash, status)
VALUES
('系统管理员', '13800000001', 'hash_admin', 1),
('高一班主任', '13800000002', 'hash_head_teacher', 1),
('数学科任',   '13800000003', 'hash_math_teacher', 1),
('英语科任',   '13800000004', 'hash_english_teacher', 1)
ON CONFLICT (phone) DO NOTHING;

-- 2) 用户角色
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON
  (u.phone = '13800000001' AND r.code = 'admin') OR
  (u.phone = '13800000002' AND r.code = 'class_teacher') OR
  (u.phone = '13800000003' AND r.code = 'subject_teacher') OR
  (u.phone = '13800000004' AND r.code = 'subject_teacher')
ON CONFLICT DO NOTHING;

-- 3) 科任科目授权
INSERT INTO teacher_subjects (teacher_id, subject_id)
SELECT u.id, s.id
FROM users u
JOIN subjects s ON
  (u.phone = '13800000003' AND s.name = '数学') OR
  (u.phone = '13800000004' AND s.name = '英语')
ON CONFLICT DO NOTHING;

-- 4) 班级
INSERT INTO classes (name, grade, invite_code, owner_id)
SELECT '高一(1)班', '高一', 'A1B2C3', u.id
FROM users u
WHERE u.phone = '13800000002'
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO classes (name, grade, invite_code, owner_id)
SELECT '高一(2)班', '高一', 'D4E5F6', u.id
FROM users u
WHERE u.phone = '13800000002'
ON CONFLICT (invite_code) DO NOTHING;

-- 5) 学生
INSERT INTO students (name, student_no) VALUES
('张三', 'S1001'),
('李四', 'S1002'),
('王五', 'S1003'),
('赵六', 'S1004'),
('孙七', 'S1005'),
('周八', 'S1006'),
('吴九', 'S1007'),
('郑十', 'S1008')
ON CONFLICT (student_no) DO NOTHING;

-- 6) 班级成员
INSERT INTO class_members (class_id, student_id)
SELECT c.id, s.id
FROM classes c
JOIN students s ON s.student_no IN ('S1001','S1002','S1003','S1004')
WHERE c.invite_code = 'A1B2C3'
ON CONFLICT DO NOTHING;

INSERT INTO class_members (class_id, student_id)
SELECT c.id, s.id
FROM classes c
JOIN students s ON s.student_no IN ('S1005','S1006','S1007','S1008')
WHERE c.invite_code = 'D4E5F6'
ON CONFLICT DO NOTHING;

-- 7) 班级科任
INSERT INTO class_teachers (class_id, teacher_id, subject_id)
SELECT c.id, u.id, s.id
FROM classes c
JOIN users u ON u.phone IN ('13800000003','13800000004')
JOIN subjects s ON
  (u.phone='13800000003' AND s.name='数学') OR
  (u.phone='13800000004' AND s.name='英语')
WHERE c.invite_code IN ('A1B2C3','D4E5F6')
ON CONFLICT DO NOTHING;

-- 8) 题目（数学）
INSERT INTO questions (
  subject_id, creator_id, question_type, stem, answer_text, explanation, difficulty
)
SELECT s.id, u.id, 1,
       '已知函数 f(x)=x^2+2x+1，下列说法正确的是：',
       'A',
       'f(x)=(x+1)^2，最小值为0。',
       2
FROM subjects s, users u
WHERE s.name='数学' AND u.phone='13800000003'
AND NOT EXISTS (
  SELECT 1 FROM questions q WHERE q.stem='已知函数 f(x)=x^2+2x+1，下列说法正确的是：'
);

INSERT INTO questions (
  subject_id, creator_id, question_type, stem, answer_text, explanation, difficulty
)
SELECT s.id, u.id, 4,
       '解方程：x^2-5x+6=0，两个根分别是____和____。',
       '2,3',
       '因式分解：(x-2)(x-3)=0。',
       1
FROM subjects s, users u
WHERE s.name='数学' AND u.phone='13800000003'
AND NOT EXISTS (
  SELECT 1 FROM questions q WHERE q.stem='解方程：x^2-5x+6=0，两个根分别是____和____。'
);

-- 9) 题目（英语）
INSERT INTO questions (
  subject_id, creator_id, question_type, stem, answer_text, explanation, difficulty
)
SELECT s.id, u.id, 1,
       'Choose the correct word: He ____ to school every day.',
       'B',
       '主语是第三人称单数，动词用 goes。',
       1
FROM subjects s, users u
WHERE s.name='英语' AND u.phone='13800000004'
AND NOT EXISTS (
  SELECT 1 FROM questions q WHERE q.stem='Choose the correct word: He ____ to school every day.'
);

-- 10) 题目选项（为单选题添加）
INSERT INTO question_options (question_id, option_key, option_text, sort_order)
SELECT q.id, x.k, x.v, x.o
FROM questions q
JOIN (
  VALUES
    ('已知函数 f(x)=x^2+2x+1，下列说法正确的是：','A','f(x)的最小值是0',1),
    ('已知函数 f(x)=x^2+2x+1，下列说法正确的是：','B','f(x)在R上单调递减',2),
    ('已知函数 f(x)=x^2+2x+1，下列说法正确的是：','C','f(x)有两个不同零点',3),
    ('已知函数 f(x)=x^2+2x+1，下列说法正确的是：','D','f(x)最大值是1',4),

    ('Choose the correct word: He ____ to school every day.','A','go',1),
    ('Choose the correct word: He ____ to school every day.','B','goes',2),
    ('Choose the correct word: He ____ to school every day.','C','going',3),
    ('Choose the correct word: He ____ to school every day.','D','gone',4)
) AS x(stem, k, v, o)
  ON q.stem = x.stem
ON CONFLICT (question_id, option_key) DO NOTHING;

-- 11) 标签
INSERT INTO question_tags (name) VALUES
('函数'),
('方程'),
('时态')
ON CONFLICT (name) DO NOTHING;

INSERT INTO question_tag_rel (question_id, tag_id)
SELECT q.id, t.id
FROM questions q
JOIN question_tags t ON
  (q.stem='已知函数 f(x)=x^2+2x+1，下列说法正确的是：' AND t.name='函数') OR
  (q.stem='解方程：x^2-5x+6=0，两个根分别是____和____。' AND t.name='方程') OR
  (q.stem='Choose the correct word: He ____ to school every day.' AND t.name='时态')
ON CONFLICT DO NOTHING;

-- 12) 导入日志示例
INSERT INTO question_import_logs (
  subject_id, uploader_id, file_name, total_rows, success_rows, failed_rows, error_report_url
)
SELECT s.id, u.id, 'math_import_demo.xlsx', 20, 18, 2, '/reports/math_import_demo_errors.xlsx'
FROM subjects s, users u
WHERE s.name='数学' AND u.phone='13800000003'
AND NOT EXISTS (
  SELECT 1 FROM question_import_logs WHERE file_name='math_import_demo.xlsx'
);

-- 13) 考试
INSERT INTO exams (
  title, subject_id, start_time, end_time, duration, creator_id, status, description, settings
)
SELECT
  '高一数学周测01',
  s.id,
  NOW() + INTERVAL '1 day',
  NOW() + INTERVAL '1 day 1 hour',
  60,
  u.id,
  1,
  '函数与方程基础检测',
  '{"allow_early_submit": true, "show_ranking": false, "show_answer": "after_exam"}'::jsonb
FROM subjects s, users u
WHERE s.name='数学' AND u.phone='13800000003'
AND NOT EXISTS (
  SELECT 1 FROM exams e WHERE e.title='高一数学周测01'
);

-- 14) 考试关联班级
INSERT INTO exam_classes (exam_id, class_id)
SELECT e.id, c.id
FROM exams e
JOIN classes c ON c.invite_code IN ('A1B2C3','D4E5F6')
WHERE e.title='高一数学周测01'
ON CONFLICT DO NOTHING;

-- 15) 组卷（数学题）
INSERT INTO exam_questions (exam_id, question_id, score, sort_order)
SELECT e.id, q.id,
       CASE WHEN q.question_type=1 THEN 5 ELSE 10 END AS score,
       ROW_NUMBER() OVER (ORDER BY q.id) AS sort_order
FROM exams e
JOIN questions q ON q.subject_id = e.subject_id
WHERE e.title='高一数学周测01'
ON CONFLICT DO NOTHING;

COMMIT;