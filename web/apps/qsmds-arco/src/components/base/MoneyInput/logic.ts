import Decimal from 'decimal.js'

export const DEFAULT_MONEY_PRECISION = 2
export const MAX_MONEY_PRECISION = 100

export type MoneyAmount = string | null
export type MoneyValidationCode
  = | 'CURRENCY_REQUIRED'
    | 'INVALID_FORMAT'
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

export type MoneyDiscountRateTrend = 'above' | 'below' | 'equal'

export interface MoneyDiscountRate {
  formattedValue: string
  trend: MoneyDiscountRateTrend
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

  const match = typeof value === 'string'
    ? STRICT_MONEY_PATTERN.exec(value)
    : null
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

  // API 响应和动态表单数据不受 TypeScript 运行时约束，非字符串统一按格式错误处理。
  if (typeof value !== 'string') {
    return invalidResult(
      'INVALID_FORMAT',
      '请输入正确的金额，例如 1234.50',
    )
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
    throw new MoneyValidationError(String(value ?? ''), result)
  }

  return result.normalizedValue
}

/**
 * 使用持久化金额字符串计算折扣率。金额域最多保存四位小数，百分比统一按
 * ROUND_HALF_UP 保留两位；任一金额非法、缺失或参考金额为零时不伪造结果。
 */
export function resolveMoneyDiscountRate(
  actualAmount: MoneyAmount,
  referenceAmount: MoneyAmount,
): MoneyDiscountRate | null {
  const actualResult = validateMoneyString(actualAmount, { precision: 4 })
  const referenceResult = validateMoneyString(referenceAmount, { precision: 4 })

  if (
    !actualResult.valid
    || !referenceResult.valid
    || actualResult.normalizedValue === null
    || referenceResult.normalizedValue === null
  ) {
    return null
  }

  const actual = new Decimal(actualResult.normalizedValue)
  const reference = new Decimal(referenceResult.normalizedValue)
  if (reference.isZero()) {
    return null
  }

  return {
    formattedValue: `${actual
      .dividedBy(reference)
      .times(100)
      .toFixed(2, Decimal.ROUND_HALF_UP)}%`,
    trend: actual.lessThan(reference)
      ? 'below'
      : actual.greaterThan(reference) ? 'above' : 'equal',
  }
}

/** 兼容仅需要展示文本的调用方，趋势判断统一复用原始 Decimal 比较结果。 */
export function formatMoneyDiscountRate(
  actualAmount: MoneyAmount,
  referenceAmount: MoneyAmount,
): string | null {
  return resolveMoneyDiscountRate(actualAmount, referenceAmount)?.formattedValue ?? null
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
  const normalizedValues: string[] = []
  let maxIntegerDigits = 1

  for (const value of values) {
    if (value === null) {
      continue
    }

    const normalizedValue = normalizeMoneyString(value, {
      ...options,
      precision,
    })
    normalizedValues.push(normalizedValue)

    const unsignedValue = normalizedValue.startsWith('-')
      ? normalizedValue.slice(1)
      : normalizedValue
    const integerPart = unsignedValue.split('.')[0] ?? '0'
    const integerDigits = integerPart.replace(/^0+/u, '').length || 1
    maxIntegerDigits = Math.max(maxIntegerDigits, integerDigits)
  }

  /**
   * Decimal 的默认有效数字精度只有 20 位，直接连续 plus 会在大整数或多行进位时
   * 舍入。这里按当前批次的最大整数位、小数位和最大进位位数创建隔离构造器，
   * 既不污染 decimal.js 全局配置，也能覆盖该批次精确和的全部有效数字。
   */
  const carryDigits = normalizedValues.length > 1
    ? Math.ceil(Math.log10(normalizedValues.length))
    : 0
  const MoneyDecimal = Decimal.clone({
    precision: maxIntegerDigits + precision + carryDigits,
    rounding: Decimal.ROUND_HALF_UP,
  })
  let total = new MoneyDecimal(0)

  for (const value of normalizedValues) {
    total = total.plus(value)
  }

  return total.toFixed(precision, Decimal.ROUND_HALF_UP)
}
