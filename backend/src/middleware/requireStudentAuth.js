import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * 校验学生端 JWT（role === student），与教师后台 JWT 共用同一 secret，通过 role 区分。
 */
export function requireStudentAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ message: '请先登录' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (payload.role !== 'student') {
      res.status(403).json({ message: '无效的学生令牌' });
      return;
    }
    req.student = {
      id: Number(payload.sub),
    };
    next();
  } catch {
    res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}
