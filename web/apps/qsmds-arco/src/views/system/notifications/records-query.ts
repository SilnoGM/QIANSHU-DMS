import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import type { NotificationRecordDto, NotificationsRecordsListData } from '@/api/generated/types.gen'

export type NotificationRecordStatus = NotificationRecordDto['status']
export type NotificationRecordDomain = NotificationRecordDto['domain']
export type NotificationRecordPriority = NotificationRecordDto['priority']
export type NotificationRecordChannel = NonNullable<NonNullable<NotificationsRecordsListData['query']>['channel']>
export type NotificationRecordListQuery = NonNullable<NotificationsRecordsListData['query']>

export interface NotificationRecordQueryState {
  page: number
  pageSize: number
  status: NotificationRecordStatus | null
  eventType: string | null
  domain: NotificationRecordDomain | null
  channel: NotificationRecordChannel | null
  priority: NotificationRecordPriority | null
  keyword: string
  from: string | null
  to: string | null
}

export const NOTIFICATION_RECORD_PAGE_SIZES = [20, 50, 100] as const

const STATUSES: readonly NotificationRecordStatus[] = [
  'PENDING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'SKIPPED',
  'EXPIRED',
  'CANCELLED',
]
const DOMAINS: readonly NotificationRecordDomain[] = [
  'SALES',
  'PURCHASE',
  'SHIPMENT',
  'FINANCE',
  'INVOICE',
  'RECONCILIATION',
  'OPERATIONS',
  'SYSTEM',
]
const CHANNELS: readonly NotificationRecordChannel[] = ['IN_APP', 'ASSISTANT']
const PRIORITIES: readonly NotificationRecordPriority[] = ['NORMAL', 'HIGH']

function stringValue(query: LocationQuery, key: string): string | null {
  const value = query[key]
  return typeof value === 'string' ? value : null
}

function boundedText(value: string | null, maxLength: number): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length === 0 ? null : [...trimmed].slice(0, maxLength).join('')
}

function isDateOnly(value: string | null): value is string {
  if (value === null || value.length !== 10 || value[4] !== '-' || value[7] !== '-') {
    return false
  }
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function enumValue<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | null {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? value as T
    : null
}

export function parseRecordRouteQuery(query: LocationQuery): NotificationRecordQueryState {
  const page = Number(stringValue(query, 'page'))
  const pageSize = Number(stringValue(query, 'pageSize'))
  const from = stringValue(query, 'from')
  const to = stringValue(query, 'to')
  const validFrom = isDateOnly(from) ? from : null
  const validTo = isDateOnly(to) ? to : null
  const hasOrderedRange = validFrom !== null && validTo !== null && validFrom <= validTo

  return {
    page: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1,
    pageSize: (NOTIFICATION_RECORD_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 20,
    status: enumValue(stringValue(query, 'status'), STATUSES),
    eventType: boundedText(stringValue(query, 'eventType'), 64),
    domain: enumValue(stringValue(query, 'domain'), DOMAINS),
    channel: enumValue(stringValue(query, 'channel'), CHANNELS),
    priority: enumValue(stringValue(query, 'priority'), PRIORITIES),
    keyword: boundedText(stringValue(query, 'keyword'), 128) ?? '',
    from: hasOrderedRange ? validFrom : null,
    to: hasOrderedRange ? validTo : null,
  }
}

export function buildRecordRouteQuery(state: NotificationRecordQueryState): LocationQueryRaw {
  return {
    ...(state.page > 1 ? { page: String(state.page) } : {}),
    ...(state.pageSize !== 20 ? { pageSize: String(state.pageSize) } : {}),
    ...(state.status === null ? {} : { status: state.status }),
    ...(state.eventType === null ? {} : { eventType: state.eventType }),
    ...(state.domain === null ? {} : { domain: state.domain }),
    ...(state.channel === null ? {} : { channel: state.channel }),
    ...(state.priority === null ? {} : { priority: state.priority }),
    ...(state.keyword.length === 0 ? {} : { keyword: state.keyword }),
    ...(state.from === null ? {} : { from: state.from }),
    ...(state.to === null ? {} : { to: state.to }),
  }
}

/**
 * URL 只保存上海自然日；请求侧显式带上 +08:00，避免服务端把日期当 UTC 零点。
 */
export function buildRecordListQuery(state: NotificationRecordQueryState): NotificationRecordListQuery {
  return {
    page: state.page,
    pageSize: state.pageSize,
    ...(state.status === null ? {} : { status: state.status }),
    ...(state.eventType === null ? {} : { eventType: state.eventType }),
    ...(state.domain === null ? {} : { domain: state.domain }),
    ...(state.channel === null ? {} : { channel: state.channel }),
    ...(state.priority === null ? {} : { priority: state.priority }),
    ...(state.keyword.length === 0 ? {} : { keyword: state.keyword }),
    ...(state.from === null ? {} : { publishedFrom: `${state.from}T00:00:00+08:00` }),
    ...(state.to === null ? {} : { publishedTo: `${state.to}T23:59:59.999+08:00` }),
  }
}
