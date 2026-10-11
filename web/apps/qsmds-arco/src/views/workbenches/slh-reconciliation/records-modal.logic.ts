import type { SlhReconciliationSettlementRecordDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'

/**
 * 核对记录弹窗的卡片模型：把一条结算留痕摊平成「头部 + 汇率 + 金额 + 快照」四段。
 *
 * 金额一律按库里的「金额 + 币种」成对关系透传给 AmountDisplay（记录是数据行，不是算式，
 * 与结算弹窗里裸数字的展示口径刻意不同）；状态只有「有效 / 已被取代」两种。
 */

/** 记录卡片里的一个金额：标签文案键 + 原始金额 + 币种。 */
export interface SlhReconciliationRecordAmount {
  readonly id: string
  readonly labelKey: string
  readonly value: string | null
  readonly currencyCode: string
  /** 结算金额按符号着色、金流服务费恒红——与结算弹窗口径一致。 */
  readonly tone: 'settlement' | 'paymentFee' | 'plain'
}

/** 记录卡片：一条确认结算的完整留痕。 */
export interface SlhReconciliationRecordCard {
  readonly id: string
  readonly status: SlhReconciliationSettlementRecordDto['status']
  readonly statusKey: string
  /** 状态标签的描边与文字色（与批次状态标签同款 outline 变体，不铺底色）。 */
  readonly statusClass: string
  readonly rateSourceKey: string
  readonly rate: string
  readonly paymentFeeRate: string
  readonly createdAt: string
  readonly createdByDisplayName: string
  readonly amounts: readonly SlhReconciliationRecordAmount[]
  /** 留痕来源：账单号 · 唛头 · 入仓单号 · 柜次 · 货件号 · 两张订单号，缺值用占位符。 */
  readonly references: readonly string[]
}

const MISSING = '—'

/** 汇率来源与状态、金额标签都用页面已有的域内键，保证同一概念只有一套叫法。 */
const RATE_SOURCE_KEYS: Readonly<Record<SlhReconciliationSettlementRecordDto['rateSource'], string>> = {
  EMBEDDED: 'slhReconciliation.settle.billRate',
  SYSTEM: 'slhReconciliation.settle.systemRate',
}
const STATUS_KEYS: Readonly<Record<SlhReconciliationSettlementRecordDto['status'], string>> = {
  ACTIVE: 'slhReconciliation.records.statusActive',
  SUPERSEDED: 'slhReconciliation.records.statusSuperseded',
}
/** 有效沿用已完成批次的绿色，被取代用中性色——同一行最多一条有效，绿标签不会出现两次。 */
const STATUS_CLASSES: Readonly<Record<SlhReconciliationSettlementRecordDto['status'], string>> = {
  ACTIVE: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  SUPERSEDED: 'border-border text-muted-foreground',
}

function text(value: string | null): string {
  return value === null || value.trim() === '' ? MISSING : value
}

/** 一条记录 → 卡片：金额顺序与结算弹窗一致，快照行只给核对来源需要的信息。 */
export function buildSlhReconciliationRecordCard(
  record: SlhReconciliationSettlementRecordDto,
): SlhReconciliationRecordCard {
  return {
    id: record.id,
    status: record.status,
    statusKey: STATUS_KEYS[record.status],
    statusClass: STATUS_CLASSES[record.status],
    rateSourceKey: RATE_SOURCE_KEYS[record.rateSource],
    rate: record.foreignUnitsPerCny,
    paymentFeeRate: record.paymentFeeRate,
    createdAt: record.createdAt,
    createdByDisplayName: record.createdByDisplayName,
    amounts: [
      { id: 'codAmountTwd', labelKey: 'slhReconciliation.settle.codAmount', value: record.codAmountTwd, currencyCode: record.codAmountCurrency, tone: 'plain' },
      { id: 'ntdSurchargeAmountTwd', labelKey: 'slhReconciliation.settle.ntdDeduction', value: record.ntdSurchargeAmountTwd, currencyCode: record.ntdSurchargeCurrency, tone: 'plain' },
      { id: 'payableAmountCny', labelKey: 'slhReconciliation.settle.payableTotal', value: record.payableAmountCny, currencyCode: record.payableCurrency, tone: 'plain' },
      { id: 'settlementAmountCny', labelKey: 'slhReconciliation.settle.settlementResult', value: record.settlementAmountCny, currencyCode: record.settlementCurrency, tone: 'settlement' },
      { id: 'salesAmount', labelKey: 'slhReconciliation.detail.salesTotalAmount', value: record.salesAmount, currencyCode: record.salesCurrency, tone: 'plain' },
      { id: 'paymentFeeAmountCny', labelKey: 'slhReconciliation.settle.paymentFeeResult', value: record.paymentFeeAmountCny, currencyCode: record.paymentFeeCurrency, tone: 'paymentFee' },
    ],
    references: [
      record.slhBillNo,
      `${text(record.shippingMarkText)} · ${record.warehouseReceiptReference === null ? MISSING : record.warehouseReceiptReference}`,
      `${record.containerBatchNo} · ${text(record.shipmentNo)}`,
      `${record.salesOrderNo} · ${record.purchaseOrderNo}`,
    ],
  }
}

/** 列表 → 卡片列表：服务端已按时间倒序返回，这里保持顺序不动。 */
export function buildSlhReconciliationRecordCards(
  records: readonly SlhReconciliationSettlementRecordDto[],
): readonly SlhReconciliationRecordCard[] {
  return records.map(buildSlhReconciliationRecordCard)
}

/** 金额行的颜色：结算金额按符号（负红/正绿/零与空中性），金流服务费恒红，其余用默认前景色。 */
export function resolveRecordAmountTone(
  amount: SlhReconciliationRecordAmount,
): 'danger' | 'neutral' | 'success' {
  if (amount.tone === 'paymentFee') {
    return 'danger'
  }
  if (amount.tone !== 'settlement' || amount.value === null) {
    return 'neutral'
  }
  const value = new Decimal(amount.value)
  if (value.isZero()) {
    return 'neutral'
  }
  return value.isNegative() ? 'danger' : 'success'
}
