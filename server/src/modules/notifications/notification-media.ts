/** 单条通知允许携带的业务附件硬上限；事件渠道的 IMAGE 内容项还会各自设置更小的 maxCount。 */
export const MAX_NOTIFICATION_MEDIA_ATTACHMENTS = 3

/** 一期只发送图片；视频（`postVideo` 需要封面与时长）留到二期。 */
export const NOTIFICATION_MEDIA_ALLOWED_KINDS = ['IMAGE'] as const

export type NotificationMediaKind = (typeof NOTIFICATION_MEDIA_ALLOWED_KINDS)[number]

export interface NotificationMediaInput {
  readonly assetId: string
  /**
   * 业务语义来源键（如 `advertising.proof`），必须在事件契约中声明。
   * 事件渠道的 IMAGE 内容项按来源键决定哪些附件真正发送。
   */
  readonly sourceKey?: string
}
