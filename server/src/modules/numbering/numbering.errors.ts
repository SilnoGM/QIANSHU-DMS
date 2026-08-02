export const NUMBERING_ERROR_CODES = {
  RULE_NOT_FOUND: 'NUMBERING_RULE_NOT_FOUND',
  RULE_CODE_ALREADY_EXISTS: 'NUMBERING_RULE_CODE_ALREADY_EXISTS',
  RULE_STATE_CHANGED: 'NUMBERING_RULE_STATE_CHANGED',
  RULE_UNAVAILABLE: 'NUMBERING_RULE_UNAVAILABLE',
  CAPACITY_EXHAUSTED: 'NUMBERING_CAPACITY_EXHAUSTED',
  IDEMPOTENCY_CONFLICT: 'NUMBERING_IDEMPOTENCY_CONFLICT',
  OUTPUT_CONFLICT: 'NUMBERING_OUTPUT_CONFLICT',
  RULE_CONFIG_INVALID: 'NUMBERING_RULE_CONFIG_INVALID',
  GENERATION_RETRY_EXHAUSTED: 'NUMBERING_GENERATION_RETRY_EXHAUSTED',
} as const

export type NumberingErrorCode =
  (typeof NUMBERING_ERROR_CODES)[keyof typeof NUMBERING_ERROR_CODES]

export const NUMBERING_BOUNDARY_ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type NumberingBoundaryErrorCode =
  (typeof NUMBERING_BOUNDARY_ERROR_CODES)[
    keyof typeof NUMBERING_BOUNDARY_ERROR_CODES
  ]

export type NumberingGenerationErrorCode =
  | NumberingErrorCode
  | NumberingBoundaryErrorCode

const RETRYABLE_ERROR_CODES = new Set<NumberingGenerationErrorCode>([
  NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED,
  NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
])

const SAFE_GENERATION_ERROR_MESSAGES: Readonly<
  Record<NumberingGenerationErrorCode, string>
> = {
  NUMBERING_RULE_NOT_FOUND: '编号规则不存在',
  NUMBERING_RULE_CODE_ALREADY_EXISTS: '编号规则编码已存在',
  NUMBERING_RULE_STATE_CHANGED: '编号规则状态已变化，请重试',
  NUMBERING_RULE_UNAVAILABLE: '编号规则当前不可用',
  NUMBERING_CAPACITY_EXHAUSTED: '编号容量已耗尽',
  NUMBERING_IDEMPOTENCY_CONFLICT: '幂等键已用于不同的发号请求',
  NUMBERING_OUTPUT_CONFLICT: '编号输出发生冲突',
  NUMBERING_RULE_CONFIG_INVALID: '编号规则配置无效',
  NUMBERING_GENERATION_RETRY_EXHAUSTED: '编号生成冲突重试次数已耗尽',
  VALIDATION_FAILED: '发号请求参数校验失败',
  INTERNAL_ERROR: '编号生成内部错误',
}

/**
 * Server 内部发号边界的稳定错误。它刻意不继承 HTTP 异常，也不携带字段值、
 * 原始幂等键或数据库详情；上层业务域可只依据 code 和 retryable 做确定处理。
 */
export class NumberingGenerationError extends Error {
  readonly retryable: boolean

  constructor(
    readonly code: NumberingGenerationErrorCode,
  ) {
    super(SAFE_GENERATION_ERROR_MESSAGES[code])
    this.name = 'NumberingGenerationError'
    this.retryable = isRetryableNumberingErrorCode(code)
  }
}

export function isRetryableNumberingErrorCode(code: string): boolean {
  return RETRYABLE_ERROR_CODES.has(code as NumberingGenerationErrorCode)
}
