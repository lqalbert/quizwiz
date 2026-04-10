import { pool } from './db.js';

export async function writeAuditLog(executor, action, objectType, objectId, changeSummary, conn = null) {
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
