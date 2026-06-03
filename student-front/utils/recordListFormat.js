const { formatStemForDisplay } = require("./stemFormat.js");
const { request } = require("./request.js");

/** 生产环境未部署 batch 接口时，避免每页重复 404 */
let batchOptionsApiAvailable = true;

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

function dedupeQuestionIds(questionIds) {
  const ids = [];
  const seen = new Set();
  for (const x of questionIds || []) {
    const id = Number(x);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function mergeOptionsIntoMap(map, qid, opts) {
  if (opts && Array.isArray(opts) && opts.length) map[qid] = opts;
}

async function fetchOptionsMapViaBatch(questionIds) {
  if (!batchOptionsApiAvailable || !questionIds.length) return null;
  try {
    const res = await request({
      path: "/api/student/stats/question-options-batch",
      method: "POST",
      data: { question_ids: questionIds },
    });
    const data = (res && res.data) || {};
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const map = {};
    for (const qid of questionIds) {
      mergeOptionsIntoMap(map, qid, data[String(qid)] || data[qid]);
    }
    return map;
  } catch (err) {
    if (err && err.statusCode === 404) batchOptionsApiAvailable = false;
    return null;
  }
}

/** 兼容旧版后端：走刷题页同款单题接口补选项 */
async function fetchOptionsMapViaQuestionDetails(questionIds) {
  const map = {};
  const ids = dedupeQuestionIds(questionIds);
  const concurrency = 5;
  for (let i = 0; i < ids.length; i += concurrency) {
    const slice = ids.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (qid) => {
        try {
          const res = await request({ path: `/api/student/questions/${qid}`, method: "GET" });
          const opts = (res && res.data && res.data.options) || [];
          mergeOptionsIntoMap(map, qid, opts);
        } catch (_) {}
      }),
    );
  }
  return map;
}

async function fetchOptionsMapForQuestionIds(questionIds) {
  const ids = dedupeQuestionIds(questionIds);
  if (!ids.length) return {};

  const map = (await fetchOptionsMapViaBatch(ids)) || {};
  const missing = ids.filter((qid) => !(map[qid] && map[qid].length));
  if (!missing.length) return map;

  const detailMap = await fetchOptionsMapViaQuestionDetails(missing);
  return { ...map, ...detailMap };
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
    const fromMap = optionsMap[qid];
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
