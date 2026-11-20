import type { SalesOrderPaymentTermsRequestDto } from '@/api/generated/types.gen'

export interface SalesOrderPaymentTermsDraft {
  readonly depositDueAmount: string | null
  readonly reason: string
}

export type SalesOrderPaymentTermsBuildResult
  = | { readonly valid: true, readonly request: SalesOrderPaymentTermsRequestDto }
    | { readonly valid: false, readonly fieldErrors: Readonly<Record<string, string>> }

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const AMOUNT_SCALE = 2n

function amountUnits(value: string): bigint | null {
  if (!AMOUNT_PATTERN.test(value)) {
    return null
  }
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 10n ** AMOUNT_SCALE + BigInt(fraction.padEnd(2, '0'))
}

function formatUnits(units: bigint): string {
  const scale = 10n ** AMOUNT_SCALE
  return `${units / scale}.${(units % scale).toString().padStart(2, '0')}`
}

/**
 * 约定总价由产品明细决定，页面只允许调整定金与尾款的分配：
 * 尾款始终按「总价 − 定金」重算，避免出现三项金额不自洽的请求。
 */
export function buildSalesOrderPaymentTermsRequest(input: {
  readonly agreedTotalAmount: string
  readonly currentDepositDueAmount: string
  readonly draft: SalesOrderPaymentTermsDraft
}): SalesOrderPaymentTermsBuildResult {
  const fieldErrors: Record<string, string> = {}
  const agreedUnits = amountUnits(input.agreedTotalAmount)
  if (agreedUnits === null) {
    return { valid: false, fieldErrors: { agreedTotalAmount: '销售总价不可用，请刷新后重试' } }
  }
  const depositText = (input.draft.depositDueAmount ?? '').trim()
  const reason = input.draft.reason.trim()
  if (depositText.length === 0) {
    fieldErrors.depositDueAmount = '请填写约定定金'
  }
  const depositUnits = amountUnits(depositText)
  if (depositText.length > 0 && depositUnits === null) {
    fieldErrors.depositDueAmount = '请填写有效金额（最多两位小数）'
  }
  else if (depositUnits !== null && depositUnits > agreedUnits) {
    fieldErrors.depositDueAmount = '约定定金不能超过销售总价'
  }
  if (reason.length === 0) {
    fieldErrors.reason = '请填写本次修改原因'
  }
  else if ([...reason].length > 500) {
    fieldErrors.reason = '修改原因不能超过 500 个字符'
  }

  if (Object.keys(fieldErrors).length > 0 || depositUnits === null) {
    return { valid: false, fieldErrors }
  }
  return {
    valid: true,
    request: {
      agreedTotalAmount: formatUnits(agreedUnits),
      depositDueAmount: formatUnits(depositUnits),
      balanceDueAmount: formatUnits(agreedUnits - depositUnits),
      reason,
    },
  }
}

/** 表单回显用：尾款 = 约定总价 − 当前输入的定金；输入不合法时返回 null。 */
export function salesOrderPaymentTermsBalance(
  agreedTotalAmount: string,
  depositDueAmount: string | null,
): string | null {
  const agreedUnits = amountUnits(agreedTotalAmount)
  const depositText = (depositDueAmount ?? '').trim()
  const depositUnits = amountUnits(depositText)
  if (agreedUnits === null || depositText.length === 0 || depositUnits === null) {
    return null
  }
  if (depositUnits > agreedUnits) {
    return null
  }
  return formatUnits(agreedUnits - depositUnits)
}

/** 只比较金额；仅填写原因不构成可保存变更。 */
export function salesOrderPaymentTermsDraftChanged(
  currentDepositDueAmount: string,
  draft: SalesOrderPaymentTermsDraft,
): boolean {
  const currentUnits = amountUnits(currentDepositDueAmount)
  const draftUnits = amountUnits((draft.depositDueAmount ?? '').trim())
  if (currentUnits === null || draftUnits === null) {
    return false
  }
  return currentUnits !== draftUnits
}
