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

/** 贴标提示只输出一次，位于采购备注段；复制文案、采购单图片和通知文本共用同一句。 */
export const SHIPPING_MARK_PASTE_HINT = '请将上述货件唛头贴到对应的包装箱 / 货物上'

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
  readonly defaultAliases: ReadonlyMap<string, string>
  /**
   * 产品级排除集合：命中即不进入唛头后缀。目录行以产品标记为唯一真相源；
   * 自定义行没有产品记录，只能按名称兜底（见 SUPPLEMENT_PRICE_NAME）。
   */
  readonly excludedProductIds: ReadonlySet<string>
}

/** 只含产品名的部分；销售单提交通知等处不重复出单前缀与客户名。 */
export type ShippingMarkProductBlockSource = Omit<
  ShippingMarkLabelSource,
  'issuerPrefix' | 'customerName'
>

interface AliasEntry {
  readonly lineNumber: number
  readonly name: string
  quantity: number
}

/** 自定义产品行没有 products 记录，按补差价占位名称兜底排除。 */
const SUPPLEMENT_PRICE_NAME = /补差价|補差價/u

function isSupplementPriceName(value: string): boolean {
  return SUPPLEMENT_PRICE_NAME.test(normalizeShippingMarkLabel(value))
}

function isExcludedProduct(
  product: ShippingMarkLabelProduct,
  excludedProductIds: ReadonlySet<string>,
): boolean {
  if (product.productId === null) {
    return isSupplementPriceName(product.productName)
  }
  return excludedProductIds.has(product.productId)
}

function productNameOf(
  product: ShippingMarkLabelProduct,
  aliases: ReadonlyMap<string, string>,
  defaultAliases: ReadonlyMap<string, string>,
): string {
  if (product.productId === null) {
    return normalizeShippingMarkLabel(product.productName)
  }
  const aliasName = normalizeShippingMarkLabel(
    aliases.get(product.productId)
      ?? defaultAliases.get(product.productId)
      ?? '',
  )
  return aliasName || normalizeShippingMarkLabel(product.productName)
}

/**
 * 目录产品在同一货件内按 productId 聚合数量；自定义产品每行独立，
 * 因此同名自定义行可以同时出现。排序始终取第一次出现的采购行号。
 * 被排除的产品整行跳过，不参与数量聚合并让出截断预算。
 */
function buildAliasEntries(
  products: readonly ShippingMarkLabelProduct[],
  aliases: ReadonlyMap<string, string>,
  defaultAliases: ReadonlyMap<string, string>,
  excludedProductIds: ReadonlySet<string>,
): readonly AliasEntry[] {
  const catalog = new Map<string, AliasEntry>()
  const custom: AliasEntry[] = []
  for (const product of products) {
    if (!Number.isSafeInteger(product.lineNumber) || product.lineNumber < 1
      || !Number.isSafeInteger(product.quantity) || product.quantity < 1) {
      continue
    }
    if (isExcludedProduct(product, excludedProductIds)) {
      continue
    }
    const name = productNameOf(product, aliases, defaultAliases)
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
 * 只拼产品名块（别名优先级、数量聚合、排除与截断与唛头后缀完全一致），
 * 不含「（出单前缀-客户名）」。销售单提交通知直接复用这一口径。
 */
export function buildShippingMarkProductBlock(
  source: ShippingMarkProductBlockSource,
): string {
  return joinAliasItems(
    buildAliasEntries(
      source.products,
      source.aliases,
      source.defaultAliases,
      source.excludedProductIds,
    ).map(aliasItem),
  )
}

/**
 * 生成货件级后缀：
 * - SALES_LINKED：`个人别名或默认别名或产品名+…（出单前缀-客户名）`
 * - STOCK：`默认别名或产品名+…（公司囤货采购）`，不读个人别名
 */
export function buildShippingMarkSuffix(
  purchaseType: 'SALES_LINKED' | 'STOCK',
  source: ShippingMarkLabelSource | null,
): string {
  if (purchaseType === 'STOCK') {
    const block = source === null
      ? ''
      : buildShippingMarkProductBlock({ ...source, aliases: new Map() })
    return `${block}（${STOCK_SHIPPING_MARK_SUFFIX}）`
  }
  if (source === null) {
    return ''
  }
  return `${buildShippingMarkProductBlock(source)}${buildParenthetical(source)}`
}

/** 括号只包住货件唛头，后缀在括号外；与采购单图片的贴标文案完全一致。 */
export function formatShippingMark(shippingMarkText: string, suffix: string): string {
  return `【${normalizeShippingMarkLabel(shippingMarkText)}】${suffix}`
}
