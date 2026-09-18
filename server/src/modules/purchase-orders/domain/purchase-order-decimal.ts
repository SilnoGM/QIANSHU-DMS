import type { PurchaseOrderPaymentStatus } from '../../../generated/prisma/enums'
import { purchaseOrderRuleFailure } from './purchase-order-errors'

const PURCHASE_ORDER_DECIMAL_SCALE = 100n
const PURCHASE_ORDER_MAX_AMOUNT_UNITS = 10n ** 28n - 1n
const PURCHASE_ORDER_USER_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const PURCHASE_ORDER_STORED_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2}0{0,2})?$/u
const PURCHASE_ORDER_SNAPSHOT_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,4})?$/u
const POSTGRES_INTEGER_MAX = 2_147_483_647

function invalidAmount(): never {
  return purchaseOrderRuleFailure(
    'PURCHASE_ORDER_AMOUNT_INVALID',
    '采购订单金额格式无效',
  )
}

function parseAmountUnits(value: unknown, pattern: RegExp): bigint {
  if (typeof value !== 'string' || !pattern.test(value)) return invalidAmount()
  const [integerPart = '', fractionPart = ''] = value.split('.')
  const units = BigInt(integerPart) * PURCHASE_ORDER_DECIMAL_SCALE
    + BigInt(fractionPart.padEnd(2, '0').slice(0, 2))
  if (units > PURCHASE_ORDER_MAX_AMOUNT_UNITS) return invalidAmount()
  return units
}

/**
 * 采购实际金额统一使用分，兼容旧存储补齐的零尾数但拒绝非零厘/毫。
 * 不对真实应付或实付静默舍入；产品参考成本与归档快照各走独立入口。
 */
export function parsePurchaseOrderAmountUnits(value: unknown): bigint {
  return parseAmountUnits(value, PURCHASE_ORDER_STORED_AMOUNT_PATTERN)
}

export function formatPurchaseOrderAmountUnits(value: bigint): string {
  if (value < 0n || value > PURCHASE_ORDER_MAX_AMOUNT_UNITS) {
    return invalidAmount()
  }
  const integerPart = value / PURCHASE_ORDER_DECIMAL_SCALE
  const fractionPart = (value % PURCHASE_ORDER_DECIMAL_SCALE)
    .toString()
    .padStart(2, '0')
  return `${integerPart}.${fractionPart}`
}

export function normalizePurchaseOrderAmount(value: unknown): string {
  return formatPurchaseOrderAmountUnits(
    parseAmountUnits(value, PURCHASE_ORDER_USER_AMOUNT_PATTERN),
  )
}

export function normalizePurchaseOrderSnapshotAmount(value: unknown): string {
  if (typeof value !== 'string' || !PURCHASE_ORDER_SNAPSHOT_AMOUNT_PATTERN.test(value)) return invalidAmount()
  const [integerPart, fractionPart = ''] = value.split('.')
  // 已归档图片 hash 使用四位规范化，不能因当前采购精度变更而重算旧身份。
  return `${integerPart}.${fractionPart.padEnd(4, '0')}`
}

/** 产品领域仍保留四位；仅新采购引用成本时按 HALF_UP 形成两位参考快照。 */
export function normalizePurchaseOrderReferenceAmount(value: unknown): string {
  const [integerPart, fractionPart] = normalizePurchaseOrderSnapshotAmount(value).split('.')
  const tenThousandths = BigInt(integerPart) * 10_000n + BigInt(fractionPart)
  return formatPurchaseOrderAmountUnits((tenThousandths + 50n) / 100n)
}

export function normalizePositivePurchaseOrderAmount(value: unknown): string {
  const units = parseAmountUnits(value, PURCHASE_ORDER_USER_AMOUNT_PATTERN)
  if (units === 0n) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_PAYMENT_AMOUNT_INVALID',
      '实际付款金额必须大于零',
    )
  }
  return formatPurchaseOrderAmountUnits(units)
}

export function normalizePurchaseOrderQuantity(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 1
    || value > POSTGRES_INTEGER_MAX
  ) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_QUANTITY_INVALID',
      '采购数量必须是正整数',
    )
  }
  return value
}

