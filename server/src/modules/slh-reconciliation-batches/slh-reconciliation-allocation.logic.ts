import { Prisma } from '../../generated/prisma/client'

const Decimal = Prisma.Decimal
type DecimalValue = InstanceType<typeof Decimal>

/** 财务最终可选择的入账目标。 */
export const SLH_ALLOCATION_TARGETS = [
  'ORIGIN_ORDER',
  'CURRENT_ORDER',
  'COMPANY',
] as const
export type SlhAllocationTarget = typeof SLH_ALLOCATION_TARGETS[number]

export type SlhAllocationSourceType
  = | 'BILL_CHARGE'
    | 'FREIGHT'
    | 'COD_HANDLING'
    | 'COD'
    | 'PAYMENT_FEE'

/** 默认归甲（原销售单）的费用类型；其余费用默认归乙，COD 和金流费也归乙。 */
const ORIGIN_CHARGE_TYPES = new Set(['REDELIVERY', 'TRANSFER_DELIVERY', 'STORAGE'])

export interface SlhAllocationChargeInput {
  readonly id: string
  readonly chargeType: string
  readonly currencyCode: 'CNY' | 'TWD'
  readonly amount: string | null
}

export interface SlhAllocationOrder {
  readonly id: string
  readonly orderNo: string
  readonly currencyCode: string
  readonly agreedTotalAmount: string
}

export interface SlhAllocationOverride {
  readonly key: string
  readonly target: SlhAllocationTarget
  readonly reason?: string | null
}

export interface SlhAllocationInput {
  readonly charges: readonly SlhAllocationChargeInput[]
  readonly freightAmountCny: string | null
  readonly codHandlingAmountCny: string | null
  readonly surchargeAmountCny: string | null
  readonly codAmountTwd: string | null
  readonly ntdSurchargeAmountTwd: string | null
  readonly payableAmountCny: string | null
  readonly originSalesOrder: SlhAllocationOrder
  readonly currentSalesOrder: SlhAllocationOrder
  readonly rate: string
  readonly paymentFeeRate: string
  readonly overrides?: readonly SlhAllocationOverride[]
}

export interface SlhAllocationItem {
  readonly key: string
  readonly sourceType: SlhAllocationSourceType
  readonly chargeType: string | null
  readonly currencyCode: 'CNY' | 'TWD'
  readonly amount: string
  readonly defaultTarget: SlhAllocationTarget
  readonly target: SlhAllocationTarget
  readonly signedContributionCny: string
  readonly overridden: boolean
  readonly reason: string | null
}

export interface SlhAllocationParty {
  readonly target: SlhAllocationTarget
  readonly salesOrderId: string | null
  readonly salesOrderNo: string | null
  readonly codAmountTwd: string | null
  readonly ntdSurchargeAmountTwd: string | null
  readonly payableAmountCny: string | null
  readonly settlementAmountCny: string | null
  readonly salesAmount: string | null
  readonly paymentFeeAmountCny: string | null
}

export interface SlhAllocationResult {
  readonly items: readonly SlhAllocationItem[]
  readonly parties: readonly SlhAllocationParty[]
  readonly parent: {
    readonly codAmountTwd: string | null
    readonly ntdSurchargeAmountTwd: string | null
    readonly payableAmountCny: string | null
    readonly settlementAmountCny: string | null
    readonly salesAmount: string | null
    readonly paymentFeeAmountCny: string | null
  }
}

export class SlhAllocationError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage)
    this.name = 'SlhAllocationError'
  }
}

function amount(value: string | null): DecimalValue | null {
  return value === null || value.trim() === '' ? null : new Decimal(value)
}

function money(value: DecimalValue | null): string | null {
  return value === null ? null : value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}

function defaultTargetForCharge(chargeType: string): SlhAllocationTarget {
  return ORIGIN_CHARGE_TYPES.has(chargeType) ? 'ORIGIN_ORDER' : 'CURRENT_ORDER'
}

/**
 * 费用明细必须能还原账单的两个杂费口径，否则无法逐项分摊：
 * 人民币费用合计＝附加费、台币费用合计＝NTD 杂费。备注解析与账单列不一致的账单先修数据。
 */
function validateChargeBreakdown(input: SlhAllocationInput): void {
  const cnyCharges = input.charges
    .filter(charge => charge.currencyCode === 'CNY')
    .reduce((sum, charge) => sum.plus(charge.amount ?? 0), new Decimal(0))
  const twdCharges = input.charges
    .filter(charge => charge.currencyCode === 'TWD')
    .reduce((sum, charge) => sum.plus(charge.amount ?? 0), new Decimal(0))
  const cnyExpected = amount(input.surchargeAmountCny) ?? new Decimal(0)
  const twdExpected = amount(input.ntdSurchargeAmountTwd) ?? new Decimal(0)
  if (!cnyCharges.equals(cnyExpected) || !twdCharges.equals(twdExpected)) {
    throw new SlhAllocationError(
      'SLH_RECON_ALLOCATION_BREAKDOWN_MISMATCH',
      '账单费用明细与附加费/NTD杂费不一致，无法拆分入账目标；请核对备注费用后重新导入账单',
    )
  }
}

