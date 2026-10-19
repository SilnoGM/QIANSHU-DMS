import { Prisma } from '../../generated/prisma/client'
import type { StoredDictionaryValueResolution } from '../dictionaries/dictionary-lookup.service'
import { purchaseOrderSupplierFromSources } from '../purchase-orders/purchase-order-query.service'
import {
  formatPurchaseOrderAmountUnits,
  parsePurchaseOrderAmountUnits,
  sumPurchaseOrderPaidUnits,
} from '../purchase-orders/domain/purchase-order-decimal'
import {
  formatSalesOrderAmountUnits,
  parseSalesOrderAmountUnits,
  sumSalesOrderReceivedUnits,
} from '../sales-orders/domain/sales-order-decimal'
import { resolveSlhBillReconciliationStatus } from '../slh-bills/slh-bill-reconciliation'
import { serializeSlhBillLine, serializeStoredFindings } from '../slh-bills/slh-bill.serializer'
import type { SlhBillReconciliationStatusDto } from '../slh-bills/slh-bill.dto'
import type {
  SlhBillLineMatchSourceDto, SlhReconciliationBatchDetailDto, SlhReconciliationBatchListItemDto,
  SlhReconciliationBatchMemberDto,
} from './slh-reconciliation-batch.dto'
import { SlhReconciliationBatchStatusDto } from './slh-reconciliation-batch.dto'

const iso = (value: Date): string => value.toISOString()
const isoDate = (value: Date): string => value.toISOString().slice(0, 10)

/**
 * 批次头与账单摘要。账单三态仍由明细行派生（与账单列表共用同一个派生函数），
 * 批次自己只提供「成员数 / 已核对成员数」两个计数。
 */
const batchHeaderInclude = {
  bill: {
    select: {
      id: true, slhBillNo: true, billName: true, periodStart: true, periodEnd: true, lineCount: true,
      _count: { select: { lines: { where: { reconciledAt: { not: null } } } } },
    },
  },
  createdBy: { select: { displayName: true } },
  completedBy: { select: { displayName: true } },
  members: { select: { reconciledAt: true } },
} satisfies Prisma.SlhReconciliationBatchInclude

export const slhReconciliationBatchListInclude = batchHeaderInclude

