/**
 * 金额组件与业务页面共享的货币目录最小公共类型。
 *
 * 这里不复用 generated DTO，避免组件契约随管理 API 的版本、审计字段或分页结构
 * 一起变化。Provider 会在运行时从不可信响应中白名单复制这些字段。
 */
export type CurrencyCatalogMinorUnit = 0 | 1 | 2 | 3 | 4

export interface CurrencyCatalogItem {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly englishName: string | null
  readonly symbol: string | null
  readonly minorUnit: CurrencyCatalogMinorUnit
  readonly enabled: boolean
  readonly isBase: boolean
  readonly sortOrder: number
}

/**
 * 目录 Provider 只暴露读取和失效订阅，不携带 API、Store 或管理写能力。
 *
 * `list` 返回全部货币（包括停用项）；具体组件是否只展示启用货币，由组件 adapter
 * 在调用边界显式决定，不能让 catalog 缓存丢失系统管理所需的完整真相。
 */
export interface CurrencyCatalogProvider {
  readonly list: (input: {
    readonly signal: AbortSignal
  }) => Promise<readonly CurrencyCatalogItem[]>

  readonly subscribeInvalidation?: (
    listener: () => void,
  ) => () => void
}
