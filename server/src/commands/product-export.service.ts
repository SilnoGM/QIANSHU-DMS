import { Injectable } from '@nestjs/common'

import { PrismaService } from '../infrastructure/database/prisma.service'
import {
  calculateProductCatalogChecksum,
  PRODUCT_CATALOG_MANIFEST_VERSION,
  ProductCatalogManifestError,
  type ProductCatalogAttribute,
  type ProductCatalogCategory,
  type ProductCatalogHead,
  type ProductCatalogIncompleteProduct,
  type ProductCatalogManifest,
  type ProductCatalogProduct,
  type ProductCatalogSupplier,
} from './product-catalog.manifest'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

export interface ProductExportOptions {
  readonly env: string
  readonly release: string
  readonly now: Date
}

interface AmountSource {
  toFixed(places: number): string
}

interface ProductRow {
  readonly productNo: string
  readonly name: string
  readonly status: string
  readonly supplierValue: string
  readonly sortOrder: number
  readonly twdSalePriceAmount: AmountSource | null
  readonly twdSalePriceCurrency: string
  readonly myrSalePriceAmount: AmountSource | null
  readonly myrSalePriceCurrency: string
  readonly purchaseCostAmount: AmountSource | null
  readonly purchaseCostCurrency: string
  readonly attributes: unknown
  readonly remark: string | null
  readonly category: { readonly supplierValue: string, readonly name: string } | null
  readonly productHead: { readonly name: string } | null
}

function fail(code: string): never {
  throw new ProductCatalogManifestError(code)
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function formatAmount(
  value: AmountSource | null,
  minorUnits: ReadonlyMap<string, number>,
  currencyCode: string,
): string | null {
  if (value === null) return null
  return value.toFixed(minorUnits.get(currencyCode) ?? 2)
}

function mapAttributes(value: unknown): readonly ProductCatalogAttribute[] {
  if (!Array.isArray(value)) fail('PRODUCT_ATTRIBUTES_INVALID')
  return Object.freeze(value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail('PRODUCT_ATTRIBUTES_INVALID')
    }
    const row = entry as Readonly<Record<string, unknown>>
    if (typeof row.title !== 'string' || typeof row.value !== 'string') {
      fail('PRODUCT_ATTRIBUTES_INVALID')
    }
    return Object.freeze({ title: row.title, value: row.value })
  }))
}

/**
 * 只导出跨环境可复现的产品目录字段，不读取任何媒体关联；测试机产品媒体
 * 明确不进入生产。无法参与产品创建的历史行单独列为 incompleteProducts。
 */
@Injectable()
export class ProductExportService {
  constructor(private readonly prisma: PrismaService) {}

