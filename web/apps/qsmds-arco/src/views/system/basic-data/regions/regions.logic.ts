import type { TableSortingState } from '@fantastic-admin/components'
import type {
  RegionDto,
  RegionNavigationNodeDto,
  RegionsListData,
} from '@/api/generated/types.gen'

export const ROOT_SCOPE_ID = '__region_root__'

export type RegionLevel = RegionDto['level']
export type RegionDisplayStatus
  = | 'ANCESTOR_DISABLED'
    | 'EFFECTIVE'
    | 'SELF_DISABLED'
export type RegionOwnStatus = 'DISABLED' | 'ENABLED'
export type RegionAvailability = 'ANCESTOR_DISABLED' | 'EFFECTIVE'
export type RegionSortBy = 'code' | 'name' | 'sortOrder' | 'updatedAt'

export interface RegionScopePathNode {
  readonly code: string
  readonly effectiveEnabled: boolean
  readonly enabled: boolean
  readonly englishName: string | null
  readonly id: string
  readonly level: 'COUNTRY_REGION' | 'PROVINCE_STATE'
  readonly name: string
  readonly parentId: string | null
}

export type RegionScope
  = | {
    readonly id: null
    readonly kind: 'ROOT'
    readonly label: '全部地区'
    readonly path: readonly []
  }
  | {
    readonly id: string
    readonly kind: 'COUNTRY_REGION' | 'PROVINCE_STATE'
    readonly label: string
    readonly path: readonly RegionScopePathNode[]
  }

export interface RegionScopeTreeNode {
  readonly children?: RegionScopeTreeNode[]
  readonly disabled: false
  readonly id: string
  readonly label: string
  readonly scope: RegionScope
  readonly searchText: string
  readonly status: RegionDisplayStatus
}

export interface RegionFilterValues {
  readonly availability?: unknown
  readonly ownStatus?: unknown
}

export interface BuildRegionListQueryInput {
  readonly filters: RegionFilterValues
  readonly page: number
  readonly pageSize: number
  readonly scope: RegionScope
  readonly search: string
  readonly sorting: TableSortingState
}

export interface RegionResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly currentScopeId: string
  readonly latestRequestVersion: number
  readonly requestVersion: number
  readonly scopeId: string
}

export interface RegionQueryRefreshScheduler {
  dispose: () => void
  schedule: () => void
}

export interface RegionApiFailure {
  readonly message: string
  readonly requestId: string | undefined
}

type RegionListQuery = NonNullable<RegionsListData['query']>

const REGION_PAGE_SIZES = new Set([20, 50, 100])
const REGION_SORT_FIELDS = new Set<RegionSortBy>([
  'code',
  'name',
  'sortOrder',
  'updatedAt',
])

export function createRootRegionScope(): RegionScope {
  return {
    id: null,
    kind: 'ROOT',
    label: '全部地区',
    path: [],
  }
}

export function regionScopeKey(scope: RegionScope): string {
  return scope.id ?? ROOT_SCOPE_ID
}

/**
 * 页面只允许根、国家/地区和省/州成为查询范围，因此目标直属层级可由 scope
 * 完整推导，不接受调用方额外传入 level。
 */
export function childLevelForScope(scope: RegionScope): RegionLevel {
  switch (scope.kind) {
    case 'ROOT':
      return 'COUNTRY_REGION'
    case 'COUNTRY_REGION':
      return 'PROVINCE_STATE'
    case 'PROVINCE_STATE':
      return 'CITY'
  }
}

export function regionLevelLabel(level: RegionLevel): string {
  return {
    CITY: '城市',
    COUNTRY_REGION: '国家/地区',
    PROVINCE_STATE: '省/州',
  }[level]
}

export function regionDisplayStatus(
  region: Pick<RegionDto, 'effectiveEnabled' | 'enabled'>,
): RegionDisplayStatus {
  if (!region.enabled) {
    return 'SELF_DISABLED'
  }
  if (!region.effectiveEnabled) {
    return 'ANCESTOR_DISABLED'
  }
  return 'EFFECTIVE'
}

