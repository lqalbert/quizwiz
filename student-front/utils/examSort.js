/** 考试列表：按开始时间倒序，同时间按 id 倒序 */

function sortExamsNewestFirst(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a, b) => {
    const ta = a && a.start_time ? new Date(a.start_time).getTime() : 0;
    const tb = b && b.start_time ? new Date(b.start_time).getTime() : 0;
    const sa = Number.isFinite(ta) ? ta : 0;
    const sb = Number.isFinite(tb) ? tb : 0;
    if (sb !== sa) return sb - sa;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
  return arr;
}

module.exports = { sortExamsNewestFirst };