export function calculatePurchaseOrderLineTotal(
  actualPurchaseUnitPriceAmount: unknown,
  quantity: unknown,
): string {
  const unitPrice = parsePurchaseOrderAmountUnits(actualPurchaseUnitPriceAmount)
  const normalizedQuantity = normalizePurchaseOrderQuantity(quantity)
  return formatPurchaseOrderAmountUnits(unitPrice * BigInt(normalizedQuantity))
}

export function sumPurchaseOrderAmounts(values: readonly string[]): string {
  return formatPurchaseOrderAmountUnits(values.reduce(
    (sum, value) => sum + parsePurchaseOrderAmountUnits(value),
    0n,
  ))
}

export interface PurchaseOrderAgreedAmountsInput {
  readonly lineSubtotalAmount: unknown
  readonly purchaseTotalAmount: unknown
  readonly depositDueAmount: unknown
  readonly balanceDueAmount: unknown
}

export interface PurchaseOrderAgreedAmounts {
  readonly lineSubtotalAmount: string
  readonly purchaseTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
}

export function validatePurchaseOrderAgreedAmounts(
  input: PurchaseOrderAgreedAmountsInput,
): PurchaseOrderAgreedAmounts {
  const lineSubtotalUnits = parsePurchaseOrderAmountUnits(input.lineSubtotalAmount)
  const purchaseTotalUnits = parsePurchaseOrderAmountUnits(input.purchaseTotalAmount)
  const depositDueUnits = parsePurchaseOrderAmountUnits(input.depositDueAmount)
  const balanceDueUnits = parsePurchaseOrderAmountUnits(input.balanceDueAmount)

  if (lineSubtotalUnits !== purchaseTotalUnits) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_TOTAL_MISMATCH',
      '采购总价必须与产品明细汇总一致',
      'purchaseTotalAmount',
    )
  }
  if (depositDueUnits + balanceDueUnits !== purchaseTotalUnits) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_PAYMENT_TERMS_MISMATCH',
      '定金与尾款之和必须等于采购总价',
      'balanceDueAmount',
    )
  }

  return Object.freeze({
    lineSubtotalAmount: formatPurchaseOrderAmountUnits(lineSubtotalUnits),
    purchaseTotalAmount: formatPurchaseOrderAmountUnits(purchaseTotalUnits),
    depositDueAmount: formatPurchaseOrderAmountUnits(depositDueUnits),
    balanceDueAmount: formatPurchaseOrderAmountUnits(balanceDueUnits),
  })
}

export interface CustomPurchasePrices {
  readonly referencePurchaseUnitPriceAmount: string
  readonly actualPurchaseUnitPriceAmount: string
}

export function assertCustomPurchasePrices(
  referencePurchaseUnitPriceAmount: unknown,
  actualPurchaseUnitPriceAmount: unknown,
): CustomPurchasePrices {
  let reference: string
  let actual: string
  try {
    reference = normalizePurchaseOrderAmount(referencePurchaseUnitPriceAmount)
    actual = normalizePurchaseOrderAmount(actualPurchaseUnitPriceAmount)
  }
  catch {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_CUSTOM_PRICES_INVALID',
      '临时产品的采购定价和本单采购价必须手工填写且相等',
    )
  }
  if (reference !== actual) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_CUSTOM_PRICES_INVALID',
      '临时产品的采购定价和本单采购价必须手工填写且相等',
    )
  }
  return Object.freeze({
    referencePurchaseUnitPriceAmount: reference,
    actualPurchaseUnitPriceAmount: actual,
  })
}

export function derivePurchaseOrderPaymentStatus(
  purchaseTotalAmount: unknown,
  activePaidAmount: unknown,
): PurchaseOrderPaymentStatus {
  const totalUnits = parsePurchaseOrderAmountUnits(purchaseTotalAmount)
  const paidUnits = parsePurchaseOrderAmountUnits(activePaidAmount)
  if (paidUnits > totalUnits) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_PAYMENT_EXCEEDS_TOTAL',
      '累计实际付款不能超过采购总价',
    )
  }
  if (totalUnits === 0n || paidUnits === totalUnits) return 'PAID'
  return paidUnits === 0n ? 'UNPAID' : 'PARTIALLY_PAID'
}
