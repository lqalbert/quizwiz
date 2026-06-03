const { formatStemForDisplay } = require("./stemFormat.js");

function formatRecordQuestionRow(row) {
  const options = (row.options || []).map((opt) => ({
    option_key: opt.option_key,
    option_text: formatStemForDisplay(opt.option_text),
  }));
  return {
    ...row,
    stem: formatStemForDisplay(row.stem),
    options,
    showOptions: options.length > 0,
  };
}

module.exports = { formatRecordQuestionRow };
