import type { PurchaseOrderAmountRevisionRequestDto, PurchaseOrderDetailDto } from '../../../api/generated/types.gen'

import Decimal from 'decimal.js'
import {
  normalizeMoneyString,
  sumMoneyValues,
  validateMoneyString,
} from '../../../components/base/MoneyInput/logic'

export interface PurchaseAmountRevisionPreview {
  readonly balanceDueAmount: string
  readonly changed: boolean
  readonly depositDueAmount: string
  readonly lineSubtotalAmount: string
  readonly lineTotals: Readonly<Record<string, string>>
  readonly purchaseTotalAmount: string
}

export interface PurchaseAmountRevisionRequestResult {
  readonly fieldError?: string
  readonly request?: PurchaseOrderAmountRevisionRequestDto
  readonly valid: boolean
}

const MONEY_OPTIONS = { precision: 2 } as const

function requireMoney(
  value: string | null,
  message: string,
): string {
  const result = validateMoneyString(value, MONEY_OPTIONS)
  if (!result.valid || result.normalizedValue === null) {
    throw new RangeError(message)
  }
  return result.normalizedValue
}

/**
 * 前端实时预览与提交共用同一套计算：行小计、产品合计、总价、尾款全部
 * 由新单价和手工定金推导，不读取或信任可被篡改的订单总额。
 */
export function calculatePurchaseAmountRevisionPreview(
  detail: PurchaseOrderDetailDto,
  linePrices: Readonly<Record<string, string | null>>,
  deposit: string | null,
): PurchaseAmountRevisionPreview {
  const lineTotals: Record<string, string> = {}
  for (const line of detail.lines) {
    const price = requireMoney(
      linePrices[line.id] ?? null,
      `请填写「${line.productName}」的实际采购单价`,
    )
    lineTotals[line.id] = new Decimal(price)
      .times(line.quantity)
      .toFixed(2, Decimal.ROUND_HALF_UP)
  }
  const lineSubtotalAmount = sumMoneyValues(
    Object.values(lineTotals),
    MONEY_OPTIONS,
  )
  const purchaseTotalAmount = lineSubtotalAmount
  const depositDueAmount = requireMoney(deposit, '请填写有效的定金')
  const total = new Decimal(purchaseTotalAmount)
  const depositValue = new Decimal(depositDueAmount)
  if (depositValue.greaterThan(total)) {
    throw new RangeError('定金不能超过采购总价')
  }
  const balanceDueAmount = total
    .minus(depositValue)
    .toFixed(2, Decimal.ROUND_HALF_UP)
  const changed = detail.lines.some(line => (
    requireMoney(linePrices[line.id] ?? null, '采购单价无效')
    !== normalizeMoneyString(line.actualPurchaseUnitPriceAmount, MONEY_OPTIONS)
  )) || depositDueAmount !== normalizeMoneyString(
    detail.amounts.depositDueAmount,
    MONEY_OPTIONS,
  )
  const orderAmountsChanged = lineSubtotalAmount !== normalizeMoneyString(
    detail.amounts.lineSubtotalAmount,
    MONEY_OPTIONS,
  ) || purchaseTotalAmount !== normalizeMoneyString(
    detail.amounts.purchaseTotalAmount,
    MONEY_OPTIONS,
  ) || depositDueAmount !== normalizeMoneyString(
    detail.amounts.depositDueAmount,
    MONEY_OPTIONS,
  ) || balanceDueAmount !== normalizeMoneyString(
    detail.amounts.balanceDueAmount,
    MONEY_OPTIONS,
  )
  if (changed && !orderAmountsChanged) {
    throw new RangeError(
      '行间调价但订单总额、定金和尾款未变化，当前修订记录无法保存；请调整总额或定金',
    )
  }
  return {
    balanceDueAmount,
    changed,
    depositDueAmount,
    lineSubtotalAmount,
    lineTotals,
    purchaseTotalAmount,
  }
}

export function buildPurchaseAmountRevisionRequest(
  detail: PurchaseOrderDetailDto,
  linePrices: Readonly<Record<string, string | null>>,
  deposit: string | null,
  reason: string,
): PurchaseAmountRevisionRequestResult {
  const normalizedReason = reason.trim()
  if (normalizedReason.length === 0) {
    return { fieldError: '请填写金额修订原因', valid: false }
  }
  if ([...normalizedReason].length > 500) {
    return { fieldError: '金额修订原因最多 500 个字符', valid: false }
  }
  try {
    const preview = calculatePurchaseAmountRevisionPreview(
      detail,
      linePrices,
      deposit,
    )
    if (!preview.changed) {
      return { fieldError: '采购金额没有变化，无需提交', valid: false }
    }
    return {
      request: {
        expectedVersion: detail.version,
        reason: normalizedReason,
        depositDueAmount: preview.depositDueAmount,
        lines: detail.lines.map(line => ({
          lineId: line.id,
          actualUnitPriceAmount: requireMoney(
            linePrices[line.id] ?? null,
            '采购单价无效',
          ),
        })),
      },
      valid: true,
    }
  }
  catch (error) {
    return {
      fieldError: error instanceof RangeError
        ? error.message
        : '采购金额信息无效，请检查后重试',
      valid: false,
    }
  }
}
