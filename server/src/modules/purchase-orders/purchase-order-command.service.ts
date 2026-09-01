import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
} from '../numbering/numbering.errors'
import {
  derivePurchaseOrderPaymentStatus,
} from './domain/purchase-order-decimal'
import {
  isCanonicalPurchaseOrderActorId,
  normalizePurchaseOrderCreateCommand,
  parsePurchaseOrderIdempotencyKey,
} from './purchase-order-command.normalizer'
import {
  PurchaseOrderCreateDependencyService,
  type EffectivePurchaseOrderLine,
} from './purchase-order-create-dependency.service'
import {
  calculatePurchaseOrderCreateFingerprint,
  hashPurchaseOrderIdempotencyKey,
  PURCHASE_ORDER_NUMBERING_CONSUMER_CODE,
  PURCHASE_ORDER_NUMBERING_RULE_CODE,
} from './purchase-order-create-fingerprint'
import { SalesOrderPurchaseCoverageService } from './sales-order-purchase-coverage.service'

const REQUEST_ID_MAXIMUM_CODE_POINTS = 64
const PURCHASE_ORDER_STATE_CHANGE_CODES = [
  'P2034',
  '40001',
  '40P01',
  '55P03',
  '57014',
] as const

export interface PurchaseOrderCommandContext {
  readonly actorUserId: string
  readonly requestId: string
  readonly idempotencyKey: string
}

interface PurchaseOrderCommandServiceDependencies {
  readonly businessToday: () => string
}

const DEFAULT_DEPENDENCIES: PurchaseOrderCommandServiceDependencies = {
  businessToday: () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
}

const PURCHASE_ORDER_COMMAND_DEPENDENCIES = Symbol(
  'qianshu.purchase-order.command-dependencies',
)

interface ExistingPurchaseOrder {
  readonly id: string
  readonly createdByUserId: string
  readonly createRequestFingerprintHash: Uint8Array
}

function purchaseOrderException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function internalError(): ApiException {
  return purchaseOrderException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function stateChangedError(): ApiException {
  return purchaseOrderException(
    HttpStatus.CONFLICT,
    'PURCHASE_ORDER_STATE_CHANGED',
    '采购订单依赖状态已变化，请重试',
  )
}

function idempotencyConflict(): ApiException {
  return purchaseOrderException(
    HttpStatus.CONFLICT,
    'PURCHASE_ORDER_CREATE_IDEMPOTENCY_CONFLICT',
    '幂等键已用于不同的采购订单创建请求',
  )
}

function validateContext(
  context: PurchaseOrderCommandContext,
): PurchaseOrderCommandContext {
  if (!isCanonicalPurchaseOrderActorId(context.actorUserId)) {
    throw internalError()
  }
  if (
    typeof context.requestId !== 'string'
    || context.requestId.length === 0
    || [...context.requestId].length > REQUEST_ID_MAXIMUM_CODE_POINTS
    || [...context.requestId].some((character) => {
      const point = character.codePointAt(0)
      return point !== undefined && (point <= 31 || point === 127)
    })
  ) {
    throw internalError()
  }
  return Object.freeze({
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    idempotencyKey: parsePurchaseOrderIdempotencyKey(context.idempotencyKey),
  })
}

function sameHash(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right))
}

function matchesExisting(
  existing: ExistingPurchaseOrder,
  actorUserId: string,
  fingerprintHash: Uint8Array,
): boolean {
  return existing.createdByUserId === actorUserId
    && sameHash(existing.createRequestFingerprintHash, fingerprintHash)
}

function mapNumberingError(error: unknown): never {
  if (!(error instanceof NumberingGenerationError)) throw internalError()
  if (error.code === NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT) {
    throw idempotencyConflict()
  }
  if (error.code === NUMBERING_ERROR_CODES.OUTPUT_CONFLICT) {
    throw purchaseOrderException(
      HttpStatus.CONFLICT,
      'PURCHASE_ORDER_NUMBER_CONFLICT',
      '采购订单编号发生冲突',
    )
  }
  if (
    error.code === NUMBERING_ERROR_CODES.RULE_STATE_CHANGED
    || error.code === NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED
  ) {
    throw stateChangedError()
  }
  throw purchaseOrderException(
    HttpStatus.CONFLICT,
    'PURCHASE_ORDER_NUMBERING_UNAVAILABLE',
    '采购订单编号规则当前不可用',
  )
}

function lineData(
  purchaseOrderId: string,
  line: EffectivePurchaseOrderLine,
): Prisma.PurchaseOrderLineCreateManyInput {
  return {
    purchaseOrderId,
    lineNumber: line.lineNumber,
    lineType: line.lineType,
    productId: line.productId,
    sourceSalesOrderLineId: line.sourceSalesOrderLineId,
    productNoSnapshot: line.productNoSnapshot,
    productNameSnapshot: line.productNameSnapshot,
    productAttributesSnapshot: line.productAttributesSnapshot,
    descriptionSnapshot: line.descriptionSnapshot,
    referencePurchaseUnitPriceAmount:
      line.referencePurchaseUnitPriceAmount,
    actualPurchaseUnitPriceAmount: line.actualPurchaseUnitPriceAmount,
    quantity: line.quantity,
    lineTotalAmount: line.lineTotalAmount,
  }
}

