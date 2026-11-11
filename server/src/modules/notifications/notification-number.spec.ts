import {
  hashNotificationNumberIdempotencyKey,
  hashNotificationNumberRequestFingerprint,
  NOTIFICATION_NUMBER_CONSUMER_CODE,
  NOTIFICATION_NUMBER_RULE_CODE,
} from './notification-number'

describe('notification numbering identity', () => {
  it('uses the dedicated notification rule and consumer', () => {
    expect(NOTIFICATION_NUMBER_RULE_CODE).toBe('NOTIFICATION_NO')
    expect(NOTIFICATION_NUMBER_CONSUMER_CODE).toBe('NOTIFICATION.CREATE')
  })

  it('derives stable scoped hashes from the notification dedupe key', () => {
    const dedupeKey = 'PURCHASE_REVIEW_PENDING:purchase-review:order-1'
    const idempotency = hashNotificationNumberIdempotencyKey(dedupeKey)
    const fingerprint = hashNotificationNumberRequestFingerprint(dedupeKey)

    expect(idempotency).toMatch(/^[0-9a-f]{64}$/u)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(idempotency).not.toBe(fingerprint)
    expect(hashNotificationNumberIdempotencyKey(dedupeKey)).toBe(idempotency)
    expect(hashNotificationNumberIdempotencyKey(`${dedupeKey}:other`)).not.toBe(idempotency)
  })
})