export function regionDisplayStatusLabel(status: RegionDisplayStatus): string {
  return {
    ANCESTOR_DISABLED: '继承停用',
    EFFECTIVE: '有效',
    SELF_DISABLED: '自身停用',
  }[status]
}

export function ownStatusLabel(enabled: boolean): string {
  return enabled ? '启用' : '停用'
}

export function administrativeTypeLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    ADMINISTRATIVE_DISTRICT: '行政区',
    AUTONOMOUS_REGION: '自治区',
    CITY: '城市',
    COUNTRY_REGION: '国家/地区',
    DIRECT_ADMIN_COUNTY_LEVEL: '省直辖县级行政区',
    FEDERAL_TERRITORY: '联邦直辖区',
    MUNICIPALITY: '直辖市',
    PROVINCE: '省',
    PROVINCE_STATE: '省/州',
    SPECIAL_ADMINISTRATIVE_REGION: '特别行政区',
    STATE: '州',
  }
  return labels[value] ?? value
}

function toScopePathNode(
  node: RegionNavigationNodeDto,
): RegionScopePathNode | null {
  if (node.level !== 'COUNTRY_REGION' && node.level !== 'PROVINCE_STATE') {
    return null
  }
  return {
    code: node.code,
    effectiveEnabled: node.effectiveEnabled,
    enabled: node.enabled,
    englishName: node.englishName,
    id: node.id,
    level: node.level,
    name: node.name,
    parentId: node.parentId,
  }
}

