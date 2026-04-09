import express from 'express';
import multer from 'multer';
import { pool } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  buildPreparedQuestion,
  ImportErrorCode,
  parseExcelBuffer,
  validateQuestionPayload,
} from '../services/importService.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(dateStr) {
  if (!datePattern.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function assertUploadFile(req, res) {
  if (!req.file) {
    res.status(400).json({ message: 'file is required' });
    return false;
  }
  return true;
}

function toFailure(rowNumber, reason, message, rawRow) {
  return {
    rowNumber,
    status: 'failed',
    reason,
    message,
    payloadJson: rawRow || null,
  };
}

async function insertImportJob(mode, fileName) {
  // 兼容老调用：没有登录上下文时 created_by 为空
  return insertImportJobWithActor(mode, fileName, null);
}

async function insertImportJobWithActor(mode, fileName, actorId) {
  const [result] = await pool.query(
    'INSERT INTO import_jobs (mode, file_name, status, created_by) VALUES (?, ?, ?, ?)',
    [mode, fileName, 'running', actorId]
  );
  return result.insertId;
}

async function finishImportJob(jobId, summary) {
  await pool.query(
    `UPDATE import_jobs
      SET total_rows = ?, success_count = ?, fail_count = ?, status = ?, updated_at = NOW()
      WHERE id = ?`,
    [summary.totalRows, summary.successCount, summary.failCount, summary.status, jobId]
  );
}

async function insertJobRow(jobId, row) {
  await pool.query(
    `INSERT INTO import_job_rows (job_id, \`row_number\`, \`status\`, reason, \`message\`, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [
      jobId,
      row.rowNumber,
      row.status,
      row.reason || null,
      row.message || null,
      row.payloadJson ? JSON.stringify(row.payloadJson) : null,
    ]
  );
}

async function checkDuplicateByHash(hash) {
  const [rows] = await pool.query(
    'SELECT id FROM questions WHERE content_hash = ? AND is_deleted = 0 LIMIT 1',
    [hash]
  );
  return rows.length > 0;
}

async function getOrCreateKnowledgePoint(conn, name) {
  const [rows] = await conn.query('SELECT id FROM knowledge_points WHERE name = ? LIMIT 1', [name]);
  if (rows.length > 0) return rows[0].id;

  const [result] = await conn.query('INSERT INTO knowledge_points (name) VALUES (?)', [name]);
  return result.insertId;
}

async function getOrCreateSubject(conn, name) {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  const [rows] = await conn.query('SELECT id FROM subjects WHERE name = ? LIMIT 1', [normalized]);
  if (rows.length > 0) return rows[0].id;
  const [result] = await conn.query('INSERT INTO subjects (name, sort_order, is_active) VALUES (?, 0, 1)', [
    normalized,
  ]);
  return result.insertId;
}

async function bindQuestionSubject(conn, questionId, subjectName) {
  try {
    const subjectId = await getOrCreateSubject(conn, subjectName);
    if (!subjectId) return;
    await conn.query(
      'INSERT IGNORE INTO question_subject_rel (question_id, subject_id) VALUES (?, ?)',
      [questionId, subjectId]
    );
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE' || String(error?.message || '').includes("doesn't exist")) {
      // eslint-disable-next-line no-console
      console.warn('[subject] table missing, skip subject binding');
      return;
    }
    throw error;
  }
}

async function writeAuditLog(executor, action, objectType, objectId, changeSummary, conn = null) {
  try {
    const runner = conn || pool;
    await runner.query(
      `INSERT INTO audit_logs (actor_id, actor_role, action, object_type, object_id, change_summary)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        executor?.id || null,
        executor?.role || null,
        action,
        objectType,
        objectId,
        changeSummary ? JSON.stringify(changeSummary) : null,
      ]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[audit] write failed:', error.message);
  }
}

