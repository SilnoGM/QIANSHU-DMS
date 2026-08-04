import type {
  DictionaryCatalog,
  DictionaryCatalogItem,
} from './types'

export type DictionaryCatalogValueStatus
  = | 'ACTIVE'
    | 'DISABLED'
    | 'UNKNOWN'

interface DictionaryCatalogValueResolutionBase {
  /** 面向现有表单/详情的完整显示文案；原始 value 始终单独保留。 */
  readonly displayLabel: string
  /** 已知值使用当前 Label；未知值原样返回业务表中保存的 raw value。 */
  readonly label: string
  readonly value: string
}

/** status 同时收窄 item，调用方不需要再次为已知值处理 null。 */
export type DictionaryCatalogValueResolution
  = | DictionaryCatalogValueResolutionBase & {
    readonly item: DictionaryCatalogItem
    readonly status: Exclude<DictionaryCatalogValueStatus, 'UNKNOWN'>
  }
  | DictionaryCatalogValueResolutionBase & {
    readonly item: null
    readonly status: Extract<DictionaryCatalogValueStatus, 'UNKNOWN'>
  }

const EMPTY_SELECTABLE_ITEMS: readonly DictionaryCatalogItem[]
  = Object.freeze([])

/**
 * 新选择只能使用 Type 与 Item 当前同时启用的条目。
 *
 * 返回 Provider 已冻结的领域对象，不创建默认项，也不把停用历史值混入可选集合。
 */
export function selectEffectiveDictionaryItems(
  catalog: DictionaryCatalog | null,
): readonly DictionaryCatalogItem[] {
  if (catalog === null || !catalog.enabled) {
    return EMPTY_SELECTABLE_ITEMS
  }
  return Object.freeze(catalog.items.filter(item => item.effectiveEnabled))
}

/**
 * 按业务表中保存的 raw value 精确解析历史值。
 *
 * value 不做 trim、大小写转换或格式校验：任何自动规范化都可能把未知历史值
 * 误认成另一个有效选项。null/undefined 表示业务字段本身没有值，不生成默认项。
 */
export function resolveDictionaryCatalogValue(
  catalog: DictionaryCatalog | null,
  value: string | null | undefined,
): DictionaryCatalogValueResolution | null {
  if (catalog === null || typeof value !== 'string') {
    return null
  }

  const item = catalog.items.find(candidate => candidate.value === value)
  if (item === undefined) {
    return Object.freeze({
      displayLabel: `${value}（未知字典值）`,
      item: null,
      label: value,
      status: 'UNKNOWN',
      value,
    })
  }

  const status = item.effectiveEnabled ? 'ACTIVE' : 'DISABLED'
  return Object.freeze({
    displayLabel: status === 'ACTIVE' ? item.label : `${item.label}（已停用）`,
    item,
    label: item.label,
    status,
    value,
  })
}
