import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { slhBillFailure } from './slh-bill-calculation'
import { buildSlhBillLineWhere } from './slh-bill-line-filter'
import { buildSlhBillListWhere, withSlhBillReconciliationStatus, withSlhBillState } from './slh-bill-list-filter'
import { slhBillUuid } from './slh-bill.normalizer'
import { serializeSlhBill, serializeSlhBillLine, serializeSlhBillListItem, slhBillListInclude, slhBillRateInclude } from './slh-bill.serializer'
import { SlhBillListStateDto, SlhBillReconciliationFilterDto } from './slh-bill.dto'
import type { SlhBillDto, SlhBillLineListQueryDto, SlhBillLinePageDto, SlhBillListQueryDto, SlhBillPageDto, SlhBillStatusCountsDto, SlhBillStatusCountsQueryDto } from './slh-bill.dto'

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_LINE_PAGE_SIZE = 50

@Injectable()
export class SlhBillQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: SlhBillListQueryDto): Promise<SlhBillPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const where = buildSlhBillListWhere(query)
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhBill.findMany({ where, include: slhBillListInclude, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.slhBill.count({ where }),
    ])
    return { items: items.map(serializeSlhBillListItem), total, page, pageSize }
  }

  /**
   * 两块工具栏的计数。基准条件是同一份筛选（搜索、期间、金额），
   * 各自只忽略自己那一维：账单状态计数仍受对账筛选影响，反之亦然，
   * 这样切换任一工具栏后，另一块工具栏上的数字与点进去看到的行数始终一致。
   */
  async statusCounts(query: SlhBillStatusCountsQueryDto): Promise<SlhBillStatusCountsDto> {
    const forState = buildSlhBillListWhere(query, { omitState: true })
    const forReconciliation = buildSlhBillListWhere(query, { omitReconciliationStatus: true })
    const [active, superseded, all, pending, partial, completed, reconciliationAll] = await this.prisma.$transaction([
      this.prisma.slhBill.count({ where: withSlhBillState(forState, SlhBillListStateDto.ACTIVE) }),
      this.prisma.slhBill.count({ where: withSlhBillState(forState, SlhBillListStateDto.SUPERSEDED) }),
      this.prisma.slhBill.count({ where: withSlhBillState(forState, SlhBillListStateDto.ALL) }),
      this.prisma.slhBill.count({ where: withSlhBillReconciliationStatus(forReconciliation, SlhBillReconciliationFilterDto.PENDING) }),
      this.prisma.slhBill.count({ where: withSlhBillReconciliationStatus(forReconciliation, SlhBillReconciliationFilterDto.PARTIAL) }),
      this.prisma.slhBill.count({ where: withSlhBillReconciliationStatus(forReconciliation, SlhBillReconciliationFilterDto.COMPLETED) }),
      this.prisma.slhBill.count({ where: withSlhBillReconciliationStatus(forReconciliation, SlhBillReconciliationFilterDto.ALL) }),
    ])
    return {
      states: [
        { count: active, value: SlhBillListStateDto.ACTIVE },
        { count: superseded, value: SlhBillListStateDto.SUPERSEDED },
        { count: all, value: SlhBillListStateDto.ALL },
      ],
      reconciliationStatuses: [
        { count: reconciliationAll, value: SlhBillReconciliationFilterDto.ALL },
        { count: pending, value: SlhBillReconciliationFilterDto.PENDING },
        { count: partial, value: SlhBillReconciliationFilterDto.PARTIAL },
        { count: completed, value: SlhBillReconciliationFilterDto.COMPLETED },
      ],
    }
  }

  async get(id: string): Promise<SlhBillDto> {
    const row = await this.prisma.slhBill.findUnique({ where: { id: slhBillUuid(id) }, include: slhBillRateInclude })
    if (!row) slhBillFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
    return serializeSlhBill(row)
  }

  async lines(query: SlhBillLineListQueryDto & { id: string }): Promise<SlhBillLinePageDto> {
    const id = slhBillUuid(query.id)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_LINE_PAGE_SIZE
    const bill = await this.prisma.slhBill.findUnique({ where: { id }, select: { id: true } })
    if (!bill) slhBillFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
    // 列表与总数必须共用同一份条件，否则筛选后会出现"有数据但总数为 0"。
    const where = buildSlhBillLineWhere(id, { containerBatchName: query.containerBatchName, keyword: query.keyword })
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhBillLine.findMany({ where, include: { charges: true }, orderBy: { lineNumber: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.slhBillLine.count({ where }),
    ])
    return { items: items.map(serializeSlhBillLine), total, page, pageSize }
  }
}
