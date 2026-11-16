import {
  DISABLED_NOTIFICATION_MEDIA_POLICY,
  MAX_NOTIFICATION_MEDIA_ATTACHMENTS,
  normalizeNotificationMediaPolicy,
  parseNotificationMediaPolicy,
} from './notification-media'

describe('notification media policy', () => {
  it('treats missing, malformed or disabled policy as no attachments', () => {
    expect(parseNotificationMediaPolicy(null)).toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({})).toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({ enabled: 'yes', maxCount: 3, kinds: ['IMAGE'] })).toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({ enabled: false, maxCount: 3, kinds: ['IMAGE'] })).toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 0, kinds: ['IMAGE'] })).toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 3, kinds: ['VIDEO'] })).toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 3, kinds: [] })).toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
  })

  it('clamps a valid policy to the hard attachment cap', () => {
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 9, kinds: ['IMAGE'] })).toEqual({
      enabled: true,
      maxCount: MAX_NOTIFICATION_MEDIA_ATTACHMENTS,
      kinds: ['IMAGE'],
      sources: [],
    })
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 2, kinds: ['IMAGE', 'VIDEO'] })).toEqual({
      enabled: true,
      maxCount: 2,
      kinds: ['IMAGE'],
      sources: [],
    })
  })

  it('parses selected sources and fails closed on malformed source lists', () => {
    expect(parseNotificationMediaPolicy({
      enabled: true,
      maxCount: 2,
      kinds: ['IMAGE'],
      sources: ['advertising.proof', 'advertising.qr', 'advertising.proof'],
    })).toEqual({
      enabled: true,
      maxCount: 2,
      kinds: ['IMAGE'],
      sources: ['advertising.proof', 'advertising.qr'],
    })
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 2, kinds: ['IMAGE'], sources: 'advertising.qr' }))
      .toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 2, kinds: ['IMAGE'], sources: [''] }))
      .toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
    expect(parseNotificationMediaPolicy({ enabled: true, maxCount: 2, kinds: ['IMAGE'], sources: [42] }))
      .toEqual(DISABLED_NOTIFICATION_MEDIA_POLICY)
  })

  it('normalizes administrator input and rejects unsupported configuration', () => {
    expect(normalizeNotificationMediaPolicy({ enabled: false })).toEqual({ ok: true, policy: DISABLED_NOTIFICATION_MEDIA_POLICY })
    expect(normalizeNotificationMediaPolicy({ enabled: true, maxCount: 2 })).toEqual({
      ok: true,
      policy: { enabled: true, maxCount: 2, kinds: ['IMAGE'], sources: [] },
    })
    expect(normalizeNotificationMediaPolicy({
      enabled: true,
      maxCount: 2,
      sources: ['salesReceipt.voucher'],
    })).toEqual({
      ok: true,
      policy: { enabled: true, maxCount: 2, kinds: ['IMAGE'], sources: ['salesReceipt.voucher'] },
    })
    expect(normalizeNotificationMediaPolicy({ enabled: true, maxCount: 2, sources: [''] })).toEqual({
      ok: false,
      code: 'MEDIA_SOURCE_INVALID',
    })
    expect(normalizeNotificationMediaPolicy({ enabled: true, maxCount: 0 })).toEqual({
      ok: false,
      code: 'MEDIA_COUNT_INVALID',
    })
    expect(normalizeNotificationMediaPolicy({ enabled: true, maxCount: 4 })).toEqual({
      ok: false,
      code: 'MEDIA_COUNT_INVALID',
    })
    expect(normalizeNotificationMediaPolicy({ enabled: true, maxCount: 1, kinds: ['VIDEO'] })).toEqual({
      ok: false,
      code: 'MEDIA_KIND_UNSUPPORTED',
    })
  })
})
