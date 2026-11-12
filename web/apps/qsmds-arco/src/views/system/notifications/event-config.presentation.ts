import type { EventChannelState, EventCoverage, EventCoverageState, NotificationChannelValue } from './event-config.logic'

import { formatNotificationDateTime } from './template-key-grouping.logic'

export const EVENT_STATE_LABELS: Record<EventCoverageState, string> = {
  READY: '已配齐',
  PARTIAL: '部分配置',
  MISSING_TEMPLATE: '缺模板',
  UNCONFIGURED: '未配置',
  DISABLED: '已停用',
  UNKNOWN: '待确认',
}

export const CHANNEL_STATE_LABELS: Record<EventChannelState, string> = {
  READY: '就绪',
  MISSING_TEMPLATE: '缺模板',
  UNCONFIGURED: '未配置',
  DISABLED: '已停用',
  UNKNOWN: '待确认',
}

export const IN_APP_ACTION_CLASS = 'text-sky-700 border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 dark:text-sky-300'
export const ASSISTANT_ACTION_CLASS = 'text-primary border-primary/30 bg-primary/10 hover:bg-primary/20'

export type DisplayEventState = EventCoverageState | 'UNIMPLEMENTED'

export interface ChannelSummary {
  key: string | null
  label: string
  source: string
  state: EventChannelState
}

/** 未接入且尚未配置的事件不显示“待配置”语义。 */
export function displayEventState(item: EventCoverage): DisplayEventState {
  return !item.event.implemented && item.state === 'UNCONFIGURED'
    ? 'UNIMPLEMENTED'
    : item.state
}

export function eventStateLabel(item: EventCoverage): string {
  const state = displayEventState(item)
  return state === 'UNIMPLEMENTED' ? '未接入' : EVENT_STATE_LABELS[state]
}

export function eventStateClass(item: EventCoverage): string {
  const state = displayEventState(item)
  if (state === 'UNIMPLEMENTED') {
    return 'border-border bg-muted text-muted-foreground'
  }
  if (state === 'READY') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (state === 'MISSING_TEMPLATE') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (state === 'DISABLED') {
    return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
  }
  if (state === 'PARTIAL') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  }
  return 'border-border bg-muted text-muted-foreground'
}

export function channelStateClass(state: EventChannelState): string {
  if (state === 'READY') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (state === 'MISSING_TEMPLATE') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (state === 'DISABLED') {
    return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
  }
  return 'border-border bg-muted text-muted-foreground'
}

export function channelSummary(item: EventCoverage, channel: NotificationChannelValue): ChannelSummary {
  const effective = channel === 'IN_APP' ? item.inApp : item.assistant
  return {
    key: effective.key,
    label: CHANNEL_STATE_LABELS[effective.state],
    source: effective.source === 'POLICY' ? '策略绑定' : effective.source === 'DEFAULT' ? '业务默认' : '未指定',
    state: effective.state,
  }
}

export function updatedDateLabel(value: string | null): string {
  const formatted = formatNotificationDateTime(value)
  return formatted === '—' ? formatted : formatted.split(' ')[0] ?? formatted
}
