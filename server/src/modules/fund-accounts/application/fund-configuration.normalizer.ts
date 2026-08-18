import {
  FUND_ACCOUNT_TARGETS,
  FUND_ADJUSTMENT_MODES,
  FUND_AMOUNT_SIGN_POLICIES,
  FUND_AMOUNT_STRATEGIES,
  FUND_BUSINESS_CATEGORIES,
  FUND_DIRECTION_POLICIES,
  type FundBusinessCategory,
  type FundPostingRuleLeg,
} from '../domain'
import {
  FUND_BUSINESS_SOURCE_SORT_FIELDS,
  FUND_POSTING_TYPE_SORT_FIELDS,
  type FundBusinessSourceCreateInput,
  type FundBusinessSourceEnabledUpdateInput,
  type FundBusinessSourceSortField,
  type FundBusinessSourceUpdateInput,
  type FundConfigurationSortOrder,
  type FundDraftRuleReplaceInput,
  type FundPostingRulePublishInput,
  type FundPostingTypeCreateInput,
  type FundPostingTypeEnabledUpdateInput,
  type FundPostingTypeSortField,
  type FundPostingTypeUpdateInput,
} from './fund-configuration.contract'
import {
  normalizeFundPagination,
  normalizeFundSort,
  normalizeFundUuid,
} from './fund-input.normalizer'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorField,
} from './fund-posting.errors'

const POSTING_TYPE_QUERY_KEYS = new Set([
  'page', 'pageSize', 'search', 'businessCategory', 'enabled', 'sortBy',
  'sortOrder',
])
const BUSINESS_SOURCE_QUERY_KEYS = new Set([
  'page', 'pageSize', 'search', 'enabled', 'sortBy', 'sortOrder',
])
const POSTING_TYPE_CREATE_KEYS = new Set([
  'code', 'name', 'description', 'businessCategory', 'requiresUser',
  'amountSignPolicy', 'legs',
])
const POSTING_TYPE_UPDATE_KEYS = new Set([
  'postingTypeId', 'name', 'description', 'expectedVersion',
])
const DRAFT_RULE_REPLACE_KEYS = new Set([
  'postingTypeId', 'expectedVersion', 'legs',
])
const RULE_PUBLISH_KEYS = new Set([
  'postingTypeId', 'draftRuleVersionId', 'expectedVersion',
])
const POSTING_TYPE_ENABLED_KEYS = new Set([
  'postingTypeId', 'enabled', 'expectedVersion',
])
const BUSINESS_SOURCE_CREATE_KEYS = new Set([
  'code', 'name', 'description', 'enabled', 'allowedPostingTypeIds',
])
const BUSINESS_SOURCE_UPDATE_KEYS = new Set([
  'businessSourceId', 'name', 'description', 'allowedPostingTypeIds',
  'expectedVersion',
])
const BUSINESS_SOURCE_ENABLED_KEYS = new Set([
  'businessSourceId', 'enabled', 'expectedVersion',
])
const RULE_LEG_KEYS = new Set([
  'position', 'accountTarget', 'directionPolicy', 'amountStrategy',
  'adjustmentMode',
])
const CANONICAL_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u
const MAX_INT32 = 2_147_483_647

export interface NormalizedFundPostingTypeListQuery {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
  readonly search: string | null
  readonly businessCategory: FundBusinessCategory | null
  readonly enabled: boolean | null
  readonly sortBy: FundPostingTypeSortField
  readonly sortOrder: FundConfigurationSortOrder
}

export interface NormalizedFundBusinessSourceListQuery {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
  readonly search: string | null
  readonly enabled: boolean | null
  readonly sortBy: FundBusinessSourceSortField
  readonly sortOrder: FundConfigurationSortOrder
}

export interface NormalizedFundPostingTypeCreateInput
  extends FundPostingTypeCreateInput {
  readonly description: string | null
  readonly inputMode: 'STANDARD'
  readonly enabled: false
}

export interface NormalizedFundPostingTypeUpdateInput
  extends FundPostingTypeUpdateInput {
  readonly description: string | null
}

export interface NormalizedFundBusinessSourceCreateInput
  extends FundBusinessSourceCreateInput {
  readonly description: string | null
}

export interface NormalizedFundBusinessSourceUpdateInput
  extends FundBusinessSourceUpdateInput {
  readonly description: string | null
}

function validationFailed(field: FundPostingErrorField): never {
  throw new FundPostingError(FUND_POSTING_ERROR_CODES.VALIDATION_FAILED, field)
}

/**
 * 内部管理服务也只读取普通对象的数据属性；拒绝 getter、symbol、继承对象和未知
 * 字段，防止未来任一调用入口绕过 HTTP DTO 后扩大配置写入面。
 */
function readSafeValues(
  input: unknown,
  allowedKeys: ReadonlySet<string>,
  field: FundPostingErrorField = 'body',
): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailed(field)
  }

  try {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      return validationFailed(field)
    }
    const keys = Reflect.ownKeys(input)
    if (keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
      return validationFailed(field)
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
        return validationFailed(field)
      }
      values[key] = descriptor.value
    }
    return values
  }
  catch (error) {
    if (error instanceof FundPostingError) throw error
    return validationFailed(field)
  }
}

