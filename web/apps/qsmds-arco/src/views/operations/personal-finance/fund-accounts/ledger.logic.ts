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
    badgeClass: 'bg-muted text-muted-foreground',
    amountClass: '!text-foreground',
  },
} as const
