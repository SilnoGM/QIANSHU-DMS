import { Injectable, HttpStatus } from '@nestjs/common'
import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { SalesReceiptStatusDto, SalesReceiptViewDto, type SalesReceiptListQueryDto, type SalesReceiptRequestDetailDto, type SalesReceiptRequestPageDto } from '../dto/sales-receipt.dto'
import { receiptFailure } from './sales-receipt-money'

const detailInclude = {
  voucherMediaAsset: { select: { mediaType: true, mimeType: true } },
  salesOrder: { select: { id: true, orderNo: true, version: true, customerName: true, orderStatus: true } },
  accountOwner: { select: { id: true, displayName: true } },
  submittedBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  approvedPayment: { include: { fundReversalBatch: { include: { entries: { orderBy: { lineNo: 'asc' as const } } } }, fundPostingBatch: { include: { entries: { orderBy: { lineNo: 'asc' as const } } } } } },
} satisfies Prisma.SalesReceiptRequestInclude

type DetailRow = Prisma.SalesReceiptRequestGetPayload<{ include: typeof detailInclude }>
function person(row: { id: string, displayName: string }) { return { id: row.id, name: row.displayName } }
function mapDetail(row: DetailRow): SalesReceiptRequestDetailDto {
  const payment = row.approvedPayment
  const batch = payment?.fundPostingBatch
  return {
    id: row.id, collectionNo: row.collectionNo, numberingIssuanceId: row.numberingIssuanceId, salesOrderId: row.salesOrderId, paymentType: row.paymentType,
    amount: row.amount.toFixed(2), currencyCode: row.currencyCode, receivedAt: row.receivedAt.toISOString(),
    paymentMethod: row.paymentMethod, paymentMethodNameSnapshot: row.paymentMethodNameSnapshot,
    remark: row.remark, status: row.status as SalesReceiptStatusDto, submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null, reviewRemark: row.reviewRemark, version: row.version,
    resubmittedFromId: row.resubmittedFromId, salesOrder: row.salesOrder,
    accountOwner: person(row.accountOwner), submittedBy: person(row.submittedBy), reviewedBy: row.reviewedBy ? person(row.reviewedBy) : null,
    voucher: { ...row.voucherMediaAsset, mediaAssetId: row.voucherMediaAssetId, title: row.voucherTitle },
    approvedPayment: payment ? {
      exchangeRateId: payment.exchangeRateId, exchangeRateVersionSnapshot: payment.exchangeRateVersionSnapshot,
      reversal: payment.fundReversalBatch ? { ruleVersionId: payment.fundReversalBatch.ruleVersionId, ruleRevisionSnapshot: payment.fundReversalBatch.ruleRevisionSnapshot, batchId: payment.fundReversalBatch.id, businessAmount: payment.fundReversalBatch.businessAmount.toFixed(2), userShareRate: payment.fundReversalBatch.userShareRateSnapshot?.toFixed(2) ?? null, companyShareRate: payment.fundReversalBatch.companyShareRateSnapshot?.toFixed(2) ?? null, entries: payment.fundReversalBatch.entries.map(entry => ({ accountTarget: entry.accountTarget, direction: entry.direction, amount: entry.amount.toFixed(2) })) } : null,
      id: payment.id, origin: payment.origin, voidedAt: payment.voidedAt?.toISOString() ?? null, voidReason: payment.voidReason,
      fundPostingBatchId: payment.fundPostingBatchId, fundReversalBatchId: payment.fundReversalBatchId,
      foreignUnitsPerCnySnapshot: payment.foreignUnitsPerCnySnapshot?.toFixed(4) ?? null,
      exchangeRateCapturedAt: payment.exchangeRateCapturedAt?.toISOString() ?? null,
      posting: batch ? { ruleVersionId: batch.ruleVersionId, ruleRevisionSnapshot: batch.ruleRevisionSnapshot, batchId: batch.id, businessAmount: batch.businessAmount.toFixed(2), userShareRate: batch.userShareRateSnapshot?.toFixed(2) ?? null,
        companyShareRate: batch.companyShareRateSnapshot?.toFixed(2) ?? null,
        entries: batch.entries.map(entry => ({ accountTarget: entry.accountTarget, direction: entry.direction, amount: entry.amount.toFixed(2) })),
      } : null,
    } : null,
  }
}

