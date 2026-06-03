const { formatStemForDisplay } = require("./stemFormat.js");
const { request } = require("./request.js");

function defaultOptionsForQuestionType(questionType) {
  const t = Number(questionType);
  if (t === 3) {
    return [
      { option_key: "A", option_text: "对" },
      { option_key: "B", option_text: "错" },
    ];
  }
  return [];
}

function normalizeOptionsList(raw, questionType) {
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch (_) {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) arr = [];
  const options = arr
    .map((opt) => ({
      option_key: opt && opt.option_key != null ? String(opt.option_key) : "",
      option_text: opt && opt.option_text != null ? String(opt.option_text) : "",
    }))
    .filter((opt) => opt.option_key || opt.option_text);
  if (options.length) return options;
  return defaultOptionsForQuestionType(questionType);
}

function formatRecordQuestionRow(row) {
  const options = normalizeOptionsList(row && row.options, row && row.question_type).map((opt) => ({
    option_key: opt.option_key,
    option_text: formatStemForDisplay(opt.option_text),
  }));
  return {
    ...row,
    stem: formatStemForDisplay(row && row.stem),
    options,
    showOptions: options.length > 0,
  };
}

function needsOptionsFromServer(row) {
  const t = Number(row && row.question_type);
  if (t !== 1 && t !== 2 && t !== 3) return false;
  const raw = row && row.options;
  if (!raw) return true;
  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw === "string") return !String(raw).trim();
  return true;
}

async function fetchOptionsMapForQuestionIds(questionIds) {
  const ids = [];
  const seen = new Set();
  for (const x of questionIds || []) {
    const id = Number(x);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) return {};
  try {
    const res = await request({
      path: "/api/student/stats/question-options-batch",
      method: "POST",
      data: { question_ids: ids },
    });
    const data = (res && res.data) || {};
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (_) {
    return {};
  }
}

/** 列表接口未带 options 时，批量补拉后再格式化 */
async function enrichRecordRowsWithOptions(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const needIds = [];
  for (const row of list) {
    if (needsOptionsFromServer(row)) needIds.push(row.question_id);
  }
  if (!needIds.length) return list.map((row) => formatRecordQuestionRow(row));

  const optionsMap = await fetchOptionsMapForQuestionIds(needIds);
  return list.map((row) => {
    const qid = Number(row.question_id);
    const fromMap = optionsMap[String(qid)] || optionsMap[qid];
    const merged =
      row.options && (Array.isArray(row.options) ? row.options.length : typeof row.options === "string")
        ? row.options
        : fromMap || row.options;
    return formatRecordQuestionRow({ ...row, options: merged });
  });
}

module.exports = {
  formatRecordQuestionRow,
  enrichRecordRowsWithOptions,
  normalizeOptionsList,
};
