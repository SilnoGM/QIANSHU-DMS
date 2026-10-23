import { assertReceiptCapacity } from './receipts/sales-receipt-money'
import { randomUUID } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type SalesOrderFulfillmentStatus,
  type SalesOrderPaymentStatus,
} from '../../generated/prisma/enums'
import {
  hasPersistenceCode,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { DataScopeService, dataScopeFallback } from '../access-control/data-scope.service'
import { salesOrderScopeWhere } from './sales-order-access'
import {
  SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES,
} from '../purchase-orders/domain/purchase-order-source-sales-order-view'
import {
  isCanonicalSalesOrderActorId,
  type NormalizedSalesOrderCatalogLine,
  type NormalizedSalesOrderCreateLine,
} from './sales-order-command.normalizer'
import {
  deriveSalesOrderPaymentStatus,
  formatSalesOrderAmountUnits,
  parseSalesOrderAmountUnits,
} from './domain/sales-order-decimal'
import {
  deriveProductEditFulfillmentStatus,
  productEditFulfillmentReason,
  productEditFulfillmentSteps,
  salesOrderFulfillmentStageRank,
} from './domain/sales-order-product-edit-fulfillment'
import { assertSalesOrderFulfillmentTransition } from './domain/sales-order-state-machine'
import {
  normalizeSalesOrderProductEditCommand,
} from './sales-order-product-edit.normalizer'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_SALES_ORDER_LINES = 100
const CONCURRENT_CODES = ['P2034', '40001', '40P01', '55P03'] as const

interface ProductSnapshot {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly attributes: Prisma.InputJsonValue
  readonly standardUnitPriceAmount: string | null
}

export interface SalesOrderProductEditContext {
  readonly actorUserId: string
  readonly requestId: string
}

export interface SalesOrderProductsUpdateResult {
  readonly salesOrderId: string
  readonly previousVersion: number
  readonly version: number
  readonly addedLineIds: readonly string[]
  readonly updatedLineIds: readonly string[]
  readonly removedLineIds: readonly string[]
  readonly amountDelta: string
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly paymentStatus: SalesOrderPaymentStatus
  readonly depositReduced: boolean
  readonly amounts: {
    readonly lineSubtotalAmount: string
    readonly agreedTotalAmount: string
    readonly depositDueAmount: string
    readonly balanceDueAmount: string
    readonly paidAmount: string
    readonly outstandingAmount: string
  }
}

function fixed2(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2)
}

function failure(status: HttpStatus, code: string, message: string): ApiException {
  return new ApiException(status, code, message)
}

function validateContext(context: SalesOrderProductEditContext) {
  if (
    !isCanonicalSalesOrderActorId(context.actorUserId)
    || typeof context.requestId !== 'string'
    || [...context.requestId].length < 1
    || [...context.requestId].length > 64
  ) {
    throw failure(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
  }
  return context
}

function validateSalesOrderId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw failure(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '请求参数校验失败')
  }
  return value
}

function signedAmount(value: bigint): string {
  return value < 0n
    ? `-${formatSalesOrderAmountUnits(-value)}`
    : formatSalesOrderAmountUnits(value)
}

function productEditStateChanged(): ApiException {
  return failure(
    HttpStatus.CONFLICT,
    'SALES_ORDER_PRODUCT_EDIT_STATE_CHANGED',
    '销售订单产品或关联采购状态已变化，请刷新后重试',
  )
}

function isConcurrentConflict(caught: unknown): boolean {
  const facts = readPersistenceErrorFacts(caught)
  return CONCURRENT_CODES.some(code => hasPersistenceCode(facts, code))
}

function standardPriceFor(
  product: {
    readonly twdSalePriceAmount: { toFixed(decimalPlaces: number): string } | null
    readonly myrSalePriceAmount: { toFixed(decimalPlaces: number): string } | null
  },
  currencyCode: 'TWD' | 'MYR',
): string | null {
  const amount = currencyCode === 'TWD'
    ? product.twdSalePriceAmount
    : product.myrSalePriceAmount
  return amount === null ? null : fixed2(amount)
}

