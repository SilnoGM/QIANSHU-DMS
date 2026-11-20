import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type SalesOrderFulfillmentStatus,
  type SalesOrderPaymentStatus,
  type SalesOrderStatus,
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
import { isCanonicalSalesOrderActorId } from './sales-order-command.normalizer'
import { normalizeSalesOrderAddress } from './domain/sales-order-address'
import { requireSalesOrderRegionPath } from './domain/sales-order-region'
import {
  normalizeSalesOrderCustomerUpdateCommand,
  normalizeSalesOrderSalesInfoUpdateCommand,
  type NormalizedSalesOrderCustomerUpdateCommand,
} from './sales-order-edit.normalizer'

const UUID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const CONCURRENT_CODES = ['P2034', '40001', '40P01', '55P03'] as const
const STATUS_HISTORY_REASON_LIMIT = 500

const SALES_ORDER_EDIT_DEPENDENCIES = Symbol('qianshu.sales-order.edit-dependencies')

interface SalesOrderEditServiceDependencies {
  readonly businessToday: () => string
}

const DEFAULT_DEPENDENCIES: SalesOrderEditServiceDependencies = {
  businessToday: () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
}

export interface SalesOrderEditContext {
  readonly actorUserId: string
  readonly requestId: string
}

export interface SalesOrderEditCustomerRegion {
  readonly id: string
  readonly code: string
  readonly name: string
}

export interface SalesOrderEditView {
  readonly salesOrderId: string
  readonly orderNo: string
  readonly version: number
  readonly orderStatus: SalesOrderStatus
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly paymentStatus: SalesOrderPaymentStatus
  readonly customer: {
    readonly name: string
    readonly phone: string
    readonly fbName: string | null
    readonly lineName: string | null
    readonly countryRegion: SalesOrderEditCustomerRegion
    readonly provinceState: SalesOrderEditCustomerRegion
    readonly city: SalesOrderEditCustomerRegion
    readonly addressDetail: string
    readonly fullAddress: string
  }
  readonly salesInfo: {
    readonly orderDate: string
    readonly remark: string | null
  }
}

const EDIT_ROW_SELECT = {
  id: true,
  orderNo: true,
  orderDate: true,
  version: true,
  orderStatus: true,
  fulfillmentStatus: true,
  paymentStatus: true,
  customerName: true,
  customerPhone: true,
  customerFbName: true,
  customerLineName: true,
  customerCountryRegionId: true,
  customerProvinceStateId: true,
  customerCityId: true,
  customerCountryRegionCodeSnapshot: true,
  customerProvinceStateCodeSnapshot: true,
  customerCityCodeSnapshot: true,
  customerCountryRegionNameSnapshot: true,
  customerProvinceStateNameSnapshot: true,
  customerCityNameSnapshot: true,
  customerAddressDetail: true,
  customerFullAddressSnapshot: true,
  remark: true,
} satisfies Prisma.SalesOrderSelect

type SalesOrderEditRow = Prisma.SalesOrderGetPayload<{
  select: typeof EDIT_ROW_SELECT
}>

function failure(status: HttpStatus, code: string, message: string): ApiException {
  return new ApiException(status, code, message)
}

