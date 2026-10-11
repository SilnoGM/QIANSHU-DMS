import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import Decimal from 'decimal.js'
// 运行时导入必须用相对路径：本文件被 node --test 从 web/ 根加载，@/ 别名解析不到。
import { EMPTY_AMOUNT_TEXT, formatCurrencyAmount } from '../../../components/base/AmountDisplay/format'

/** 汇率来源：与账单域的 rate_source 同取值（系统汇率表 / 账单内嵌）。 */
export type SlhReconciliationSettleRateSource = 'EMBEDDED' | 'SYSTEM'

/** 结算弹窗第一步的一张汇率卡。 */
export interface SlhReconciliationSettleRateCard {
  readonly source: SlhReconciliationSettleRateSource
  /** 卡片标题文案键。 */
  readonly titleKey: string
  /** 来源说明文案键。 */
  readonly sourceKey: string
  /** 该来源的汇率值（已去尾零）；缺失即 null，此时卡片禁用。 */
  readonly rate: string | null
  readonly disabled: boolean
  readonly icon: string
  readonly emblemClass: string
  readonly motifClass: string
}

/**
 * 全流程金流费比例：0.7%（用户 2026-10-11 确认；公式「销售金额 ÷ 汇率 × 0.7%」）。
 * 显示式里直接写小数常量，改这一处即可调整费率。
 */
export const FULL_FLOW_FEE_RATE = 0.007

/** 汇率只做显示裁剪：契约里固定 12 位小数（`4.800000000000`），展示按去尾零；数值不变。 */
export function trimRate(rate: string | null): string | null {
  if (rate === null || !rate.includes('.')) {
    return rate
  }
  return rate.replace(/0+$/u, '').replace(/\.$/u, '')
}

/**
 * 两张汇率卡：系统当前汇率（汇率表实时值）与账单内置汇率（账单公式自带、入库时冻结）。
 * 任一来源取不到值就禁用该卡片——不允许选中一个算不出来的汇率。
 */
export function buildSettleRateCards(
  systemRate: string | null,
  billRate: string | null,
): readonly SlhReconciliationSettleRateCard[] {
  return [
    {
      source: 'SYSTEM',
      titleKey: 'slhReconciliation.settle.systemRate',
      sourceKey: 'slhReconciliation.settle.systemRateSource',
      rate: trimRate(systemRate),
      disabled: systemRate === null,
      icon: 'i-lucide:landmark',
      emblemClass: 'bg-blue-950 text-amber-300 ring-amber-400/30 dark:bg-blue-900',
      motifClass: 'text-amber-500/10 dark:text-amber-300/10',
    },
    {
      source: 'EMBEDDED',
      titleKey: 'slhReconciliation.settle.billRate',
      sourceKey: 'slhReconciliation.settle.billRateSource',
      rate: trimRate(billRate),
      disabled: billRate === null,
      icon: 'i-lucide:receipt-text',
      emblemClass: 'bg-emerald-950 text-white ring-emerald-400/30 dark:bg-emerald-900',
      motifClass: 'text-emerald-500/10 dark:text-emerald-300/10',
    },
  ]
}

/** 一个待展示的金额：原始值（给 AmountDisplay）+ 币种 + 缺失时的占位文本。 */
export interface SlhReconciliationSettleAmount {
  readonly value: string | null
  readonly currencyCode: string
}

/**
 * 结算弹窗第二步的三块内容：
 * ①当前已选汇率；②账单金额结算＝（代收货款台币 − NTD杂费）÷ 汇率 − 合计应付人民币；
 * ③全流程金流费＝销售金额 ÷ 汇率 × 0.07。
 * 计算式里带上代入后的数值（与 AmountDisplay 同一处格式化），便于直接核对；
 * 任一输入缺失时金额留空，计算式只给到缺失的那一项。
 */
export interface SlhReconciliationSettleSummary {
  readonly rate: string | null
  readonly settlementAmount: SlhReconciliationSettleAmount
  readonly settlementFormula: string
  readonly paymentFeeAmount: SlhReconciliationSettleAmount
  readonly paymentFeeFormula: string
}

/** 结算金额币种恒为人民币（台币已按汇率折成人民币）；金流费同理。 */
const SETTLEMENT_CURRENCY = 'CNY'

function showAmount(
  value: string | null | undefined,
  currencyCode: string,
  currencies: readonly CurrencyDescriptor[],
): string {
  if (value === null || value === undefined || value.trim() === '') {
    return EMPTY_AMOUNT_TEXT
  }
  return formatCurrencyAmount(value, currencyCode, currencies)
}

export function buildSettleSummary(
  member: SlhReconciliationBatchMemberDto,
  rate: string | null,
  currencies: readonly CurrencyDescriptor[],
): SlhReconciliationSettleSummary {
  const cod = member.codAmountTwd
  const ntdSurcharge = member.ntdSurchargeAmountTwd
  const payable = member.payableAmountCny
  const salesAmount = member.salesOrder?.agreedTotalAmount ?? null
  const orderCurrency = member.salesOrder?.currencyCode ?? ''
  const rateUnits = rate === null || new Decimal(rate).isZero() ? null : rate
  const rateText = rate ?? EMPTY_AMOUNT_TEXT

  const settlementReady = cod !== null && ntdSurcharge !== null && payable !== null && rateUnits !== null
  const settlementAmount: SlhReconciliationSettleAmount = {
    value: settlementReady
      ? new Decimal(cod)
          .minus(ntdSurcharge)
          .div(rateUnits)
          .minus(payable)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toFixed(2)
      : null,
    currencyCode: SETTLEMENT_CURRENCY,
  }

  const feeReady = salesAmount !== null && rateUnits !== null
  const paymentFeeAmount: SlhReconciliationSettleAmount = {
    value: feeReady
      ? new Decimal(salesAmount)
          .div(rateUnits)
          .times(FULL_FLOW_FEE_RATE)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toFixed(2)
      : null,
    currencyCode: SETTLEMENT_CURRENCY,
  }

  return {
    rate,
    settlementAmount,
    settlementFormula: `（${showAmount(cod, 'TWD', currencies)} − ${showAmount(ntdSurcharge, 'TWD', currencies)}）÷ ${rateText} − ${showAmount(payable, SETTLEMENT_CURRENCY, currencies)} = ${showAmount(settlementAmount.value, SETTLEMENT_CURRENCY, currencies)}`,
    paymentFeeAmount,
    paymentFeeFormula: `${showAmount(salesAmount, orderCurrency, currencies)} ÷ ${rateText} × ${FULL_FLOW_FEE_RATE} = ${showAmount(paymentFeeAmount.value, SETTLEMENT_CURRENCY, currencies)}`,
  }
}