@Injectable()
export class PurchaseOrderCommandService {
  private readonly dependencies: PurchaseOrderCommandServiceDependencies

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
    private readonly createDependencies: PurchaseOrderCreateDependencyService,
    private readonly salesProgress: SalesOrderPurchaseCoverageService,
    @Optional()
    @Inject(PURCHASE_ORDER_COMMAND_DEPENDENCIES)
    dependencyOverrides: Partial<PurchaseOrderCommandServiceDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async create(
    context: PurchaseOrderCommandContext,
    input: unknown,
  ): Promise<string> {
    const trusted = validateContext(context)
    const command = normalizePurchaseOrderCreateCommand(
      input,
      this.dependencies.businessToday(),
    )
    const fingerprint = calculatePurchaseOrderCreateFingerprint(
      trusted.actorUserId,
      command,
    )
    const fingerprintHash = Buffer.from(fingerprint, 'hex')
    const idempotencyKeyHash = hashPurchaseOrderIdempotencyKey(
      trusted.idempotencyKey,
    )
    const existing = await this.findExisting(idempotencyKeyHash)
    if (existing !== null) {
      if (!matchesExisting(existing, trusted.actorUserId, fingerprintHash)) {
        throw idempotencyConflict()
      }
      return existing.id
    }

    // 常见依赖错误在发号前失败；预检不持有销售行锁，最终事务会完整重读并锁定。
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      await this.createDependencies.requireDependencies(
        transaction,
        command,
        trusted.actorUserId,
        { lockSalesLines: false },
      )
    })

    let issuance: Awaited<ReturnType<NumberingGeneratorService['generateScoped']>>
    try {
      issuance = await this.numbering.generateScoped({
        ruleCode: PURCHASE_ORDER_NUMBERING_RULE_CODE,
        consumerCode: PURCHASE_ORDER_NUMBERING_CONSUMER_CODE,
        idempotencyKey: trusted.idempotencyKey,
        requestFingerprint: fingerprint,
      })
    }
    catch (error) {
      return mapNumberingError(error)
    }

    try {
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const effective = await this.createDependencies.requireDependencies(
          transaction,
          command,
          trusted.actorUserId,
          { lockSalesLines: true },
        )
        const created = await transaction.purchaseOrder.create({
          data: {
            orderNo: issuance.number,
            createIdempotencyKeyHash: Uint8Array.from(idempotencyKeyHash),
            createRequestFingerprintHash: Uint8Array.from(fingerprintHash),
            purchaseType: command.purchaseType,
            salesOrderId: command.salesOrderId,
            supplierValue: command.supplierValue,
            orderDate: new Date(`${command.orderDate}T00:00:00.000Z`),
            currencyCode: command.currencyCode,
            shippingMarkText: command.shippingMarkText,
            lineSubtotalAmount: command.lineSubtotalAmount,
            purchaseTotalAmount: command.purchaseTotalAmount,
            depositDueAmount: command.depositDueAmount,
            balanceDueAmount: command.balanceDueAmount,
            orderStatus: 'CONFIRMED',
            fulfillmentStatus: 'ORDERED',
            paymentStatus: derivePurchaseOrderPaymentStatus(
              command.purchaseTotalAmount,
              '0',
            ),
            createdByUserId: trusted.actorUserId,
            remark: command.remark,
          },
          select: { id: true },
        })
        await transaction.purchaseOrderLine.createMany({
          data: effective.lines.map(line => lineData(created.id, line)),
        })
        if (
          command.purchaseType === 'SALES_LINKED'
          && command.salesOrderId !== null
        ) {
          await this.salesProgress.advanceWhenFullyCovered(transaction, {
            actorUserId: trusted.actorUserId,
            purchaseOrderId: created.id,
            purchaseOrderNo: issuance.number,
            requestId: trusted.requestId,
            salesOrderId: command.salesOrderId,
          })
        }
        await this.audit.record(transaction, {
          eventType: AuditEventType.PURCHASE_ORDER_CREATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'PURCHASE_ORDER',
          targetId: created.id,
          requestId: trusted.requestId,
          metadata: {
            orderNo: issuance.number,
            purchaseType: command.purchaseType,
            currencyCode: command.currencyCode,
            lineCount: effective.lines.length,
            salesLinked: command.salesOrderId !== null,
          },
        })
        return created.id
      }, { isolationLevel: 'Serializable' })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      const facts = readPersistenceErrorFacts(error)
      if (hasPersistenceConstraint(
        facts,
        'purchase_orders_create_idempotency_key_hash_key',
      )) {
        const raced = await this.findExisting(idempotencyKeyHash)
        if (
          raced !== null
          && matchesExisting(raced, trusted.actorUserId, fingerprintHash)
        ) {
          return raced.id
        }
        throw idempotencyConflict()
      }
      if (hasPersistenceConstraint(facts, 'purchase_orders_order_no_key')) {
        throw purchaseOrderException(
          HttpStatus.CONFLICT,
          'PURCHASE_ORDER_NUMBER_CONFLICT',
          '采购订单编号发生冲突',
        )
      }
      if (hasPersistenceConstraint(facts, 'purchase_order_source_quantity_check')) {
        throw purchaseOrderException(
          HttpStatus.CONFLICT,
          'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED',
          '采购数量超过销售明细剩余可采购数量',
        )
      }
      if (PURCHASE_ORDER_STATE_CHANGE_CODES.some(code => (
        hasPersistenceCode(facts, code)
      ))) {
        throw stateChangedError()
      }
      throw internalError()
    }
  }

  private async findExisting(
    idempotencyKeyHash: Uint8Array,
  ): Promise<ExistingPurchaseOrder | null> {
    return this.prisma.purchaseOrder.findUnique({
      where: {
        createIdempotencyKeyHash: Uint8Array.from(idempotencyKeyHash),
      },
      select: {
        id: true,
        createdByUserId: true,
        createRequestFingerprintHash: true,
      },
    })
  }
}