/** 详情多取成员行本身与账单导入快照的 findings（成员为空时两者分别是空数组）。 */
export const slhReconciliationBatchDetailInclude = {
  ...batchHeaderInclude,
  bill: { select: { ...batchHeaderInclude.bill.select, importFindings: true } },
  members: {
    // 账单行号顺序：与批次完成时的成员遍历同序（见 service 的完成查询），
    // 保证「详情第一行」与「费用归属那一行」是同一行，展示顺序也与账单原表一致。
    orderBy: [{ line: { lineNumber: 'asc' } }, { id: 'asc' }],
    include: {
      line: { include: { charges: true } },
      matchedLoadingItem: {
        select: {
          lineNumber: true, warehouseReceiptReference: true, oceanShippingMarkText: true, goodsName: true,
          packageCount: true, packageUnit: true, grossWeightKg: true, lengthCm: true, widthCm: true, heightCm: true,
          volumeCai: true, chargeableVolumeCai: true, reportedVolumeCai: true, codAmountTwd: true,
          recipientName: true, recipientPhone: true, recipientAddress: true, remark: true,
          containerBatch: { select: { containerBatchName: true } },
          // 来源链路与匹配器的合格判定同一条：装柜行 → 货件 → 采购订单 → 销售订单。
          // 只取对账页要展示的列，采购/销售的金额聚合口径不在这里重复实现。
          shipment: {
            select: {
              shipmentNo: true,
              purchaseOrder: {
                select: {
                  id: true, orderNo: true, orderStatus: true, purchaseTotalAmount: true,
                  depositDueAmount: true, balanceDueAmount: true,
                  fulfillmentStatus: true, paymentStatus: true, shippingMarkText: true,
                  supplierValue: true, customSupplierName: true,
                  // 实际已付款沿用采购域的累加口径，需要未作废的付款记录。
                  payments: { select: { amount: true, voidedAt: true } },
                  // 采购人是采购列表那一列的同源字段。
                  createdBy: { select: { displayName: true } },
                  salesOrder: {
                    select: {
                      id: true, orderNo: true, orderStatus: true,
                      currencyCode: true, customerName: true, customerPhone: true,
                      customerFullAddressSnapshot: true,
                      agreedTotalAmount: true, depositDueAmount: true, balanceDueAmount: true,
                      fulfillmentStatus: true, paymentStatus: true,
                      // 实际已收款沿用销售域的累加口径，需要未作废的收款记录。
                      payments: { select: { amount: true, voidedAt: true } },
                      issuer: { select: { displayName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      reconciledBy: { select: { displayName: true } },
    },
  },
} satisfies Prisma.SlhReconciliationBatchInclude

type BatchHeaderRow = Prisma.SlhReconciliationBatchGetPayload<{ include: typeof batchHeaderInclude }>
export type SlhReconciliationBatchDetailRow = Prisma.SlhReconciliationBatchGetPayload<{ include: typeof slhReconciliationBatchDetailInclude }>
type BatchMemberRow = SlhReconciliationBatchDetailRow['members'][number]

function batchStatus(completedAt: Date | null): SlhReconciliationBatchStatusDto {
  return completedAt === null ? SlhReconciliationBatchStatusDto.IN_PROGRESS : SlhReconciliationBatchStatusDto.COMPLETED
}

function serializeBatchHeader(row: BatchHeaderRow): SlhReconciliationBatchListItemDto {
  return {
    id: row.id,
    batchNo: row.batchNo,
    status: batchStatus(row.completedAt),
    bill: {
      id: row.bill.id,
      slhBillNo: row.bill.slhBillNo,
      billName: row.bill.billName,
      periodStart: isoDate(row.bill.periodStart),
      periodEnd: isoDate(row.bill.periodEnd),
      reconciliationStatus: resolveSlhBillReconciliationStatus({
        lineCount: row.bill.lineCount,
        reconciledLineCount: row.bill._count.lines,
      }) as SlhBillReconciliationStatusDto,
      lineCount: row.bill.lineCount,
      reconciledLineCount: row.bill._count.lines,
    },
    memberCount: row.members.length,
    reconciledMemberCount: row.members.filter(member => member.reconciledAt !== null).length,
    createdByDisplayName: row.createdBy.displayName,
    createdAt: iso(row.createdAt),
    completedAt: row.completedAt === null ? null : iso(row.completedAt),
    completedByDisplayName: row.completedBy?.displayName ?? null,
  }
}

/**
 * 成员行：账单行全部字段 + 本批次匹配依据 + 柜次侧可比字段 + 来源摘要 + 核对留痕。
 *
 * `supplierResolutions` 由查询服务先经 DictionaryLookupService 解析（同一字典码与采购域共用），
 * 序列化本身保持纯函数：字典解析结果没命中时按采购域的同一兜底显示原值。
 */
function serializeBatchMember(
  row: BatchMemberRow,
  supplierResolutions: ReadonlyMap<string, StoredDictionaryValueResolution>,
): SlhReconciliationBatchMemberDto {
  const item = row.matchedLoadingItem
  const purchaseOrderRow = item.shipment?.purchaseOrder ?? null
  const salesOrderRow = purchaseOrderRow?.salesOrder ?? null
  return {
    ...serializeSlhBillLine(row.line),
    id: row.id,
    lineId: row.lineId,
    matchSource: row.matchSource as SlhBillLineMatchSourceDto,
    matchedLoadingItemId: row.matchedLoadingItemId,
    matchedContainerBatchName: item.containerBatch.containerBatchName,
    matchedLoadingItemLineNumber: item.lineNumber,
    // 两侧金额同口径落字符串：空值一律 null（本行不涉及），零保留 0.00。
    matchedLoadingItem: {
      warehouseReceiptReference: item.warehouseReceiptReference,
      oceanShippingMarkText: item.oceanShippingMarkText,
      goodsName: item.goodsName,
      packageCount: item.packageCount,
      packageUnit: item.packageUnit,
      grossWeightKg: item.grossWeightKg?.toFixed(0) ?? null,
      lengthCm: item.lengthCm?.toFixed(0) ?? null,
      widthCm: item.widthCm?.toFixed(0) ?? null,
      heightCm: item.heightCm?.toFixed(0) ?? null,
      volumeCai: item.volumeCai?.toFixed(2) ?? null,
      chargeableVolumeCai: item.chargeableVolumeCai,
      reportedVolumeCai: item.reportedVolumeCai?.toFixed(2) ?? null,
      codAmountTwd: item.codAmountTwd?.toFixed(2) ?? null,
      recipientName: item.recipientName,
      recipientPhone: item.recipientPhone,
      recipientAddress: item.recipientAddress,
      remark: item.remark,
      shipmentNo: item.shipment?.shipmentNo ?? null,
    },
    purchaseOrder: purchaseOrderRow === null ? null : {
      id: purchaseOrderRow.id,
      orderNo: purchaseOrderRow.orderNo,
      orderStatus: purchaseOrderRow.orderStatus,
      // 采购金额与采购域同口径：两位小数人民币。
      purchaseTotalAmount: purchaseOrderRow.purchaseTotalAmount.toFixed(2),
      depositDueAmount: purchaseOrderRow.depositDueAmount.toFixed(2),
      balanceDueAmount: purchaseOrderRow.balanceDueAmount.toFixed(2),
      // 实际已付款/未付款沿用采购域口径：未作废付款累加，未付＝采购金额 − 已付。
      paidAmount: formatPurchaseOrderAmountUnits(sumPurchaseOrderPaidUnits(purchaseOrderRow.payments)),
      outstandingAmount: formatPurchaseOrderAmountUnits(
        parsePurchaseOrderAmountUnits(purchaseOrderRow.purchaseTotalAmount.toFixed(2))
        - sumPurchaseOrderPaidUnits(purchaseOrderRow.payments),
      ),
      fulfillmentStatus: purchaseOrderRow.fulfillmentStatus,
      paymentStatus: purchaseOrderRow.paymentStatus,
      shippingMarkText: purchaseOrderRow.shippingMarkText,
      supplier: purchaseOrderSupplierFromSources(
        purchaseOrderRow,
        supplierResolutions.get(purchaseOrderRow.id),
      ),
      creatorDisplayName: purchaseOrderRow.createdBy.displayName,
    },
    salesOrder: salesOrderRow === null ? null : {
      id: salesOrderRow.id,
      orderNo: salesOrderRow.orderNo,
      orderStatus: salesOrderRow.orderStatus,
      currencyCode: salesOrderRow.currencyCode,
      customerName: salesOrderRow.customerName,
      customerPhone: salesOrderRow.customerPhone,
      customerFullAddress: salesOrderRow.customerFullAddressSnapshot,
      // 销售金额与销售域同口径：四位小数订单币种金额。
      agreedTotalAmount: salesOrderRow.agreedTotalAmount.toFixed(2),
      depositDueAmount: salesOrderRow.depositDueAmount.toFixed(2),
      balanceDueAmount: salesOrderRow.balanceDueAmount.toFixed(2),
      // 实际已收款/待收款沿用销售域的同一处口径：未作废收款累加，待收＝约定总额 − 已收。
      receivedAmount: formatSalesOrderAmountUnits(sumSalesOrderReceivedUnits(salesOrderRow.payments)),
      outstandingAmount: formatSalesOrderAmountUnits(
        parseSalesOrderAmountUnits(salesOrderRow.agreedTotalAmount.toFixed(2))
        - sumSalesOrderReceivedUnits(salesOrderRow.payments),
      ),
      fulfillmentStatus: salesOrderRow.fulfillmentStatus,
      paymentStatus: salesOrderRow.paymentStatus,
      issuerDisplayName: salesOrderRow.issuer.displayName,
    },
    reconciledAt: row.reconciledAt === null ? null : iso(row.reconciledAt),
    reconciledByDisplayName: row.reconciledBy?.displayName ?? null,
  }
}

export function serializeSlhReconciliationBatchListItem(row: BatchHeaderRow): SlhReconciliationBatchListItemDto {
  return serializeBatchHeader(row)
}

export function serializeSlhReconciliationBatchDetail(
  row: SlhReconciliationBatchDetailRow,
  supplierResolutions: ReadonlyMap<string, StoredDictionaryValueResolution> = new Map(),
): SlhReconciliationBatchDetailDto {
  return {
    ...serializeBatchHeader(row),
    findings: serializeStoredFindings(row.bill.importFindings),
    members: row.members.map(member => serializeBatchMember(member, supplierResolutions)),
  }
}

/** 成员行里出现的采购订单及其供应商原值：查询服务据此一次解析字典标签。 */
export function collectMemberPurchaseOrderSuppliers(
  row: SlhReconciliationBatchDetailRow,
): readonly { readonly id: string, readonly supplierValue: string | null, readonly customSupplierName: string | null }[] {
  return row.members.flatMap((member) => {
    const purchaseOrder = member.matchedLoadingItem.shipment?.purchaseOrder
    return purchaseOrder === undefined || purchaseOrder === null
      ? []
      : [{
          id: purchaseOrder.id,
          supplierValue: purchaseOrder.supplierValue,
          customSupplierName: purchaseOrder.customSupplierName,
        }]
  })
}

/**
 * 参与匹配的账单明细行：只取匹配与展示需要的列，不加载费用明细。
 * 匹配算法（slh-bill-line-matching）与「静默算可核对行数」共用这一份选择。
 */
export interface SlhReconciliationMatchLineSource {
  id: string
  lineNumber: number
  sourceRowNumber: number
  loadingDate: Date
  containerBatchNameText: string | null
  shippingMarkText: string | null
  warehouseReceiptReference: string | null
  goodsName: string
  recipientName: string | null
}

export const slhReconciliationMatchLineSelect = {
  id: true, lineNumber: true, sourceRowNumber: true, loadingDate: true, containerBatchNameText: true,
  shippingMarkText: true, warehouseReceiptReference: true, goodsName: true, recipientName: true,
} satisfies Prisma.SlhBillLineSelect
