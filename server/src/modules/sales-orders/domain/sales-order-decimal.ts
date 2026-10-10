import type { SalesOrderPaymentStatus } from '../../../generated/prisma/enums'
import { salesOrderRuleFailure } from './sales-order-errors'

const SALES_ORDER_DECIMAL_SCALE = 10_000n
const SALES_ORDER_MAX_AMOUNT_UNITS = 10n ** 30n - 1n
const SALES_ORDER_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,4})?$/u
const POSTGRES_INTEGER_MAX = 2_147_483_647

function invalidAmount(): never {
  return salesOrderRuleFailure(
    'SALES_ORDER_AMOUNT_INVALID',
    '销售订单金额格式无效',
  )
}

/**
 * 订单金额始终以四位最小单位参与运算。输入只接受规范十进制字符串，避免 number
 * 在进入领域层之前已经发生精度损失。
 */
export function parseSalesOrderAmountUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !SALES_ORDER_AMOUNT_PATTERN.test(value)) {
    return invalidAmount()
  }
  const [integerPart = '', fractionPart = ''] = value.split('.')
  const units = BigInt(integerPart) * SALES_ORDER_DECIMAL_SCALE
    + BigInt(fractionPart.padEnd(4, '0'))
  if (units > SALES_ORDER_MAX_AMOUNT_UNITS) return invalidAmount()
  return units
}

export function formatSalesOrderAmountUnits(value: bigint): string {
  if (value < 0n || value > SALES_ORDER_MAX_AMOUNT_UNITS) {
    return invalidAmount()
  }
  const integerPart = value / SALES_ORDER_DECIMAL_SCALE
  const fractionPart = (value % SALES_ORDER_DECIMAL_SCALE)
    .toString()
    .padStart(4, '0')
  return `${integerPart}.${fractionPart}`
}

export function normalizeSalesOrderAmount(value: unknown): string {
  return formatSalesOrderAmountUnits(parseSalesOrderAmountUnits(value))
}

export function normalizePositiveSalesOrderAmount(value: unknown): string {
  const units = parseSalesOrderAmountUnits(value)
  if (units === 0n) {
    return salesOrderRuleFailure(
      'SALES_ORDER_PAYMENT_AMOUNT_INVALID',
      '实际收款金额必须大于零',
    )
  }
  return formatSalesOrderAmountUnits(units)
}

export function normalizeSalesOrderQuantity(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 1
    || value > POSTGRES_INTEGER_MAX
  ) {
    return salesOrderRuleFailure(
      'SALES_ORDER_QUANTITY_INVALID',
      '产品数量必须是正整数',
    )
  }
  return value
}

export function calculateSalesOrderLineTotal(
  actualUnitPriceAmount: unknown,
  quantity: unknown,
): string {
  const unitPrice = parseSalesOrderAmountUnits(actualUnitPriceAmount)
  const normalizedQuantity = normalizeSalesOrderQuantity(quantity)
  return formatSalesOrderAmountUnits(unitPrice * BigInt(normalizedQuantity))
}

export function sumSalesOrderAmounts(values: readonly string[]): string {
  return formatSalesOrderAmountUnits(values.reduce(
    (sum, value) => sum + parseSalesOrderAmountUnits(value),
    0n,
  ))
}

/** 参与「实际已收款」累加的最小形状：订单币种金额 +（可选）作废时间。 */
export interface SalesOrderReceivedPaymentSource {
  readonly amount: { toFixed: (decimalPlaces: number) => string }
  /** 缺省表示调用方已在查询层过滤掉作废记录（列表路径就是这样取数的）。 */
  readonly voidedAt?: Date | null
}

/**
 * 实际已收款：未作废的收款记录之和（订单币种四位小数单位）。
 * 销售详情、销售列表与对账读取共用这一处口径：作废过的收款不计入，只统计仍生效的记录。
 */
export function sumSalesOrderReceivedUnits(
  payments: readonly SalesOrderReceivedPaymentSource[],
): bigint {
  return payments.reduce(
    (sum, payment) => payment.voidedAt === undefined || payment.voidedAt === null
      ? sum + parseSalesOrderAmountUnits(payment.amount.toFixed(4))
      : sum,
    0n,
  )
}

export interface SalesOrderAgreedAmountsInput {
  readonly lineSubtotalAmount: unknown
  readonly agreedTotalAmount: unknown
  readonly depositDueAmount: unknown
  readonly balanceDueAmount: unknown
}

export interface SalesOrderAgreedAmounts {
  readonly lineSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
}

export function validateSalesOrderAgreedAmounts(
  input: SalesOrderAgreedAmountsInput,
): SalesOrderAgreedAmounts {
  const lineSubtotalUnits = parseSalesOrderAmountUnits(input.lineSubtotalAmount)
  const agreedTotalUnits = parseSalesOrderAmountUnits(input.agreedTotalAmount)
  const depositDueUnits = parseSalesOrderAmountUnits(input.depositDueAmount)
  const balanceDueUnits = parseSalesOrderAmountUnits(input.balanceDueAmount)

  if (lineSubtotalUnits !== agreedTotalUnits) {
    return salesOrderRuleFailure(
      'SALES_ORDER_TOTAL_MISMATCH',
      '手填销售总价必须与产品明细汇总一致',
      'agreedTotalAmount',
    )
  }
  if (depositDueUnits + balanceDueUnits !== agreedTotalUnits) {
    return salesOrderRuleFailure(
      'SALES_ORDER_PAYMENT_TERMS_MISMATCH',
      '约定定金与尾款之和必须等于销售总价',
      'balanceDueAmount',
    )
  }

  return Object.freeze({
    lineSubtotalAmount: formatSalesOrderAmountUnits(lineSubtotalUnits),
    agreedTotalAmount: formatSalesOrderAmountUnits(agreedTotalUnits),
    depositDueAmount: formatSalesOrderAmountUnits(depositDueUnits),
    balanceDueAmount: formatSalesOrderAmountUnits(balanceDueUnits),
  })
}

export function deriveSalesOrderPaymentStatus(
  agreedTotalAmount: unknown,
  activeReceivedAmount: unknown,
): SalesOrderPaymentStatus {
  const agreedTotalUnits = parseSalesOrderAmountUnits(agreedTotalAmount)
  const activeReceivedUnits = parseSalesOrderAmountUnits(activeReceivedAmount)
  if (activeReceivedUnits > agreedTotalUnits) {
    return salesOrderRuleFailure(
      'SALES_ORDER_PAYMENT_EXCEEDS_TOTAL',
      '累计实际收款不能超过约定销售总价',
    )
  }
  if (activeReceivedUnits === 0n) return 'UNPAID'
  return activeReceivedUnits === agreedTotalUnits ? 'PAID' : 'PARTIALLY_PAID'
}