function buildItems(input: SlhAllocationInput): Omit<SlhAllocationItem, 'target' | 'signedContributionCny' | 'overridden' | 'reason'>[] {
  const items: Omit<SlhAllocationItem, 'target' | 'signedContributionCny' | 'overridden' | 'reason'>[] = []
  for (const charge of input.charges) {
    if (charge.amount !== null && charge.amount.trim() !== '') {
      items.push({
        key: `CHARGE:${charge.id}`,
        sourceType: 'BILL_CHARGE',
        chargeType: charge.chargeType,
        currencyCode: charge.currencyCode,
        amount: charge.amount,
        defaultTarget: defaultTargetForCharge(charge.chargeType),
      })
    }
  }
  if (input.freightAmountCny !== null) {
    items.push({
      key: 'FREIGHT',
      sourceType: 'FREIGHT',
      chargeType: 'FREIGHT',
      currencyCode: 'CNY',
      amount: input.freightAmountCny,
      defaultTarget: 'CURRENT_ORDER',
    })
  }
  if (input.codHandlingAmountCny !== null) {
    items.push({
      key: 'COD_HANDLING',
      sourceType: 'COD_HANDLING',
      chargeType: 'COD_HANDLING',
      currencyCode: 'CNY',
      amount: input.codHandlingAmountCny,
      defaultTarget: 'CURRENT_ORDER',
    })
  }
  if (input.codAmountTwd !== null) {
    items.push({
      key: 'COD',
      sourceType: 'COD',
      chargeType: null,
      currencyCode: 'TWD',
      amount: input.codAmountTwd,
      defaultTarget: 'CURRENT_ORDER',
    })
  }
  const fee = calculatePaymentFee(input.currentSalesOrder.agreedTotalAmount, input.rate, input.paymentFeeRate)
  if (fee !== null) {
    items.push({
      key: 'PAYMENT_FEE',
      sourceType: 'PAYMENT_FEE',
      chargeType: null,
      currencyCode: 'CNY',
      amount: fee,
      defaultTarget: 'CURRENT_ORDER',
    })
  }
  return items
}

function calculatePaymentFee(salesAmount: string, rate: string, feeRate: string): string | null {
  const rateUnits = new Decimal(rate)
  if (rateUnits.isZero()) {
    return null
  }
  return new Decimal(salesAmount)
    .div(rateUnits)
    .times(feeRate)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2)
}

function resolveTarget(
  item: { key: string, sourceType: SlhAllocationSourceType, defaultTarget: SlhAllocationTarget },
  override: SlhAllocationOverride | undefined,
  sameOrder: boolean,
): { target: SlhAllocationTarget, overridden: boolean, reason: string | null } {
  const target = override?.target ?? item.defaultTarget
  if (item.sourceType === 'COD' && target !== 'CURRENT_ORDER') {
    throw new SlhAllocationError(
      'SLH_RECON_ALLOCATION_COD_TARGET_INVALID',
      '代收货款只能归当前销售订单，不能改到甲或公司',
    )
  }
  if (override !== undefined && override.target !== item.defaultTarget && (override.reason ?? '').trim() === '') {
    throw new SlhAllocationError(
      'SLH_RECON_ALLOCATION_REASON_REQUIRED',
      '手动调整入账目标时必须填写原因',
    )
  }
  return {
    target: sameOrder && target === 'ORIGIN_ORDER' ? 'CURRENT_ORDER' : target,
    overridden: override !== undefined && override.target !== item.defaultTarget,
    reason: override?.reason?.trim() || null,
  }
}

function signedContribution(
  item: { sourceType: SlhAllocationSourceType, currencyCode: 'CNY' | 'TWD', amount: string },
  rate: string,
): DecimalValue {
  const amountValue = new Decimal(item.amount)
  if (item.sourceType === 'COD') {
    return amountValue.div(rate)
  }
  if (item.currencyCode === 'TWD') {
    return amountValue.div(rate).negated()
  }
  return amountValue.negated()
}

/**
 * 生成账单行的费用分摊。默认目标按费用类型确定；财务覆写只改目标，不改金额。
 * 父级六金额仍沿用原结算公式，分摊尾差并入当前销售订单，确保父级金额不变。
 */
