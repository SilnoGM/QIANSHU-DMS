/**
 * 系统字典 Catalog 的纯领域类型。
 *
 * 这里刻意不复用 OpenAPI generated DTO：传输层未来增加管理字段时，业务组件
 * 仍只能看到本文件声明的最小白名单，不能间接依赖内部 ID、版本或时间戳。
 */
export type DictionaryCatalogTone
  = | 'DANGER'
    | 'DEFAULT'
    | 'INFO'
    | 'PRIMARY'
    | 'SUCCESS'
    | 'WARNING'

export interface DictionaryCatalogItem {
  readonly value: string
  readonly label: string
  readonly tone: DictionaryCatalogTone
  readonly enabled: boolean
  readonly effectiveEnabled: boolean
  readonly sortOrder: number
}

export interface DictionaryCatalog {
  readonly code: string
  readonly name: string
  readonly enabled: boolean
  readonly items: readonly DictionaryCatalogItem[]
}

/** Batch 结果同样是领域对象，不能把传输 DTO 暴露给后续 Provider。 */
export interface DictionaryCatalogBatch {
  readonly dictionaries: readonly DictionaryCatalog[]
  readonly missingCodes: readonly string[]
}

/** Provider 的身份快照；authEpoch 用于区分同一用户的不同认证生命周期。 */
export interface DictionaryCatalogIdentity {
  readonly authEpoch: number
  readonly userId: string | null
}

/**
 * 应用层通过此接口把身份变化推送给 Catalog 内核。
 *
 * 内核不直接依赖 Pinia/Auth Store，测试与未来非 Vue 调用方也可复用同一契约。
 */
export interface DictionaryCatalogIdentitySource {
  readonly getSnapshot: () => DictionaryCatalogIdentity
  readonly subscribe: (
    listener: (identity: DictionaryCatalogIdentity) => void,
  ) => () => void
}

/** API adapter 只负责发请求并解包 response.data，所有校验由 Provider 完成。 */
export interface DictionaryCatalogLoader {
  readonly get: (input: {
    readonly code: string
    readonly signal: AbortSignal
  }) => Promise<unknown>
  readonly batch: (input: {
    readonly codes: readonly string[]
    readonly signal: AbortSignal
  }) => Promise<unknown>
}

export interface DictionaryCatalogInvalidationEvent {
  /** null 表示身份域变化触发的全量本地失效。 */
  readonly code: string | null
}

/** 供业务调用方消费的中立只读目录能力。 */
export interface DictionaryCatalogProvider {
  readonly get: (input: {
    readonly code: string
    readonly signal: AbortSignal
  }) => Promise<DictionaryCatalog | null>
  readonly prefetch: (input: {
    readonly codes: readonly string[]
    readonly signal: AbortSignal
  }) => Promise<void>
  readonly subscribeInvalidation: (
    listener: (event: DictionaryCatalogInvalidationEvent) => void,
  ) => () => void
}
