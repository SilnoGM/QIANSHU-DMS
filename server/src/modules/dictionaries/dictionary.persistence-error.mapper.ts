import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  hasPersistenceTarget,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  createDictionaryApiException,
  DICTIONARY_ERROR_CODES,
} from './dictionary.errors'

export type DictionaryPersistenceErrorContext = 'TYPE' | 'ITEM'

const TRANSACTION_CONFLICT_CODES = [
  'P2034',
  '40001',
  '40P01',
  '55P03',
] as const

/**
 * 将 Prisma/driver adapter 的结构化数据库事实收敛为字典领域错误。
 *
 * 严禁读取 message、detail 或 SQL 文本；未命中精确白名单时一律失败关闭，
 * 避免数据库结构、连接信息和用户输入进入公开响应。
 */
export function mapDictionaryPersistenceError(
  error: unknown,
  context: DictionaryPersistenceErrorContext,
  transactionConflictContext: DictionaryPersistenceErrorContext = context,
): ApiException {
  if (error instanceof ApiException) {
    return error
  }

  const facts = readPersistenceErrorFacts(error)
  const isUniqueViolation =
    hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')
  const hasExactTypeCodeTarget =
    facts.targets.size === 1
    && hasPersistenceTarget(facts, 'code')

  if (
    context === 'TYPE'
    &&
    isUniqueViolation
    && (
      hasPersistenceConstraint(facts, 'dictionary_types_code_key')
      || hasExactTypeCodeTarget
    )
  ) {
    return createDictionaryApiException(
      DICTIONARY_ERROR_CODES.TYPE_CODE_ALREADY_EXISTS,
    )
  }

  /*
   * Item 唯一键必须同时且仅包含父 Type 与 value。只看到 value 等局部 target
   * 不能证明命中了冻结复合键，因此不得猜测为可公开的业务冲突。
   */
  const hasExactItemCompositeTarget =
    facts.targets.size === 2
    && hasPersistenceTarget(facts, 'dictionary_type_id')
    && hasPersistenceTarget(facts, 'value')

  if (
    context === 'ITEM'
    &&
    isUniqueViolation
    && (
      hasPersistenceConstraint(
        facts,
        'dictionary_items_dictionary_type_id_value_key',
      )
      || hasExactItemCompositeTarget
    )
  ) {
    return createDictionaryApiException(
      DICTIONARY_ERROR_CODES.ITEM_VALUE_ALREADY_EXISTS,
    )
  }

  if (
    hasPersistenceCode(facts, '23514')
    && (
      hasPersistenceConstraint(
        facts,
        'dictionary_types_enabled_item_required_check',
      )
      || hasPersistenceConstraint(
        facts,
        'dictionary_items_last_enabled_check',
      )
    )
  ) {
    return createDictionaryApiException(
      DICTIONARY_ERROR_CODES.TYPE_ENABLED_ITEM_REQUIRED,
    )
  }

  if (
    TRANSACTION_CONFLICT_CODES.some(code =>
      hasPersistenceCode(facts, code),
    )
  ) {
    return createDictionaryApiException(
      transactionConflictContext === 'TYPE'
        ? DICTIONARY_ERROR_CODES.TYPE_STATE_CHANGED
        : DICTIONARY_ERROR_CODES.ITEM_STATE_CHANGED,
    )
  }

  return createDictionaryApiException(
    DICTIONARY_ERROR_CODES.INTERNAL_ERROR,
  )
}
