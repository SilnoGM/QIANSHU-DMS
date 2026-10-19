import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  DictionaryTone,
  UserStatus,
} from '../generated/prisma/enums'
import { PrismaService } from '../infrastructure/database/prisma.service'
import { ApiException } from '../infrastructure/http/api.exception'
import { DictionaryCommandService } from '../modules/dictionaries/dictionary-command.service'
import { ProductCommandService } from '../modules/products/product-command.service'
import { ProductTaxonomyService } from '../modules/products/product-taxonomy.service'
import {
  parseProductCatalogManifest,
  ProductCatalogManifestError,
  type ProductCatalogManifest,
} from './product-catalog.manifest'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const SUPPLIER_VALUE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/u
const MAX_SUPPLIER_LABEL = 128
const MAX_TAXONOMY_NAME = 64
const MAX_PRODUCT_NAME = 128
const MAX_REMARK = 512
const ROW_KEYS = [
  'supplierValue',
  'supplierLabel',
  'categoryName',
  'productHeadName',
  'name',
  'purchaseCostAmount',
  'twdSalePriceAmount',
  'myrSalePriceAmount',
  'remark',
] as const

export interface ProductImportRow {
  readonly supplierValue: string
  readonly supplierLabel: string
  readonly categoryName: string
  readonly productHeadName: string
  readonly name: string
  readonly purchaseCostAmount: string
  readonly twdSalePriceAmount: string
  readonly myrSalePriceAmount: string
  readonly remark: string | null
}

export interface ProductImportOptions {
  readonly apply: boolean
  /** v1 兼容入口；与 catalog 二选一。 */
  readonly rows?: readonly ProductImportRow[]
  /** v2 目录同步入口；与 rows 二选一。 */
  readonly catalog?: ProductCatalogManifest
}

export interface ProductImportConflict {
  readonly row: number
  readonly name: string
  readonly reason: string
}

export interface ProductImportFailure {
  readonly row: number
  readonly name: string
  readonly code: string
}

export interface ProductImportResult {
  readonly mode: 'preview' | 'applied'
  readonly products: number
  readonly suppliers: number
  readonly created: number
  readonly skipped: number
  readonly failed: number
  readonly suppliersCreated: number
  readonly suppliersEnabled: number
  readonly suppliersUpdated: number
  readonly categoriesCreated: number
  readonly headsCreated: number
  readonly sortOrderUpdated: number
  readonly incompleteProducts: number
  readonly conflicts: readonly ProductImportConflict[]
  readonly failures: readonly ProductImportFailure[]
}

export type ProductImportFile =
  | { readonly kind: 'v1', readonly rows: readonly ProductImportRow[] }
  | { readonly kind: 'v2', readonly catalog: ProductCatalogManifest }

export class ProductImportOperationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProductImportOperationError'
  }
}

type ProductStatusValue = 'ACTIVE' | 'INACTIVE'

interface ImportSupplier {
  readonly value: string
  readonly label: string
}

interface ImportCategory {
  readonly supplierValue: string
  readonly name: string
  readonly sortOrder: number
}

interface ImportHead {
  readonly supplierValue: string
  readonly categoryName: string
  readonly name: string
  readonly sortOrder: number
}

interface ImportProduct {
  readonly supplierValue: string
  readonly supplierLabel: string
  readonly categoryName: string
  readonly productHeadName: string
  readonly name: string
  readonly status: ProductStatusValue
  readonly sortOrder: number
  readonly twdSalePriceAmount: string | null
  readonly myrSalePriceAmount: string | null
  readonly purchaseCostAmount: string | null
  readonly attributes: readonly { readonly title: string, readonly value: string }[]
  readonly remark: string | null
  readonly idempotencyVersion: 1 | 2
}

interface ImportIncompleteProduct {
  readonly supplierValue: string
  readonly name: string
  readonly reason: string
}

interface ImportInput {
  readonly kind: 'v1' | 'v2'
  readonly suppliers: readonly ImportSupplier[]
  readonly categories: readonly ImportCategory[]
  readonly heads: readonly ImportHead[]
  readonly products: readonly ImportProduct[]
  readonly incompleteProducts: readonly ImportIncompleteProduct[]
}

