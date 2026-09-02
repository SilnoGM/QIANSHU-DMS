import { randomUUID } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
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
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
} from '../dictionaries/dictionary-lookup.service'
import { classifyPurchaseSourceView } from '../purchase-orders/domain/purchase-order-source-sales-order-view'
import {
  deriveSalesOrderPaymentStatus,
  formatSalesOrderAmountUnits,
  parseSalesOrderAmountUnits,
} from './domain/sales-order-decimal'
import {
  isCanonicalSalesOrderActorId,
  normalizeSalesOrderAddOnCommand,
  type NormalizedSalesOrderCatalogLine,
  type NormalizedSalesOrderCreateLine,
} from './sales-order-command.normalizer'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const MAX_SALES_ORDER_LINES = 100
const SALES_ORDER_ADD_ON_CONCURRENT_CODES = [
  'P2034',
  '40001',
  '40P01',
  '55P03',
] as const

export interface SalesOrderAddOnContext {
  readonly actorUserId: string
  readonly requestId: string
}

export interface SalesOrderAddOnResult {
  readonly salesOrderId: string
  readonly previousVersion: number
  readonly version: number
  readonly addedLineIds: readonly string[]
  readonly amountDelta: string
  readonly paymentStatus: SalesOrderPaymentStatus
  readonly amounts: {
    readonly lineSubtotalAmount: string
    readonly agreedTotalAmount: string
    readonly depositDueAmount: string
    readonly balanceDueAmount: string
    readonly paidAmount: string
    readonly outstandingAmount: string
  }
}

interface CatalogProductSnapshot {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly attributes: Prisma.InputJsonValue
  readonly standardUnitPriceAmount: string | null
}

function fixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function error(status: HttpStatus, code: string, message: string): ApiException {
  return new ApiException(status, code, message)
}

function isConcurrentVersionConflict(caught: unknown): boolean {
  const facts = readPersistenceErrorFacts(caught)
  return SALES_ORDER_ADD_ON_CONCURRENT_CODES.some(code => (
    hasPersistenceCode(facts, code)
  ))
}

function validateContext(context: SalesOrderAddOnContext): SalesOrderAddOnContext {
  if (
    !isCanonicalSalesOrderActorId(context.actorUserId)
    || typeof context.requestId !== 'string'
    || [...context.requestId].length < 1
    || [...context.requestId].length > 64
  ) {
    throw error(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
  }
  return context
}

function validateSalesOrderId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw error(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      '请求参数校验失败',
    )
  }
  return value
}

function normalizeAttributes(value: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(value)) {
    throw error(
      HttpStatus.CONFLICT,
      'SALES_ORDER_STATE_CHANGED',
      '销售订单依赖状态已变化，请重试',
    )
  }
  return value as Prisma.InputJsonValue
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
  return amount === null ? null : fixed4(amount)
}

