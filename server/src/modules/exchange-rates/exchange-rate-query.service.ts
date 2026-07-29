import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  ExchangeRateStatusFilter,
  type ExchangeRateListQueryDto,
} from './dto/exchange-rate-management.dto'
import type {
  ExchangeRateDto,
  ExchangeRateManagementItemDto,
  ExchangeRatePageDto,
} from './dto/exchange-rate.dto'
import { normalizeForeignUnitsPerCny } from './exchange-rate.normalizer'

const BASE_CURRENCY_CODE = 'CNY'
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

const EXCHANGE_RATE_SELECT = {
  id: true,
  currencyId: true,
  foreignUnitsPerCny: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ExchangeRateSelect

const CURRENCY_WITH_RATE_SELECT = {
  id: true,
  code: true,
  name: true,
  englishName: true,
  symbol: true,
  minorUnit: true,
  enabled: true,
  sortOrder: true,
  exchangeRate: {
    select: EXCHANGE_RATE_SELECT,
  },
} as const satisfies Prisma.CurrencySelect

const STABLE_CURRENCY_ORDER: Prisma.CurrencyOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { code: 'asc' },
  { id: 'asc' },
]

type ExchangeRateRecord = Prisma.ExchangeRateGetPayload<{
  select: typeof EXCHANGE_RATE_SELECT
}>

type CurrencyWithRateRecord = Prisma.CurrencyGetPayload<{
  select: typeof CURRENCY_WITH_RATE_SELECT
}>

interface NormalizedExchangeRateListQuery {
  query?: string
  queryCode?: string
  status?: ExchangeRateStatusFilter
  page: number
  pageSize: number
  skip: number
}

function exchangeRateQueryException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function rethrowExchangeRateQueryError(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }

  // 驱动错误可能携带 SQL、参数或连接信息，只读边界只能暴露固定公共错误。
  throw exchangeRateQueryException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function normalizeListQuery(
  query: Readonly<Partial<ExchangeRateListQueryDto>>,
): NormalizedExchangeRateListQuery {
  if (!query || typeof query !== 'object') {
    throw exchangeRateQueryException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      '请求参数校验失败',
    )
  }

  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 20
  const skip = (page - 1) * pageSize
  const statuses = new Set(Object.values(ExchangeRateStatusFilter))

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
    throw exchangeRateQueryException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      '请求参数校验失败',
    )
  }

  let normalizedQuery: string | undefined
  if (query.query !== undefined) {
    if (typeof query.query !== 'string') {
      throw exchangeRateQueryException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
      )
    }

    normalizedQuery = query.query
      .normalize('NFC')
      .replace(UNICODE_WHITESPACE_PATTERN, ' ')
      .trim()

    if (
      normalizedQuery.length === 0
      || [...normalizedQuery].length > 128
    ) {
      throw exchangeRateQueryException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
      )
    }
  }

  return {
    query: normalizedQuery,
    queryCode: normalizedQuery?.toLocaleUpperCase('en-US'),
    status: query.status,
    page,
    pageSize,
    skip,
  }
}

function buildCurrencyWhere(
  query: NormalizedExchangeRateListQuery,
): Prisma.CurrencyWhereInput {
  const filters: Prisma.CurrencyWhereInput[] = []

  if (query.query !== undefined && query.queryCode !== undefined) {
    filters.push({
      OR: [
        { code: { contains: query.queryCode } },
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
      ],
    })
  }

  if (query.status === ExchangeRateStatusFilter.CONFIGURED) {
    filters.push({ exchangeRate: { isNot: null } })
  }
  else if (
    query.status === ExchangeRateStatusFilter.UNCONFIGURED
  ) {
    filters.push({ exchangeRate: { is: null } })
  }

  return {
    code: { not: BASE_CURRENCY_CODE },
    ...(filters.length > 0 ? { AND: filters } : {}),
  }
}

function toExchangeRateDto(
  rate: ExchangeRateRecord,
): ExchangeRateDto {
  return {
    id: rate.id,
    currencyId: rate.currencyId,
    // 统一经过字符串 normalizer，避免数据库固定 scale 泄漏尾随零，
    // 同时禁止任何隐式 JavaScript number 精度转换。
    foreignUnitsPerCny: normalizeForeignUnitsPerCny(
      rate.foreignUnitsPerCny.toString(),
    ),
    version: rate.version,
    createdAt: rate.createdAt.toISOString(),
    updatedAt: rate.updatedAt.toISOString(),
  }
}

function toManagementItem(
  currency: CurrencyWithRateRecord,
): ExchangeRateManagementItemDto {
  return {
    currency: {
      id: currency.id,
      code: currency.code,
      name: currency.name,
      englishName: currency.englishName,
      symbol: currency.symbol,
      minorUnit: currency.minorUnit,
      enabled: currency.enabled,
      isBase: currency.code === BASE_CURRENCY_CODE,
      sortOrder: currency.sortOrder,
    },
    currentRate: currency.exchangeRate === null
      ? null
      : toExchangeRateDto(currency.exchangeRate),
  }
}

/**
 * 当前汇率管理读取以 Currency 为主实体，并读取可空的一对一 ExchangeRate。
 *
 * 因而尚未配置汇率的停用外币仍会出现在列表中；CNY 被固定排除，分页顺序
 * 始终由 sortOrder/code/id 决定，响应比例始终保持十进制字符串。
 */
@Injectable()
export class ExchangeRateQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    input: Readonly<Partial<ExchangeRateListQueryDto>>,
  ): Promise<ExchangeRatePageDto> {
    const query = normalizeListQuery(input)
    const where = buildCurrencyWhere(query)

    try {
      const [total, currencies] = await Promise.all([
        this.prisma.currency.count({ where }),
        this.prisma.currency.findMany({
          where,
          select: CURRENCY_WITH_RATE_SELECT,
          orderBy: STABLE_CURRENCY_ORDER,
          skip: query.skip,
          take: query.pageSize,
        }),
      ])

      return {
        items: currencies.map(toManagementItem),
        page: query.page,
        pageSize: query.pageSize,
        total,
      }
    }
    catch (error) {
      rethrowExchangeRateQueryError(error)
    }
  }

  async getById(exchangeRateId: string): Promise<ExchangeRateDto> {
    try {
      const rate = await this.prisma.exchangeRate.findUnique({
        where: { id: exchangeRateId },
        select: EXCHANGE_RATE_SELECT,
      })

      if (rate === null) {
        throw exchangeRateQueryException(
          HttpStatus.NOT_FOUND,
          'EXCHANGE_RATE_NOT_FOUND',
          '汇率不存在',
        )
      }

      return toExchangeRateDto(rate)
    }
    catch (error) {
      rethrowExchangeRateQueryError(error)
    }
  }
}
