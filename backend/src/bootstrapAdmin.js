import bcrypt from 'bcrypt';
import { pool } from './db.js';
import { config } from './config.js';

export async function bootstrapAdminIfNeeded() {
  const email = config.bootstrap.adminEmail.trim();
  const password = config.bootstrap.adminPassword;
  if (!email || !password) {
    return;
  }

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (rows.length > 0) {
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      [email, passwordHash, 'admin']
    );
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      // eslint-disable-next-line no-console
      console.warn(
        '[bootstrap] users table missing. Run sql/auth_users_v1.sql (or full schema_v1.sql), then restart.'
      );
      return;
    }
    throw err;
  }
}
