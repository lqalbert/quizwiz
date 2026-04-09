import crypto from 'crypto';
import xlsx from 'xlsx';

export const ImportErrorCode = {
  duplicateQuestion: 'DUPLICATE_QUESTION',
  invalidAnswerFormat: 'INVALID_ANSWER_FORMAT',
  missingStem: 'MISSING_STEM',
  missingRequiredField: 'MISSING_REQUIRED_FIELD',
  invalidOptionSet: 'INVALID_OPTION_SET',
  invalidQuestionType: 'INVALID_QUESTION_TYPE',
  invalidDifficulty: 'INVALID_DIFFICULTY',
  missingSubject: 'MISSING_SUBJECT',
};

const validStatus = new Set(['draft', 'published', 'archived']);

export function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/，/g, ',')
    .toLowerCase();
}

export function normalizeAnswerLetters(answer) {
  const letters = String(answer || '')
    .replace(/，/g, ',')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(letters)).sort();
}

function normalizeQuestionType(typeValue) {
  const raw = normalizeText(typeValue);
  if (raw === 'single' || raw === '单选') return 'single';
  if (raw === 'multiple' || raw === '多选') return 'multiple';
  return '';
}

function normalizeStatus(statusValue) {
  const normalized = normalizeText(statusValue);
  if (!normalized) return 'published';
  return validStatus.has(normalized) ? normalized : 'published';
}

function normalizeDifficulty(difficultyValue) {
  if (difficultyValue === null || difficultyValue === undefined || difficultyValue === '') {
    return null;
  }
  const value = Number(difficultyValue);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return NaN;
  }
  return value;
}

function parseKnowledgePoints(raw) {
  return Array.from(
    new Set(
      String(raw || '')
        .replace(/，/g, ',')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
}

function optionTextByLetter(payload, letter) {
  if (letter === 'A') return payload.optionA;
  if (letter === 'B') return payload.optionB;
  if (letter === 'C') return payload.optionC;
  if (letter === 'D') return payload.optionD;
  return '';
}

export function parseExcelBuffer(fileBuffer) {
  const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    defval: '',
    raw: false,
  });

  return rows.map((row, index) => ({
    rowNumber: index + 2,
    raw: row,
    payload: {
      questionType: normalizeQuestionType(row['题型']),
      stem: String(row['题干'] || '').trim(),
      optionA: String(row['选项A'] || row['A选项'] || '').trim(),
      optionB: String(row['选项B'] || row['B选项'] || '').trim(),
      optionC: String(row['选项C'] || row['C选项'] || '').trim(),
      optionD: String(row['选项D'] || row['D选项'] || '').trim(),
      answerLetters: String(row['答案'] || '').trim(),
      analysis: String(row['解析'] || '').trim(),
      knowledgePoints: parseKnowledgePoints(row['知识点']),
      difficulty: normalizeDifficulty(row['难度']),
      chapter: String(row['章节'] || '').trim() || null,
      status: normalizeStatus(row['状态']),
      subjectName: String(row['学科'] || '').trim(),
    },
  }));
}

export function buildContentHash(input) {
  const normalized = {
    questionType: normalizeText(input.questionType),
    stem: normalizeText(input.stem),
    options: (input.options || []).map(normalizeText).filter(Boolean).sort(),
    answerTexts: (input.answerTexts || []).map(normalizeText).filter(Boolean).sort(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function validateQuestionPayload(payload) {
  if (!payload.questionType) {
    return { ok: false, reason: ImportErrorCode.invalidQuestionType };
  }
  if (!payload.stem || !String(payload.stem).trim()) {
    return { ok: false, reason: ImportErrorCode.missingStem };
  }
  if (!payload.optionA || !payload.optionB) {
    return { ok: false, reason: ImportErrorCode.invalidOptionSet };
  }
  if (!Array.isArray(payload.knowledgePoints) || payload.knowledgePoints.length === 0) {
    return { ok: false, reason: ImportErrorCode.missingRequiredField };
  }
  if (Number.isNaN(payload.difficulty)) {
    return { ok: false, reason: ImportErrorCode.invalidDifficulty };
  }
  // 仅要求有学科字段，便于 V2 按学科练习；API 手动创建可传空字符串绕过
  if (payload.subjectName !== undefined && !String(payload.subjectName || '').trim()) {
    return { ok: false, reason: ImportErrorCode.missingSubject };
  }

  const answers = normalizeAnswerLetters(payload.answerLetters);
  if (answers.some((letter) => !['A', 'B', 'C', 'D'].includes(letter))) {
    return { ok: false, reason: ImportErrorCode.invalidAnswerFormat };
  }
  if (payload.questionType === 'single' && answers.length !== 1) {
    return { ok: false, reason: ImportErrorCode.invalidAnswerFormat };
  }
  if (payload.questionType === 'multiple' && answers.length < 2) {
    return { ok: false, reason: ImportErrorCode.invalidAnswerFormat };
  }

  const answerTexts = answers.map((letter) => optionTextByLetter(payload, letter)).filter(Boolean);
  if (answerTexts.length !== answers.length) {
    return { ok: false, reason: ImportErrorCode.invalidAnswerFormat };
  }

  return { ok: true };
}

export function buildPreparedQuestion(payload) {
  const answerLettersArray = normalizeAnswerLetters(payload.answerLetters);
  const answerTexts = answerLettersArray.map((letter) => optionTextByLetter(payload, letter));
  const options = [payload.optionA, payload.optionB, payload.optionC, payload.optionD];

  const contentHash = buildContentHash({
    questionType: payload.questionType,
    stem: payload.stem,
    options,
    answerTexts,
  });

  return {
    ...payload,
    answerLetters: answerLettersArray.join(','),
    answerTexts,
    options,
    contentHash,
  };
}