  async buildManifest(options: ProductExportOptions): Promise<ProductCatalogManifest> {
    const supplierType = await this.prisma.dictionaryType.findUnique({
      where: { code: SUPPLIER_DICTIONARY_CODE },
      select: { id: true },
    })
    if (supplierType === null) fail('SUPPLIER_DICTIONARY_MISSING')

    const currencyRows = await this.prisma.currency.findMany({
      select: { code: true, minorUnit: true },
    })
    const minorUnits = new Map(currencyRows.map(currency => [currency.code, currency.minorUnit]))

    const supplierItems = await this.prisma.dictionaryItem.findMany({
      where: { dictionaryTypeId: supplierType.id },
      select: { value: true, label: true },
    })
    const supplierByValue = new Map(supplierItems.map(item => [item.value, item]))

    const categoryRows = await this.prisma.productCategory.findMany({
      select: { supplierValue: true, name: true, sortOrder: true },
    })
    const headRows = await this.prisma.productHead.findMany({
      select: {
        name: true,
        sortOrder: true,
        category: { select: { supplierValue: true, name: true } },
      },
    })
    const productRows = await this.prisma.product.findMany({
      select: {
        productNo: true,
        name: true,
        status: true,
        supplierValue: true,
        sortOrder: true,
        twdSalePriceAmount: true,
        twdSalePriceCurrency: true,
        myrSalePriceAmount: true,
        myrSalePriceCurrency: true,
        purchaseCostAmount: true,
        purchaseCostCurrency: true,
        attributes: true,
        remark: true,
        category: { select: { supplierValue: true, name: true } },
        productHead: { select: { name: true } },
      },
    })

    const completeProducts: ProductCatalogProduct[] = []
    const incompleteProducts: ProductCatalogIncompleteProduct[] = []
    for (const row of productRows as readonly ProductRow[]) {
      if (row.category === null || row.productHead === null) {
        incompleteProducts.push(Object.freeze({
          supplierValue: row.supplierValue,
          name: row.name,
          sourceProductNo: row.productNo,
          reason: 'MISSING_CATEGORY_OR_HEAD',
        }))
        continue
      }
      if (row.category.supplierValue !== row.supplierValue) {
        incompleteProducts.push(Object.freeze({
          supplierValue: row.supplierValue,
          name: row.name,
          sourceProductNo: row.productNo,
          reason: 'CATEGORY_SUPPLIER_MISMATCH',
        }))
        continue
      }
      completeProducts.push(Object.freeze({
        supplierValue: row.supplierValue,
        categoryName: row.category.name,
        productHeadName: row.productHead.name,
        name: row.name,
        status: row.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        sortOrder: row.sortOrder,
        twdSalePriceAmount: formatAmount(
          row.twdSalePriceAmount,
          minorUnits,
          row.twdSalePriceCurrency,
        ),
        myrSalePriceAmount: formatAmount(
          row.myrSalePriceAmount,
          minorUnits,
          row.myrSalePriceCurrency,
        ),
        purchaseCostAmount: formatAmount(
          row.purchaseCostAmount,
          minorUnits,
          row.purchaseCostCurrency,
        ),
        attributes: mapAttributes(row.attributes),
        remark: row.remark,
        sourceProductNo: row.productNo,
      }))
    }

    const categories: ProductCatalogCategory[] = (categoryRows as readonly {
      readonly supplierValue: string
      readonly name: string
      readonly sortOrder: number
    }[]).map(row => Object.freeze({
      supplierValue: row.supplierValue,
      name: row.name,
      sortOrder: row.sortOrder,
    }))

    const heads: ProductCatalogHead[] = (headRows as readonly {
      readonly name: string
      readonly sortOrder: number
      readonly category: { readonly supplierValue: string, readonly name: string }
    }[]).map(row => Object.freeze({
      supplierValue: row.category.supplierValue,
      categoryName: row.category.name,
      name: row.name,
      sortOrder: row.sortOrder,
    }))

    const referencedSuppliers = new Set<string>()
    for (const category of categories) referencedSuppliers.add(category.supplierValue)
    for (const head of heads) referencedSuppliers.add(head.supplierValue)
    for (const product of completeProducts) referencedSuppliers.add(product.supplierValue)

    const suppliers: ProductCatalogSupplier[] = [...referencedSuppliers]
      .sort(compareText)
      .map((value) => {
        const item = supplierByValue.get(value)
        if (item === undefined) fail('SUPPLIER_DICTIONARY_ENTRY_MISSING')
        return Object.freeze({ value, label: item.label })
      })

    const sortedCategories = [...categories].sort((left, right) =>
      compareText(left.supplierValue, right.supplierValue)
      || compareText(left.name, right.name))
    const sortedHeads = [...heads].sort((left, right) =>
      compareText(left.supplierValue, right.supplierValue)
      || compareText(left.categoryName, right.categoryName)
      || compareText(left.name, right.name))
    const sortedProducts = [...completeProducts].sort((left, right) =>
      compareText(left.supplierValue, right.supplierValue)
      || compareText(left.categoryName, right.categoryName)
      || compareText(left.productHeadName, right.productHeadName)
      || compareText(left.name, right.name))
    const sortedIncomplete = [...incompleteProducts].sort((left, right) =>
      compareText(left.supplierValue, right.supplierValue)
      || compareText(left.name, right.name))

    const dataChecksum = calculateProductCatalogChecksum({
      suppliers,
      categories: sortedCategories,
      heads: sortedHeads,
      products: sortedProducts,
    })

    return Object.freeze({
      version: PRODUCT_CATALOG_MANIFEST_VERSION,
      source: Object.freeze({
        env: options.env,
        release: options.release,
        exportedAt: options.now.toISOString(),
      }),
      suppliers: Object.freeze(suppliers),
      categories: Object.freeze(sortedCategories),
      heads: Object.freeze(sortedHeads),
      products: Object.freeze(sortedProducts),
      incompleteProducts: Object.freeze(sortedIncomplete),
      dataChecksum,
    })
  }
}