interface ExistingProduct {
  readonly id: string
  readonly name: string
  readonly supplierValue: string
  readonly status: string
  readonly sortOrder: number
  readonly category: { readonly name: string } | null
  readonly productHead: { readonly name: string } | null
  readonly twdSalePriceAmount: AmountSource | null
  readonly twdSalePriceCurrency: string
  readonly myrSalePriceAmount: AmountSource | null
  readonly myrSalePriceCurrency: string
  readonly purchaseCostAmount: AmountSource | null
  readonly purchaseCostCurrency: string
  readonly attributes: unknown
  readonly remark: string | null
}

interface AmountSource {
  toFixed?(places: number): string
  toString(): string
}

function fail(code: string): never {
  throw new ProductImportOperationError(code)
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  const normalized = value.trim().normalize('NFC')
  const length = [...normalized].length
  if (length < 1 || length > maximum) {
    fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  }
  return normalized
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return text(value, 'remark', MAX_REMARK)
}

function amount(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    fail(`MANIFEST_${field.toUpperCase()}_INVALID`)
  }
  return value
}

function parseRow(raw: unknown): ProductImportRow {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('MANIFEST_ROW_INVALID')
  }
  const record = raw as Record<string, unknown>
  const unknownKey = Object.keys(record)
    .find(key => !(ROW_KEYS as readonly string[]).includes(key))
  if (unknownKey !== undefined) fail('MANIFEST_ROW_UNKNOWN_FIELD')

  const supplierValue = text(record.supplierValue, 'supplierValue', 64)
  if (!SUPPLIER_VALUE_PATTERN.test(supplierValue)) {
    fail('MANIFEST_SUPPLIERVALUE_INVALID')
  }
  return Object.freeze({
    supplierValue,
    supplierLabel: text(record.supplierLabel, 'supplierLabel', MAX_SUPPLIER_LABEL),
    categoryName: text(record.categoryName, 'categoryName', MAX_TAXONOMY_NAME),
    productHeadName: text(record.productHeadName, 'productHeadName', MAX_TAXONOMY_NAME),
    name: text(record.name, 'name', MAX_PRODUCT_NAME),
    purchaseCostAmount: amount(record.purchaseCostAmount, 'purchaseCostAmount'),
    twdSalePriceAmount: amount(record.twdSalePriceAmount, 'twdSalePriceAmount'),
    myrSalePriceAmount: amount(record.myrSalePriceAmount, 'myrSalePriceAmount'),
    remark: optionalText(record.remark),
  })
}

/** 纯解析边界：只接受 JSON 已反序列化的数组，不读取文件或执行外部命令。 */
export function parseProductImportManifest(
  raw: unknown,
): readonly ProductImportRow[] {
  if (!Array.isArray(raw)) fail('MANIFEST_INVALID')
  return Object.freeze(raw.map(entry => parseRow(entry)))
}

export function parseProductImportFile(raw: unknown): ProductImportFile {
  if (Array.isArray(raw)) {
    return { kind: 'v1', rows: parseProductImportManifest(raw) }
  }
  if (typeof raw === 'object'
    && raw !== null
    && (raw as Readonly<Record<string, unknown>>).version === 2) {
    return { kind: 'v2', catalog: parseProductCatalogManifest(raw) }
  }
  fail('MANIFEST_INVALID')
}

function productKey(
  supplierValue: string,
  categoryName: string,
  productHeadName: string,
  name: string,
): string {
  return [supplierValue, categoryName, productHeadName, name].join('\u0000')
}

function canonicalAmount(value: AmountSource | string | null): string | null {
  if (value === null) return null
  const raw = typeof value === 'string'
    ? value
    : typeof value.toFixed === 'function'
      ? value.toFixed(2)
      : value.toString()
  const match = raw.match(/^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/u)
  if (match === null) return raw
  const fraction = (match[2] ?? '').replace(/0+$/u, '')
  return fraction.length === 0 ? match[1] : `${match[1]}.${fraction}`
}

function canonicalAttributes(value: unknown): string {
  if (!Array.isArray(value)) return '[]'
  return JSON.stringify(value.map((entry) => {
    const row = entry as Readonly<Record<string, unknown>>
    return { title: String(row.title), value: String(row.value) }
  }))
}

