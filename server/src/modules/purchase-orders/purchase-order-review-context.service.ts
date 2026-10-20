import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../access-control/data-scope.service'
import { PurchaseShippingMarkResolverService } from '../purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION, PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION, PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION, PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION, PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION } from './purchase-order-create-fingerprint'
import { purchaseOrderScopeWhere } from './purchase-order-access'
import { purchaseReviewSourceBlockReason } from './purchase-order-review-source'

@Injectable()
export class PurchaseOrderReviewContextService {
  constructor(private readonly prisma: PrismaService, private readonly shippingMarks: PurchaseShippingMarkResolverService, private readonly dataScope: DataScopeService = dataScopeFallback()) {}

  async read(purchaseOrderId: string, actorUserId: string = resolveDataScopeActor()): Promise<{ available: boolean, message: string | null }> {
    try {
      // 只检查当下资格，不预留编号或锁定业务；正式审核仍在写事务内重新校验。
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const scope = await this.dataScope.resolveInTransaction(transaction, actorUserId)
        const order = await transaction.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, ...purchaseOrderScopeWhere(scope, actorUserId) },
          select: {
            orderStatus: true, fulfillmentStatus: true, purchaseType: true,
            salesOrder: { select: { orderStatus: true } },
            productMode: true, supplierValue: true, createRequestFingerprintVersion: true,
            shippingMarkText: true, shippingMarkIssuanceId: true, _count: { select: { parts: true } },
          },
        })
        if (order === null) throw new ApiException(HttpStatus.NOT_FOUND, 'PURCHASE_ORDER_NOT_FOUND', '采购订单不存在')
        const blocked = (message: string) => ({ available: false, message })
        if (order.orderStatus !== 'PENDING_REVIEW') return blocked(order.orderStatus === 'CANCELLED' ? '采购订单已取消，请关闭审核并查看最新详情' : '采购订单已审核通过，请关闭审核并查看最新详情')
        if (order.fulfillmentStatus !== 'ORDERED') return blocked('采购订单履约状态异常，请联系管理员核实后再审核')
        if (order.purchaseType === 'SALES_LINKED') {
          const reason = purchaseReviewSourceBlockReason(order.salesOrder?.orderStatus ?? null)
          if (reason) return blocked(reason)
        }
        // 已生成图片时派发的唛头及历史唛头均保留，不因当前规则停用而重新取号。
        if (order.createRequestFingerprintVersion === PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION || order.createRequestFingerprintVersion === PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION) return { available: true, message: null }
        if ((order.createRequestFingerprintVersion !== PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION && order.createRequestFingerprintVersion !== PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION && order.createRequestFingerprintVersion !== PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION) || order.productMode === 'MIXED'
          || (order.shippingMarkText === null) !== (order.shippingMarkIssuanceId === null) || order._count.parts < 1) return blocked('采购货件或唛头配置不完整，请联系管理员核实后再审核')
        if (order.shippingMarkText !== null) return { available: true, message: null }
        const resolution = await this.shippingMarks.resolve(transaction, { productMode: order.productMode, supplierValue: order.supplierValue }, false)
        return resolution.availability === 'AVAILABLE' ? { available: true, message: null } : blocked(resolution.message)
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    }
    catch (error) {
      const facts = readPersistenceErrorFacts(error)
      if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
        throw new ApiException(HttpStatus.CONFLICT, 'PURCHASE_ORDER_STATE_CHANGED', '审核条件正在变化，请重新检查后再确认')
      }
      throw error
    }
  }
}
