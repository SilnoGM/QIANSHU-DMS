/**
 * 表外水单的业务闸门只关心「是否已进入任一外发渠道队列」。
 *
 * 站内 IN_APP 不算发送水单；ASSISTANT 与 WECOM 都是实际外发渠道。
 * 收件人被全部跳过时也不能视为已入队，否则申请会推进到待确认却没人收到水单。
 */
const OUTBOUND_NOTIFICATION_CHANNELS = ['ASSISTANT', 'WECOM'] as const

export function hasQueuedOutboundDelivery(
  channels: readonly {
    readonly channel: string
    readonly status: string
    readonly recipientCount: number
    readonly skippedCount: number
  }[],
): boolean {
  return channels.some(candidate =>
    (OUTBOUND_NOTIFICATION_CHANNELS as readonly string[]).includes(candidate.channel)
    && candidate.status === 'PENDING'
    && candidate.recipientCount - candidate.skippedCount >= 1,
  )
}
