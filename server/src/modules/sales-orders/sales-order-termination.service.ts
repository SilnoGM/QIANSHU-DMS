import { randomUUID } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DataScopeService } from '../access-control/data-scope.service'
import { ShipmentStorageService } from '../shipment-storage/shipment-storage.service'
import { resolvePurchaseShipmentViewStatus } from '../purchase-orders/shipments/purchase-shipment-view'
import { salesOrderScopeWhere } from './sales-order-access'
import type { SalesOrderDetail } from './sales-order-query.service'
import type {
  SalesOrderTerminationContextDto,
  SalesOrderTerminationRequestDto,
  SalesOrderTerminationShipmentDto,
} from './dto/sales-order-termination.dto'
import { SalesOrderMutationService } from './sales-order-mutation.service'

export interface SalesOrderTerminationContext {
  readonly actorUserId: string
  readonly requestId: string
}

function terminationFailure(code: string, message: string, status: number = HttpStatus.UNPROCESSABLE_ENTITY): never {
  throw new ApiException(status, code, message)
}

@Injectable()
export class SalesOrderTerminationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly storage: ShipmentStorageService,
    private readonly mutations: SalesOrderMutationService,
  ) {}

  async getContext(
    context: Pick<SalesOrderTerminationContext, 'actorUserId'>,
    salesOrderId: string,
  ): Promise<SalesOrderTerminationContextDto> {
    const scope = await this.dataScope.resolve(context.actorUserId)
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, ...salesOrderScopeWhere(scope, context.actorUserId) },
      select: { id: true, orderStatus: true, fulfillmentStatus: true },
    })
    if (order === null) {
      terminationFailure('SALES_ORDER_NOT_FOUND', '销售订单不存在', HttpStatus.NOT_FOUND)
    }
    // 货物对换会把其他采购单的货件转入本单；终止只遍历本单采购单，必须先阻断，避免留下孤儿归属。
    const crossOwnedShipmentCount = await this.prisma.purchaseOrderPart.count({
      where: {
        status: 'ACTIVE',
        ownershipCurrent: {
          ownerType: 'SALES_ORDER',
          ownerSalesOrderId: salesOrderId,
          state: 'ACTIVE',
        },
        purchaseOrder: { salesOrderId: { not: salesOrderId } },
      },
    })
    if (crossOwnedShipmentCount > 0) {
      terminationFailure(
        'SALES_ORDER_TERMINATION_SWAP_PENDING',
        '该销售单存在货物对换转入的货件，请先处理对换货件后再终止',
        HttpStatus.CONFLICT,
      )
    }
    const pendingReceiptCount = await this.prisma.salesReceiptRequest.count({
      where: { salesOrderId, status: 'PENDING_REVIEW' },
    })
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: {
        salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { not: 'CANCELLED' },
      },
      select: {
        paymentStatus: true,
        parts: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { partNumber: 'asc' },
          select: {
            id: true,
            shipmentNo: true,
            partNumber: true,
            shippingMarkText: true,
            status: true,
            shippedAt: true,
            warehouseReceivedAt: true,
            loadedAt: true,
            deliveredAt: true,
            destinationWarehouseValue: true,
            ownershipCurrent: { select: { ownerType: true, ownerSalesOrderId: true } },
            storageRecords: {
              where: { status: { in: ['IN_STORAGE', 'CLAIMED'] } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { id: true, status: true },
            },
            packagingCosts: { select: { status: true } },
          },
        },
      },
    })

    const shipments: SalesOrderTerminationShipmentDto[] = []
    for (const purchaseOrder of purchaseOrders) {
      for (const part of purchaseOrder.parts) {
        const storage = part.storageRecords[0] ?? null
        const ownership = part.ownershipCurrent
        const delivered = part.deliveredAt !== null
        const ownedByOrder = ownership === null
          || (ownership.ownerType === 'SALES_ORDER' && ownership.ownerSalesOrderId === salesOrderId)
        const pending = !delivered && ownedByOrder && storage === null
        const pendingPackaging = part.packagingCosts.some(cost => cost.status === 'PENDING_PAYMENT')
        const blockedReason = !pending
          ? null
          : part.status !== 'ACTIVE'
            ? '货件待审核或已取消'
            : part.shippedAt === null
              ? '尚未发货'
              : part.warehouseReceivedAt === null
                ? '尚未到仓'
                : purchaseOrder.paymentStatus !== 'PAID'
                  ? '采购单未付清'
                  : pendingPackaging
                    ? '包装费待付款'
                    : part.loadedAt === null && part.destinationWarehouseValue === null
                      ? '缺少目的地仓库'
                      : ownership === null
                        ? '归属信息缺失'
                        : null
        shipments.push({
          id: part.id,
          shipmentNo: part.shipmentNo,
          partNumber: part.partNumber,
          shippingMarkText: part.shippingMarkText,
          status: part.status,
          viewStatus: resolvePurchaseShipmentViewStatus({
            status: part.status,
            shippedAt: part.shippedAt,
            warehouseReceivedAt: part.warehouseReceivedAt,
            loadedAt: part.loadedAt,
            deliveredAt: part.deliveredAt,
          }),
          loaded: part.loadedAt !== null,
          pending,
          releasable: pending && blockedReason === null,
          blockedReason,
          storageStatus: storage?.status ?? null,
          ownerType: ownership?.ownerType ?? null,
          deliveredAt: part.deliveredAt?.toISOString() ?? null,
        })
      }
    }

    const pendingShipments = shipments.filter(shipment => shipment.pending)
    const allShipmentsProcessed = pendingShipments.length === 0
    const blockedReason = order.orderStatus !== 'CONFIRMED'
      ? '只有已确认订单可以终止'
      : order.fulfillmentStatus === 'SIGNED'
        ? '订单已签收，不能终止'
        : pendingReceiptCount > 0
          ? '订单仍有待审核收款，请先处理申请'
          : pendingShipments.find(shipment => !shipment.releasable)?.blockedReason ?? null
    return {
      orderId: order.id,
      orderStatus: order.orderStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      pendingReceiptCount,
      pendingShipmentCount: pendingShipments.length,
      processedShipmentCount: shipments.length - pendingShipments.length,
      allShipmentsProcessed,
      canTerminate: blockedReason === null,
      blockedReason,
      shipments,
    }
  }

  async terminate(
    context: SalesOrderTerminationContext,
    salesOrderId: string,
    input: SalesOrderTerminationRequestDto,
  ): Promise<SalesOrderDetail> {
    const termination = await this.getContext(context, salesOrderId)
    if (termination.orderStatus !== 'CONFIRMED') {
      terminationFailure('SALES_ORDER_TERMINATION_NOT_ALLOWED', '只有已确认订单可以终止')
    }
    if (termination.fulfillmentStatus === 'SIGNED') {
      terminationFailure('SALES_ORDER_TERMINATE_SIGNED', '订单已签收，不能终止')
    }
    if (termination.pendingReceiptCount > 0) {
      terminationFailure('SALES_RECEIPT_STATE_CHANGED', '订单仍有待审核收款，请先处理申请', HttpStatus.CONFLICT)
    }
    const pending = termination.shipments.filter(shipment => shipment.pending)
    const selected = [...new Set(input.shipmentIds ?? [])].sort()
    const pendingIds = pending.map(shipment => shipment.id).sort()
    if (pending.length === 0) {
      return this.mutations.updateOrderStatus(context, salesOrderId, {
        toStatus: 'TERMINATED',
        reason: input.reason,
      })
    }
    if (selected.length !== pendingIds.length || selected.some((id, index) => id !== pendingIds[index])) {
      terminationFailure(
        'SALES_ORDER_TERMINATION_SHIPMENTS_MISMATCH',
        '终止前必须释放全部仍归属本单的非签收货件',
      )
    }
    const unreleasable = pending.find(shipment => !shipment.releasable)
    if (unreleasable !== undefined) {
      terminationFailure(
        'SALES_ORDER_TERMINATION_SHIPMENT_NOT_RELEASABLE',
        `货件 ${unreleasable.shipmentNo ?? `货件-${unreleasable.partNumber}`} 不能释放：${unreleasable.blockedReason ?? '前置条件不满足'}`,
      )
    }
    const loaded = pending.filter(shipment => shipment.loaded)
    if (loaded.length > 0 && (input.overseasWarehouseValue === undefined || input.overseasWarehouseValue.trim() === '')) {
      terminationFailure('SALES_ORDER_TERMINATION_WAREHOUSE_REQUIRED', '已装柜货件必须选择海外仓库')
    }
    const unloaded = pending.filter(shipment => !shipment.loaded)
    const releaseReason = 'OTHER' as const
    if (unloaded.length > 0) {
      await this.storage.release(context, {
        shipmentIds: unloaded.map(shipment => shipment.id),
        locationScope: 'MAINLAND',
        reason: releaseReason,
        note: input.reason,
        requestKey: randomUUID(),
      })
    }
    if (loaded.length > 0) {
      await this.storage.release(context, {
        shipmentIds: loaded.map(shipment => shipment.id),
        locationScope: 'OVERSEAS',
        overseasWarehouseValue: input.overseasWarehouseValue,
        reason: releaseReason,
        note: input.reason,
        requestKey: randomUUID(),
      })
    }
    try {
      return await this.mutations.updateOrderStatus(context, salesOrderId, {
        toStatus: 'TERMINATED',
        reason: input.reason,
      })
    }
    catch {
      terminationFailure(
        'SALES_ORDER_TERMINATION_STATUS_FAILED',
        '货件已释放，但订单终止失败，请重新执行终止',
        HttpStatus.CONFLICT,
      )
    }
  }
}
