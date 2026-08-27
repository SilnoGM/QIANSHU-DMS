import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type MediaType,
  type RegionLevel,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  MediaAssetLifecycleError,
  MediaAssetService,
} from '../media/media-asset.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
} from '../numbering/numbering.errors'
import { normalizeSalesOrderAddress } from './domain/sales-order-address'
import { createSalesOrderDocumentTitle } from './domain/sales-order-document-title'
import {
  isCanonicalSalesOrderActorId,
  normalizeSalesOrderCreateCommand,
  parseSalesOrderIdempotencyKey,
  type NormalizedSalesOrderCatalogLine,
  type NormalizedSalesOrderCreateCommand,
} from './sales-order-command.normalizer'
import {
  calculateSalesOrderCreateFingerprint,
  hashSalesOrderIdempotencyKey,
  SALES_ORDER_NUMBERING_CONSUMER_CODE,
  SALES_ORDER_NUMBERING_RULE_CODE,
} from './sales-order-create-fingerprint'
import {
  SalesOrderQueryService,
  type SalesOrderDetail,
} from './sales-order-query.service'

const REQUEST_ID_MAXIMUM_CODE_POINTS = 64

export interface SalesOrderCommandContext {
  readonly actorUserId: string
  readonly requestId: string
  readonly idempotencyKey: string
}

interface SalesOrderCommandServiceDependencies {
  readonly businessToday: () => string
  readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: SalesOrderCommandServiceDependencies = {
  businessToday: () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
  now: () => new Date(),
}

const SALES_ORDER_COMMAND_DEPENDENCIES = Symbol(
  'qianshu.sales-order.command-dependencies',
)

interface RegionSnapshot {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly level: RegionLevel
  readonly parentId: string | null
}

interface CatalogProductSnapshot {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly attributes: Prisma.InputJsonValue
  readonly standardUnitPriceAmount: string | null
}

interface EffectiveCreateDependencies {
  readonly countryRegion: RegionSnapshot
  readonly provinceState: RegionSnapshot
  readonly city: RegionSnapshot
  readonly catalogProductsById: ReadonlyMap<string, CatalogProductSnapshot>
}

function salesOrderException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function internalError(): ApiException {
  return salesOrderException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function stateChangedError(): ApiException {
  return salesOrderException(
    HttpStatus.CONFLICT,
    'SALES_ORDER_STATE_CHANGED',
    '销售订单依赖状态已变化，请重试',
  )
}

function dependencyError(code: string, message: string): ApiException {
  return salesOrderException(HttpStatus.UNPROCESSABLE_ENTITY, code, message)
}

function validateContext(context: SalesOrderCommandContext): SalesOrderCommandContext {
  if (!isCanonicalSalesOrderActorId(context.actorUserId)) throw internalError()
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
    idempotencyKey: parseSalesOrderIdempotencyKey(context.idempotencyKey),
  })
}

function sameHash(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right))
}

function decimalToFixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function mapNumberingError(error: unknown): never {
  if (!(error instanceof NumberingGenerationError)) throw internalError()
  if (error.code === NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT) {
    throw salesOrderException(
      HttpStatus.CONFLICT,
      'SALES_ORDER_CREATE_IDEMPOTENCY_CONFLICT',
      '幂等键已用于不同的销售订单创建请求',
    )
  }
  if (
    error.code === NUMBERING_ERROR_CODES.OUTPUT_CONFLICT
    || error.code === NUMBERING_ERROR_CODES.RULE_STATE_CHANGED
    || error.code === NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED
  ) {
    throw stateChangedError()
  }
  throw salesOrderException(
    HttpStatus.CONFLICT,
    'SALES_ORDER_NUMBERING_UNAVAILABLE',
    '销售订单编号规则当前不可用',
  )
}

function normalizeAttributes(value: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(value)) throw stateChangedError()
  return value as Prisma.InputJsonValue
}

function requireRegionPath(
  rows: readonly RegionSnapshot[],
  command: NormalizedSalesOrderCreateCommand,
): Pick<
  EffectiveCreateDependencies,
  'countryRegion' | 'provinceState' | 'city'
> {
  const byId = new Map(rows.map(row => [row.id, row]))
  const countryRegion = byId.get(command.customer.countryRegionId)
  const provinceState = byId.get(command.customer.provinceStateId)
  const city = byId.get(command.customer.cityId)
  if (
    countryRegion?.level !== 'COUNTRY_REGION'
    || countryRegion.parentId !== null
    || provinceState?.level !== 'PROVINCE_STATE'
    || provinceState.parentId !== countryRegion.id
    || city?.level !== 'CITY'
    || city.parentId !== provinceState.id
  ) {
    throw dependencyError(
      'SALES_ORDER_REGION_UNAVAILABLE',
      '所选客户地区当前不可用或层级无效',
    )
  }
  return { countryRegion, provinceState, city }
}

