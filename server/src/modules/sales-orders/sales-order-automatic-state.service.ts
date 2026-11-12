import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { noopSystemNotifications } from '../notifications/noop-system-notification'
import { SystemNotificationService } from '../notifications/system-notification.service'
import {
  salesOrderFulfillmentStatusLabel,
  salesOrderPaymentStatusLabel,
  salesOrderStatusLabel,
} from '../notifications/notification-display-labels'
import { readSalesOrderReconciliationStates } from './domain/sales-order-reconciliation-state'
import {
  assertSalesOrderStatusTransition,
} from './domain/sales-order-state-machine'

const NOTIFICATION_TIME_FORMAT = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
  day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', month: '2-digit', timeZone: 'Asia/Shanghai', year: 'numeric',
})
function notificationTime(value: Date): string {
  const parts = new Map(NOTIFICATION_TIME_FORMAT.formatToParts(value).map(part => [part.type, part.value]))
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`
}

export type SalesOrderAutomaticReconciliationTrigger
  = | 'DELIVERY_RECEIPT'
    | 'FULFILLMENT'
    | 'PAYMENT'
    | 'PAYMENT_TERMS'
    /// 最后一个有效货件签收后自动确认订单签收。
    | 'SHIPMENT_SIGNED'
    /// 顺联航账单对账完成时的代收货款回填。
    | 'RECONCILIATION'

/**
 * 推进结果：本次调用把订单停在哪里（`NONE` = 不可推进或无变化）。
 * 调用方用它区分「本次是否自动完成了订单」——批次完成审计要统计自动完成订单数。
 */
export type SalesOrderAutomaticAdvanceResult
  = | 'NONE'
    | 'PENDING_RECONCILIATION'
    | 'COMPLETED'

export interface SalesOrderAutomaticStateContext {
  readonly actorUserId: string
  readonly requestId: string
}

/**
 * 把两段「系统派生」的订单状态收敛到唯一服务中，调用方必须复用已锁定销售订单
 * 的业务事务，确保原始操作、状态历史与审计要么一起提交、要么一起回滚：
 *
 * 1. 已确认 + 已签收 + 已付清 → 待对账；
 * 2. 待对账 + 已签收 + 已付清 + 对账已完结（口径 R3：订单被对账覆盖且没有任何成员行
 *    处于进行中的批次）→ 已完成。**已完成只能由本服务推进**，手工入口直接拒绝。
 *
 * 判定读取事务内的最新事实，客户端不参与；任一步条件不满足就停在当前状态，
 * 等下一次事实变更（收款、履约、账单批次完成）再整体重评。
 */
@Injectable()
export class SalesOrderAutomaticStateService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: SystemNotificationService = noopSystemNotifications,
  ) {}

  async advanceWhenEligible(
    transaction: Prisma.TransactionClient,
    context: SalesOrderAutomaticStateContext,
    salesOrderId: string,
    trigger: SalesOrderAutomaticReconciliationTrigger,
  ): Promise<SalesOrderAutomaticAdvanceResult> {
    const order = await transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        agreedTotalAmount: true,
        currencyCode: true,
        customerName: true,
        customerPhone: true,
        fulfillmentStatus: true,
        issuerUserId: true,
        orderNo: true,
        orderStatus: true,
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
    if (order.fulfillmentStatus !== 'SIGNED' || order.paymentStatus !== 'PAID') {
      return 'NONE'
    }

    let advanced = false
    let currentStatus = order.orderStatus
    if (currentStatus === 'CONFIRMED') {
      // 目标不是取消状态，activeReceivedAmount 不参与本次校验；仍统一经过状态机，
      // 防止后续调整订单流转图时自动路径绕过正式规则。
      assertSalesOrderStatusTransition(currentStatus, 'PENDING_RECONCILIATION', {
        activeReceivedAmount: '0.00',
        fulfillmentStatus: order.fulfillmentStatus,
        paymentStatus: order.paymentStatus,
      })
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
      advanced = true
      currentStatus = 'PENDING_RECONCILIATION'
    }

    if (currentStatus !== 'PENDING_RECONCILIATION') {
      return 'NONE'
    }
    // 完成判定与「进待对账」共用同一份事务内事实：对账已完结才自动完成，
    // 未完结（账单未覆盖或有进行中批次）就停在待对账等待下一次事件重评。
    const reconciliation = (await readSalesOrderReconciliationStates(transaction, [salesOrderId]))
      .get(salesOrderId)
    if (reconciliation === undefined || !reconciliation.settled) {
      return advanced ? 'PENDING_RECONCILIATION' : 'NONE'
    }
    // 与手工时代相同的复核：完成前必须重新确认已签收且已付清（付款可能已被作废）。
    assertSalesOrderStatusTransition(currentStatus, 'COMPLETED', {
      activeReceivedAmount: '0.00',
      fulfillmentStatus: order.fulfillmentStatus,
      paymentStatus: order.paymentStatus,
    })
    await transaction.salesOrder.update({
      where: { id: salesOrderId },
      data: {
        orderStatus: 'COMPLETED',
        version: { increment: 1 },
      },
    })
    await transaction.salesOrderStatusHistory.create({ data: {
      salesOrderId,
      dimension: 'ORDER',
      fromStatus: 'PENDING_RECONCILIATION',
      toStatus: 'COMPLETED',
      reason: '订单对账已完成，系统自动完成订单',
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
        fromStatus: 'PENDING_RECONCILIATION',
        toStatus: 'COMPLETED',
        trigger,
      },
    })
    const completedAt = new Date()
    await this.notifications.publish({
      eventType: 'SALES_ORDER_COMPLETED',
      source: { type: 'SALES_ORDER', id: salesOrderId },
      target: { kind: 'USERS', userIds: [order.issuerUserId] },
      templateKey: 'sales.order.completed',
      variables: {
        agreedTotalAmount: order.agreedTotalAmount.toFixed(2),
        currencyCode: order.currencyCode,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        fulfillmentStatus: salesOrderFulfillmentStatusLabel(order.fulfillmentStatus),
        occurredAt: notificationTime(completedAt),
        orderNo: order.orderNo,
        orderStatus: salesOrderStatusLabel(order.orderStatus),
        paymentStatus: salesOrderPaymentStatusLabel(order.paymentStatus),
      },
      dedupeKey: `sales-order-completed:${salesOrderId}`,
      priority: 'NORMAL',
      requestedByUserId: context.actorUserId,
    }, { transaction })
    return 'COMPLETED'
  }
}
