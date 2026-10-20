import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../access-control/data-scope.service'
import { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { ContainerBatchListQueryDto } from './container-batch.dto'
import { containerFailure, containerUuid } from './container-batch.normalizer'
import type { OperationsOceanContainerItemsQueryDto, OperationsOceanContainerLineDto, OperationsOceanContainerLinePageDto, OperationsOceanContainerPageDto } from './operations-ocean-container.dto'

const overviewSelect = { id: true, containerBatchNo: true, containerBatchName: true, loadingDate: true, warehouseValue: true } satisfies Prisma.ContainerBatchSelect
export const operationsOceanLineSelect = {
  id: true, containerBatchId: true, version: true, lineNumber: true, oceanShippingMarkText: true, goodsName: true,
  recipientName: true, recipientPhone: true, recipientAddress: true, codAmountTwd: true,
  warehouseReceiptReference: true, packageCount: true, packageUnit: true, grossWeightKg: true,
  lengthCm: true, widthCm: true, heightCm: true, volumeCai: true, remark: true,
  shipment: { select: { shipmentNo: true, shippingMarkText: true, purchaseOrder: { select: { id: true, orderNo: true, salesOrder: { select: { id: true, orderNo: true } } } } } },
} satisfies Prisma.ContainerLoadingItemSelect
const lineSelect = operationsOceanLineSelect
type PersonalLine = Prisma.ContainerLoadingItemGetPayload<{ select: typeof lineSelect }>

export function personalOceanLineWhere(actorUserId: string = resolveDataScopeActor()): Prisma.ContainerLoadingItemWhereInput {
  // 归属只取服务器会话身份，不接受查询参数指定人员；管理员也不跳过此限制。
  // 未匹配货件、独立备货和没有销售来源的行自然被关系过滤排除。
  return { shipment: { purchaseOrder: { salesOrder: { issuerUserId: containerUuid(actorUserId) } } } }
}

export function serializeOperationsOceanLine(row: PersonalLine): OperationsOceanContainerLineDto {
  const { shipment, codAmountTwd, grossWeightKg, lengthCm, widthCm, heightCm, volumeCai, ...fields } = row
  return {
    ...fields, shipmentNo: shipment?.shipmentNo ?? null, shippingMark: shipment?.shippingMarkText ?? null,
    salesOrderId: shipment?.purchaseOrder.salesOrder?.id ?? null, salesOrderNo: shipment?.purchaseOrder.salesOrder?.orderNo ?? null,
    purchaseOrderId: shipment?.purchaseOrder.id ?? null, purchaseOrderNo: shipment?.purchaseOrder.orderNo ?? null,
    codAmountTwd: codAmountTwd?.toFixed(2) ?? null, grossWeightKg: grossWeightKg?.toFixed(0) ?? null,
    lengthCm: lengthCm?.toFixed(0) ?? null, widthCm: widthCm?.toFixed(0) ?? null, heightCm: heightCm?.toFixed(0) ?? null,
    volumeCai: volumeCai?.toFixed(2) ?? null,
  }
}

const personalWhere = personalOceanLineWhere
const serializeLine = serializeOperationsOceanLine

@Injectable()
export class OperationsOceanContainerService {
  constructor(private readonly prisma: PrismaService, private readonly dictionary: DictionaryLookupService, private readonly dataScope: DataScopeService = dataScopeFallback()) {}

  async list(actorUserId: string = resolveDataScopeActor(), query: ContainerBatchListQueryDto): Promise<OperationsOceanContainerPageDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    const personal = personalWhere(actorUserId)
    const search = query.search?.trim()
    const where: Prisma.ContainerBatchWhereInput = {
      ...(query.warehouseValue ? { warehouseValue: query.warehouseValue } : {}),
      ...(search ? { OR: [{ containerBatchName: { contains: search, mode: 'insensitive' } }, { containerBatchNo: { contains: search, mode: 'insensitive' } }] } : {}),
    }
    return this.prisma.$transaction(async tx => {
      const rows = await tx.containerBatch.findMany({ where, select: overviewSelect, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ loadingDate: 'desc' }, { id: 'desc' }] })
      const total = await tx.containerBatch.count({ where })
      if (!rows.length) return { items: [], total }
      const containerBatchId = { in: rows.map(row => row.id) }
      // 整柜统计只聚合数量与合计，不加载其他销售员的客户和货品明细。
      // 两组统计与列表处于同一快照，不能让并发匹配造成“我的明细”超过整柜行数。
      const totals = await tx.containerLoadingItem.groupBy({ by: ['containerBatchId'], where: { containerBatchId }, _count: { _all: true, grossWeightKg: true, volumeCai: true }, _sum: { grossWeightKg: true, volumeCai: true } })
      const ownTotals = await tx.containerLoadingItem.groupBy({ by: ['containerBatchId'], where: { containerBatchId, ...personal }, _count: { _all: true, grossWeightKg: true, volumeCai: true }, _sum: { grossWeightKg: true, volumeCai: true } })
      const summaries = new Map(totals.map(row => [row.containerBatchId, row]))
      const ownSummaries = new Map(ownTotals.map(row => [row.containerBatchId, row]))
      const warehouses = new Map<string, string>()
      for (const value of new Set(rows.map(row => row.warehouseValue))) {
        const stored = await this.dictionary.resolveStoredValueInTransaction(tx, { dictionaryCode: 'mainland.warehouse', value })
        warehouses.set(value, stored.known ? stored.label : value)
      }
      return { total, items: rows.map(row => {
        const summary = summaries.get(row.id), count = summary?._count._all ?? 0
        const ownSummary = ownSummaries.get(row.id), myItemCount = ownSummary?._count._all ?? 0
        // 柜次头在两种范围下都返回；SELF 只是把重量、体积合计收窄为本人明细，不能借列表推断整柜装载量。
        const measure = scope === 'SELF' ? ownSummary : summary
        const measureCount = scope === 'SELF' ? myItemCount : count
        return {
          ...row, loadingDate: row.loadingDate.toISOString().slice(0, 10), warehouseName: warehouses.get(row.warehouseValue)!,
          itemCount: count, myItemCount,
          // 有任一缺失值时展示待完善，不能把部分合计伪装成完整合计；无明细为零。
          grossWeightKgTotal: measureCount === 0 ? '0' : measure!._count.grossWeightKg < measureCount ? null : measure!._sum.grossWeightKg!.toFixed(0),
          volumeCaiTotal: measureCount === 0 ? '0.00' : measure!._count.volumeCai < measureCount ? null : measure!._sum.volumeCai!.toFixed(2),
        }
      }) }
    }, { isolationLevel: 'RepeatableRead' })
  }

  async items(actorUserId: string = resolveDataScopeActor(), rawId: string, query: OperationsOceanContainerItemsQueryDto): Promise<OperationsOceanContainerLinePageDto> {
    const id = containerUuid(rawId), where = { containerBatchId: id, ...personalWhere(actorUserId) }
    return this.prisma.$transaction(async tx => {
      if (!await tx.containerBatch.findUnique({ where: { id }, select: { id: true } })) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
      const rows = await tx.containerLoadingItem.findMany({ where, select: lineSelect, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }] })
      const total = await tx.containerLoadingItem.count({ where })
      return { items: rows.map(serializeLine), total }
    }, { isolationLevel: 'RepeatableRead' })
  }

  async item(actorUserId: string = resolveDataScopeActor(), rawId: string, rawItemId: string): Promise<OperationsOceanContainerLineDto> {
    const where = { id: containerUuid(rawItemId), containerBatchId: containerUuid(rawId), ...personalWhere(actorUserId) }
    const row = await this.prisma.containerLoadingItem.findFirst({ where, select: lineSelect })
    // 不区分不存在、他人明细或跨柜探测，避免详情入口泄漏记录是否存在。
    if (!row) return containerFailure('CONTAINER_LOADING_ITEM_NOT_FOUND', '装柜明细不存在或无权查看', 404)
    return serializeLine(row)
  }
}
