import type { NotificationTemplateMediaPolicyInputDto } from '@/api/generated/types.gen'

/**
 * 模板保存时的附件策略载荷。
 *
 * 关闭附件时不能带 maxCount：服务端 DTO 对 maxCount 有 1–3 的下限，
 * 0 会被当成参数校验失败（422）；禁用语义由 enabled=false 承担。
 * 站内通知一期不支持附件，草稿开关对 IN_APP 不生效。
 */
export function buildTemplateMediaPolicyPayload(draft: {
  readonly channel: 'IN_APP' | 'WECOM'
  readonly enabled: boolean
  readonly maxCount: number
  readonly sources: readonly string[]
}): NotificationTemplateMediaPolicyInputDto {
  if (draft.channel === 'IN_APP' || !draft.enabled) {
    return { enabled: false }
  }
  return {
    enabled: true,
    maxCount: draft.maxCount,
    kinds: ['IMAGE'],
    sources: [...draft.sources],
  }
}
