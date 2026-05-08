/**
 * 刷题 / 错题本目录默认选中科目：优先「英语」
 * @param {Array<{ id: number, name?: string }>} subjects
 * @returns {number} 无列表时为 0
 */
function defaultStudentSubjectId(subjects) {
  if (!Array.isArray(subjects) || subjects.length === 0) return 0;
  const norm = (s) => String(s.name || "").trim();
  const en = subjects.find((s) => {
    const n = norm(s);
    return n === "英语" || n === "英文" || n.includes("英语");
  });
  if (en && en.id > 0) return en.id;
  return subjects[0].id || 0;
}

module.exports = { defaultStudentSubjectId };
