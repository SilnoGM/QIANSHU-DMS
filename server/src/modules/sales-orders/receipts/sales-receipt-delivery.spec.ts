import { hasQueuedOutboundDelivery } from './sales-receipt-delivery'

describe('hasQueuedOutboundDelivery', () => {
  it('accepts a pending WECOM delivery as a queued outbound channel', () => {
    expect(hasQueuedOutboundDelivery([
      { channel: 'WECOM', status: 'PENDING', recipientCount: 1, skippedCount: 0 },
    ])).toBe(true)
  })

  it('does not treat in-app delivery or skipped outbound rows as sent', () => {
    expect(hasQueuedOutboundDelivery([
      { channel: 'IN_APP', status: 'CREATED', recipientCount: 1, skippedCount: 0 },
      { channel: 'WECOM', status: 'SKIPPED', recipientCount: 1, skippedCount: 1 },
    ])).toBe(false)
  })

  it('requires at least one effective recipient', () => {
    expect(hasQueuedOutboundDelivery([
      { channel: 'WECOM', status: 'PENDING', recipientCount: 1, skippedCount: 1 },
    ])).toBe(false)
  })
})
