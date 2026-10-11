import { Prisma } from '../../generated/prisma/client'

/** Prisma 暴露的 Decimal 就是 decimal.js 的实现，服务端不额外引入直接依赖。 */
const Decimal = Prisma.Decimal

/**
 * 对账结算的金额口径：与前端 `settle-modal.logic.ts` 完全一致（web 侧有对拍断言盯住常量）。
 *
 * - `（代收货款台币 − NTD杂费）÷ 汇率 − 合计应付人民币`，人民币两位小数 HALF_UP；
 *   账单侧三个金额为空表示「本行不涉及」，计算时按 0 代入，但整行三列都为空则不计算。
 * - `销售金额 ÷ 汇率 × 金流费率`，人民币两位小数 HALF_UP；销售额缺失时不计算。
 * - 客户端传上来的是「界面上看到的」值，这里重算并逐项比对，不一致即拒绝。
 */

/** 全流程金流费率：0.7%。改这一处会同时影响前端展示口径，前端有常量对拍用例。 */
export const PAYMENT_FEE_RATE = '0.007'

/** 结算结果里金额的币种固定：账单侧的代收与杂费是台币、其余是人民币。 */
export const SETTLEMENT_BILL_AMOUNT_CURRENCY = 'TWD'
export const SETTLEMENT_CURRENCY = 'CNY'
/** 系统汇率取台币口径（与 exchange_rates 的币种一致）。 */
export const SETTLEMENT_SYSTEM_RATE_CURRENCY = 'TWD'

const AMOUNT_CURRENCY_FIELDS = 'codAmountTwd|ntdSurchargeAmountTwd|payableAmountCny|settlementAmountCny|salesAmount|paymentFeeAmountCny' as const

/** 六个金额的字段名，比对失败时按这个顺序报出不一致的字段。 */
export type SettlementAmountField =
  | 'codAmountTwd'
  | 'ntdSurchargeAmountTwd'
  | 'payableAmountCny'
  | 'settlementAmountCny'
  | 'salesAmount'
  | 'paymentFeeAmountCny'

export interface SettlementSourceAmounts {
  /** 账单行的三个原始金额（本行不涉及时为 null）。 */
  readonly codAmountTwd: string | null
  readonly ntdSurchargeAmountTwd: string | null
  readonly payableAmountCny: string | null
  /** 销售订单约定总额（订单币种，四位小数）。 */
  readonly salesAmount: string | null
  readonly rate: string
  readonly paymentFeeRate: string
}

export interface ResolvedSettlementAmounts {
  readonly codAmountTwd: string | null
  readonly ntdSurchargeAmountTwd: string | null
  readonly payableAmountCny: string | null
  readonly settlementAmountCny: string | null
  readonly salesAmount: string | null
  readonly paymentFeeAmountCny: string | null
}

const AMOUNT_FIELD_LABELS: Readonly<Record<SettlementAmountField, string>> = {
  codAmountTwd: '代收货款',
  ntdSurchargeAmountTwd: '杂费扣除',
  payableAmountCny: '合计应付',
  settlementAmountCny: '结算金额',
  salesAmount: '销售金额',
  paymentFeeAmountCny: '金流服务费',
}

const isBlank = (value: string | null): boolean => value === null || value.trim() === ''

/** 两个金额是否数值相等（null 与 null 视为相等；一边为空另一边有值即不一致）。 */
export function isSameAmount(left: string | null, right: string | null): boolean {
  if (isBlank(left) || isBlank(right)) {
    return isBlank(left) && isBlank(right)
  }
  return new Decimal(left as string).equals(new Decimal(right as string))
}

/**
 * 服务端重算六个金额。汇率非正或账单侧三个金额都不涉及时代入规则与前端一致：
 * 前者与后者都返回可空结果，由调用方在比对阶段统一报「不一致」。
 */
export function resolveSettlementAmounts(source: SettlementSourceAmounts): ResolvedSettlementAmounts {
  const rateUnits = new Decimal(source.rate).isZero() ? null : source.rate
  const hasSettlementInput = !isBlank(source.codAmountTwd)
    || !isBlank(source.ntdSurchargeAmountTwd)
    || !isBlank(source.payableAmountCny)
  const assumesZero = rateUnits !== null && hasSettlementInput
  const operand = (value: string | null): Prisma.Decimal => new Decimal(isBlank(value) && assumesZero ? 0 : value ?? 0)

  let settlementAmountCny: string | null = null
  if (rateUnits !== null && hasSettlementInput) {
    settlementAmountCny = operand(source.codAmountTwd)
      .minus(operand(source.ntdSurchargeAmountTwd))
      .div(rateUnits)
      .minus(operand(source.payableAmountCny))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2)
  }
  const paymentFeeAmountCny = source.salesAmount === null || rateUnits === null
    ? null
    : new Decimal(source.salesAmount)
        .div(rateUnits)
        .times(source.paymentFeeRate)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2)

  return {
    codAmountTwd: source.codAmountTwd,
    ntdSurchargeAmountTwd: source.ntdSurchargeAmountTwd,
    payableAmountCny: source.payableAmountCny,
    settlementAmountCny,
    salesAmount: source.salesAmount,
    paymentFeeAmountCny,
  }
}

/** 与客户端「界面上看到的」六个金额逐项比对，返回不一致的字段标签（为空即一致）。 */
export function compareSettlementAmounts(
  resolved: ResolvedSettlementAmounts,
  claimed: Record<SettlementAmountField, string | null>,
): readonly string[] {
  const fields = AMOUNT_CURRENCY_FIELDS.split('|') as SettlementAmountField[]
  return fields
    .filter(field => !isSameAmount(resolved[field], claimed[field]))
    .map(field => AMOUNT_FIELD_LABELS[field])
}

/** 与当前有效记录比对：汇率来源、汇率、费率与六个金额全等才算「已有相同数据」。 */
export function isSameSettlement(
  active: {
    readonly rateSource: string
    readonly foreignUnitsPerCny: string
    readonly paymentFeeRate: string
  } & Record<SettlementAmountField, string | null>,
  rateSource: string,
  rate: string,
  resolved: ResolvedSettlementAmounts,
): boolean {
  if (active.rateSource !== rateSource) {
    return false
  }
  if (!isSameAmount(active.foreignUnitsPerCny, rate) || !isSameAmount(active.paymentFeeRate, PAYMENT_FEE_RATE)) {
    return false
  }
  const fields = AMOUNT_CURRENCY_FIELDS.split('|') as SettlementAmountField[]
  return fields.every(field => isSameAmount(active[field], resolved[field]))
}
