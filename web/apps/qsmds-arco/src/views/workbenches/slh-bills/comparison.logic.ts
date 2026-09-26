import type { SlhBillFindingDto, SlhBillReportedDto, SlhBillTotalsDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'

/**
 * 对比把「明细行累加」与「账单自报」放在同一行、同一口径上，让核对结果一眼可判。
 *
 * 台币净额那一项两边口径可能不同：账单写的可能是折算后的人民币金额。有账单内嵌
 * 汇率时把我们的不折算净额折回同一口径再比（折回值放在 comparableComputed），
 * 而不是把两个不可比的数并排展示。
 */
export type SlhBillComparisonStatus = 'match' | 'mismatch' | 'unavailable'

export type SlhBillComparisonKey = 'payable' | 'codTwd' | 'ntdSurchargeTwd' | 'netTwd'

export interface SlhBillComparisonRow {
  key: SlhBillComparisonKey
  /** computed 的币种。 */
  currency: 'CNY' | 'TWD'
  /** 明细行累加值。 */
  computed: string
  /** 折回账单口径后的累加值；仅当两侧币种不同时有值。 */
  comparableComputed: string | null
  /** 账单自报值；账单没写这一项时为 null。 */
  reported: string | null
  /** reported 的币种；与 currency 不同表示账单换了口径。 */
  reportedCurrency: 'CNY' | 'TWD'
  /** 在 reportedCurrency 口径下的差额；账单没写或无法对齐口径时为 null。 */
  difference: string | null
  status: SlhBillComparisonStatus
}

export interface SlhBillSupportTotal {
  key: 'freight' | 'codHandling' | 'surcharge'
  value: string
}

export interface SlhBillComparison {
  rows: SlhBillComparisonRow[]
  /** 只有明细累加、账单不提供对应小计的支撑项。 */
  supportTotals: SlhBillSupportTotal[]
}

export interface SlhBillComparisonInput {
  totals: SlhBillTotalsDto
  reported: SlhBillReportedDto
  /** 账单公式里内嵌的汇率；有值时说明台币净额单元格是折算后的金额。 */
  embeddedForeignUnitsPerCny: string | null
}

function amount(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null
  }
  try {
    return new Decimal(value)
  }
  catch {
    return null
  }
}

const fixed = (value: Decimal) => value.toFixed(2)

export function buildSlhBillComparison(input: SlhBillComparisonInput): SlhBillComparison {
  const { totals, reported } = input
  const embeddedRate = amount(input.embeddedForeignUnitsPerCny)

  function row(config: {
    key: SlhBillComparisonKey
    currency: 'CNY' | 'TWD'
    computed: string
    /** 生成类型把可空字段标成可选，这里统一收敛成 null。 */
    reported: string | null | undefined
    reportedCurrency?: 'CNY' | 'TWD'
    /** 折回账单口径后的累加值；给出时才做同口径比较。 */
    comparableComputed?: Decimal | null
  }): SlhBillComparisonRow {
    const computed = amount(config.computed) ?? new Decimal(0)
    const reportedValue = config.reported == null ? null : amount(config.reported)
    const comparable = config.comparableComputed ?? computed
    const base: SlhBillComparisonRow = {
      key: config.key,
      currency: config.currency,
      computed: fixed(computed),
      comparableComputed: config.comparableComputed == null ? null : fixed(config.comparableComputed),
      reported: reportedValue === null ? null : fixed(reportedValue),
      reportedCurrency: config.reportedCurrency ?? config.currency,
      difference: null,
      status: 'unavailable',
    }
    if (reportedValue === null) {
      return base
    }
    const difference = reportedValue.minus(comparable)
    return {
      ...base,
      difference: fixed(difference),
      // 金额口径是两位小数，差额在同一精度下为零即视为一致。
      status: difference.toDecimalPlaces(2).isZero() ? 'match' : 'mismatch',
    }
  }

  // 账单把台币净额写成折算后的人民币金额时，把我们的不折算净额按同一汇率折回去比。
  const netTwd = amount(totals.reportedNetAmountTwd)
  const foldedNet = embeddedRate !== null && !embeddedRate.isZero() && netTwd !== null
    ? netTwd.dividedBy(embeddedRate).toDecimalPlaces(2)
    : null

  return {
    rows: [
      row({
        key: 'payable',
        currency: 'CNY',
        computed: totals.payableTotalAmountCny,
        reported: reported.subtotalPayableAmountCny,
      }),
      row({
        key: 'codTwd',
        currency: 'TWD',
        computed: totals.codTotalAmountTwd,
        reported: reported.subtotalCodAmountTwd,
      }),
      row({
        key: 'ntdSurchargeTwd',
        currency: 'TWD',
        computed: totals.ntdSurchargeTotalAmountTwd,
        reported: reported.subtotalNtdSurchargeAmountTwd,
      }),
      row({
        key: 'netTwd',
        currency: 'TWD',
        computed: totals.reportedNetAmountTwd,
        reported: reported.netAmountTwd,
        reportedCurrency: foldedNet === null ? 'TWD' : 'CNY',
        comparableComputed: foldedNet,
      }),
    ],
    supportTotals: [
      { key: 'freight', value: totals.freightTotalAmountCny },
      { key: 'codHandling', value: totals.codHandlingTotalAmountCny },
      { key: 'surcharge', value: totals.surchargeTotalAmountCny },
    ],
  }
}

