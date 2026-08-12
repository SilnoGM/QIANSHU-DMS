import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DictionaryLookupService,
  type StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import {
  mapProductListItem,
  PRODUCT_RESPONSE_SELECT,
  type ProductListItem,
} from './product-query.mapper'
import {
  normalizeProductListQuery,
} from './product-query.normalizer'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

export interface ProductListQuery {
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
  readonly supplierValue?: string
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

  async list(input: ProductListQuery): Promise<ProductPage> {
    const query = normalizeProductListQuery(input)
    const where: Prisma.ProductWhereInput = {}
    if (query.supplierValue !== undefined) {
      where.supplierValue = query.supplierValue
    }
    if (query.keyword !== undefined) {
      // supplierValue 位于顶层、名称和编号位于 OR；Prisma 会把两者组合为
      // AND，并让 count/findMany 复用同一个 where，避免分页总数与行集漂移。
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
      const { total, rows } = await this.prisma.$transaction(
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
          return { total, rows }
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

      return {
        items: rows.map(row => mapProductListItem(
          row,
          row.supplierValue === null
            ? null
            : resolutionsByValue.get(row.supplierValue) ?? null,
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
