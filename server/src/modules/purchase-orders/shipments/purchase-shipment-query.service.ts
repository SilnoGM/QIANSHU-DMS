import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { isNormalizableDictionaryItemValue, normalizeDictionaryItemValue } from '../../dictionaries/dictionary.normalizer'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../../access-control/data-scope.service'
import type { DataScope } from '../../access-control/data-scope'
import { purchaseOrderPartScopeWhere } from '../purchase-order-access'
import { purchaseOrderSupplierFromSources } from '../purchase-order-query.service'
import type { PurchaseOrderSupplierDto } from '../dto/purchase-order-response.dto'
import { PURCHASE_SHIPMENT_VIEWS } from './purchase-shipment.dto'
import type { PurchaseShipmentDestinationWarehouseDto, PurchaseShipmentDetailDto, PurchaseShipmentFilterDto, PurchaseShipmentListItemDto, PurchaseShipmentListQueryDto, PurchaseShipmentPageDto, PurchaseShipmentStatusCountsDto, PurchaseShipmentSort, PurchaseShipmentView } from './purchase-shipment.dto'

const LINE_SELECT = {
  lineNumber: true, lineType: true, productId: true, productNoSnapshot: true, productNameSnapshot: true,
  product: { select: { media: {
    where: { kind: 'IMAGE', isPrimary: true, detachedAt: null, mediaAsset: { is: { status: 'READY' } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { id: true },
  } } },
} as const satisfies Prisma.PurchaseOrderLineSelect

const PART_SELECT = {
  id: true, shipmentNo: true, partNumber: true, status: true, shippingMarkText: true, createdAt: true,
  shippedAt: true, shippedBy: { select: { id: true, displayName: true } }, shipmentRecordedAt: true, shipmentRemark: true, trackingNo: true, destinationWarehouseValue: true,
  warehouseReceivedAt: true, warehouseReceivedById: true, warehouseRecordedAt: true, warehouseRemark: true,
  warehouseReceivedBy: { select: { id: true, displayName: true } },
  loadedAt: true, loadedRecordedAt: true, loadedBy: { select: { id: true, displayName: true } },
  purchaseOrder: { select: {
    id: true, version: true, orderNo: true, orderDate: true, purchaseType: true, productMode: true, orderStatus: true,
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
  if (input.destinationWarehouseValue !== undefined && !isNormalizableDictionaryItemValue(input.destinationWarehouseValue)) {
    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '目的地仓库值格式无效')
  }
  if (input.destinationWarehouseMissing !== undefined && typeof input.destinationWarehouseMissing !== 'boolean') {
    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '目的地仓库未记录筛选必须是布尔值')
  }
  if (input.destinationWarehouseMissing === true && input.destinationWarehouseValue !== undefined) {
    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '未记录仓库筛选不能同时指定目的地仓库')
  }

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
function baseWhere(input: PurchaseShipmentFilterDto, scope: DataScope, actorUserId: string = resolveDataScopeActor()): Prisma.PurchaseOrderPartWhereInput {
  validateFilters(input)
  const rawKeyword = input.keyword?.trim()
  const keyword = rawKeyword?.normalize('NFKC')
  const match = { contains: keyword, mode: 'insensitive' } as const
  return {
    ...purchaseOrderPartScopeWhere(scope, actorUserId),
    // 历史查询只匹配保存的稳定值，不以字典当前有效性排除停用或未知仓库。
    destinationWarehouseValue: input.destinationWarehouseMissing === true
      ? null
      : input.destinationWarehouseValue === undefined ? undefined : normalizeDictionaryItemValue(input.destinationWarehouseValue),
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
      // 承运商单号保存时保留全半角，搜索也必须保持相同字符身份。
      { trackingNo: { contains: rawKeyword, mode: 'insensitive' } },
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

/** 视图谓词是列表与计数的唯一口径：装柜事实优先于到仓、发货事实，四者互斥且合计等于全部有效货件。 */
function viewWhere(view: PurchaseShipmentView): Prisma.PurchaseOrderPartWhereInput {
  switch (view) {
    case 'ALL': return {}
    case 'PENDING_REVIEW': return { status: 'PENDING_REVIEW' }
    case 'AWAITING_SHIPMENT': return { status: 'ACTIVE', loadedAt: null, shippedAt: null }
    case 'SHIPPED': return { status: 'ACTIVE', loadedAt: null, shippedAt: { not: null }, warehouseReceivedAt: null }
    case 'WAREHOUSE_RECEIVED': return { status: 'ACTIVE', loadedAt: null, warehouseReceivedAt: { not: null } }
    case 'CONTAINER_LOADED': return { status: 'ACTIVE', loadedAt: { not: null } }
    case 'CANCELLED': return { status: 'CANCELLED' }
  }
}

function shipmentOrderBy(sort: PurchaseShipmentSort = 'CREATED_DESC'): Prisma.PurchaseOrderPartOrderByWithRelationInput[] {
  const stableOrder: Prisma.PurchaseOrderPartOrderByWithRelationInput[] = [
    { createdAt: 'desc' }, { purchaseOrderId: 'desc' }, { partNumber: 'asc' }, { id: 'asc' },
  ]
  // 到仓与发货时间允许历史空值，显式置后，末尾唯一 ID 使同时间货件分页可复现。
  switch (sort) {
    case 'CREATED_DESC': return stableOrder
    case 'SHIPPED_DESC': return [{ shippedAt: { sort: 'desc', nulls: 'last' } }, ...stableOrder]
    case 'WAREHOUSE_RECEIVED_DESC': return [{ warehouseReceivedAt: { sort: 'desc', nulls: 'last' } }, ...stableOrder]
    default: throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '货件排序方式无效')
  }
}

function mapPart(row: PartRow, supplier: PurchaseOrderSupplierDto, destinationWarehouse: PurchaseShipmentDestinationWarehouseDto | null): PurchaseShipmentListItemDto {
  const order = row.purchaseOrder
  return {
    id: row.id, shipmentNo: row.shipmentNo, partNumber: row.partNumber, status: row.status,
    // 先按货件生命周期归类，仅 ACTIVE 再按装柜、入仓、发货事实细分，保证各状态视图互斥。
    viewStatus: row.status === 'ACTIVE'
      ? row.loadedAt !== null ? 'CONTAINER_LOADED' : row.warehouseReceivedAt !== null ? 'WAREHOUSE_RECEIVED' : row.shippedAt === null ? 'AWAITING_SHIPMENT' : 'SHIPPED'
      : row.status,
    shippingMarkText: row.shippingMarkText, createdAt: row.createdAt.toISOString(),
    shippedAt: row.shippedAt?.toISOString() ?? null, shippedBy: row.shippedBy,
    shipmentRecordedAt: row.shipmentRecordedAt?.toISOString() ?? null, shipmentRemark: row.shipmentRemark,
    trackingNo: row.trackingNo ?? null,
    destinationWarehouseValue: row.destinationWarehouseValue ?? null, destinationWarehouse,
    warehouseReceivedAt: row.warehouseReceivedAt?.toISOString() ?? null, warehouseReceivedById: row.warehouseReceivedById,
    warehouseRecordedAt: row.warehouseRecordedAt?.toISOString() ?? null, warehouseRemark: row.warehouseRemark,
    warehouseReceivedBy: row.warehouseReceivedBy,
    loadedAt: row.loadedAt?.toISOString() ?? null, loadedBy: row.loadedBy,
    loadedRecordedAt: row.loadedRecordedAt?.toISOString() ?? null,
    purchaseOrder: {
      id: order.id, version: order.version, orderNo: order.orderNo, orderDate: order.orderDate.toISOString().slice(0, 10),
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
  constructor(private readonly prisma: PrismaService, private readonly dictionaryLookup: DictionaryLookupService, private readonly dataScope: DataScopeService = dataScopeFallback()) {}

  async list(input: PurchaseShipmentListQueryDto, actorUserId: string = resolveDataScopeActor()): Promise<PurchaseShipmentPageDto> {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 20
    const scope = await this.dataScope.resolve(actorUserId)
    const where: Prisma.PurchaseOrderPartWhereInput = { AND: [baseWhere(input, scope, actorUserId), viewWhere(input.view ?? 'AWAITING_SHIPMENT')] }
    const orderBy = shipmentOrderBy(input.sort)
    // 分页与总数共享数据库快照；数量按货件计算，不先对采购单分页后在内存中拆分。
    const [total, rows] = await this.prisma.$transaction(async transaction => {
      const total = await transaction.purchaseOrderPart.count({ where })
      const rows = await transaction.purchaseOrderPart.findMany({ where, select: PART_SELECT, orderBy, skip: (page - 1) * pageSize, take: pageSize })
      return [total, rows] as const
    }, { isolationLevel: 'RepeatableRead' })
    const [suppliers, warehouses] = await Promise.all([this.resolveSuppliers(rows), this.resolveWarehouses(rows)])
    return { page, pageSize, total, items: rows.map(row => mapPart(row, suppliers.get(row.purchaseOrder.id)!, warehouses.get(row.destinationWarehouseValue) ?? null)) }
  }

  async statusCounts(input: PurchaseShipmentFilterDto, actorUserId: string = resolveDataScopeActor()): Promise<PurchaseShipmentStatusCountsDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    const where = baseWhere(input, scope, actorUserId)
    // 逐视图计数与列表共用同一份谓词，避免计数口径与列表细分再次漂移；代价是同一快照内的多次计数。
    const [counts, buyers] = await this.prisma.$transaction(async transaction => {
      const counts = new Map<PurchaseShipmentView, number>()
      for (const view of PURCHASE_SHIPMENT_VIEWS) {
        counts.set(view, await transaction.purchaseOrderPart.count({ where: { AND: [where, viewWhere(view)] } }))
      }
      // 直接查询存在货件采购单的人员，避免 ORM 先加载全部采购单再在内存去重。
      // 出单人选项保持全量，不随数据范围收缩，避免筛选器缺失既有选项。
      const buyers = await transaction.user.findMany({
        where: { purchaseOrdersCreated: { some: { parts: { some: {} } } } },
        select: { id: true, displayName: true }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      })
      return [counts, buyers] as const
    }, { isolationLevel: 'RepeatableRead' })
    return { items: PURCHASE_SHIPMENT_VIEWS.map(value => ({ value, count: counts.get(value) ?? 0 })), buyerOptions: buyers }
  }

  async getById(partId: string, actorUserId: string = resolveDataScopeActor()): Promise<PurchaseShipmentDetailDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    const row = await this.prisma.purchaseOrderPart.findFirst({
      where: { id: partId, ...purchaseOrderPartScopeWhere(scope, actorUserId) },
      select: DETAIL_SELECT,
    })
    if (row === null) throw new ApiException(HttpStatus.NOT_FOUND, 'PURCHASE_ORDER_PART_NOT_FOUND', '采购货件不存在')
    const [suppliers, warehouses] = await Promise.all([this.resolveSuppliers([row]), this.resolveWarehouses([row])])
    const mapped = mapPart(row, suppliers.get(row.purchaseOrder.id)!, warehouses.get(row.destinationWarehouseValue) ?? null)
    return { ...mapped, items: row.items.map((item, index) => ({
      purchaseOrderLineId: item.purchaseOrderLineId, lineNumber: item.line.lineNumber, lineType: item.line.lineType,
      productId: item.line.productId, productNo: item.line.productNoSnapshot, productName: item.line.productNameSnapshot,
      productAttributes: Array.isArray(item.line.productAttributesSnapshot) ? item.line.productAttributesSnapshot.filter((attribute): attribute is Prisma.JsonObject => typeof attribute === 'object' && attribute !== null && !Array.isArray(attribute)) : [],
      description: item.line.descriptionSnapshot, quantity: item.quantity, mainImage: mapped.lineSummary.previews[index].mainImage,
    })) }
  }

  private async resolveWarehouses(rows: readonly PartRow[]): Promise<ReadonlyMap<string | null, PurchaseShipmentDestinationWarehouseDto>> {
    const values = [...new Set(rows.flatMap(row => row.destinationWarehouseValue == null ? [] : [row.destinationWarehouseValue]))]
    const resolved = values.length === 0 ? [] : await this.dictionaryLookup.resolveStoredValues({ dictionaryCode: 'mainland.warehouse', values })
    return new Map(values.map((value, index) => {
      const item = resolved[index]
      return [value, { value, label: item?.known === true ? item.label : null, known: item?.known === true, effectiveEnabled: item?.known === true && item.effectiveEnabled }]
    }))
  }

  private async resolveSuppliers(rows: readonly PartRow[]): Promise<ReadonlyMap<string, PurchaseOrderSupplierDto>> {
    const orders = [...new Map(rows.map(row => [row.purchaseOrder.id, row.purchaseOrder])).values()]
    const values = [...new Set(orders.flatMap(order => order.supplierValue === null ? [] : [order.supplierValue]))]
    const resolved = values.length === 0 ? [] : await this.dictionaryLookup.resolveStoredValues({ dictionaryCode: 'service_provider.supplier', values })
    const byValue = new Map(values.map((value, index) => [value, resolved[index]]))
    return new Map(orders.map(order => [order.id, purchaseOrderSupplierFromSources(order, order.supplierValue === null ? undefined : byValue.get(order.supplierValue))]))
  }
}