@Injectable()
export class SalesOrderAddOnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dictionaryLookup: DictionaryLookupService,
  ) {}

  async appendLines(
    context: SalesOrderAddOnContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderAddOnResult> {
    const trusted = validateContext(context)
    const salesOrderId = validateSalesOrderId(rawSalesOrderId)
    const command = normalizeSalesOrderAddOnCommand(input)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        /*
         * 同一旧版本只能成功一次。行锁必须先于资格、金额和最大行号读取，禁止在网络
         * 结果未知后由客户端换新版本自动重放，从而重复追加同一批产品。
         */
        const locks = await transaction.$queryRaw<Array<{ readonly id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "sales_orders"
            WHERE "id" = CAST(${salesOrderId} AS uuid)
            FOR UPDATE
          `,
        )
        if (locks.length !== 1) {
          throw error(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
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
              orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
              select: { id: true, lineNumber: true, quantity: true },
            },
          },
        })
        if (order === null) {
          throw error(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
        }
        if (order.version !== command.expectedVersion) {
          throw error(
            HttpStatus.CONFLICT,
            'SALES_ORDER_ADD_ON_VERSION_CONFLICT',
            '销售订单已被其他操作更新，请刷新后重试',
          )
        }
        if (order.lines.length + command.lines.length > MAX_SALES_ORDER_LINES) {
          throw error(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SALES_ORDER_LINE_LIMIT_EXCEEDED',
            '销售订单产品明细最多 100 行',
          )
        }

        const sourceLineIds = order.lines.map(line => line.id)
        const [activePurchaseOrderCount, purchasedRows] = await Promise.all([
          transaction.purchaseOrder.count({
            where: {
              purchaseType: 'SALES_LINKED',
              salesOrderId,
              orderStatus: { not: 'CANCELLED' },
            },
          }),
          sourceLineIds.length === 0
            ? Promise.resolve([])
            : transaction.purchaseOrderLine.findMany({
                where: {
                  sourceSalesOrderLineId: { in: sourceLineIds },
                  purchaseOrder: {
                    is: {
                      purchaseType: 'SALES_LINKED',
                      salesOrderId,
                      orderStatus: { not: 'CANCELLED' },
                    },
                  },
                },
                select: { sourceSalesOrderLineId: true, quantity: true },
              }),
        ])
        const purchasedByLine = new Map<string, number>()
        for (const row of purchasedRows) {
          if (row.sourceSalesOrderLineId === null) continue
          purchasedByLine.set(
            row.sourceSalesOrderLineId,
            (purchasedByLine.get(row.sourceSalesOrderLineId) ?? 0) + row.quantity,
          )
        }
        const purchasedQuantity = [...purchasedByLine.values()]
          .reduce((sum, quantity) => sum + quantity, 0)
        const remainingQuantity = order.lines.reduce((sum, line) => (
          sum + Math.max(0, line.quantity - (purchasedByLine.get(line.id) ?? 0))
        ), 0)
        if (classifyPurchaseSourceView({
          orderStatus: order.orderStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          activePurchaseOrderCount,
          purchasedQuantity,
          remainingQuantity,
        }) !== 'COMPLETED_PURCHASE_ADD_ON') {
          throw error(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SALES_ORDER_ADD_ON_NOT_ALLOWED',
            '销售订单当前不允许加购产品',
          )
        }

        await this.dictionaryLookup.requireEffectiveValue(transaction, {
          dictionaryCode: SUPPLIER_DICTIONARY_CODE,
          value: command.supplierValue,
        })
        if (order.currencyCode !== 'TWD' && order.currencyCode !== 'MYR') {
          throw error(
            HttpStatus.CONFLICT,
            'SALES_ORDER_STATE_CHANGED',
            '销售订单币种状态已变化，请重试',
          )
        }
        const catalogLines = command.lines.filter(
          (line): line is NormalizedSalesOrderCatalogLine => line.lineType === 'CATALOG',
        )
        const productIds = [...new Set(catalogLines.map(line => line.productId))]
        const productRows = productIds.length === 0
          ? []
          : await transaction.product.findMany({
              where: {
                id: { in: productIds },
                status: 'ACTIVE',
                supplierValue: command.supplierValue,
              },
              select: {
                id: true,
                productNo: true,
                name: true,
                attributes: true,
                supplierValue: true,
                twdSalePriceAmount: true,
                myrSalePriceAmount: true,
              },
            })
        const products = new Map<string, CatalogProductSnapshot>()
        for (const product of productRows) {
          products.set(product.id, {
            id: product.id,
            productNo: product.productNo,
            name: product.name,
            attributes: normalizeAttributes(product.attributes),
            standardUnitPriceAmount: standardPriceFor(product, order.currencyCode),
          })
        }
        if (products.size !== productIds.length) {
          throw error(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'SALES_ORDER_ADD_ON_PRODUCT_SUPPLIER_MISMATCH',
            '所选产品已停用、不属于当前供应商或不存在',
          )
        }

        const maximumLineNumber = order.lines.reduce(
          (maximum, line) => Math.max(maximum, line.lineNumber),
          0,
        )
        const appendedLines = command.lines.map((line, index) => ({
          id: randomUUID(),
          line: { ...line, lineNumber: maximumLineNumber + index + 1 },
        }))
        await transaction.salesOrderLine.createMany({
          data: appendedLines.map(item => this.lineData(
            item.id,
            salesOrderId,
            item.line,
            products,
          )),
        })

        const oldLineSubtotalUnits = parseSalesOrderAmountUnits(
          fixed4(order.lineSubtotalAmount),
        )
        const oldAgreedTotalUnits = parseSalesOrderAmountUnits(
          fixed4(order.agreedTotalAmount),
        )
        const oldDepositDueAmount = fixed4(order.depositDueAmount)
        const oldBalanceDueUnits = parseSalesOrderAmountUnits(
          fixed4(order.balanceDueAmount),
        )
        const amountDeltaUnits = parseSalesOrderAmountUnits(command.amountDelta)
        const newLineSubtotalAmount = formatSalesOrderAmountUnits(
          oldLineSubtotalUnits + amountDeltaUnits,
        )
        const newAgreedTotalAmount = formatSalesOrderAmountUnits(
          oldAgreedTotalUnits + amountDeltaUnits,
        )
        const newBalanceDueAmount = formatSalesOrderAmountUnits(
          oldBalanceDueUnits + amountDeltaUnits,
        )
        const paymentAggregate = await transaction.salesOrderPayment.aggregate({
          where: { salesOrderId, voidedAt: null },
          _sum: { amount: true },
        })
        const paidAmount = paymentAggregate._sum.amount === null
          ? '0.0000'
          : fixed4(paymentAggregate._sum.amount)
        const paymentStatus = deriveSalesOrderPaymentStatus(
          newAgreedTotalAmount,
          paidAmount,
        )
        const amountRevision = await transaction.salesOrderAmountRevision.create({
          data: {
            salesOrderId,
            oldLineSubtotalAmount: fixed4(order.lineSubtotalAmount),
            oldAgreedTotalAmount: fixed4(order.agreedTotalAmount),
            oldDepositDueAmount,
            oldBalanceDueAmount: fixed4(order.balanceDueAmount),
            newLineSubtotalAmount,
            newAgreedTotalAmount,
            newDepositDueAmount: oldDepositDueAmount,
            newBalanceDueAmount,
            reason: command.reason,
            changedByUserId: trusted.actorUserId,
          },
          select: { id: true },
        })
        if (paymentStatus !== order.paymentStatus) {
          await transaction.salesOrderStatusHistory.create({ data: {
            salesOrderId,
            dimension: 'PAYMENT',
            fromStatus: order.paymentStatus,
            toStatus: paymentStatus,
            reason: '客户加购产品导致应收金额增加',
            changedByUserId: trusted.actorUserId,
          } })
        }
        const newVersion = order.version + 1
        await transaction.salesOrder.update({
          where: { id: salesOrderId },
          data: {
            lineSubtotalAmount: newLineSubtotalAmount,
            agreedTotalAmount: newAgreedTotalAmount,
            depositDueAmount: oldDepositDueAmount,
            balanceDueAmount: newBalanceDueAmount,
            paymentStatus,
            version: { increment: 1 },
          },
        })
        for (const item of appendedLines) {
          await this.audit.record(transaction, {
            eventType: AuditEventType.SALES_ORDER_PRODUCT_APPENDED,
            outcome: AuditOutcome.SUCCESS,
            actorType: AuditActorType.USER,
            actorUserId: trusted.actorUserId,
            targetType: 'SALES_ORDER_LINE',
            targetId: item.id,
            requestId: trusted.requestId,
            metadata: {
              salesOrderId,
              amountRevisionId: amountRevision.id,
              lineNumber: item.line.lineNumber,
              lineType: item.line.lineType,
              lineAmountDelta: item.line.lineTotalAmount,
              operationAmountDelta: command.amountDelta,
              reason: command.reason,
              supplierValue: command.supplierValue,
              previousVersion: order.version,
              version: newVersion,
            },
          })
        }
        return {
          salesOrderId,
          previousVersion: order.version,
          version: newVersion,
          addedLineIds: appendedLines.map(item => item.id),
          amountDelta: command.amountDelta,
          paymentStatus,
          amounts: {
            lineSubtotalAmount: newLineSubtotalAmount,
            agreedTotalAmount: newAgreedTotalAmount,
            depositDueAmount: oldDepositDueAmount,
            balanceDueAmount: newBalanceDueAmount,
            paidAmount,
            outstandingAmount: formatSalesOrderAmountUnits(
              parseSalesOrderAmountUnits(newAgreedTotalAmount)
              - parseSalesOrderAmountUnits(paidAmount),
            ),
          },
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    }
    catch (caught) {
      if (caught instanceof DictionaryValueUnavailableError) {
        throw error(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'SALES_ORDER_ADD_ON_SUPPLIER_UNAVAILABLE',
          '加购供应商当前不可用',
        )
      }
      /*
       * PostgreSQL 在 Serializable 下可能先以 40001 终止等待行锁的旧快照，
       * 请求来不及重新读取 version。它与显式版本不一致属于同一个外部事实：
       * 同一 expectedVersion 已被其他事务消费，边界不得泄漏 Prisma P2010。
       */
      if (isConcurrentVersionConflict(caught)) {
        throw error(
          HttpStatus.CONFLICT,
          'SALES_ORDER_ADD_ON_VERSION_CONFLICT',
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
    products: ReadonlyMap<string, CatalogProductSnapshot>,
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
    if (product === undefined) {
      throw error(
        HttpStatus.CONFLICT,
        'SALES_ORDER_STATE_CHANGED',
        '销售订单依赖状态已变化，请重试',
      )
    }
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
