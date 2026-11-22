import { Prisma } from '../../generated/prisma/client'

/**
 * 广告账户余额与续航口径。
 *
 * 三条不可变的业务约束：
 * 1. 可用余额 = 花费上限 - 已花费金额 - 封户取款金额（仅当取款金额为正时扣减，
 *    按值判断而不是按账户状态判断：清零后状态可能仍是禁用，但取款已经结算完）。
 * 2. 预计可持续天数先判「剩余 ≤ 0 → 0 天」，再判「日均 ≤ 0 → 无意义」。
 *    顺序反了会把已耗尽的账户显示成「无数据」。
 * 3. 金额一律走 Decimal，接口给的是十进制字符串，禁止转 number 再算。
 */

export const AD_ACCOUNT_BALANCE_ALERT_USD = 30

const ZERO = new Prisma.Decimal(0)

export type DecimalInput = string | number | Prisma.Decimal

function toDecimal(value: DecimalInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value)
}

export interface AvailableBalanceInput {
  readonly spendCap: DecimalInput
  readonly amountSpent: DecimalInput
  readonly disabledTransferAmount: DecimalInput
}

/**
 * 可用余额。上游 `spend_cap = 0` 表示没有花费上限，余额口径不成立，返回 null
 * 而不是把它当成「0 元可用」——否则这类账户会被永久判定为余额不足。
 * 超支时保留负值，不截断为 0，让页面能标出真实超投。
 */
export function resolveAvailableBalance(input: AvailableBalanceInput): Prisma.Decimal | null {
  const spendCap = toDecimal(input.spendCap)

  if (spendCap.lte(ZERO)) {
    return null
  }

  const disabledTransferAmount = toDecimal(input.disabledTransferAmount)
  const deduction = disabledTransferAmount.gt(ZERO) ? disabledTransferAmount : ZERO

  return spendCap.minus(toDecimal(input.amountSpent)).minus(deduction)
}

/**
 * 7 天窗口内实际覆盖的天数。开户不满 7 天时用实际天数做分母，
 * 固定除以 7 会低估新户日均，进而把可持续天数算得偏高。
 */
export function resolveCoveredDays(openedAt: Date, now: Date, windowDays: number): number {
  const elapsedDays = Math.floor((now.getTime() - openedAt.getTime()) / 86_400_000)
  return Math.min(windowDays, Math.max(1, elapsedDays))
}

export function resolveAverageDailySpend(
  totalSpend: DecimalInput,
  coveredDays: number,
): Prisma.Decimal {
  const days = Math.max(1, Math.floor(coveredDays))
  return toDecimal(totalSpend)
    .div(days)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

export interface SustainableDaysInput {
  readonly availableBalance: Prisma.Decimal | null
  readonly averageDailySpend: DecimalInput
}

/**
 * 预计可持续天数。`null` 表示「不适用」，由前端显示为「—」：
 * 无上限账户、零消耗账户都属于这一类。
 */
export function resolveSustainableDays(input: SustainableDaysInput): number | null {
  const availableBalance = input.availableBalance

  if (availableBalance === null) {
    return null
  }

  if (availableBalance.lte(ZERO)) {
    return 0
  }

  const averageDailySpend = toDecimal(input.averageDailySpend)

  if (averageDailySpend.lte(ZERO)) {
    return null
  }

  return availableBalance.div(averageDailySpend).floor().toNumber()
}

export interface LowBalanceAlertInput {
  readonly availableBalance: Prisma.Decimal | null
  readonly vendorMissing: boolean
}

/**
 * 是否跌穿余额预警线（严格小于阈值）。
 * 供应商本次未返回的账户数据不可信，不参与告警，避免用陈旧余额误导。
 */
export function shouldAlertLowBalance(input: LowBalanceAlertInput): boolean {
  if (input.vendorMissing || input.availableBalance === null) {
    return false
  }

  return input.availableBalance.lt(new Prisma.Decimal(AD_ACCOUNT_BALANCE_ALERT_USD))
}
