export function requireRole(...roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowed.has(role)) {
      res.status(403).json({ message: '当前账号无权限执行该操作' });
      return;
    }
    next();
  };
}
