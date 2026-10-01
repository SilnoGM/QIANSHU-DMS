import { Prisma } from '../../generated/prisma/client'
import { resolveSlhBillReconciliationStatus } from '../slh-bills/slh-bill-reconciliation'
import { serializeSlhBillLine, serializeStoredFindings } from '../slh-bills/slh-bill.serializer'
import type { SlhBillReconciliationStatusDto } from '../slh-bills/slh-bill.dto'
import type {
  SlhBillLineUnmatchedReasonDto, SlhBillLineMatchSourceDto, SlhReconciliationBatchDetailDto,
  SlhReconciliationBatchListItemDto, SlhReconciliationBatchMemberDto, SlhReconciliationMatchPreviewLineDto,
} from './slh-reconciliation-batch.dto'
import { SlhReconciliationBatchStatusDto } from './slh-reconciliation-batch.dto'

const iso = (value: Date): string => value.toISOString()
const isoDate = (value: Date): string => value.toISOString().slice(0, 10)

/**
 * 批次头与账单摘要。账单三态仍由明细行派生（与账单列表共用同一个派生函数），
 * 批次自己只提供「成员数 / 已核对成员数」两个计数：成员行自带核对时刻，
 * 因此同一张账单的多个批次各自的进度互不污染。
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

/** 详情多取成员行本身：只包含创建时匹配命中的行，账单其它行不会出现在这里。 */
export const slhReconciliationBatchDetailInclude = {
  ...batchHeaderInclude,
  // 费用出入走导入时冻结的 findings 快照；列表接口不需要这份数据，所以只在详情里多取。
  bill: { select: { ...batchHeaderInclude.bill.select, importFindings: true } },
  members: {
    orderBy: { createdAt: 'asc' },
    include: {
      line: { include: { charges: true } },
      matchedLoadingItem: {
        select: {
          lineNumber: true, warehouseReceiptReference: true, oceanShippingMarkText: true, goodsName: true,
          packageCount: true, packageUnit: true, grossWeightKg: true, lengthCm: true, widthCm: true, heightCm: true,
          volumeCai: true, chargeableVolumeCai: true, reportedVolumeCai: true, codAmountTwd: true,
          recipientName: true, recipientPhone: true, recipientAddress: true, remark: true,
          containerBatch: { select: { containerBatchName: true } },
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

export function serializeSlhReconciliationBatchListItem(row: BatchHeaderRow): SlhReconciliationBatchListItemDto {
  return serializeBatchHeader(row)
}

function serializeBatchMember(row: BatchMemberRow): SlhReconciliationBatchMemberDto {
  const item = row.matchedLoadingItem
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
      grossWeightKg: item.grossWeightKg?.toFixed(3) ?? null,
      lengthCm: item.lengthCm?.toFixed(2) ?? null,
      widthCm: item.widthCm?.toFixed(2) ?? null,
      heightCm: item.heightCm?.toFixed(2) ?? null,
      volumeCai: item.volumeCai?.toFixed(2) ?? null,
      chargeableVolumeCai: item.chargeableVolumeCai,
      reportedVolumeCai: item.reportedVolumeCai?.toFixed(2) ?? null,
      codAmountTwd: item.codAmountTwd?.toFixed(2) ?? null,
      recipientName: item.recipientName,
      recipientPhone: item.recipientPhone,
      recipientAddress: item.recipientAddress,
      remark: item.remark,
    },
    reconciledAt: row.reconciledAt === null ? null : iso(row.reconciledAt),
    reconciledByDisplayName: row.reconciledBy?.displayName ?? null,
  }
}

export function serializeSlhReconciliationBatchDetail(row: SlhReconciliationBatchDetailRow): SlhReconciliationBatchDetailDto {
  return { ...serializeBatchHeader(row), findings: serializeStoredFindings(row.bill.importFindings), members: row.members.map(serializeBatchMember) }
}

/**
 * 匹配预览行。行字段只取预览需要的列，与成员行的完整账单字段分开，
 * 避免预览为了展示原因而加载费用明细。
 */
export interface SlhReconciliationPreviewLineSource {
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

export const slhReconciliationPreviewLineSelect = {
  id: true, lineNumber: true, sourceRowNumber: true, loadingDate: true, containerBatchNameText: true,
  shippingMarkText: true, warehouseReceiptReference: true, goodsName: true, recipientName: true,
} satisfies Prisma.SlhBillLineSelect

export function serializeMatchPreviewLine(
  line: SlhReconciliationPreviewLineSource,
  outcome: {
    match: { source: SlhBillLineMatchSourceDto, containerBatchName: string, loadingItemLineNumber: number } | null
    reason: SlhBillLineUnmatchedReasonDto | null
  },
): SlhReconciliationMatchPreviewLineDto {
  return {
    lineId: line.id,
    lineNumber: line.lineNumber,
    sourceRowNumber: line.sourceRowNumber,
    loadingDate: isoDate(line.loadingDate),
    containerBatchNameText: line.containerBatchNameText,
    shippingMarkText: line.shippingMarkText,
    warehouseReceiptReference: line.warehouseReceiptReference,
    goodsName: line.goodsName,
    recipientName: line.recipientName,
    matchSource: outcome.match?.source ?? null,
    matchedContainerBatchName: outcome.match?.containerBatchName ?? null,
    matchedLoadingItemLineNumber: outcome.match?.loadingItemLineNumber ?? null,
    reason: outcome.reason,
  }
}
