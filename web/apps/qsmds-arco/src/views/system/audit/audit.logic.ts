import type { AuditEventDto } from '@/api/generated/types.gen'

export type AuditEventType = AuditEventDto['eventType']
export type AuditOutcome = AuditEventDto['outcome']

export interface AuditEventListQuery {
  eventType?: AuditEventType
  outcome?: AuditOutcome
  page: number
  pageSize: number
  requestId?: string
}

/**
 * 生成类型只提供联合类型，没有可在运行时遍历的枚举，因此在页面逻辑层维护公开
 * 事件类型清单。`satisfies` 保证清单中的值始终属于 OpenAPI 生成契约。
 */
export const AUDIT_EVENT_TYPES = [
  'AUTH_LOGIN_SUCCEEDED',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'AUTH_LOGOUT_ALL',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ENABLED',
  'USER_DISABLED',
  'USER_PASSWORD_CHANGED',
  'USER_PASSWORD_RESET',
  'USER_ROLES_CHANGED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_PERMISSIONS_CHANGED',
  'REGION_CREATED',
  'REGION_UPDATED',
  'REGION_ENABLED',
  'REGION_DISABLED',
  'CURRENCY_CREATED',
  'CURRENCY_UPDATED',
  'CURRENCY_ENABLED',
  'CURRENCY_DISABLED',
  'EXCHANGE_RATE_CREATED',
  'EXCHANGE_RATE_UPDATED',
  'NUMBERING_RULE_CREATED',
  'NUMBERING_RULE_UPDATED',
  'NUMBERING_RULE_VERSION_PUBLISHED',
  'NUMBERING_RULE_ENABLED',
  'NUMBERING_RULE_DISABLED',
  'SYSTEM_BOOTSTRAP',
  'SYSTEM_ADMIN_RECOVERED',
  'AUTH_RETENTION_PURGED',
] as const satisfies readonly AuditEventType[]

const AUDIT_EVENT_TYPE_SET = new Set<string>(AUDIT_EVENT_TYPES)
const AUDIT_OUTCOME_SET = new Set<string>(['SUCCESS', 'FAILURE'])

function normalizeEventType(value: unknown): AuditEventType | undefined {
  return typeof value === 'string' && AUDIT_EVENT_TYPE_SET.has(value)
    ? value as AuditEventType
    : undefined
}

function normalizeOutcome(value: unknown): AuditOutcome | undefined {
  return typeof value === 'string' && AUDIT_OUTCOME_SET.has(value)
    ? value as AuditOutcome
    : undefined
}

/**
 * 审计搜索按完整 requestId 精确匹配；筛选值按公开联合类型收敛。
 * 所有空值均省略，避免把 UI 内部占位值泄漏为服务端查询参数。
 */
export function buildAuditEventListQuery(
  page: number,
  pageSize: number,
  requestId: string,
  eventType: unknown,
  outcome: unknown,
): AuditEventListQuery {
  const normalizedRequestId = requestId.normalize('NFC').trim()
  const normalizedEventType = normalizeEventType(eventType)
  const normalizedOutcome = normalizeOutcome(outcome)

  return {
    page,
    pageSize,
    ...(normalizedRequestId === '' ? {} : { requestId: normalizedRequestId }),
    ...(normalizedEventType === undefined ? {} : { eventType: normalizedEventType }),
    ...(normalizedOutcome === undefined ? {} : { outcome: normalizedOutcome }),
  }
}
