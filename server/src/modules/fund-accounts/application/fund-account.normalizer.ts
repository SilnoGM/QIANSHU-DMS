import {
  FUND_ACCOUNT_OWNER_TYPES,
  FUND_ACCOUNT_SORT_FIELDS,
  type FundAccountCommandContext,
  type FundAccountCreateInput,
  type FundAccountOwnerType,
  type FundAccountShareRateUpdateInput,
  type FundAccountSortField,
  type FundAccountSortOrder,
} from './fund-account.contract'
import {
  normalizeFundPagination,
  normalizeFundShareRateInput,
  normalizeFundSort,
  normalizeFundUuid,
} from './fund-input.normalizer'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorField,
} from './fund-posting.errors'

const COMMAND_CONTEXT_KEYS = new Set([
  'actorUserId',
  'requestId',
  'correlationId',
])
const ACCOUNT_QUERY_KEYS = new Set([
  'page',
  'pageSize',
  'search',
  'ownerType',
  'sortBy',
  'sortOrder',
])
const ACCOUNT_CREATE_KEYS = new Set(['userId', 'userShareRate'])
const SHARE_RATE_UPDATE_KEYS = new Set([
  'accountId',
  'userShareRate',
  'expectedVersion',
  'reason',
])
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u
const MAX_INT32 = 2_147_483_647

export interface NormalizedFundAccountListQuery {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
  readonly search: string | null
  readonly ownerType: FundAccountOwnerType | null
  readonly sortBy: FundAccountSortField
  readonly sortOrder: FundAccountSortOrder
}

function validationFailed(field: FundPostingErrorField): never {
  throw new FundPostingError(FUND_POSTING_ERROR_CODES.VALIDATION_FAILED, field)
}

/**
 * 内部应用服务同样拒绝 accessor、symbol、继承型对象和未知字段，避免未来
 * Controller 或其他模块绕开 class-validator 后把不可信对象带入事务。
 */
function readSafeValues(
  input: unknown,
  allowedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailed('body')
  }

  try {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      return validationFailed('body')
    }

    const keys = Reflect.ownKeys(input)
    if (keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
      return validationFailed('body')
    }

    const descriptors = Object.getOwnPropertyDescriptors(input)
    const values: Record<string, unknown> = {}
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || !('value' in descriptor)
      ) {
        return validationFailed('body')
      }
      values[key] = descriptor.value
    }
    return values
  }
  catch (error) {
    if (error instanceof FundPostingError) throw error
    return validationFailed('body')
  }
}

function normalizeText(
  value: unknown,
  field: FundPostingErrorField,
  maximumCodePoints: number,
  collapseWhitespace: boolean,
): string {
  if (typeof value !== 'string') return validationFailed(field)
  const trimmed = value.normalize('NFC').trim()
  const normalized = collapseWhitespace
    ? trimmed.replace(/\s+/gu, ' ')
    : trimmed

  if (
    normalized.length === 0
    || [...normalized].length > maximumCodePoints
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return validationFailed(field)
  }
  return normalized
}

function normalizeOptionalSearch(value: unknown): string | null {
  if (value === undefined) return null
  return normalizeText(value, 'search', 128, true)
}

export function normalizeFundAccountCommandContext(
  input: unknown,
): FundAccountCommandContext {
  const values = readSafeValues(input, COMMAND_CONTEXT_KEYS)
  return Object.freeze({
    actorUserId: normalizeFundUuid(values.actorUserId, 'actorUserId'),
    requestId: normalizeText(values.requestId, 'requestId', 64, false),
    ...(values.correlationId === undefined
      ? {}
      : {
          correlationId: normalizeText(
            values.correlationId,
            'correlationId',
            128,
            false,
          ),
        }),
  })
}

export function normalizeFundAccountListQuery(
  input: unknown,
): NormalizedFundAccountListQuery {
  const values = readSafeValues(input, ACCOUNT_QUERY_KEYS)
  const pagination = normalizeFundPagination({
    page: values.page ?? 1,
    pageSize: values.pageSize ?? 20,
  })

  let ownerType: FundAccountOwnerType | null = null
  if (values.ownerType !== undefined) {
    if (
      typeof values.ownerType !== 'string'
      || !FUND_ACCOUNT_OWNER_TYPES.includes(
        values.ownerType as FundAccountOwnerType,
      )
    ) {
      return validationFailed('ownerType')
    }
    ownerType = values.ownerType as FundAccountOwnerType
  }

  const sort = normalizeFundSort(
    values.sortBy,
    values.sortOrder,
    FUND_ACCOUNT_SORT_FIELDS,
    { sortBy: 'updatedAt', sortOrder: 'desc' },
  )

  return Object.freeze({
    ...pagination,
    search: normalizeOptionalSearch(values.search),
    ownerType,
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
  })
}

export function normalizeFundAccountCreate(
  input: unknown,
): FundAccountCreateInput {
  const values = readSafeValues(input, ACCOUNT_CREATE_KEYS)
  return Object.freeze({
    userId: normalizeFundUuid(values.userId, 'userId'),
    userShareRate: normalizeFundShareRateInput(values.userShareRate),
  })
}

export function normalizeFundAccountShareRateUpdate(
  input: unknown,
): FundAccountShareRateUpdateInput {
  const values = readSafeValues(input, SHARE_RATE_UPDATE_KEYS)
  if (
    !Number.isSafeInteger(values.expectedVersion)
    || (values.expectedVersion as number) < 1
    || (values.expectedVersion as number) > MAX_INT32
  ) {
    return validationFailed('expectedVersion')
  }

  return Object.freeze({
    accountId: normalizeFundUuid(values.accountId, 'accountId'),
    userShareRate: normalizeFundShareRateInput(values.userShareRate),
    expectedVersion: values.expectedVersion as number,
    reason: normalizeText(values.reason, 'reason', 500, true),
  })
}