/** 由业务身份生成稳定 UUID v4；v2 使用独立命名空间避免重放旧产品导入的编号。 */
function deterministicIdempotencyKey(key: string, version: 1 | 2): string {
  const hex = createHash('sha256')
    .update(`qianshu.product-import.v${version}:${key}`, 'utf8')
    .digest('hex')
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

function matchesRow(existing: ExistingProduct, row: ProductImportRow): boolean {
  return existing.category?.name === row.categoryName
    && existing.productHead?.name === row.productHeadName
    && canonicalAmount(existing.twdSalePriceAmount) === canonicalAmount(row.twdSalePriceAmount)
    && existing.twdSalePriceCurrency === 'TWD'
    && canonicalAmount(existing.myrSalePriceAmount) === canonicalAmount(row.myrSalePriceAmount)
    && existing.myrSalePriceCurrency === 'MYR'
    && canonicalAmount(existing.purchaseCostAmount) === canonicalAmount(row.purchaseCostAmount)
    && existing.purchaseCostCurrency === 'CNY'
    && existing.remark === row.remark
}

function matchesCatalogProduct(existing: ExistingProduct, product: ImportProduct): boolean {
  return existing.category?.name === product.categoryName
    && existing.productHead?.name === product.productHeadName
    && existing.status === product.status
    && canonicalAmount(existing.twdSalePriceAmount) === canonicalAmount(product.twdSalePriceAmount)
    && existing.twdSalePriceCurrency === 'TWD'
    && canonicalAmount(existing.myrSalePriceAmount) === canonicalAmount(product.myrSalePriceAmount)
    && existing.myrSalePriceCurrency === 'MYR'
    && canonicalAmount(existing.purchaseCostAmount) === canonicalAmount(product.purchaseCostAmount)
    && existing.purchaseCostCurrency === 'CNY'
    && canonicalAttributes(existing.attributes) === canonicalAttributes(product.attributes)
    && existing.remark === product.remark
}

function buildV1Input(rows: readonly ProductImportRow[]): ImportInput {
  const suppliers = new Map<string, ImportSupplier>()
  const categories = new Map<string, ImportCategory>()
  const heads = new Map<string, ImportHead>()

  for (const row of rows) {
    suppliers.set(row.supplierValue, {
      value: row.supplierValue,
      label: row.supplierLabel,
    })
    const categoryKey = `${row.supplierValue}\u0000${row.categoryName}`
    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, {
        supplierValue: row.supplierValue,
        name: row.categoryName,
        sortOrder: 0,
      })
    }
    const headKey = `${categoryKey}\u0000${row.productHeadName}`
    if (!heads.has(headKey)) {
      heads.set(headKey, {
        supplierValue: row.supplierValue,
        categoryName: row.categoryName,
        name: row.productHeadName,
        sortOrder: 0,
      })
    }
  }

  return {
    kind: 'v1',
    suppliers: [...suppliers.values()],
    categories: [...categories.values()],
    heads: [...heads.values()],
    products: rows.map(row => ({
      supplierValue: row.supplierValue,
      supplierLabel: row.supplierLabel,
      categoryName: row.categoryName,
      productHeadName: row.productHeadName,
      name: row.name,
      status: 'ACTIVE',
      sortOrder: 0,
      twdSalePriceAmount: row.twdSalePriceAmount,
      myrSalePriceAmount: row.myrSalePriceAmount,
      purchaseCostAmount: row.purchaseCostAmount,
      attributes: [],
      remark: row.remark,
      idempotencyVersion: 1,
    })),
    incompleteProducts: [],
  }
}

function buildV2Input(catalog: ProductCatalogManifest): ImportInput {
  const supplierLabels = new Map(catalog.suppliers.map(supplier => [supplier.value, supplier.label]))
  return {
    kind: 'v2',
    suppliers: catalog.suppliers,
    categories: catalog.categories,
    heads: catalog.heads,
    products: catalog.products.map((product) => {
      const label = supplierLabels.get(product.supplierValue)
      if (label === undefined) throw new ProductCatalogManifestError('SUPPLIER_NOT_DECLARED')
      return {
        supplierValue: product.supplierValue,
        supplierLabel: label,
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
        idempotencyVersion: 2,
      }
    }),
    incompleteProducts: catalog.incompleteProducts,
  }
}

