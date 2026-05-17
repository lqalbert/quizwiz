/** 知识点所属知识单元；题目同一批标签须落在同一单元下 */
export const DEFAULT_KNOWLEDGE_UNIT_NAME = '未分类'

/** 资料库上传单文件上限（与 multer resourceUpload 一致） */
export const RESOURCE_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024

/** 接口契约版本：递增表示行为变更。线上与本地 curl /api/health 对比此字段可确认是否已部署同一套 API。 */
export const API_REVISION = 5
