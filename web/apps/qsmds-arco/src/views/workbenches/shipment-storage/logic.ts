import type { ShipmentStorageListItemDto } from '@/api/generated/types.gen'
import { getApiClientFailureMessage } from '../../../api/errors'

/** 寄仓域复用统一错误文案；保留本名供既有调用方与测试使用。 */
export function storageFailureMessage(failure: unknown, fallback: string): string {
  return getApiClientFailureMessage(failure, fallback)
}

export type ShipmentStorageStatus = ShipmentStorageListItemDto['status']
export type ShipmentStorageLocationScope = ShipmentStorageListItemDto['locationScope']
export type StorageScopeFilter = 'ALL' | ShipmentStorageLocationScope

export const STORAGE_STATUS_TABS = ['IN_STORAGE', 'CLAIMED', 'VOIDED', 'ALL'] as const
export type StorageStatusTab = typeof STORAGE_STATUS_TABS[number]
export const DEFAULT_STORAGE_STATUS: StorageStatusTab = 'IN_STORAGE'

export const STORAGE_SCOPE_OPTIONS = [
  { value: 'ALL', label: '全部位置' },
  { value: 'MAINLAND', label: '内地仓' },
  { value: 'OVERSEAS', label: '海外仓' },
] as const

export function storageStatusLabel(status: ShipmentStorageStatus): string {
  switch (status) {
    case 'IN_STORAGE': return '寄仓中'
    case 'RESERVED': return '已预留'
    case 'CLAIMED': return '已调货'
    case 'VOIDED': return '已作废'
    default: return '未知'
  }
}

export function storageStatusClass(status: ShipmentStorageStatus): string {
  switch (status) {
    case 'IN_STORAGE': return 'border-amber-500/40 bg-amber-500/10 text-amber-700'
    case 'RESERVED': return 'border-sky-500/40 bg-sky-500/10 text-sky-700'
    case 'CLAIMED': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
    case 'VOIDED': return 'border-muted-foreground/30 bg-muted text-muted-foreground'
    default: return ''
  }
}

export function locationLabel(row: Pick<ShipmentStorageListItemDto, 'locationScope' | 'warehouseLabel' | 'warehouseValue'>): string {
  const scope = row.locationScope === 'MAINLAND' ? '内地' : '海外'
  return `${scope} · ${row.warehouseLabel ?? row.warehouseValue}`
}

export function canRelocate(
  row: Pick<ShipmentStorageListItemDto, 'status' | 'locationScope'>,
  allowed: boolean,
): boolean {
  return allowed && row.status === 'IN_STORAGE' && row.locationScope === 'OVERSEAS'
}

/** 返回 null 表示可执行；无权限时也返回 null，由调用方直接隐藏动作。 */
export function claimDisabledReason(
  row: Pick<ShipmentStorageListItemDto, 'status'>,
  allowed: boolean,
): string | null {
  if (!allowed) {
    return null
  }
  return row.status === 'IN_STORAGE'
    ? null
    : `当前状态为「${storageStatusLabel(row.status)}」，不能调货`
}

/** 返回 null 表示可执行；无权限时也返回 null，由调用方直接隐藏动作。 */
export function relocateDisabledReason(
  row: Pick<ShipmentStorageListItemDto, 'status' | 'locationScope'>,
  allowed: boolean,
): string | null {
  if (!allowed) {
    return null
  }
  if (row.status !== 'IN_STORAGE') {
    return `当前状态为「${storageStatusLabel(row.status)}」，不能移仓`
  }
  return row.locationScope === 'OVERSEAS'
    ? null
    : '只有海外仓的寄仓货件可以移仓'
}

export function buildStorageQuery(input: {
  page: number
  pageSize: number
  keyword: string
  status: StorageStatusTab
  locationScope: StorageScopeFilter
  warehouseValue: string
  storageId?: string
}) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    keyword: input.keyword.trim() || undefined,
    status: input.status === 'ALL' ? undefined : input.status,
    locationScope: input.locationScope === 'ALL' ? undefined : input.locationScope,
    warehouseValue: input.warehouseValue === 'ALL' ? undefined : input.warehouseValue,
    ...(input.storageId === undefined ? {} : { storageId: input.storageId }),
  }
}
