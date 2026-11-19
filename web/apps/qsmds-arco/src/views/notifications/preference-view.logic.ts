import type { NotificationPreferenceEventDto } from '@/api/generated/types.gen'

export const PREFERENCE_DOMAIN_ORDER = [
  'sales',
  'purchase',
  'shipment',
  'finance',
  'invoice',
  'reconciliation',
  'operations',
  'system',
] as const

const DOMAIN_LABELS: Record<string, string> = {
  sales: '销售',
  purchase: '采购',
  shipment: '货件运输',
  finance: '财务',
  invoice: '发票',
  reconciliation: '对账',
  operations: '运营',
  system: '系统',
}

export const PREFERENCE_CHANNEL_LABELS: Record<'IN_APP' | 'ASSISTANT', string> = {
  IN_APP: '站内通知',
  ASSISTANT: '千树小助理',
}

const UNAVAILABLE_LABELS: Record<string, string> = {
  NOT_CONFIGURED: '管理员未配置',
  POLICY_DISABLED: '已停用',
  CHANNEL_DISABLED: '渠道未启用',
  GROUP_TARGET: '仅发送到群',
  TEMPLATE_MISSING: '模板未配置',
}

export interface PreferenceGroup {
  readonly domain: string
  readonly label: string
  readonly events: NotificationPreferenceEventDto[]
}

/**
 * 个人设置只展示「至少有一个渠道可调整」的事件；
 * 管理员尚未配置的事件没有可关闭的投递，不应出现在用户侧。
 */
export function buildPreferenceGroups(
  events: readonly NotificationPreferenceEventDto[],
): PreferenceGroup[] {
  const grouped = new Map<string, NotificationPreferenceEventDto[]>()
  for (const event of events) {
    if (!event.channels.some(channel => channel.available)) {
      continue
    }
    const list = grouped.get(event.domain)
    if (list === undefined) {
      grouped.set(event.domain, [event])
    }
    else {
      list.push(event)
    }
  }

  return PREFERENCE_DOMAIN_ORDER.flatMap((domain) => {
    const list = grouped.get(domain)
    return list === undefined
      ? []
      : [{ domain, label: DOMAIN_LABELS[domain] ?? domain, events: list }]
  })
}

export function preferenceUnavailableLabel(reason: string | null): string {
  if (reason === null) {
    return ''
  }
  return UNAVAILABLE_LABELS[reason] ?? '不可设置'
}
