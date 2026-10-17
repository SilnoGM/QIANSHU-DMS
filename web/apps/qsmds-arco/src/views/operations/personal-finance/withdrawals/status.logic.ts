export const FUND_WITHDRAWAL_STATUS_VALUES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type FundWithdrawalStatusValue = (typeof FUND_WITHDRAWAL_STATUS_VALUES)[number]

export const FUND_WITHDRAWAL_STATUS_META = {
  PENDING: {
    labelKey: 'fundWithdrawal.status.PENDING',
    tagClass: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
  },
  APPROVED: {
    labelKey: 'fundWithdrawal.status.APPROVED',
    tagClass: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
  },
  REJECTED: {
    labelKey: 'fundWithdrawal.status.REJECTED',
    tagClass: 'border-destructive/30 bg-destructive/5 text-destructive',
  },
} as const satisfies Record<FundWithdrawalStatusValue, { labelKey: string, tagClass: string }>

export const FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS = [
  { value: 'ALL', labelKey: 'fundWithdrawal.status.ALL' },
  ...FUND_WITHDRAWAL_STATUS_VALUES.map(value => ({
    value,
    labelKey: FUND_WITHDRAWAL_STATUS_META[value].labelKey,
  })),
] as const

export function withdrawalStatusMeta(status: FundWithdrawalStatusValue) {
  return FUND_WITHDRAWAL_STATUS_META[status]
}
