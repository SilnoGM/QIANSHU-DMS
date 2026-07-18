import type { AuditEventDto } from '@/api/generated/types.gen'

export interface AuditMetadataEntry {
  key: string
  value: string
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  AUTH_LOGIN_SUCCEEDED: '登录成功',
  AUTH_LOGIN_FAILED: '登录失败',
  AUTH_LOGOUT: '退出登录',
  AUTH_LOGOUT_ALL: '退出全部登录',
  USER_CREATED: '用户已创建',
  USER_UPDATED: '用户已更新',
  USER_ENABLED: '用户已启用',
  USER_DISABLED: '用户已禁用',
  USER_PASSWORD_CHANGED: '用户密码已修改',
  USER_PASSWORD_RESET: '用户密码已重置',
  USER_ROLES_CHANGED: '用户角色已变更',
  ROLE_CREATED: '角色已创建',
  ROLE_UPDATED: '角色已更新',
  ROLE_PERMISSIONS_CHANGED: '角色权限已变更',
  SYSTEM_BOOTSTRAP: '系统管理员已初始化',
  SYSTEM_ADMIN_RECOVERED: '系统管理员已恢复',
  AUTH_RETENTION_PURGED: '认证保留数据已清理',
}

export function auditMetadataEntries(
  metadata: AuditEventDto['metadata'],
): AuditMetadataEntry[] {
  return Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      value: value === null ? 'null' : String(value),
    }))
}

export function formatAuditEvent(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType
}

export function formatAuditOutcome(outcome: string): string {
  if (outcome === 'SUCCESS') {
    return '成功'
  }
  if (outcome === 'FAILURE') {
    return '失败'
  }
  return outcome
}

export function formatAuditTime(value: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp)
}
