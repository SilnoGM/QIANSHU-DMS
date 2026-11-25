/**
 * 表外水单的业务闸门只关心「是否已进入企业微信外发队列」。
 *
 * 站内 IN_APP 不算发送水单；收件人被全部跳过时也不能视为已入队，
 * 否则申请会推进到待确认却没人收到水单。
 */
export function hasQueuedOutboundDelivery(
  channels: readonly {
    readonly channel: string
    readonly status: string
    readonly recipientCount: number
    readonly skippedCount: number
  }[],
): boolean {
  return channels.some(candidate =>
    candidate.channel === 'WECOM'
    && candidate.status === 'PENDING'
    && candidate.recipientCount - candidate.skippedCount >= 1,
  )
}
