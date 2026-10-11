import type { SlhReconciliationSettlementRecordDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import Decimal from 'decimal.js'
// 运行时导入必须用相对路径：本文件被 node --test 从 web/ 根加载，@/ 别名解析不到。
import { EMPTY_AMOUNT_TEXT, formatCurrencyAmount } from '../../../components/base/AmountDisplay/format'

/**
 * 核对记录卡片模型：把一条结算留痕摊平成「头部 + 两个大区块 + 公式 + 三段信息」。
 *
 * - 金额按库里的「金额 + 币种」成对关系透传给 AmountDisplay；汇率与费率作区块内辅助文字。
 * - 两个大区块各带一条**代入后**的计算式，公式区域点选哪块就显示哪条。
 * - 已被取代的记录默认只显示一行摘要，展开后与当前有效记录同一套版式。
 */

/** 大区块：结算金额与金流费用。 */
export type SlhReconciliationRecordBlockId = 'paymentFee' | 'settlement'

/** 记录卡片里的一个金额：原始金额 + 币种 + 着色口径。 */
export interface SlhReconciliationRecordAmount {
  readonly value: string | null
  readonly currencyCode: string
  readonly tone: 'neutral' | 'paymentFee' | 'settlement'
}

/** 大区块：一个大号金额 + 区块内的汇率/费率辅助文字。 */
export interface SlhReconciliationRecordBlock {
  readonly id: SlhReconciliationRecordBlockId
  readonly labelKey: string
  readonly amount: SlhReconciliationRecordAmount
  /** 区块内辅助文字的标签（结算汇率 / 金流费率）与取值。 */
  readonly rateLabelKey: string
  readonly rateText: string
}

/** 信息组里的一行：短标签 + 值（完整文本另给，供截断时悬停查看）。 */
export interface SlhReconciliationRecordGroupRow {
  readonly id: string
  readonly label: string
  readonly value: string
}

/** 信息组：订单信息 / 运输信息 / 账单信息。 */
export interface SlhReconciliationRecordGroup {
  readonly id: string
  readonly titleKey: string
  readonly icon: string
  readonly titleClass: string
  readonly rows: readonly SlhReconciliationRecordGroupRow[]
}

/** 记录卡片：一条确认结算的完整留痕。 */
export interface SlhReconciliationRecordCard {
  readonly id: string
  readonly status: SlhReconciliationSettlementRecordDto['status']
  readonly statusKey: string
  /** 状态标签与头部底条的配色（当前有效绿、已被取代中性）。 */
  readonly statusClass: string
  readonly headerClass: string
  readonly createdAt: string
  readonly createdByDisplayName: string
  /** 已被取代的记录默认折起，展开后与当前有效同一套版式。 */
  readonly collapsedByDefault: boolean
  /** 折叠态摘要：当时结算金额 + 汇率（含来源）+ 费率。 */
  readonly summaryAmountLabelKey: string
  readonly summaryAmount: SlhReconciliationRecordAmount
  readonly summaryRateText: string
  readonly summaryRateSourceKey: string
  readonly summaryFeeRateText: string
  readonly blocks: readonly SlhReconciliationRecordBlock[]
  /** 两条计算式（代入后的数值），键与大区块 id 一致。 */
  readonly formulas: Readonly<Record<SlhReconciliationRecordBlockId, string>>
  readonly groups: readonly SlhReconciliationRecordGroup[]
}

const MISSING = EMPTY_AMOUNT_TEXT

/** 状态、来源与标签都用页面已有的域内键，保证同一概念只有一套叫法。 */
const STATUS_KEYS: Readonly<Record<SlhReconciliationSettlementRecordDto['status'], string>> = {
  ACTIVE: 'slhReconciliation.records.statusActive',
  SUPERSEDED: 'slhReconciliation.records.statusSuperseded',
}
const RATE_SOURCE_SHORT_KEYS: Readonly<Record<SlhReconciliationSettlementRecordDto['rateSource'], string>> = {
  EMBEDDED: 'slhReconciliation.records.rateSourceEmbeddedShort',
  SYSTEM: 'slhReconciliation.records.rateSourceSystemShort',
}
/** 有效沿用已完成批次的绿色，被取代用中性色——同一行最多一条有效，绿标签不会出现两次。 */
const STATUS_CLASSES: Readonly<Record<SlhReconciliationSettlementRecordDto['status'], string>> = {
  ACTIVE: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  SUPERSEDED: 'border-border text-muted-foreground',
}
/** 头部整条底色跟着状态走：有效那层浅绿是「这条当前在生效」的视觉提示。 */
const HEADER_CLASSES: Readonly<Record<SlhReconciliationSettlementRecordDto['status'], string>> = {
  ACTIVE: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  SUPERSEDED: 'border-border bg-muted/40',
}

function text(value: string | null): string {
  return value === null || value.trim() === '' ? MISSING : value
}

/** 汇率去尾零展示（契约 12 位小数，与结算弹窗同一口径）；空值给占位符。 */
function trimDecimal(value: string | null): string {
  if (value === null) {
    return MISSING
  }
  if (!value.includes('.')) {
    return value
  }
  return value.replace(/0+$/u, '').replace(/\.$/u, '')
}

/** 费率按百分比展示（0.007 → 0.7%）。 */
function percentText(rate: string): string {
  return `${new Decimal(rate).times(100).toString()}%`
}

/** 计算式里的金额：与 AmountDisplay 同一处格式化（符号、千分位、精度）；空值保留占位符，不按 0 改写历史。 */
function showAmount(value: string | null, currencyCode: string, currencies: readonly CurrencyDescriptor[]): string {
  if (value === null || value.trim() === '') {
    return MISSING
  }
  return formatCurrencyAmount(value, currencyCode, currencies)
}

function amount(value: string | null, currencyCode: string, tone: SlhReconciliationRecordAmount['tone']): SlhReconciliationRecordAmount {
  return { value, currencyCode, tone }
}

/** 一条记录 → 卡片。 */
export function buildSlhReconciliationRecordCard(
  record: SlhReconciliationSettlementRecordDto,
  currencies: readonly CurrencyDescriptor[],
): SlhReconciliationRecordCard {
  const rate = trimDecimal(record.foreignUnitsPerCny)
  const feeRatePercent = percentText(record.paymentFeeRate)

  return {
    id: record.id,
    status: record.status,
    statusKey: STATUS_KEYS[record.status],
    statusClass: STATUS_CLASSES[record.status],
    headerClass: HEADER_CLASSES[record.status],
    createdAt: record.createdAt,
    createdByDisplayName: record.createdByDisplayName,
    collapsedByDefault: record.status === 'SUPERSEDED',
    summaryAmountLabelKey: 'slhReconciliation.records.amountAtThatTime',
    summaryAmount: amount(record.settlementAmountCny, record.settlementCurrency, 'settlement'),
    summaryRateText: rate,
    // 摘要里把汇率来源一并给出，免得看历史的人还要猜 5.2 是哪一份汇率。
    summaryRateSourceKey: RATE_SOURCE_SHORT_KEYS[record.rateSource],
    summaryFeeRateText: feeRatePercent,
    blocks: [
      {
        id: 'settlement',
        labelKey: 'slhReconciliation.settle.settlementResult',
        amount: amount(record.settlementAmountCny, record.settlementCurrency, 'settlement'),
        rateLabelKey: 'slhReconciliation.settle.rateRow',
        rateText: rate,
      },
      {
        id: 'paymentFee',
        labelKey: 'slhReconciliation.records.paymentFeeLabel',
        amount: amount(record.paymentFeeAmountCny, record.paymentFeeCurrency, 'paymentFee'),
        rateLabelKey: 'slhReconciliation.settle.paymentFeeRate',
        rateText: feeRatePercent,
      },
    ],
    formulas: {
      settlement: `（${showAmount(record.codAmountTwd, record.codAmountCurrency, currencies)} − ${showAmount(record.ntdSurchargeAmountTwd, record.ntdSurchargeCurrency, currencies)}）÷ ${rate} − ${showAmount(record.payableAmountCny, record.payableCurrency, currencies)} = ${showAmount(record.settlementAmountCny, record.settlementCurrency, currencies)}`,
      paymentFee: `${showAmount(record.salesAmount, record.salesCurrency, currencies)} ÷ ${rate} × ${feeRatePercent} = ${showAmount(record.paymentFeeAmountCny, record.paymentFeeCurrency, currencies)}`,
    },
    groups: [
      {
        id: 'orders',
        titleKey: 'slhReconciliation.records.ordersTitle',
        icon: 'i-lucide:file-text',
        titleClass: 'text-sky-700 dark:text-sky-300',
        rows: [
          { id: 'sales', label: '销', value: record.salesOrderNo },
          { id: 'purchase', label: '采', value: record.purchaseOrderNo },
        ],
      },
      {
        id: 'transport',
        titleKey: 'slhReconciliation.records.transportTitle',
        icon: 'i-lucide:arrow-left-right',
        titleClass: 'text-amber-700 dark:text-amber-300',
        rows: [
          { id: 'container', label: '柜号', value: record.containerBatchNo },
          { id: 'shipment', label: '货件', value: text(record.shipmentNo) },
        ],
      },
      {
        id: 'bill',
        titleKey: 'slhReconciliation.records.billTitle',
        icon: 'i-lucide:package',
        titleClass: 'text-indigo-700 dark:text-indigo-300',
        rows: [
          { id: 'billNo', label: '账单', value: record.slhBillNo },
          {
            id: 'receiptMark',
            label: '入仓/唛头',
            value: `${text(record.warehouseReceiptReference)} / ${text(record.shippingMarkText)}`,
          },
        ],
      },
    ],
  }
}

/** 列表 → 卡片列表：服务端已按时间倒序返回，这里保持顺序不动。 */
export function buildSlhReconciliationRecordCards(
  records: readonly SlhReconciliationSettlementRecordDto[],
  currencies: readonly CurrencyDescriptor[],
): readonly SlhReconciliationRecordCard[] {
  return records.map(record => buildSlhReconciliationRecordCard(record, currencies))
}

/** 金额着色：结算金额按符号（负红/正绿/零与空中性），金流费用恒红，其余用默认前景色。 */
export function resolveRecordAmountTone(
  value: SlhReconciliationRecordAmount,
): 'danger' | 'neutral' | 'success' {
  if (value.tone === 'paymentFee') {
    return 'danger'
  }
  if (value.tone !== 'settlement' || value.value === null) {
    return 'neutral'
  }
  const decimal = new Decimal(value.value)
  if (decimal.isZero()) {
    return 'neutral'
  }
  return decimal.isNegative() ? 'danger' : 'success'
}