router.get('/import/jobs', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, mode, status, startDate, endDate } = req.query;
    const limit = Number(pageSize);
    const offset = (Number(page) - 1) * limit;
    if (startDate && !isValidDateString(String(startDate))) {
      res.status(400).json({ message: 'startDate 必须是合法日期，格式 YYYY-MM-DD' });
      return;
    }
    if (endDate && !isValidDateString(String(endDate))) {
      res.status(400).json({ message: 'endDate 必须是合法日期，格式 YYYY-MM-DD' });
      return;
    }
    if (startDate && endDate && String(startDate) > String(endDate)) {
      res.status(400).json({ message: '开始日期不能晚于结束日期' });
      return;
    }

    const where = [];
    const values = [];
    if (mode) {
      where.push('mode = ?');
      values.push(mode);
    }
    if (status) {
      where.push('status = ?');
      values.push(status);
    }
    if (startDate) {
      const normalizedStart = `${startDate} 00:00:00`;
      where.push('created_at >= ?');
      values.push(normalizedStart);
    }
    if (endDate) {
      const normalizedEnd = `${endDate} 23:59:59`;
      where.push('created_at <= ?');
      values.push(normalizedEnd);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT id, mode, file_name AS fileName, total_rows AS totalRows, success_count AS successCount,
              fail_count AS failCount, fail_count AS failedRowCount, status, created_at AS createdAt, updated_at AS updatedAt
         FROM import_jobs
         ${whereClause}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM import_jobs
         ${whereClause}`,
      values
    );

    res.json({
      data: rows,
      page: Number(page),
      pageSize: limit,
      total: countRows[0]?.total || 0,
    });
    await writeAuditLog(req.user, 'READ_IMPORT_JOBS', 'import_job', 0, {
      page: Number(page),
      pageSize: limit,
      mode: mode || null,
      status: status || null,
      startDate: startDate || null,
      endDate: endDate || null,
      total: countRows[0]?.total || 0,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || '查询导入任务失败' });
  }
});

router.get('/import/jobs/:id/rows', async (req, res) => {
  const jobId = Number(req.params.id);
  if (!jobId) {
    res.status(400).json({ message: 'invalid job id' });
    return;
  }

  const { page = 1, pageSize = 100, status, failedOnly } = req.query;
  const limit = Number(pageSize);
  const offset = (Number(page) - 1) * limit;

  const where = ['job_id = ?'];
  const values = [jobId];
  if (String(failedOnly).toLowerCase() === 'true') {
    where.push('`status` = ?');
    values.push('failed');
  } else if (status) {
    where.push('`status` = ?');
    values.push(status);
  }

  const [jobRows] = await pool.query(
    'SELECT id, mode, file_name AS fileName, total_rows AS totalRows, success_count AS successCount, fail_count AS failCount, status FROM import_jobs WHERE id = ? LIMIT 1',
    [jobId]
  );
  if (jobRows.length === 0) {
    res.status(404).json({ message: 'import job not found' });
    return;
  }

  const [rows] = await pool.query(
    `SELECT id, \`row_number\` AS rowNumber, \`status\` AS status, reason, \`message\` AS message, payload_json AS payloadJson, created_at AS createdAt
       FROM import_job_rows
       WHERE ${where.join(' AND ')}
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM import_job_rows
       WHERE ${where.join(' AND ')}`,
    values
  );

  res.json({
    job: jobRows[0],
    data: rows,
    page: Number(page),
    pageSize: limit,
    total: countRows[0]?.total || 0,
  });
  await writeAuditLog(req.user, 'READ_IMPORT_JOB_ROWS', 'import_job', jobId, {
    page: Number(page),
    pageSize: limit,
    status: status || null,
    failedOnly: String(failedOnly).toLowerCase() === 'true',
    total: countRows[0]?.total || 0,
  });
});