export function buildSlhSettlementAllocation(input: SlhAllocationInput): SlhAllocationResult {
  const rate = new Decimal(input.rate)
  if (rate.isZero()) {
    throw new SlhAllocationError('SLH_RECON_ALLOCATION_RATE_INVALID', '汇率不能为零')
  }
  const sameOrder = input.originSalesOrder.id === input.currentSalesOrder.id
  const overrideByKey = new Map<string, SlhAllocationOverride>()
  for (const override of input.overrides ?? []) {
    if (overrideByKey.has(override.key)) {
      throw new SlhAllocationError('SLH_RECON_ALLOCATION_OVERRIDE_INVALID', '同一费用项不能重复调整入账目标')
    }
    overrideByKey.set(override.key, override)
  }
  validateChargeBreakdown(input)
  const baseItems = buildItems(input)
  const knownKeys = new Set(baseItems.map(item => item.key))
  for (const key of overrideByKey.keys()) {
    if (!knownKeys.has(key)) {
      throw new SlhAllocationError('SLH_RECON_ALLOCATION_OVERRIDE_INVALID', '费用项已变化，请刷新后重新确认')
    }
  }

  const items: SlhAllocationItem[] = baseItems.map((item) => {
    const resolved = resolveTarget(item, overrideByKey.get(item.key), sameOrder)
    return {
      ...item,
      target: resolved.target,
      signedContributionCny: signedContribution(item, input.rate).toString(),
      overridden: resolved.overridden,
      reason: resolved.reason,
    }
  })

  const group = new Map<SlhAllocationTarget, SlhAllocationItem[]>()
  for (const item of items) {
    group.set(item.target, [...(group.get(item.target) ?? []), item])
  }

  const parentCod = amount(input.codAmountTwd)
  const parentNtd = amount(input.ntdSurchargeAmountTwd)
  const parentPayable = amount(input.payableAmountCny)
  const hasSettlementInput = parentCod !== null || parentNtd !== null || parentPayable !== null
  const parentSettlement = hasSettlementInput
    ? (parentCod ?? new Decimal(0))
        .minus(parentNtd ?? new Decimal(0))
        .div(rate)
        .minus(parentPayable ?? new Decimal(0))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : null
  const parentFee = items.find(item => item.sourceType === 'PAYMENT_FEE')?.amount ?? null

  const parties: SlhAllocationParty[] = [...group.entries()].map(([target, groupItems]) => {
    const order = target === 'ORIGIN_ORDER'
      ? input.originSalesOrder
      : target === 'CURRENT_ORDER' ? input.currentSalesOrder : null
    const cod = groupItems.filter(item => item.sourceType === 'COD')
    const ntd = groupItems.filter(item => item.currencyCode === 'TWD' && item.sourceType !== 'COD')
    const payable = groupItems.filter(item => item.currencyCode === 'CNY' && item.sourceType !== 'PAYMENT_FEE')
    const fee = groupItems.filter(item => item.sourceType === 'PAYMENT_FEE')
    return {
      target,
      salesOrderId: order?.id ?? null,
      salesOrderNo: order?.orderNo ?? null,
      codAmountTwd: cod.length === 0
        ? null
        : cod.reduce((sum, item) => sum.plus(item.amount), new Decimal(0)).toFixed(2),
      ntdSurchargeAmountTwd: ntd.length === 0
        ? null
        : money(ntd.reduce((sum, item) => sum.plus(item.amount), new Decimal(0))),
      payableAmountCny: payable.length === 0
        ? null
        : money(payable.reduce((sum, item) => sum.plus(item.amount), new Decimal(0))),
      // 金流费是独立资金动作，单列在 paymentFeeAmountCny；结算金额只累计本行的钱，
      // 否则完成批次时会给同一笔费用重复入账。
      settlementAmountCny: money(groupItems
        .filter(item => item.sourceType !== 'PAYMENT_FEE')
        .reduce((sum, item) => sum.plus(item.signedContributionCny), new Decimal(0))),
      salesAmount: target === 'CURRENT_ORDER' && order !== null
        ? new Decimal(order.agreedTotalAmount).toFixed(2)
        : null,
      paymentFeeAmountCny: fee.length === 0
        ? null
        : money(fee.reduce((sum, item) => sum.plus(item.amount), new Decimal(0))),
    }
  })

  // 分摊按目标分别取整后可能与原整行公式差 1 分，尾差归当前销售订单/第一个分摊组。
  if (parentSettlement !== null && parties.length > 0) {
    const sumParties = parties.reduce(
      (sum, party) => sum.plus(party.settlementAmountCny ?? 0),
      new Decimal(0),
    )
    const residual = parentSettlement.minus(sumParties).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    if (!residual.isZero()) {
      const target = parties.find(party => party.target === 'CURRENT_ORDER') ?? parties[0]
      for (let index = 0; index < parties.length; index += 1) {
        const party = parties[index]
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
    parent: {
      codAmountTwd: money(parentCod),
      ntdSurchargeAmountTwd: money(parentNtd),
      payableAmountCny: money(parentPayable),
      settlementAmountCny: money(parentSettlement),
      salesAmount: new Decimal(input.currentSalesOrder.agreedTotalAmount).toFixed(2),
      paymentFeeAmountCny: parentFee,
    },
  }
}

/** 快照比较用：JSONB 会重排对象键，逐字符比较前必须先做稳定序列化。 */
export function canonicalAllocationJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalAllocationJson(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => (
    `${JSON.stringify(key)}:${canonicalAllocationJson(record[key])}`
  )).join(',')}}`
}

/** 读回分摊快照：历史结算没有快照，返回 null 让调用方按旧口径展示。 */
export function readAllocationSnapshot(value: Prisma.JsonValue): SlhAllocationResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  return Array.isArray(record['items']) && Array.isArray(record['parties'])
    ? value as unknown as SlhAllocationResult
    : null
}
