import { HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../access-control/data-scope.service'
import { salesOrderScopeWhere } from './sales-order-access'
import type { SalesOrderPendingPurchaseProductsDto } from './dto/sales-order-pending-purchase.dto'

@Injectable()
export class SalesOrderPendingPurchaseQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async list(
    salesOrderId: string,
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<SalesOrderPendingPurchaseProductsDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, ...salesOrderScopeWhere(scope, actorUserId) },
      select: {
        id: true,
        lines: {
          where: { removedAt: null },
          orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
          select: {
            id: true, lineType: true, productId: true,
            productNameSnapshot: true, quantity: true,
            product: { select: { media: {
              where: {
                kind: 'IMAGE', isPrimary: true, detachedAt: null,
                mediaAsset: { is: { status: 'READY' } },
              },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              take: 1, select: { id: true },
            } } },
          },
        },
      },
    })
    if (order === null) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
    }
    const lineIds = order.lines.map(line => line.id)
    const purchases = lineIds.length === 0 ? [] : await this.prisma.purchaseOrderLine.findMany({
      where: {
        sourceSalesOrderLineId: { in: lineIds },
        purchaseOrder: { is: {
          purchaseType: 'SALES_LINKED', salesOrderId, orderStatus: { not: 'CANCELLED' },
        } },
      },
      select: { sourceSalesOrderLineId: true, quantity: true },
    })
    // 同一目录产品可有多条销售行，采购覆盖必须按来源行累计，取消的采购不占用数量。
    const purchasedByLine = new Map<string, number>()
    for (const purchase of purchases) {
      if (purchase.sourceSalesOrderLineId === null) continue
      purchasedByLine.set(purchase.sourceSalesOrderLineId,
        (purchasedByLine.get(purchase.sourceSalesOrderLineId) ?? 0) + purchase.quantity)
    }
    return { items: order.lines.flatMap((line) => {
      const remainingQuantity = line.quantity - (purchasedByLine.get(line.id) ?? 0)
      if (remainingQuantity <= 0) return []
      const image = line.product?.media[0]
      return [{
        id: line.id, productName: line.productNameSnapshot, lineType: line.lineType,
        remainingQuantity,
        mainImage: line.productId === null || image === undefined ? null : {
          id: image.id,
          contentUrl: `/api/sales-orders/${order.id}/lines/${line.id}/main-image/${image.id}/content`,
        },
      }]
    }) }
  }
}
