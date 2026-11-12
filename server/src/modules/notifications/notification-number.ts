import { createHash } from 'node:crypto'

/** 通知编号由编号域统一发号；规则由建号迁移写入并启用。 */
export const NOTIFICATION_NUMBER_RULE_CODE = 'NOTIFICATION_NO'
export const NOTIFICATION_NUMBER_CONSUMER_CODE = 'NOTIFICATION.CREATE'

/**
 * 编号域的幂等键和业务指纹都只接收定长摘要。两者使用不同域分隔，
 * 避免同一 dedupeKey 在不同语义位点被误认为同一个发号请求。
 */
export function hashNotificationNumberIdempotencyKey(dedupeKey: string): string {
  return createHash('sha256')
    .update(Buffer.from(`notification.create.idempotency.v1\0${dedupeKey}`, 'utf8'))
    .digest('hex')
}

export function hashNotificationNumberRequestFingerprint(dedupeKey: string): string {
  return createHash('sha256')
    .update(Buffer.from(`notification.create.fingerprint.v1\0${dedupeKey}`, 'utf8'))
    .digest('hex')
}
