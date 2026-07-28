export type RegionLevel
  = | 'COUNTRY_REGION'
    | 'PROVINCE_STATE'
    | 'CITY'

/**
 * 选择器只暴露渲染与选择所需白名单字段。
 *
 * `effectiveEnabled` 与 `enabled` 分开保留，使历史 CITY 路径即使因为祖先停用而失效，
 * 仍能准确解释“自身停用”或“继承停用”，而不是隐式清空业务 value。
 */
export interface RegionSelectorNode<
  L extends RegionLevel = RegionLevel,
> {
  readonly id: string
  readonly parentId: string | null
  readonly level: L
  readonly name: string
  readonly englishName: string | null
  readonly code: string
  readonly enabled: boolean
  readonly effectiveEnabled: boolean
  readonly hasChildren: boolean
}

export type RegionSelectorPath = readonly [
  RegionSelectorNode<'COUNTRY_REGION'>,
  RegionSelectorNode<'PROVINCE_STATE'>,
  RegionSelectorNode<'CITY'>,
]

export type RegionSelectorCountryPath = readonly [
  RegionSelectorNode<'COUNTRY_REGION'>,
]

export type RegionSelectorProvincePath = readonly [
  RegionSelectorNode<'COUNTRY_REGION'>,
  RegionSelectorNode<'PROVINCE_STATE'>,
]

/**
 * 组件的双向绑定值始终同时携带三级字段。
 *
 * 未选择的层级使用 `null`；合法状态只能依次为全空、仅国家/地区、国家/地区加
 * 省/州、完整三级，不能跳级。业务表单无需再从 CITY UUID 反推上级字段。
 */
export interface RegionSelectorValue {
  readonly countryRegionId: string | null
  readonly provinceStateId: string | null
  readonly cityId: string | null
}

export type RegionSelectorSelectedPath
  = | readonly []
    | RegionSelectorCountryPath
    | RegionSelectorProvincePath
    | RegionSelectorPath

/**
 * `change` 只描述用户操作；调用方写入 `modelValue` 的回显过程不会触发。
 *
 * 四个分支固定 source、path 和 complete 的对应关系，使调用方只需判断 source
 * 即可获得精确的 tuple 类型，不必再次检查 path 长度。
 */
export type RegionSelectorChange
  = | {
    readonly source: 'countryRegion'
    readonly value: RegionSelectorValue
    readonly path: RegionSelectorCountryPath
    readonly complete: false
  }
  | {
    readonly source: 'provinceState'
    readonly value: RegionSelectorValue
    readonly path: RegionSelectorProvincePath
    readonly complete: false
  }
  | {
    readonly source: 'city'
    readonly value: RegionSelectorValue
    readonly path: RegionSelectorPath
    readonly complete: true
  }
  | {
    readonly source: 'clear'
    readonly value: RegionSelectorValue
    readonly path: readonly []
    readonly complete: false
  }

export type RegionSelectorChangeSource = RegionSelectorChange['source']

export interface RegionSelectorSearchResult {
  readonly paths: readonly RegionSelectorPath[]
  readonly hasMore: boolean
}

/**
 * 公共 Provider 只有读能力和失效订阅能力。
 *
 * 管理页不能通过这个接口主动改缓存；写成功后的失效由 provider.ts 的受控 controller
 * 或应用级 `invalidateRegionSelectorCache` 完成。
 */
export interface RegionSelectorProvider {
  readonly listChildren: (input: {
    readonly parentId: string | null
    readonly signal: AbortSignal
  }) => Promise<readonly RegionSelectorNode[]>

  readonly resolvePath: (input: {
    readonly cityId: string
    readonly signal: AbortSignal
  }) => Promise<RegionSelectorPath>

  readonly search: (input: {
    readonly query: string
    readonly signal: AbortSignal
  }) => Promise<RegionSelectorSearchResult>

  readonly subscribeInvalidation?: (
    listener: () => void,
  ) => () => void
}