router.get('/import/jobs/:id/rows/export', async (req, res) => {
  const jobId = Number(req.params.id);
  if (!jobId) {
    res.status(400).json({ message: 'invalid job id' });
    return;
  }
  const { failedOnly = 'true', status = '' } = req.query;
  const where = ['job_id = ?'];
  const values = [jobId];

  if (String(failedOnly).toLowerCase() === 'true') {
    where.push('`status` = ?');
    values.push('failed');
  } else if (status) {
    where.push('`status` = ?');
    values.push(status);
  }

  const [jobRows] = await pool.query(
    'SELECT id, file_name AS fileName FROM import_jobs WHERE id = ? LIMIT 1',
    [jobId]
  );
  if (jobRows.length === 0) {
    res.status(404).json({ message: 'import job not found' });
    return;
  }

  const [rows] = await pool.query(
    `SELECT \`row_number\` AS rowNumber, \`status\` AS status, reason, \`message\` AS message, payload_json AS payloadJson
       FROM import_job_rows
       WHERE ${where.join(' AND ')}
       ORDER BY id ASC`,
    values
  );

  function csvEscape(value) {
    const s = String(value ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  }

  const headers = ['jobId', 'rowNumber', 'status', 'reason', 'message', 'payloadJson'];
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(jobId),
        csvEscape(row.rowNumber),
        csvEscape(row.status),
        csvEscape(row.reason || ''),
        csvEscape(row.message || ''),
        csvEscape(row.payloadJson ? JSON.stringify(row.payloadJson) : ''),
      ].join(',')
    );
  }
  const csv = `\uFEFF${lines.join('\n')}`;

  await writeAuditLog(req.user, 'EXPORT_IMPORT_JOB_ROWS', 'import_job', jobId, {
    failedOnly: String(failedOnly).toLowerCase() === 'true',
    status: status || null,
    rowCount: rows.length,
  });

  const filename = `import_job_${jobId}_rows.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

router.get('/import/jobs/:id/summary', async (req, res) => {
  const jobId = Number(req.params.id);
  if (!jobId) {
    res.status(400).json({ message: 'invalid job id' });
    return;
  }

  const [jobRows] = await pool.query(
    `SELECT id, mode, file_name AS fileName, total_rows AS totalRows, success_count AS successCount,
            fail_count AS failCount, status, created_at AS createdAt, updated_at AS updatedAt
       FROM import_jobs
       WHERE id = ?
       LIMIT 1`,
    [jobId]
  );
  if (jobRows.length === 0) {
    res.status(404).json({ message: 'import job not found' });
    return;
  }

  const [reasonRows] = await pool.query(
    `SELECT reason, COUNT(*) AS count
       FROM import_job_rows
       WHERE job_id = ? AND \`status\` = 'failed'
       GROUP BY reason
       ORDER BY count DESC`,
    [jobId]
  );

  const [statusRows] = await pool.query(
    `SELECT \`status\` AS status, COUNT(*) AS count
       FROM import_job_rows
       WHERE job_id = ?
       GROUP BY \`status\``,
    [jobId]
  );

  const statusMap = { success: 0, failed: 0 };
  for (const row of statusRows) {
    if (row.status === 'success' || row.status === 'failed') {
      statusMap[row.status] = Number(row.count);
    }
  }

  res.json({
    job: {
      ...jobRows[0],
      successRowCount: statusMap.success,
      failedRowCount: statusMap.failed,
    },
    failureReasonStats: reasonRows.map((row) => ({
      reason: row.reason || 'UNKNOWN',
      count: Number(row.count),
    })),
  });
  await writeAuditLog(req.user, 'READ_IMPORT_JOB_SUMMARY', 'import_job', jobId, {
    successRowCount: statusMap.success,
    failedRowCount: statusMap.failed,
    failureReasonStats: reasonRows.map((row) => ({
      reason: row.reason || 'UNKNOWN',
      count: Number(row.count),
    })),
  });
});

