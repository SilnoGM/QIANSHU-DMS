import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import {
  NumberingGeneratedNumberMatch,
  type NumberingGeneratedNumberMatch as NumberingGeneratedNumberMatchValue,
  type NumberingIssuanceListQueryDto,
  type NumberingRuleListQueryDto,
  NumberingRuleSortBy,
  NumberingRuleSortOrder,
  NumberingRuleStatus,
} from './dto/numbering-management.dto'
import { normalizeNumberingKeyword } from './numbering.normalizer'
import type { NumberingRuleListPersistenceQuery } from './numbering-query.persistence'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAXIMUM_PAGE_SIZE = 100
const RULE_STATUSES = new Set(Object.values(NumberingRuleStatus))
const SORT_ORDERS = new Set(Object.values(NumberingRuleSortOrder))
const GENERATED_NUMBER_MATCHES = new Set(
  Object.values(NumberingGeneratedNumberMatch),
)
const PERIOD_KEY_PATTERN = /^(?:ALL|\d{4}|\d{6}|\d{8})$/u
const CONSUMER_CODE_PATTERN = /^[A-Z][A-Z0-9._-]{0,63}$/u
const GENERATED_NUMBER_PATTERN = /^[A-Z0-9._/-]{1,64}$/u

export interface NormalizedNumberingPaginationQuery {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
}

function validationFailure(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
  )
}

export function normalizeNumberingPagination(
  query: Readonly<{ page?: number; pageSize?: number }>,
): NormalizedNumberingPaginationQuery {
  if (!query || typeof query !== 'object') {
    return validationFailure()
  }

  const page = query.page ?? DEFAULT_PAGE
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
  const skip = (page - 1) * pageSize

  if (
    !Number.isSafeInteger(page)
    || page < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > MAXIMUM_PAGE_SIZE
    || !Number.isSafeInteger(skip)
  ) {
    return validationFailure()
  }

  return { page, pageSize, skip }
}

export function normalizeNumberingRuleListQuery(
  query: Readonly<Partial<NumberingRuleListQueryDto>>,
): NumberingRuleListPersistenceQuery {
  if (!query || typeof query !== 'object') {
    return validationFailure()
  }

  const pagination = normalizeNumberingPagination(query)
  const keyword = normalizeNumberingKeyword(query.keyword)
  const sortBy = query.sortBy ?? NumberingRuleSortBy.UPDATED_AT
  const sortOrder = query.sortOrder ?? NumberingRuleSortOrder.DESC

  if (
    sortBy !== NumberingRuleSortBy.UPDATED_AT
    || !SORT_ORDERS.has(sortOrder)
    || (
      query.status !== undefined
      && !RULE_STATUSES.has(query.status)
    )
  ) {
    return validationFailure()
  }

  return {
    ...pagination,
    keyword,
    status: query.status,
    sortOrder,
  }
}

export function normalizeNumberingIssuanceQuery(
  query: Readonly<Partial<NumberingIssuanceListQueryDto>>,
): NormalizedNumberingPaginationQuery & {
  readonly periodKey?: string
  readonly consumerCode?: string
  readonly generatedNumber?: string
  readonly generatedNumberMatch?: NumberingGeneratedNumberMatchValue
} {
  if (!query || typeof query !== 'object') {
    return validationFailure()
  }

  const pagination = normalizeNumberingPagination(query)
  const generatedNumberMatch = query.generatedNumber === undefined
    ? query.generatedNumberMatch
    : query.generatedNumberMatch ?? NumberingGeneratedNumberMatch.EXACT

  if (
    (
      query.periodKey !== undefined
      && (
        typeof query.periodKey !== 'string'
        || !PERIOD_KEY_PATTERN.test(query.periodKey)
      )
    )
    || (
      query.consumerCode !== undefined
      && (
        typeof query.consumerCode !== 'string'
        || !CONSUMER_CODE_PATTERN.test(query.consumerCode)
      )
    )
    || (
      query.generatedNumber !== undefined
      && (
        typeof query.generatedNumber !== 'string'
        || !GENERATED_NUMBER_PATTERN.test(query.generatedNumber)
      )
    )
    || (
      generatedNumberMatch !== undefined
      && !GENERATED_NUMBER_MATCHES.has(generatedNumberMatch)
    )
    || (
      query.generatedNumber === undefined
      && generatedNumberMatch !== undefined
    )
  ) {
    return validationFailure()
  }

  return {
    ...pagination,
    periodKey: query.periodKey,
    consumerCode: query.consumerCode,
    generatedNumber: query.generatedNumber,
    generatedNumberMatch,
  }
}
