import type {
  PurchaseOrderAmountRevisionRequestDto,
  PurchaseOrderDetailDto,
} from '../../../api/generated/types.gen'

import Decimal from 'decimal.js'
import {
  normalizeMoneyString,
  sumMoneyValues,
  validateMoneyString,
} from '../../base/MoneyInput/logic'
import {
  QS_GENERIC_MODAL_DEFAULT_Z_INDEX,
} from '../QsGenericModal/logic'

/**
 * 本弹窗可能从采购详情抽屉（FaDrawer，默认 2000）内部打开，必须压在抽屉及其
 * 遮罩之上。全站浮层默认同为 2000，平级时的绘制顺序由 Teleport 在页面加载时的
 * 挂载顺序决定，与本弹窗、抽屉谁先打开无关；这里显式抬高 100 层，不再依赖模板
 * 声明顺序。
 *
 * 因此该弹窗内不要再放 FaSelect、FaDropdown 等同样是 2000 的浮层，否则它们会
 * 掉到弹窗下面。
 */
export const PURCHASE_AMOUNT_REVISION_MODAL_Z_INDEX
  = QS_GENERIC_MODAL_DEFAULT_Z_INDEX + 100

export interface PurchaseAmountRevisionPreview {
  readonly balanceDueAmount: string
  readonly changed: boolean
  readonly changedLineCount: number
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

export interface PurchaseAmountRevisionOptions {
  /**
   * 定金已有有效付款时必须锁定为服务端当前定金：单价可以调整，但总价不得低于
   * 已付定金。此时错误提示不再引导用户改定金，而是调整单价或先作废付款。
   */
  readonly depositLocked?: boolean
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
 * 由新单价和定金推导，不读取或信任可被篡改的订单总额。
 *
 * 行间调价可能保持订单总额、定金和尾款完全不变；这仍然是有效修订，
 * 由服务端写入行级变更快照，因此这里不再拒绝"仅行单价变化"。
 */
export function calculatePurchaseAmountRevisionPreview(
  detail: PurchaseOrderDetailDto,
  linePrices: Readonly<Record<string, string | null>>,
  deposit: string | null,
  options: PurchaseAmountRevisionOptions = {},
): PurchaseAmountRevisionPreview {
  const lineTotals: Record<string, string> = {}
  let changedLineCount = 0
  for (const line of detail.lines) {
    const price = requireMoney(
      linePrices[line.id] ?? null,
      `请填写「${line.productName}」的实际采购单价`,
    )
    lineTotals[line.id] = new Decimal(price)
      .times(line.quantity)
      .toFixed(2, Decimal.ROUND_HALF_UP)
    if (price !== normalizeMoneyString(
      line.actualPurchaseUnitPriceAmount,
      MONEY_OPTIONS,
    )) {
      changedLineCount += 1
    }
  }
  const lineSubtotalAmount = sumMoneyValues(
    Object.values(lineTotals),
    MONEY_OPTIONS,
  )
  const purchaseTotalAmount = lineSubtotalAmount
  const depositDueAmount = requireMoney(
    deposit,
    options.depositLocked
      ? '已付定金无效，请刷新后重试'
      : '请填写有效的定金',
  )
  const total = new Decimal(purchaseTotalAmount)
  const depositValue = new Decimal(depositDueAmount)
  if (depositValue.greaterThan(total)) {
    throw new RangeError(
      options.depositLocked
        ? '新采购总价不能低于已付定金；请调整单价，或先作废定金付款后再改价'
        : '定金不能超过采购总价',
    )
  }
  const balanceDueAmount = total
    .minus(depositValue)
    .toFixed(2, Decimal.ROUND_HALF_UP)
  const depositChanged = depositDueAmount !== normalizeMoneyString(
    detail.amounts.depositDueAmount,
    MONEY_OPTIONS,
  )
  const changed = changedLineCount > 0 || depositChanged
  return {
    balanceDueAmount,
    changed,
    changedLineCount,
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
  options: PurchaseAmountRevisionOptions = {},
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
      options,
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