function normalizeText(
  value: unknown,
  field: FundPostingErrorField,
  maximumCodePoints: number,
): string {
  if (typeof value !== 'string') return validationFailed(field)
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (
    normalized.length === 0
    || [...normalized].length > maximumCodePoints
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return validationFailed(field)
  }
  return normalized
}

function normalizeDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return validationFailed('description')
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) return null
  if (
    [...normalized].length > 500
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return validationFailed('description')
  }
  return normalized
}

function normalizeCode(value: unknown): string {
  if (typeof value !== 'string') return validationFailed('code')
  const normalized = value.normalize('NFC').trim().toUpperCase()
  if (!CANONICAL_CODE_PATTERN.test(normalized)) return validationFailed('code')
  return normalized
}

function normalizeBoolean(
  value: unknown,
  field: FundPostingErrorField,
): boolean {
  if (typeof value !== 'boolean') return validationFailed(field)
  return value
}

function normalizeExpectedVersion(value: unknown): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 1
    || (value as number) > MAX_INT32
  ) {
    return validationFailed('expectedVersion')
  }
  return value as number
}

function normalizeNullableBoolean(
  value: unknown,
  field: FundPostingErrorField,
): boolean | null {
  return value === undefined ? null : normalizeBoolean(value, field)
}

function normalizeOptionalSearch(value: unknown): string | null {
  return value === undefined ? null : normalizeText(value, 'search', 128)
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: FundPostingErrorField,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return validationFailed(field)
  }
  return value as T
}

function normalizeRuleLeg(value: unknown): FundPostingRuleLeg {
  const values = readSafeValues(value, RULE_LEG_KEYS, 'legs')
  if (
    !Number.isInteger(values.position)
    || (values.position as number) < 1
    || (values.position as number) > 8
  ) {
    return validationFailed('legs')
  }

  const adjustmentMode = values.adjustmentMode === undefined
    ? undefined
    : normalizeEnum(
        values.adjustmentMode,
        FUND_ADJUSTMENT_MODES,
        'legs',
      )
  return Object.freeze({
    position: values.position as number,
    accountTarget: normalizeEnum(
      values.accountTarget,
      FUND_ACCOUNT_TARGETS,
      'legs',
    ),
    directionPolicy: normalizeEnum(
      values.directionPolicy,
      FUND_DIRECTION_POLICIES,
      'legs',
    ),
    amountStrategy: normalizeEnum(
      values.amountStrategy,
      FUND_AMOUNT_STRATEGIES,
      'legs',
    ),
    ...(adjustmentMode === undefined ? {} : { adjustmentMode }),
  })
}

function normalizeRuleLegs(value: unknown): readonly FundPostingRuleLeg[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    return validationFailed('legs')
  }
  return Object.freeze(value.map(normalizeRuleLeg))
}

function normalizeUuidList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) {
    return validationFailed('allowedPostingTypeIds')
  }
  const normalized = value.map(item => (
    normalizeFundUuid(item, 'allowedPostingTypeIds')
  ))
  return Object.freeze([...new Set(normalized)])
}

export function normalizeFundPostingTypeListQuery(
  input: unknown,
): NormalizedFundPostingTypeListQuery {
  const values = readSafeValues(input, POSTING_TYPE_QUERY_KEYS)
  const pagination = normalizeFundPagination({
    page: values.page ?? 1,
    pageSize: values.pageSize ?? 20,
  })
  const sort = normalizeFundSort(
    values.sortBy,
    values.sortOrder,
    FUND_POSTING_TYPE_SORT_FIELDS,
    { sortBy: 'updatedAt', sortOrder: 'desc' },
  )
  const businessCategory = values.businessCategory === undefined
    ? null
    : normalizeEnum(
        values.businessCategory,
        FUND_BUSINESS_CATEGORIES,
        'businessCategory',
      )

  return Object.freeze({
    ...pagination,
    search: normalizeOptionalSearch(values.search),
    businessCategory,
    enabled: normalizeNullableBoolean(values.enabled, 'enabled'),
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
  })
}

export function normalizeFundBusinessSourceListQuery(
  input: unknown,
): NormalizedFundBusinessSourceListQuery {
  const values = readSafeValues(input, BUSINESS_SOURCE_QUERY_KEYS)
  const pagination = normalizeFundPagination({
    page: values.page ?? 1,
    pageSize: values.pageSize ?? 20,
  })
  const sort = normalizeFundSort(
    values.sortBy,
    values.sortOrder,
    FUND_BUSINESS_SOURCE_SORT_FIELDS,
    { sortBy: 'updatedAt', sortOrder: 'desc' },
  )
  return Object.freeze({
    ...pagination,
    search: normalizeOptionalSearch(values.search),
    enabled: normalizeNullableBoolean(values.enabled, 'enabled'),
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
  })
}

