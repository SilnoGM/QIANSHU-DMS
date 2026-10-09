import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { buildSlhBillListWhere, withSlhBillIncompleteReconciliation } from '../slh-bills/slh-bill-list-filter'
import { serializeSlhBillListItem, slhBillListInclude } from '../slh-bills/slh-bill.serializer'
import type { SlhBillPageDto } from '../slh-bills/slh-bill.dto'
import type { SlhReconciliationBatchCandidateQueryDto } from './slh-reconciliation-batch.dto'

const DEFAULT_PAGE_SIZE = 20

/**
 * 对账批次的读查询。
 *
 * 对账功能整体仍处于冻结状态，这里只解冻「候选账单」这一条读路径：
 * 它是「新建对账批次」弹窗的数据来源；批次读写与匹配预览等仍是空壳。
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
}
