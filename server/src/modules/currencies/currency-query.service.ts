import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  type CurrencyListQueryDto,
  CurrencyStatusFilter,
} from './dto/currency-management.dto'
import type {
  CurrencyCatalogItemDto,
  CurrencyDto,
  CurrencyPageDto,
} from './dto/currency.dto'
import { normalizeOptionalCurrencyText } from './currency.normalizer'

const BASE_CURRENCY_CODE = 'CNY'

const STABLE_CURRENCY_ORDER: Prisma.CurrencyOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { code: 'asc' },
  { id: 'asc' },
]

const CURRENCY_CATALOG_SELECT = {
  id: true,
  code: true,
  name: true,
  englishName: true,
  symbol: true,
  minorUnit: true,
  enabled: true,
  sortOrder: true,
} as const

const CURRENCY_MANAGEMENT_SELECT = {
  ...CURRENCY_CATALOG_SELECT,
  version: true,
  createdAt: true,
  updatedAt: true,
  exchangeRate: {
    select: {
      id: true,
    },
  },
} as const

interface CurrencyCatalogRow {
  id: string
  code: string
  name: string
  englishName: string | null
  symbol: string | null
  minorUnit: number
  enabled: boolean
  sortOrder: number
}

interface CurrencyManagementRow extends CurrencyCatalogRow {
  version: number
  createdAt: Date
  updatedAt: Date
  exchangeRate: { id: string } | null
}

interface NormalizedCurrencyListQuery {
  query?: string
  status?: CurrencyStatusFilter
  page: number
  pageSize: number
  skip: number
}

function currencyException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function validationFailure(): ApiException {
  return currencyException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
  )
}

function rethrowQueryError(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }

  // Prisma/驱动异常可能携带 SQL、参数或连接信息，读取边界只暴露固定公共错误。
  throw currencyException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function normalizeListQuery(
  query: Readonly<Partial<CurrencyListQueryDto>>,
): NormalizedCurrencyListQuery {
  if (!query || typeof query !== 'object') {
    throw validationFailure()
  }

  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 20
  const skip = (page - 1) * pageSize
  const statuses = new Set(Object.values(CurrencyStatusFilter))

  if (
    !Number.isSafeInteger(page)
    || page < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > 100
    || !Number.isSafeInteger(skip)
    || (
      query.status !== undefined
      && !statuses.has(query.status)
    )
  ) {
    throw validationFailure()
  }

  let normalizedQuery: string | undefined
  if (query.query !== undefined) {
    const value = normalizeOptionalCurrencyText(
      query.query,
      'query',
      128,
    )
    // 列表搜索不接受 null 或纯空白；Controller DTO 和 Service 直调保持同一语义。
    if (typeof value !== 'string' || value.length === 0) {
      throw validationFailure()
    }
    normalizedQuery = value
  }

  return {
    query: normalizedQuery,
    status: query.status,
    page,
    pageSize,
    skip,
  }
}

function buildCurrencyWhere(
  query: NormalizedCurrencyListQuery,
): Prisma.CurrencyWhereInput {
  const where: Prisma.CurrencyWhereInput = {}

  if (query.status === CurrencyStatusFilter.ENABLED) {
    where.enabled = true
  }
  else if (query.status === CurrencyStatusFilter.DISABLED) {
    where.enabled = false
  }

  if (query.query !== undefined) {
    where.OR = [
      {
        code: {
          contains: query.query.toUpperCase(),
          mode: 'insensitive',
        },
      },
      {
        name: {
          contains: query.query,
          mode: 'insensitive',
        },
      },
      {
        englishName: {
          contains: query.query,
          mode: 'insensitive',
        },
      },
    ]
  }

  return where
}

function toCatalogItem(
  currency: CurrencyCatalogRow,
): CurrencyCatalogItemDto {
  return {
    id: currency.id,
    code: currency.code,
    name: currency.name,
    englishName: currency.englishName,
    symbol: currency.symbol,
    minorUnit: currency.minorUnit,
    enabled: currency.enabled,
    isBase: currency.code === BASE_CURRENCY_CODE,
    sortOrder: currency.sortOrder,
  }
}

function toCurrencyDto(currency: CurrencyManagementRow): CurrencyDto {
  return {
    ...toCatalogItem(currency),
    exchangeRateConfigured: currency.exchangeRate !== null,
    version: currency.version,
    createdAt: currency.createdAt.toISOString(),
    updatedAt: currency.updatedAt.toISOString(),
  }
}

/**
 * 货币 Catalog 与管理读取共享同一映射，保证 `isBase`、展示元数据和稳定排序
 * 不会在两个 HTTP 边界之间漂移。Catalog 特意不按 enabled 过滤，以支持历史金额
 * 继续解析已停用货币；新建业务是否可选由调用方读取 enabled 决定。
 */
@Injectable()
export class CurrencyQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog(): Promise<CurrencyCatalogItemDto[]> {
    try {
      const currencies = await this.prisma.currency.findMany({
        orderBy: STABLE_CURRENCY_ORDER,
        select: CURRENCY_CATALOG_SELECT,
      })
      return currencies.map(toCatalogItem)
    }
    catch (error) {
      rethrowQueryError(error)
    }
  }

  async list(
    input: Readonly<Partial<CurrencyListQueryDto>>,
  ): Promise<CurrencyPageDto> {
    const query = normalizeListQuery(input)
    const where = buildCurrencyWhere(query)

    try {
      // count 与 rows 复用同一 where 对象，避免新增筛选时只改动其中一个口径。
      const [total, currencies] = await Promise.all([
        this.prisma.currency.count({ where }),
        this.prisma.currency.findMany({
          where,
          orderBy: STABLE_CURRENCY_ORDER,
          skip: query.skip,
          take: query.pageSize,
          select: CURRENCY_MANAGEMENT_SELECT,
        }),
      ])

      return {
        items: currencies.map(toCurrencyDto),
        page: query.page,
        pageSize: query.pageSize,
        total,
      }
    }
    catch (error) {
      rethrowQueryError(error)
    }
  }

  async getById(currencyId: string): Promise<CurrencyDto> {
    try {
      const currency = await this.prisma.currency.findUnique({
        where: { id: currencyId },
        select: CURRENCY_MANAGEMENT_SELECT,
      })

      if (currency === null) {
        throw currencyException(
          HttpStatus.NOT_FOUND,
          'CURRENCY_NOT_FOUND',
          '货币不存在',
        )
      }

      return toCurrencyDto(currency)
    }
    catch (error) {
      rethrowQueryError(error)
    }
  }
}
