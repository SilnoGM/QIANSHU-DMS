import type {
  DictionaryTone as DictionaryToneValue,
  ProductStatus as ProductStatusValue,
} from '../../generated/prisma/enums'
import type {
  StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'

interface DecimalStringSource {
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
    amount: amount?.toString() ?? null,
    currency,
  }
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
