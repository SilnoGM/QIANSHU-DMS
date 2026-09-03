import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  assertSalesOrderStatusTransition,
} from './domain/sales-order-state-machine'

export type SalesOrderAutomaticReconciliationTrigger
  = | 'DELIVERY_RECEIPT'
    | 'FULFILLMENT'
    | 'PAYMENT'
    | 'PAYMENT_TERMS'

export interface SalesOrderAutomaticStateContext {
  readonly actorUserId: string
  readonly requestId: string
}

/**
 * 把“已签收且已付清”这一跨履约、付款维度的派生事实收敛到唯一服务中。
 * 调用方必须复用已经锁定销售订单的业务事务，确保原始操作、状态历史与审计要么
 * 一起提交，要么一起回滚；客户端不参与判断是否具备待对账资格。
 */
@Injectable()
export class SalesOrderAutomaticStateService {
  constructor(private readonly audit: AuditService) {}

  async advanceToPendingReconciliationWhenEligible(
    transaction: Prisma.TransactionClient,
    context: SalesOrderAutomaticStateContext,
    salesOrderId: string,
    trigger: SalesOrderAutomaticReconciliationTrigger,
  ): Promise<boolean> {
    const order = await transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        orderStatus: true,
        fulfillmentStatus: true,
        paymentStatus: true,
      },
    })
    if (order === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SALES_ORDER_NOT_FOUND',
        '销售订单不存在',
      )
    }
    if (
      order.orderStatus !== 'CONFIRMED'
      || order.fulfillmentStatus !== 'SIGNED'
      || order.paymentStatus !== 'PAID'
    ) {
      return false
    }

    // 目标不是取消状态，activeReceivedAmount 不参与本次校验；仍统一经过状态机，
    // 防止后续调整订单流转图时自动路径绕过正式规则。
    assertSalesOrderStatusTransition(
      order.orderStatus,
      'PENDING_RECONCILIATION',
      {
        activeReceivedAmount: '0.0000',
        fulfillmentStatus: order.fulfillmentStatus,
        paymentStatus: order.paymentStatus,
      },
    )
    await transaction.salesOrder.update({
      where: { id: salesOrderId },
      data: {
        orderStatus: 'PENDING_RECONCILIATION',
        version: { increment: 1 },
      },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId,
      dimension: 'ORDER',
      fromStatus: 'CONFIRMED',
      toStatus: 'PENDING_RECONCILIATION',
      reason: '订单已签收且已付清，系统自动进入待对账',
      changedByUserId: context.actorUserId,
    } })
    await this.audit.record(transaction, {
      eventType: AuditEventType.SALES_ORDER_ORDER_STATUS_CHANGED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      targetType: 'SALES_ORDER',
      targetId: salesOrderId,
      requestId: context.requestId,
      metadata: {
        automatic: true,
        fromStatus: 'CONFIRMED',
        toStatus: 'PENDING_RECONCILIATION',
        trigger,
      },
    })
    return true
  }
}
