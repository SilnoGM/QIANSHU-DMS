import type { SlhSettleAllocationPartyDirection } from './settle-modal.logic'
import type { SlhReconciliationSettlementRecordDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import Decimal from 'decimal.js'
// 运行时导入必须用相对路径：本文件被 node --test 从 web/ 根加载，@/ 别名解析不到。
import { EMPTY_AMOUNT_TEXT, formatCurrencyAmount } from '../../../components/base/AmountDisplay/format'
import { formatBareAmount, resolveSettleAllocationPartyDirection } from './settle-modal.logic'

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

/** 逐项分摊的一行：费用项、原币金额、入账目标与手工调整留痕。 */
export interface SlhReconciliationRecordAllocationItem {
  readonly id: string
  readonly label: string
  readonly amountText: string
  readonly currencyCode: string
  /** 台币项折算成人民币的贡献额；人民币项不重复展示。 */
  readonly contributionText: string | null
  readonly targetLabel: string
  readonly overridden: boolean
  readonly reason: string | null
}

/** 目标合计卡：历史快照里的目标与金额，不重算。 */
export interface SlhReconciliationRecordAllocationParty {
  readonly target: SlhReconciliationSettlementRecordDto['allocations'][number]['target']
  /** 无出单人时的角色文案；公司目标即「公司账户」。 */
  readonly title: string
  readonly salesOrderNo: string | null
  readonly issuerDisplayName: string | null
  readonly issuerAvatarUrl: string | null
  /** 调货行的原单/现单短标签；普通行与公司为 null。 */
  readonly shortRole: string | null
  readonly settlementAmountCny: string | null
  readonly paymentFeeAmountCny: string | null
  readonly direction: SlhSettleAllocationPartyDirection
}

/** 目标合计的汇总：用于与顶部结算金额比对。 */
export interface SlhReconciliationRecordAllocationTotals {
  readonly settlementAmountCny: string
  readonly paymentFeeAmountCny: string
  readonly matchesParent: boolean | null
}

/** 一条记录的入账分摊快照；历史记录没有该段时为 null。 */
export interface SlhReconciliationRecordAllocation {
  readonly itemCount: number
  readonly partyCount: number
  readonly items: readonly SlhReconciliationRecordAllocationItem[]
  readonly parties: readonly SlhReconciliationRecordAllocationParty[]
  readonly totals: SlhReconciliationRecordAllocationTotals
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
  readonly createdByAvatarUrl: string | null
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
  /** 区块级补充说明：选中的区块若在这里有键，就在计算式下面多给一句。 */
  readonly blockNoteKeys: Readonly<Partial<Record<SlhReconciliationRecordBlockId, string>>>
  readonly groups: readonly SlhReconciliationRecordGroup[]
  readonly allocation: SlhReconciliationRecordAllocation | null
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

/** 汇率只读展示统一两位小数；空值给占位符。 */
function rateText(value: string | null): string {
  if (value === null) {
    return MISSING
  }
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}

/** 费率按千分比展示（0.007 → 7‰）。 */
function permilleText(rate: string): string {
  return `${new Decimal(rate).times(1000).toFixed(0)}‰`
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

/** 一条分配快照：逐项目标、目标合计与父结算金额比对；历史无快照返回 null。 */
function buildRecordAllocation(
  record: SlhReconciliationSettlementRecordDto,
  currencies: readonly CurrencyDescriptor[],
  translate: (key: string, params?: Record<string, string>) => string,
): SlhReconciliationRecordAllocation | null {
  const allocations = record.allocations ?? []
  const allocationParties = record.allocationParties ?? []
  if (allocations.length === 0 && allocationParties.length === 0) {
    return null
  }
  const orderNoOf = (target: string): string | null => (
    target === 'COMPANY'
      ? null
      : allocationParties.find(party => party.target === target)?.salesOrderNo ?? null
  )
  const hasOrigin = allocationParties.some(party => party.target === 'ORIGIN_ORDER')
  const items: SlhReconciliationRecordAllocationItem[] = allocations.map((item, index) => {
    const labelKey = item.sourceType === 'BILL_CHARGE'
      ? `slhBill.chargeType.${item.chargeType ?? 'OTHER'}`
      : `slhReconciliation.settle.allocation.source${item.sourceType}`
    const targetKey = item.target === 'COMPANY'
      ? 'slhReconciliation.settle.allocation.targetCompany'
      : item.target === 'ORIGIN_ORDER'
        ? 'slhReconciliation.settle.allocation.targetOrigin'
        : hasOrigin
          ? 'slhReconciliation.settle.allocation.targetCurrentTransfer'
          : 'slhReconciliation.settle.allocation.targetCurrent'
    const orderNo = orderNoOf(item.target)
    return {
      id: `allocation-${item.key}-${index}`,
      label: translate(labelKey),
      amountText: formatBareAmount(item.amount, item.currencyCode, currencies),
      currencyCode: item.currencyCode,
      contributionText: item.currencyCode === 'CNY'
        ? null
        : showAmount(item.signedContributionCny, 'CNY', currencies),
      targetLabel: translate(targetKey, orderNo === null ? undefined : { orderNo }),
      overridden: item.overridden,
      reason: item.reason ?? null,
    }
  })
  const parties: SlhReconciliationRecordAllocationParty[] = allocationParties.map((party) => {
    return {
      target: party.target,
      title: translate(
        party.target === 'COMPANY'
          ? 'slhReconciliation.settle.allocation.partyCompany'
          : party.target === 'ORIGIN_ORDER'
            ? 'slhReconciliation.settle.allocation.partyOriginRole'
            : hasOrigin
              ? 'slhReconciliation.settle.allocation.partyCurrentTransferRole'
              : 'slhReconciliation.settle.allocation.partyCurrentRole',
      ),
      salesOrderNo: party.salesOrderNo ?? null,
      issuerDisplayName: party.issuerDisplayName ?? null,
      issuerAvatarUrl: party.issuerAvatarUrl ?? null,
      shortRole: hasOrigin && party.target !== 'COMPANY'
        ? translate(party.target === 'ORIGIN_ORDER'
            ? 'slhReconciliation.settle.allocation.partyOriginShort'
            : 'slhReconciliation.settle.allocation.partyCurrentShort')
        : null,
      settlementAmountCny: party.settlementAmountCny ?? null,
      paymentFeeAmountCny: party.paymentFeeAmountCny ?? null,
      direction: resolveSettleAllocationPartyDirection(party.settlementAmountCny ?? null),
    }
  })
  const settlementTotal = parties
    .reduce((sum, party) => sum.plus(party.settlementAmountCny ?? 0), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const paymentFeeTotal = parties
    .reduce((sum, party) => sum.plus(party.paymentFeeAmountCny ?? 0), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  return {
    itemCount: items.length,
    partyCount: parties.length,
    items,
    parties,
    totals: {
      settlementAmountCny: settlementTotal.toFixed(2),
      paymentFeeAmountCny: paymentFeeTotal.toFixed(2),
      matchesParent: record.settlementAmountCny === null || parties.length === 0
        ? null
        : settlementTotal.eq(new Decimal(record.settlementAmountCny)),
    },
  }
}

/** 一条记录 → 卡片。 */
export function buildSlhReconciliationRecordCard(
  record: SlhReconciliationSettlementRecordDto,
  currencies: readonly CurrencyDescriptor[],
  translate: (key: string, params?: Record<string, string>) => string = key => key,
): SlhReconciliationRecordCard {
  const rate = rateText(record.foreignUnitsPerCny)
  const feeRatePermille = permilleText(record.paymentFeeRate)
  const allocation = buildRecordAllocation(record, currencies, translate)

  return {
    id: record.id,
    status: record.status,
    statusKey: STATUS_KEYS[record.status],
    statusClass: STATUS_CLASSES[record.status],
    headerClass: HEADER_CLASSES[record.status],
    createdAt: record.createdAt,
    createdByDisplayName: record.createdByDisplayName,
    createdByAvatarUrl: record.createdByAvatarUrl ?? null,
    collapsedByDefault: record.status === 'SUPERSEDED',
    summaryAmountLabelKey: 'slhReconciliation.records.amountAtThatTime',
    summaryAmount: amount(record.settlementAmountCny, record.settlementCurrency, 'settlement'),
    summaryRateText: rate,
    // 摘要里把汇率来源一并给出，免得看历史的人还要猜 5.2 是哪一份汇率。
    summaryRateSourceKey: RATE_SOURCE_SHORT_KEYS[record.rateSource],
    summaryFeeRateText: feeRatePermille,
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
        // 与结算弹窗同一处文案键：同一概念只留一个键，避免两处措辞漂移。
        labelKey: 'slhReconciliation.settle.paymentFeeResult',
        amount: amount(record.paymentFeeAmountCny, record.paymentFeeCurrency, 'paymentFee'),
        rateLabelKey: 'slhReconciliation.settle.paymentFeeRate',
        rateText: feeRatePermille,
      },
    ],
    formulas: {
      settlement: `（${showAmount(record.codAmountTwd, record.codAmountCurrency, currencies)} − ${showAmount(record.ntdSurchargeAmountTwd, record.ntdSurchargeCurrency, currencies)}）÷ ${rate} − ${showAmount(record.payableAmountCny, record.payableCurrency, currencies)} = ${showAmount(record.settlementAmountCny, record.settlementCurrency, currencies)}`,
      paymentFee: `${showAmount(record.salesAmount, record.salesCurrency, currencies)} ÷ ${rate} × ${feeRatePermille} = ${showAmount(record.paymentFeeAmountCny, record.paymentFeeCurrency, currencies)}`,
    },
    // 费用是对整张销售订单收的：同一销售单的多行都记着同一个费用，实际入账只发生一次。
    blockNoteKeys: { paymentFee: 'slhReconciliation.settle.paymentFeeOncePerSalesOrder' },
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
    allocation,
  }
}

/** 列表 → 卡片列表：服务端已按时间倒序返回，这里保持顺序不动。 */
export function buildSlhReconciliationRecordCards(
  records: readonly SlhReconciliationSettlementRecordDto[],
  currencies: readonly CurrencyDescriptor[],
  translate: (key: string, params?: Record<string, string>) => string = key => key,
): readonly SlhReconciliationRecordCard[] {
  return records.map(record => buildSlhReconciliationRecordCard(record, currencies, translate))
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
