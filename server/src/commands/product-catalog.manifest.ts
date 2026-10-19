import { createHash } from 'node:crypto'

export const PRODUCT_CATALOG_MANIFEST_VERSION = 2

export type ProductCatalogStatus = 'ACTIVE' | 'INACTIVE'

export interface ProductCatalogSupplier {
  readonly value: string
  readonly label: string
}

export interface ProductCatalogCategory {
  readonly supplierValue: string
  readonly name: string
  readonly sortOrder: number
}

export interface ProductCatalogHead {
  readonly supplierValue: string
  readonly categoryName: string
  readonly name: string
  readonly sortOrder: number
}

export interface ProductCatalogAttribute {
  readonly title: string
  readonly value: string
}

export interface ProductCatalogProductInput {
  readonly supplierValue: string
  readonly categoryName: string
  readonly productHeadName: string
  readonly name: string
  readonly status: ProductCatalogStatus
  readonly sortOrder: number
  readonly twdSalePriceAmount: string | null
  readonly myrSalePriceAmount: string | null
  readonly purchaseCostAmount: string | null
  readonly attributes: readonly ProductCatalogAttribute[]
  readonly remark: string | null
}

export interface ProductCatalogProduct extends ProductCatalogProductInput {
  /** 测试机原编号，仅用于人工核对，不写入生产。 */
  readonly sourceProductNo?: string
}

export interface ProductCatalogIncompleteProduct {
  readonly supplierValue: string
  readonly name: string
  readonly sourceProductNo: string | null
  readonly reason: string
}

export interface ProductCatalogChecksumPayload {
  readonly suppliers: readonly ProductCatalogSupplier[]
  readonly categories: readonly ProductCatalogCategory[]
  readonly heads: readonly ProductCatalogHead[]
  readonly products: readonly ProductCatalogProductInput[]
}

export interface ProductCatalogManifest {
  readonly version: typeof PRODUCT_CATALOG_MANIFEST_VERSION
  readonly source: {
    readonly env: string
    readonly release: string
    readonly exportedAt: string
  }
  readonly suppliers: readonly ProductCatalogSupplier[]
  readonly categories: readonly ProductCatalogCategory[]
  readonly heads: readonly ProductCatalogHead[]
  readonly products: readonly ProductCatalogProduct[]
  readonly incompleteProducts: readonly ProductCatalogIncompleteProduct[]
  readonly dataChecksum: string
}

export class ProductCatalogManifestError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProductCatalogManifestError'
  }
}

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u
const MANIFEST_KEYS = [
  'version',
  'source',
  'suppliers',
  'categories',
  'heads',
  'products',
  'incompleteProducts',
  'dataChecksum',
] as const

function fail(code: string): never {
  throw new ProductCatalogManifestError(code)
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  }
  return value as Readonly<Record<string, unknown>>
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedSet = new Set(allowed)
  if (Object.keys(value).some(key => !allowedSet.has(key))) {
    fail(`MANIFEST_${field.toUpperCase()}_UNKNOWN_FIELD`)
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  const normalized = value.trim().normalize('NFC')
  if (normalized.length < 1 || [...normalized].length > maximum) {
    fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  }
  return normalized
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null) return null
  return text(value, field, maximum)
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  }
  return value
}

function amount(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  }
  return value
}

function status(value: unknown): ProductCatalogStatus {
  if (value !== 'ACTIVE' && value !== 'INACTIVE') fail('MANIFEST_STATUS_INVALID')
  return value
}

function attributes(value: unknown): readonly ProductCatalogAttribute[] {
  if (!Array.isArray(value)) fail('MANIFEST_ATTRIBUTES_INVALID')
  return Object.freeze(value.map((entry, index) => {
    const row = record(entry, `attributes_${index}`)
    rejectUnknownKeys(row, ['title', 'value'], `attributes_${index}`)
    return Object.freeze({
      title: text(row.title, 'attribute_title', 64),
      value: text(row.value, 'attribute_value', 512),
    })
  }))
}

function parseSupplier(value: unknown): ProductCatalogSupplier {
  const row = record(value, 'supplier')
  rejectUnknownKeys(row, ['value', 'label'], 'supplier')
  return Object.freeze({
    value: text(row.value, 'supplier_value', 64),
    label: text(row.label, 'supplier_label', 128),
  })
}

