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
  readonly rows: readonly ProductImportRow[]
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
  readonly conflicts: readonly ProductImportConflict[]
  readonly failures: readonly ProductImportFailure[]
}

export class ProductImportOperationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProductImportOperationError'
  }
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

function productKey(
  supplierValue: string,
  categoryName: string,
  productHeadName: string,
  name: string,
): string {
  return [supplierValue, categoryName, productHeadName, name].join('\u0000')
}

interface AmountSource {
  toFixed?(places: number): string
  toString(): string
}

function canonicalAmount(value: AmountSource | null): string | null {
  if (value === null) return null
  const raw = typeof value.toFixed === 'function'
    ? value.toFixed(4)
    : value.toString()
  const match = raw.match(/^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/u)
  if (match === null) return raw
  const fraction = (match[2] ?? '').replace(/0+$/u, '')
  return fraction.length === 0 ? match[1] : `${match[1]}.${fraction}`
}

/** 由业务身份生成稳定 UUID v4，重跑时复用同一幂等身份。 */
function deterministicIdempotencyKey(key: string): string {
  const hex = createHash('sha256')
    .update(`qianshu.product-import.v1:${key}`, 'utf8')
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

interface ExistingProduct {
  readonly id: string
  readonly name: string
  readonly supplierValue: string
  readonly category: { readonly name: string } | null
  readonly productHead: { readonly name: string } | null
  readonly twdSalePriceAmount: AmountSource | null
  readonly twdSalePriceCurrency: string
  readonly myrSalePriceAmount: AmountSource | null
  readonly myrSalePriceCurrency: string
  readonly purchaseCostAmount: AmountSource | null
  readonly purchaseCostCurrency: string
  readonly remark: string | null
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

@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaries: DictionaryCommandService,
    private readonly products: ProductCommandService,
  ) {}

  async run(options: ProductImportOptions): Promise<ProductImportResult> {
    const rows = Object.freeze([...options.rows])
    const actorUserId = await this.findSystemAdmin()
    const conflicts: ProductImportConflict[] = []
    const failures: ProductImportFailure[] = []

    const supplierMap = new Map<string, string>()
    for (const [index, row] of rows.entries()) {
      const existingLabel = supplierMap.get(row.supplierValue)
      if (existingLabel !== undefined && existingLabel !== row.supplierLabel) {
        conflicts.push({
          row: index + 1,
          name: row.name,
          reason: '同一供应商值对应了不同供应商名称',
        })
        continue
      }
      supplierMap.set(row.supplierValue, row.supplierLabel)
    }

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
    let suppliersCreated = 0
    let suppliersEnabled = 0

    for (const [supplierValue, supplierLabel] of supplierMap) {
      const existing = supplierByValue.get(supplierValue)
      if (existing !== undefined) {
        if (existing.label !== supplierLabel) {
          conflicts.push({
            row: 1,
            name: supplierLabel,
            reason: `供应商 ${supplierValue} 已存在但名称为「${existing.label}」`,
          })
          continue
        }
        if (!existing.enabled) {
          if (options.apply) {
            await this.dictionaries.enableItem(
              { actorUserId, requestId: `product-import-supplier-${supplierValue}` },
              supplierType.id,
              existing.id,
              { expectedVersion: existing.version },
            )
          }
          suppliersEnabled += 1
        }
        continue
      }

      if (options.apply) {
        const created = await this.dictionaries.createItem(
          { actorUserId, requestId: `product-import-supplier-${supplierValue}` },
          supplierType.id,
          {
            value: supplierValue,
            label: supplierLabel,
            tone: DictionaryTone.DEFAULT,
            sortOrder: nextSortOrder,
          },
        )
        await this.dictionaries.enableItem(
          { actorUserId, requestId: `product-import-supplier-${supplierValue}` },
          supplierType.id,
          created.id,
          { expectedVersion: created.version },
        )
      }
      suppliersCreated += 1
      nextSortOrder += 10
    }

    const existingProducts = await this.prisma.product.findMany({
      where: { supplierValue: { in: [...supplierMap.keys()] } },
      select: {
        id: true,
        name: true,
        supplierValue: true,
        category: { select: { name: true } },
        productHead: { select: { name: true } },
        twdSalePriceAmount: true,
        twdSalePriceCurrency: true,
        myrSalePriceAmount: true,
        myrSalePriceCurrency: true,
        purchaseCostAmount: true,
        purchaseCostCurrency: true,
        remark: true,
      },
    })
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
    for (const [index, row] of rows.entries()) {
      const key = productKey(
        row.supplierValue,
        row.categoryName,
        row.productHeadName,
        row.name,
      )
      const existing = existingByKey.get(key)
      if (existing !== undefined) {
        if (matchesRow(existing, row)) {
          skipped += 1
        }
        else {
          conflicts.push({
            row: index + 1,
            name: row.name,
            reason: '同名产品已存在但价格或备注不同，未自动覆盖',
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
            idempotencyKey: deterministicIdempotencyKey(key),
          },
          {
            name: row.name,
            categoryName: row.categoryName,
            productHeadName: row.productHeadName,
            status: 'ACTIVE',
            supplierValue: row.supplierValue,
            twdSalePrice: { amount: row.twdSalePriceAmount, currency: 'TWD' },
            myrSalePrice: { amount: row.myrSalePriceAmount, currency: 'MYR' },
            purchaseCost: { amount: row.purchaseCostAmount, currency: 'CNY' },
            attributes: [],
            remark: row.remark,
          },
        )
        created += 1
      }
      catch (error) {
        failures.push({
          row: index + 1,
          name: row.name,
          code: error instanceof ApiException
            ? error.code
            : error instanceof ProductImportOperationError
              ? error.code
              : 'PRODUCT_IMPORT_FAILED',
        })
      }
    }

    return Object.freeze({
      mode: options.apply ? 'applied' : 'preview',
      products: rows.length,
      suppliers: supplierMap.size,
      created,
      skipped,
      failed: failures.length,
      suppliersCreated,
      suppliersEnabled,
      conflicts: Object.freeze(conflicts),
      failures: Object.freeze(failures),
    })
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
