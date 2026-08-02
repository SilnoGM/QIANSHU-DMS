export const NUMBERING_RESET_POLICIES = [
  'NEVER',
  'YEARLY',
  'MONTHLY',
  'DAILY',
] as const

export type NumberingResetPolicy =
  (typeof NUMBERING_RESET_POLICIES)[number]

export const NUMBERING_DATE_FORMATS = [
  'YYYY',
  'YY',
  'MM',
  'DD',
  'YYYYMM',
  'YYYYMMDD',
  'YYMMDD',
] as const

export type NumberingDateFormat = (typeof NUMBERING_DATE_FORMATS)[number]

export const NUMBERING_RANDOM_MODES = [
  'LETTERS_THEN_DIGITS',
  'SHUFFLED',
] as const

export type NumberingRandomMode = (typeof NUMBERING_RANDOM_MODES)[number]

export interface NumberingFixedSegment {
  readonly type: 'FIXED'
  readonly value: string
}

export interface NumberingDateSegment {
  readonly type: 'DATE'
  readonly format: NumberingDateFormat
}

export interface NumberingSeparatorSegment {
  readonly type: 'SEPARATOR'
  readonly value: '-' | '_' | '.' | '/'
}

export interface NumberingSequenceSegment {
  readonly type: 'SEQUENCE'
  readonly width: number
  readonly startValue: string
  readonly step: string
}

export interface NumberingRandomSegment {
  readonly type: 'RANDOM'
  readonly letterLength: number
  readonly digitLength: number
  readonly mode: NumberingRandomMode
}

export type NumberingRuleSegment =
  | NumberingFixedSegment
  | NumberingDateSegment
  | NumberingSeparatorSegment
  | NumberingSequenceSegment
  | NumberingRandomSegment

export interface NumberingRuleConfig {
  readonly resetPolicy: NumberingResetPolicy
  readonly segments: readonly NumberingRuleSegment[]
}

export interface NumberingRuleConfigIssue {
  readonly path: string
  readonly message: string
}

/** 纯计算层错误只携带安全的字段问题，由 HTTP/内部服务边界映射稳定错误码。 */
export class NumberingRuleConfigError extends Error {
  readonly issues: readonly NumberingRuleConfigIssue[]

  constructor(issues: readonly NumberingRuleConfigIssue[]) {
    super('编号规则配置不合法')
    this.name = 'NumberingRuleConfigError'
    this.issues = issues
  }
}
