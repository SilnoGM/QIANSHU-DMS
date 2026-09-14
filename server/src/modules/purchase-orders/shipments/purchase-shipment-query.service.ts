import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { purchaseOrderSupplierFromSources } from '../purchase-order-query.service'
import type { PurchaseOrderSupplierDto } from '../dto/purchase-order-response.dto'
import { PURCHASE_SHIPMENT_VIEWS } from './purchase-shipment.dto'
import type { PurchaseShipmentDetailDto, PurchaseShipmentFilterDto, PurchaseShipmentListItemDto, PurchaseShipmentListQueryDto, PurchaseShipmentPageDto, PurchaseShipmentStatusCountsDto, PurchaseShipmentView } from './purchase-shipment.dto'

const LINE_SELECT = {
  lineNumber: true, lineType: true, productId: true, productNoSnapshot: true, productNameSnapshot: true,
  product: { select: { media: {
    where: { kind: 'IMAGE', isPrimary: true, detachedAt: null, mediaAsset: { is: { status: 'READY' } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { id: true },
  } } },
} as const satisfies Prisma.PurchaseOrderLineSelect

const PART_SELECT = {
  id: true, shipmentNo: true, partNumber: true, status: true, shippingMarkText: true, createdAt: true,
  shippedAt: true, shippedBy: { select: { id: true, displayName: true } }, shipmentRecordedAt: true, shipmentRemark: true,
  purchaseOrder: { select: {
    id: true, orderNo: true, orderDate: true, purchaseType: true, productMode: true, orderStatus: true,
    shippingMarkText: true, supplierValue: true, customSupplierName: true,
    createdBy: { select: { id: true, displayName: true } },
    salesOrder: { select: { id: true, orderNo: true, customerName: true } },
  } },
  items: { orderBy: { line: { lineNumber: 'asc' } }, select: { purchaseOrderLineId: true, quantity: true, line: { select: LINE_SELECT } } },
} as const satisfies Prisma.PurchaseOrderPartSelect

const DETAIL_SELECT = {
  ...PART_SELECT,
  items: { orderBy: { line: { lineNumber: 'asc' } }, select: {
    purchaseOrderLineId: true, quantity: true,
    line: { select: { ...LINE_SELECT, productAttributesSnapshot: true, descriptionSnapshot: true } },
  } },
} as const satisfies Prisma.PurchaseOrderPartSelect

type PartRow = Prisma.PurchaseOrderPartGetPayload<{ select: typeof PART_SELECT }>

function validateFilters(input: PurchaseShipmentFilterDto): void {
  for (const value of [input.orderDateFrom, input.orderDateTo]) {
    if (value === undefined) continue
    const date = new Date(`${value}T00:00:00.000Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '采购日期无效')
    }
  }
  if (input.orderDateFrom !== undefined && input.orderDateTo !== undefined && input.orderDateFrom > input.orderDateTo) {
    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '采购开始日期不能晚于结束日期')
  }
  if (input.supplierSource === 'CUSTOM_TEXT' && input.supplierValue !== undefined) {
    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '自定义供应商不能同时按字典供应商筛选')
  }
}

/** 公共筛选始终限定货件自身的产品，避免一个采购单中的其他货件被同一产品关键词误命中。 */
function baseWhere(input: PurchaseShipmentFilterDto): Prisma.PurchaseOrderPartWhereInput {
  validateFilters(input)
  const keyword = input.keyword?.trim().normalize('NFKC')
  const match = { contains: keyword, mode: 'insensitive' } as const
  return {
    purchaseOrder: { is: {
      purchaseType: input.purchaseType,
      createdByUserId: input.createdByUserId,
      supplierValue: input.supplierValue ?? (input.supplierSource === 'CUSTOM_TEXT' ? null : input.supplierSource === 'DICTIONARY' ? { not: null } : undefined),
      orderDate: input.orderDateFrom === undefined && input.orderDateTo === undefined ? undefined : {
        gte: input.orderDateFrom === undefined ? undefined : new Date(`${input.orderDateFrom}T00:00:00.000Z`),
        lte: input.orderDateTo === undefined ? undefined : new Date(`${input.orderDateTo}T00:00:00.000Z`),
      },
    } },
    ...(!keyword ? {} : { OR: [
      { shipmentNo: match },
      { shippingMarkText: match },
      { purchaseOrder: { is: { orderNo: match } } },
      { purchaseOrder: { is: { shippingMarkText: match } } },
      { purchaseOrder: { is: { customSupplierName: match } } },
      { purchaseOrder: { is: { salesOrder: { is: { orderNo: match } } } } },
      { purchaseOrder: { is: { salesOrder: { is: { customerName: match } } } } },
      { items: { some: { line: { is: { productNameSnapshot: match } } } } },
    ] }),
  }
}

function viewWhere(view: PurchaseShipmentView): Prisma.PurchaseOrderPartWhereInput {
  switch (view) {
    case 'ALL': return {}
    case 'PENDING_REVIEW': return { status: 'PENDING_REVIEW' }
    case 'AWAITING_SHIPMENT': return { status: 'ACTIVE', shippedAt: null }
    case 'SHIPPED': return { status: 'ACTIVE', shippedAt: { not: null } }
    case 'CANCELLED': return { status: 'CANCELLED' }
  }
}

function mapPart(row: PartRow, supplier: PurchaseOrderSupplierDto): PurchaseShipmentListItemDto {
  const order = row.purchaseOrder
  return {
    id: row.id, shipmentNo: row.shipmentNo, partNumber: row.partNumber, status: row.status,
    // 先按货件生命周期归类，仅 ACTIVE 再按发货时间细分，保证各状态视图互斥。
    viewStatus: row.status === 'ACTIVE' ? row.shippedAt === null ? 'AWAITING_SHIPMENT' : 'SHIPPED' : row.status,
    shippingMarkText: row.shippingMarkText, createdAt: row.createdAt.toISOString(),
    shippedAt: row.shippedAt?.toISOString() ?? null, shippedBy: row.shippedBy,
    shipmentRecordedAt: row.shipmentRecordedAt?.toISOString() ?? null, shipmentRemark: row.shipmentRemark,
    purchaseOrder: {
      id: order.id, orderNo: order.orderNo, orderDate: order.orderDate.toISOString().slice(0, 10),
      purchaseType: order.purchaseType, productMode: order.productMode, orderStatus: order.orderStatus,
      shippingMarkText: order.shippingMarkText, createdBy: order.createdBy,
    },
    supplier, salesSource: order.salesOrder,
    lineSummary: {
      lineCount: row.items.length, totalQuantity: row.items.reduce((total, item) => total + item.quantity, 0),
      previews: row.items.map(item => {
        const image = item.line.lineType === 'CATALOG' ? item.line.product?.media[0] : undefined
        return {
          lineId: item.purchaseOrderLineId, lineNumber: item.line.lineNumber, productNo: item.line.productNoSnapshot,
          productName: item.line.productNameSnapshot, quantity: item.quantity,
          mainImage: image === undefined ? null : { id: image.id, contentUrl: `/api/purchase-orders/${order.id}/lines/${item.purchaseOrderLineId}/main-image/${image.id}/content` },
        }
      }),
    },
  }
}

@Injectable()
export class PurchaseShipmentQueryService {
  constructor(private readonly prisma: PrismaService, private readonly dictionaryLookup: DictionaryLookupService) {}

  async list(input: PurchaseShipmentListQueryDto): Promise<PurchaseShipmentPageDto> {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 20
    const where: Prisma.PurchaseOrderPartWhereInput = { AND: [baseWhere(input), viewWhere(input.view ?? 'AWAITING_SHIPMENT')] }
    // 分页与总数共享数据库快照；数量按货件计算，不先对采购单分页后在内存中拆分。
    const [total, rows] = await this.prisma.$transaction(async transaction => {
      const total = await transaction.purchaseOrderPart.count({ where })
      const rows = await transaction.purchaseOrderPart.findMany({ where, select: PART_SELECT, orderBy: [{ createdAt: 'desc' }, { purchaseOrderId: 'desc' }, { partNumber: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })
      return [total, rows] as const
    }, { isolationLevel: 'RepeatableRead' })
    const suppliers = await this.resolveSuppliers(rows)
    return { page, pageSize, total, items: rows.map(row => mapPart(row, suppliers.get(row.purchaseOrder.id)!)) }
  }

  async statusCounts(input: PurchaseShipmentFilterDto): Promise<PurchaseShipmentStatusCountsDto> {
    const where = baseWhere(input)
    const [groups, buyers] = await this.prisma.$transaction(async transaction => {
      const groups = await transaction.purchaseOrderPart.groupBy({ by: ['status'], where, _count: { _all: true, shippedAt: true } })
      // 直接查询存在货件采购单的人员，避免 ORM 先加载全部采购单再在内存去重。
      const buyers = await transaction.user.findMany({
        where: { purchaseOrdersCreated: { some: { parts: { some: {} } } } },
        select: { id: true, displayName: true }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      })
      return [groups, buyers] as const
    }, { isolationLevel: 'RepeatableRead' })
    const counts: Record<PurchaseShipmentView, number> = { ALL: 0, PENDING_REVIEW: 0, AWAITING_SHIPMENT: 0, SHIPPED: 0, CANCELLED: 0 }
    for (const group of groups) {
      counts.ALL += group._count._all
      if (group.status === 'ACTIVE') {
        counts.SHIPPED = group._count.shippedAt
        counts.AWAITING_SHIPMENT = group._count._all - group._count.shippedAt
      }
      else counts[group.status] = group._count._all
    }
    return { items: PURCHASE_SHIPMENT_VIEWS.map(value => ({ value, count: counts[value] })), buyerOptions: buyers }
  }

  async getById(partId: string): Promise<PurchaseShipmentDetailDto> {
    const row = await this.prisma.purchaseOrderPart.findUnique({ where: { id: partId }, select: DETAIL_SELECT })
    if (row === null) throw new ApiException(HttpStatus.NOT_FOUND, 'PURCHASE_ORDER_PART_NOT_FOUND', '采购货件不存在')
    const suppliers = await this.resolveSuppliers([row])
    const mapped = mapPart(row, suppliers.get(row.purchaseOrder.id)!)
    return { ...mapped, items: row.items.map((item, index) => ({
      purchaseOrderLineId: item.purchaseOrderLineId, lineNumber: item.line.lineNumber, lineType: item.line.lineType,
      productId: item.line.productId, productNo: item.line.productNoSnapshot, productName: item.line.productNameSnapshot,
      productAttributes: Array.isArray(item.line.productAttributesSnapshot) ? item.line.productAttributesSnapshot.filter((attribute): attribute is Prisma.JsonObject => typeof attribute === 'object' && attribute !== null && !Array.isArray(attribute)) : [],
      description: item.line.descriptionSnapshot, quantity: item.quantity, mainImage: mapped.lineSummary.previews[index].mainImage,
    })) }
  }

  private async resolveSuppliers(rows: readonly PartRow[]): Promise<ReadonlyMap<string, PurchaseOrderSupplierDto>> {
    const orders = [...new Map(rows.map(row => [row.purchaseOrder.id, row.purchaseOrder])).values()]
    const values = [...new Set(orders.flatMap(order => order.supplierValue === null ? [] : [order.supplierValue]))]
    const resolved = values.length === 0 ? [] : await this.dictionaryLookup.resolveStoredValues({ dictionaryCode: 'service_provider.supplier', values })
    const byValue = new Map(values.map((value, index) => [value, resolved[index]]))
    return new Map(orders.map(order => [order.id, purchaseOrderSupplierFromSources(order, order.supplierValue === null ? undefined : byValue.get(order.supplierValue))]))
  }
}