export function normalizeFundPostingTypeCreate(
  input: unknown,
): NormalizedFundPostingTypeCreateInput {
  const values = readSafeValues(input, POSTING_TYPE_CREATE_KEYS)
  const code = normalizeCode(values.code)
  if (code === 'ADMIN_MANUAL_ADJUSTMENT') return validationFailed('code')
  const businessCategory = normalizeEnum(
    values.businessCategory,
    FUND_BUSINESS_CATEGORIES,
    'businessCategory',
  )
  if (businessCategory === 'ADJUSTMENT') {
    return validationFailed('businessCategory')
  }

  const normalized: NormalizedFundPostingTypeCreateInput = Object.freeze({
    code,
    name: normalizeText(values.name, 'name', 128),
    description: normalizeDescription(values.description),
    businessCategory,
    requiresUser: normalizeBoolean(values.requiresUser, 'requiresUser'),
    amountSignPolicy: normalizeEnum(
      values.amountSignPolicy,
      FUND_AMOUNT_SIGN_POLICIES,
      'amountSignPolicy',
    ),
    inputMode: 'STANDARD',
    enabled: false,
    legs: normalizeRuleLegs(values.legs),
  })
  return normalized
}

export function normalizeFundPostingTypeUpdate(
  input: unknown,
): NormalizedFundPostingTypeUpdateInput {
  const values = readSafeValues(input, POSTING_TYPE_UPDATE_KEYS)
  return Object.freeze({
    postingTypeId: normalizeFundUuid(values.postingTypeId, 'postingTypeId'),
    name: normalizeText(values.name, 'name', 128),
    description: normalizeDescription(values.description),
    expectedVersion: normalizeExpectedVersion(values.expectedVersion),
  })
}

export function normalizeFundDraftRuleReplace(
  input: unknown,
): FundDraftRuleReplaceInput {
  const values = readSafeValues(input, DRAFT_RULE_REPLACE_KEYS)
  return Object.freeze({
    postingTypeId: normalizeFundUuid(values.postingTypeId, 'postingTypeId'),
    expectedVersion: normalizeExpectedVersion(values.expectedVersion),
    legs: normalizeRuleLegs(values.legs),
  })
}

export function normalizeFundPostingRulePublish(
  input: unknown,
): FundPostingRulePublishInput {
  const values = readSafeValues(input, RULE_PUBLISH_KEYS)
  return Object.freeze({
    postingTypeId: normalizeFundUuid(values.postingTypeId, 'postingTypeId'),
    draftRuleVersionId: normalizeFundUuid(
      values.draftRuleVersionId,
      'draftRuleVersionId',
    ),
    expectedVersion: normalizeExpectedVersion(values.expectedVersion),
  })
}

export function normalizeFundPostingTypeEnabledUpdate(
  input: unknown,
): FundPostingTypeEnabledUpdateInput {
  const values = readSafeValues(input, POSTING_TYPE_ENABLED_KEYS)
  return Object.freeze({
    postingTypeId: normalizeFundUuid(values.postingTypeId, 'postingTypeId'),
    enabled: normalizeBoolean(values.enabled, 'enabled'),
    expectedVersion: normalizeExpectedVersion(values.expectedVersion),
  })
}

export function normalizeFundBusinessSourceCreate(
  input: unknown,
): NormalizedFundBusinessSourceCreateInput {
  const values = readSafeValues(input, BUSINESS_SOURCE_CREATE_KEYS)
  const enabled = normalizeBoolean(values.enabled, 'enabled')
  const allowedPostingTypeIds = normalizeUuidList(values.allowedPostingTypeIds)
  if (enabled && allowedPostingTypeIds.length === 0) {
    return validationFailed('allowedPostingTypeIds')
  }
  return Object.freeze({
    code: normalizeCode(values.code),
    name: normalizeText(values.name, 'name', 128),
    description: normalizeDescription(values.description),
    enabled,
    allowedPostingTypeIds,
  })
}

export function normalizeFundBusinessSourceUpdate(
  input: unknown,
): NormalizedFundBusinessSourceUpdateInput {
  const values = readSafeValues(input, BUSINESS_SOURCE_UPDATE_KEYS)
  return Object.freeze({
    businessSourceId: normalizeFundUuid(
      values.businessSourceId,
      'businessSourceId',
    ),
    name: normalizeText(values.name, 'name', 128),
    description: normalizeDescription(values.description),
    allowedPostingTypeIds: normalizeUuidList(values.allowedPostingTypeIds),
    expectedVersion: normalizeExpectedVersion(values.expectedVersion),
  })
}

export function normalizeFundBusinessSourceEnabledUpdate(
  input: unknown,
): FundBusinessSourceEnabledUpdateInput {
  const values = readSafeValues(input, BUSINESS_SOURCE_ENABLED_KEYS)
  return Object.freeze({
    businessSourceId: normalizeFundUuid(
      values.businessSourceId,
      'businessSourceId',
    ),
    enabled: normalizeBoolean(values.enabled, 'enabled'),
    expectedVersion: normalizeExpectedVersion(values.expectedVersion),
  })
}