function normalizeAttributes(value: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(value)) throw productEditStateChanged()
  return value as Prisma.InputJsonValue
}

@Injectable()
export class SalesOrderProductEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async updateProducts(
    context: SalesOrderProductEditContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderProductsUpdateResult> {
    const trusted = validateContext(context)
    const salesOrderId = validateSalesOrderId(rawSalesOrderId)
    const command = normalizeSalesOrderProductEditCommand(input)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const scope = await this.dataScope.resolveInTransaction(
          transaction,
          trusted.actorUserId,
        )
        const accessibleOrder = await transaction.salesOrder.findFirst({
          where: { id: salesOrderId, ...salesOrderScopeWhere(scope, trusted.actorUserId) },
          select: { id: true },
        })
        if (accessibleOrder === null) {
          throw failure(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
        }
        /*
         * 与采购创建保持同一锁顺序：先按稳定 ID 锁有效销售明细，再锁订单主行。
         * 这样产品减少与新采购争用同一销售明细时不会形成反向等待。
         */
        const lockedLines = await transaction.$queryRaw<Array<{ readonly id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "sales_order_lines"
            WHERE "sales_order_id" = CAST(${salesOrderId} AS uuid)
              AND "removed_at" IS NULL
            ORDER BY "id"
            FOR UPDATE
          `,
        )
        const lockedOrders = await transaction.$queryRaw<Array<{ readonly id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "sales_orders"
            WHERE "id" = CAST(${salesOrderId} AS uuid)
            FOR UPDATE
          `,
        )
        if (lockedOrders.length !== 1) {
          throw failure(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
        }

        const order = await transaction.salesOrder.findUnique({
          where: { id: salesOrderId },
          select: {
            id: true,
            orderStatus: true,
            fulfillmentStatus: true,
            paymentStatus: true,
            currencyCode: true,
            lineSubtotalAmount: true,
            agreedTotalAmount: true,
            depositDueAmount: true,
            balanceDueAmount: true,
            version: true,
            lines: {
              where: { removedAt: null },
              orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                lineNumber: true,
                lineType: true,
                productId: true,
                productNameSnapshot: true,
                descriptionSnapshot: true,
                actualUnitPriceAmount: true,
                quantity: true,
                lineTotalAmount: true,
              },
            },
          },
        })
        if (order === null) {
          throw failure(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
        }
        if (order.version !== command.expectedVersion) {
          throw failure(
            HttpStatus.CONFLICT,
            'SALES_ORDER_PRODUCT_EDIT_VERSION_CONFLICT',
            '销售订单已被其他操作更新，请刷新后重试',
          )
        }
        if (
          order.orderStatus !== 'CONFIRMED'
          || !SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES.includes(
            order.fulfillmentStatus as typeof SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES[number],
          )
          || (order.currencyCode !== 'TWD' && order.currencyCode !== 'MYR')
        ) {
          throw failure(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
            '销售订单当前不允许修改产品',
          )
        }

        const currentIds = order.lines.map(line => line.id).sort()
        const lockedIds = lockedLines.map(line => line.id).sort()
        const requestedIds = command.existingLines.map(line => line.lineId).sort()
        if (
          currentIds.length !== lockedIds.length
          || currentIds.some((id, index) => lockedIds[index] !== id)
          || currentIds.length !== requestedIds.length
          || currentIds.some((id, index) => requestedIds[index] !== id)
        ) {
          throw productEditStateChanged()
        }

        const sourceIds = order.lines.map(line => line.id)
        const [
          approvedPurchaseOrderCount,
          purchasedRows,
          paymentAggregate,
          purchaseOrders,
        ] = await Promise.all([
          transaction.purchaseOrder.count({
            where: {
              purchaseType: 'SALES_LINKED',
              salesOrderId,
              orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
            },
          }),
          transaction.purchaseOrderLine.findMany({
            where: {
              sourceSalesOrderLineId: { in: sourceIds },
              purchaseOrder: { is: {
                purchaseType: 'SALES_LINKED',
                salesOrderId,
                orderStatus: { not: 'CANCELLED' },
              } },
            },
            select: {
              sourceSalesOrderLineId: true,
              quantity: true,
              purchaseOrder: { select: { orderStatus: true } },
            },
          }),
          transaction.salesOrderPayment.aggregate({
            where: { salesOrderId, voidedAt: null },
            _sum: { amount: true },
          }),
          // 履约阶段必须由采购与货件的真实进度派生，不能只看采购数量是否覆盖。
          transaction.purchaseOrder.findMany({
            where: {
              salesOrderId,
              purchaseType: 'SALES_LINKED',
              orderStatus: { not: 'CANCELLED' },
            },
            select: {
              orderStatus: true,
              fulfillmentStatus: true,
              parts: { select: {
                status: true,
                shippedAt: true,
                warehouseReceivedAt: true,
                loadedAt: true,
              } },
            },
          }),
        ])
        const purchasedByLine = new Map<string, number>()
        const approvedPurchasedByLine = new Map<string, number>()
        for (const row of purchasedRows) {
          if (row.sourceSalesOrderLineId === null) continue
          purchasedByLine.set(
            row.sourceSalesOrderLineId,
            (purchasedByLine.get(row.sourceSalesOrderLineId) ?? 0) + row.quantity,
          )
          // 全部有效采购仍锁定减量下限；只有已审核数量可以推动备货覆盖。
          if (row.purchaseOrder.orderStatus === 'CONFIRMED' || row.purchaseOrder.orderStatus === 'COMPLETED') {
            approvedPurchasedByLine.set(
              row.sourceSalesOrderLineId,
              (approvedPurchasedByLine.get(row.sourceSalesOrderLineId) ?? 0) + row.quantity,
            )
          }
        }

        const targetById = new Map(command.existingLines.map(line => [line.lineId, line]))
        const updatedLineIds: string[] = []
        const removedLineIds: string[] = []
        const quantityChanges: Array<{ lineId: string, from: number, to: number }> = []
        let newLineSubtotalUnits = 0n
        let remainingQuantity = 0
        for (const line of order.lines) {
          const target = targetById.get(line.id)
          if (target === undefined) throw productEditStateChanged()
          const activePurchasedQuantity = purchasedByLine.get(line.id) ?? 0
          if (target.desiredQuantity < activePurchasedQuantity) {
            throw failure(
              HttpStatus.UNPROCESSABLE_ENTITY,
              'SALES_ORDER_PRODUCT_DECREASE_PURCHASE_LOCKED',
              `存在有效采购单，产品数量不能低于已采购数量 ${activePurchasedQuantity}`,
            )
          }
          const snapshotChanged = target.name !== line.productNameSnapshot
            || target.description !== line.descriptionSnapshot
            || target.actualUnitPriceAmount !== fixed2(line.actualUnitPriceAmount)
          if (target.desiredQuantity !== line.quantity) {
            quantityChanges.push({
              lineId: line.id,
              from: line.quantity,
              to: target.desiredQuantity,
            })
            if (target.desiredQuantity === 0) removedLineIds.push(line.id)
          }
          if (target.desiredQuantity > 0 && (
            target.desiredQuantity !== line.quantity || snapshotChanged
          )) {
            updatedLineIds.push(line.id)
          }
          if (target.desiredQuantity > 0) {
            newLineSubtotalUnits += parseSalesOrderAmountUnits(
              target.actualUnitPriceAmount,
            ) * BigInt(target.desiredQuantity)
            remainingQuantity += Math.max(
              target.desiredQuantity - (approvedPurchasedByLine.get(line.id) ?? 0),
              0,
            )
          }
        }

        const finalLineCount = order.lines.length
          - removedLineIds.length
          + command.newLines.length
        if (finalLineCount < 1 || finalLineCount > MAX_SALES_ORDER_LINES) {
          throw failure(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SALES_ORDER_LINE_LIMIT_EXCEEDED',
            '销售订单必须保留 1 至 100 行有效产品明细',
          )
        }

        const catalogLines = command.newLines.filter(
          (line): line is NormalizedSalesOrderCatalogLine => line.lineType === 'CATALOG',
        )
        const productIds = [...new Set(catalogLines.map(line => line.productId))]
        const productRows = productIds.length === 0
          ? []
          : await transaction.product.findMany({
              where: { id: { in: productIds }, status: 'ACTIVE' },
              select: {
                id: true,
                productNo: true,
                name: true,
                attributes: true,
                twdSalePriceAmount: true,
                myrSalePriceAmount: true,
              },
            })
        const products = new Map<string, ProductSnapshot>()
        for (const product of productRows) {
          products.set(product.id, {
            id: product.id,
            productNo: product.productNo,
            name: product.name,
            attributes: normalizeAttributes(product.attributes),
            standardUnitPriceAmount: standardPriceFor(product, order.currencyCode),
          })
        }
        if (products.size !== productIds.length) throw productEditStateChanged()

        for (const line of command.newLines) {
          newLineSubtotalUnits += parseSalesOrderAmountUnits(line.lineTotalAmount)
          remainingQuantity += line.quantity
        }
        const oldLineSubtotalUnits = parseSalesOrderAmountUnits(
          fixed2(order.lineSubtotalAmount),
        )
        const amountDeltaUnits = newLineSubtotalUnits - oldLineSubtotalUnits
        const oldAgreedUnits = parseSalesOrderAmountUnits(fixed2(order.agreedTotalAmount))
        const newAgreedUnits = oldAgreedUnits + amountDeltaUnits
        if (newAgreedUnits < 0n) throw productEditStateChanged()

        const paidAmount = paymentAggregate._sum.amount === null
          ? '0.00'
          : fixed2(paymentAggregate._sum.amount)
        const pending = await transaction.salesReceiptRequest.aggregate({ where: { salesOrderId: order.id, status: 'PENDING_REVIEW' }, _sum: { amount: true } })
        const paidUnits = parseSalesOrderAmountUnits(paidAmount)
        if (newAgreedUnits < paidUnits) {
          throw failure(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SALES_ORDER_TOTAL_BELOW_RECEIVED',
            '调整后的销售总价不能低于已收款金额',
          )
        }
        assertReceiptCapacity(formatSalesOrderAmountUnits(newAgreedUnits), paidAmount, pending._sum.amount?.toFixed(2) ?? '0.00')
        const oldDepositUnits = parseSalesOrderAmountUnits(fixed2(order.depositDueAmount))
        const newDepositUnits = oldDepositUnits > newAgreedUnits
          ? newAgreedUnits
          : oldDepositUnits
        const depositReduced = newDepositUnits < oldDepositUnits
        if (depositReduced && !command.confirmDepositReduction) {
          throw failure(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SALES_ORDER_DEPOSIT_REDUCTION_CONFIRMATION_REQUIRED',
            '本次调整需要下调定金，请确认后重试',
          )
        }

        const newLineSubtotalAmount = formatSalesOrderAmountUnits(newLineSubtotalUnits)
        const newAgreedTotalAmount = formatSalesOrderAmountUnits(newAgreedUnits)
        const newDepositDueAmount = formatSalesOrderAmountUnits(newDepositUnits)
        const newBalanceDueAmount = formatSalesOrderAmountUnits(
          newAgreedUnits - newDepositUnits,
        )
        const paymentStatus = deriveSalesOrderPaymentStatus(
          newAgreedTotalAmount,
          paidAmount,
        )
        const activeParts = purchaseOrders.flatMap(purchaseOrder => (
          purchaseOrder.parts.filter(part => part.status === 'ACTIVE')
        ))
        const fulfillmentStatus: SalesOrderFulfillmentStatus
          = deriveProductEditFulfillmentStatus({
            currentStatus: order.fulfillmentStatus,
            remainingQuantity,
            approvedPurchaseOrderCount,
            activePurchaseOrderCount: purchaseOrders.length,
            allPurchaseOrdersApproved: purchaseOrders.every(purchaseOrder => (
              purchaseOrder.orderStatus === 'CONFIRMED'
              || purchaseOrder.orderStatus === 'COMPLETED'
            )),
            hasPendingReviewParts: purchaseOrders.some(purchaseOrder => (
              purchaseOrder.parts.some(part => part.status === 'PENDING_REVIEW')
            )),
            activePartCount: activeParts.length,
            shippedPartCount: activeParts.filter(part => part.shippedAt !== null).length,
            receivedPartCount: activeParts.filter(part => (
              part.warehouseReceivedAt !== null
            )).length,
            loadedPartCount: activeParts.filter(part => part.loadedAt !== null).length,
            hasShippedPurchaseOrder: purchaseOrders.some(purchaseOrder => (
              purchaseOrder.fulfillmentStatus === 'PARTIALLY_SHIPPED'
              || purchaseOrder.fulfillmentStatus === 'SHIPPED'
              || purchaseOrder.fulfillmentStatus === 'SIGNED'
            )),
          })

        const removedAt = new Date()
        for (const line of order.lines) {
          const target = targetById.get(line.id)
          if (target === undefined) continue
          if (target.desiredQuantity === 0) {
            if (target.desiredQuantity === line.quantity) continue
            await transaction.salesOrderLine.update({
              where: { id: line.id },
              data: { removedAt },
            })
          }
          else {
            const snapshotChanged = target.name !== line.productNameSnapshot
              || target.description !== line.descriptionSnapshot
              || target.actualUnitPriceAmount !== fixed2(line.actualUnitPriceAmount)
            if (target.desiredQuantity === line.quantity && !snapshotChanged) continue
            const lineTotalAmount = formatSalesOrderAmountUnits(
              parseSalesOrderAmountUnits(target.actualUnitPriceAmount)
              * BigInt(target.desiredQuantity),
            )
            await transaction.salesOrderLine.update({
              where: { id: line.id },
              data: {
                // 这里只更新销售订单快照；产品档案与已经形成的采购快照均不回写。
                productNameSnapshot: target.name,
                descriptionSnapshot: target.description,
                actualUnitPriceAmount: target.actualUnitPriceAmount,
                quantity: target.desiredQuantity,
                lineTotalAmount,
              },
            })
          }
        }

        const maximumLineNumber = order.lines.reduce(
          (maximum, line) => Math.max(maximum, line.lineNumber),
          0,
        )
        const addedLines = command.newLines.map((line, index) => ({
          id: randomUUID(),
          line: { ...line, lineNumber: maximumLineNumber + index + 1 },
        }))
        if (addedLines.length > 0) {
          await transaction.salesOrderLine.createMany({
            data: addedLines.map(item => this.lineData(
              item.id,
              salesOrderId,
              item.line,
              products,
            )),
          })
        }

        if (amountDeltaUnits !== 0n) {
          await transaction.salesOrderAmountRevision.create({ data: {
            salesOrderId,
            oldLineSubtotalAmount: fixed2(order.lineSubtotalAmount),
            oldAgreedTotalAmount: fixed2(order.agreedTotalAmount),
            oldDepositDueAmount: fixed2(order.depositDueAmount),
            oldBalanceDueAmount: fixed2(order.balanceDueAmount),
            newLineSubtotalAmount,
            newAgreedTotalAmount,
            newDepositDueAmount,
            newBalanceDueAmount,
            reason: command.reason,
            changedByUserId: trusted.actorUserId,
          } })
        }
        if (paymentStatus !== order.paymentStatus) {
          await transaction.salesOrderStatusHistory.create({ data: {
            salesOrderId,
            dimension: 'PAYMENT',
            fromStatus: order.paymentStatus,
            toStatus: paymentStatus,
            reason: '销售产品修改后重新计算付款状态',
            changedByUserId: trusted.actorUserId,
          } })
        }
        const fulfillmentSteps = productEditFulfillmentSteps(
          order.fulfillmentStatus,
          fulfillmentStatus,
        )
        for (const step of fulfillmentSteps) {
          // 前向补齐逐级校验状态机；尚未发货时的 PREPARING → PENDING 是产品
          // 编辑的既有语义，状态机本身只表达单向流转。
          if (
            salesOrderFulfillmentStageRank(step.toStatus)
            > salesOrderFulfillmentStageRank(step.fromStatus)
          ) {
            assertSalesOrderFulfillmentTransition(step.fromStatus, step.toStatus, {
              hasActiveDeliveryReceipt: false,
            })
          }
          await transaction.salesOrderStatusHistory.create({ data: {
            salesOrderId,
            dimension: 'FULFILLMENT',
            fromStatus: step.fromStatus,
            toStatus: step.toStatus,
            reason: productEditFulfillmentReason(step.toStatus),
            changedByUserId: trusted.actorUserId,
          } })
        }
        const version = order.version + 1
        await transaction.salesOrder.update({
          where: { id: salesOrderId },
          data: {
            lineSubtotalAmount: newLineSubtotalAmount,
            agreedTotalAmount: newAgreedTotalAmount,
            depositDueAmount: newDepositDueAmount,
            balanceDueAmount: newBalanceDueAmount,
            fulfillmentStatus,
            paymentStatus,
            version: { increment: 1 },
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.SALES_ORDER_PRODUCTS_CHANGED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'SALES_ORDER',
          targetId: salesOrderId,
          requestId: trusted.requestId,
          metadata: {
            addedLineIds: addedLines.map(item => item.id),
            updatedLineIds,
            quantityChanges,
            removedLineIds,
            amountDelta: signedAmount(amountDeltaUnits),
            depositReduced,
            fromFulfillmentStatus: order.fulfillmentStatus,
            toFulfillmentStatus: fulfillmentStatus,
            previousVersion: order.version,
            version,
            reason: command.reason,
          },
        })
        return {
          salesOrderId,
          previousVersion: order.version,
          version,
          addedLineIds: addedLines.map(item => item.id),
          updatedLineIds,
          removedLineIds,
          amountDelta: signedAmount(amountDeltaUnits),
          fulfillmentStatus,
          paymentStatus,
          depositReduced,
          amounts: {
            lineSubtotalAmount: newLineSubtotalAmount,
            agreedTotalAmount: newAgreedTotalAmount,
            depositDueAmount: newDepositDueAmount,
            balanceDueAmount: newBalanceDueAmount,
            paidAmount,
            outstandingAmount: formatSalesOrderAmountUnits(newAgreedUnits - paidUnits),
          },
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    }
    catch (caught) {
      if (isConcurrentConflict(caught)) {
        throw failure(
          HttpStatus.CONFLICT,
          'SALES_ORDER_PRODUCT_EDIT_VERSION_CONFLICT',
          '销售订单已被其他操作更新，请刷新后重试',
        )
      }
      throw caught
    }
  }

  private lineData(
    id: string,
    salesOrderId: string,
    line: NormalizedSalesOrderCreateLine,
    products: ReadonlyMap<string, ProductSnapshot>,
  ): Prisma.SalesOrderLineCreateManyInput {
    if (line.lineType === 'CUSTOM') {
      return {
        id,
        salesOrderId,
        lineNumber: line.lineNumber,
        lineType: line.lineType,
        productNameSnapshot: line.name,
        productAttributesSnapshot: [],
        descriptionSnapshot: line.description,
        actualUnitPriceAmount: line.actualUnitPriceAmount,
        quantity: line.quantity,
        lineTotalAmount: line.lineTotalAmount,
      }
    }
    const product = products.get(line.productId)
    if (product === undefined) throw productEditStateChanged()
    return {
      id,
      salesOrderId,
      lineNumber: line.lineNumber,
      lineType: line.lineType,
      productId: product.id,
      productNoSnapshot: product.productNo,
      productNameSnapshot: product.name,
      productAttributesSnapshot: product.attributes,
      standardUnitPriceAmount: product.standardUnitPriceAmount,
      actualUnitPriceAmount: line.actualUnitPriceAmount,
      quantity: line.quantity,
      lineTotalAmount: line.lineTotalAmount,
    }
  }
}