interface OrderingResult {
  readonly categoriesCreated: number
  readonly headsCreated: number
  readonly sortOrderUpdated: number
  readonly failures: readonly ProductImportFailure[]
}

@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaries: DictionaryCommandService,
    private readonly products: ProductCommandService,
    private readonly taxonomies: ProductTaxonomyService,
  ) {}

  async run(options: ProductImportOptions): Promise<ProductImportResult> {
    if ((options.rows === undefined) === (options.catalog === undefined)) {
      fail('IMPORT_INPUT_INVALID')
    }
    const input = options.rows !== undefined
      ? buildV1Input(options.rows)
      : buildV2Input(options.catalog as ProductCatalogManifest)
    const actorUserId = await this.findSystemAdmin()
    const conflicts: ProductImportConflict[] = []
    const failures: ProductImportFailure[] = []

    for (const [index, product] of input.incompleteProducts.entries()) {
      conflicts.push({
        row: index + 1,
        name: product.name,
        reason: `产品缺少分类或产品头，未导入：${product.reason}`,
      })
    }

    const supplierResult = await this.applySuppliers(
      actorUserId,
      input,
      options.apply,
      conflicts,
    )

    const existingProducts = await this.prisma.product.findMany({
      where: { supplierValue: { in: input.suppliers.map(supplier => supplier.value) } },
      select: {
        id: true,
        name: true,
        supplierValue: true,
        status: true,
        sortOrder: true,
        category: { select: { name: true } },
        productHead: { select: { name: true } },
        twdSalePriceAmount: true,
        twdSalePriceCurrency: true,
        myrSalePriceAmount: true,
        myrSalePriceCurrency: true,
        purchaseCostAmount: true,
        purchaseCostCurrency: true,
        attributes: true,
        remark: true,
      },
    }) as readonly ExistingProduct[]
    const existingByKey = new Map<string, ExistingProduct>()
    for (const product of existingProducts) {
      if (product.category === null || product.productHead === null) continue
      existingByKey.set(productKey(
        product.supplierValue,
        product.category.name,
        product.productHead.name,
        product.name,
      ), product)
    }

    let created = 0
    let skipped = 0
    for (const [index, product] of input.products.entries()) {
      const key = productKey(
        product.supplierValue,
        product.categoryName,
        product.productHeadName,
        product.name,
      )
      const existing = existingByKey.get(key)
      if (existing !== undefined) {
        const matches = input.kind === 'v1'
          ? matchesRow(existing, {
            supplierValue: product.supplierValue,
            supplierLabel: product.supplierLabel,
            categoryName: product.categoryName,
            productHeadName: product.productHeadName,
            name: product.name,
            purchaseCostAmount: product.purchaseCostAmount ?? '',
            twdSalePriceAmount: product.twdSalePriceAmount ?? '',
            myrSalePriceAmount: product.myrSalePriceAmount ?? '',
            remark: product.remark,
          })
          : matchesCatalogProduct(existing, product)
        if (matches) {
          skipped += 1
        }
        else {
          conflicts.push({
            row: index + 1,
            name: product.name,
            reason: '同名产品已存在但字段不同，未自动覆盖',
          })
        }
        continue
      }

      if (!options.apply) {
        created += 1
        continue
      }

      try {
        await this.products.create(
          {
            actorUserId,
            requestId: `product-import-${index + 1}`,
            idempotencyKey: deterministicIdempotencyKey(key, product.idempotencyVersion),
          },
          {
            name: product.name,
            categoryName: product.categoryName,
            productHeadName: product.productHeadName,
            status: product.status,
            supplierValue: product.supplierValue,
            twdSalePrice: { amount: product.twdSalePriceAmount, currency: 'TWD' },
            myrSalePrice: { amount: product.myrSalePriceAmount, currency: 'MYR' },
            purchaseCost: { amount: product.purchaseCostAmount, currency: 'CNY' },
            attributes: product.attributes,
            remark: product.remark,
          },
        )
        created += 1
      }
      catch (error) {
        failures.push({
          row: index + 1,
          name: product.name,
          code: error instanceof ApiException
            ? error.code
            : error instanceof ProductImportOperationError
              ? error.code
              : error instanceof ProductCatalogManifestError
                ? error.code
                : 'PRODUCT_IMPORT_FAILED',
        })
      }
    }

    const ordering = input.kind === 'v2'
      ? await this.applyOrdering(actorUserId, input, options.apply)
      : { categoriesCreated: 0, headsCreated: 0, sortOrderUpdated: 0, failures: [] }
    failures.push(...ordering.failures)

    return Object.freeze({
      mode: options.apply ? 'applied' : 'preview',
      products: input.products.length,
      suppliers: input.suppliers.length,
      created,
      skipped,
      failed: failures.length,
      suppliersCreated: supplierResult.created,
      suppliersEnabled: supplierResult.enabled,
      suppliersUpdated: supplierResult.updated,
      categoriesCreated: ordering.categoriesCreated,
      headsCreated: ordering.headsCreated,
      sortOrderUpdated: ordering.sortOrderUpdated,
      incompleteProducts: input.incompleteProducts.length,
      conflicts: Object.freeze(conflicts),
      failures: Object.freeze(failures),
    })
  }

  private async applySuppliers(
    actorUserId: string,
    input: ImportInput,
    apply: boolean,
    conflicts: ProductImportConflict[],
  ): Promise<{ created: number, enabled: number, updated: number }> {
    const supplierType = await this.prisma.dictionaryType.findUnique({
      where: { code: SUPPLIER_DICTIONARY_CODE },
      select: { id: true, enabled: true },
    })
    if (supplierType === null) fail('SUPPLIER_DICTIONARY_MISSING')
    if (!supplierType.enabled) fail('SUPPLIER_DICTIONARY_DISABLED')

    const supplierItems = await this.prisma.dictionaryItem.findMany({
      where: { dictionaryTypeId: supplierType.id },
      select: {
        id: true,
        value: true,
        label: true,
        enabled: true,
        version: true,
        sortOrder: true,
      },
    })
    const supplierByValue = new Map(supplierItems.map(item => [item.value, item]))
    let nextSortOrder = supplierItems.reduce(
      (maximum, item) => Math.max(maximum, item.sortOrder),
      0,
    ) + 10
    let created = 0
    let enabled = 0
    let updated = 0

    for (const supplier of input.suppliers) {
      const existing = supplierByValue.get(supplier.value)
      if (existing === undefined) {
        if (apply) {
          const record = await this.dictionaries.createItem(
            { actorUserId, requestId: `product-import-supplier-${supplier.value}` },
            supplierType.id,
            {
              value: supplier.value,
              label: supplier.label,
              tone: DictionaryTone.DEFAULT,
              sortOrder: nextSortOrder,
            },
          )
          await this.dictionaries.enableItem(
            { actorUserId, requestId: `product-import-supplier-${supplier.value}` },
            supplierType.id,
            record.id,
            { expectedVersion: record.version },
          )
        }
        created += 1
        nextSortOrder += 10
        continue
      }

      let version = existing.version
      if (existing.label !== supplier.label) {
        if (input.kind === 'v2') {
          if (apply) {
            const record = await this.dictionaries.updateItem(
              { actorUserId, requestId: `product-import-supplier-${supplier.value}` },
              supplierType.id,
              existing.id,
              { label: supplier.label, expectedVersion: version },
            )
            version = record.version
          }
          updated += 1
        }
        else {
          conflicts.push({
            row: 1,
            name: supplier.label,
            reason: `供应商 ${supplier.value} 已存在但名称为「${existing.label}」`,
          })
        }
      }
      if (!existing.enabled) {
        if (apply) {
          await this.dictionaries.enableItem(
            { actorUserId, requestId: `product-import-supplier-${supplier.value}` },
            supplierType.id,
            existing.id,
            { expectedVersion: version },
          )
        }
        enabled += 1
      }
    }

    return { created, enabled, updated }
  }

  private async applyOrdering(
    actorUserId: string,
    input: ImportInput,
    apply: boolean,
  ): Promise<OrderingResult> {
    let categoriesCreated = 0
    let headsCreated = 0
    let sortOrderUpdated = 0
    const failures: ProductImportFailure[] = []
    const categoryIds = new Map<string, string>()
    const missingCategories = new Set<string>()

    for (const [index, category] of input.categories.entries()) {
      const key = `${category.supplierValue}\u0000${category.name}`
      const existing = await this.prisma.productCategory.findFirst({
        where: { supplierValue: category.supplierValue, name: category.name },
        select: { id: true, sortOrder: true },
      })
      let id = existing?.id
      let currentSortOrder = existing?.sortOrder
      if (id === undefined) {
        missingCategories.add(key)
        if (apply) {
          const created = await this.taxonomies.createCategory(
            { actorUserId, requestId: `product-import-category-${index + 1}` },
            { supplierValue: category.supplierValue, name: category.name },
          )
          id = created.id
          currentSortOrder = created.sortOrder
        }
        categoriesCreated += 1
      }
      if (id !== undefined) {
        categoryIds.set(key, id)
      }
      if (apply && id !== undefined && currentSortOrder !== category.sortOrder) {
        await this.prisma.productCategory.update({
          where: { id },
          data: { sortOrder: category.sortOrder },
        })
        sortOrderUpdated += 1
      }
      else if (!apply && existing !== null && currentSortOrder !== category.sortOrder) {
        sortOrderUpdated += 1
      }
    }

    for (const [index, head] of input.heads.entries()) {
      const categoryKey = `${head.supplierValue}\u0000${head.categoryName}`
      let categoryId = categoryIds.get(categoryKey)
      if (categoryId === undefined) {
        const category = await this.prisma.productCategory.findFirst({
          where: { supplierValue: head.supplierValue, name: head.categoryName },
          select: { id: true, sortOrder: true },
        })
        if (category === null) {
          if (!missingCategories.has(categoryKey)) {
            missingCategories.add(categoryKey)
            categoriesCreated += 1
          }
          if (apply) {
            const created = await this.taxonomies.createCategory(
              { actorUserId, requestId: `product-import-category-${index + 1}` },
              { supplierValue: head.supplierValue, name: head.categoryName },
            )
            categoryId = created.id
          }
        }
        else {
          categoryId = category.id
        }
        if (categoryId !== undefined) categoryIds.set(categoryKey, categoryId)
      }

      if (categoryId === undefined) {
        headsCreated += 1
        continue
      }
      const existing = await this.prisma.productHead.findFirst({
        where: { categoryId, name: head.name },
        select: { id: true, sortOrder: true },
      })
      let id = existing?.id
      let currentSortOrder = existing?.sortOrder
      if (id === undefined) {
        if (apply) {
          const created = await this.taxonomies.createHead(
            { actorUserId, requestId: `product-import-head-${index + 1}` },
            { categoryId, name: head.name },
          )
          id = created.id
          currentSortOrder = created.sortOrder
        }
        headsCreated += 1
      }
      if (id === undefined) continue
      if (apply && currentSortOrder !== head.sortOrder) {
        await this.prisma.productHead.update({
          where: { id },
          data: { sortOrder: head.sortOrder },
        })
        sortOrderUpdated += 1
      }
      else if (!apply && existing !== null && currentSortOrder !== head.sortOrder) {
        sortOrderUpdated += 1
      }
    }

    for (const [index, product] of input.products.entries()) {
      const existing = await this.prisma.product.findFirst({
        where: {
          supplierValue: product.supplierValue,
          name: product.name,
          category: { name: product.categoryName, supplierValue: product.supplierValue },
          productHead: {
            name: product.productHeadName,
            category: { supplierValue: product.supplierValue, name: product.categoryName },
          },
        },
        select: { id: true, sortOrder: true },
      })
      if (existing === null) {
        if (apply) {
          failures.push({
            row: index + 1,
            name: product.name,
            code: 'SORT_ORDER_TARGET_MISSING',
          })
        }
        continue
      }
      if (existing.sortOrder !== product.sortOrder) {
        if (apply) {
          await this.prisma.product.update({
            where: { id: existing.id },
            data: { sortOrder: product.sortOrder },
          })
        }
        sortOrderUpdated += 1
      }
    }

    return { categoriesCreated, headsCreated, sortOrderUpdated, failures }
  }

  private async findSystemAdmin(): Promise<string> {
    const admin = await this.prisma.user.findFirst({
      where: {
        status: UserStatus.ACTIVE,
        roles: { some: { role: { code: 'system_admin' } } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (admin === null) fail('SYSTEM_ADMIN_NOT_FOUND')
    return admin.id
  }
}
