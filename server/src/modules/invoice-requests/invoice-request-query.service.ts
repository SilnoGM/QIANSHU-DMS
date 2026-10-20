import { Injectable } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { resolveInvoiceRequestViewer, type InvoiceRequestViewer } from './invoice-request-access'
import {
  INVOICE_REQUEST_DUPLICATE_POOL_STATUS_VALUES,
  INVOICE_REQUEST_STATUS_VALUES,
} from './invoice-request.contract'
import {
  INVOICE_REQUEST_ERROR_CODES,
  invoiceRequestFailure,
} from './invoice-request.errors'
import { buildInvoiceRequestListWhere, type InvoiceRequestListFilterInput } from './invoice-request-list-filter'
import { resolveSettleableAt } from './invoice-request.logic'
import type {
  InvoiceRequestDto,
  InvoiceRequestDuplicateSuspectDto,
  InvoiceRequestLineDto,
  InvoiceRequestListQueryDto,
  InvoiceRequestListItemDto,
  InvoiceRequestPageDto,
  InvoiceRequestStatusCountsDto,
  InvoiceRequestStatusCountsQueryDto,
} from './invoice-request.dto'

type RequestRow = Prisma.InvoiceRequestGetPayload<{ include: typeof LIST_INCLUDE }>

const LIST_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  createdBy: { select: { id: true, displayName: true } },
  documentMediaAsset: { select: { id: true, originalFilename: true } },
  statusHistory: { where: { action: 'RETURN' }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 1 },
} satisfies Prisma.InvoiceRequestInclude

const DETAIL_INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  createdBy: { select: { id: true, displayName: true } },
  documentMediaAsset: { select: { id: true, originalFilename: true } },
  statusHistory: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], include: { actor: { select: { displayName: true } } } },
} satisfies Prisma.InvoiceRequestInclude

type DetailRow = Prisma.InvoiceRequestGetPayload<{ include: typeof DETAIL_INCLUDE }>

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function toLines(lines: readonly { lineNo: number, productName: string, quantity: number, unitPrice: Prisma.Decimal, amount: Prisma.Decimal }[]): InvoiceRequestLineDto[] {
  return lines.map(line => ({
    lineNo: line.lineNo,
    productName: line.productName,
    quantity: line.quantity,
    unitPrice: line.unitPrice.toFixed(0),
    amount: line.amount.toFixed(0),
  }))
}

function toListItem(row: RequestRow): InvoiceRequestListItemDto {
  const firstLine = row.lines[0]
  const lineSummary = firstLine === undefined
    ? null
    : row.lines.length > 1
      ? firstLine.productName + ' 等 ' + String(row.lines.length) + ' 项'
      : firstLine.productName
  return {
    id: row.id,
    version: row.version,
    invoiceNo: row.invoiceNo,
    status: row.status,
    buyerName: row.buyerName,
    buyerTaxId: row.buyerTaxId,
    salesAmount: row.salesAmount.toFixed(0),
    taxAmount: row.taxAmount.toFixed(0),
    totalAmount: row.totalAmount.toFixed(0),
    lineCount: row.lines.length,
    lineSummary,
    invoiceRemark: row.invoiceRemark,
    internalRemark: row.internalRemark,
    creatorUserId: row.createdById,
    creatorName: row.createdBy.displayName,
    submittedAt: row.createdAt.toISOString(),
    lastSubmittedAt: row.lastSubmittedAt.toISOString(),
    notifiedAt: toIso(row.notifiedAt),
    returnedAt: toIso(row.returnedAt),
    latestReturnReason: row.statusHistory[0]?.reason ?? null,
    documentUploadedAt: toIso(row.documentUploadedAt),
    settleableAt: row.documentUploadedAt === null ? null : resolveSettleableAt(row.documentUploadedAt).toISOString(),
    settledAt: toIso(row.settledAt),
    settleAmountCny: row.settleAmountCny === null ? null : row.settleAmountCny.toFixed(2),
    cancelledAt: toIso(row.cancelledAt),
    cancelReason: row.cancelReason,
    documentMediaAssetId: row.documentMediaAssetId,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    recipientAddress: row.recipientAddress,
  }
}

interface DuplicateHint {
  readonly duplicateSuspected: boolean
  readonly duplicateSuspects: InvoiceRequestDuplicateSuspectDto[]
}

/** 详情只在列表字段之上补明细与完整历史；历史不参与列表摘要。 */
function toDetail(row: DetailRow, duplicate?: DuplicateHint): InvoiceRequestDto {
  const base = toListItem({ ...row, statusHistory: [] })
  return {
    ...base,
    ...(duplicate === undefined ? {} : duplicate),
    lines: toLines(row.lines),
    history: row.statusHistory.map(entry => ({
      action: entry.action,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      reason: entry.reason,
      actorUserId: entry.actorUserId,
      actorName: entry.actor.displayName,
      occurredAt: entry.occurredAt.toISOString(),
    })),
    document: row.documentMediaAsset === null || row.documentUploadedAt === null
      ? null
      : {
          mediaAssetId: row.documentMediaAsset.id,
          fileName: row.documentMediaAsset.originalFilename,
          uploadedAt: row.documentUploadedAt.toISOString(),
        },
    foreignUnitsPerCnySnapshot: row.foreignUnitsPerCnySnapshot === null ? null : row.foreignUnitsPerCnySnapshot.toString(),
    exchangeRateVersionSnapshot: row.exchangeRateVersionSnapshot,
    rateCapturedAt: toIso(row.rateCapturedAt),
    fundPostingBatchId: row.fundPostingBatchId,
  }
}

