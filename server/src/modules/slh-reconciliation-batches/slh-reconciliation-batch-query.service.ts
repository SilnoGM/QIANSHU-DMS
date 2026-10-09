import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { buildSlhBillListWhere, withSlhBillIncompleteReconciliation } from '../slh-bills/slh-bill-list-filter'
import { serializeSlhBillListItem, slhBillListInclude } from '../slh-bills/slh-bill.serializer'
import type { SlhBillPageDto } from '../slh-bills/slh-bill.dto'
import { slhReconciliationBatchFailure } from './slh-reconciliation-batch.errors'
import { slhReconciliationBatchUuid } from './slh-reconciliation-batch.normalizer'
import { serializeSlhReconciliationBatchDetail, slhReconciliationBatchDetailInclude } from './slh-reconciliation-batch.serializer'
import type { SlhReconciliationBatchCandidateQueryDto, SlhReconciliationBatchDetailDto } from './slh-reconciliation-batch.dto'

const DEFAULT_PAGE_SIZE = 20

/**
 * 对账批次的读查询。
 *
 * 已解冻的读路径：候选账单（新建批次弹窗的数据来源）与批次详情（详情页头部与创建/结束的响应体）；
 * 批次列表与匹配预览仍是空壳。
 */
@Injectable()
export class SlhReconciliationBatchQueryService {
  constructor(private readonly prisma: PrismaService) {}

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
    // 列表与总数共用同一份条件，否则搜索后会出现"有结果但总数为 0"。
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhBill.findMany({
        where, include: slhBillListInclude,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.slhBill.count({ where }),
    ])
    return { items: items.map(serializeSlhBillListItem), total, page, pageSize }
  }

  /** 批次详情：详情页头部与创建/结束的响应体共用这一处读取。 */
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
