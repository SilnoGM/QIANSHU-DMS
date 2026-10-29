import { createHash } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  ShipmentStorageLocationScope,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
} from '../dictionaries/dictionary-lookup.service'
import {
  recalculateAfterShipmentRelease,
} from '../purchase-orders/sales-order-purchase-coverage.service'
import {
  readClaimedQuantitiesBySalesLine,
  readUnownedQuantitiesBySalesLine,
  subtractUnownedCoverage,
} from '../sales-orders/sales-order-claim-coverage'
import { advanceSalesOrderAfterClaim } from '../sales-orders/sales-order-claim-progress'
import { ShipmentOwnershipService } from '../shipment-ownership/shipment-ownership.service'
import {
  ShipmentStorageCostService,
  totalCostFromSnapshot,
} from './shipment-storage-cost.service'
import type {
  ClaimShipmentStorageRequestDto,
  RelocateShipmentStorageRequestDto,
  ReleaseShipmentStorageRequestDto,
  ShipmentStorageCostDto,
  ShipmentStorageDetailDto,
  ShipmentStorageListItemDto,
  ShipmentStoragePageDto,
  ShipmentStorageStatusCountsDto,
} from './shipment-storage.dto'
import type { ShipmentStorageListQueryDto } from './shipment-storage.dto'

export interface ShipmentStorageMutationContext {
  readonly actorUserId: string
  readonly requestId: string
}

const RELEASE_PART_SELECT = {
  id: true,
  status: true,
  shippedAt: true,
  warehouseReceivedAt: true,
  deliveredAt: true,
  destinationWarehouseValue: true,
  shipmentNo: true,
  shippingMarkText: true,
  purchaseOrderId: true,
  purchaseOrder: {
    select: {
      id: true,
      orderNo: true,
      orderStatus: true,
      paymentStatus: true,
      purchaseType: true,
    },
  },
  ownershipCurrent: {
    select: {
      ownerType: true,
      ownerSalesOrderId: true,
      state: true,
      ownerSalesOrder: {
        select: { id: true, orderNo: true, customerName: true, issuerUserId: true },
      },
    },
  },
  items: {
    select: {
      quantity: true,
      line: {
        select: {
          id: true,
          lineNumber: true,
          actualPurchaseUnitPriceAmount: true,
          productNameSnapshot: true,
        },
      },
    },
  },
  containerLoadingItems: {
    take: 1,
    select: {
      recipientName: true,
      recipientPhone: true,
      recipientAddress: true,
      codAmountTwd: true,
      grossWeightKg: true,
      lengthCm: true,
      widthCm: true,
      heightCm: true,
      volumeCai: true,
      containerBatch: {
        select: { id: true, containerBatchNo: true, containerBatchName: true, loadingDate: true },
      },
    },
  },
} as const satisfies Prisma.PurchaseOrderPartSelect

type ReleasePart = Prisma.PurchaseOrderPartGetPayload<{ select: typeof RELEASE_PART_SELECT }>

interface ShipmentCostSnapshot {
  readonly purchaseCostCny: string
  readonly packagingCostCny: string
  readonly totalCostCny: string
  readonly originalShareRate: string
  readonly userLegCny: string
  readonly companyLegCny: string
  readonly purchasePaymentBatchIds: string[]
  readonly packagingCostRequestIds: string[]
  readonly snapshotAt: string
}

const STORAGE_RECORD_SELECT = {
  id: true,
  shipmentId: true,
  status: true,
  locationScope: true,
  warehouseValue: true,
  warehouseLabelSnapshot: true,
  locationUpdatedAt: true,
  shipmentNoSnapshot: true,
  shippingMarkSnapshot: true,
  originPurchaseOrderId: true,
  originPurchaseOrderNoSnapshot: true,
  originSalesOrderId: true,
  originSalesOrderNoSnapshot: true,
  originCustomerNameSnapshot: true,
  originIssuerUserId: true,
  originAllocations: true,
  containerSnapshot: true,
  costSnapshot: true,
  snapshotAt: true,
  claimedSalesOrderId: true,
  claimedAt: true,
  createdAt: true,
  locationEvents: {
    orderBy: { sequence: 'asc' },
    select: {
      sequence: true,
      locationScope: true,
      warehouseValue: true,
      warehouseLabelSnapshot: true,
      reason: true,
      occurredAt: true,
    },
  },
} as const satisfies Prisma.ShipmentStorageRecordSelect

type StorageRecordRow = Prisma.ShipmentStorageRecordGetPayload<{ select: typeof STORAGE_RECORD_SELECT }>

function storageFailure(code: string, message: string, status: number = HttpStatus.UNPROCESSABLE_ENTITY): never {
  throw new ApiException(status, code, message)
}

function payloadHash(payload: unknown): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest()
  const result = new Uint8Array(new ArrayBuffer(digest.byteLength))
  result.set(digest)
  return result
}

