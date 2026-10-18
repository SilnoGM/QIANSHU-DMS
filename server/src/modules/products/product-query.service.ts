import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import type { ProductStatus } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DictionaryLookupService,
  type StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import {
  mapProductMedia,
  mapProductMediaByProduct,
  readActiveProductMedia,
} from './media/product-media-query.mapper'
import {
  mapProductListItem,
  PRODUCT_RESPONSE_SELECT,
  type ProductListItem,
  type ProductQueryRow,
} from './product-query.mapper'
import {
  normalizeProductListQuery,
} from './product-query.normalizer'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

export interface ProductListQuery {
  readonly categoryName?: string
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
  readonly productHeadName?: string
  readonly status?: ProductStatus
  readonly supplierValue?: string
}

export interface ProductTaxonomyCategory {
  readonly name: string
  readonly productHeads: readonly string[]
}

export interface ProductTaxonomyOptions {
  readonly categories: readonly ProductTaxonomyCategory[]
}

export interface ProductPage {
  readonly items: readonly ProductListItem[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

@Injectable()
export class ProductQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
  ) {}

  async getById(productId: string): Promise<ProductListItem> {
    let snapshot: {
      readonly media: ReturnType<typeof mapProductMedia>
      readonly row: ProductQueryRow | null
    }
    try {
      snapshot = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await transaction.product.findUnique({
          where: { id: productId },
          select: PRODUCT_RESPONSE_SELECT,
        })
        if (row === null) {
          return { row, media: mapProductMedia(productId, []) }
        }
        const mediaRows = await readActiveProductMedia(transaction, [productId])
        return { row, media: mapProductMedia(productId, mediaRows) }
      })
    }
    catch {
      throw new ApiException(500, 'INTERNAL_ERROR', '服务器内部错误')
    }

    const { row, media } = snapshot
    if (row === null) {
      throw new ApiException(404, 'PRODUCT_NOT_FOUND', '产品不存在')
    }

    try {
      const supplierResolution = row.supplierValue === null
        ? null
        : await this.dictionaryLookup.resolveStoredValue({
            dictionaryCode: SUPPLIER_DICTIONARY_CODE,
            value: row.supplierValue,
          })
      return mapProductListItem(row, supplierResolution, media)
    }
    catch {
      // 字典和持久化 JSON 解析错误都可能携带内部数据，公共边界固定脱敏。
      throw new ApiException(500, 'INTERNAL_ERROR', '服务器内部错误')
    }
  }

  /**
   * 分类与产品头没有独立字典表，选项来自现有产品去重。这里返回全部分类及
   * 其产品头，供新增/编辑表单按分类级联选择；不写回任何目录数据。
   */
  async taxonomyOptions(): Promise<ProductTaxonomyOptions> {
    try {
      const rows = await this.prisma.product.findMany({
        where: {
          categoryName: { not: null },
          productHeadName: { not: null },
        },
        select: {
          categoryName: true,
          productHeadName: true,
        },
        orderBy: [
          { categoryName: 'asc' },
          { productHeadName: 'asc' },
        ],
      })
      const categories = new Map<string, Set<string>>()
      for (const row of rows) {
        if (row.categoryName === null || row.productHeadName === null) continue
        const heads = categories.get(row.categoryName) ?? new Set<string>()
        heads.add(row.productHeadName)
        categories.set(row.categoryName, heads)
      }
      return {
        categories: [...categories.entries()].map(([name, heads]) => ({
          name,
          productHeads: [...heads],
        })),
      }
    }
    catch {
      throw new ApiException(500, 'INTERNAL_ERROR', '服务器内部错误')
    }
  }

  async list(input: ProductListQuery): Promise<ProductPage> {
    const query = normalizeProductListQuery(input)
    const where: Prisma.ProductWhereInput = {}
    if (query.status !== undefined) {
      where.status = query.status
    }
    if (query.supplierValue !== undefined) {
      where.supplierValue = query.supplierValue
    }
    if (query.categoryName !== undefined) {
      where.categoryName = query.categoryName
    }
    if (query.productHeadName !== undefined) {
      where.productHeadName = query.productHeadName
    }
    if (query.keyword !== undefined) {
      // status/supplierValue 位于顶层、名称和编号位于 OR；Prisma 会把这些
      // 条件组合为 AND，并让 count/findMany 复用同一个 where，避免分页总数与行集漂移。
      const contains = {
        contains: query.keyword,
        mode: 'insensitive' as const,
      }
      where.OR = [
        { name: contains },
        { productNo: contains },
      ]
    }

    try {
      const { total, rows, mediaRows } = await this.prisma.$transaction(
        async (transaction) => {
          await applyTransactionTimeouts(transaction)
          const total = await transaction.product.count({ where })
          const rows = await transaction.product.findMany({
            where,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            skip: query.skip,
            take: query.pageSize,
            select: PRODUCT_RESPONSE_SELECT,
          })
          const mediaRows = await readActiveProductMedia(
            transaction,
            rows.map(row => row.id),
          )
          return { total, rows, mediaRows }
        },
      )

      const uniqueSupplierValues = [...new Set(rows.flatMap(row =>
        row.supplierValue === null ? [] : [row.supplierValue]))]
      const resolutions = uniqueSupplierValues.length === 0
        ? []
        : await this.dictionaryLookup.resolveStoredValues({
            dictionaryCode: SUPPLIER_DICTIONARY_CODE,
            values: uniqueSupplierValues,
          })
      const resolutionsByValue = new Map<string, StoredDictionaryValueResolution>(
        resolutions.map(resolution => [resolution.value, resolution]),
      )
      const mediaByProduct = mapProductMediaByProduct(
        rows.map(row => row.id),
        mediaRows,
      )

      return {
        items: rows.map(row => mapProductListItem(
          row,
          row.supplierValue === null
            ? null
            : resolutionsByValue.get(row.supplierValue) ?? null,
          mediaByProduct.get(row.id) ?? mapProductMedia(row.id, []),
        )),
        page: query.page,
        pageSize: query.pageSize,
        total,
      }
    }
    catch {
      // 数据层、字典解析和持久化 JSON 的错误都可能携带内部内容；公共边界固定脱敏。
      throw new ApiException(500, 'INTERNAL_ERROR', '服务器内部错误')
    }
  }
}
