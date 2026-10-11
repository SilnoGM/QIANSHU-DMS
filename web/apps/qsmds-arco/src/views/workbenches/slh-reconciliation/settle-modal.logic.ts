import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'
// 运行时导入必须用相对路径：本文件被 node --test 从 web/ 根加载，@/ 别名解析不到。
import { EMPTY_AMOUNT_TEXT } from '../../../components/base/AmountDisplay/format'

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

/** 一个待展示的金额：原始值（给 AmountDisplay，含币种代码）+ 币种。 */
export interface SlhReconciliationSettleAmount {
  readonly value: string | null
  readonly currencyCode: string
}

/** 结果强调色：结算金额按符号（负红/正绿/其余中性），金流费恒红（成本项）。 */
export type SlhReconciliationSettleTone = 'danger' | 'success' | 'neutral'

interface SlhReconciliationSettleRowBase {
  readonly id: string
  /** 行首运算符；起始行没有。方向由它表达，行值保持原值不带符号，避免一行出现两个减号。 */
  readonly operator: string | null
  readonly label: string
  /** 该行之前画虚线，与「合计应付」前的分组线一致。 */
  readonly dividerBefore: boolean
}

/** 算式表的一行：金额行走 AmountDisplay，汇率与费率等纯数值行直接给文本。 */
export type SlhReconciliationSettleRow
  = | (SlhReconciliationSettleRowBase & { readonly kind: 'amount', readonly amount: SlhReconciliationSettleAmount })
    | (SlhReconciliationSettleRowBase & { readonly kind: 'text', readonly text: string })

/**
 * 结算弹窗第二步的一块：标题 + 右上角抽象公式 + 算式表 + 结果行。
 * 算式表给的是**代入后**的逐行取值，直接可核对；空金额按 0 代入的说明挂在 `noteKey` 上。
 */
export interface SlhReconciliationSettleBlock {
  readonly id: 'settlement' | 'paymentFee'
  readonly titleKey: string
  /** 右上角的抽象公式（费率等参数已在 logic 内代入），与算式表的代入值互为对照。 */
  readonly formula: string
  readonly rows: readonly SlhReconciliationSettleRow[]
  readonly resultLabelKey: string
  readonly result: SlhReconciliationSettleAmount
  readonly resultTone: SlhReconciliationSettleTone
  /** 「本行不涉及」的空金额被按 0 代入过时的说明文案键；没代入即 null。 */
  readonly noteKey: string | null
}

/**
 * 结算弹窗第二步：①顶部基准汇率条（`rateBaseText`）②账单金额结算
 * ＝（代收货款台币 − NTD杂费）÷ 汇率 − 合计应付人民币 ③全流程金流费
 * ＝销售金额 ÷ 汇率 × 0.7%。
 *
 * 金额口径：三个金额列的 NULL 表示「本行不涉及此项」（与账单行的存储约定一致），
 * 结算时按 0 代入并给出说明——负数结果就是「无代收但有杂费」这类行的真实结算方向；
 * 整行三列都不涉及或汇率不可用时仍留空，不造「伪 0」。
 */
export interface SlhReconciliationSettleSummary {
  readonly rate: string | null
  /** 「1 CNY = 5.2 TWD」；汇率缺失时给占位符。 */
  readonly rateBaseText: string
  readonly blocks: readonly SlhReconciliationSettleBlock[]
}

/** 结算金额币种恒为人民币（台币已按汇率折成人民币）；金流费同理。 */
const SETTLEMENT_CURRENCY = 'CNY'
/** 账单侧代收货款与杂费都是台币列。 */
const BILL_AMOUNT_CURRENCY = 'TWD'

/** 译函数只要求最小签名，与页面里其它 logic 的写法一致。 */
type SlhReconciliationSettleTranslate = (key: string, params?: Record<string, string>) => string

function toAmount(value: string | null, currencyCode: string): SlhReconciliationSettleAmount {
  return { value, currencyCode }
}

/** 结算金额按符号着色：负红、正绿，零（含舍入后的负零）与占位符保持中性。 */
function resolveSettlementTone(value: string | null): SlhReconciliationSettleTone {
  if (value === null) {
    return 'neutral'
  }
  const amount = new Decimal(value)
  if (amount.isZero()) {
    return 'neutral'
  }
  return amount.isNegative() ? 'danger' : 'success'
}