function decimalString(value: unknown, fallback = '0.00'): string {
  return typeof value === 'string' ? value : fallback
}

function costFromSnapshot(snapshot: Prisma.JsonValue): ShipmentStorageCostDto {
  const value = typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : {}
  return {
    purchaseCostCny: decimalString(value.purchaseCostCny),
    packagingCostCny: decimalString(value.packagingCostCny),
    totalCostCny: decimalString(value.totalCostCny),
    originalShareRate: decimalString(value.originalShareRate),
    userLegCny: decimalString(value.userLegCny),
    companyLegCny: decimalString(value.companyLegCny),
  }
}

function baseRecordDto(row: StorageRecordRow): ShipmentStorageListItemDto {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    status: row.status,
    locationScope: row.locationScope,
    warehouseValue: row.warehouseValue,
    warehouseLabel: row.warehouseLabelSnapshot,
    shipmentNo: row.shipmentNoSnapshot,
    shippingMarkText: row.shippingMarkSnapshot,
    originPurchaseOrderNo: row.originPurchaseOrderNoSnapshot,
    originSalesOrderNo: row.originSalesOrderNoSnapshot,
    originCustomerName: row.originCustomerNameSnapshot,
    originSalesOrderId: row.originSalesOrderId,
    originIssuerUserId: row.originIssuerUserId,
    cost: costFromSnapshot(row.costSnapshot),
    snapshotAt: row.snapshotAt.toISOString(),
    locationUpdatedAt: row.locationUpdatedAt.toISOString(),
    claimedAt: row.claimedAt?.toISOString() ?? null,
    claimedSalesOrderId: row.claimedSalesOrderId,
    createdAt: row.createdAt.toISOString(),
  }
}

function detailDto(row: StorageRecordRow): ShipmentStorageDetailDto {
  return {
    ...baseRecordDto(row),
    originAllocations: Array.isArray(row.originAllocations)
      ? row.originAllocations
      : [],
    containerSnapshot: row.containerSnapshot ?? null,
    locationEvents: row.locationEvents.map(event => ({
      sequence: event.sequence,
      locationScope: event.locationScope,
      warehouseValue: event.warehouseValue,
      warehouseLabel: event.warehouseLabelSnapshot,
      reason: event.reason,
      occurredAt: event.occurredAt.toISOString(),
    })),
  }
}