function parseCategory(value: unknown): ProductCatalogCategory {
  const row = record(value, 'category')
  rejectUnknownKeys(row, ['supplierValue', 'name', 'sortOrder'], 'category')
  return Object.freeze({
    supplierValue: text(row.supplierValue, 'category_supplier_value', 64),
    name: text(row.name, 'category_name', 64),
    sortOrder: integer(row.sortOrder, 'category_sort_order'),
  })
}

function parseHead(value: unknown): ProductCatalogHead {
  const row = record(value, 'head')
  rejectUnknownKeys(row, ['supplierValue', 'categoryName', 'name', 'sortOrder'], 'head')
  return Object.freeze({
    supplierValue: text(row.supplierValue, 'head_supplier_value', 64),
    categoryName: text(row.categoryName, 'head_category_name', 64),
    name: text(row.name, 'head_name', 64),
    sortOrder: integer(row.sortOrder, 'head_sort_order'),
  })
}

function parseProduct(value: unknown): ProductCatalogProduct {
  const row = record(value, 'product')
  rejectUnknownKeys(row, [
    'supplierValue',
    'categoryName',
    'productHeadName',
    'name',
    'status',
    'sortOrder',
    'twdSalePriceAmount',
    'myrSalePriceAmount',
    'purchaseCostAmount',
    'attributes',
    'remark',
    'sourceProductNo',
  ], 'product')

  const categoryName = row.categoryName === null
    ? null
    : text(row.categoryName, 'product_category_name', 64)
  const productHeadName = row.productHeadName === null
    ? null
    : text(row.productHeadName, 'product_head_name', 64)
  if (categoryName === null || productHeadName === null) {
    fail('MANIFEST_PRODUCT_SCOPE_INVALID')
  }

  return Object.freeze({
    supplierValue: text(row.supplierValue, 'product_supplier_value', 64),
    categoryName,
    productHeadName,
    name: text(row.name, 'product_name', 128),
    status: status(row.status),
    sortOrder: integer(row.sortOrder, 'product_sort_order'),
    twdSalePriceAmount: amount(row.twdSalePriceAmount, 'product_twd_sale_price'),
    myrSalePriceAmount: amount(row.myrSalePriceAmount, 'product_myr_sale_price'),
    purchaseCostAmount: amount(row.purchaseCostAmount, 'product_purchase_cost'),
    attributes: attributes(row.attributes),
    remark: optionalText(row.remark, 'product_remark', 512),
    ...(row.sourceProductNo === undefined
      ? {}
      : { sourceProductNo: text(row.sourceProductNo, 'product_source_no', 64) }),
  })
}

function parseIncompleteProduct(value: unknown): ProductCatalogIncompleteProduct {
  const row = record(value, 'incomplete_product')
  rejectUnknownKeys(row, ['supplierValue', 'name', 'sourceProductNo', 'reason'], 'incomplete_product')
  return Object.freeze({
    supplierValue: text(row.supplierValue, 'incomplete_supplier_value', 64),
    name: text(row.name, 'incomplete_name', 128),
    sourceProductNo: row.sourceProductNo === null
      ? null
      : text(row.sourceProductNo, 'incomplete_source_no', 64),
    reason: text(row.reason, 'incomplete_reason', 64),
  })
}

function assertUnique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code)
}

function productKey(product: ProductCatalogProductInput): string {
  return [
    product.supplierValue,
    product.categoryName,
    product.productHeadName,
    product.name,
  ].join('\u0000')
}

