import type {
  NumberingRandomSegment,
  NumberingRuleConfig,
  NumberingSequenceSegment,
} from './rule-types'

const NON_NEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/u

export interface NumberingSequenceState {
  readonly capacity: bigint
  readonly usedCount: bigint
  readonly remainingCount: bigint
  readonly nextSequenceValue: bigint | null
  readonly exhausted: boolean
}

/**
 * 所有计数边界都先转换成 bigint。这里刻意不接受 number，避免调用方先把
 * 数据库 bigint 或公共 decimal string 转成浮点数后，才进入“精确计算”。
 */
export function parseNonNegativeDecimal(value: string | bigint): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new RangeError('计数不能为负数')
    }

    return value
  }

  if (!NON_NEGATIVE_DECIMAL_PATTERN.test(value)) {
    throw new RangeError('计数必须是规范的非负十进制字符串')
  }

  return BigInt(value)
}

function sequenceMaximum(width: number): bigint {
  if (!Number.isInteger(width) || width < 1 || width > 18) {
    throw new RangeError('序列宽度必须为 1 到 18')
  }

  return 10n ** BigInt(width) - 1n
}

function readSequenceOperands(segment: NumberingSequenceSegment): {
  readonly maximum: bigint
  readonly start: bigint
  readonly step: bigint
} {
  const maximum = sequenceMaximum(segment.width)
  const start = parseNonNegativeDecimal(segment.startValue)
  const step = parseNonNegativeDecimal(segment.step)

  if (start > maximum || step < 1n || step > maximum) {
    throw new RangeError('序列起始值或步长超出当前宽度')
  }

  return { maximum, start, step }
}

export function calculateSequenceCapacity(
  segment: NumberingSequenceSegment,
): bigint {
  const { maximum, start, step } = readSequenceOperands(segment)
  return (maximum - start) / step + 1n
}

/**
 * 耗尽判断使用 usedCount 重新推导下一值，而不是依赖可回绕的机器整数。
 * 即使数据库因异常带入大于容量的 usedCount，对外剩余量仍安全收口为 0。
 */
export function calculateSequenceState(
  segment: NumberingSequenceSegment,
  usedCountInput: string | bigint,
): NumberingSequenceState {
  const usedCount = parseNonNegativeDecimal(usedCountInput)
  const { maximum, start, step } = readSequenceOperands(segment)
  const capacity = (maximum - start) / step + 1n
  const remainingCount = usedCount >= capacity
    ? 0n
    : capacity - usedCount
  const candidate = start + usedCount * step
  const exhausted = remainingCount === 0n || candidate > maximum

  return {
    capacity,
    usedCount,
    remainingCount,
    nextSequenceValue: exhausted ? null : candidate,
    exhausted,
  }
}

export function formatSequenceValue(
  segment: NumberingSequenceSegment,
  valueInput: string | bigint,
): string {
  const value = parseNonNegativeDecimal(valueInput)
  const { maximum, start, step } = readSequenceOperands(segment)

  if (
    value < start
    || value > maximum
    || (value - start) % step !== 0n
  ) {
    throw new RangeError('序列值不属于当前序列空间')
  }

  return value.toString().padStart(segment.width, '0')
}

function binomial(n: number, k: number): bigint {
  const smallerK = Math.min(k, n - k)
  let result = 1n

  // 每一步先乘后除，并利用组合数递推保证整除；中间值也始终是 bigint。
  for (let index = 1; index <= smallerK; index += 1) {
    result = result * BigInt(n - smallerK + index) / BigInt(index)
  }

  return result
}

export function calculateRandomCapacity(
  segment: NumberingRandomSegment,
): bigint {
  const { letterLength, digitLength } = segment

  if (
    !Number.isInteger(letterLength)
    || !Number.isInteger(digitLength)
    || letterLength < 0
    || letterLength > 32
    || digitLength < 0
    || digitLength > 32
    || letterLength + digitLength < 1
    || letterLength + digitLength > 32
    || !['LETTERS_THEN_DIGITS', 'SHUFFLED'].includes(segment.mode)
  ) {
    throw new RangeError('随机片段长度不合法')
  }

  const symbolCapacity = 26n ** BigInt(letterLength)
    * 10n ** BigInt(digitLength)

  return segment.mode === 'SHUFFLED'
    ? binomial(letterLength + digitLength, letterLength) * symbolCapacity
    : symbolCapacity
}

export function calculateRuleCapacity(config: NumberingRuleConfig): bigint {
  const sequence = config.segments.find(
    (segment): segment is NumberingSequenceSegment =>
      segment.type === 'SEQUENCE',
  )

  if (sequence !== undefined) {
    return calculateSequenceCapacity(sequence)
  }

  const random = config.segments.find(
    (segment): segment is NumberingRandomSegment =>
      segment.type === 'RANDOM',
  )

  if (random === undefined) {
    throw new RangeError('规则必须包含序列或随机容量片段')
  }

  return calculateRandomCapacity(random)
}
