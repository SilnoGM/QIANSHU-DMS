import { HttpStatus } from '@nestjs/common'

import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  hasPersistenceTarget,
  readPersistenceErrorFacts,
  type PersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { NUMBERING_ERROR_CODES } from './numbering.errors'

const CONFIG_UNIQUE_CONSTRAINTS = [
  'numbering_rule_segments_one_random_key',
  'numbering_rule_segments_one_sequence_key',
  'numbering_rule_segments_version_id_position_key',
] as const

const STATE_UNIQUE_CONSTRAINTS = [
  'numbering_period_states_rule_id_period_key_key',
  'numbering_rule_versions_one_active_key',
  'numbering_rule_versions_one_draft_key',
  'numbering_rule_versions_id_rule_id_key',
  'numbering_rule_versions_rule_id_revision_key',
] as const

const CONFIG_CHECK_CONSTRAINTS = [
  'numbering_rules_rule_code_format_check',
  'numbering_rules_name_nonblank_check',
  'numbering_rules_description_nonblank_check',
  'numbering_rule_versions_revision_positive_check',
  'numbering_rule_versions_timezone_check',
  'numbering_rule_versions_config_fingerprint_check',
  'numbering_rule_versions_published_at_shape_check',
  'numbering_rule_segments_position_range_check',
  'numbering_rule_segments_shape_check',
  'numbering_rule_segments_fixed_value_format_check',
  'numbering_rule_segments_separator_value_check',
  'numbering_rule_segments_sequence_range_check',
  'numbering_rule_segments_random_length_check',
] as const

const STATE_CHECK_CONSTRAINTS = [
  'numbering_rules_version_positive_check',
  'numbering_rules_identity_immutable_check',
  'numbering_rule_versions_identity_immutable_check',
  'numbering_rule_versions_config_immutable_check',
  'numbering_rule_versions_status_transition_check',
  'numbering_rule_segments_parent_draft_check',
  'numbering_period_states_period_key_format_check',
  'numbering_period_states_used_count_nonnegative_check',
  'numbering_period_states_next_sequence_nonnegative_check',
] as const

const OUTPUT_CHECK_CONSTRAINTS = [
  'numbering_issuances_generated_number_format_check',
  'numbering_issuances_sequence_value_nonnegative_check',
] as const

function mappedException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function hasAnyConstraint(
  facts: PersistenceErrorFacts,
  constraints: readonly string[],
): boolean {
  return constraints.some(constraint =>
    hasPersistenceConstraint(facts, constraint),
  )
}

/**
 * 通用映射器只依据结构化 code/constraint/target。幂等唯一冲突故意不在此映射：
 * 它既可能是语义冲突，也可能是合法并发 replay，必须由 Task 9 回滚后重读裁决。
 */
export function mapNumberingPersistenceError(error: unknown): ApiException {
  if (error instanceof ApiException) {
    return error
  }

  const facts = readPersistenceErrorFacts(error)
  const isUniqueViolation =
    hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')

  if (
    isUniqueViolation
    && (
      hasPersistenceConstraint(facts, 'numbering_rules_rule_code_key')
      || hasPersistenceTarget(facts, 'ruleCode')
    )
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      NUMBERING_ERROR_CODES.RULE_CODE_ALREADY_EXISTS,
      '编号规则编码已存在',
    )
  }

  if (
    isUniqueViolation
    && (
      hasPersistenceConstraint(
        facts,
        'numbering_issuances_rule_id_generated_number_key',
      )
      || (
        hasPersistenceTarget(facts, 'ruleId')
        && hasPersistenceTarget(facts, 'generatedNumber')
      )
    )
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      NUMBERING_ERROR_CODES.OUTPUT_CONFLICT,
      '编号输出发生冲突',
    )
  }

  if (isUniqueViolation && hasAnyConstraint(facts, CONFIG_UNIQUE_CONSTRAINTS)) {
    return mappedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
      '编号规则配置无效',
    )
  }

  if (isUniqueViolation && hasAnyConstraint(facts, STATE_UNIQUE_CONSTRAINTS)) {
    return mappedException(
      HttpStatus.CONFLICT,
      NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
      '编号规则状态已变化，请刷新后重试',
    )
  }

  if (
    hasPersistenceCode(facts, '23514')
    && hasAnyConstraint(facts, CONFIG_CHECK_CONSTRAINTS)
  ) {
    return mappedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
      '编号规则配置无效',
    )
  }

  if (
    hasPersistenceCode(facts, '23514')
    && hasAnyConstraint(facts, STATE_CHECK_CONSTRAINTS)
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
      '编号规则状态已变化，请刷新后重试',
    )
  }

  if (
    hasPersistenceCode(facts, '23514')
    && hasAnyConstraint(facts, OUTPUT_CHECK_CONSTRAINTS)
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      NUMBERING_ERROR_CODES.OUTPUT_CONFLICT,
      '编号输出发生冲突',
    )
  }

  if (
    hasPersistenceCode(facts, 'P2034')
    || hasPersistenceCode(facts, '40001')
    || hasPersistenceCode(facts, '40P01')
    || hasPersistenceCode(facts, '55P03')
    || hasPersistenceCode(facts, '57014')
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
      '编号规则状态已变化，请刷新后重试',
    )
  }

  return mappedException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}