function validateContext(context: SalesOrderEditContext): SalesOrderEditContext {
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

function requireActorId(value: string): string {
  if (!isCanonicalSalesOrderActorId(value)) {
    throw failure(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', '服务器内部错误')
  }
  return value
}

function validateSalesOrderId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw failure(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', '请求参数校验失败')
  }
  return value
}

function versionConflict(): ApiException {
  return failure(
    HttpStatus.CONFLICT,
    'SALES_ORDER_EDIT_VERSION_CONFLICT',
    '销售订单已被其他操作更新，请刷新后重试',
  )
}

function isConcurrentConflict(caught: unknown): boolean {
  const facts = readPersistenceErrorFacts(caught)
  return CONCURRENT_CODES.some(code => hasPersistenceCode(facts, code))
}

function isoDateOf(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** 历史行原因列固定 500 字符；按 code point 截断，避免把多字节字符切成半个。 */
function truncateReason(value: string): string {
  const points = [...value]
  return points.length <= STATUS_HISTORY_REASON_LIMIT
    ? value
    : `${points.slice(0, STATUS_HISTORY_REASON_LIMIT - 1).join('')}…`
}

function mapContext(row: SalesOrderEditRow): SalesOrderEditView {
  return {
    salesOrderId: row.id,
    orderNo: row.orderNo,
    version: row.version,
    orderStatus: row.orderStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    paymentStatus: row.paymentStatus,
    customer: {
      name: row.customerName,
      phone: row.customerPhone,
      fbName: row.customerFbName,
      lineName: row.customerLineName,
      countryRegion: {
        id: row.customerCountryRegionId,
        code: row.customerCountryRegionCodeSnapshot,
        name: row.customerCountryRegionNameSnapshot,
      },
      provinceState: {
        id: row.customerProvinceStateId,
        code: row.customerProvinceStateCodeSnapshot,
        name: row.customerProvinceStateNameSnapshot,
      },
      city: {
        id: row.customerCityId,
        code: row.customerCityCodeSnapshot,
        name: row.customerCityNameSnapshot,
      },
      addressDetail: row.customerAddressDetail,
      fullAddress: row.customerFullAddressSnapshot,
    },
    salesInfo: {
      orderDate: isoDateOf(row.orderDate),
      remark: row.remark,
    },
  }
}

interface EffectiveCustomerSnapshot {
  readonly name: string
  readonly phone: string
  readonly fbName: string | null
  readonly lineName: string | null
  readonly countryRegion: SalesOrderEditCustomerRegion
  readonly provinceState: SalesOrderEditCustomerRegion
  readonly city: SalesOrderEditCustomerRegion
  readonly addressDetail: string
  readonly fullAddress: string
}

function customerSnapshotOf(row: SalesOrderEditRow): EffectiveCustomerSnapshot {
  return {
    name: row.customerName,
    phone: row.customerPhone,
    fbName: row.customerFbName,
    lineName: row.customerLineName,
    countryRegion: {
      id: row.customerCountryRegionId,
      code: row.customerCountryRegionCodeSnapshot,
      name: row.customerCountryRegionNameSnapshot,
    },
    provinceState: {
      id: row.customerProvinceStateId,
      code: row.customerProvinceStateCodeSnapshot,
      name: row.customerProvinceStateNameSnapshot,
    },
    city: {
      id: row.customerCityId,
      code: row.customerCityCodeSnapshot,
      name: row.customerCityNameSnapshot,
    },
    addressDetail: row.customerAddressDetail,
    fullAddress: row.customerFullAddressSnapshot,
  }
}

function regionChanged(
  snapshot: EffectiveCustomerSnapshot,
  command: NormalizedSalesOrderCustomerUpdateCommand,
): boolean {
  return snapshot.countryRegion.id !== command.customer.countryRegionId
    || snapshot.provinceState.id !== command.customer.provinceStateId
    || snapshot.city.id !== command.customer.cityId
}

function buildCustomerReason(
  before: EffectiveCustomerSnapshot,
  after: EffectiveCustomerSnapshot,
): readonly string[] {
  const changes: string[] = []
  if (before.name !== after.name) {
    changes.push(`客户姓名：${before.name} → ${after.name}`)
  }
  if (before.phone !== after.phone) {
    changes.push(`客户电话：${before.phone} → ${after.phone}`)
  }
  if (before.fbName !== after.fbName) changes.push('客户FB名称：已修改')
  if (before.lineName !== after.lineName) changes.push('客户LINE名称：已修改')
  if (
    before.countryRegion.id !== after.countryRegion.id
    || before.provinceState.id !== after.provinceState.id
    || before.city.id !== after.city.id
  ) {
    changes.push(
      `客户地区：${before.provinceState.name}/${before.city.name} → `
      + `${after.provinceState.name}/${after.city.name}`,
    )
  }
  if (before.addressDetail !== after.addressDetail) changes.push('详细地址：已修改')
  return changes
}

function changedFieldKeys(
  before: EffectiveCustomerSnapshot,
  after: EffectiveCustomerSnapshot,
): string[] {
  const keys: string[] = []
  if (before.name !== after.name) keys.push('name')
  if (before.phone !== after.phone) keys.push('phone')
  if (before.fbName !== after.fbName) keys.push('fbName')
  if (before.lineName !== after.lineName) keys.push('lineName')
  if (
    before.countryRegion.id !== after.countryRegion.id
    || before.provinceState.id !== after.provinceState.id
    || before.city.id !== after.city.id
  ) {
    keys.push('region')
  }
  if (before.addressDetail !== after.addressDetail) keys.push('addressDetail')
  return keys
}

@Injectable()
export class SalesOrderEditService {
  private readonly dependencies: SalesOrderEditServiceDependencies

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
    @Optional()
    @Inject(SALES_ORDER_EDIT_DEPENDENCIES)
    dependencyOverrides: Partial<SalesOrderEditServiceDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async context(
    actorUserId: string,
    rawSalesOrderId: unknown,
  ): Promise<SalesOrderEditView> {
    const actor = requireActorId(actorUserId)
    const salesOrderId = validateSalesOrderId(rawSalesOrderId)
    const scope = await this.dataScope.resolve(actor)
    const row = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, ...salesOrderScopeWhere(scope, actor) },
      select: EDIT_ROW_SELECT,
    })
    if (row === null) {
      throw failure(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
    }
    return mapContext(row)
  }

  async updateCustomer(
    context: SalesOrderEditContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderEditView> {
    const trusted = validateContext(context)
    const salesOrderId = validateSalesOrderId(rawSalesOrderId)
    const command = normalizeSalesOrderCustomerUpdateCommand(input)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lockAccessibleOrder(
          transaction,
          salesOrderId,
          trusted.actorUserId,
        )
        if (row.version !== command.expectedVersion) throw versionConflict()

        const before = customerSnapshotOf(row)
        const effective = await this.resolveCustomerRegion(
          transaction,
          before,
          command,
        )
        const address = normalizeSalesOrderAddress({
          countryRegionName: effective.countryRegion.name,
          provinceStateName: effective.provinceState.name,
          cityName: effective.city.name,
          addressDetail: command.customer.addressDetail,
        })
        const after: EffectiveCustomerSnapshot = {
          name: command.customer.name,
          phone: command.customer.phone,
          fbName: command.customer.fbName,
          lineName: command.customer.lineName,
          countryRegion: effective.countryRegion,
          provinceState: effective.provinceState,
          city: effective.city,
          addressDetail: address.addressDetail,
          fullAddress: address.fullAddress,
        }
        const changes = buildCustomerReason(before, after)
        if (changes.length === 0) return mapContext(row)

        const version = row.version + 1
        await transaction.salesOrder.update({
          where: { id: salesOrderId },
          data: {
            customerName: after.name,
            customerPhone: after.phone,
            customerFbName: after.fbName,
            customerLineName: after.lineName,
            customerCountryRegionId: after.countryRegion.id,
            customerProvinceStateId: after.provinceState.id,
            customerCityId: after.city.id,
            customerCountryRegionCodeSnapshot: after.countryRegion.code,
            customerProvinceStateCodeSnapshot: after.provinceState.code,
            customerCityCodeSnapshot: after.city.code,
            customerCountryRegionNameSnapshot: after.countryRegion.name,
            customerProvinceStateNameSnapshot: after.provinceState.name,
            customerCityNameSnapshot: after.city.name,
            customerAddressDetail: after.addressDetail,
            customerFullAddressSnapshot: after.fullAddress,
            version: { increment: 1 },
          },
        })
        await transaction.salesOrderStatusHistory.create({ data: {
          salesOrderId,
          dimension: 'CUSTOMER',
          fromStatus: 'BEFORE',
          toStatus: 'AFTER',
          reason: truncateReason(changes.join('；')),
          changedByUserId: trusted.actorUserId,
        } })
        await this.audit.record(transaction, {
          eventType: AuditEventType.SALES_ORDER_CUSTOMER_UPDATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'SALES_ORDER',
          targetId: salesOrderId,
          requestId: trusted.requestId,
          metadata: {
            changedFields: changedFieldKeys(before, after).join(','),
            previousVersion: row.version,
            version,
            reason: command.reason,
          },
        })
        return {
          ...mapContext(row),
          version,
          customer: {
            name: after.name,
            phone: after.phone,
            fbName: after.fbName,
            lineName: after.lineName,
            countryRegion: after.countryRegion,
            provinceState: after.provinceState,
            city: after.city,
            addressDetail: after.addressDetail,
            fullAddress: after.fullAddress,
          },
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    }
    catch (caught) {
      if (isConcurrentConflict(caught)) throw versionConflict()
      throw caught
    }
  }

  async updateSalesInfo(
    context: SalesOrderEditContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderEditView> {
    const trusted = validateContext(context)
    const salesOrderId = validateSalesOrderId(rawSalesOrderId)
    const command = normalizeSalesOrderSalesInfoUpdateCommand(
      input,
      this.dependencies.businessToday(),
    )

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lockAccessibleOrder(
          transaction,
          salesOrderId,
          trusted.actorUserId,
        )
        if (row.version !== command.expectedVersion) throw versionConflict()

        const beforeOrderDate = isoDateOf(row.orderDate)
        const dateChanged = beforeOrderDate !== command.orderDate
        const remarkChanged = row.remark !== command.remark
        if (!dateChanged && !remarkChanged) return mapContext(row)

        const changes: string[] = []
        if (dateChanged) {
          changes.push(`出单日期：${beforeOrderDate} → ${command.orderDate}`)
        }
        if (remarkChanged) changes.push('订单备注：已修改')

        const version = row.version + 1
        await transaction.salesOrder.update({
          where: { id: salesOrderId },
          data: {
            orderDate: new Date(`${command.orderDate}T00:00:00.000Z`),
            remark: command.remark,
            version: { increment: 1 },
          },
        })
        await transaction.salesOrderStatusHistory.create({ data: {
          salesOrderId,
          dimension: 'SALES_INFO',
          fromStatus: 'BEFORE',
          toStatus: 'AFTER',
          reason: truncateReason(changes.join('；')),
          changedByUserId: trusted.actorUserId,
        } })
        await this.audit.record(transaction, {
          eventType: AuditEventType.SALES_ORDER_SALES_INFO_UPDATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'SALES_ORDER',
          targetId: salesOrderId,
          requestId: trusted.requestId,
          metadata: {
            changedFields: [
              ...(dateChanged ? ['orderDate'] : []),
              ...(remarkChanged ? ['remark'] : []),
            ].join(','),
            previousVersion: row.version,
            version,
            reason: command.reason,
          },
        })
        return {
          ...mapContext(row),
          version,
          salesInfo: { orderDate: command.orderDate, remark: command.remark },
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    }
    catch (caught) {
      if (isConcurrentConflict(caught)) throw versionConflict()
      throw caught
    }
  }

  private async lockAccessibleOrder(
    transaction: Prisma.TransactionClient,
    salesOrderId: string,
    actorUserId: string,
  ): Promise<SalesOrderEditRow> {
    const scope = await this.dataScope.resolveInTransaction(transaction, actorUserId)
    const accessible = await transaction.salesOrder.findFirst({
      where: { id: salesOrderId, ...salesOrderScopeWhere(scope, actorUserId) },
      select: { id: true },
    })
    if (accessible === null) {
      throw failure(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
    }
    const locked = await transaction.$queryRaw<Array<{ readonly id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "sales_orders"
        WHERE "id" = CAST(${salesOrderId} AS uuid)
        FOR UPDATE
      `,
    )
    if (locked.length !== 1) {
      throw failure(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
    }
    const row = await transaction.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: EDIT_ROW_SELECT,
    })
    if (row === null) {
      throw failure(HttpStatus.NOT_FOUND, 'SALES_ORDER_NOT_FOUND', '销售订单不存在')
    }
    return row
  }

  /**
   * 地区未变化时沿用原快照，不重新要求地区仍处于启用状态：停用地区上的历史订单
   * 只改电话或备注不应该被“地区不可用”拦住。
   */
  private async resolveCustomerRegion(
    transaction: Prisma.TransactionClient,
    before: EffectiveCustomerSnapshot,
    command: NormalizedSalesOrderCustomerUpdateCommand,
  ): Promise<{
    readonly countryRegion: SalesOrderEditCustomerRegion
    readonly provinceState: SalesOrderEditCustomerRegion
    readonly city: SalesOrderEditCustomerRegion
  }> {
    if (!regionChanged(before, command)) {
      return {
        countryRegion: before.countryRegion,
        provinceState: before.provinceState,
        city: before.city,
      }
    }
    const rows = await transaction.region.findMany({
      where: {
        id: { in: [
          command.customer.countryRegionId,
          command.customer.provinceStateId,
          command.customer.cityId,
        ] },
        enabled: true,
      },
      select: { id: true, code: true, name: true, level: true, parentId: true },
    })
    const path = requireSalesOrderRegionPath(rows, {
      countryRegionId: command.customer.countryRegionId,
      provinceStateId: command.customer.provinceStateId,
      cityId: command.customer.cityId,
    })
    return {
      countryRegion: path.countryRegion,
      provinceState: path.provinceState,
      city: path.city,
    }
  }
}
