import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import type { PurchaseOrderFulfillmentStatus } from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../../access-control/data-scope.service'
import { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { salesOrderScopeWhere } from '../../sales-orders/sales-order-access'
import {
  purchaseOrderSupplierFromSources,
  type PurchaseOrderSupplier,
} from '../purchase-order-query.service'
import type { PurchaseOrderPartDto } from '../dto/purchase-order-response.dto'
import { requireFactoryShipmentUuid } from './purchase-order-factory-shipment.normalizer'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

const CONTEXT_LINE_SELECT = {
  id: true,
  productId: true,
  productNameSnapshot: true,
  quantity: true,
  product: {
    select: {
      media: {
        where: {
          kind: 'IMAGE',
          isPrimary: true,
          detachedAt: null,
          mediaAsset: { is: { status: 'READY' } },
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { id: true },
      },
    },
  },
} as const satisfies Prisma.PurchaseOrderLineSelect

const CONTEXT_PURCHASE_ORDER_SELECT = {
  id: true,
  orderNo: true,
  orderDate: true,
  productMode: true,
  supplierValue: true,
  customSupplierName: true,
  fulfillmentStatus: true,
  version: true,
  shippingMarkText: true,
  parts: {
    orderBy: { partNumber: 'asc' },
    select: {
      id: true, shipmentNo: true, partNumber: true, status: true, shippingMarkText: true,
      shippedAt: true, shippedById: true, shipmentRecordedAt: true, shipmentRemark: true, trackingNo: true, destinationWarehouseValue: true,
      shippedBy: { select: { id: true, displayName: true } },
      warehouseReceivedAt: true, warehouseReceivedById: true, warehouseRecordedAt: true, warehouseRemark: true,
      warehouseReceivedBy: { select: { id: true, displayName: true } },

      items: { orderBy: { line: { lineNumber: 'asc' } }, select: {
        purchaseOrderLineId: true, quantity: true, line: { select: { lineNumber: true } },
      } },
    },
  },
  lines: {
    orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
    select: CONTEXT_LINE_SELECT,
  },
} as const satisfies Prisma.PurchaseOrderSelect

type ContextPurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{
  select: typeof CONTEXT_PURCHASE_ORDER_SELECT
}>

export interface SalesOrderFactoryShipmentContext {
  readonly salesOrder: {
    readonly id: string
    readonly orderNo: string
    readonly customerName: string
    readonly fulfillmentStatus: 'PREPARING'
    readonly version: number
  }
  readonly purchaseOrders: readonly {
    readonly id: string
    readonly orderNo: string
    readonly orderDate: string
    readonly productMode: 'CATALOG' | 'CUSTOM' | 'MIXED'
    readonly supplier: PurchaseOrderSupplier
    readonly fulfillmentStatus: PurchaseOrderFulfillmentStatus
    readonly version: number
    readonly shippingMarkText: string | null
    readonly parts: readonly PurchaseOrderPartDto[]
    readonly lineSummary: {
      readonly lineCount: number
      readonly totalQuantity: number
      readonly previews: readonly {
        readonly lineId: string
        readonly productName: string
        readonly quantity: number
        readonly mainImage: {
          readonly id: string
          readonly contentUrl: string
        } | null
      }[]
    }
  }[]
  readonly pendingShipmentCount: number
  readonly shipmentSatisfiedCount: number
}

function priority(status: PurchaseOrderFulfillmentStatus): number {
  return status === 'ORDERED' || status === 'PREPARING' || status === 'PARTIALLY_SHIPPED' ? 0 : 1
}

function compareContextOrder(
  left: ContextPurchaseOrderRow,
  right: ContextPurchaseOrderRow,
): number {
  return priority(left.fulfillmentStatus) - priority(right.fulfillmentStatus)
    || left.orderDate.getTime() - right.orderDate.getTime()
    || left.orderNo.localeCompare(right.orderNo)
    || left.id.localeCompare(right.id)
}

@Injectable()
export class PurchaseOrderFactoryShipmentQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async getSalesOrderContext(
    rawSalesOrderId: unknown,
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<SalesOrderFactoryShipmentContext> {
    const salesOrderId = requireFactoryShipmentUuid(rawSalesOrderId, 'salesOrderId')
    const scope = await this.dataScope.resolve(actorUserId)
    const salesOrder = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, ...salesOrderScopeWhere(scope, actorUserId) },
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        orderStatus: true,
        fulfillmentStatus: true,
        version: true,
      },
    })
    if (salesOrder === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SALES_ORDER_NOT_FOUND',
        '销售订单不存在',
      )
    }
    if (
      salesOrder.orderStatus !== 'CONFIRMED'
      || salesOrder.fulfillmentStatus !== 'PREPARING'
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FACTORY_SHIPMENT_NOT_ALLOWED',
        '销售订单当前不处于待发货状态',
      )
    }

    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      orderBy: [{ orderDate: 'asc' }, { orderNo: 'asc' }, { id: 'asc' }],
      select: CONTEXT_PURCHASE_ORDER_SELECT,
    })
    const dictionarySupplierRows = rows.filter(
      (row): row is typeof row & { readonly supplierValue: string } =>
        row.supplierValue !== null,
    )
    const resolutions = await this.dictionaryLookup.resolveStoredValues({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      values: dictionarySupplierRows.map(row => row.supplierValue),
    })
    const supplierByOrderId = new Map(dictionarySupplierRows.map((row, index) => [
      row.id,
      purchaseOrderSupplierFromSources(row, resolutions[index]),
    ]))
    const mappedById = new Map(rows.map(row => [
      row.id,
      this.mapPurchaseOrder(
        row,
        supplierByOrderId.get(row.id) ?? purchaseOrderSupplierFromSources(row, undefined),
      ),
    ]))
    const purchaseOrders = [...rows]
      .sort(compareContextOrder)
      .map(row => mappedById.get(row.id)!)
    return {
      salesOrder: {
        id: salesOrder.id,
        orderNo: salesOrder.orderNo,
        customerName: salesOrder.customerName,
        fulfillmentStatus: 'PREPARING',
        version: salesOrder.version,
      },
      purchaseOrders,
      pendingShipmentCount: purchaseOrders.filter(order => (
        order.fulfillmentStatus === 'ORDERED'
        || order.fulfillmentStatus === 'PREPARING'
        || order.fulfillmentStatus === 'PARTIALLY_SHIPPED'
      )).length,
      shipmentSatisfiedCount: purchaseOrders.filter(order => (
        order.fulfillmentStatus === 'SHIPPED'
        || order.fulfillmentStatus === 'SIGNED'
      )).length,
    }
  }

  private mapPurchaseOrder(
    row: ContextPurchaseOrderRow,
    resolvedSupplier: PurchaseOrderSupplier,
  ): SalesOrderFactoryShipmentContext['purchaseOrders'][number] {
    return {
      id: row.id,
      orderNo: row.orderNo,
      orderDate: row.orderDate.toISOString().slice(0, 10),
      productMode: row.productMode,
      supplier: resolvedSupplier,
      fulfillmentStatus: row.fulfillmentStatus,
      version: row.version,
      shippingMarkText: row.shippingMarkText,
      parts: row.parts.map(part => ({
        id: part.id, shipmentNo: part.shipmentNo, partNumber: part.partNumber, status: part.status, shippingMarkText: part.shippingMarkText,
        shippedAt: part.shippedAt?.toISOString() ?? null,
        shippedById: part.shippedById,
        shippedBy: part.shippedBy,
        shipmentRecordedAt: part.shipmentRecordedAt?.toISOString() ?? null,
        shipmentRemark: part.shipmentRemark,
        trackingNo: part.trackingNo ?? null,
        destinationWarehouseValue: part.destinationWarehouseValue ?? null,
        warehouseReceivedAt: part.warehouseReceivedAt?.toISOString() ?? null,
        warehouseReceivedById: part.warehouseReceivedById,
        warehouseRecordedAt: part.warehouseRecordedAt?.toISOString() ?? null,
        warehouseRemark: part.warehouseRemark,
        warehouseReceivedBy: part.warehouseReceivedBy,
        items: part.items.map(item => ({ purchaseOrderLineId: item.purchaseOrderLineId, lineNumber: item.line.lineNumber, quantity: item.quantity })),
      })),
      lineSummary: {
        lineCount: row.lines.length,
        totalQuantity: row.lines.reduce((sum, line) => sum + line.quantity, 0),
        previews: row.lines.map((line) => {
          const image = line.product?.media[0]
          return {
            lineId: line.id,
            productName: line.productNameSnapshot,
            quantity: line.quantity,
            mainImage: line.productId === null || image === undefined
              ? null
              : {
                  id: image.id,
                  contentUrl:
                    `/api/purchase-orders/${row.id}/lines/${line.id}/main-image/${image.id}/content`,
                },
          }
        }),
      },
    }
  }
}