export interface SlhBillFindingGroup {
  kind: SlhBillFindingDto['kind']
  severity: SlhBillFindingDto['severity']
  items: Array<{
    /** 账单内序号：用于把差异项定位到明细表的具体页。 */
    lineNumber: number | null
    /** 原表行号：与明细表「行号」列一致，供人核对。 */
    sourceRowNumber: number | null
    message: string
  }>
}

/** 按类型分组，便于逐类处理；组内保持行号升序，账单级的排在最前。 */
export function groupSlhBillFindings(findings: readonly SlhBillFindingDto[]): SlhBillFindingGroup[] {
  const groups = new Map<string, SlhBillFindingGroup>()
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.kind}`
    const group = groups.get(key) ?? { kind: finding.kind, severity: finding.severity, items: [] }
    group.items.push({
      lineNumber: finding.lineNumber ?? null,
      message: finding.message,
      sourceRowNumber: finding.sourceRowNumber ?? null,
    })
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({
    ...group,
    items: [...group.items].sort((left, right) => (left.sourceRowNumber ?? 0) - (right.sourceRowNumber ?? 0)),
  }))
}

export function countSlhBillFindings(findings: readonly SlhBillFindingDto[]): { difference: number, warning: number } {
  return findings.reduce((counts, finding) => {
    if (finding.severity === 'difference') {
      counts.difference += 1
    }
    else {
      counts.warning += 1
    }
    return counts
  }, { difference: 0, warning: 0 })
}

/** 问题行标黄：用单元格级背景，否则固定列与斑马纹的单元格背景会盖住行背景。 */
export const SLH_BILL_FLAGGED_ROW_CLASS = '[&>td]:bg-amber-50 dark:[&>td]:bg-amber-500/10'

/**
 * 汇总有差异或告警的原表行号，供明细表按行标黄。
 * 用原表行号而不是账单内序号：与界面上「行号」列一致，详情页也只有它能把账单级
 * 差异对应回具体明细行。
 */
export function collectSlhBillFlaggedRowNumbers(findings: readonly SlhBillFindingDto[]): Set<number> {
  return new Set(findings.flatMap(finding =>
    finding.sourceRowNumber === null || finding.sourceRowNumber === undefined ? [] : [finding.sourceRowNumber],
  ))
}

/** 明细行所在页码；用于从差异项跳到明细表对应页。 */
export function pageForSlhBillLine(lineNumber: number, pageSize: number): number {
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    return 1
  }
  return Math.floor((lineNumber - 1) / pageSize) + 1
}
