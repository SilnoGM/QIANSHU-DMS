import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { buildSlhBillListWhere, withSlhBillIncompleteReconciliation } from '../slh-bills/slh-bill-list-filter'
import { slhBillUuid } from '../slh-bills/slh-bill.normalizer'
import { serializeSlhBillListItem, slhBillListInclude } from '../slh-bills/slh-bill.serializer'
import { SlhReconciliationBatchFilterDto } from './slh-reconciliation-batch.dto'
import { slhReconciliationBatchFailure } from './slh-reconciliation-batch.errors'
import { slhReconciliationBatchUuid } from './slh-reconciliation-batch.normalizer'
import { matchBillUnreconciledLines } from './slh-reconciliation-batch.matcher'
import {
  serializeMatchPreviewLine, serializeSlhReconciliationBatchDetail, serializeSlhReconciliationBatchListItem,
  slhReconciliationBatchDetailInclude, slhReconciliationBatchListInclude,
} from './slh-reconciliation-batch.serializer'
import type { SlhBillPageDto } from '../slh-bills/slh-bill.dto'
import type {
  SlhBillLineMatchSourceDto, SlhBillLineUnmatchedReasonDto, SlhReconciliationBatchCandidateQueryDto,
  SlhReconciliationBatchDetailDto, SlhReconciliationBatchListQueryDto, SlhReconciliationBatchPageDto,
  SlhReconciliationBatchPreviewDto,
} from './slh-reconciliation-batch.dto'

const DEFAULT_PAGE_SIZE = 20

function batchStatusWhere(status: SlhReconciliationBatchFilterDto): Prisma.SlhReconciliationBatchWhereInput {
  if (status === SlhReconciliationBatchFilterDto.IN_PROGRESS) return { completedAt: null }
  if (status === SlhReconciliationBatchFilterDto.COMPLETED) return { completedAt: { not: null } }
  return {}
}

@Injectable()
export class SlhReconciliationBatchQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: SlhReconciliationBatchListQueryDto): Promise<SlhReconciliationBatchPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const keyword = query.keyword?.trim()
    const where: Prisma.SlhReconciliationBatchWhereInput = {
      ...batchStatusWhere(query.status ?? SlhReconciliationBatchFilterDto.IN_PROGRESS),
      ...(keyword === undefined || keyword === '' ? {} : {
        OR: [
          { batchNo: { contains: keyword, mode: 'insensitive' } },
          { bill: { slhBillNo: { contains: keyword, mode: 'insensitive' } } },
          { bill: { billName: { contains: keyword, mode: 'insensitive' } } },
        ],
      }),
    }
    // 列表与总数共用同一份条件，否则筛选后会出现"有数据但总数为 0"。
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhReconciliationBatch.findMany({
        where, include: slhReconciliationBatchListInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.slhReconciliationBatch.count({ where }),
    ])
    return { items: items.map(serializeSlhReconciliationBatchListItem), total, page, pageSize }
  }

  /**
   * 弹窗第一步的候选账单：生效中、至少一行未对账、且没有进行中的批次。
   * 「正在对账中」的账单直接过滤掉而不是展示为不可选：它此刻根本不能开第二次核对，
   * 用户需要的是去看那个批次，而不是一个点不动的禁用行。
   */
  async candidates(query: SlhReconciliationBatchCandidateQueryDto): Promise<SlhBillPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const where: Prisma.SlhBillWhereInput = {
      ...withSlhBillIncompleteReconciliation(buildSlhBillListWhere({ keyword: query.keyword })),
      reconciliationBatches: { none: { completedAt: null } },
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhBill.findMany({
        where, include: slhBillListInclude,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.slhBill.count({ where }),
    ])
    return { items: items.map(serializeSlhBillListItem), total, page, pageSize }
  }

  /** 弹窗第二步：重跑匹配给出「能核对哪些行」，纯读不落库。 */
  async preview(billId: string): Promise<SlhReconciliationBatchPreviewDto> {
    const id = slhBillUuid(billId)
    const bill = await this.prisma.slhBill.findUnique({ where: { id }, include: slhBillListInclude })
    if (!bill) {
      slhReconciliationBatchFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
    }
    const matches = await matchBillUnreconciledLines(this.prisma, id)
    return {
      bill: serializeSlhBillListItem(bill),
      matched: matches
        .filter(match => match.status === 'MATCHED')
        .map(match => serializeMatchPreviewLine(match.line, {
          match: {
            source: match.source as SlhBillLineMatchSourceDto,
            containerBatchName: match.containerBatchName ?? '',
            loadingItemLineNumber: match.loadingItemLineNumber ?? 0,
          },
          reason: null,
        })),
      unmatched: matches
        .filter(match => match.status === 'UNMATCHED')
        .map(match => serializeMatchPreviewLine(match.line, { match: null, reason: match.reason as SlhBillLineUnmatchedReasonDto | null })),
    }
  }

  async detail(id: string): Promise<SlhReconciliationBatchDetailDto> {
    const row = await this.prisma.slhReconciliationBatch.findUnique({
      where: { id: slhReconciliationBatchUuid(id) },
      include: slhReconciliationBatchDetailInclude,
    })
    if (!row) {
      slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '对账批次不存在', 404)
    }
    return serializeSlhReconciliationBatchDetail(row)
  }
}
