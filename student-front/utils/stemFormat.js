/**
 * 将题干里常见的 HTML 换行标签转为换行符，便于 <text> + white-space:pre-line 展示。
 */
function formatStemForDisplay(stem) {
  return String(stem ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "\n");
}

module.exports = { formatStemForDisplay };