function sortCatalog<T extends object>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
): T[] {
  return [...values].sort(compare)
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function canonicalPayload(payload: ProductCatalogChecksumPayload): ProductCatalogChecksumPayload {
  // 逐字段重建，避免 sourceProductNo 等仅用于人工核对的附加字段进入校验和。
  return {
    suppliers: sortCatalog(payload.suppliers.map(supplier => ({
      value: supplier.value,
      label: supplier.label,
    })), (left, right) =>
      compareText(left.value, right.value)),
    categories: sortCatalog(payload.categories.map(category => ({
      supplierValue: category.supplierValue,
      name: category.name,
      sortOrder: category.sortOrder,
    })), (left, right) =>
      compareText(left.supplierValue, right.supplierValue)
      || compareText(left.name, right.name)),
    heads: sortCatalog(payload.heads.map(head => ({
      supplierValue: head.supplierValue,
      categoryName: head.categoryName,
      name: head.name,
      sortOrder: head.sortOrder,
    })), (left, right) =>
      compareText(left.supplierValue, right.supplierValue)
      || compareText(left.categoryName, right.categoryName)
      || compareText(left.name, right.name)),
    products: sortCatalog(payload.products.map(product => ({
      supplierValue: product.supplierValue,
      categoryName: product.categoryName,
      productHeadName: product.productHeadName,
      name: product.name,
      status: product.status,
      sortOrder: product.sortOrder,
      twdSalePriceAmount: product.twdSalePriceAmount,
      myrSalePriceAmount: product.myrSalePriceAmount,
      purchaseCostAmount: product.purchaseCostAmount,
      attributes: product.attributes.map(attribute => ({
        title: attribute.title,
        value: attribute.value,
      })),
      remark: product.remark,
    })), (left, right) =>
      compareText(left.supplierValue, right.supplierValue)
      || compareText(left.categoryName, right.categoryName)
      || compareText(left.productHeadName, right.productHeadName)
      || compareText(left.name, right.name)),
  }
}

/**
 * 目录校验和只覆盖可跨环境复现的业务字段：source 元数据、测试机产品编号与
 * 不完整产品不参与计算，保证导入前后两份导出可以直接比对。
 */
export function calculateProductCatalogChecksum(
  payload: ProductCatalogChecksumPayload,
): string {
  const canonical = canonicalPayload(payload)
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex')}`
}

export function parseProductCatalogManifest(raw: unknown): ProductCatalogManifest {
  const manifest = record(raw, '')
  rejectUnknownKeys(manifest, MANIFEST_KEYS, 'root')
  if (manifest.version !== PRODUCT_CATALOG_MANIFEST_VERSION) {
    fail('MANIFEST_VERSION_UNSUPPORTED')
  }

  const source = record(manifest.source, 'source')
  rejectUnknownKeys(source, ['env', 'release', 'exportedAt'], 'source')

  if (!Array.isArray(manifest.suppliers)
    || !Array.isArray(manifest.categories)
    || !Array.isArray(manifest.heads)
    || !Array.isArray(manifest.products)
    || !Array.isArray(manifest.incompleteProducts)) {
    fail('MANIFEST_COLLECTION_INVALID')
  }

  const suppliers = Object.freeze(manifest.suppliers.map(parseSupplier))
  const categories = Object.freeze(manifest.categories.map(parseCategory))
  const heads = Object.freeze(manifest.heads.map(parseHead))
  const products = Object.freeze(manifest.products.map(parseProduct))
  const incompleteProducts = Object.freeze(manifest.incompleteProducts.map(parseIncompleteProduct))

  assertUnique(suppliers.map(supplier => supplier.value), 'MANIFEST_DUPLICATE_SUPPLIER')
  assertUnique(
    categories.map(category => `${category.supplierValue}\u0000${category.name}`),
    'MANIFEST_DUPLICATE_CATEGORY',
  )
  assertUnique(
    heads.map(head => `${head.supplierValue}\u0000${head.categoryName}\u0000${head.name}`),
    'MANIFEST_DUPLICATE_HEAD',
  )
  assertUnique(products.map(productKey), 'MANIFEST_DUPLICATE_PRODUCT')

  const dataChecksum = typeof manifest.dataChecksum === 'string'
    ? manifest.dataChecksum
    : fail('MANIFEST_CHECKSUM_INVALID')
  const expected = calculateProductCatalogChecksum({
    suppliers,
    categories,
    heads,
    products: products.map(product => ({
      supplierValue: product.supplierValue,
      categoryName: product.categoryName,
      productHeadName: product.productHeadName,
      name: product.name,
      status: product.status,
      sortOrder: product.sortOrder,
      twdSalePriceAmount: product.twdSalePriceAmount,
      myrSalePriceAmount: product.myrSalePriceAmount,
      purchaseCostAmount: product.purchaseCostAmount,
      attributes: product.attributes,
      remark: product.remark,
    })),
  })
  if (dataChecksum !== expected) fail('MANIFEST_CHECKSUM_MISMATCH')

  return Object.freeze({
    version: PRODUCT_CATALOG_MANIFEST_VERSION,
    source: Object.freeze({
      env: text(source.env, 'source_env', 32),
      release: text(source.release, 'source_release', 64),
      exportedAt: text(source.exportedAt, 'source_exported_at', 64),
    }),
    suppliers,
    categories,
    heads,
    products,
    incompleteProducts,
    dataChecksum,
  })
}
