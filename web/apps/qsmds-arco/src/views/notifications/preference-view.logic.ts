import type { NotificationPreferenceChannelDto, NotificationPreferenceEventDto } from '@/api/generated/types.gen'

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

export const PREFERENCE_CHANNEL_LABELS: Record<'IN_APP' | 'WECOM', string> = {
  IN_APP: '站内通知',
  WECOM: '企业微信',
}

export const PREFERENCE_CHANNEL_ORDER = ['IN_APP', 'WECOM'] as const

export type PreferenceChannel = (typeof PREFERENCE_CHANNEL_ORDER)[number]

export interface PreferenceCell {
  readonly channel: PreferenceChannel
  readonly dto: NotificationPreferenceChannelDto | null
}

/** 固定按站内 → 企业微信的顺序取单元格，缺失渠道返回 null 以保留列对齐。 */
export function preferenceCells(event: NotificationPreferenceEventDto): PreferenceCell[] {
  return PREFERENCE_CHANNEL_ORDER.map(channel => ({
    channel,
    dto: event.channels.find(item => item.channel === channel) ?? null,
  }))
}

/** 统计当前已关闭的渠道数；只统计可投递且确实存在关闭记录的单元格。 */
export function countMutedChannels(
  events: readonly NotificationPreferenceEventDto[],
  channels: readonly PreferenceChannel[] = PREFERENCE_CHANNEL_ORDER,
): number {
  let total = 0
  for (const event of events) {
    for (const cell of preferenceCells(event)) {
      if (channels.includes(cell.channel) && cell.dto?.available === true && cell.dto.muted) {
        total += 1
      }
    }
  }
  return total
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

export interface BuildPreferenceGroupsOptions {
  readonly visibleChannels?: readonly PreferenceChannel[]
  readonly keyword?: string
  readonly closedOnly?: boolean
}

/**
 * 个人设置只展示「至少有一个渠道可调整」的事件；
 * 管理员尚未配置的事件没有可关闭的投递，不应出现在用户侧。
 */
export function buildPreferenceGroups(
  events: readonly NotificationPreferenceEventDto[],
  options: BuildPreferenceGroupsOptions = {},
): PreferenceGroup[] {
  const visibleChannels = options.visibleChannels ?? PREFERENCE_CHANNEL_ORDER
  const keyword = options.keyword?.trim().toLocaleLowerCase() ?? ''
  const grouped = new Map<string, NotificationPreferenceEventDto[]>()
  for (const event of events) {
    const cells = visiblePreferenceCells(event, visibleChannels)
    if (!cells.some(cell => cell.dto?.available === true)) {
      continue
    }
    if (options.closedOnly === true && !cells.some(cell => cell.dto?.available === true && cell.dto.muted)) {
      continue
    }
    if (
      keyword.length > 0
      && !event.label.toLocaleLowerCase().includes(keyword)
      && !event.eventType.toLocaleLowerCase().includes(keyword)
    ) {
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

/** 只保留当前启用的渠道列；缺失渠道配置时退回展示全部列。 */
export function enabledPreferenceChannels(
  settings: ReadonlyArray<{ readonly channel: PreferenceChannel, readonly enabled: boolean }> | undefined,
): PreferenceChannel[] {
  if (settings === undefined || settings.length === 0) {
    return [...PREFERENCE_CHANNEL_ORDER]
  }
  return PREFERENCE_CHANNEL_ORDER.filter(channel =>
    settings.some(setting => setting.channel === channel && setting.enabled),
  )
}

export function visiblePreferenceCells(
  event: NotificationPreferenceEventDto,
  channels: readonly PreferenceChannel[],
): PreferenceCell[] {
  return preferenceCells(event).filter(cell => channels.includes(cell.channel))
}

export function preferenceUnavailableLabel(reason: string | null): string {
  if (reason === null) {
    return ''
  }
  return UNAVAILABLE_LABELS[reason] ?? '不可设置'
}