function standardPriceFor(
  row: {
    readonly twdSalePriceAmount: { toFixed(decimalPlaces: number): string } | null
    readonly myrSalePriceAmount: { toFixed(decimalPlaces: number): string } | null
  },
  currencyCode: 'TWD' | 'MYR',
): string | null {
  const value = currencyCode === 'TWD'
    ? row.twdSalePriceAmount
    : row.myrSalePriceAmount
  return value === null ? null : decimalToFixed4(value)
}

@Injectable()
export class SalesOrderCommandService {
  private readonly dependencies: SalesOrderCommandServiceDependencies

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
    private readonly mediaAsset: MediaAssetService,
    private readonly query: SalesOrderQueryService,
    @Optional()
    @Inject(SALES_ORDER_COMMAND_DEPENDENCIES)
    dependencyOverrides: Partial<SalesOrderCommandServiceDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async create(
    context: SalesOrderCommandContext,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    const trusted = validateContext(context)
    const command = normalizeSalesOrderCreateCommand(
      input,
      this.dependencies.businessToday(),
    )
    const fingerprint = calculateSalesOrderCreateFingerprint(
      trusted.actorUserId,
      command,
    )
    const fingerprintHash = Buffer.from(fingerprint, 'hex')
    const idempotencyKeyHash = hashSalesOrderIdempotencyKey(
      trusted.idempotencyKey,
    )
    const persistedIdempotencyKeyHash = Uint8Array.from(idempotencyKeyHash)
    const persistedFingerprintHash = Uint8Array.from(fingerprintHash)
    const existing = await this.prisma.salesOrder.findUnique({
      where: { createIdempotencyKeyHash: persistedIdempotencyKeyHash },
      select: {
        id: true,
        issuerUserId: true,
        createRequestFingerprintHash: true,
      },
    })
    if (existing !== null) {
      if (
        existing.issuerUserId !== trusted.actorUserId
        || !sameHash(existing.createRequestFingerprintHash, fingerprintHash)
      ) {
        throw salesOrderException(
          HttpStatus.CONFLICT,
          'SALES_ORDER_CREATE_IDEMPOTENCY_CONFLICT',
          '幂等键已用于不同的销售订单创建请求',
        )
      }
      return this.query.getById(existing.id)
    }

    // 预检发生在发号前，常见的产品、地区、币种和临时资产问题不会消耗编号。
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      await this.requireDependencies(transaction, command, trusted.actorUserId)
    })

    let issuance: Awaited<ReturnType<NumberingGeneratorService['generateScoped']>>
    try {
      issuance = await this.numbering.generateScoped({
        ruleCode: SALES_ORDER_NUMBERING_RULE_CODE,
        consumerCode: SALES_ORDER_NUMBERING_CONSUMER_CODE,
        idempotencyKey: trusted.idempotencyKey,
        requestFingerprint: fingerprint,
      })
    }
    catch (error) {
      return mapNumberingError(error)
    }

    try {
      const salesOrderId = await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const effective = await this.requireDependencies(
          transaction,
          command,
          trusted.actorUserId,
        )
        const address = normalizeSalesOrderAddress({
          countryRegionName: effective.countryRegion.name,
          provinceStateName: effective.provinceState.name,
          cityName: effective.city.name,
          addressDetail: command.customer.addressDetail,
        })
        const created = await transaction.salesOrder.create({
          data: {
            orderNo: issuance.number,
            createIdempotencyKeyHash: persistedIdempotencyKeyHash,
            createRequestFingerprintHash: persistedFingerprintHash,
            orderDate: new Date(`${command.orderDate}T00:00:00.000Z`),
            issuerUserId: trusted.actorUserId,
            currencyCode: command.currencyCode,
            customerName: command.customer.name,
            customerPhone: command.customer.phone,
            customerCountryRegionId: effective.countryRegion.id,
            customerProvinceStateId: effective.provinceState.id,
            customerCityId: effective.city.id,
            customerCountryRegionCodeSnapshot: effective.countryRegion.code,
            customerProvinceStateCodeSnapshot: effective.provinceState.code,
            customerCityCodeSnapshot: effective.city.code,
            customerCountryRegionNameSnapshot: effective.countryRegion.name,
            customerProvinceStateNameSnapshot: effective.provinceState.name,
            customerCityNameSnapshot: effective.city.name,
            customerAddressDetail: address.addressDetail,
            customerFullAddressSnapshot: address.fullAddress,
            lineSubtotalAmount: command.lineSubtotalAmount,
            agreedTotalAmount: command.agreedTotalAmount,
            depositDueAmount: command.depositDueAmount,
            balanceDueAmount: command.balanceDueAmount,
            // 新增页只有“确认提交订单”语义，因此订单在创建事务内直接成为已确认状态，
            // 不产生一个已经派号但仍需再次确认的中间草稿。
            orderStatus: 'CONFIRMED',
            paymentStatus: 'UNPAID',
            remark: command.remark,
          },
          select: { id: true },
        })
        await transaction.salesOrderLine.createMany({
          data: command.lines.map(line => this.lineData(
            created.id,
            line,
            effective.catalogProductsById,
          )),
        })
        await this.mediaAsset.activate(
          transaction,
          command.issuanceVoucher.mediaAssetId,
        )
        const association = await transaction.salesOrderDocument.create({
          data: {
            salesOrderId: created.id,
            mediaAssetId: command.issuanceVoucher.mediaAssetId,
            documentType: 'ORDER_ISSUANCE_VOUCHER',
            title: createSalesOrderDocumentTitle(
              command.customer.name,
              'ORDER_ISSUANCE_VOUCHER',
              this.dependencies.now(),
            ),
            remark: null,
            createdByUserId: trusted.actorUserId,
          },
          select: { id: true },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.SALES_ORDER_DOCUMENT_ATTACHED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'SALES_ORDER_DOCUMENT',
          targetId: association.id,
          requestId: trusted.requestId,
          metadata: {
            salesOrderId: created.id,
            documentType: 'ORDER_ISSUANCE_VOUCHER',
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.SALES_ORDER_CREATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'SALES_ORDER',
          targetId: created.id,
          requestId: trusted.requestId,
          metadata: {
            orderNo: issuance.number,
            currencyCode: command.currencyCode,
            lineCount: command.lines.length,
            documentCount: 1,
          },
        })
        return created.id
      }, { isolationLevel: 'Serializable' })
      return this.query.getById(salesOrderId)
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      if (error instanceof MediaAssetLifecycleError) {
        throw dependencyError(
          'SALES_ORDER_DOCUMENT_UNAVAILABLE',
          '所选订单凭证当前不可用',
        )
      }
      throw stateChangedError()
    }
  }

  private async requireDependencies(
    transaction: Prisma.TransactionClient,
    command: NormalizedSalesOrderCreateCommand,
    actorUserId: string,
  ): Promise<EffectiveCreateDependencies> {
    const currency = await transaction.currency.findFirst({
      where: { code: command.currencyCode, enabled: true },
      select: { code: true, minorUnit: true },
    })
    if (currency === null) {
      throw dependencyError(
        'SALES_ORDER_CURRENCY_UNAVAILABLE',
        '订单币种当前不可用',
      )
    }

    const regionRows = await transaction.region.findMany({
      where: {
        id: { in: [
          command.customer.countryRegionId,
          command.customer.provinceStateId,
          command.customer.cityId,
        ] },
        enabled: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        level: true,
        parentId: true,
      },
    })
    const regionPath = requireRegionPath(regionRows, command)
    // 在读到稳定 UUID 后再次做地址规则，确保重复地区不会进入发号阶段。
    normalizeSalesOrderAddress({
      countryRegionName: regionPath.countryRegion.name,
      provinceStateName: regionPath.provinceState.name,
      cityName: regionPath.city.name,
      addressDetail: command.customer.addressDetail,
    })

    const catalogLines = command.lines.filter(
      (line): line is NormalizedSalesOrderCatalogLine =>
        line.lineType === 'CATALOG',
    )
    const productIds = [...new Set(catalogLines.map(line => line.productId))]
    const products = productIds.length === 0
      ? []
      : await transaction.product.findMany({
          where: {
            id: { in: productIds },
            status: 'ACTIVE',
          },
          select: {
            id: true,
            productNo: true,
            name: true,
            attributes: true,
            twdSalePriceAmount: true,
            myrSalePriceAmount: true,
          },
        })
    const catalogProductsById = new Map<string, CatalogProductSnapshot>()
    for (const product of products) {
      const standardUnitPriceAmount = standardPriceFor(
        product,
        command.currencyCode,
      )
      catalogProductsById.set(product.id, {
        id: product.id,
        productNo: product.productNo,
        name: product.name,
        attributes: normalizeAttributes(product.attributes),
        standardUnitPriceAmount,
      })
    }
    if (catalogProductsById.size !== productIds.length) {
      throw dependencyError(
        'SALES_ORDER_PRODUCT_UNAVAILABLE',
        '所选产品已停用或不存在',
      )
    }

    const assets = await transaction.mediaAsset.findMany({
      where: {
        id: { in: [command.issuanceVoucher.mediaAssetId] },
        createdByUserId: actorUserId,
        status: 'UPLOADING',
        mediaType: { in: ['IMAGE', 'DOCUMENT'] satisfies MediaType[] },
        deletedAt: null,
        objectKey: { not: null },
      },
      select: { id: true },
    })
    if (assets.length !== 1) {
      throw dependencyError(
        'SALES_ORDER_DOCUMENT_UNAVAILABLE',
        '所选出单凭证当前不可用',
      )
    }
    return Object.freeze({ ...regionPath, catalogProductsById })
  }

  private lineData(
    salesOrderId: string,
    line: NormalizedSalesOrderCreateCommand['lines'][number],
    catalogProductsById: ReadonlyMap<string, CatalogProductSnapshot>,
  ): Prisma.SalesOrderLineCreateManyInput {
    if (line.lineType === 'CUSTOM') {
      return {
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
    const product = catalogProductsById.get(line.productId)
    if (product === undefined) throw stateChangedError()
    return {
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
