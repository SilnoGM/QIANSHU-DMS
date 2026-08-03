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
