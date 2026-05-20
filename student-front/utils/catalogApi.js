const { request } = require("./request.js");

function catalogPaths() {
  const token = Boolean(wx.getStorageSync("student_token"));
  const needJoin = wx.getStorageSync("need_join_class") === "1";
  if (token && !needJoin) {
    return {
      subjects: "/api/student/subjects",
      knowledgeUnits: (subjectId) =>
        `/api/student/catalog/knowledge-units?subject_id=${subjectId}`,
      unitDetail: (unitId) => `/api/student/catalog/unit-detail?unit_id=${unitId}`,
    };
  }
  return {
    subjects: "/api/public/catalog/subjects",
    knowledgeUnits: (subjectId) =>
      `/api/public/catalog/knowledge-units?subject_id=${subjectId}`,
    unitDetail: (unitId) => `/api/public/catalog/unit-detail?unit_id=${unitId}`,
  };
}

function catalogUsesStudentApi() {
  return catalogPaths().subjects.startsWith("/api/student");
}

module.exports = { catalogPaths, catalogUsesStudentApi };
