const paymentMethodClasses: Record<string, string> = {
  BANK_TRANSFER: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  CASH: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  CHECK: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  LETTER_OF_CREDIT: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
}

export function paymentMethodClass(value: string): string {
  // 按字典稳定值配色，名称变更不改变同一收款方式的颜色。
  return paymentMethodClasses[value] ?? 'border-border bg-muted text-muted-foreground'
}

/** 仅简化展示精度，不经浮点转换；原始快照由调用方保留用于追溯。 */
export function formatReceiptDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  return value.includes('.') ? value.replace(/0+$/u, '').replace(/\.$/u, '') : value
}

/** 金额契约为十进制字符串，直接判定有效数字以保留极小值和负零语义。 */
export function receiptAmountClass(value: string): string {
  if (!/[1-9]/u.test(value)) {
    return 'text-foreground'
  }
  return value.startsWith('-') ? 'text-destructive' : 'text-primary'
}
