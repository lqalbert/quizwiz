import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import questionsRouter from './routes/questions.js';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';
import { requireRole } from './middleware/requireRole.js';
import usersRouter from './routes/users.js';
import { pool } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/admin-ui', express.static(path.resolve(__dirname, '../admin')));
app.use('/templates', express.static(path.resolve(__dirname, '../templates')));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/admin/auth', authRouter);
app.use('/admin/questions', requireAuth, questionsRouter);
app.use('/admin/users', requireAuth, requireRole('admin'), usersRouter);

app.get('/admin/templates/question-import', requireAuth, async (req, res) => {
  const filePath = path.resolve(__dirname, '../templates/question_import_template.xlsx');
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ message: 'template file not found' });
    return;
  }
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
  res.download(filePath, 'question_import_template.xlsx');
});

export default app;