@Injectable()
export class InvoiceRequestQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 列表与详情共用同一条归属规则：没有跨提交人权限时强制按提交人过滤，
   * 详情则直接按不可见返回 404，避免用状态码泄露单据是否存在。
   */
  async list(actorUserId: string, query: InvoiceRequestListQueryDto): Promise<InvoiceRequestPageDto> {
    const viewer = await resolveInvoiceRequestViewer(this.prisma, actorUserId)
    const filter: InvoiceRequestListFilterInput = {
      keyword: query.keyword,
      status: query.status ?? 'ALL',
      ...(viewer.canManageOthers ? {} : { ownerId: viewer.actorUserId }),
    }
    const where = buildInvoiceRequestListWhere(filter)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoiceRequest.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoiceRequest.count({ where }),
    ])
    return { items: rows.map(toListItem), total, page, pageSize }
  }

  /** 计数覆盖完整结果集：忽略状态维度、保留关键词与归属过滤，`ALL` 给合计。 */
  async statusCounts(actorUserId: string, query: InvoiceRequestStatusCountsQueryDto): Promise<InvoiceRequestStatusCountsDto> {
    const viewer = await resolveInvoiceRequestViewer(this.prisma, actorUserId)
    const base = buildInvoiceRequestListWhere({
      keyword: query.keyword,
      ...(viewer.canManageOthers ? {} : { ownerId: viewer.actorUserId }),
    }, { omitStatus: true })
    const [total, ...counts] = await this.prisma.$transaction([
      this.prisma.invoiceRequest.count({ where: base }),
      ...INVOICE_REQUEST_STATUS_VALUES.map(status => this.prisma.invoiceRequest.count({ where: { ...base, status } })),
    ])
    const statuses = INVOICE_REQUEST_STATUS_VALUES.map((status, index) => ({ value: status, count: counts[index] ?? 0 }))
    return { statuses: [{ value: 'ALL', count: total }, ...statuses] }
  }

  async get(actorUserId: string, id: string): Promise<InvoiceRequestDto> {
    const viewer = await resolveInvoiceRequestViewer(this.prisma, actorUserId)
    const row = await this.prisma.invoiceRequest.findUnique({ where: { id }, include: DETAIL_INCLUDE })
    if (row === null) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.NOT_FOUND, '开票申请不存在', 404)
    }
    assertInvoiceRequestVisible(row, viewer)
    // 跨提交人的全库查重只用于财务审核提示，不阻断流程；列表不做，避免逐行查询。
    const duplicate = viewer.canManageOthers
      ? await this.findDuplicateSuspects(row)
      : undefined
    return toDetail(row, duplicate)
  }

  private async findDuplicateSuspects(row: DetailRow): Promise<DuplicateHint> {
    const suspects = await this.prisma.invoiceRequest.findMany({
      where: {
        id: { not: row.id },
        buyerName: row.buyerName,
        buyerTaxId: row.buyerTaxId,
        taxAmount: row.taxAmount.toString(),
        totalAmount: row.totalAmount.toString(),
        status: { in: [...INVOICE_REQUEST_DUPLICATE_POOL_STATUS_VALUES] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { invoiceNo: true, status: true, createdAt: true },
    })
    return {
      duplicateSuspected: suspects.length > 0,
      duplicateSuspects: suspects.map(suspect => ({
        invoiceNo: suspect.invoiceNo,
        status: suspect.status,
        createdAt: suspect.createdAt.toISOString(),
      })),
    }
  }

  /**
   * 发票照片的存储引用：读图先按单据判定可见性，再回媒体资产；
   * 没有照片与单据不可见都返回 404，读图这条路不区分两者。
   */
  async documentAsset(actorUserId: string, id: string): Promise<{
    readonly checksumSha256: string | null
    readonly mimeType: string | null
    readonly objectKey: string | null
    readonly originalFilename: string
    readonly sizeBytes: bigint | null
  }> {
    const viewer = await resolveInvoiceRequestViewer(this.prisma, actorUserId)
    const row = await this.prisma.invoiceRequest.findUnique({
      where: { id },
      select: { createdById: true, documentMediaAssetId: true },
    })
    if (row === null) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.NOT_FOUND, '开票申请不存在', 404)
    }
    assertInvoiceRequestVisible(row, viewer)
    if (row.documentMediaAssetId === null) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_REQUIRED, '这张申请单还没有发票照片', 404)
    }
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: row.documentMediaAssetId },
      select: { checksumSha256: true, mimeType: true, objectKey: true, originalFilename: true, sizeBytes: true },
    })
    if (asset === null) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_REQUIRED, '这张申请单还没有发票照片', 404)
    }
    return asset
  }
}

/**
 * 行级归属断言：不是本人提交且没有跨提交人权限时按「不存在」处理。
 * 写路径（重新提交、运营取消、取照片）也复用它。
 */
export function assertInvoiceRequestVisible(
  row: { readonly createdById: string },
  viewer: InvoiceRequestViewer,
): void {
  if (!viewer.canManageOthers && row.createdById !== viewer.actorUserId) {
    invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.NOT_FOUND, '开票申请不存在', 404)
  }
}
