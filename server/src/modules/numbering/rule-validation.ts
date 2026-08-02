import {
  isPlainRecord,
  numberingSegmentOutputLength,
  parseNumberingSegment,
} from './segment-validation'
import {
  NUMBERING_RESET_POLICIES,
  type NumberingResetPolicy,
  type NumberingRuleConfig,
  NumberingRuleConfigError,
  type NumberingRuleConfigIssue,
  type NumberingRuleSegment,
} from './rule-types'

const RESET_POLICIES = new Set<string>(NUMBERING_RESET_POLICIES)
const CONFIG_KEYS = new Set(['resetPolicy', 'segments'])

interface DateGrain {
  readonly anyDate: boolean
  readonly fourDigitYear: boolean
  readonly twoDigitYear: boolean
  readonly month: boolean
  readonly day: boolean
}

export function calculateMaxOutputLength(config: NumberingRuleConfig): number {
  return config.segments.reduce(
    (total, segment) => total + numberingSegmentOutputLength(segment),
    0,
  )
}

function collectDateGrain(
  segments: readonly NumberingRuleSegment[],
): DateGrain {
  const grain = {
    anyDate: false,
    fourDigitYear: false,
    twoDigitYear: false,
    month: false,
    day: false,
  }

  for (const segment of segments) {
    if (segment.type !== 'DATE') {
      continue
    }

    grain.anyDate = true

    switch (segment.format) {
      case 'YYYY':
        grain.fourDigitYear = true
        break
      case 'YY':
        grain.twoDigitYear = true
        break
      case 'MM':
        grain.month = true
        break
      case 'DD':
        grain.day = true
        break
      case 'YYYYMM':
        grain.fourDigitYear = true
        grain.month = true
        break
      case 'YYYYMMDD':
        grain.fourDigitYear = true
        grain.month = true
        grain.day = true
        break
      case 'YYMMDD':
        grain.twoDigitYear = true
        grain.month = true
        grain.day = true
        break
    }
  }

  return grain
}

function validateDateGrain(
  resetPolicy: NumberingResetPolicy,
  segments: readonly NumberingRuleSegment[],
  pureRandom: boolean,
  issues: NumberingRuleConfigIssue[],
): void {
  const grain = collectDateGrain(segments)

  if (resetPolicy !== 'NEVER' && grain.twoDigitYear) {
    issues.push({
      path: 'segments',
      message: '非 NEVER 规则不允许 YY 或 YYMMDD',
    })
  }

  const includesResetGrain = resetPolicy === 'NEVER'
    || (
      grain.fourDigitYear
      && (resetPolicy === 'YEARLY' || grain.month)
      && (resetPolicy !== 'DAILY' || grain.day)
    )

  if (!includesResetGrain) {
    issues.push({
      path: 'segments',
      message: '日期片段不足以区分重置周期',
    })
  }

  if (!pureRandom) {
    return
  }

  const exactPureRandomGrain = resetPolicy === 'NEVER'
    ? !grain.anyDate
    : grain.fourDigitYear
      && !grain.twoDigitYear
      && (resetPolicy === 'YEARLY' ? !grain.month && !grain.day : true)
      && (resetPolicy === 'MONTHLY' ? grain.month && !grain.day : true)
      && (resetPolicy === 'DAILY' ? grain.month && grain.day : true)

  if (!exactPureRandomGrain) {
    issues.push({
      path: 'segments',
      message: '纯随机规则的日期变化粒度必须与重置周期完全一致',
    })
  }
}

function addUnknownConfigFieldIssues(
  input: Record<string, unknown>,
  issues: NumberingRuleConfigIssue[],
): void {
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.has(key)) {
      issues.push({ path: key, message: '不允许该字段' })
    }
  }
}

/**
 * 这是领域层的最终配置校验，不承担 HTTP 文本规范化。它接受 unknown 是为了
 * 让 DTO、数据库快照和预览都复用同一组不变量，同时返回重新构造的精确联合
 * 类型，防止调用方把额外字段带入 fingerprint 或渲染路径。
 */
export function validateNumberingRuleConfig(input: unknown): NumberingRuleConfig {
  const issues: NumberingRuleConfigIssue[] = []

  if (!isPlainRecord(input)) {
    throw new NumberingRuleConfigError([
      { path: '', message: '规则配置必须是对象' },
    ])
  }

  addUnknownConfigFieldIssues(input, issues)

  const resetPolicy = typeof input.resetPolicy === 'string'
    && RESET_POLICIES.has(input.resetPolicy)
    ? input.resetPolicy as NumberingResetPolicy
    : null

  if (resetPolicy === null) {
    issues.push({ path: 'resetPolicy', message: '重置策略不在白名单内' })
  }

  if (!Array.isArray(input.segments)) {
    issues.push({ path: 'segments', message: '片段必须是数组' })
    throw new NumberingRuleConfigError(issues)
  }

  if (input.segments.length < 1 || input.segments.length > 32) {
    issues.push({ path: 'segments', message: '片段数量必须为 1 到 32' })
  }

  const segments = input.segments
    .map((segment, index) => parseNumberingSegment(segment, index, issues))
    .filter((segment): segment is NumberingRuleSegment => segment !== null)
  const sequenceCount = input.segments.filter(
    (segment) => isPlainRecord(segment) && segment.type === 'SEQUENCE',
  ).length
  const randomCount = input.segments.filter(
    (segment) => isPlainRecord(segment) && segment.type === 'RANDOM',
  ).length

  if (sequenceCount + randomCount === 0) {
    issues.push({ path: 'segments', message: '必须包含序列或随机片段' })
  }

  if (sequenceCount > 1) {
    issues.push({ path: 'segments', message: '最多允许一个序列片段' })
  }

  if (randomCount > 1) {
    issues.push({ path: 'segments', message: '最多允许一个随机片段' })
  }

  if (segments.length === input.segments.length) {
    const maxOutputLength = segments.reduce(
      (total, segment) => total + numberingSegmentOutputLength(segment),
      0,
    )

    if (maxOutputLength < 1 || maxOutputLength > 64) {
      issues.push({ path: 'segments', message: '最大输出长度必须为 1 到 64' })
    }

    if (resetPolicy !== null) {
      validateDateGrain(
        resetPolicy,
        segments,
        sequenceCount === 0 && randomCount === 1,
        issues,
      )
    }
  }

  if (issues.length > 0 || resetPolicy === null) {
    throw new NumberingRuleConfigError(issues)
  }

  return { resetPolicy, segments }
}
