import type { AuditEventDto } from '@/api/generated/types.gen'

export interface AuditMetadataEntry {
  key: string
  value: string
}

export interface AuditOutcomeTagPresentation {
  class?: string
  variant: 'destructive' | 'outline'
}

const SUCCESS_TAG_CLASS = [
  'border-green-600/30 bg-green-600/10 text-green-700',
  'dark:border-green-400/30 dark:bg-green-400/10 dark:text-green-400',
].join(' ')

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
  REGION_CREATED: '地区已创建',
  REGION_UPDATED: '地区已更新',
  REGION_ENABLED: '地区已启用',
  REGION_DISABLED: '地区已停用',
  CURRENCY_CREATED: '货币已创建',
  CURRENCY_UPDATED: '货币已更新',
  CURRENCY_ENABLED: '货币已启用',
  CURRENCY_DISABLED: '货币已停用',
  EXCHANGE_RATE_CREATED: '汇率已创建',
  EXCHANGE_RATE_UPDATED: '汇率已更新',
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

/**
 * 展示名帮助管理员快速识别操作者，稳定的用户 ID 仍由页面相邻列完整保留。
 * USER 理论上总能通过受 Restrict 保护的外键找到用户；若数据异常则显式提示，
 * SYSTEM 与 ANONYMOUS 本来就没有用户展示名，因此使用中性占位符。
 */
export function formatAuditActorDisplayName(
  actorType: string,
  displayName: string | null,
): string {
  const normalizedDisplayName = displayName?.trim()
  if (normalizedDisplayName) {
    return normalizedDisplayName
  }
  return actorType === 'USER' ? '未知用户' : '—'
}

/** 桌面表格与移动卡片共享同一状态语义，避免两套视图出现颜色漂移。 */
export function auditOutcomeTagPresentation(
  outcome: string,
): AuditOutcomeTagPresentation {
  if (outcome === 'SUCCESS') {
    return {
      class: SUCCESS_TAG_CLASS,
      variant: 'outline',
    }
  }
  return { variant: 'destructive' }
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
