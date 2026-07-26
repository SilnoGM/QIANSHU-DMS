import Decimal from 'decimal.js'

export const DEFAULT_MONEY_PRECISION = 2
export const MAX_MONEY_PRECISION = 100

export type MoneyAmount = string | null
export type MoneyValidationCode
  = | 'INVALID_FORMAT'
    | 'PRECISION_EXCEEDED'
    | 'NEGATIVE_NOT_ALLOWED'
    | 'BELOW_MIN'
    | 'ABOVE_MAX'

export interface MoneyValidationOptions {
  allowNegative?: boolean
  max?: string
  min?: string
  precision?: number
}

export type MoneyValidationResult
  = | {
    normalizedValue: MoneyAmount
    valid: true
  }
  | {
    code: MoneyValidationCode
    message: string
    normalizedValue: null
    valid: false
  }

const STRICT_MONEY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/u

interface ResolvedMoneyValidationOptions {
  allowNegative: boolean
  max?: {
    decimal: Decimal
    source: string
  }
  min?: {
    decimal: Decimal
    source: string
  }
  precision: number
}

/**
 * 非法金额进入精确计算时必须显式失败，调用方不得把格式错误静默当成零。
 * 错误对象保留稳定技术错误码与原始值，便于表单或表格把问题定位到具体字段。
 */
export class MoneyValidationError extends Error {
  readonly code: MoneyValidationCode
  readonly value: string

  constructor(value: string, result: Extract<MoneyValidationResult, { valid: false }>) {
    super(result.message)
    this.name = 'MoneyValidationError'
    this.code = result.code
    this.value = value
  }
}

function resolvePrecision(precision = DEFAULT_MONEY_PRECISION): number {
  if (!Number.isInteger(precision) || precision < 0 || precision > MAX_MONEY_PRECISION) {
    throw new RangeError(`precision 必须是 0 到 ${MAX_MONEY_PRECISION} 之间的整数`)
  }

  return precision
}

/**
 * min/max 属于开发期组件配置，不是用户输入。配置非法时直接抛错，避免组件在错误
 * 边界下继续运行并给出误导性的校验结果。
 */
function resolveBound(
  value: string | undefined,
  name: 'max' | 'min',
  precision: number,
): ResolvedMoneyValidationOptions['max'] {
  if (value === undefined) {
    return undefined
  }

  const match = STRICT_MONEY_PATTERN.exec(value)
  if (!match || (match[1]?.length ?? 0) > precision) {
    throw new TypeError(`${name} 必须是小数位不超过 precision 的严格金额字符串`)
  }

  return {
    decimal: new Decimal(value),
    source: value,
  }
}

function resolveOptions(
  options: MoneyValidationOptions,
): ResolvedMoneyValidationOptions {
  const precision = resolvePrecision(options.precision)
  const min = resolveBound(options.min, 'min', precision)
  const max = resolveBound(options.max, 'max', precision)

  if (min && max && min.decimal.greaterThan(max.decimal)) {
    throw new RangeError('min 不能大于 max')
  }

  return {
    allowNegative: options.allowNegative ?? false,
    max,
    min,
    precision,
  }
}

function invalidResult(
  code: MoneyValidationCode,
  message: string,
): Extract<MoneyValidationResult, { valid: false }> {
  return {
    code,
    message,
    normalizedValue: null,
    valid: false,
  }
}

/**
 * 校验持久化金额字符串，而不是输入中的临时草稿：
 * - null 表示业务空值；
 * - 禁止空字符串、空白、千分位、币种符号、前导加号和科学计数法；
 * - 整数部分必须存在，且除零外不得包含前导零；
 * - 语法通过后再使用 Decimal 做精确比较和固定精度规范化。
 */
export function validateMoneyString(
  value: MoneyAmount,
  options: MoneyValidationOptions = {},
): MoneyValidationResult {
  const resolved = resolveOptions(options)

  if (value === null) {
    return {
      normalizedValue: null,
      valid: true,
    }
  }

  const match = STRICT_MONEY_PATTERN.exec(value)
  if (!match) {
    return invalidResult(
      'INVALID_FORMAT',
      '请输入正确的金额，例如 1234.50',
    )
  }

  if ((match[1]?.length ?? 0) > resolved.precision) {
    return invalidResult(
      'PRECISION_EXCEEDED',
      `金额最多支持 ${resolved.precision} 位小数`,
    )
  }

  if (!resolved.allowNegative && value.startsWith('-')) {
    return invalidResult(
      'NEGATIVE_NOT_ALLOWED',
      '金额不能为负数',
    )
  }

  const decimal = new Decimal(value)
  if (resolved.min && decimal.lessThan(resolved.min.decimal)) {
    return invalidResult(
      'BELOW_MIN',
      `金额不能小于 ${resolved.min.source}`,
    )
  }
  if (resolved.max && decimal.greaterThan(resolved.max.decimal)) {
    return invalidResult(
      'ABOVE_MAX',
      `金额不能大于 ${resolved.max.source}`,
    )
  }

  return {
    normalizedValue: decimal.isZero()
      ? new Decimal(0).toFixed(resolved.precision)
      : decimal.toFixed(resolved.precision, Decimal.ROUND_HALF_UP),
    valid: true,
  }
}

/**
 * 将已校验金额收敛为固定精度字符串。非法值通过 MoneyValidationError 明确传播，
 * 供提交逻辑和列汇总统一处理。
 */
export function normalizeMoneyString(
  value: null,
  options?: MoneyValidationOptions,
): null
export function normalizeMoneyString(
  value: string,
  options?: MoneyValidationOptions,
): string
export function normalizeMoneyString(
  value: MoneyAmount,
  options?: MoneyValidationOptions,
): MoneyAmount
export function normalizeMoneyString(
  value: MoneyAmount,
  options: MoneyValidationOptions = {},
): MoneyAmount {
  const result = validateMoneyString(value, options)
  if (!result.valid) {
    throw new MoneyValidationError(value ?? '', result)
  }

  return result.normalizedValue
}

/**
 * 精确汇总 decimal 字符串。空值不参与计算；没有有效值时返回对应精度的零。
 * 每一项都先执行与 MoneyInput 相同的严格校验，任何非法值都会中止汇总。
 */
export function sumMoneyValues(
  values: readonly MoneyAmount[],
  options: MoneyValidationOptions = {},
): string {
  const precision = resolvePrecision(options.precision)
  let total = new Decimal(0)

  for (const value of values) {
    if (value === null) {
      continue
    }

    const normalizedValue = normalizeMoneyString(value, {
      ...options,
      precision,
    })
    total = total.plus(normalizedValue)
  }

  return total.toFixed(precision, Decimal.ROUND_HALF_UP)
}
