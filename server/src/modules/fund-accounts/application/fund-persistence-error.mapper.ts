import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  hasPersistenceTarget,
  readPersistenceErrorFacts,
  type PersistenceErrorFacts,
} from '../../../infrastructure/database/persistence-error-facts'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorCode,
} from './fund-posting.errors'

const UNIQUE_VIOLATION_CODES = ['P2002', '23505'] as const
const CONCURRENT_STATE_CODES = [
  'P2034',
  '40001',
  '40P01',
  '55P03',
  '57014',
] as const

function hasAnyCode(
  facts: PersistenceErrorFacts,
  codes: readonly string[],
): boolean {
  return codes.some(code => hasPersistenceCode(facts, code))
}

function hasAnyConstraint(
  facts: PersistenceErrorFacts,
  constraints: readonly string[],
): boolean {
  return constraints.some(constraint =>
    hasPersistenceConstraint(facts, constraint),
  )
}

function mapped(code: FundPostingErrorCode): FundPostingError {
  return new FundPostingError(code)
}

function safelyReadFacts(error: unknown): PersistenceErrorFacts | null {
  try {
    return readPersistenceErrorFacts(error)
  }
  catch {
    return null
  }
}

function isUniqueViolation(facts: PersistenceErrorFacts): boolean {
  return hasAnyCode(facts, UNIQUE_VIOLATION_CODES)
}

export function isFundIdempotencyUniqueViolation(error: unknown): boolean {
  const facts = safelyReadFacts(error)
  if (facts === null || !isUniqueViolation(facts)) return false

  return hasPersistenceConstraint(
    facts,
    'fund_posting_batches_consumer_source_idempotency_key',
  ) || (
    hasPersistenceTarget(facts, 'consumerCode')
    && hasPersistenceTarget(facts, 'businessSourceId')
    && hasPersistenceTarget(facts, 'idempotencyKeyHash')
  )
}

/**
 * 只依据 Prisma/PostgreSQL 的结构化 code、constraint 与 target 做稳定映射。
 * message/detail 从不参与判断，也不会进入返回异常。
 */
export function mapFundPersistenceError(error: unknown): FundPostingError {
  if (error instanceof FundPostingError) return error

  const facts = safelyReadFacts(error)
  if (facts === null) return mapped(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)

  if (hasAnyCode(facts, CONCURRENT_STATE_CODES)) {
    return mapped(FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED)
  }

  if (
    isUniqueViolation(facts)
    && (
      hasPersistenceConstraint(facts, 'fund_accounts_user_id_key')
      || hasPersistenceTarget(facts, 'userId')
    )
  ) {
    return mapped(FUND_POSTING_ERROR_CODES.ACCOUNT_ALREADY_EXISTS)
  }

  if (
    isUniqueViolation(facts)
    && hasPersistenceConstraint(facts, 'fund_accounts_one_company_key')
  ) {
    return mapped(FUND_POSTING_ERROR_CODES.COMPANY_ACCOUNT_UNAVAILABLE)
  }

  if (
    isUniqueViolation(facts)
    && hasPersistenceConstraint(facts, 'fund_business_sources_code_key')
  ) {
    return mapped(
      FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_CODE_ALREADY_EXISTS,
    )
  }

  if (
    isUniqueViolation(facts)
    && hasPersistenceConstraint(facts, 'fund_posting_types_code_key')
  ) {
    return mapped(FUND_POSTING_ERROR_CODES.POSTING_TYPE_CODE_ALREADY_EXISTS)
  }

  if (
    isUniqueViolation(facts)
    && (
      hasPersistenceConstraint(
        facts,
        'fund_ledger_entries_account_id_account_sequence_key',
      )
      || (
        hasPersistenceTarget(facts, 'accountId')
        && hasPersistenceTarget(facts, 'accountSequence')
      )
    )
  ) {
    return mapped(FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED)
  }

  if (hasAnyConstraint(facts, [
    'fund_accounts_identity_immutable_check',
    'fund_accounts_delete_forbidden_check',
    'fund_accounts_owner_shape_check',
    'fund_accounts_currency_cny_check',
    'fund_accounts_balance_scale_check',
    'fund_accounts_user_share_rate_range_check',
    'fund_accounts_next_sequence_positive_check',
    'fund_accounts_version_positive_check',
  ])) {
    return mapped(FUND_POSTING_ERROR_CODES.ACCOUNT_STATE_CHANGED)
  }

  if (hasAnyConstraint(facts, [
    'fund_posting_rule_legs_target_strategy_check',
    'fund_posting_rule_legs_adjustment_shape_check',
    'fund_posting_rule_legs_position_positive_check',
  ])) {
    return mapped(FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID)
  }

  if (hasAnyConstraint(facts, [
    'fund_business_sources_identity_immutable_check',
    'fund_business_sources_code_immutable_check',
    'fund_business_sources_delete_forbidden_check',
    'fund_posting_types_identity_immutable_check',
    'fund_posting_types_code_immutable_check',
    'fund_posting_types_delete_forbidden_check',
    'fund_posting_types_current_rule_active_check',
    'fund_posting_rule_versions_immutable_check',
    'fund_posting_rule_versions_delete_forbidden_check',
    'fund_posting_rule_legs_parent_guard_check',
  ]) || hasAnyCode(facts, ['P2003', '23503'])) {
    return mapped(FUND_POSTING_ERROR_CODES.CONFIG_STATE_CHANGED)
  }

  return mapped(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
}
