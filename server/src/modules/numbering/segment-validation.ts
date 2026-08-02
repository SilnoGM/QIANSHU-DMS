import {
  NUMBERING_DATE_FORMATS,
  NUMBERING_RANDOM_MODES,
  type NumberingDateFormat,
  type NumberingDateSegment,
  type NumberingFixedSegment,
  type NumberingRandomMode,
  type NumberingRandomSegment,
  type NumberingRuleConfigIssue,
  type NumberingRuleSegment,
  type NumberingSeparatorSegment,
  type NumberingSequenceSegment,
} from './rule-types'

const FIXED_PATTERN = /^[A-Z0-9]{1,64}$/u
const CANONICAL_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/u
const SEPARATORS = new Set(['-', '_', '.', '/'])
const DATE_FORMATS = new Set<string>(NUMBERING_DATE_FORMATS)
const RANDOM_MODES = new Set<string>(NUMBERING_RANDOM_MODES)
const FIXED_KEYS = new Set(['type', 'value'])
const DATE_KEYS = new Set(['type', 'format'])
const SEQUENCE_KEYS = new Set(['type', 'width', 'startValue', 'step'])
const RANDOM_KEYS = new Set([
  'type',
  'letterLength',
  'digitLength',
  'mode',
])

const DATE_OUTPUT_LENGTH: Readonly<Record<NumberingDateFormat, number>> = {
  YYYY: 4,
  YY: 2,
  MM: 2,
  DD: 2,
  YYYYMM: 6,
  YYYYMMDD: 8,
  YYMMDD: 6,
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addUnexpectedKeyIssues(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  basePath: string,
  issues: NumberingRuleConfigIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({ path: `${basePath}.${key}`, message: '不允许该字段' })
    }
  }
}

function addSegmentSummaryIssue(
  basePath: string,
  beforeIssueCount: number,
  issues: NumberingRuleConfigIssue[],
): void {
  if (issues.length > beforeIssueCount) {
    issues.push({ path: basePath, message: '片段配置不合法' })
  }
}

function parseFixedSegment(
  value: Record<string, unknown>,
  basePath: string,
  issues: NumberingRuleConfigIssue[],
): NumberingFixedSegment | null {
  const beforeIssueCount = issues.length
  addUnexpectedKeyIssues(value, FIXED_KEYS, basePath, issues)

  if (typeof value.value !== 'string' || !FIXED_PATTERN.test(value.value)) {
    issues.push({
      path: `${basePath}.value`,
      message: '必须是 1 到 64 位大写英文字母或数字',
    })
  }

  addSegmentSummaryIssue(basePath, beforeIssueCount, issues)
  return issues.length === beforeIssueCount
    ? { type: 'FIXED', value: value.value as string }
    : null
}

function parseDateSegment(
  value: Record<string, unknown>,
  basePath: string,
  issues: NumberingRuleConfigIssue[],
): NumberingDateSegment | null {
  const beforeIssueCount = issues.length
  addUnexpectedKeyIssues(value, DATE_KEYS, basePath, issues)

  if (typeof value.format !== 'string' || !DATE_FORMATS.has(value.format)) {
    issues.push({ path: `${basePath}.format`, message: '日期格式不在白名单内' })
  }

  addSegmentSummaryIssue(basePath, beforeIssueCount, issues)
  return issues.length === beforeIssueCount
    ? { type: 'DATE', format: value.format as NumberingDateFormat }
    : null
}

function parseSeparatorSegment(
  value: Record<string, unknown>,
  basePath: string,
  issues: NumberingRuleConfigIssue[],
): NumberingSeparatorSegment | null {
  const beforeIssueCount = issues.length
  addUnexpectedKeyIssues(value, FIXED_KEYS, basePath, issues)

  if (typeof value.value !== 'string' || !SEPARATORS.has(value.value)) {
    issues.push({
      path: `${basePath}.value`,
      message: '分隔符只允许 -、_、. 或 /',
    })
  }

  addSegmentSummaryIssue(basePath, beforeIssueCount, issues)
  return issues.length === beforeIssueCount
    ? {
        type: 'SEPARATOR',
        value: value.value as NumberingSeparatorSegment['value'],
      }
    : null
}

