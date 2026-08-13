import type { Prisma } from '../../generated/prisma/client'
import type {
  DictionaryTone as DictionaryToneValue,
  ProductStatus as ProductStatusValue,
} from '../../generated/prisma/enums'
import type {
  StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'

export interface DecimalStringSource {
  toFixed?(decimalPlaces: number): string
  toString(): string
}

interface ProductActorRow {
  readonly id: string
  readonly displayName: string
}

export interface ProductQueryRow {
  readonly id: string
  readonly name: string
  readonly productNo: string
  readonly status: ProductStatusValue
  readonly supplierValue: string | null
  readonly mainImage: string | null
  readonly images: readonly string[]
  readonly videos: readonly string[]
  readonly twdSalePriceAmount: DecimalStringSource | null
  readonly twdSalePriceCurrency: string
  readonly myrSalePriceAmount: DecimalStringSource | null
  readonly myrSalePriceCurrency: string
  readonly purchaseCostAmount: DecimalStringSource | null
  readonly purchaseCostCurrency: string
  readonly attributes: unknown
  readonly createdBy: ProductActorRow | null
  readonly updatedBy: ProductActorRow | null
  readonly version: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type ProductSupplierState = 'EFFECTIVE' | 'DISABLED' | 'UNKNOWN'

export interface ProductMoney {
  readonly amount: string | null
  readonly currency: string
}

export interface ProductSupplier {
  readonly value: string
  readonly label: string | null
  readonly tone: DictionaryToneValue | null
  readonly state: ProductSupplierState
}

export interface ProductAttribute {
  readonly title: string
  readonly value: string
}

export interface ProductActor {
  readonly id: string
  readonly displayName: string
}

/**
 * Product 查询与创建响应共用同一份白名单 select，避免 Command 另建一套响应
 * 协议或漏选审计用户。它只描述读模型，不包含任何写入能力。
 */
export const PRODUCT_RESPONSE_SELECT = {
  id: true,
  name: true,
  productNo: true,
  status: true,
  supplierValue: true,
  mainImage: true,
  images: true,
  videos: true,
  twdSalePriceAmount: true,
  twdSalePriceCurrency: true,
  myrSalePriceAmount: true,
  myrSalePriceCurrency: true,
  purchaseCostAmount: true,
  purchaseCostCurrency: true,
  attributes: true,
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect

export interface ProductListItem {
  readonly id: string
  readonly name: string
  readonly productNo: string
  readonly status: ProductStatusValue
  readonly supplier: ProductSupplier | null
  readonly mainImage: string | null
  readonly images: readonly string[]
  readonly videos: readonly string[]
  readonly twdSalePrice: ProductMoney
  readonly myrSalePrice: ProductMoney
  readonly purchaseCost: ProductMoney
  readonly attributes: readonly ProductAttribute[]
  readonly createdBy: ProductActor | null
  readonly updatedBy: ProductActor | null
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export class ProductDataIntegrityError extends Error {
  constructor() {
    super('Product persisted data is invalid')
    this.name = 'ProductDataIntegrityError'
  }
}

export function mapProductListItem(
  row: ProductQueryRow,
  supplierResolution: StoredDictionaryValueResolution | null,
): ProductListItem {
  return {
    id: row.id,
    name: row.name,
    productNo: row.productNo,
    status: row.status,
    supplier: mapSupplier(row.supplierValue, supplierResolution),
    mainImage: row.mainImage,
    images: [...row.images],
    videos: [...row.videos],
    twdSalePrice: mapMoney(
      row.twdSalePriceAmount,
      row.twdSalePriceCurrency,
    ),
    myrSalePrice: mapMoney(
      row.myrSalePriceAmount,
      row.myrSalePriceCurrency,
    ),
    purchaseCost: mapMoney(
      row.purchaseCostAmount,
      row.purchaseCostCurrency,
    ),
    attributes: mapAttributes(row.attributes),
    createdBy: mapActor(row.createdBy),
    updatedBy: mapActor(row.updatedBy),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function mapMoney(
  amount: DecimalStringSource | null,
  currency: string,
): ProductMoney {
  return {
    amount: amount === null ? null : mapDecimalAmount(amount),
    currency,
  }
}

/**
 * Prisma Decimal 会在大数上让 `toString()` 返回科学计数法，而 Product HTTP
 * 契约必须始终返回普通十进制字符串。数据库列固定为 DECIMAL(30,4)，因此优先
 * 用 `toFixed(4)` 展开，再移除无意义尾零；不可信读模型一律失败关闭。
 */
function mapDecimalAmount(amount: DecimalStringSource): string {
  let raw: string
  try {
    raw = typeof amount.toFixed === 'function'
      ? amount.toFixed(4)
      : amount.toString()
  }
  catch {
    throw new ProductDataIntegrityError()
  }

  const match = /^(0|[1-9]\d{0,25})(?:\.(\d{1,4}))?$/u.exec(raw)
  if (match === null || match[1] === undefined) {
    throw new ProductDataIntegrityError()
  }
  const fraction = (match[2] ?? '').replace(/0+$/u, '')
  return fraction.length === 0 ? match[1] : `${match[1]}.${fraction}`
}

function mapSupplier(
  rawValue: string | null,
  resolution: StoredDictionaryValueResolution | null,
): ProductSupplier | null {
  if (rawValue === null) {
    if (resolution !== null) throw new ProductDataIntegrityError()
    return null
  }
  if (resolution === null || resolution.value !== rawValue) {
    throw new ProductDataIntegrityError()
  }

  if (!resolution.known) {
    return {
      value: rawValue,
      label: null,
      tone: null,
      state: 'UNKNOWN',
    }
  }

  return {
    value: rawValue,
    label: resolution.label,
    tone: resolution.tone,
    state: resolution.effectiveEnabled ? 'EFFECTIVE' : 'DISABLED',
  }
}

function mapAttributes(value: unknown): readonly ProductAttribute[] {
  if (!Array.isArray(value)) throw new ProductDataIntegrityError()

  return value.map(attribute => {
    if (
      !isPlainRecord(attribute)
      || typeof attribute.title !== 'string'
      || attribute.title.trim().length === 0
      || typeof attribute.value !== 'string'
      || attribute.value.trim().length === 0
    ) {
      throw new ProductDataIntegrityError()
    }

    return {
      title: attribute.title,
      value: attribute.value,
    }
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function mapActor(actor: ProductActorRow | null): ProductActor | null {
  return actor === null
    ? null
    : { id: actor.id, displayName: actor.displayName }
}
