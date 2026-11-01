/**
 * 流水表的类目视觉映射。
 *
 * 这里只放稳定的图标、文案键与色调样式；金额、明细和权限仍由页面处理。
 * 未登记的新类目不会进入表格（类型已限定为四个服务端枚举值）。
 */
export const LEDGER_CATEGORY_META = {
  REVENUE: {
    icon: 'i-lucide:trending-up',
    labelKey: 'personalFinanceLedger.category.REVENUE',
    tileClass: 'qs-ledger-positive-tile',
  },
  COST: {
    icon: 'i-lucide:shopping-cart',
    labelKey: 'personalFinanceLedger.category.COST',
    tileClass: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
  },
  ADJUSTMENT: {
    icon: 'i-lucide:sliders-horizontal',
    labelKey: 'personalFinanceLedger.category.ADJUSTMENT',
    tileClass: 'bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300',
  },
  NEUTRAL: {
    icon: 'i-lucide:circle',
    labelKey: 'personalFinanceLedger.category.NEUTRAL',
    tileClass: 'bg-muted text-muted-foreground',
  },
} as const

/** 正常业务批次不显示胶囊，避免每行都出现无意义标签。 */
export const LEDGER_BATCH_KIND_META = {
  BUSINESS: null,
  REVERSAL: {
    labelKey: 'personalFinanceLedger.batchKind.REVERSAL',
    pillClass: 'border-destructive/30 bg-destructive/5 text-destructive',
  },
  MANUAL_ADJUSTMENT: {
    labelKey: 'personalFinanceLedger.batchKind.MANUAL_ADJUSTMENT',
    pillClass: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-300',
  },
} as const

/** 未发生冲账或冲账状态不适用的行不显示标签。 */
export const LEDGER_REVERSAL_META = {
  NONE: null,
  NOT_APPLICABLE: null,
  PARTIAL: {
    labelKey: 'personalFinanceLedger.reversal.PARTIAL',
    pillClass: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
  },
  FULL: {
    labelKey: 'personalFinanceLedger.reversal.FULL',
    pillClass: 'border-destructive/30 bg-destructive/5 text-destructive',
  },
} as const

export const LEDGER_DIRECTION_META = {
  CREDIT: {
    labelKey: 'personalFinanceLedger.direction.CREDIT',
    badgeClass: 'qs-ledger-positive-badge',
    amountClass: 'qs-ledger-positive',
  },
  DEBIT: {
    labelKey: 'personalFinanceLedger.direction.DEBIT',
    badgeClass: 'bg-destructive/10 text-destructive',
    amountClass: '!text-destructive',
  },
} as const

/** 表格与详情弹窗共用同一带符号金额口径，避免两处出现正负号差异。 */
export function ledgerSignedAmount(
  direction: keyof typeof LEDGER_DIRECTION_META,
  amount: string,
): string {
  return direction === 'DEBIT' ? `-${amount}` : amount
}

const LEDGER_MINOR_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u

function ledgerMinor(value: string): bigint {
  if (!LEDGER_MINOR_PATTERN.test(value)) {
    throw new RangeError('流水金额格式无效')
  }
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

function ledgerMinorText(minor: bigint): string {
  const negative = minor < 0n
  const absolute = negative ? -minor : minor
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

export interface LedgerShareSplit {
  /** 本人分录承担金额。 */
  readonly mine: string
  /** 公司承担金额；单腿规则（提款）为 0。 */
  readonly company: string
  readonly split: boolean
}

/**
 * 「我的部分 / 公司部分」：本人分录金额就是本人承担部分，公司部分是业务总额的剩余。
 *
 * 单腿规则（USER_WITHDRAWAL）业务总额等于本人金额，公司部分为 0；不能按比例硬乘，
 * 否则提款会被误读成公司也分摊了成本。全程用整数分计算，避免浮点误差。
 */
export function ledgerShareSplit(input: {
  readonly amount: string
  readonly businessAmount: string
}): LedgerShareSplit {
  const mine = ledgerMinor(input.amount)
  const total = ledgerMinor(input.businessAmount.replace(/^-/u, ''))
  const company = total > mine ? total - mine : 0n
  return Object.freeze({
    mine: ledgerMinorText(mine),
    company: ledgerMinorText(company),
    split: company > 0n,
  })
}
