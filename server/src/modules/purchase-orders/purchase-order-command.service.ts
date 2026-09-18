import { PaymentRecipientService } from '../payment-recipients/payment-recipient.service'
import { randomUUID } from 'node:crypto'

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
import { AuditService, AuditWriteFailedError } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { PurchaseShippingMarkResolverService } from '../purchase-shipping-marks/purchase-shipping-mark-resolver.service'
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
  PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION,
  PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION,
  PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION,
  PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION,
  PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION,
  PURCHASE_ORDER_NUMBERING_CONSUMER_CODE,
  PURCHASE_ORDER_NUMBERING_RULE_CODE,
} from './purchase-order-create-fingerprint'
import { PurchaseShipmentNumberingService } from './shipments/purchase-shipment-numbering.service'
import { requirePurchaseShippingMark } from './purchase-order-shipping-mark'

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
  readonly createRequestFingerprintVersion: string
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
    private readonly shippingMarks: PurchaseShippingMarkResolverService,
    private readonly shipmentNumbers: PurchaseShipmentNumberingService,
    private readonly recipients: PaymentRecipientService,
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
    const idempotencyKeyHash = hashPurchaseOrderIdempotencyKey(trusted.idempotencyKey)
    const existing = await this.findExisting(idempotencyKeyHash)
    const version = existing?.createRequestFingerprintVersion ?? PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION
    if (version !== PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION && version !== PURCHASE_ORDER_PART_ISSUED_FINGERPRINT_VERSION && version !== PURCHASE_ORDER_REVIEW_FINGERPRINT_VERSION && version !== PURCHASE_ORDER_CENTS_FINGERPRINT_VERSION && version !== PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION) {
      throw idempotencyConflict()
    }
    // 仅已持久化 v3 请求允许旧快照恢复；新请求不能凭缺少 parts 回退旧创建路径。
    const legacyReplay = existing?.createRequestFingerprintVersion === PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION
    const command = normalizePurchaseOrderCreateCommand(
      input,
      this.dependencies.businessToday(),
      legacyReplay,
      !!existing && version !== PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION,
    )
    const fingerprint = calculatePurchaseOrderCreateFingerprint(
      trusted.actorUserId,
      command,
      version,
    )
    const fingerprintHash = Buffer.from(fingerprint, 'hex')
    if (existing !== null) {
      if (!matchesExisting(existing, trusted.actorUserId, fingerprintHash)) {
        throw idempotencyConflict()
      }
      return existing.id
    }

    try {
      // 常见依赖错误在发号前失败；预检不持有销售行锁，最终事务会完整重读并锁定。
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        await this.createDependencies.requireDependencies(
          transaction,
          command,
          trusted.actorUserId,
          { lockSalesLines: false },
        )
        requirePurchaseShippingMark(
          await this.shippingMarks.resolve(transaction, command, false),
          command.expectedShippingMarkResolution,
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

      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        // 先恢复已提交结果，避免改绑、停用或来源剩余量变化破坏同键恢复。
        const committed = await this.findExisting(idempotencyKeyHash, transaction)
        if (committed !== null) {
          if (!matchesExisting(committed, trusted.actorUserId, fingerprintHash)) throw idempotencyConflict()
          return committed.id
        }
        const effective = await this.createDependencies.requireDependencies(
          transaction,
          command,
          trusted.actorUserId,
          { lockSalesLines: true },
        )
        const resolution = await this.shippingMarks.resolve(transaction, command, true)
        requirePurchaseShippingMark(resolution, command.expectedShippingMarkResolution)
        // 货件编号在创建事务派发；基础唛头仍在审核时派发，两类编号互不替代。
        const persistedParts = command.parts.map((part, index) => ({ id: randomUUID(), part, partNumber: index + 1 }))
        const created = await transaction.purchaseOrder.create({
          data: {
            orderNo: issuance.number,
            createIdempotencyKeyHash: Uint8Array.from(idempotencyKeyHash),
            createRequestFingerprintHash: Uint8Array.from(fingerprintHash),
            createRequestFingerprintVersion: PURCHASE_ORDER_CREATE_FINGERPRINT_VERSION,
            purchaseType: command.purchaseType,
            productMode: command.productMode,
            salesOrderId: command.salesOrderId,
            supplierValue: command.supplierValue,
            customSupplierName: command.customSupplierName,
            orderDate: new Date(`${command.orderDate}T00:00:00.000Z`),
            currencyCode: command.currencyCode,
            shippingMarkText: null,
            shippingMarkIssuanceId: null,
            lineSubtotalAmount: command.lineSubtotalAmount,
            purchaseTotalAmount: command.purchaseTotalAmount,
            depositDueAmount: command.depositDueAmount,
            balanceDueAmount: command.balanceDueAmount,
            orderStatus: 'PENDING_REVIEW',
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
        if (command.productMode === 'CUSTOM') {
          await this.recipients.createForOrder(transaction, trusted.actorUserId, created.id, [...command.paymentAccounts])
        }
        await transaction.purchaseOrderLine.createMany({
          data: effective.lines.map(line => lineData(created.id, line)),
        })
        const persistedLines = await transaction.purchaseOrderLine.findMany({
          where: { purchaseOrderId: created.id }, select: { id: true, lineNumber: true },
        })
        const lineIdByNumber = new Map(persistedLines.map(line => [line.lineNumber, line.id]))
        const partNumbers = await this.shipmentNumbers.issue(transaction, persistedParts.map(({ id, part }) => ({ id, purchaseOrderId: created.id, key: part.key })))
        await transaction.purchaseOrderPart.createMany({ data: persistedParts.map(({ id, part, partNumber }, index) => ({
            id,
            purchaseOrderId: created.id, key: part.key, partNumber, status: 'PENDING_REVIEW',
            shipmentNo: partNumbers[index].shipmentNo, numberingIssuanceId: partNumbers[index].numberingIssuanceId,
            shippingMarkText: null, shippingMarkIssuanceId: null, shippingMarkKeyHash: null,
        })) })
        await transaction.purchaseOrderPartItem.createMany({ data: persistedParts.flatMap(({ id, part }) => (
          part.items.map(item => ({
              purchaseOrderId: created.id,
              purchaseOrderPartId: id,
              purchaseOrderLineId: lineIdByNumber.get(item.lineNumber)!, quantity: item.quantity,
          }))
        )) })
        // 创建事件关联本单全部已编号货件；审核事务才派发唛头并推进销售备货。
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
            productMode: command.productMode,
            supplierSource: command.supplierValue === null
              ? 'CUSTOM_TEXT'
              : 'DICTIONARY',
            currencyCode: command.currencyCode,
            lineCount: effective.lines.length,
            salesLinked: command.salesOrderId !== null,
            orderStatus: 'PENDING_REVIEW',
            partCount: persistedParts.length,
            shipmentNumberingRule: 'SHIPMENT_NO',
            numberedPartCount: partNumbers.length,
          },
        })
        return created.id
      // 最大货件/分配项仍共用固定采购事务预算，不放宽全局查询或锁等待上限。
      }, { isolationLevel: 'Serializable', timeout: 30_000 })
    }
    catch (error) {
      // 事务已退出才可恢复；PG aborted transaction 内继续查询会掩盖原失败。
      // 无论是并发冲突还是提交响应丢失，都优先返回已持久化且同身份/指纹的订单。
      const recovered = await this.findExisting(idempotencyKeyHash)
      if (recovered !== null) {
        if (!matchesExisting(recovered, trusted.actorUserId, fingerprintHash)) throw idempotencyConflict()
        return recovered.id
      }
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
      if (hasPersistenceConstraint(facts, 'purchase_order_parts_shipment_no_key')
        || hasPersistenceConstraint(facts, 'purchase_order_parts_numbering_issuance_id_key')) {
        throw purchaseOrderException(HttpStatus.CONFLICT, 'PURCHASE_SHIPMENT_NUMBER_CONFLICT', '货件编号或派发记录发生冲突')
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
      if (hasPersistenceConstraint(
        facts,
        'purchase_orders_custom_supplier_name_nonblank_check',
      )) {
        throw purchaseOrderException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID',
          '自定义供应商名称无效',
        )
      }
      if (
        hasPersistenceConstraint(
          facts,
          'purchase_orders_supplier_source_exactly_one_check',
        )
        || hasPersistenceConstraint(
          facts,
          'purchase_orders_supplier_value_nonblank_check',
        )
      ) {
        throw purchaseOrderException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID',
          '供应商来源与采购产品类型不匹配',
        )
      }
      if (
        (error instanceof AuditWriteFailedError && error.transactionConflict)
        || PURCHASE_ORDER_STATE_CHANGE_CODES.some(code => hasPersistenceCode(facts, code))
      ) {
        throw stateChangedError()
      }
      throw internalError()
    }
  }

  private async findExisting(
    idempotencyKeyHash: Uint8Array,
    client: Pick<Prisma.TransactionClient, 'purchaseOrder'> = this.prisma,
  ): Promise<ExistingPurchaseOrder | null> {
    return client.purchaseOrder.findUnique({
      where: {
        createIdempotencyKeyHash: Uint8Array.from(idempotencyKeyHash),
      },
      select: {
        id: true,
        createdByUserId: true,
        createRequestFingerprintHash: true,
        createRequestFingerprintVersion: true,
      },
    })
  }
}