function normalizeSearchText(...values: Array<null | string>): string {
  return values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .normalize('NFC')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

function createProvinceTreeNode(
  countryPath: readonly RegionScopePathNode[],
  node: RegionNavigationNodeDto,
): RegionScopeTreeNode | null {
  const provincePathNode = toScopePathNode(node)
  if (
    provincePathNode === null
    || provincePathNode.level !== 'PROVINCE_STATE'
    || provincePathNode.parentId !== countryPath[0]?.id
  ) {
    return null
  }
  const path = [...countryPath, provincePathNode]
  return {
    disabled: false,
    id: node.id,
    label: node.name,
    scope: {
      id: node.id,
      kind: 'PROVINCE_STATE',
      label: node.name,
      path,
    },
    searchText: normalizeSearchText(node.name, node.englishName, node.code),
    status: regionDisplayStatus(node),
  }
}

function createCountryTreeNode(
  node: RegionNavigationNodeDto,
): RegionScopeTreeNode | null {
  const countryPathNode = toScopePathNode(node)
  if (
    countryPathNode === null
    || countryPathNode.level !== 'COUNTRY_REGION'
    || countryPathNode.parentId !== null
  ) {
    return null
  }
  const path = [countryPathNode]
  return {
    children: node.children.flatMap((child) => {
      const province = createProvinceTreeNode(path, child)
      return province === null ? [] : [province]
    }),
    disabled: false,
    id: node.id,
    label: node.name,
    scope: {
      id: node.id,
      kind: 'COUNTRY_REGION',
      label: node.name,
      path,
    },
    searchText: normalizeSearchText(node.name, node.englishName, node.code),
    status: regionDisplayStatus(node),
  }
}

/**
 * 导航接口只承载前两级；任何意外 CITY 或断裂 parent 都被本地丢弃，避免城市进入
 * 深度监听树。所有合法停用节点仍保持 disabled=false，允许管理员继续选择维护。
 */
export function createRegionScopeTree(
  navigation: readonly RegionNavigationNodeDto[],
): RegionScopeTreeNode[] {
  const children = navigation.flatMap((node) => {
    const country = createCountryTreeNode(node)
    return country === null ? [] : [country]
  })
  return [{
    children,
    disabled: false,
    id: ROOT_SCOPE_ID,
    label: '全部地区',
    scope: createRootRegionScope(),
    searchText: normalizeSearchText('全部地区', 'root'),
    status: 'EFFECTIVE',
  }]
}

export function normalizeRegionFilters(
  filters: RegionFilterValues,
  changedKey?: 'availability' | 'ownStatus',
): {
  availability?: RegionAvailability
  ownStatus?: RegionOwnStatus
} {
  const ownStatus = filters.ownStatus === 'ENABLED' || filters.ownStatus === 'DISABLED'
    ? filters.ownStatus
    : undefined
  const availability
    = filters.availability === 'EFFECTIVE'
      || filters.availability === 'ANCESTOR_DISABLED'
      ? filters.availability
      : undefined

  if (ownStatus !== undefined && availability !== undefined) {
    return changedKey === 'availability'
      ? { availability }
      : { ownStatus }
  }
  return {
    ...(availability === undefined ? {} : { availability }),
    ...(ownStatus === undefined ? {} : { ownStatus }),
  }
}

export function normalizeRegionSorting(
  sorting: TableSortingState,
): Pick<RegionListQuery, 'sortBy' | 'sortOrder'> | undefined {
  const firstValid = sorting.find(item => REGION_SORT_FIELDS.has(item.id as RegionSortBy))
  if (firstValid === undefined) {
    return undefined
  }
  return {
    sortBy: firstValid.id as RegionSortBy,
    sortOrder: firstValid.desc ? 'desc' : 'asc',
  }
}

export function buildRegionListQuery(
  input: BuildRegionListQueryInput,
): RegionListQuery {
  const normalizedSearch = input.search
    .normalize('NFC')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  const filters = normalizeRegionFilters(input.filters)
  const sorting = normalizeRegionSorting(input.sorting)
  return {
    ...(input.scope.id === null ? {} : { parentId: input.scope.id }),
    page: Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1,
    pageSize: REGION_PAGE_SIZES.has(input.pageSize) ? input.pageSize : 20,
    ...(normalizedSearch === '' ? {} : { query: normalizedSearch }),
    ...filters,
    ...sorting,
  }
}

export function canApplyRegionResponse(
  input: RegionResponseGuardInput,
): boolean {
  return input.authorized
    && !input.aborted
    && input.requestVersion === input.latestRequestVersion
    && input.scopeId === input.currentScopeId
    && input.authEpoch === input.currentAuthEpoch
}

/**
 * QsGenericTable 同一次“清除全部条件”会连续发出搜索与筛选事件。微任务调度器把
 * 这类同步事件合并成一次请求，dispose 后即使旧 microtask 到达也不会执行。
 */
export function createRegionQueryRefreshScheduler(
  refresh: () => void,
): RegionQueryRefreshScheduler {
  let disposed = false
  let pending = false
  return {
    dispose() {
      disposed = true
      pending = false
    },
    schedule() {
      if (disposed || pending) {
        return
      }
      pending = true
      queueMicrotask(() => {
        if (disposed) {
          return
        }
        pending = false
        refresh()
      })
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Axios 失败在页面边界仍按不可信值读取。只展示稳定 message/requestId，
 * 不把 SQL、constraint、stack 或驱动 message 拼进业务页面。
 */
export function getRegionApiFailure(error: unknown): RegionApiFailure {
  try {
    if (!isRecord(error)) {
      return {
        message: '地区数据加载失败，请稍后重试',
        requestId: undefined,
      }
    }
    const body = isRecord(error.body) ? error.body : undefined
    return {
      message: typeof body?.message === 'string'
        ? body.message
        : typeof error.message === 'string'
          ? error.message
          : '地区数据加载失败，请稍后重试',
      requestId: typeof body?.requestId === 'string'
        ? body.requestId
        : typeof error.requestId === 'string'
          ? error.requestId
          : undefined,
    }
  }
  catch {
    return {
      message: '地区数据加载失败，请稍后重试',
      requestId: undefined,
    }
  }
}

export function isRegionAbortError(error: unknown): boolean {
  try {
    return (
      error instanceof DOMException
      && error.name === 'AbortError'
    ) || (
      isRecord(error)
      && error.code === 'ERR_CANCELED'
    )
  }
  catch {
    return false
  }
}
