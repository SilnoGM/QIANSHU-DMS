/**
 * 贴标后缀在采购单图片、前端复制文案和对账单中必须逐字一致：去首尾空白、折叠内部空白。
 * 产品别名是展示名，不参与任何解析；货件基础唛头仍由编号规则单独生成。
 */
export function normalizeShippingMarkLabel(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export const SHIPPING_MARK_TEXT_MAX_LENGTH = 30
export const SHIPPING_MARK_CUSTOMER_NAME_MAX_LENGTH = 24
export const SHIPPING_MARK_ALIAS_MAX_CODE_POINTS = 36
export const SHIPPING_MARK_ALIAS_BLOCK_MAX_LENGTH = 438
export const SHIPPING_MARK_LABEL_MAX_LENGTH = 500

/** STOCK 采购单没有销售单，固定标记放在括号内。 */
export const STOCK_SHIPPING_MARK_SUFFIX = '公司囤货采购'

export interface ShippingMarkLabelProduct {
  readonly lineNumber: number
  readonly productId: string | null
  readonly productName: string
  readonly quantity: number
}

export interface ShippingMarkLabelSource {
  readonly issuerPrefix: string | null
  readonly customerName: string | null
  readonly products: readonly ShippingMarkLabelProduct[]
  readonly aliases: ReadonlyMap<string, string>
}

interface AliasEntry {
  readonly lineNumber: number
  readonly name: string
  quantity: number
}

function productNameOf(product: ShippingMarkLabelProduct, aliases: ReadonlyMap<string, string>): string {
  if (product.productId === null) {
    return normalizeShippingMarkLabel(product.productName)
  }
  return normalizeShippingMarkLabel(aliases.get(product.productId) ?? product.productName)
}

/**
 * 目录产品在同一货件内按 productId 聚合数量；自定义产品每行独立，
 * 因此同名自定义行可以同时出现。排序始终取第一次出现的采购行号。
 */
function buildAliasEntries(
  products: readonly ShippingMarkLabelProduct[],
  aliases: ReadonlyMap<string, string>,
): readonly AliasEntry[] {
  const catalog = new Map<string, AliasEntry>()
  const custom: AliasEntry[] = []
  for (const product of products) {
    if (!Number.isSafeInteger(product.lineNumber) || product.lineNumber < 1
      || !Number.isSafeInteger(product.quantity) || product.quantity < 1) {
      continue
    }
    const name = productNameOf(product, aliases)
    if (!name) {
      continue
    }
    if (product.productId === null) {
      custom.push({ lineNumber: product.lineNumber, name, quantity: product.quantity })
      continue
    }
    const existing = catalog.get(product.productId)
    if (existing === undefined) {
      catalog.set(product.productId, {
        lineNumber: product.lineNumber,
        name,
        quantity: product.quantity,
      })
    }
    else {
      existing.quantity += product.quantity
    }
  }
  return [...catalog.values(), ...custom].sort((left, right) => left.lineNumber - right.lineNumber)
}

function aliasItem(entry: AliasEntry): string {
  return `${entry.name}${entry.quantity > 1 ? `×${entry.quantity}` : ''}`
}

/**
 * 438 是别名块总长，包含「×数量」和「+」。按整项加入，放不下时以 … 表示截断，
 * 不把产品名或数量截成半个。
 */
function joinAliasItems(
  items: readonly string[],
  maximum = SHIPPING_MARK_ALIAS_BLOCK_MAX_LENGTH,
): string {
  const included: string[] = []
  let length = 0
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const separator = included.length === 0 ? 0 : 1
    const reserveEllipsis = index < items.length - 1 ? 1 : 0
    const nextLength = length + separator + item.length
    if (nextLength + reserveEllipsis > maximum) {
      if (included.length === 0) {
        return `${item.slice(0, Math.max(0, maximum - 1))}…`
      }
      return `${included.join('+')}…`
    }
    included.push(item)
    length = nextLength
  }
  return included.join('+')
}

function buildParenthetical(source: ShippingMarkLabelSource): string {
  const parts = [
    normalizeShippingMarkLabel(source.issuerPrefix ?? ''),
    normalizeShippingMarkLabel(source.customerName ?? ''),
  ].filter(Boolean)
  return parts.length === 0 ? '' : `（${parts.join('-')}）`
}

/**
 * 生成货件级后缀：
 * - SALES_LINKED：`展示名+展示名（出单前缀-客户名）`
 * - STOCK：`产品名+产品名（公司囤货采购）`，即使调用方传入别名也忽略
 */
export function buildShippingMarkSuffix(
  purchaseType: 'SALES_LINKED' | 'STOCK',
  source: ShippingMarkLabelSource | null,
): string {
  if (purchaseType === 'STOCK') {
    const items = source === null
      ? []
      : buildAliasEntries(source.products, new Map())
    return `${joinAliasItems(items.map(aliasItem))}（${STOCK_SHIPPING_MARK_SUFFIX}）`
  }
  if (source === null) {
    return ''
  }
  const block = joinAliasItems(buildAliasEntries(source.products, source.aliases).map(aliasItem))
  return `${block}${buildParenthetical(source)}`
}

/** 括号只包住货件唛头，后缀在括号外；与采购单图片的贴标文案完全一致。 */
export function formatShippingMark(shippingMarkText: string, suffix: string): string {
  return `【${normalizeShippingMarkLabel(shippingMarkText)}】${suffix}`
}
