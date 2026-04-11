import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import xlsx from 'xlsx';
import questionsRouter from './routes/questions.js';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';
import { requireRole } from './middleware/requireRole.js';
import usersRouter from './routes/users.js';
import wxRouter from './routes/wx.js';
import subjectsRouter from './routes/subjects.js';
import questionReportsRouter from './routes/questionReports.js';
import classesRouter from './routes/classes.js';
import classAssignmentsRouter from './routes/classAssignments.js';
import { pool } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/admin-ui', express.static(path.resolve(__dirname, '../admin')));
app.use('/templates', express.static(path.resolve(__dirname, '../templates')));

function buildQuestionTemplateBuffer() {
  const headers = [
    '题型',
    '题干',
    'A选项',
    'B选项',
    'C选项',
    'D选项',
    '答案',
    '解析',
    '知识点',
    '难度',
    '章节',
    '状态',
    '学科',
  ];
  const sampleRows = [
    headers,
    [
      '单选',
      '下列哪一个是 JavaScript 运行时环境？',
      'Node.js',
      'MySQL',
      'Nginx',
      'Redis',
      'A',
      'Node.js 是 JavaScript 运行时环境。',
      '编程基础,JavaScript',
      '2',
      '第1章',
      'published',
      '英语',
    ],
  ];
  const worksheet = xlsx.utils.aoa_to_sheet(sampleRows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, '题目导入模板');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/admin/auth', authRouter);
app.use('/admin/questions', requireAuth, questionsRouter);
app.use('/admin/users', requireAuth, requireRole('admin'), usersRouter);
app.use('/admin/subjects', requireAuth, requireRole('admin'), subjectsRouter);
app.use('/admin/question-reports', requireAuth, questionReportsRouter);
app.use('/admin/classes', requireAuth, requireRole('admin', 'teacher'), classesRouter);
app.use(
  '/admin/classes/:classId(\\d+)/assignments',
  requireAuth,
  requireRole('admin', 'teacher'),
  classAssignmentsRouter
);
app.use('/wx', wxRouter);

app.get('/admin/templates/question-import', requireAuth, async (req, res) => {
  const filePath = path.resolve(__dirname, '../templates/question_import_template.xlsx');
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, object_type, object_id, change_summary)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user?.id || null,
        req.user?.role || null,
        'READ_TEMPLATE_DOWNLOAD',
        'template',
        0,
        JSON.stringify({ template: 'question_import_template.xlsx' }),
      ]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[audit] template download write failed:', error.message);
  }

  // 优先使用静态模板；若文件缺失则动态生成，避免下载功能失效
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'question_import_template.xlsx');
    return;
  }

  const buffer = buildQuestionTemplateBuffer();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="question_import_template.xlsx"');
  res.send(buffer);
});

// 静态模板文件缺失时，给 /templates 路径提供动态兜底
app.get('/templates/question_import_template.xlsx', (req, res) => {
  const filePath = path.resolve(__dirname, '../templates/question_import_template.xlsx');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'question_import_template.xlsx');
    return;
  }
  const buffer = buildQuestionTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="question_import_template.xlsx"');
  res.send(buffer);
});

export default app;