router.get('/', async (req, res) => {
  const {
    page = 1,
    pageSize = 20,
    questionType,
    status,
    chapter,
    keyword,
    difficulty,
    knowledgePoint,
  } = req.query;

  const where = ['q.is_deleted = 0'];
  const values = [];
  let needJoinKnowledgePoint = false;

  if (questionType) {
    where.push('q.question_type = ?');
    values.push(questionType);
  }
  if (status) {
    where.push('q.status = ?');
    values.push(status);
  }
  if (chapter) {
    where.push('q.chapter = ?');
    values.push(chapter);
  }
  if (difficulty) {
    where.push('q.difficulty = ?');
    values.push(Number(difficulty));
  }
  if (keyword) {
    where.push('q.stem LIKE ?');
    values.push(`%${keyword}%`);
  }
  if (knowledgePoint) {
    needJoinKnowledgePoint = true;
    where.push('kp.name = ?');
    values.push(knowledgePoint);
  }

  const limit = Number(pageSize);
  const offset = (Number(page) - 1) * limit;
  const joinClause = needJoinKnowledgePoint
    ? 'JOIN question_knowledge_rel qkr ON qkr.question_id = q.id JOIN knowledge_points kp ON kp.id = qkr.knowledge_point_id'
    : '';

  const [rows] = await pool.query(
    `SELECT DISTINCT q.*
     FROM questions q
     ${joinClause}
     WHERE ${where.join(' AND ')}
     ORDER BY q.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  res.json({ data: rows, page: Number(page), pageSize: limit });
  await writeAuditLog(req.user, 'READ_QUESTION_LIST', 'question', 0, {
    page: Number(page),
    pageSize: limit,
    questionType: questionType || null,
    status: status || null,
    chapter: chapter || null,
    keyword: keyword || null,
    difficulty: difficulty || null,
    knowledgePoint: knowledgePoint || null,
    resultCount: rows.length,
  });
});

router.post('/', async (req, res) => {
  const payload = {
    questionType: req.body.questionType,
    stem: req.body.stem,
    optionA: req.body.optionA,
    optionB: req.body.optionB,
    optionC: req.body.optionC,
    optionD: req.body.optionD,
    answerLetters: req.body.answerLetters,
    analysis: req.body.analysis,
    knowledgePoints: Array.isArray(req.body.knowledgePoints) ? req.body.knowledgePoints : [],
    difficulty: req.body.difficulty === undefined || req.body.difficulty === null || req.body.difficulty === '' ? null : Number(req.body.difficulty),
    chapter: req.body.chapter || null,
    status: req.body.status || 'draft',
    subjectName: String(req.body.subjectName || '').trim(),
  };

  const validation = validateQuestionPayload(payload);
  if (!validation.ok) {
    res.status(400).json({ reason: validation.reason, message: 'payload validation failed' });
    return;
  }

  const prepared = buildPreparedQuestion(payload);
  if (await checkDuplicateByHash(prepared.contentHash)) {
    res.status(409).json({
      reason: ImportErrorCode.duplicateQuestion,
      message: 'duplicate question detected',
    });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO questions
        (question_type, stem, option_a, option_b, option_c, option_d, answer_letters, answer_texts_json, analysis, difficulty, chapter, status, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prepared.questionType,
        prepared.stem,
        prepared.optionA,
        prepared.optionB,
        prepared.optionC || null,
        prepared.optionD || null,
        prepared.answerLetters,
        JSON.stringify(prepared.answerTexts),
        prepared.analysis || null,
        prepared.difficulty,
        prepared.chapter,
        prepared.status,
        prepared.contentHash,
      ]
    );
    const questionId = result.insertId;

    await conn.query(
      'INSERT INTO question_versions (question_id, version_no, snapshot_json) VALUES (?, 1, ?)',
      [
        questionId,
        JSON.stringify({
          questionType: prepared.questionType,
          stem: prepared.stem,
          optionA: prepared.optionA,
          optionB: prepared.optionB,
          optionC: prepared.optionC || null,
          optionD: prepared.optionD || null,
          answerLetters: prepared.answerLetters,
          answerTexts: prepared.answerTexts,
          analysis: prepared.analysis || null,
          difficulty: prepared.difficulty,
          chapter: prepared.chapter,
          status: prepared.status,
          knowledgePoints: prepared.knowledgePoints,
        }),
      ]
    );

    for (const name of prepared.knowledgePoints) {
      const kpId = await getOrCreateKnowledgePoint(conn, name);
      await conn.query(
        'INSERT IGNORE INTO question_knowledge_rel (question_id, knowledge_point_id) VALUES (?, ?)',
        [questionId, kpId]
      );
    }
    await bindQuestionSubject(conn, questionId, prepared.subjectName);

    await writeAuditLog(req.user, 'CREATE_QUESTION', 'question', questionId, { source: 'api' }, conn);

    await conn.commit();
    res.status(201).json({ id: questionId });
  } catch (error) {
    await conn.rollback();
    const duplicate = error && error.code === 'ER_DUP_ENTRY';
    res.status(duplicate ? 409 : 500).json({
      reason: duplicate ? ImportErrorCode.duplicateQuestion : 'INTERNAL_ERROR',
      message: duplicate ? 'duplicate question detected' : error.message,
    });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const questionId = Number(req.params.id);
  if (!questionId) {
    res.status(400).json({ message: 'invalid question id' });
    return;
  }

  const payload = {
    questionType: req.body.questionType,
    stem: req.body.stem,
    optionA: req.body.optionA,
    optionB: req.body.optionB,
    optionC: req.body.optionC,
    optionD: req.body.optionD,
    answerLetters: req.body.answerLetters,
    analysis: req.body.analysis,
    knowledgePoints: Array.isArray(req.body.knowledgePoints) ? req.body.knowledgePoints : [],
    difficulty: req.body.difficulty === undefined || req.body.difficulty === null || req.body.difficulty === '' ? null : Number(req.body.difficulty),
    chapter: req.body.chapter || null,
    status: req.body.status || 'draft',
    subjectName: String(req.body.subjectName || '').trim(),
  };

  const validation = validateQuestionPayload(payload);
  if (!validation.ok) {
    res.status(400).json({ reason: validation.reason, message: 'payload validation failed' });
    return;
  }

  const [existingRows] = await pool.query(
    'SELECT id, current_version FROM questions WHERE id = ? AND is_deleted = 0 LIMIT 1',
    [questionId]
  );
  if (existingRows.length === 0) {
    res.status(404).json({ message: 'question not found' });
    return;
  }

  const prepared = buildPreparedQuestion(payload);
  const [dupRows] = await pool.query(
    'SELECT id FROM questions WHERE content_hash = ? AND id <> ? AND is_deleted = 0 LIMIT 1',
    [prepared.contentHash, questionId]
  );
  if (dupRows.length > 0) {
    res.status(409).json({
      reason: ImportErrorCode.duplicateQuestion,
      message: 'duplicate question detected',
    });
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const nextVersion = Number(existingRows[0].current_version) + 1;
    await conn.query(
      `UPDATE questions
        SET question_type = ?, stem = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?,
            answer_letters = ?, answer_texts_json = ?, analysis = ?, difficulty = ?, chapter = ?,
            status = ?, content_hash = ?, current_version = ?, updated_at = NOW()
        WHERE id = ?`,
      [
        prepared.questionType,
        prepared.stem,
        prepared.optionA,
        prepared.optionB,
        prepared.optionC || null,
        prepared.optionD || null,
        prepared.answerLetters,
        JSON.stringify(prepared.answerTexts),
        prepared.analysis || null,
        prepared.difficulty,
        prepared.chapter,
        prepared.status,
        prepared.contentHash,
        nextVersion,
        questionId,
      ]
    );

    await conn.query(
      'INSERT INTO question_versions (question_id, version_no, snapshot_json) VALUES (?, ?, ?)',
      [
        questionId,
        nextVersion,
        JSON.stringify({
          questionType: prepared.questionType,
          stem: prepared.stem,
          optionA: prepared.optionA,
          optionB: prepared.optionB,
          optionC: prepared.optionC || null,
          optionD: prepared.optionD || null,
          answerLetters: prepared.answerLetters,
          answerTexts: prepared.answerTexts,
          analysis: prepared.analysis || null,
          difficulty: prepared.difficulty,
          chapter: prepared.chapter,
          status: prepared.status,
          knowledgePoints: prepared.knowledgePoints,
        }),
      ]
    );

    await conn.query('DELETE FROM question_knowledge_rel WHERE question_id = ?', [questionId]);
    for (const name of prepared.knowledgePoints) {
      const kpId = await getOrCreateKnowledgePoint(conn, name);
      await conn.query(
        'INSERT IGNORE INTO question_knowledge_rel (question_id, knowledge_point_id) VALUES (?, ?)',
        [questionId, kpId]
      );
    }
    await conn.query('DELETE FROM question_subject_rel WHERE question_id = ?', [questionId]);
    await bindQuestionSubject(conn, questionId, prepared.subjectName);

    await writeAuditLog(req.user, 'UPDATE_QUESTION', 'question', questionId, { version: nextVersion }, conn);

    await conn.commit();
    res.json({ id: questionId, version: nextVersion });
  } catch (error) {
    await conn.rollback();
    const duplicate = error && error.code === 'ER_DUP_ENTRY';
    res.status(duplicate ? 409 : 500).json({
      reason: duplicate ? ImportErrorCode.duplicateQuestion : 'INTERNAL_ERROR',
      message: duplicate ? 'duplicate question detected' : error.message,
    });
  } finally {
    conn.release();
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const [result] = await pool.query(
    'UPDATE questions SET is_deleted = 1, deleted_at = NOW() WHERE id = ? AND is_deleted = 0',
    [req.params.id]
  );
  if (result.affectedRows > 0) {
    await writeAuditLog(req.user, 'DELETE_QUESTION', 'question', Number(req.params.id), {
      softDelete: true,
    });
  }
  res.json({ ok: true });
});

router.post('/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!assertUploadFile(req, res)) return;

    const jobId = await insertImportJobWithActor(
      'preview',
      req.file.originalname || 'upload.xlsx',
      req.user?.id || null
    );
    const rows = parseExcelBuffer(req.file.buffer);
    const seenHashes = new Set();
    const failures = [];
    const successes = [];

    for (const item of rows) {
      const { rowNumber, payload, raw } = item;
      const validation = validateQuestionPayload(payload);
      if (!validation.ok) {
        const failure = toFailure(rowNumber, validation.reason, 'row validation failed', raw);
        failures.push(failure);
        await insertJobRow(jobId, failure);
        continue;
      }

      const prepared = buildPreparedQuestion(payload);
      if (seenHashes.has(prepared.contentHash) || (await checkDuplicateByHash(prepared.contentHash))) {
        const failure = toFailure(
          rowNumber,
          ImportErrorCode.duplicateQuestion,
          'duplicate question detected',
          raw
        );
        failures.push(failure);
        await insertJobRow(jobId, failure);
        continue;
      }

      seenHashes.add(prepared.contentHash);
      const successRow = {
        rowNumber,
        status: 'success',
        message: 'preview ok',
        payloadJson: raw,
      };
      successes.push(successRow);
      await insertJobRow(jobId, successRow);
    }

    const summary = {
      totalRows: rows.length,
      successCount: successes.length,
      failCount: failures.length,
      status: 'done',
    };
    await finishImportJob(jobId, summary);

    res.json({
      jobId,
      ...summary,
      failures: failures.map((x) => ({
        rowNumber: x.rowNumber,
        reason: x.reason,
        message: x.message,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message, reason: 'PREVIEW_FAILED' });
  }
});

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!assertUploadFile(req, res)) return;

    const jobId = await insertImportJobWithActor(
      'import',
      req.file.originalname || 'upload.xlsx',
      req.user?.id || null
    );
    const rows = parseExcelBuffer(req.file.buffer);
    const seenHashes = new Set();
    const failures = [];
    const successes = [];

    for (const item of rows) {
      const { rowNumber, payload, raw } = item;
      const validation = validateQuestionPayload(payload);
      if (!validation.ok) {
        const failure = toFailure(rowNumber, validation.reason, 'row validation failed', raw);
        failures.push(failure);
        await insertJobRow(jobId, failure);
        continue;
      }

      const prepared = buildPreparedQuestion(payload);
      if (seenHashes.has(prepared.contentHash) || (await checkDuplicateByHash(prepared.contentHash))) {
        const failure = toFailure(
          rowNumber,
          ImportErrorCode.duplicateQuestion,
          'duplicate question detected',
          raw
        );
        failures.push(failure);
        await insertJobRow(jobId, failure);
        continue;
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO questions
          (question_type, stem, option_a, option_b, option_c, option_d, answer_letters, answer_texts_json, analysis, difficulty, chapter, status, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          prepared.questionType,
          prepared.stem,
          prepared.optionA,
          prepared.optionB,
          prepared.optionC || null,
          prepared.optionD || null,
          prepared.answerLetters,
          JSON.stringify(prepared.answerTexts),
          prepared.analysis || null,
          prepared.difficulty,
          prepared.chapter,
          prepared.status,
          prepared.contentHash,
        ]
      );

      const questionId = result.insertId;

      await conn.query(
        'INSERT INTO question_versions (question_id, version_no, snapshot_json) VALUES (?, 1, ?)',
        [
          questionId,
          JSON.stringify({
            questionType: prepared.questionType,
            stem: prepared.stem,
            optionA: prepared.optionA,
            optionB: prepared.optionB,
            optionC: prepared.optionC || null,
            optionD: prepared.optionD || null,
            answerLetters: prepared.answerLetters,
            answerTexts: prepared.answerTexts,
            analysis: prepared.analysis || null,
            difficulty: prepared.difficulty,
            chapter: prepared.chapter,
            status: prepared.status,
            knowledgePoints: prepared.knowledgePoints,
          }),
        ]
      );

      for (const name of prepared.knowledgePoints) {
        const kpId = await getOrCreateKnowledgePoint(conn, name);
        await conn.query(
          'INSERT IGNORE INTO question_knowledge_rel (question_id, knowledge_point_id) VALUES (?, ?)',
          [questionId, kpId]
        );
      }
      await bindQuestionSubject(conn, questionId, prepared.subjectName);

      await writeAuditLog(req.user, 'IMPORT_CREATE', 'question', questionId, { jobId, rowNumber }, conn);

        await conn.commit();
        seenHashes.add(prepared.contentHash);
        const successRow = {
          rowNumber,
          status: 'success',
          message: 'imported',
          payloadJson: raw,
        };
        successes.push(successRow);
        await insertJobRow(jobId, successRow);
      } catch (error) {
        await conn.rollback();
        const duplicate = error && error.code === 'ER_DUP_ENTRY';
        const failure = toFailure(
          rowNumber,
          duplicate ? ImportErrorCode.duplicateQuestion : 'IMPORT_ERROR',
          duplicate ? 'duplicate question detected' : error.message,
          raw
        );
        failures.push(failure);
        await insertJobRow(jobId, failure);
      } finally {
        conn.release();
      }
    }

    const summary = {
      totalRows: rows.length,
      successCount: successes.length,
      failCount: failures.length,
      status: 'done',
    };
    await finishImportJob(jobId, summary);

    await writeAuditLog(req.user, 'IMPORT_FINISH', 'import_job', jobId, {
      totalRows: summary.totalRows,
      successCount: summary.successCount,
      failCount: summary.failCount,
    });

    res.json({
      jobId,
      ...summary,
      failures: failures.map((x) => ({
        rowNumber: x.rowNumber,
        reason: x.reason,
        message: x.message,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message, reason: 'IMPORT_FAILED' });
  }
});

export default router;
