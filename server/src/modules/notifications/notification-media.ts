import type { Prisma } from '../../generated/prisma/client'

/** 单条通知允许携带的业务附件上限；同时受模板策略限制。 */
export const MAX_NOTIFICATION_MEDIA_ATTACHMENTS = 3

/** 一期只发送图片；视频（`postVideo` 需要封面与时长）留到二期。 */
export const NOTIFICATION_MEDIA_ALLOWED_KINDS = ['IMAGE'] as const

export type NotificationMediaKind = (typeof NOTIFICATION_MEDIA_ALLOWED_KINDS)[number]

export interface NotificationMediaInput {
  readonly assetId: string
}

export interface NotificationMediaPolicy {
  readonly enabled: boolean
  readonly maxCount: number
  readonly kinds: readonly NotificationMediaKind[]
}

/** 未配置或配置不合法时的保守值：不发送任何附件。 */
export const DISABLED_NOTIFICATION_MEDIA_POLICY: NotificationMediaPolicy = Object.freeze({
  enabled: false,
  maxCount: 0,
  kinds: Object.freeze([]),
})

export type NotificationMediaPolicyNormalizationResult =
  | { readonly ok: true, readonly policy: NotificationMediaPolicy }
  | { readonly ok: false, readonly code: 'MEDIA_COUNT_INVALID' | 'MEDIA_KIND_UNSUPPORTED' }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function allowedKinds(value: unknown): NotificationMediaKind[] {
  if (!Array.isArray(value)) {
    return []
  }
  const requested = new Set(value.filter((item): item is string => typeof item === 'string'))
  return NOTIFICATION_MEDIA_ALLOWED_KINDS.filter(kind => requested.has(kind))
}

/**
 * 解析数据库中的附件策略。
 *
 * 任何字段不合法都整体退回「不发送附件」：配置错误不能变成「多发几张图」。
 * `maxCount` 超过硬上限时按上限收敛，不拒绝——历史模板不会因为上限下调而永久失效。
 */
export function parseNotificationMediaPolicy(value: Prisma.JsonValue | null | undefined): NotificationMediaPolicy {
  const record = asRecord(value)
  if (record === null || record.enabled !== true) {
    return DISABLED_NOTIFICATION_MEDIA_POLICY
  }
  const maxCount = record.maxCount
  if (typeof maxCount !== 'number' || !Number.isInteger(maxCount) || maxCount < 1) {
    return DISABLED_NOTIFICATION_MEDIA_POLICY
  }
  const kinds = allowedKinds(record.kinds)
  if (kinds.length === 0) {
    return DISABLED_NOTIFICATION_MEDIA_POLICY
  }
  return {
    enabled: true,
    maxCount: Math.min(maxCount, MAX_NOTIFICATION_MEDIA_ATTACHMENTS),
    kinds,
  }
}

/** 管理端保存时的严格校验：任何不支持的配置都 422，而不是静默收敛。 */
export function normalizeNotificationMediaPolicy(value: {
  readonly enabled?: boolean
  readonly maxCount?: number
  readonly kinds?: readonly string[]
}): NotificationMediaPolicyNormalizationResult {
  if (value.enabled !== true) {
    return { ok: true, policy: DISABLED_NOTIFICATION_MEDIA_POLICY }
  }
  const maxCount = value.maxCount
  if (
    typeof maxCount !== 'number'
    || !Number.isInteger(maxCount)
    || maxCount < 1
    || maxCount > MAX_NOTIFICATION_MEDIA_ATTACHMENTS
  ) {
    return { ok: false, code: 'MEDIA_COUNT_INVALID' }
  }
  const kinds = allowedKinds(value.kinds ?? NOTIFICATION_MEDIA_ALLOWED_KINDS)
  if (kinds.length === 0) {
    return { ok: false, code: 'MEDIA_KIND_UNSUPPORTED' }
  }
  if ((value.kinds ?? []).some(kind => !(NOTIFICATION_MEDIA_ALLOWED_KINDS as readonly string[]).includes(kind))) {
    return { ok: false, code: 'MEDIA_KIND_UNSUPPORTED' }
  }
  return { ok: true, policy: { enabled: true, maxCount, kinds } }
}