@Injectable()
export class ShipmentStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dictionary: DictionaryLookupService,
    private readonly ownership: ShipmentOwnershipService,
    private readonly cost: ShipmentStorageCostService,
  ) {}

  async release(
    context: ShipmentStorageMutationContext,
    input: ReleaseShipmentStorageRequestDto,
  ): Promise<readonly ShipmentStorageDetailDto[]> {
    const shipmentIds = [...new Set(input.shipmentIds)].sort()
    if (shipmentIds.length === 0 || shipmentIds.length > 50) {
      storageFailure('VALIDATION_FAILED', '请选择 1 到 50 个货件')
    }
    if (input.locationScope === 'OVERSEAS' && input.overseasWarehouseValue === undefined) {
      storageFailure('VALIDATION_FAILED', '海外寄仓必须选择海外仓库')
    }
    if (input.locationScope === 'MAINLAND' && input.overseasWarehouseValue !== undefined) {
      storageFailure('VALIDATION_FAILED', '内地寄仓不能指定海外仓库')
    }
    const payload = {
      format: 'shipment-storage.release.v1',
      shipmentIds,
      locationScope: input.locationScope,
      overseasWarehouseValue: input.overseasWarehouseValue ?? null,
      reason: input.reason,
      note: input.note ?? null,
    }
    const hash = payloadHash(payload)

    const existing = await this.prisma.shipmentReleaseBatch.findFirst({
      where: { actorUserId: context.actorUserId, requestKey: input.requestKey },
      select: { id: true, payloadHash: true },
    })
    if (existing !== null) {
      if (!Buffer.from(existing.payloadHash).equals(hash)) {
        storageFailure('SHIPMENT_STORAGE_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的释放内容', HttpStatus.CONFLICT)
      }
      return this.finalizeRelease(await this.loadBatchRecords(existing.id), context)
    }

    let createdIds: string[]
    try {
      createdIds = await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      for (const shipmentId of shipmentIds) {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE id = ${shipmentId}::uuid FOR UPDATE`)
      }
      const parts = await transaction.purchaseOrderPart.findMany({
        where: { id: { in: shipmentIds } },
        select: RELEASE_PART_SELECT,
      })
      if (parts.length !== shipmentIds.length) {
        storageFailure('SHIPMENT_STORAGE_NOT_ALLOWED', '部分货件不存在或不可见')
      }
      const activeStorage = await transaction.shipmentStorageRecord.findMany({
        where: {
          shipmentId: { in: shipmentIds },
          status: { in: ['IN_STORAGE', 'RESERVED'] },
        },
        select: { shipmentId: true },
      })
      if (activeStorage.length > 0) {
        storageFailure('SHIPMENT_STORAGE_ALREADY_ACTIVE', '部分货件已在寄仓中', HttpStatus.CONFLICT)
      }
      for (const part of parts) this.assertReleasable(part, input.locationScope, input.overseasWarehouseValue)

      const packagingPending = await transaction.packagingCostRequest.count({
        where: { shipmentId: { in: shipmentIds }, status: 'PENDING_PAYMENT' },
      })
      if (packagingPending > 0) {
        storageFailure('SHIPMENT_STORAGE_PACKAGING_UNPAID', '货件仍有待付款的包装费，请先结清')
      }
      const packagingRows = await transaction.packagingCostRequest.findMany({
        where: { shipmentId: { in: shipmentIds }, status: 'PAID' },
        select: { id: true, shipmentId: true, amount: true },
      })
      const issuerUserIds = [...new Set(parts.map(part => part.ownershipCurrent!.ownerSalesOrder!.issuerUserId))]
      const accounts = await transaction.fundAccount.findMany({
        where: { userId: { in: issuerUserIds } },
        select: { userId: true, userShareRate: true },
      })
      const rateByUser = new Map<string, Prisma.Decimal | null>()
      for (const account of accounts) {
        if (account.userId !== null) rateByUser.set(account.userId, account.userShareRate)
      }
      for (const userId of issuerUserIds) {
        if (rateByUser.get(userId) === null || rateByUser.get(userId) === undefined) {
          storageFailure('SHIPMENT_STORAGE_SHARE_RATE_MISSING', '原出单人缺少资金账户比例，无法转移成本')
        }
      }
      const purchaseOrderIds = [...new Set(parts.map(part => part.purchaseOrderId))]
      const payments = await transaction.purchaseOrderPayment.findMany({
        where: { purchaseOrderId: { in: purchaseOrderIds }, voidedAt: null },
        select: { purchaseOrderId: true, fundPostingBatchId: true },
      })
      const warehouse = await this.resolveWarehouse(transaction, input, parts)

      const originSalesOrderIds = [...new Set(parts.map(part => part.ownershipCurrent!.ownerSalesOrderId!))]
      const batch = await transaction.shipmentReleaseBatch.create({
        data: {
          reason: input.reason,
          originSalesOrderId: originSalesOrderIds.length === 1 ? originSalesOrderIds[0] : null,
          actorUserId: context.actorUserId,
          requestKey: input.requestKey,
          payloadHash: hash,
          note: input.note?.trim() || null,
        },
        select: { id: true },
      })
      const now = new Date()
      const recordIds: string[] = []
      for (const part of parts) {
        const costSnapshot = this.costSnapshot(part, packagingRows, payments, rateByUser, now)
        const record = await transaction.shipmentStorageRecord.create({
          data: {
            shipmentId: part.id,
            releaseBatchId: batch.id,
            status: 'IN_STORAGE',
            locationScope: input.locationScope,
            warehouseValue: warehouse.valueFor(part),
            warehouseLabelSnapshot: warehouse.labelFor(part),
            locationUpdatedAt: now,
            shipmentNoSnapshot: part.shipmentNo,
            shippingMarkSnapshot: part.shippingMarkText,
            originPurchaseOrderId: part.purchaseOrderId,
            originPurchaseOrderNoSnapshot: part.purchaseOrder.orderNo,
            originSalesOrderId: part.ownershipCurrent!.ownerSalesOrder!.id,
            originSalesOrderNoSnapshot: part.ownershipCurrent!.ownerSalesOrder!.orderNo,
            originCustomerNameSnapshot: part.ownershipCurrent!.ownerSalesOrder!.customerName,
            originIssuerUserId: part.ownershipCurrent!.ownerSalesOrder!.issuerUserId,
            originAllocations: part.items.map(item => ({
              purchaseOrderLineId: item.line.id,
              lineNumber: item.line.lineNumber,
              productName: item.line.productNameSnapshot,
              quantity: item.quantity,
              unitPriceCny: item.line.actualPurchaseUnitPriceAmount.toFixed(2),
            })),
            containerSnapshot: this.containerSnapshot(part) ?? Prisma.DbNull,
            costSnapshot: costSnapshot as unknown as Prisma.InputJsonObject,
            snapshotAt: now,
          },
          select: { id: true },
        })
        recordIds.push(record.id)
        // 释放即按原出单人比例退款：甲 +aC、公司 +(1−a)C，资金与寄仓事实同事务提交。
        await this.cost.transfer(transaction, context, 'RELEASE', {
          amountCny: costSnapshot.totalCostCny,
          shipmentId: part.id,
          shipmentNo: part.shipmentNo,
          storageRecordId: record.id,
          userId: part.ownershipCurrent!.ownerSalesOrder!.issuerUserId,
        })
      }
      await this.ownership.recordMany(transaction, parts.map(part => ({
        shipmentId: part.id,
        ownerType: 'STORAGE_POOL',
        ownerSalesOrderId: null,
        reason: input.reason,
        actorUserId: context.actorUserId,
        releaseBatchId: batch.id,
        payload: {
          format: 'shipment-ownership.release.v1',
          shipmentId: part.id,
          releaseBatchId: batch.id,
          reason: input.reason,
        },
      })))
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index]
        const storageRecordId = recordIds[index]
        await this.audit.record(transaction, {
          eventType: 'SHIPMENT_OWNERSHIP_RELEASED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'PURCHASE_ORDER_PART',
          targetId: part.id,
          metadata: {
            releaseBatchId: batch.id,
            storageRecordId,
            reason: input.reason,
            locationScope: input.locationScope,
            warehouseValue: warehouse.valueFor(part),
          },
        })
        await this.audit.record(transaction, {
          eventType: 'SHIPMENT_STORAGE_RECORDED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'SHIPMENT_STORAGE_RECORD',
          targetId: storageRecordId,
          metadata: { releaseBatchId: batch.id, shipmentId: part.id },
        })
      }
      return recordIds
      }, { timeout: 30_000 })
    }
    catch (error) {
      // 并发重放可能同时越过前置幂等检查；唯一约束冲突时按同一请求返回已提交结果。
      if (hasPersistenceCode(readPersistenceErrorFacts(error), 'P2002')) {
        const batch = await this.prisma.shipmentReleaseBatch.findFirst({
          where: { actorUserId: context.actorUserId, requestKey: input.requestKey },
          select: { id: true, payloadHash: true },
        })
        if (batch !== null && Buffer.from(batch.payloadHash).equals(hash)) {
          return this.finalizeRelease(await this.loadBatchRecords(batch.id), context)
        }
      }
      throw error
    }

    const records = await this.prisma.shipmentStorageRecord.findMany({
      where: { id: { in: createdIds } },
      select: STORAGE_RECORD_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return this.finalizeRelease(records.map(detailDto), context)
  }

  /**
   * 释放提交后再重算原销售单覆盖。必须放在释放事务之外：释放先锁货件，
   * 销售链条的其他写入先锁销售明细/主行，放进同一事务会形成反向锁序。
   * 重算失败时释放事实已成立；同一 requestKey 重试会重放释放并再次执行重算。
   */
  private async finalizeRelease(
    records: readonly ShipmentStorageDetailDto[],
    context: ShipmentStorageMutationContext,
  ): Promise<readonly ShipmentStorageDetailDto[]> {
    const salesOrderIds = [...new Set(records.map(record => record.originSalesOrderId))].sort()
    for (const salesOrderId of salesOrderIds) {
      try {
        await this.prisma.$transaction(async transaction => {
          await applyTransactionTimeouts(transaction)
          await recalculateAfterShipmentRelease(transaction, this.audit, {
            actorUserId: context.actorUserId,
            requestId: context.requestId,
            salesOrderId,
          })
        }, { timeout: 30_000 })
      }
      catch {
        throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'SHIPMENT_STORAGE_RELEASE_RECALC_FAILED',
          '货件已释放，但原销售订单覆盖重算失败，请重试',
        )
      }
    }
    return records
  }

  async list(query: ShipmentStorageListQueryDto): Promise<ShipmentStoragePageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const where = this.storageWhere(query)
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.shipmentStorageRecord.count({ where }),
      this.prisma.shipmentStorageRecord.findMany({
        where,
        select: STORAGE_RECORD_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return { items: rows.map(baseRecordDto), page, pageSize, total }
  }

  async statusCounts(query: ShipmentStorageListQueryDto): Promise<ShipmentStorageStatusCountsDto> {
    const where = this.storageWhere({ ...query, status: undefined })
    const rows = await this.prisma.shipmentStorageRecord.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })
    const counts = new Map(rows.map(row => [row.status, row._count._all]))
    const all = rows.reduce((sum, row) => sum + row._count._all, 0)
    return {
      items: [
        { value: 'ALL', count: all },
        { value: 'IN_STORAGE', count: counts.get('IN_STORAGE') ?? 0 },
        { value: 'CLAIMED', count: counts.get('CLAIMED') ?? 0 },
        { value: 'VOIDED', count: counts.get('VOIDED') ?? 0 },
      ],
    }
  }

  private storageWhere(
    query: ShipmentStorageListQueryDto,
    includeStatus = true,
  ): Prisma.ShipmentStorageRecordWhereInput {
    const where: Prisma.ShipmentStorageRecordWhereInput = {
      id: query.storageId,
      ...(includeStatus && query.status !== undefined ? { status: query.status } : {}),
      locationScope: query.locationScope,
      warehouseValue: query.warehouseValue,
    }
    const keyword = query.keyword?.trim()
    if (keyword !== undefined && keyword !== '') {
      const match = { contains: keyword, mode: 'insensitive' as const }
      where.OR = [
        { shipmentNoSnapshot: match },
        { shippingMarkSnapshot: match },
        { originSalesOrderNoSnapshot: match },
        { originPurchaseOrderNoSnapshot: match },
        { originCustomerNameSnapshot: match },
      ]
    }
    return where
  }

  async getById(storageRecordId: string): Promise<ShipmentStorageDetailDto> {
    const row = await this.prisma.shipmentStorageRecord.findUnique({
      where: { id: storageRecordId },
      select: STORAGE_RECORD_SELECT,
    })
    if (row === null) {
      storageFailure('SHIPMENT_STORAGE_NOT_FOUND', '寄仓记录不存在', HttpStatus.NOT_FOUND)
    }
    return detailDto(row)
  }

  async relocate(
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    input: RelocateShipmentStorageRequestDto,
  ): Promise<ShipmentStorageDetailDto> {    const hash = payloadHash({
      format: 'shipment-storage.relocate.v1',
      storageRecordId,
      warehouseValue: input.warehouseValue,
      reason: input.reason,
    })
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM shipment_storage_records WHERE id = ${storageRecordId}::uuid FOR UPDATE`)
      const record = await transaction.shipmentStorageRecord.findUnique({
        where: { id: storageRecordId },
        select: { id: true, status: true, locationScope: true, warehouseValue: true },
      })
      if (record === null) {
        storageFailure('SHIPMENT_STORAGE_NOT_FOUND', '寄仓记录不存在', HttpStatus.NOT_FOUND)
      }
      if (record.status !== 'IN_STORAGE') {
        storageFailure('SHIPMENT_STORAGE_STATE_CHANGED', '只有寄仓中的记录可以移动位置', HttpStatus.CONFLICT)
      }
      if (record.locationScope !== 'OVERSEAS') {
        storageFailure('SHIPMENT_STORAGE_LOCATION_INVALID', '只有海外仓之间可以移动')
      }
      if (record.warehouseValue === input.warehouseValue) {
        storageFailure('SHIPMENT_STORAGE_LOCATION_INVALID', '目标仓库与当前位置相同')
      }
      const resolved = await this.resolveWarehouseValue(transaction, 'overseas.warehouse', input.warehouseValue)
      const existingEvent = await transaction.shipmentStorageLocationEvent.findFirst({
        where: { actorUserId: context.actorUserId, requestKey: input.requestKey },
        select: { payloadHash: true },
      })
      if (existingEvent !== null) {
        if (!Buffer.from(existingEvent.payloadHash).equals(hash)) {
          storageFailure('SHIPMENT_STORAGE_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的移动内容', HttpStatus.CONFLICT)
        }
        return
      }
      const aggregate = await transaction.shipmentStorageLocationEvent.aggregate({
        where: { storageRecordId },
        _max: { sequence: true },
      })
      await transaction.shipmentStorageLocationEvent.create({
        data: {
          storageRecordId,
          sequence: (aggregate._max.sequence ?? 0) + 1,
          locationScope: 'OVERSEAS',
          warehouseValue: resolved.value,
          warehouseLabelSnapshot: resolved.label,
          reason: input.reason,
          actorUserId: context.actorUserId,
          requestKey: input.requestKey,
          payloadHash: hash,
        },
      })
      await transaction.shipmentStorageRecord.update({
        where: { id: storageRecordId },
        data: {
          locationScope: 'OVERSEAS',
          warehouseValue: resolved.value,
          warehouseLabelSnapshot: resolved.label,
          locationUpdatedAt: new Date(),
        },
      })
      await this.audit.record(transaction, {
        eventType: 'SHIPMENT_STORAGE_LOCATION_CHANGED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'SHIPMENT_STORAGE_RECORD',
        targetId: storageRecordId,
        metadata: {
          fromWarehouseValue: record.warehouseValue,
          toWarehouseValue: resolved.value,
          reason: input.reason,
        },
      })
    }, { timeout: 30_000 })
    return this.getById(storageRecordId)
  }

  async claim(
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    input: ClaimShipmentStorageRequestDto,
  ): Promise<ShipmentStorageDetailDto> {
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM shipment_storage_records WHERE id = ${storageRecordId}::uuid FOR UPDATE`)
      const record = await transaction.shipmentStorageRecord.findUnique({
        where: { id: storageRecordId },
        select: {
          id: true,
          shipmentId: true,
          status: true,
          originSalesOrderId: true,
          originAllocations: true,
          claimedSalesOrderId: true,
          claimedBy: true,
          costSnapshot: true,
          shipmentNoSnapshot: true,
        },
      })
      if (record === null) {
        storageFailure('SHIPMENT_STORAGE_NOT_FOUND', '寄仓记录不存在', HttpStatus.NOT_FOUND)
      }
      if (record.status === 'CLAIMED') {
        if (record.claimedSalesOrderId === input.salesOrderId && record.claimedBy === context.actorUserId) {
          return
        }
        storageFailure('SHIPMENT_STORAGE_STATE_CHANGED', '寄仓记录已被认领', HttpStatus.CONFLICT)
      }
      if (record.status !== 'IN_STORAGE') {
        storageFailure('SHIPMENT_STORAGE_STATE_CHANGED', '只有寄仓中的记录可以认领', HttpStatus.CONFLICT)
      }
      const ownership = await transaction.shipmentOwnershipCurrent.findUnique({
        where: { shipmentId: record.shipmentId },
        select: { ownerType: true, state: true },
      })
      if (ownership?.ownerType !== 'STORAGE_POOL' || ownership.state !== 'ACTIVE') {
        storageFailure('SHIPMENT_STORAGE_STATE_CHANGED', '货件归属已变化，请刷新后重试', HttpStatus.CONFLICT)
      }
      const order = await transaction.salesOrder.findUnique({
        where: { id: input.salesOrderId },
        select: { id: true, orderNo: true, orderStatus: true, issuerUserId: true },
      })
      if (order === null) {
        storageFailure('SALES_ORDER_NOT_FOUND', '目标销售订单不存在', HttpStatus.NOT_FOUND)
      }
      if (order.orderStatus !== 'CONFIRMED') {
        storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '只有已确认的销售订单可以认领寄仓货件')
      }
      if (input.salesOrderId === record.originSalesOrderId) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '不能把货件认领回原销售订单')
      }
      const requestedLineIds = input.lines.map(line => line.salesOrderLineId)
      if (new Set(requestedLineIds).size !== requestedLineIds.length) {
        storageFailure('VALIDATION_FAILED', '认领明细行不能重复')
      }
      const lines = await transaction.salesOrderLine.findMany({
        where: {
          id: { in: requestedLineIds },
          salesOrderId: input.salesOrderId,
          removedAt: null,
        },
        select: { id: true, lineNumber: true, quantity: true },
      })
      if (lines.length !== requestedLineIds.length) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '目标销售明细行不存在或已移除')
      }
      const lineById = new Map(lines.map(line => [line.id, line]))
      for (const claimed of input.lines) {
        const line = lineById.get(claimed.salesOrderLineId)
        if (line === undefined || claimed.quantity > line.quantity) {
          storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '认领数量超过目标销售行数量')
        }
      }
      const shipmentQuantity = Array.isArray(record.originAllocations)
        ? record.originAllocations.reduce<number>((sum, allocation) => {
          if (typeof allocation !== 'object' || allocation === null || Array.isArray(allocation)) return sum
          const quantity = (allocation as Record<string, unknown>).quantity
          return sum + (typeof quantity === 'number' ? quantity : 0)
        }, 0)
        : 0
      const claimedQuantity = input.lines.reduce((sum, line) => sum + line.quantity, 0)
      if (shipmentQuantity <= 0 || claimedQuantity !== shipmentQuantity) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '寄仓货件必须整件认领')
      }
      // 认领不能把销售行补成“超量”：已审核采购与既有认领之外的余量才是可认领上限。
      const salesLineIds = lines.map(line => line.id)
      const purchasedRows = await transaction.purchaseOrderLine.groupBy({
        by: ['sourceSalesOrderLineId'],
        where: {
          sourceSalesOrderLineId: { in: salesLineIds },
          purchaseOrder: {
            orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
            purchaseType: 'SALES_LINKED',
            salesOrderId: input.salesOrderId,
          },
        },
        _sum: { quantity: true },
      })
      const purchasedBySource = new Map<string, number>()
      for (const row of purchasedRows) {
        if (row.sourceSalesOrderLineId !== null) {
          purchasedBySource.set(row.sourceSalesOrderLineId, row._sum.quantity ?? 0)
        }
      }
      const effectivePurchases = subtractUnownedCoverage(
        purchasedBySource,
        await readUnownedQuantitiesBySalesLine(transaction, input.salesOrderId, salesLineIds),
      )
      const existingClaims = await readClaimedQuantitiesBySalesLine(
        transaction,
        input.salesOrderId,
        salesLineIds,
      )
      for (const claimed of input.lines) {
        const line = lineById.get(claimed.salesOrderLineId)
        const remaining = (line?.quantity ?? 0)
          - (effectivePurchases.get(claimed.salesOrderLineId) ?? 0)
          - (existingClaims.get(claimed.salesOrderLineId) ?? 0)
        if (claimed.quantity > remaining) {
          storageFailure('SHIPMENT_STORAGE_CLAIM_EXCEEDS_COVERAGE', '认领数量超过该销售行的未覆盖余量')
        }
      }
      const now = new Date()
      await transaction.shipmentStorageRecord.update({
        where: { id: storageRecordId },
        data: {
          status: 'CLAIMED',
          claimedSalesOrderId: input.salesOrderId,
          claimedAt: now,
          claimedBy: context.actorUserId,
        },
      })
      await transaction.shipmentClaimLine.createMany({
        data: input.lines.map(line => ({
          storageRecordId,
          salesOrderLineId: line.salesOrderLineId,
          quantity: line.quantity,
          claimedAt: now,
          claimedBy: context.actorUserId,
        })),
      })
      await this.ownership.recordMany(transaction, [{
        shipmentId: record.shipmentId,
        ownerType: 'SALES_ORDER',
        ownerSalesOrderId: input.salesOrderId,
        reason: 'CLAIM',
        actorUserId: context.actorUserId,
        payload: {
          format: 'shipment-ownership.claim.v1',
          shipmentId: record.shipmentId,
          storageRecordId,
          salesOrderId: input.salesOrderId,
        },
      }])
      await this.audit.record(transaction, {
        eventType: 'SHIPMENT_STORAGE_CLAIMED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'SHIPMENT_STORAGE_RECORD',
        targetId: storageRecordId,
        metadata: {
          shipmentId: record.shipmentId,
          salesOrderId: input.salesOrderId,
          salesOrderNo: order.orderNo,
          claimedQuantity,
        },
      })
      // 认领与履约推进必须同一事务：认领的是已发货、已到仓的既有货件，
      // 新订单应直接对齐这些事实，否则会停在待采购或无法继续签收。
      const progress = await advanceSalesOrderAfterClaim(transaction, this.audit, {
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        salesOrderId: input.salesOrderId,
        shipmentId: record.shipmentId,
        storageRecordId,
      })
      if (progress === 'ORDER_STATE_CHANGED') {
        storageFailure('SHIPMENT_STORAGE_STATE_CHANGED', '销售订单状态已变化，请刷新后重试', HttpStatus.CONFLICT)
      }
      // 认领即按新出单人比例收回成本：乙 −bC、公司 −(1−b)C，与认领事实同事务。
      const issuerAccount = await transaction.fundAccount.findUnique({
        where: { userId: order.issuerUserId },
        select: { userShareRate: true },
      })
      if (issuerAccount?.userShareRate === null || issuerAccount === undefined) {
        storageFailure('SHIPMENT_STORAGE_SHARE_RATE_MISSING', '新出单人缺少资金账户比例，无法转移成本')
      }
      await this.cost.transfer(transaction, context, 'CLAIM', {
        amountCny: totalCostFromSnapshot(record.costSnapshot),
        shipmentId: record.shipmentId,
        shipmentNo: record.shipmentNoSnapshot,
        storageRecordId,
        userId: order.issuerUserId,
      })
    }, { timeout: 30_000 })
    return this.getById(storageRecordId)
  }

  private async loadBatchRecords(batchId: string): Promise<readonly ShipmentStorageDetailDto[]> {
    const rows = await this.prisma.shipmentStorageRecord.findMany({
      where: { releaseBatchId: batchId },
      select: STORAGE_RECORD_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(detailDto)
  }

  private assertReleasable(
    part: ReleasePart,
    locationScope: ShipmentStorageLocationScope,
    overseasWarehouseValue: string | undefined,
  ): void {
    if (part.status !== 'ACTIVE') {
      storageFailure('SHIPMENT_STORAGE_NOT_ALLOWED', '只有有效货件可以释放')
    }
    if (part.deliveredAt !== null) {
      storageFailure('SHIPMENT_STORAGE_DELIVERED', '已签收货件不能释放')
    }
    if (part.shippedAt === null) {
      storageFailure('SHIPMENT_STORAGE_NOT_SHIPPED', '未发货货件不能释放')
    }
    if (part.warehouseReceivedAt === null) {
      storageFailure('SHIPMENT_STORAGE_NOT_RECEIVED', '未到仓货件不能释放')
    }
    if (part.purchaseOrder.paymentStatus !== 'PAID') {
      storageFailure('SHIPMENT_STORAGE_PURCHASE_UNPAID', '采购单未付清，不能释放')
    }
    const owner = part.ownershipCurrent
    if (owner === null || owner.state !== 'ACTIVE' || owner.ownerType !== 'SALES_ORDER' || owner.ownerSalesOrder === null || owner.ownerSalesOrderId === null) {
      storageFailure('SHIPMENT_STORAGE_NOT_ALLOWED', '只有归属销售单的有效货件可以释放')
    }
    if (locationScope === 'MAINLAND' && part.destinationWarehouseValue === null) {
      storageFailure('SHIPMENT_STORAGE_DESTINATION_MISSING', '货件缺少目的地仓库，无法内地寄仓')
    }
    if (locationScope === 'OVERSEAS' && overseasWarehouseValue === undefined) {
      storageFailure('SHIPMENT_STORAGE_LOCATION_INVALID', '请选择海外仓库')
    }
  }

  private async resolveWarehouse(
    transaction: Prisma.TransactionClient,
    input: ReleaseShipmentStorageRequestDto,
    parts: readonly ReleasePart[],
  ): Promise<{ valueFor(part: ReleasePart): string, labelFor(part: ReleasePart): string | null }> {
    if (input.locationScope === 'MAINLAND') {
      const labels = new Map<string, string | null>()
      for (const part of parts) {
        const value = part.destinationWarehouseValue!
        if (!labels.has(value)) {
          const resolved = await this.resolveWarehouseValue(transaction, 'mainland.warehouse', value)
          labels.set(value, resolved.label)
        }
      }
      return {
        valueFor: part => part.destinationWarehouseValue!,
        labelFor: part => labels.get(part.destinationWarehouseValue!) ?? null,
      }
    }
    const resolved = await this.resolveWarehouseValue(transaction, 'overseas.warehouse', input.overseasWarehouseValue!)
    return {
      valueFor: () => resolved.value,
      labelFor: () => resolved.label,
    }
  }

  private async resolveWarehouseValue(
    transaction: Prisma.TransactionClient,
    dictionaryCode: 'mainland.warehouse' | 'overseas.warehouse',
    value: string,
  ): Promise<{ value: string, label: string | null }> {
    try {
      const item = await this.dictionary.requireEffectiveValue(transaction, { dictionaryCode, value })
      return { value: item.value, label: item.label }
    }
    catch (error) {
      if (error instanceof DictionaryValueUnavailableError) {
        storageFailure('SHIPMENT_STORAGE_LOCATION_INVALID', '仓库不可用，请重新选择')
      }
      throw error
    }
  }

  private containerSnapshot(part: ReleasePart): Prisma.InputJsonValue | null {
    const item = part.containerLoadingItems[0]
    if (item === undefined) return null
    return {
      containerBatch: {
        id: item.containerBatch.id,
        containerBatchNo: item.containerBatch.containerBatchNo,
        containerBatchName: item.containerBatch.containerBatchName,
        loadingDate: item.containerBatch.loadingDate.toISOString().slice(0, 10),
      },
      recipientName: item.recipientName,
      recipientPhone: item.recipientPhone,
      recipientAddress: item.recipientAddress,
      codAmountTwd: item.codAmountTwd?.toFixed(2) ?? null,
      grossWeightKg: item.grossWeightKg?.toFixed(0) ?? null,
      lengthCm: item.lengthCm?.toFixed(0) ?? null,
      widthCm: item.widthCm?.toFixed(0) ?? null,
      heightCm: item.heightCm?.toFixed(0) ?? null,
      volumeCai: item.volumeCai?.toFixed(2) ?? null,
    }
  }

  private costSnapshot(
    part: ReleasePart,
    packagingRows: readonly { id: string, shipmentId: string, amount: Prisma.Decimal }[],
    payments: readonly { purchaseOrderId: string, fundPostingBatchId: string | null }[],
    rateByUser: ReadonlyMap<string, Prisma.Decimal | null>,
    now: Date,
  ): ShipmentCostSnapshot {
    const zero = new Prisma.Decimal(0)
    const purchaseCost = part.items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.line.actualPurchaseUnitPriceAmount).times(item.quantity)),
      zero,
    ).toDecimalPlaces(2)
    const packaging = packagingRows.filter(row => row.shipmentId === part.id)
    const packagingCost = packaging.reduce((sum, row) => sum.plus(row.amount), zero).toDecimalPlaces(2)
    const total = purchaseCost.plus(packagingCost).toDecimalPlaces(2)
    const rate = rateByUser.get(part.ownershipCurrent!.ownerSalesOrder!.issuerUserId) ?? zero
    const userLeg = total.times(rate).div(100).toDecimalPlaces(2)
    const companyLeg = total.minus(userLeg).toDecimalPlaces(2)
    return {
      purchaseCostCny: purchaseCost.toFixed(2),
      packagingCostCny: packagingCost.toFixed(2),
      totalCostCny: total.toFixed(2),
      originalShareRate: rate.toFixed(2),
      userLegCny: userLeg.toFixed(2),
      companyLegCny: companyLeg.toFixed(2),
      purchasePaymentBatchIds: payments
        .map(payment => payment.purchaseOrderId === part.purchaseOrderId ? payment.fundPostingBatchId : null)
        .filter((id): id is string => id !== null),
      packagingCostRequestIds: packaging.map(row => row.id),
      snapshotAt: now.toISOString(),
    }
  }
}