export function buildSettleSummary(
  member: SlhReconciliationBatchMemberDto,
  rate: string | null,
  translate: SlhReconciliationSettleTranslate,
): SlhReconciliationSettleSummary {
  const cod = member.codAmountTwd
  const ntdSurcharge = member.ntdSurchargeAmountTwd
  const payable = member.payableAmountCny
  const salesAmount = member.salesOrder?.agreedTotalAmount ?? null
  const orderCurrency = member.salesOrder?.currencyCode ?? ''
  const rateUnits = rate === null || new Decimal(rate).isZero() ? null : rate
  const rateText = trimRate(rate) ?? EMPTY_AMOUNT_TEXT

  // 空金额按 0 代入；但整行三个金额都不涉及时不造「伪 0」结果，行值与结果都留空占位。
  const hasSettlementInput = cod !== null || ntdSurcharge !== null || payable !== null
  const settlementReady = rateUnits !== null && hasSettlementInput
  const settlementAssumesZero = settlementReady
    && (cod === null || ntdSurcharge === null || payable === null)
  /** 行值：只有真的代入过才把空值换成 0.00，否则保留「本行不涉及」的占位符。 */
  const operand = (value: string | null): string | null => (
    settlementAssumesZero && (value === null || value.trim() === '') ? '0.00' : value
  )

  let settlementValue: string | null = null
  if (rateUnits !== null && hasSettlementInput) {
    settlementValue = new Decimal(cod ?? 0)
      .minus(ntdSurcharge ?? 0)
      .div(rateUnits)
      .minus(payable ?? 0)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2)
  }

  // 金流费的基数（销售额）在匹配阶段就保证了存在，缺失时不做 0 代入、直接留空。
  const feeReady = salesAmount !== null && rateUnits !== null
  const paymentFeeValue = feeReady
    ? new Decimal(salesAmount)
        .div(rateUnits)
        .times(FULL_FLOW_FEE_RATE)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2)
    : null
  // 百分比用 Decimal 折算，避免 0.007 × 100 的浮点尾差。
  const feePercentText = new Decimal(FULL_FLOW_FEE_RATE).times(100).toString()

  const rateRowLabel = translate('slhReconciliation.settle.rateRow')

  return {
    rate,
    rateBaseText: translate('slhReconciliation.settle.baseRateText', { rate: rateText }),
    blocks: [
      {
        id: 'settlement',
        titleKey: 'slhReconciliation.settle.settlementTitle',
        formula: translate('slhReconciliation.settle.settlementFormula'),
        rows: [
          { id: 'codAmount', operator: null, label: translate('slhReconciliation.settle.codAmount'), kind: 'amount', amount: toAmount(operand(cod), BILL_AMOUNT_CURRENCY), dividerBefore: false },
          { id: 'ntdDeduction', operator: '−', label: translate('slhReconciliation.settle.ntdDeduction'), kind: 'amount', amount: toAmount(operand(ntdSurcharge), BILL_AMOUNT_CURRENCY), dividerBefore: false },
          { id: 'rate', operator: '÷', label: rateRowLabel, kind: 'text', text: rateText, dividerBefore: false },
          { id: 'payableTotal', operator: '−', label: translate('slhReconciliation.settle.payableTotal'), kind: 'amount', amount: toAmount(operand(payable), SETTLEMENT_CURRENCY), dividerBefore: true },
        ],
        resultLabelKey: 'slhReconciliation.settle.settlementResult',
        result: toAmount(settlementValue, SETTLEMENT_CURRENCY),
        resultTone: resolveSettlementTone(settlementValue),
        noteKey: settlementAssumesZero ? 'slhReconciliation.settle.missingAmountAsZero' : null,
      },
      {
        id: 'paymentFee',
        titleKey: 'slhReconciliation.settle.paymentFeeTitle',
        formula: translate('slhReconciliation.settle.paymentFeeFormula', { rate: `${feePercentText}%` }),
        rows: [
          { id: 'salesAmount', operator: null, label: translate('slhReconciliation.detail.salesTotalAmount'), kind: 'amount', amount: toAmount(salesAmount, orderCurrency), dividerBefore: false },
          { id: 'rate', operator: '÷', label: rateRowLabel, kind: 'text', text: rateText, dividerBefore: false },
          { id: 'feeRate', operator: '×', label: translate('slhReconciliation.settle.paymentFeeRate'), kind: 'text', text: translate('slhReconciliation.settle.paymentFeeRateValue', { percent: feePercentText, decimal: String(FULL_FLOW_FEE_RATE) }), dividerBefore: false },
        ],
        resultLabelKey: 'slhReconciliation.settle.paymentFeeResult',
        result: toAmount(paymentFeeValue, SETTLEMENT_CURRENCY),
        // 金流费恒红：它是净支出，不按符号着色（用户 2026-10-11 口径）。
        resultTone: paymentFeeValue === null ? 'neutral' : 'danger',
        noteKey: null,
      },
    ],
  }
}
