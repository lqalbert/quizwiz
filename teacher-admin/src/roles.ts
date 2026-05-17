/** 教师端角色与菜单权限（与后端 hasRole / 数据范围校验对齐） */

export type RoleCode = 'admin' | 'class_teacher' | 'subject_teacher'

export function hasRole(roles: string[] | undefined, code: RoleCode) {
  return Boolean(roles?.includes(code))
}

export function canAccessTeacherAccounts(roles: string[] | undefined) {
  return hasRole(roles, 'admin') || hasRole(roles, 'class_teacher')
}

export function canAccessSystemSettings(roles: string[] | undefined) {
  return hasRole(roles, 'admin')
}

export function canCreateClass(roles: string[] | undefined) {
  return hasRole(roles, 'admin') || hasRole(roles, 'class_teacher')
}

/** 资料库：查看与上传（科任仅可作用于已加入班级，由后端校验） */
export function canManageResources(roles: string[] | undefined) {
  return hasRole(roles, 'admin') || hasRole(roles, 'class_teacher') || hasRole(roles, 'subject_teacher')
}

/** 资料下载审计：仅管理员与班主任 */
export function canViewResourceAudit(roles: string[] | undefined) {
  return hasRole(roles, 'admin') || hasRole(roles, 'class_teacher')
}

export function canHandleStudentWarning(roles: string[] | undefined) {
  return hasRole(roles, 'admin') || hasRole(roles, 'class_teacher')
}

export function isSubjectTeacherOnly(roles: string[] | undefined) {
  return (
    hasRole(roles, 'subject_teacher') &&
    !hasRole(roles, 'admin') &&
    !hasRole(roles, 'class_teacher')
  )
}

export function filterSubjectsByRole<T extends { value: number }>(
  roles: string[] | undefined,
  subjectIds: number[] | undefined,
  options: T[],
) {
  if (!isSubjectTeacherOnly(roles)) return options
  const allowed = new Set((subjectIds || []).map((id) => Number(id)).filter((id) => id > 0))
  if (allowed.size === 0) return []
  return options.filter((o) => allowed.has(Number(o.value)))
}
