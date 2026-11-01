import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import Decimal from 'decimal.js'
// 运行时导入必须用相对路径：本文件被 node --test 从 web/ 根加载，@/ 别名解析不到。
import { EMPTY_AMOUNT_TEXT, formatCurrencyAmount } from '../../../components/base/AmountDisplay/format'
import { findCurrencyDescriptor } from '../../../components/base/currency'

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

/** 汇率只读展示统一两位小数；数值仍用原始精度参与结算。 */
export function trimRate(rate: string | null): string | null {
  if (rate === null) {
    return null
  }
  return new Decimal(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
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

/** 结果强调色：结算金额按符号（负红/正绿/其余中性），金流费恒红（成本项）。 */
export type SlhReconciliationSettleTone = 'danger' | 'success' | 'neutral'

/**
 * 卡片宽度档位：被减项与销售额吃剩余宽度（模板侧再设上限，多出的留白推到结果卡左侧），
 * 汇率/费率与合计应付是固定宽度——它们的位数不受控，固定后整行不随数据抖动。
 */
export type SlhReconciliationSettleTermWidth = 'flex' | 'rate' | 'payable'

/**
 * 横排算式里的一个操作数卡片：标签带单位（`代收货款 (TWD)`），值是**裸数字**
 * （去掉货币符号与代码，保留千分位与币种精度），这样才能在一行里排下。
 * 汇率与费率是文本项（没有单位），用琥珀黄强调。
 */
export interface SlhReconciliationSettleTerm {
  readonly id: string
  /** 该项之前的运算符徽标；首项没有。 */
  readonly operator: string | null
  readonly label: string
  readonly unit: string | null
  readonly value: string
  /** 金额项的币种（供可审计属性）；汇率/费率项为 null。 */
  readonly currencyCode: string | null
  readonly accent: boolean
  readonly width: SlhReconciliationSettleTermWidth
}

/** 一组项：账单块的前两项用虚线框分组，其余是普通流式排列。 */
export interface SlhReconciliationSettleGroup {
  readonly id: string
  readonly dashed: boolean
  readonly terms: readonly SlhReconciliationSettleTerm[]
}

/**
 * 结算弹窗第二步的一块：标题 + 右上角抽象公式 + 横排算式 + 结果卡。
 * 算式给的是**代入后**的取值，直接可核对；空金额按 0 代入的说明挂在 `noteKey` 上。
 */
export interface SlhReconciliationSettleBlock {
  readonly id: 'settlement' | 'paymentFee'
  readonly titleKey: string
  readonly formula: string
  readonly groups: readonly SlhReconciliationSettleGroup[]
  readonly resultLabelKey: string
  /** 结果值同样是裸数字，币种由结果卡的 chip 表达。 */
  readonly result: string
  readonly resultCurrencyCode: string
  readonly resultTone: SlhReconciliationSettleTone
  /** 「本行不涉及」的空金额被按 0 代入过时的说明文案键；没代入即 null。 */
  readonly noteKey: string | null
}

/**
 * 结算弹窗第二步：①顶部汇率条（`rateBaseText`）②账单金额结算明细
 * ＝（代收货款台币 − NTD杂费）÷ 汇率 − 合计应付人民币 ③全流程金流服务费
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
  /** 确认结算要提交的六个金额（账单侧三个原始值含 null，两个派生值按同一口径算）。 */
  readonly payload: SlhReconciliationSettlePayloadAmounts
  readonly blocks: readonly SlhReconciliationSettleBlock[]
}

/** 提交给服务端的六个金额：与库侧「金额 + 币种」成对存储的字段一一对应。 */
export interface SlhReconciliationSettlePayloadAmounts {
  readonly codAmountTwd: string | null
  readonly ntdSurchargeAmountTwd: string | null
  readonly payableAmountCny: string | null
  readonly settlementAmountCny: string | null
  readonly salesAmount: string | null
  readonly paymentFeeAmountCny: string | null
}

/** 确认结算失败的错误码 → 文案键：服务端拒绝的原因要能直接讲清楚，其余给通用提示。 */
const SETTLE_FAILURE_KEYS: Readonly<Record<string, string>> = {
  FORBIDDEN: 'slhReconciliation.settle.errorForbidden',
  SLH_RECON_BATCH_NOT_IN_PROGRESS: 'slhReconciliation.settle.errorBatchCompleted',
  SLH_RECON_BATCH_STATE_CHANGED: 'slhReconciliation.settle.errorStateChanged',
  SLH_RECON_SETTLEMENT_KEY_REUSED: 'slhReconciliation.settle.errorKeyReused',
  SLH_RECON_SETTLEMENT_MISMATCH: 'slhReconciliation.settle.errorMismatch',
  SLH_RECON_SETTLEMENT_RATE_CHANGED: 'slhReconciliation.settle.errorRateChanged',
  SLH_RECON_SETTLEMENT_RATE_UNAVAILABLE: 'slhReconciliation.settle.errorRateUnavailable',
  SLH_RECON_SETTLEMENT_SOURCE_MISSING: 'slhReconciliation.settle.errorSourceMissing',
  SLH_RECON_SETTLEMENT_UNCHANGED: 'slhReconciliation.settle.errorUnchanged',
  SLH_RECON_ALLOCATION_BREAKDOWN_MISMATCH: 'slhReconciliation.settle.errorAllocationBreakdownMismatch',
  SLH_RECON_ALLOCATION_COD_TARGET_INVALID: 'slhReconciliation.settle.errorAllocationTargetInvalid',
  SLH_RECON_ALLOCATION_OVERRIDE_INVALID: 'slhReconciliation.settle.errorAllocationTargetInvalid',
  SLH_RECON_ALLOCATION_RATE_INVALID: 'slhReconciliation.settle.errorRateUnavailable',
  SLH_RECON_ALLOCATION_REASON_REQUIRED: 'slhReconciliation.settle.errorAllocationReasonRequired',
  SLH_RECON_SETTLEMENT_ORIGIN_ACCOUNT_MISSING: 'slhReconciliation.settle.errorOriginAccountMissing',
}
const SETTLE_FAILURE_FALLBACK_KEY = 'slhReconciliation.settle.errorUnknown'

/** 从接口错误里取业务错误码并映射到文案键；结构不对或未登记的码一律回落到通用提示。 */
export function resolveSettleFailureKey(error: unknown): string {
  const code = (error as { body?: { code?: unknown } } | null)?.body?.code
  if (typeof code !== 'string') {
    return SETTLE_FAILURE_FALLBACK_KEY
  }
  return SETTLE_FAILURE_KEYS[code] ?? SETTLE_FAILURE_FALLBACK_KEY
}

/** 结算金额币种恒为人民币（台币已按汇率折成人民币）；金流费同理。 */
const SETTLEMENT_CURRENCY = 'CNY'
/** 账单侧代收货款与杂费都是台币列。 */
const BILL_AMOUNT_CURRENCY = 'TWD'

/** 译函数只要求最小签名，与页面里其它 logic 的写法一致。 */
type SlhReconciliationSettleTranslate = (key: string, params?: Record<string, string>) => string

/**
 * 卡片里的裸数值：标签已经带单位、结果卡另有币种 chip，所以复用公共格式化
 * （精度、千分位、负号规则都只有一处来源）后把货币符号与代码裁掉，
 * 避免为了展示再实现一套金额格式化。
 */
export function formatBareAmount(
  value: string | null,
  currencyCode: string,
  currencies: readonly CurrencyDescriptor[],
): string {
  if (value === null || value.trim() === '') {
    return EMPTY_AMOUNT_TEXT
  }
  const formatted = formatCurrencyAmount(value, currencyCode, currencies)
  const withoutCode = formatted.endsWith(` ${currencyCode}`)
    ? formatted.slice(0, -(currencyCode.length + 1))
    : formatted
  const symbol = findCurrencyDescriptor(currencies, currencyCode)?.symbol
  if (symbol === null || symbol === undefined || symbol === '') {
    return withoutCode
  }
  const sign = withoutCode.startsWith('-') ? '-' : ''
  const unsigned = sign === '' ? withoutCode : withoutCode.slice(1)
  return unsigned.startsWith(symbol) ? `${sign}${unsigned.slice(symbol.length)}` : withoutCode
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
  currencies: readonly CurrencyDescriptor[],
  translate: SlhReconciliationSettleTranslate,
): SlhReconciliationSettleSummary {
  const cod = member.codAmountTwd
  const ntdSurcharge = member.ntdSurchargeAmountTwd
  const payable = member.payableAmountCny
  const salesAmount = member.salesOrder?.agreedTotalAmount ?? null
  const orderCurrency = member.salesOrder?.currencyCode ?? ''
  const rateUnits = rate === null || new Decimal(rate).isZero() ? null : rate
  const rateText = trimRate(rate) ?? EMPTY_AMOUNT_TEXT

  // 空金额按 0 代入；但整行三个金额都不涉及时不造「伪 0」结果，卡片与结果都留空占位。
  const hasSettlementInput = cod !== null || ntdSurcharge !== null || payable !== null
  const settlementReady = rateUnits !== null && hasSettlementInput
  const settlementAssumesZero = settlementReady
    && (cod === null || ntdSurcharge === null || payable === null)
  /** 卡片值：只有真的代入过才把空值换成 0，否则保留「本行不涉及」的占位符。 */
  const operand = (value: string | null): string | null => (
    settlementAssumesZero && (value === null || value.trim() === '') ? '0' : value
  )
  const bare = (value: string | null, currencyCode: string) => formatBareAmount(value, currencyCode, currencies)

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
  // 千分比用 Decimal 折算，避免 0.007 × 1000 的浮点尾差。
  const feePermilleText = new Decimal(FULL_FLOW_FEE_RATE).times(1000).toFixed(0)

  const rateTerm = (id: string, operator: string): SlhReconciliationSettleTerm => ({
    id,
    operator,
    label: translate('slhReconciliation.settle.rateRow'),
    unit: null,
    value: rateText,
    currencyCode: null,
    accent: true,
    width: 'rate',
  })

  return {
    rate,
    rateBaseText: translate('slhReconciliation.settle.baseRateText', { rate: rateText }),
    // 提交的是原始值（不是展示用的裸数字）：服务端按同一口径重算后逐项比对。
    payload: {
      codAmountTwd: cod,
      ntdSurchargeAmountTwd: ntdSurcharge,
      payableAmountCny: payable,
      settlementAmountCny: settlementValue,
      salesAmount,
      paymentFeeAmountCny: paymentFeeValue,
    },
    blocks: [
      {
        id: 'settlement',
        titleKey: 'slhReconciliation.settle.settlementTitle',
        formula: translate('slhReconciliation.settle.settlementFormula'),
        groups: [
          // 被减的两项用虚线框括起来：它们先相减、再参与后面的除法与减法。
          {
            id: 'parenthesized',
            dashed: true,
            terms: [
              { id: 'codAmount', operator: null, label: translate('slhReconciliation.settle.codAmount'), unit: BILL_AMOUNT_CURRENCY, value: bare(operand(cod), BILL_AMOUNT_CURRENCY), currencyCode: BILL_AMOUNT_CURRENCY, accent: false, width: 'flex' },
              { id: 'ntdDeduction', operator: '−', label: translate('slhReconciliation.settle.ntdDeduction'), unit: BILL_AMOUNT_CURRENCY, value: bare(operand(ntdSurcharge), BILL_AMOUNT_CURRENCY), currencyCode: BILL_AMOUNT_CURRENCY, accent: false, width: 'flex' },
            ],
          },
          {
            id: 'operands',
            dashed: false,
            terms: [
              rateTerm('rate', '÷'),
              { id: 'payableTotal', operator: '−', label: translate('slhReconciliation.settle.payableTotal'), unit: SETTLEMENT_CURRENCY, value: bare(operand(payable), SETTLEMENT_CURRENCY), currencyCode: SETTLEMENT_CURRENCY, accent: false, width: 'payable' },
            ],
          },
        ],
        resultLabelKey: 'slhReconciliation.settle.settlementResult',
        result: bare(settlementValue, SETTLEMENT_CURRENCY),
        resultCurrencyCode: SETTLEMENT_CURRENCY,
        resultTone: resolveSettlementTone(settlementValue),
        noteKey: settlementAssumesZero ? 'slhReconciliation.settle.missingAmountAsZero' : null,
      },
      {
        id: 'paymentFee',
        titleKey: 'slhReconciliation.settle.paymentFeeTitle',
        formula: translate('slhReconciliation.settle.paymentFeeFormula'),
        groups: [
          {
            id: 'operands',
            dashed: false,
            terms: [
              { id: 'salesAmount', operator: null, label: translate('slhReconciliation.detail.salesTotalAmount'), unit: orderCurrency === '' ? null : orderCurrency, value: bare(salesAmount, orderCurrency), currencyCode: salesAmount === null ? null : orderCurrency, accent: false, width: 'flex' },
              rateTerm('rate', '÷'),
              { id: 'feeRate', operator: '×', label: translate('slhReconciliation.settle.paymentFeeRate'), unit: null, value: translate('slhReconciliation.settle.paymentFeeRateValue', { permille: feePermilleText }), currencyCode: null, accent: true, width: 'rate' },
            ],
          },
        ],
        resultLabelKey: 'slhReconciliation.settle.paymentFeeResult',
        result: bare(paymentFeeValue, SETTLEMENT_CURRENCY),
        resultCurrencyCode: SETTLEMENT_CURRENCY,
        // 金流费恒红：它是净支出，不按符号着色（用户 2026-10-11 口径）。
        resultTone: paymentFeeValue === null ? 'neutral' : 'danger',
        // 费用是对整张销售订单收的，而一个销售单可能对应多行账单：入账按销售单计一次（2026-10-13 口径）。
        noteKey: 'slhReconciliation.settle.paymentFeeOncePerSalesOrder',
      },
    ],
  }
}

/** 财务可选的入账目标：甲＝原销售单、乙＝当前销售单、公司账户。 */
export type SlhSettleAllocationTarget = 'ORIGIN_ORDER' | 'CURRENT_ORDER' | 'COMPANY'
/** 费用项来源：账单备注费用、运费、代收手续费、代收货款、金流费。 */
export type SlhSettleAllocationSource = 'BILL_CHARGE' | 'FREIGHT' | 'COD_HANDLING' | 'COD' | 'PAYMENT_FEE'

/** 手动覆盖：目标 + 变更原因（目标与默认不同时原因必填）。 */
export interface SlhSettleAllocationOverride {
  readonly target: SlhSettleAllocationTarget
  readonly reason: string
}

/** 分摊预览里的一个费用项：金额保持账单原币种，贡献额折算成人民币。 */
export interface SlhSettleAllocationItemView {
  readonly key: string
  readonly sourceType: SlhSettleAllocationSource
  readonly chargeType: string | null
  readonly currencyCode: 'CNY' | 'TWD'
  readonly amount: string
  readonly defaultTarget: SlhSettleAllocationTarget
  readonly target: SlhSettleAllocationTarget
  readonly signedContributionCny: string
  readonly overridden: boolean
  readonly reason: string
}

/** 目标合计：结算金额不含金流费，金流费单列（与完成批次的两次资金动作一致）。 */
export interface SlhSettleAllocationPartyView {
  readonly target: SlhSettleAllocationTarget
  readonly salesOrderId: string | null
  readonly salesOrderNo: string | null
  readonly settlementAmountCny: string | null
  readonly paymentFeeAmountCny: string | null
}

/** 分摊预览：同时给出阻断原因，界面据此禁用确认。 */
export interface SlhSettleAllocationPreview {
  readonly items: readonly SlhSettleAllocationItemView[]
  readonly parties: readonly SlhSettleAllocationPartyView[]
  /** 备注费用与账单附加费/NTD 杂费对不上：无法拆分，必须阻断。 */
  readonly breakdownMismatch: boolean
  /** 手动改目标没填原因。 */
  readonly reasonMissing: boolean
  /** 原销售单或当前销售单缺失（正常不会出现，防御脏数据）。 */
  readonly sourceMissing: boolean
  /** 提交给服务端的覆盖项；未改动的项不提交。 */
  readonly payload: ReadonlyArray<{ readonly key: string, readonly target: SlhSettleAllocationTarget, readonly reason: string }>
}

/** 默认归甲（原销售单）的账单费用类型；其余费用默认归乙，COD 与金流费也归乙。 */
const SETTLE_ORIGIN_CHARGE_TYPES = new Set(['REDELIVERY', 'TRANSFER_DELIVERY', 'STORAGE'])

function settleDefaultTarget(chargeType: string): SlhSettleAllocationTarget {
  return SETTLE_ORIGIN_CHARGE_TYPES.has(chargeType) ? 'ORIGIN_ORDER' : 'CURRENT_ORDER'
}

function settleSignedContribution(
  sourceType: SlhSettleAllocationSource,
  currencyCode: 'CNY' | 'TWD',
  amount: string,
  rate: string,
): string {
  const value = new Decimal(amount)
  if (sourceType === 'COD') {
    return value.div(rate).toString()
  }
  if (currencyCode === 'TWD') {
    return value.div(rate).negated().toString()
  }
  return value.negated().toString()
}

function settleMoney(value: Decimal | null): string | null {
  return value === null ? null : value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}

/**
 * 分摊预览：口径与服务端 `buildSlhSettlementAllocation` 完全一致（默认目标、贡献额、
 * 目标合计与尾差归乙）。这里不做后端校验的替代，只把同一结果展示给财务确认。
 */
export function buildSettleAllocation(
  member: SlhReconciliationBatchMemberDto,
  paymentFeeAmountCny: string | null,
  rate: string | null,
  overrides: Readonly<Record<string, SlhSettleAllocationOverride>>,
): SlhSettleAllocationPreview {
  const origin = member.salesOrder
  const current = member.currentSalesOrder
  if (origin == null || current == null || rate === null) {
    return {
      items: [],
      parties: [],
      breakdownMismatch: false,
      reasonMissing: false,
      sourceMissing: origin == null || current == null,
      payload: [],
    }
  }
  const rateUnits = new Decimal(rate)
  if (rateUnits.isZero()) {
    return {
      items: [],
      parties: [],
      breakdownMismatch: false,
      reasonMissing: false,
      sourceMissing: false,
      payload: [],
    }
  }
  const sameOrder = origin.id === current.id
  const base: Array<Omit<SlhSettleAllocationItemView, 'defaultTarget' | 'target' | 'signedContributionCny' | 'overridden' | 'reason'>> = []
  for (const charge of member.charges) {
    if (charge.id == null || charge.amount.trim() === '') {
      continue
    }
    base.push({
      key: `CHARGE:${charge.id}`,
      sourceType: 'BILL_CHARGE',
      chargeType: charge.chargeType,
      currencyCode: charge.currencyCode as 'CNY' | 'TWD',
      amount: charge.amount,
    })
  }
  if (member.freightAmountCny !== null) {
    base.push({ key: 'FREIGHT', sourceType: 'FREIGHT', chargeType: 'FREIGHT', currencyCode: 'CNY', amount: member.freightAmountCny })
  }
  if (member.codHandlingAmountCny !== null) {
    base.push({ key: 'COD_HANDLING', sourceType: 'COD_HANDLING', chargeType: 'COD_HANDLING', currencyCode: 'CNY', amount: member.codHandlingAmountCny })
  }
  if (member.codAmountTwd !== null) {
    base.push({ key: 'COD', sourceType: 'COD', chargeType: null, currencyCode: 'TWD', amount: member.codAmountTwd })
  }
  if (paymentFeeAmountCny !== null) {
    base.push({ key: 'PAYMENT_FEE', sourceType: 'PAYMENT_FEE', chargeType: null, currencyCode: 'CNY', amount: paymentFeeAmountCny })
  }

  let reasonMissing = false
  const items: SlhSettleAllocationItemView[] = base.map((item) => {
    const defaultTarget = item.sourceType === 'BILL_CHARGE'
      ? settleDefaultTarget(item.chargeType ?? 'OTHER')
      : 'CURRENT_ORDER'
    const override = item.sourceType === 'COD' ? undefined : overrides[item.key]
    let target = override?.target ?? defaultTarget
    if (sameOrder && target === 'ORIGIN_ORDER') {
      target = 'CURRENT_ORDER'
    }
    const overridden = override !== undefined
      && override.target !== defaultTarget
      && !(sameOrder && override.target === 'ORIGIN_ORDER')
    const reason = overridden ? override.reason.trim() : ''
    if (overridden && reason === '') {
      reasonMissing = true
    }
    return {
      ...item,
      defaultTarget,
      target,
      signedContributionCny: settleSignedContribution(item.sourceType, item.currencyCode, item.amount, rate),
      overridden,
      reason,
    }
  })

  const cnyCharges = items
    .filter(item => item.sourceType === 'BILL_CHARGE' && item.currencyCode === 'CNY')
    .reduce((sum, item) => sum.plus(item.amount), new Decimal(0))
  const twdCharges = items
    .filter(item => item.sourceType === 'BILL_CHARGE' && item.currencyCode === 'TWD')
    .reduce((sum, item) => sum.plus(item.amount), new Decimal(0))
  const cnyExpected = member.surchargeAmountCny === null ? new Decimal(0) : new Decimal(member.surchargeAmountCny)
  const twdExpected = member.ntdSurchargeAmountTwd === null ? new Decimal(0) : new Decimal(member.ntdSurchargeAmountTwd)
  const breakdownMismatch = !cnyCharges.equals(cnyExpected) || !twdCharges.equals(twdExpected)

  const groups = new Map<SlhSettleAllocationTarget, SlhSettleAllocationItemView[]>()
  for (const item of items) {
    groups.set(item.target, [...(groups.get(item.target) ?? []), item])
  }
  const hasSettlementInput = member.codAmountTwd !== null
    || member.ntdSurchargeAmountTwd !== null
    || member.payableAmountCny !== null
  const parentSettlement = hasSettlementInput
    ? new Decimal(member.codAmountTwd ?? 0)
        .minus(member.ntdSurchargeAmountTwd ?? 0)
        .div(rateUnits)
        .minus(member.payableAmountCny ?? 0)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : null
  const parties: SlhSettleAllocationPartyView[] = [...groups.entries()].map(([target, groupItems]) => {
    const order = target === 'ORIGIN_ORDER' ? origin : target === 'CURRENT_ORDER' ? current : null
    const fee = groupItems.filter(item => item.sourceType === 'PAYMENT_FEE')
    return {
      target,
      salesOrderId: order?.id ?? null,
      salesOrderNo: order?.orderNo ?? null,
      settlementAmountCny: settleMoney(groupItems
        .filter(item => item.sourceType !== 'PAYMENT_FEE')
        .reduce((sum, item) => sum.plus(item.signedContributionCny), new Decimal(0))),
      paymentFeeAmountCny: fee.length === 0
        ? null
        : settleMoney(fee.reduce((sum, item) => sum.plus(item.amount), new Decimal(0))),
    }
  })
  if (parentSettlement !== null && parties.length > 0) {
    const sumParties = parties.reduce((sum, party) => sum.plus(party.settlementAmountCny ?? 0), new Decimal(0))
    const residual = parentSettlement.minus(sumParties).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    if (!residual.isZero()) {
      const target = parties.find(party => party.target === 'CURRENT_ORDER') ?? parties[0]!
      for (let index = 0; index < parties.length; index += 1) {
        const party = parties[index]!
        if (party.target === target.target) {
          parties[index] = {
            ...party,
            settlementAmountCny: new Decimal(party.settlementAmountCny ?? 0)
              .plus(residual)
              .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
              .toFixed(2),
          }
        }
      }
    }
  }

  return {
    items,
    parties,
    breakdownMismatch,
    reasonMissing,
    sourceMissing: false,
    payload: items
      .filter(item => item.overridden)
      .map(item => ({ key: item.key, target: item.target, reason: item.reason })),
  }
}
