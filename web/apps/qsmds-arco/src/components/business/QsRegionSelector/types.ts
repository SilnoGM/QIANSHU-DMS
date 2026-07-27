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

export type RegionSelectorChange
  = | {
    readonly source: 'select'
    readonly value: string
    readonly path: RegionSelectorPath
  }
  | {
    readonly source: 'clear'
    readonly value: null
    readonly path: null
  }

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