// 作废是正式收款属性，不改变审核状态；统一条件用于分页与计数，避免视图重叠。
function viewWhere(view: SalesReceiptViewDto): Prisma.SalesReceiptRequestWhereInput {
  if (view === SalesReceiptViewDto.APPROVED) return { status: 'APPROVED', approvedPayment: { is: { voidedAt: null } } }
  if (view === SalesReceiptViewDto.VOIDED) return { status: 'APPROVED', approvedPayment: { is: { voidedAt: { not: null } } } }
  return { status: view }
}

@Injectable()
export class SalesReceiptQueryService {
  constructor(private readonly prisma: PrismaService) {}
  async getById(id: string): Promise<SalesReceiptRequestDetailDto> {
    const row = await this.prisma.salesReceiptRequest.findUnique({ where: { id }, include: detailInclude })
    if (!row) return receiptFailure('SALES_RECEIPT_NOT_FOUND', '收款申请不存在', HttpStatus.NOT_FOUND)
    return mapDetail(row)
  }
  async list(input: SalesReceiptListQueryDto, salesOrderId?: string): Promise<SalesReceiptRequestPageDto> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const date = (value: string | undefined): Date | undefined => {
      if (value === undefined) return undefined
      const parsed = new Date(value)
      if (!Number.isFinite(parsed.getTime())) receiptFailure('VALIDATION_FAILED', '提交时间筛选无效')
      return parsed
    }
    const from = date(input.submittedFrom)
    const to = date(input.submittedTo)
    if (from && to && from > to) receiptFailure('VALIDATION_FAILED', '提交时间范围无效')
    const common: Prisma.SalesReceiptRequestWhereInput = {
      ...(salesOrderId ? { salesOrderId } : {}),
      ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
      ...(input.accountOwnerUserId ? { accountOwnerUserId: input.accountOwnerUserId } : {}),
      ...(from || to ? { submittedAt: { gte: from, lte: to } } : {}),
      ...(input.keyword ? { OR: [{ collectionNo: { contains: input.keyword, mode: 'insensitive' } }, { salesOrder: { OR: [{ orderNo: { contains: input.keyword, mode: 'insensitive' } }, { customerName: { contains: input.keyword, mode: 'insensitive' } }] } }] } : {}),
    }
    return this.prisma.$transaction(async tx => {
      if (salesOrderId && !await tx.salesOrder.findUnique({ where: { id: salesOrderId }, select: { id: true } })) {
        receiptFailure('SALES_ORDER_NOT_FOUND', '销售订单不存在', HttpStatus.NOT_FOUND)
      }
      const where = { ...common, ...(input.view ? viewWhere(input.view) : input.status ? { status: input.status } : {}) }
      const [rows, total, pendingCount, approvedCount, rejectedCount, voidedCount] = await Promise.all([
        tx.salesReceiptRequest.findMany({ where, include: detailInclude, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.salesReceiptRequest.count({ where }),
        ...Object.values(SalesReceiptViewDto).map(view => tx.salesReceiptRequest.count({ where: { ...common, ...viewWhere(view) } })),
      ])
      const statusCounts = { PENDING_REVIEW: pendingCount, APPROVED: approvedCount, REJECTED: rejectedCount, VOIDED: voidedCount }
      const pending = salesOrderId ? await tx.salesReceiptRequest.aggregate({ where: { salesOrderId, status: 'PENDING_REVIEW' }, _sum: { amount: true } }) : null
      return { items: rows.map(mapDetail), total, page, pageSize, statusCounts, pendingAmount: salesOrderId ? pending?._sum.amount?.toFixed(2) ?? '0.00' : null }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
}
