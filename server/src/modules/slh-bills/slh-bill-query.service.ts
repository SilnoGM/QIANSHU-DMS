import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { slhBillFailure } from './slh-bill-calculation'
import { slhBillUuid } from './slh-bill.normalizer'
import { serializeSlhBill, serializeSlhBillLine, serializeSlhBillListItem, slhBillListInclude, slhBillRateInclude } from './slh-bill.serializer'
import type { SlhBillDto, SlhBillLineListQueryDto, SlhBillLinePageDto, SlhBillListQueryDto, SlhBillPageDto } from './slh-bill.dto'

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_LINE_PAGE_SIZE = 50

@Injectable()
export class SlhBillQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: SlhBillListQueryDto): Promise<SlhBillPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const keyword = query.keyword?.trim()
    const where: Prisma.SlhBillWhereInput = {
      ...(query.state === 'superseded' ? { supersededById: { not: null } } : {}),
      ...(query.state === undefined || query.state === 'active' ? { supersededById: null } : {}),
      ...(query.periodFrom === undefined ? {} : { periodEnd: { gte: new Date(query.periodFrom) } }),
      ...(query.periodTo === undefined ? {} : { periodStart: { lte: new Date(query.periodTo) } }),
      ...(keyword === undefined || keyword === '' ? {} : {
        OR: [
          { slhBillNo: { contains: keyword, mode: 'insensitive' } },
          { sourceFileName: { contains: keyword, mode: 'insensitive' } },
          { containerBatchNames: { contains: keyword, mode: 'insensitive' } },
        ],
      }),
    }
    // 金额区间在解析精度内比较，避免把用户的两位小数输入当成浮点数。
    if (query.payableMin !== undefined || query.payableMax !== undefined) {
      where.AND = [{
        ...(query.payableMin === undefined ? {} : { payableTotalAmountCny: { gte: new Prisma.Decimal(query.payableMin) } }),
        ...(query.payableMax === undefined ? {} : { payableTotalAmountCny: { lte: new Prisma.Decimal(query.payableMax) } }),
      }]
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhBill.findMany({ where, include: slhBillListInclude, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.slhBill.count({ where }),
    ])
    return { items: items.map(serializeSlhBillListItem), total, page, pageSize }
  }

  async get(id: string): Promise<SlhBillDto> {
    const row = await this.prisma.slhBill.findUnique({ where: { id: slhBillUuid(id) }, include: slhBillRateInclude })
    if (!row) slhBillFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
    return serializeSlhBill(row)
  }

  async lines(query: SlhBillLineListQueryDto): Promise<SlhBillLinePageDto> {
    const id = slhBillUuid(query.id)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_LINE_PAGE_SIZE
    const bill = await this.prisma.slhBill.findUnique({ where: { id }, select: { id: true } })
    if (!bill) slhBillFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhBillLine.findMany({ where: { billId: id }, include: { charges: true }, orderBy: { lineNumber: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.slhBillLine.count({ where: { billId: id } }),
    ])
    return { items: items.map(serializeSlhBillLine), total, page, pageSize }
  }
}
