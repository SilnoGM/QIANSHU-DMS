import {
  calculateRuleCapacity,
  calculateSequenceState,
  parseNonNegativeDecimal,
} from './capacity'
import {
  getNumberingPeriodKey,
  NUMBERING_TIMEZONE,
} from './period'
import type { NumberingRandomSource } from './random-source'
import { renderNumberingCandidate } from './renderer'
import {
  calculateMaxOutputLength,
  validateNumberingRuleConfig,
} from './rule-validation'
import type { NumberingSequenceSegment } from './rule-types'

export interface NumberingPreviewInput {
  readonly config: unknown
  readonly databaseTime: Date
  readonly usedCount: string | bigint
  readonly randomSource?: NumberingRandomSource
}

export interface NumberingPreviewResult {
  readonly timezone: typeof NUMBERING_TIMEZONE
  readonly periodKey: string
  readonly maxOutputLength: number
  readonly capacity: string
  readonly usedCount: string
  readonly remainingCount: string
  readonly nextSequenceValue: string | null
  readonly nextNumberPreview: string | null
  readonly nextNumberDeterministic: boolean
  readonly periodStatus: 'AVAILABLE' | 'EXHAUSTED'
  readonly samples: readonly string[]
}

/**
 * Preview 只依据传入快照计算结果，不持有 period state，也没有任何写入端口。
 * sequence-bearing 和 pure-random 都从当前剩余空间取最多五个样例；耗尽时
 * 返回空数组，避免展示已经不可分配或虚构的候选值。
 */
export function previewNumberingRule(
  input: NumberingPreviewInput,
): NumberingPreviewResult {
  const config = validateNumberingRuleConfig(input.config)
  const usedCount = parseNonNegativeDecimal(input.usedCount)
  const capacity = calculateRuleCapacity(config)
  const remainingCount = usedCount >= capacity ? 0n : capacity - usedCount
  const sequence = config.segments.find(
    (segment): segment is NumberingSequenceSegment =>
      segment.type === 'SEQUENCE',
  )
  const hasRandom = config.segments.some((segment) => segment.type === 'RANDOM')
  const sequenceState = sequence === undefined
    ? null
    : calculateSequenceState(sequence, usedCount)
  const sampleCount = Number(remainingCount < 5n ? remainingCount : 5n)
  const samples: string[] = []

  for (let index = 0; index < sampleCount; index += 1) {
    const sequenceValue = sequence === undefined
      || sequenceState === null
      || sequenceState.nextSequenceValue === null
      ? null
      : sequenceState.nextSequenceValue + BigInt(index) * BigInt(sequence.step)

    samples.push(renderNumberingCandidate(
      config,
      input.databaseTime,
      sequenceValue,
      input.randomSource,
    ))
  }

  const nextSequenceValue = sequenceState?.nextSequenceValue ?? null
  const nextNumberPreview = sequence === undefined || nextSequenceValue === null
    ? null
    : samples[0] ?? null

  return {
    timezone: NUMBERING_TIMEZONE,
    periodKey: getNumberingPeriodKey(config.resetPolicy, input.databaseTime),
    maxOutputLength: calculateMaxOutputLength(config),
    capacity: capacity.toString(),
    usedCount: usedCount.toString(),
    remainingCount: remainingCount.toString(),
    nextSequenceValue: nextSequenceValue?.toString() ?? null,
    nextNumberPreview,
    nextNumberDeterministic: !hasRandom,
    periodStatus: remainingCount === 0n ? 'EXHAUSTED' : 'AVAILABLE',
    samples,
  }
}