function parseSequenceSegment(
  value: Record<string, unknown>,
  basePath: string,
  issues: NumberingRuleConfigIssue[],
): NumberingSequenceSegment | null {
  const beforeIssueCount = issues.length
  addUnexpectedKeyIssues(value, SEQUENCE_KEYS, basePath, issues)

  if (
    typeof value.width !== 'number'
    || !Number.isInteger(value.width)
    || value.width < 1
    || value.width > 18
  ) {
    issues.push({ path: `${basePath}.width`, message: '宽度必须为 1 到 18' })
  }

  for (const field of ['startValue', 'step'] as const) {
    if (
      typeof value[field] !== 'string'
      || !CANONICAL_DECIMAL_PATTERN.test(value[field])
    ) {
      issues.push({
        path: `${basePath}.${field}`,
        message: '必须是规范的非负十进制字符串',
      })
    }
  }

  if (
    typeof value.width === 'number'
    && Number.isInteger(value.width)
    && value.width >= 1
    && value.width <= 18
    && typeof value.startValue === 'string'
    && CANONICAL_DECIMAL_PATTERN.test(value.startValue)
    && typeof value.step === 'string'
    && CANONICAL_DECIMAL_PATTERN.test(value.step)
  ) {
    const maximum = 10n ** BigInt(value.width) - 1n
    const start = BigInt(value.startValue)
    const step = BigInt(value.step)

    if (start > maximum) {
      issues.push({
        path: `${basePath}.startValue`,
        message: '起始值超出当前宽度',
      })
    }

    if (step < 1n || step > maximum) {
      issues.push({
        path: `${basePath}.step`,
        message: '步长必须为正且不能超出当前宽度',
      })
    }
  }

  addSegmentSummaryIssue(basePath, beforeIssueCount, issues)
  return issues.length === beforeIssueCount
    ? {
        type: 'SEQUENCE',
        width: value.width as number,
        startValue: value.startValue as string,
        step: value.step as string,
      }
    : null
}

function parseRandomSegment(
  value: Record<string, unknown>,
  basePath: string,
  issues: NumberingRuleConfigIssue[],
): NumberingRandomSegment | null {
  const beforeIssueCount = issues.length
  addUnexpectedKeyIssues(value, RANDOM_KEYS, basePath, issues)

  for (const field of ['letterLength', 'digitLength'] as const) {
    if (
      typeof value[field] !== 'number'
      || !Number.isInteger(value[field])
      || value[field] < 0
      || value[field] > 32
    ) {
      issues.push({
        path: `${basePath}.${field}`,
        message: '长度必须为 0 到 32',
      })
    }
  }

  if (typeof value.mode !== 'string' || !RANDOM_MODES.has(value.mode)) {
    issues.push({ path: `${basePath}.mode`, message: '随机模式不在白名单内' })
  }

  if (
    typeof value.letterLength === 'number'
    && Number.isInteger(value.letterLength)
    && typeof value.digitLength === 'number'
    && Number.isInteger(value.digitLength)
  ) {
    const totalLength = value.letterLength + value.digitLength
    if (totalLength < 1 || totalLength > 32) {
      issues.push({
        path: basePath,
        message: '随机片段总长度必须为 1 到 32',
      })
    }
  }

  addSegmentSummaryIssue(basePath, beforeIssueCount, issues)
  return issues.length === beforeIssueCount
    ? {
        type: 'RANDOM',
        letterLength: value.letterLength as number,
        digitLength: value.digitLength as number,
        mode: value.mode as NumberingRandomMode,
      }
    : null
}

/** 每类 parser 都重建对象，因此未知字段不会进入 fingerprint 或渲染路径。 */
export function parseNumberingSegment(
  value: unknown,
  index: number,
  issues: NumberingRuleConfigIssue[],
): NumberingRuleSegment | null {
  const basePath = `segments[${index}]`

  if (!isPlainRecord(value)) {
    issues.push({ path: basePath, message: '片段必须是对象' })
    return null
  }

  switch (value.type) {
    case 'FIXED':
      return parseFixedSegment(value, basePath, issues)
    case 'DATE':
      return parseDateSegment(value, basePath, issues)
    case 'SEPARATOR':
      return parseSeparatorSegment(value, basePath, issues)
    case 'SEQUENCE':
      return parseSequenceSegment(value, basePath, issues)
    case 'RANDOM':
      return parseRandomSegment(value, basePath, issues)
    default:
      issues.push({ path: `${basePath}.type`, message: '片段类型不在白名单内' })
      return null
  }
}

export function numberingSegmentOutputLength(
  segment: NumberingRuleSegment,
): number {
  switch (segment.type) {
    case 'FIXED':
      return [...segment.value].length
    case 'DATE':
      return DATE_OUTPUT_LENGTH[segment.format]
    case 'SEPARATOR':
      return 1
    case 'SEQUENCE':
      return segment.width
    case 'RANDOM':
      return segment.letterLength + segment.digitLength
  }
}
