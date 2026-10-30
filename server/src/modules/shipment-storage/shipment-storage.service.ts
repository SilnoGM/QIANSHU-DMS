import { createHash, randomUUID } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  ShipmentStorageLocationScope,
  ShipmentStorageStatus,
} from '../../generated/prisma/enums'
import {
  PERSON_REFERENCE_SELECT,
  toPersonReference,
  type PersonReference,
  type PersonReferenceRow,
} from '../../infrastructure/database/person-reference'
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
} from '../sales-orders/sales-order-claim-coverage'
import { advanceSalesOrderAfterClaim } from '../sales-orders/sales-order-claim-progress'
import { ShipmentOwnershipService } from '../shipment-ownership/shipment-ownership.service'
import {
  ShipmentStorageCostService,
  totalCostFromSnapshot,
} from './shipment-storage-cost.service'
import { readShipmentStorageAllocations } from './shipment-storage-allocation'
import {
  claimProductAliases,
  normalizeClaimProductName,
  type ClaimProductMatchMode,
} from './product-match'
import {
  normalizeOceanDecimal,
  OceanCalculationError,
} from '../ocean-freight-calculation/ocean-freight-calculation'
import type {
  ClaimShipmentStorageContainerChangeDto,
  ClaimShipmentStorageRequestDto,
  RelocateShipmentStorageRequestDto,
  ReleaseShipmentStorageRequestDto,
  RejectShipmentStorageClaimRequestDto,
  ShipmentStorageClaimContainerChangeDto,
  ShipmentStorageClaimRequestDto,
  ShipmentStorageClaimRequestSummaryDto,
  ShipmentStorageCostDto,
  ShipmentStorageCostTransferDto,
  ShipmentStorageContainerItemDto,
  ShipmentStorageDetailDto,
  ShipmentStorageLineSummaryDto,
  ShipmentStorageListItemDto,
  ShipmentStoragePageDto,
  ShipmentStorageProductPreviewDto,
  ShipmentStorageStatusCountsDto,
} from './shipment-storage.dto'
import type { ShipmentStorageListQueryDto } from './shipment-storage.dto'

export interface ShipmentStorageMutationContext {
  readonly actorUserId: string
  readonly requestId: string
}

const CONTAINER_ITEM_SELECT = {
  id: true,
  shipmentId: true,
  containerBatchId: true,
  version: true,
  lineNumber: true,
  oceanShippingMarkText: true,
  goodsName: true,
  packageCount: true,
  packageUnit: true,
  grossWeightKg: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  volumeCai: true,
  chargeableVolumeCai: true,
  reportedVolumeCai: true,
  recipientName: true,
  recipientPhone: true,
  recipientAddress: true,
  codAmountTwd: true,
  warehouseReceiptReference: true,
  remark: true,
  containerBatch: {
    select: { id: true, containerBatchNo: true, containerBatchName: true, loadingDate: true },
  },
} as const satisfies Prisma.ContainerLoadingItemSelect

type ContainerItemRow = Prisma.ContainerLoadingItemGetPayload<{ select: typeof CONTAINER_ITEM_SELECT }>

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
    orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
    select: CONTAINER_ITEM_SELECT,
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
  }
}

function containerItemDto(row: ContainerItemRow): ShipmentStorageContainerItemDto {
  return {
    id: row.id,
    version: row.version,
    lineNumber: row.lineNumber,
    oceanShippingMarkText: row.oceanShippingMarkText,
    goodsName: row.goodsName,
    packageCount: row.packageCount,
    packageUnit: row.packageUnit,
    grossWeightKg: row.grossWeightKg?.toFixed(0) ?? null,
    lengthCm: row.lengthCm?.toFixed(0) ?? null,
    widthCm: row.widthCm?.toFixed(0) ?? null,
    heightCm: row.heightCm?.toFixed(0) ?? null,
    volumeCai: row.volumeCai?.toFixed(2) ?? null,
    chargeableVolumeCai: row.chargeableVolumeCai,
    reportedVolumeCai: row.reportedVolumeCai?.toFixed(2) ?? null,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    recipientAddress: row.recipientAddress,
    codAmountTwd: row.codAmountTwd?.toFixed(2) ?? null,
    warehouseReceiptReference: row.warehouseReceiptReference,
    remark: row.remark,
    containerBatch: {
      id: row.containerBatch.id,
      containerBatchNo: row.containerBatch.containerBatchNo,
      containerBatchName: row.containerBatch.containerBatchName,
      loadingDate: row.containerBatch.loadingDate.toISOString().slice(0, 10),
    },
  }
}

function containerMarksFromItems(
  items: readonly ShipmentStorageContainerItemDto[],
): string[] {
  return items.flatMap(item => item.oceanShippingMarkText?.trim()
    ? [item.oceanShippingMarkText.trim()]
    : [])
}

interface StoragePersonContext {
  readonly issuerById: ReadonlyMap<string, PersonReference>
  readonly purchaseCreatorById: ReadonlyMap<string, PersonReference>
  readonly claimRequestByStorageId: ReadonlyMap<string, ShipmentStorageClaimRequestSummaryDto>
}

interface ClaimAllocationSnapshot {
  readonly purchaseOrderLineId: string | null
  readonly salesOrderLineId: string
  readonly lineNumber: number
  readonly productName: string
  readonly productDescription: string | null
  readonly sourceProductName: string | null
  readonly sourceProductDescription: string | null
  readonly sourceSalesProductName: string | null
  readonly quantity: number
  readonly productMatchMode: ClaimProductMatchMode | 'UNKNOWN'
  readonly productMatchNote: string | null
}

interface PreparedClaimAllocation {
  readonly purchaseOrderLineId: string
  readonly salesOrderLineId: string
  readonly lineNumber: number
  readonly productName: string
  readonly productDescription: string | null
  readonly sourceProductName: string
  readonly sourceProductDescription: string | null
  readonly sourceSalesProductName: string | null
  readonly quantity: number
  readonly productMatchMode: ClaimProductMatchMode
  readonly productMatchNote: string | null
}

interface PreparedClaim {
  readonly record: {
    readonly id: string
    readonly shipmentId: string
    readonly status: ShipmentStorageStatus
    readonly originSalesOrderId: string
    readonly originAllocations: Prisma.JsonValue
    readonly costSnapshot: Prisma.JsonValue
    readonly shipmentNoSnapshot: string | null
  }
  readonly order: {
    readonly id: string
    readonly orderNo: string
    readonly issuerUserId: string
  }
  readonly allocations: readonly PreparedClaimAllocation[]
  readonly claimedQuantity: number
}

interface StorageInitialLocation {
  readonly locationScope: ShipmentStorageLocationScope
  readonly warehouseValue: string
  readonly warehouseLabel: string | null
}

function emptyLineSummary(): ShipmentStorageLineSummaryDto {
  return { lineCount: 0, totalQuantity: 0, previews: [] }
}

/**
 * 寄仓记录只保存当前位置，释放时的初始位置留在释放审计里。
 * 位置历史需要完整展示「从哪到哪」，因此从审计元数据恢复首条事件的起点。
 */
function readReleasedLocation(metadata: Prisma.JsonValue): {
  readonly storageRecordId: string
  readonly locationScope: ShipmentStorageLocationScope
  readonly warehouseValue: string
} | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }
  const value = metadata as Record<string, unknown>
  const storageRecordId = value.storageRecordId
  const locationScope = value.locationScope
  const warehouseValue = value.warehouseValue
  if (
    typeof storageRecordId !== 'string'
    || (locationScope !== 'MAINLAND' && locationScope !== 'OVERSEAS')
    || typeof warehouseValue !== 'string'
    || warehouseValue.length === 0
  ) {
    return null
  }
  return { storageRecordId, locationScope, warehouseValue }
}

function baseRecordDto(
  row: StorageRecordRow,
  persons: StoragePersonContext,
  lineSummary: ShipmentStorageLineSummaryDto,
  containerMarks: readonly string[],
): ShipmentStorageListItemDto {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    status: row.status,
    locationScope: row.locationScope,
    warehouseValue: row.warehouseValue,
    warehouseLabel: row.warehouseLabelSnapshot,
    shipmentNo: row.shipmentNoSnapshot,
    shippingMarkText: row.shippingMarkSnapshot,
    containerMarks,
    lineSummary,
    originPurchaseOrderNo: row.originPurchaseOrderNoSnapshot,
    originPurchaseCreator: persons.purchaseCreatorById.get(row.originPurchaseOrderId) ?? null,
    originSalesOrderNo: row.originSalesOrderNoSnapshot,
    originIssuer: persons.issuerById.get(row.originIssuerUserId) ?? null,
    originCustomerName: row.originCustomerNameSnapshot,
    originSalesOrderId: row.originSalesOrderId,
    originIssuerUserId: row.originIssuerUserId,
    cost: costFromSnapshot(row.costSnapshot),
    claimRequest: persons.claimRequestByStorageId.get(row.id) ?? null,
    snapshotAt: row.snapshotAt.toISOString(),
    locationUpdatedAt: row.locationUpdatedAt.toISOString(),
    claimedAt: row.claimedAt?.toISOString() ?? null,
    claimedSalesOrderId: row.claimedSalesOrderId,
    createdAt: row.createdAt.toISOString(),
  }
}

function parseBatchIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

function readClaimAllocationSnapshots(value: Prisma.JsonValue): ClaimAllocationSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (
      typeof record.salesOrderLineId !== 'string'
      || typeof record.lineNumber !== 'number'
      || typeof record.productName !== 'string'
      || typeof record.quantity !== 'number'
      || record.quantity <= 0
    ) {
      return []
    }
    const productMatchMode = record.productMatchMode === 'MANUAL_OVERRIDE'
      ? 'MANUAL_OVERRIDE'
      : record.productMatchMode === 'AUTO' ? 'AUTO' : 'UNKNOWN'
    return [{
      purchaseOrderLineId: typeof record.purchaseOrderLineId === 'string'
        ? record.purchaseOrderLineId
        : null,
      salesOrderLineId: record.salesOrderLineId,
      lineNumber: record.lineNumber,
      productName: record.productName,
      productDescription: typeof record.productDescription === 'string'
        ? record.productDescription
        : null,
      sourceProductName: typeof record.sourceProductName === 'string'
        ? record.sourceProductName
        : null,
      sourceProductDescription: typeof record.sourceProductDescription === 'string'
        ? record.sourceProductDescription
        : null,
      sourceSalesProductName: typeof record.sourceSalesProductName === 'string'
        ? record.sourceSalesProductName
        : null,
      quantity: record.quantity,
      productMatchMode,
      productMatchNote: typeof record.productMatchNote === 'string'
        ? record.productMatchNote
        : null,
    }]
  })
}

function readContainerChangeSnapshots(
  value: Prisma.JsonValue,
): ShipmentStorageClaimContainerChangeDto[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) return null
  const changes: ShipmentStorageClaimContainerChangeDto[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
    const record = entry as Record<string, unknown>
    if (
      typeof record.loadingItemId !== 'string'
      || typeof record.containerBatchId !== 'string'
      || typeof record.containerBatchName !== 'string'
      || typeof record.lineNumber !== 'number'
      || typeof record.expectedVersion !== 'number'
      || typeof record.afterRecipientName !== 'string'
      || typeof record.afterRecipientPhone !== 'string'
      || typeof record.afterRecipientAddress !== 'string'
      || typeof record.recipientChanged !== 'boolean'
      || typeof record.codChanged !== 'boolean'
      || (record.oceanShippingMarkText !== null && typeof record.oceanShippingMarkText !== 'string')
      || (record.beforeRecipientName !== null && typeof record.beforeRecipientName !== 'string')
      || (record.beforeRecipientPhone !== null && typeof record.beforeRecipientPhone !== 'string')
      || (record.beforeRecipientAddress !== null && typeof record.beforeRecipientAddress !== 'string')
      || (record.beforeCodAmountTwd !== null && typeof record.beforeCodAmountTwd !== 'string')
      || (record.afterCodAmountTwd !== null && typeof record.afterCodAmountTwd !== 'string')
    ) {
      return null
    }
    changes.push({
      loadingItemId: record.loadingItemId,
      containerBatchId: record.containerBatchId,
      containerBatchName: record.containerBatchName,
      lineNumber: record.lineNumber,
      oceanShippingMarkText: record.oceanShippingMarkText,
      expectedVersion: record.expectedVersion,
      beforeRecipientName: record.beforeRecipientName,
      beforeRecipientPhone: record.beforeRecipientPhone,
      beforeRecipientAddress: record.beforeRecipientAddress,
      beforeCodAmountTwd: record.beforeCodAmountTwd,
      afterRecipientName: record.afterRecipientName,
      afterRecipientPhone: record.afterRecipientPhone,
      afterRecipientAddress: record.afterRecipientAddress,
      afterCodAmountTwd: record.afterCodAmountTwd,
      recipientChanged: record.recipientChanged,
      codChanged: record.codChanged,
    })
  }
  return changes
}

function containerChangeInputsFromSnapshots(
  changes: readonly ShipmentStorageClaimContainerChangeDto[],
): ClaimShipmentStorageContainerChangeDto[] {
  return changes.map((change) => {
    const codTouched = change.beforeCodAmountTwd !== change.afterCodAmountTwd
    return {
      loadingItemId: change.loadingItemId,
      expectedVersion: change.expectedVersion,
      recipientName: change.afterRecipientName,
      recipientPhone: change.afterRecipientPhone,
      recipientAddress: change.afterRecipientAddress,
      codTouched,
      ...(codTouched ? { codAmountTwd: change.afterCodAmountTwd } : {}),
    }
  })
}

function claimRequestLineInputs(
  allocations: readonly ClaimAllocationSnapshot[],
): ClaimShipmentStorageRequestDto['lines'] {
  return allocations.map(allocation => ({
    purchaseOrderLineId: allocation.purchaseOrderLineId as string,
    salesOrderLineId: allocation.salesOrderLineId,
    quantity: allocation.quantity,
    ...(allocation.productMatchMode === 'MANUAL_OVERRIDE'
      ? { productMatchOverride: true, productMatchNote: allocation.productMatchNote ?? undefined }
      : {}),
  }))
}

function claimProductOverrideAudit(
  allocations: readonly Pick<PreparedClaimAllocation, 'productMatchMode' | 'productMatchNote'>[],
): { productMatchOverrideCount?: number, productMatchOverrideNote?: string } {
  const overrides = allocations.filter(allocation => allocation.productMatchMode === 'MANUAL_OVERRIDE')
  if (overrides.length === 0) return {}
  const notes = [...new Set(overrides.flatMap(allocation => (
    allocation.productMatchNote === null ? [] : [allocation.productMatchNote]
  )))]
  return {
    productMatchOverrideCount: overrides.length,
    ...(notes.length === 0
      ? {}
      : { productMatchOverrideNote: notes.join(' | ').slice(0, 500) }),
  }
}

function detailDto(
  row: StorageRecordRow,
  costTransfers: readonly ShipmentStorageCostTransferDto[],
  persons: StoragePersonContext,
  initialLocation: StorageInitialLocation | null,
  lineSummary: ShipmentStorageLineSummaryDto,
  containerItems: readonly ShipmentStorageContainerItemDto[],
): ShipmentStorageDetailDto {
  let previousLocation = initialLocation
  const containerMarks = containerMarksFromItems(containerItems)
  return {
    ...baseRecordDto(row, persons, lineSummary, containerMarks),
    originAllocations: Array.isArray(row.originAllocations)
      ? row.originAllocations
      : [],
    containerSnapshot: row.containerSnapshot ?? null,
    containerLoadingItems: containerItems,
    costTransfers,
    locationEvents: row.locationEvents.map(event => {
      const locationEvent = {
        sequence: event.sequence,
        fromLocationScope: previousLocation?.locationScope ?? null,
        fromWarehouseValue: previousLocation?.warehouseValue ?? null,
        fromWarehouseLabel: previousLocation?.warehouseLabel ?? null,
        locationScope: event.locationScope,
        warehouseValue: event.warehouseValue,
        warehouseLabel: event.warehouseLabelSnapshot,
        reason: event.reason,
        occurredAt: event.occurredAt.toISOString(),
      }
      previousLocation = {
        locationScope: event.locationScope,
        warehouseValue: event.warehouseValue,
        warehouseLabel: event.warehouseLabelSnapshot,
      }
      return locationEvent
    }),
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
    return this.finalizeRelease(await this.withCostTransfers(records), context)
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
    const [persons, productSummaries, containerItemsByRecord] = await Promise.all([
      this.loadPersonContext(rows),
      this.loadProductSummaries(rows),
      this.loadContainerItems(rows),
    ])
    return {
      items: rows.map((row) => {
        const containerItems = containerItemsByRecord.get(row.id) ?? []
        return baseRecordDto(
          row,
          persons,
          productSummaries.get(row.id) ?? emptyLineSummary(),
          containerMarksFromItems(containerItems),
        )
      }),
      page,
      pageSize,
      total,
    }
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
    const [detail] = await this.withCostTransfers([row])
    return detail
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
    claimRequestId?: string,
  ): Promise<ShipmentStorageDetailDto> {
    let appliedContainerChanges: ShipmentStorageClaimContainerChangeDto[] = []
    try {
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
      if (claimRequestId === undefined) {
        const pendingRequest = await transaction.shipmentStorageClaimRequest.findFirst({
          where: { storageRecordId, status: 'PENDING' },
          select: { id: true },
        })
        if (pendingRequest !== null) {
          storageFailure(
            'SHIPMENT_STORAGE_CLAIM_REQUEST_PENDING',
            '存在进行中的调货申请，请先审核或由申请人撤回',
            HttpStatus.CONFLICT,
          )
        }
      }
      else {
        const claimRequest = await transaction.shipmentStorageClaimRequest.findFirst({
          where: { id: claimRequestId, storageRecordId, status: 'PENDING' },
          select: { id: true, salesOrderId: true },
        })
        if (claimRequest === null) {
          storageFailure(
            'SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED',
            '调货申请已变化，请刷新后重试',
            HttpStatus.CONFLICT,
          )
        }
        if (claimRequest.salesOrderId !== input.salesOrderId) {
          storageFailure(
            'SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED',
            '调货申请的目标销售订单已变化，请刷新后重试',
            HttpStatus.CONFLICT,
          )
        }
      }
      const prepared = await this.prepareClaimTarget(transaction, record, input)
      const { allocations, claimedQuantity, order } = prepared
      const preparedContainerChanges = await this.prepareContainerChanges(
        transaction,
        record,
        input.containerChanges,
        true,
      )
      const now = new Date()
      await this.applyContainerChanges(
        transaction,
        storageRecordId,
        preparedContainerChanges,
        context,
        claimRequestId,
      )
      appliedContainerChanges = preparedContainerChanges.filter(change => (
        change.recipientChanged || change.codChanged
      ))
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
        data: allocations.map(allocation => ({
          storageRecordId,
          purchaseOrderLineId: allocation.purchaseOrderLineId,
          salesOrderLineId: allocation.salesOrderLineId,
          quantity: allocation.quantity,
          productMatchMode: allocation.productMatchMode,
          productMatchNote: allocation.productMatchNote,
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
          allocationCount: allocations.length,
          containerChangeCount: appliedContainerChanges.length,
          ...claimProductOverrideAudit(allocations),
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
      // 出单人资金账户比例已在 prepareClaimTarget 内校验。
      await this.cost.transfer(transaction, context, 'CLAIM', {
        amountCny: totalCostFromSnapshot(record.costSnapshot),
        shipmentId: record.shipmentId,
        shipmentNo: record.shipmentNoSnapshot,
        storageRecordId,
        userId: order.issuerUserId,
      })
      if (claimRequestId !== undefined) {
        await transaction.shipmentStorageClaimRequest.update({
          where: { id: claimRequestId },
          data: {
            status: 'APPROVED',
            reviewedByUserId: context.actorUserId,
            reviewedAt: new Date(),
          },
        })
      }
    }, { timeout: 30_000 })
    }
    catch (error) {
      if (
        claimRequestId !== undefined
        && error instanceof ApiException
        && error.getStatus() < 500
      ) {
        await this.rejectClaimRequestAfterRecheck(
          context,
          storageRecordId,
          claimRequestId,
          error.publicMessage,
        )
      }
      throw error
    }
    const detail = await this.getById(storageRecordId)
    return { ...detail, containerChanges: appliedContainerChanges }
  }

  private async prepareClaimTarget(
    transaction: Prisma.TransactionClient,
    record: PreparedClaim['record'],
    input: ClaimShipmentStorageRequestDto,
    applicantUserId?: string,
  ): Promise<Pick<PreparedClaim, 'order' | 'allocations' | 'claimedQuantity'>> {
    const order = await transaction.salesOrder.findUnique({
      where: { id: input.salesOrderId },
      select: {
        id: true,
        orderNo: true,
        orderStatus: true,
        fulfillmentStatus: true,
        issuerUserId: true,
      },
    })
    if (order === null) {
      storageFailure('SALES_ORDER_NOT_FOUND', '目标销售订单不存在', HttpStatus.NOT_FOUND)
    }
    if (order.orderStatus !== 'CONFIRMED') {
      storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '只有已确认的销售订单可以认领寄仓货件')
    }
    if (order.fulfillmentStatus !== 'PENDING') {
      storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '只有待采购的销售订单可以认领寄仓货件')
    }
    if (input.salesOrderId === record.originSalesOrderId) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '不能把货件认领回原销售订单')
    }
    if (applicantUserId !== undefined && order.issuerUserId !== applicantUserId) {
      storageFailure(
        'SHIPMENT_STORAGE_CLAIM_REQUEST_SALES_ORDER_FORBIDDEN',
        '只能选择本人负责的销售订单',
        HttpStatus.FORBIDDEN,
      )
    }

    const requestedPairs = new Set<string>()
    for (const claimed of input.lines) {
      const pair = `${claimed.purchaseOrderLineId}:${claimed.salesOrderLineId}`
      if (requestedPairs.has(pair)) {
        storageFailure('VALIDATION_FAILED', '同一库存分配行与销售行的认领明细不能重复')
      }
      requestedPairs.add(pair)
    }

    const requestedLineIds = [...new Set(input.lines.map(line => line.salesOrderLineId))]
    const lines = await transaction.salesOrderLine.findMany({
      where: {
        id: { in: requestedLineIds },
        salesOrderId: input.salesOrderId,
        removedAt: null,
      },
      select: {
        id: true,
        lineNumber: true,
        lineType: true,
        productId: true,
        quantity: true,
        productNameSnapshot: true,
        descriptionSnapshot: true,
      },
    })
    if (lines.length !== requestedLineIds.length) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '目标销售明细行不存在或已移除')
    }
    const lineById = new Map(lines.map(line => [line.id, line]))

    const allocationQuantityById = new Map<string, number>()
    const allocationNameById = new Map<string, string>()
    const sourceAllocations = readShipmentStorageAllocations(record.originAllocations)
    if (
      !Array.isArray(record.originAllocations)
      || sourceAllocations.length !== record.originAllocations.length
    ) {
      storageFailure(
        'SHIPMENT_STORAGE_CLAIM_ALLOCATION_INVALID',
        '寄仓货件库存分配数据不完整，无法认领',
      )
    }
    for (const allocation of sourceAllocations) {
      allocationQuantityById.set(
        allocation.lineId,
        (allocationQuantityById.get(allocation.lineId) ?? 0) + allocation.quantity,
      )
      if (allocation.productName !== null) {
        allocationNameById.set(allocation.lineId, allocation.productName)
      }
    }
    if (allocationQuantityById.size === 0) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_ALLOCATION_INVALID', '寄仓货件缺少可认领的库存分配行')
    }

    const sourceIds = [...new Set(input.lines.map(line => line.purchaseOrderLineId))]
    const sourceLines = await transaction.purchaseOrderLine.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        lineNumber: true,
        lineType: true,
        productId: true,
        productNameSnapshot: true,
        descriptionSnapshot: true,
        sourceSalesOrderLine: { select: { productNameSnapshot: true } },
      },
    })
    if (sourceLines.length !== sourceIds.length) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_ALLOCATION_INVALID', '库存分配行不存在或已被移除')
    }
    const sourceById = new Map(sourceLines.map(line => [line.id, line]))

    const quantityBySource = new Map<string, number>()
    const quantityByTargetLine = new Map<string, number>()
    for (const claimed of input.lines) {
      if (!allocationQuantityById.has(claimed.purchaseOrderLineId)) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_ALLOCATION_INVALID', '库存分配行不属于该寄仓货件')
      }
      quantityBySource.set(
        claimed.purchaseOrderLineId,
        (quantityBySource.get(claimed.purchaseOrderLineId) ?? 0) + claimed.quantity,
      )
      quantityByTargetLine.set(
        claimed.salesOrderLineId,
        (quantityByTargetLine.get(claimed.salesOrderLineId) ?? 0) + claimed.quantity,
      )
    }
    for (const [sourceId, allocationQuantity] of allocationQuantityById) {
      if ((quantityBySource.get(sourceId) ?? 0) !== allocationQuantity) {
        storageFailure(
          'SHIPMENT_STORAGE_CLAIM_ALLOCATION_QUANTITY_MISMATCH',
          '每条库存分配行必须按原数量完整认领',
        )
      }
    }
    const shipmentQuantity = [...allocationQuantityById.values()]
      .reduce((sum, quantity) => sum + quantity, 0)
    const claimedQuantity = input.lines.reduce((sum, line) => sum + line.quantity, 0)
    if (shipmentQuantity <= 0 || claimedQuantity !== shipmentQuantity) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '寄仓货件必须整件认领')
    }
    for (const [targetLineId, quantity] of quantityByTargetLine) {
      const line = lineById.get(targetLineId)
      if (line === undefined || quantity > line.quantity) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', '认领数量超过目标销售行数量')
      }
    }

    const salesLineIds = lines.map(line => line.id)
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id" FROM "sales_order_lines"
      WHERE "id" IN (${Prisma.join(salesLineIds)})
      ORDER BY "id" FOR UPDATE
    `)
    const purchasedRows = await transaction.purchaseOrderLine.groupBy({
      by: ['sourceSalesOrderLineId'],
      where: {
        sourceSalesOrderLineId: { in: salesLineIds },
        purchaseOrder: {
          orderStatus: { not: 'CANCELLED' },
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
    const existingClaims = await readClaimedQuantitiesBySalesLine(
      transaction,
      input.salesOrderId,
      salesLineIds,
    )
    for (const [targetLineId, quantity] of quantityByTargetLine) {
      const line = lineById.get(targetLineId)
      const remaining = (line?.quantity ?? 0)
        - (purchasedBySource.get(targetLineId) ?? 0)
        - (existingClaims.get(targetLineId) ?? 0)
      if (quantity > remaining) {
        storageFailure(
          'SHIPMENT_STORAGE_CLAIM_EXCEEDS_COVERAGE',
          `销售明细第${line?.lineNumber ?? '—'}行剩余可认领数量不足（已扣除采购预占与已有认领）`,
        )
      }
    }

    const allocations: PreparedClaimAllocation[] = input.lines.map((claimed) => {
      const source = sourceById.get(claimed.purchaseOrderLineId)
      const target = lineById.get(claimed.salesOrderLineId)
      if (source === undefined || target === undefined) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_ALLOCATION_INVALID', '库存分配行或销售行不存在')
      }
      if (source.lineType !== target.lineType) {
        storageFailure(
          'SHIPMENT_STORAGE_CLAIM_PRODUCT_MISMATCH',
          `库存产品“${source.productNameSnapshot}”与销售明细第${target.lineNumber}行产品类型不一致，不能认领`,
        )
      }
      if (source.lineType === 'CATALOG') {
        if (source.productId === null || source.productId !== target.productId) {
          storageFailure(
            'SHIPMENT_STORAGE_CLAIM_PRODUCT_MISMATCH',
            `库存产品“${source.productNameSnapshot}”与销售明细第${target.lineNumber}行产品不一致，不能认领`,
          )
        }
        return {
          purchaseOrderLineId: source.id,
          salesOrderLineId: target.id,
          lineNumber: target.lineNumber,
          productName: target.productNameSnapshot,
          productDescription: target.descriptionSnapshot,
          sourceProductName: source.productNameSnapshot,
          sourceProductDescription: source.descriptionSnapshot,
          sourceSalesProductName: source.sourceSalesOrderLine?.productNameSnapshot ?? null,
          quantity: claimed.quantity,
          productMatchMode: 'AUTO',
          productMatchNote: null,
        }
      }
      const aliases = claimProductAliases([
        source.productNameSnapshot,
        allocationNameById.get(claimed.purchaseOrderLineId),
        source.sourceSalesOrderLine?.productNameSnapshot,
      ])
      if (aliases.includes(normalizeClaimProductName(target.productNameSnapshot))) {
        return {
          purchaseOrderLineId: source.id,
          salesOrderLineId: target.id,
          lineNumber: target.lineNumber,
          productName: target.productNameSnapshot,
          productDescription: target.descriptionSnapshot,
          sourceProductName: source.productNameSnapshot,
          sourceProductDescription: source.descriptionSnapshot,
          sourceSalesProductName: source.sourceSalesOrderLine?.productNameSnapshot ?? null,
          quantity: claimed.quantity,
          productMatchMode: 'AUTO',
          productMatchNote: null,
        }
      }
      if (claimed.productMatchOverride !== true) {
        storageFailure(
          'SHIPMENT_STORAGE_CLAIM_PRODUCT_MISMATCH',
          `库存产品“${source.productNameSnapshot}”与销售明细第${target.lineNumber}行产品不一致；如确认是同一产品，请勾选人工确认并填写原因`,
        )
      }
      const note = claimed.productMatchNote?.trim() ?? ''
      if (note === '') {
        storageFailure(
          'SHIPMENT_STORAGE_CLAIM_PRODUCT_OVERRIDE_REASON_REQUIRED',
          '跨产品认领必须填写人工确认原因',
        )
      }
      return {
        purchaseOrderLineId: source.id,
        salesOrderLineId: target.id,
        lineNumber: target.lineNumber,
        productName: target.productNameSnapshot,
        productDescription: target.descriptionSnapshot,
        sourceProductName: source.productNameSnapshot,
        sourceProductDescription: source.descriptionSnapshot,
        sourceSalesProductName: source.sourceSalesOrderLine?.productNameSnapshot ?? null,
        quantity: claimed.quantity,
        productMatchMode: 'MANUAL_OVERRIDE',
        productMatchNote: note.slice(0, 500),
      }
    })

    const issuerAccount = await transaction.fundAccount.findUnique({
      where: { userId: order.issuerUserId },
      select: { userShareRate: true },
    })
    if (
      issuerAccount === null
      || issuerAccount === undefined
      || issuerAccount.userShareRate === null
    ) {
      storageFailure('SHIPMENT_STORAGE_SHARE_RATE_MISSING', '新出单人缺少资金账户比例，无法转移成本')
    }
    return { order, allocations, claimedQuantity }
  }

  /** 装柜明细快照与更新共用同一套字段归一化；申请时只快照，认领时加锁后真正写入。 */
  private async prepareContainerChanges(
    transaction: Prisma.TransactionClient,
    record: PreparedClaim['record'],
    inputChanges: readonly ClaimShipmentStorageContainerChangeDto[] | undefined,
    lock: boolean,
  ): Promise<ShipmentStorageClaimContainerChangeDto[]> {
    const items = await this.loadClaimContainerItems(transaction, record.shipmentId, lock)
    if (inputChanges !== undefined && !Array.isArray(inputChanges)) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '装柜修改信息格式无效')
    }
    const changes = inputChanges ?? []
    if (items.length === 0) {
      if (changes.length > 0) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '该货件没有装柜明细，不能提交装柜修改')
      }
      return []
    }
    if (changes.length !== items.length) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '必须为每条装柜明细提交完整信息')
    }
    const inputById = new Map<string, ClaimShipmentStorageContainerChangeDto>()
    for (const change of changes) {
      const raw: unknown = change
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '装柜修改信息格式无效')
      }
      const value = raw as Record<string, unknown>
      if (
        typeof value.loadingItemId !== 'string'
        || !Number.isInteger(value.expectedVersion)
        || (value.expectedVersion as number) < 1
        || typeof value.recipientName !== 'string'
        || typeof value.recipientPhone !== 'string'
        || typeof value.recipientAddress !== 'string'
        || (value.codTouched !== undefined && typeof value.codTouched !== 'boolean')
        || (value.codAmountTwd !== undefined && value.codAmountTwd !== null && typeof value.codAmountTwd !== 'string')
      ) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '装柜修改信息格式无效')
      }
      if (inputById.has(value.loadingItemId)) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '装柜明细不能重复提交')
      }
      inputById.set(value.loadingItemId, change)
    }
    return items.map((item) => {
      const change = inputById.get(item.id)
      if (change === undefined) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '装柜明细已变化，请刷新后重新提交')
      }
      if (change.expectedVersion !== item.version) {
        storageFailure(
          'SHIPMENT_STORAGE_CLAIM_CONTAINER_VERSION_CHANGED',
          '装柜明细已更新，请刷新后重新提交',
          HttpStatus.CONFLICT,
        )
      }
      const afterRecipientName = this.normalizeClaimRecipientText(change.recipientName, 128, '收件人姓名')
      const afterRecipientPhone = this.normalizeClaimRecipientText(change.recipientPhone, 128, '收件人电话')
      const afterRecipientAddress = this.normalizeClaimRecipientText(change.recipientAddress, 2000, '收件人地址')
      const beforeCodAmountTwd = item.codAmountTwd?.toFixed(2) ?? null
      const afterCodAmountTwd = change.codTouched === true
        ? this.normalizeClaimCod(change.codAmountTwd)
        : beforeCodAmountTwd
      return {
        loadingItemId: item.id,
        containerBatchId: item.containerBatchId,
        containerBatchName: item.containerBatch.containerBatchName,
        lineNumber: item.lineNumber,
        oceanShippingMarkText: item.oceanShippingMarkText,
        expectedVersion: item.version,
        beforeRecipientName: item.recipientName,
        beforeRecipientPhone: item.recipientPhone,
        beforeRecipientAddress: item.recipientAddress,
        beforeCodAmountTwd,
        afterRecipientName,
        afterRecipientPhone,
        afterRecipientAddress,
        afterCodAmountTwd,
        recipientChanged: item.recipientName !== afterRecipientName
          || item.recipientPhone !== afterRecipientPhone
          || item.recipientAddress !== afterRecipientAddress,
        codChanged: beforeCodAmountTwd !== afterCodAmountTwd,
      }
    })
  }

  private async loadClaimContainerItems(
    transaction: Prisma.TransactionClient,
    shipmentId: string,
    lock: boolean,
  ): Promise<ContainerItemRow[]> {
    if (lock) {
      const references = await transaction.containerLoadingItem.findMany({
        where: { shipmentId },
        select: { id: true, containerBatchId: true },
      })
      if (references.length > 0) {
        const batchIds = [...new Set(references.map(item => item.containerBatchId))].sort()
        await transaction.$queryRaw(Prisma.sql`
          SELECT id FROM container_batches
          WHERE id IN (${Prisma.join(batchIds)})
          ORDER BY id FOR UPDATE
        `)
        await transaction.$queryRaw(Prisma.sql`
          SELECT id FROM container_loading_items
          WHERE shipment_id = ${shipmentId}::uuid
          ORDER BY id FOR UPDATE
        `)
      }
    }
    return transaction.containerLoadingItem.findMany({
      where: { shipmentId },
      select: CONTAINER_ITEM_SELECT,
      orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
    })
  }

  private normalizeClaimRecipientText(value: string, maximum: number, label: string): string {
    if (/[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/gu, ''))) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_RECIPIENT_REQUIRED', `${label}格式无效`)
    }
    const normalized = value.trim().replace(/\r\n?/gu, '\n')
    if (normalized === '') {
      storageFailure('SHIPMENT_STORAGE_CLAIM_RECIPIENT_REQUIRED', `${label}不能为空`)
    }
    if ([...normalized].length > maximum) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_RECIPIENT_REQUIRED', `${label}长度超出限制`)
    }
    return normalized
  }

  /** COD 的 0 与空值统一视为“本行不涉及代收”；只有主动编辑才写入 null。 */
  private normalizeClaimCod(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value.trim() === '') {
      return null
    }
    try {
      const normalized = normalizeOceanDecimal(value, 30, 2, 'codAmountTwd')
      return normalized === null || normalized === '0.00' ? null : normalized
    }
    catch (error) {
      if (error instanceof OceanCalculationError) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_COD_INVALID', '代收金额须为非负金额，最多 28 位整数和 2 位小数')
      }
      throw error
    }
  }

  private async applyContainerChanges(
    transaction: Prisma.TransactionClient,
    storageRecordId: string,
    changes: readonly ShipmentStorageClaimContainerChangeDto[],
    context: ShipmentStorageMutationContext,
    claimRequestId?: string,
  ): Promise<void> {
    const changedItems = changes.filter(change => change.recipientChanged || change.codChanged)
    if (changedItems.length === 0) return
    const rows = await transaction.containerLoadingItem.findMany({
      where: { id: { in: changedItems.map(change => change.loadingItemId) } },
      select: {
        id: true,
        containerBatchId: true,
        version: true,
        recipientName: true,
        recipientPhone: true,
        recipientAddress: true,
        codAmountTwd: true,
        remark: true,
      },
    })
    const rowById = new Map(rows.map(row => [row.id, row]))
    for (const change of changedItems) {
      const row = rowById.get(change.loadingItemId)
      if (row === undefined) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_CONTAINER_CHANGE_INVALID', '装柜明细不存在或已解绑', HttpStatus.CONFLICT)
      }
      let currentVersion = row.version
      if (change.recipientChanged) {
        const updated = await transaction.containerLoadingItem.update({
          where: { id: row.id },
          data: {
            recipientName: change.afterRecipientName,
            recipientPhone: change.afterRecipientPhone,
            recipientAddress: change.afterRecipientAddress,
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
          select: { version: true },
        })
        await this.recordClaimContainerChange(transaction, {
          change,
          kind: 'RECIPIENT',
          containerBatchId: row.containerBatchId,
          previousVersion: currentVersion,
          version: updated.version,
          beforeData: {
            recipientName: row.recipientName,
            recipientPhone: row.recipientPhone,
            recipientAddress: row.recipientAddress,
            remark: row.remark,
          },
          afterData: {
            recipientName: change.afterRecipientName,
            recipientPhone: change.afterRecipientPhone,
            recipientAddress: change.afterRecipientAddress,
            remark: row.remark,
          },
          storageRecordId,
          claimRequestId,
          context,
        })
        currentVersion = updated.version
      }
      if (change.codChanged) {
        const updated = await transaction.containerLoadingItem.update({
          where: { id: row.id },
          data: {
            codAmountTwd: change.afterCodAmountTwd === null
              ? null
              : new Prisma.Decimal(change.afterCodAmountTwd),
            version: { increment: 1 },
            updatedById: context.actorUserId,
          },
          select: { version: true },
        })
        await this.recordClaimContainerChange(transaction, {
          change,
          kind: 'COD',
          containerBatchId: row.containerBatchId,
          previousVersion: currentVersion,
          version: updated.version,
          beforeData: { codAmountTwd: change.beforeCodAmountTwd },
          afterData: { codAmountTwd: change.afterCodAmountTwd },
          storageRecordId,
          claimRequestId,
          context,
        })
        currentVersion = updated.version
      }
      await transaction.containerBatch.update({
        where: { id: row.containerBatchId },
        data: { version: { increment: 1 }, updatedById: context.actorUserId },
      })
    }
  }

  private async recordClaimContainerChange(
    transaction: Prisma.TransactionClient,
    input: {
      readonly change: ShipmentStorageClaimContainerChangeDto
      readonly kind: 'RECIPIENT' | 'COD'
      readonly containerBatchId: string
      readonly previousVersion: number
      readonly version: number
      readonly beforeData: Record<string, string | null>
      readonly afterData: Record<string, string | null>
      readonly storageRecordId: string
      readonly claimRequestId?: string
      readonly context: ShipmentStorageMutationContext
    },
  ): Promise<void> {
    const requestKey = randomUUID()
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({
        format: 'shipment-storage.claim.container-change.v1',
        storageRecordId: input.storageRecordId,
        loadingItemId: input.change.loadingItemId,
        kind: input.kind,
        beforeData: input.beforeData,
        afterData: input.afterData,
      }), 'utf8')
      .digest('hex')
    const record = await transaction.containerLoadingItemChange.create({
      data: {
        loadingItemId: input.change.loadingItemId,
        kind: input.kind,
        beforeData: input.beforeData,
        afterData: input.afterData,
        previousVersion: input.previousVersion,
        version: input.version,
        requestKey,
        payloadHash,
        actorUserId: input.context.actorUserId,
      },
      select: { id: true },
    })
    await this.audit.record(transaction, {
      eventType: 'CONTAINER_LOADING_ITEM_UPDATED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.context.actorUserId,
      requestId: input.context.requestId,
      targetType: 'CONTAINER_LOADING_ITEM',
      targetId: input.change.loadingItemId,
      metadata: {
        containerBatchId: input.containerBatchId,
        kind: input.kind,
        previousVersion: input.previousVersion,
        version: input.version,
        changeId: record.id,
        storageRecordId: input.storageRecordId,
        ...(input.claimRequestId === undefined ? {} : { claimRequestId: input.claimRequestId }),
      },
    })
  }

  async getClaimRequest(
    storageRecordId: string,
    requestId: string,
  ): Promise<ShipmentStorageClaimRequestDto> {
    return this.loadClaimRequestDto(storageRecordId, requestId)
  }

  async createClaimRequest(
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    input: ClaimShipmentStorageRequestDto,
  ): Promise<ShipmentStorageClaimRequestDto> {
    try {
      const request = await this.prisma.$transaction(async (transaction) => {
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
            costSnapshot: true,
            shipmentNoSnapshot: true,
          },
        })
        if (record === null) {
          storageFailure('SHIPMENT_STORAGE_NOT_FOUND', '寄仓记录不存在', HttpStatus.NOT_FOUND)
        }
        if (record.status !== 'IN_STORAGE') {
          storageFailure('SHIPMENT_STORAGE_STATE_CHANGED', '只有寄仓中的记录可以申请调货', HttpStatus.CONFLICT)
        }
        const ownership = await transaction.shipmentOwnershipCurrent.findUnique({
          where: { shipmentId: record.shipmentId },
          select: { ownerType: true, state: true },
        })
        if (ownership?.ownerType !== 'STORAGE_POOL' || ownership.state !== 'ACTIVE') {
          storageFailure('SHIPMENT_STORAGE_STATE_CHANGED', '货件归属已变化，请刷新后重试', HttpStatus.CONFLICT)
        }
        const pendingRequest = await transaction.shipmentStorageClaimRequest.findFirst({
          where: { storageRecordId, status: 'PENDING' },
          select: { id: true },
        })
        if (pendingRequest !== null) {
          storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_EXISTS', '该货件已有进行中的调货申请', HttpStatus.CONFLICT)
        }
        const prepared = await this.prepareClaimTarget(transaction, record, input, context.actorUserId)
        const preparedContainerChanges = await this.prepareContainerChanges(
          transaction,
          record,
          input.containerChanges,
          false,
        )
        const allocations: ClaimAllocationSnapshot[] = prepared.allocations.map(allocation => ({
          purchaseOrderLineId: allocation.purchaseOrderLineId,
          salesOrderLineId: allocation.salesOrderLineId,
          lineNumber: allocation.lineNumber,
          productName: allocation.productName,
          productDescription: allocation.productDescription,
          sourceProductName: allocation.sourceProductName,
          sourceProductDescription: allocation.sourceProductDescription,
          sourceSalesProductName: allocation.sourceSalesProductName,
          quantity: allocation.quantity,
          productMatchMode: allocation.productMatchMode,
          productMatchNote: allocation.productMatchNote,
        }))
        const created = await transaction.shipmentStorageClaimRequest.create({
          data: {
            storageRecordId,
            applicantUserId: context.actorUserId,
            salesOrderId: prepared.order.id,
            salesOrderNoSnapshot: prepared.order.orderNo,
            costTotalCny: totalCostFromSnapshot(record.costSnapshot),
            allocations: allocations as unknown as Prisma.InputJsonValue,
            containerChanges: preparedContainerChanges as unknown as Prisma.InputJsonValue,
            requestKey: input.requestKey,
          },
          select: { id: true },
        })
        await this.audit.record(transaction, {
          eventType: 'SHIPMENT_STORAGE_CLAIM_REQUESTED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'SHIPMENT_STORAGE_CLAIM_REQUEST',
          targetId: created.id,
          metadata: {
            storageRecordId,
            salesOrderId: prepared.order.id,
            salesOrderNo: prepared.order.orderNo,
            claimedQuantity: prepared.claimedQuantity,
            allocationCount: prepared.allocations.length,
            containerChangeCount: preparedContainerChanges.filter(change => (
              change.recipientChanged || change.codChanged
            )).length,
            ...claimProductOverrideAudit(prepared.allocations),
          },
        })
        return created
      }, { timeout: 30_000 })
      return this.loadClaimRequestDto(storageRecordId, request.id)
    }
    catch (error) {
      if (hasPersistenceCode(readPersistenceErrorFacts(error), 'P2002')) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_EXISTS', '该货件已有进行中的调货申请或重复提交', HttpStatus.CONFLICT)
      }
      throw error
    }
  }

  async withdrawClaimRequest(
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    requestId: string,
  ): Promise<ShipmentStorageClaimRequestDto> {
    await this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM shipment_storage_claim_requests WHERE id = ${requestId}::uuid FOR UPDATE`)
      const request = await transaction.shipmentStorageClaimRequest.findFirst({
        where: { id: requestId, storageRecordId },
        select: { id: true, status: true, applicantUserId: true },
      })
      if (request === null) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND', '调货申请不存在', HttpStatus.NOT_FOUND)
      }
      if (request.status !== 'PENDING') {
        storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED', '调货申请已处理，无法撤回', HttpStatus.CONFLICT)
      }
      if (request.applicantUserId !== context.actorUserId) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_FORBIDDEN', '只有申请人可以撤回调货申请', HttpStatus.FORBIDDEN)
      }
      const now = new Date()
      await transaction.shipmentStorageClaimRequest.update({
        where: { id: requestId },
        data: { status: 'WITHDRAWN', reviewedAt: now },
      })
      await this.audit.record(transaction, {
        eventType: 'SHIPMENT_STORAGE_CLAIM_REQUEST_WITHDRAWN',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'SHIPMENT_STORAGE_CLAIM_REQUEST',
        targetId: requestId,
        metadata: { storageRecordId },
      })
    }, { timeout: 30_000 })
    return this.loadClaimRequestDto(storageRecordId, requestId)
  }

  async rejectClaimRequest(
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    requestId: string,
    input: RejectShipmentStorageClaimRequestDto,
  ): Promise<ShipmentStorageClaimRequestDto> {
    const reason = input.reason.trim()
    if (reason === '') {
      storageFailure('VALIDATION_FAILED', '拒绝原因不能为空')
    }
    await this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM shipment_storage_claim_requests WHERE id = ${requestId}::uuid FOR UPDATE`)
      const request = await transaction.shipmentStorageClaimRequest.findFirst({
        where: { id: requestId, storageRecordId },
        select: { id: true, status: true },
      })
      if (request === null) {
        storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND', '调货申请不存在', HttpStatus.NOT_FOUND)
      }
      if (request.status !== 'PENDING') {
        storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED', '调货申请已处理', HttpStatus.CONFLICT)
      }
      await this.rejectClaimRequestRow(transaction, context, storageRecordId, requestId, reason)
    }, { timeout: 30_000 })
    return this.loadClaimRequestDto(storageRecordId, requestId)
  }

  async approveClaimRequest(
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    requestId: string,
  ): Promise<ShipmentStorageDetailDto> {
    const request = await this.prisma.shipmentStorageClaimRequest.findFirst({
      where: { id: requestId, storageRecordId },
      select: {
        id: true,
        status: true,
        salesOrderId: true,
        allocations: true,
        containerChanges: true,
        requestKey: true,
      },
    })
    if (request === null) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND', '调货申请不存在', HttpStatus.NOT_FOUND)
    }
    if (request.status === 'APPROVED') {
      const detail = await this.getById(storageRecordId)
      return {
        ...detail,
        containerChanges: readContainerChangeSnapshots(request.containerChanges) ?? [],
      }
    }
    if (request.status !== 'PENDING') {
      storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED', '调货申请已处理', HttpStatus.CONFLICT)
    }
    const allocations = readClaimAllocationSnapshots(request.allocations)
    if (allocations.length === 0) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED', '调货申请缺少认领明细', HttpStatus.CONFLICT)
    }
    if (allocations.some(allocation => allocation.purchaseOrderLineId === null)) {
      storageFailure(
        'SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED',
        '历史调货申请缺少库存分配映射，请撤回后重新提交',
        HttpStatus.CONFLICT,
      )
    }
    const containerChanges = readContainerChangeSnapshots(request.containerChanges)
    if (containerChanges === null) {
      storageFailure(
        'SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED',
        '历史调货申请缺少装柜修改快照，请撤回后重新提交',
        HttpStatus.CONFLICT,
      )
    }
    return this.claim(context, storageRecordId, {
      salesOrderId: request.salesOrderId,
      lines: claimRequestLineInputs(allocations),
      containerChanges: containerChangeInputsFromSnapshots(containerChanges),
      requestKey: request.requestKey,
    }, requestId)
  }

  private async rejectClaimRequestAfterRecheck(
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    requestId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.shipmentStorageClaimRequest.updateMany({
        where: { id: requestId, storageRecordId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          rejectReason: reason.slice(0, 500),
          reviewedByUserId: context.actorUserId,
          reviewedAt: new Date(),
        },
      })
      if (updated.count > 0) {
        await this.audit.record(transaction, {
          eventType: 'SHIPMENT_STORAGE_CLAIM_REQUEST_REJECTED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'SHIPMENT_STORAGE_CLAIM_REQUEST',
          targetId: requestId,
          metadata: { storageRecordId, reason: reason.slice(0, 500) },
        })
      }
    }, { timeout: 30_000 })
  }

  private async rejectClaimRequestRow(
    transaction: Prisma.TransactionClient,
    context: ShipmentStorageMutationContext,
    storageRecordId: string,
    requestId: string,
    reason: string,
  ): Promise<void> {
    await transaction.shipmentStorageClaimRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        rejectReason: reason.slice(0, 500),
        reviewedByUserId: context.actorUserId,
        reviewedAt: new Date(),
      },
    })
    await this.audit.record(transaction, {
      eventType: 'SHIPMENT_STORAGE_CLAIM_REQUEST_REJECTED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      targetType: 'SHIPMENT_STORAGE_CLAIM_REQUEST',
      targetId: requestId,
      metadata: { storageRecordId, reason: reason.slice(0, 500) },
    })
  }

  private async loadClaimRequestDto(
    storageRecordId: string,
    requestId: string,
  ): Promise<ShipmentStorageClaimRequestDto> {
    const request = await this.prisma.shipmentStorageClaimRequest.findFirst({
      where: { id: requestId, storageRecordId },
      select: {
        id: true,
        storageRecordId: true,
        applicantUserId: true,
        salesOrderId: true,
        salesOrderNoSnapshot: true,
        costTotalCny: true,
        allocations: true,
        containerChanges: true,
        status: true,
        rejectReason: true,
        reviewedByUserId: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (request === null) {
      storageFailure('SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND', '调货申请不存在', HttpStatus.NOT_FOUND)
    }
    const userIds = [...new Set([request.applicantUserId, request.reviewedByUserId].filter((id): id is string => id !== null))]
    const users = userIds.length === 0
      ? []
      : await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: PERSON_REFERENCE_SELECT,
        })
    const userById = new Map(users.map(user => [user.id, toPersonReference(user)]))
    const applicant = userById.get(request.applicantUserId) ?? {
      id: request.applicantUserId,
      displayName: '未知用户',
      avatarUrl: null,
    }
    const reviewedBy = request.reviewedByUserId === null
      ? null
      : userById.get(request.reviewedByUserId) ?? {
          id: request.reviewedByUserId,
          displayName: '未知用户',
          avatarUrl: null,
        }
    return {
      id: request.id,
      storageRecordId: request.storageRecordId,
      applicant,
      targetSalesOrderId: request.salesOrderId,
      targetSalesOrderNo: request.salesOrderNoSnapshot,
      costTotalCny: request.costTotalCny.toFixed(2),
      allocations: readClaimAllocationSnapshots(request.allocations),
      containerChanges: readContainerChangeSnapshots(request.containerChanges),
      status: request.status,
      rejectReason: request.rejectReason,
      reviewedBy,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    }
  }

  private async loadBatchRecords(batchId: string): Promise<readonly ShipmentStorageDetailDto[]> {    const rows = await this.prisma.shipmentStorageRecord.findMany({
      where: { releaseBatchId: batchId },
      select: STORAGE_RECORD_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return this.withCostTransfers(rows)
  }

  /** 来源人员不落快照：按当前用户/采购单读取，停用账号仍保留展示名与头像。 */
  private async loadPersonContext(
    rows: readonly StorageRecordRow[],
  ): Promise<StoragePersonContext> {
    const issuerIds = [...new Set(rows.map(row => row.originIssuerUserId))]
    const purchaseOrderIds = [...new Set(rows.map(row => row.originPurchaseOrderId))]
    const storageRecordIds = rows.map(row => row.id)
    const pendingRequests = storageRecordIds.length === 0
      ? []
      : await this.prisma.shipmentStorageClaimRequest.findMany({
          where: {
            storageRecordId: { in: storageRecordIds },
            status: 'PENDING',
          },
          select: {
            id: true,
            storageRecordId: true,
            applicantUserId: true,
            salesOrderNoSnapshot: true,
            createdAt: true,
          },
        })
    const applicantIds = [...new Set(pendingRequests.map(request => request.applicantUserId))]
    const userIds = [...new Set([...issuerIds, ...applicantIds])]
    const [users, orders] = await Promise.all([
      userIds.length === 0
        ? Promise.resolve([] as PersonReferenceRow[])
        : this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: PERSON_REFERENCE_SELECT,
          }),
      purchaseOrderIds.length === 0
        ? Promise.resolve([] as Array<{ id: string, createdBy: PersonReferenceRow }>)
        : this.prisma.purchaseOrder.findMany({
            where: { id: { in: purchaseOrderIds } },
            select: { id: true, createdBy: { select: PERSON_REFERENCE_SELECT } },
          }),
    ])
    const userById = new Map(users.map(user => [user.id, toPersonReference(user)]))
    return {
      issuerById: new Map(issuerIds.flatMap((id) => {
        const person = userById.get(id)
        return person === undefined ? [] : [[id, person]] as const
      })),
      purchaseCreatorById: new Map(orders.map(order => [order.id, toPersonReference(order.createdBy)])),
      claimRequestByStorageId: new Map(pendingRequests.map((request) => {
        const applicant = userById.get(request.applicantUserId)
        return [request.storageRecordId, {
          id: request.id,
          applicant: applicant ?? {
            id: request.applicantUserId,
            displayName: '未知用户',
            avatarUrl: null,
          },
          targetSalesOrderNo: request.salesOrderNoSnapshot,
          createdAt: request.createdAt.toISOString(),
        }] as const
      })),
    }
  }

  /**
   * 当前装柜明细按 shipmentId 实时读取；解绑后不再关联，快照不参与本次详情视图。
   * 一个货件可能有多条装柜明细，因此返回数组而不是单条记录。
   */
  private async loadContainerItems(
    rows: readonly StorageRecordRow[],
  ): Promise<ReadonlyMap<string, readonly ShipmentStorageContainerItemDto[]>> {
    const shipmentIds = [...new Set(rows.map(row => row.shipmentId))]
    if (shipmentIds.length === 0) return new Map()
    const items = await this.prisma.containerLoadingItem.findMany({
      where: { shipmentId: { in: shipmentIds } },
      select: CONTAINER_ITEM_SELECT,
      orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
    })
    const itemsByShipment = new Map<string, ShipmentStorageContainerItemDto[]>()
    for (const item of items) {
      if (item.shipmentId === null) continue
      const containers = itemsByShipment.get(item.shipmentId) ?? []
      containers.push(containerItemDto(item))
      itemsByShipment.set(item.shipmentId, containers)
    }
    return new Map(rows.map(row => [row.id, itemsByShipment.get(row.shipmentId) ?? []]))
  }

  /**
   * 产品名、数量来自释放快照；图片按采购行的当前主图解析。
   * 一次批量查询当前页所有行，避免逐条寄仓记录 N+1。
   */
  private async loadProductSummaries(
    rows: readonly StorageRecordRow[],
  ): Promise<ReadonlyMap<string, ShipmentStorageLineSummaryDto>> {
    if (rows.length === 0) return new Map()
    const allocationsByRecord = new Map(rows.map(row => [
      row.id,
      readShipmentStorageAllocations(row.originAllocations),
    ]))
    const lineIds = [...new Set(
      [...allocationsByRecord.values()].flatMap(allocations => allocations.map(allocation => allocation.lineId)),
    )]
    const lines = lineIds.length === 0
      ? []
      : await this.prisma.purchaseOrderLine.findMany({
          where: { id: { in: lineIds } },
          select: {
            id: true,
            purchaseOrderId: true,
            lineNumber: true,
            lineType: true,
            productId: true,
            productNoSnapshot: true,
            productNameSnapshot: true,
            descriptionSnapshot: true,
            sourceSalesOrderLine: { select: { productNameSnapshot: true } },
            product: {
              select: {
                media: {
                  where: {
                    kind: 'IMAGE',
                    isPrimary: true,
                    detachedAt: null,
                    mediaAsset: { is: { status: 'READY' } },
                  },
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        })
    const lineById = new Map(lines.map(line => [line.id, line]))
    const summaries = new Map<string, ShipmentStorageLineSummaryDto>()
    for (const row of rows) {
      const previews: ShipmentStorageProductPreviewDto[] = (allocationsByRecord.get(row.id) ?? []).map((allocation) => {
        const line = lineById.get(allocation.lineId)
        // 快照行必须仍属于该寄仓记录的来源采购单，避免异常数据把别的订单图片带出来。
        const resolvedLine = line?.purchaseOrderId === row.originPurchaseOrderId ? line : undefined
        const image = resolvedLine?.product?.media[0]
        const productName = allocation.productName ?? resolvedLine?.productNameSnapshot ?? ''
        const sourceSalesProductName = resolvedLine?.sourceSalesOrderLine?.productNameSnapshot ?? null
        return {
          lineId: allocation.lineId,
          lineNumber: allocation.lineNumber ?? resolvedLine?.lineNumber ?? 0,
          lineType: resolvedLine?.lineType ?? 'UNRESOLVED',
          productId: resolvedLine?.productId ?? null,
          productNo: resolvedLine?.productNoSnapshot ?? null,
          productName,
          productDescription: resolvedLine?.descriptionSnapshot ?? null,
          sourceSalesProductName,
          normalizedNames: resolvedLine?.lineType === 'CUSTOM'
            ? claimProductAliases([productName, resolvedLine.productNameSnapshot, sourceSalesProductName])
            : [],
          quantity: allocation.quantity,
          mainImage: image === undefined
            ? null
            : {
                id: image.id,
                contentUrl: `/api/shipment-storage/${row.id}/lines/${allocation.lineId}/main-image/${image.id}/content`,
              },
        }
      })
      summaries.set(row.id, {
        lineCount: previews.length,
        totalQuantity: previews.reduce((total, preview) => total + preview.quantity, 0),
        previews,
      })
    }
    return summaries
  }

  /**
   * 释放时的位置没有单独的持久化列，审计事件是唯一来源。
   * 一次批量查询所有记录，再用仓库字典补齐标签，避免详情接口逐条查询。
   */
  private async loadInitialLocations(
    rows: readonly StorageRecordRow[],
  ): Promise<ReadonlyMap<string, StorageInitialLocation>> {
    if (rows.length === 0) return new Map()
    const audits = await this.prisma.auditEvent.findMany({
      where: {
        eventType: 'SHIPMENT_OWNERSHIP_RELEASED',
        targetType: 'PURCHASE_ORDER_PART',
        OR: rows.map(row => ({
          metadata: { path: ['storageRecordId'], equals: row.id },
        })),
      },
      select: { metadata: true },
    })
    const released = new Map<string, Omit<StorageInitialLocation, 'warehouseLabel'>>()
    for (const audit of audits) {
      const location = readReleasedLocation(audit.metadata)
      if (location !== null && !released.has(location.storageRecordId)) {
        released.set(location.storageRecordId, {
          locationScope: location.locationScope,
          warehouseValue: location.warehouseValue,
        })
      }
    }
    if (released.size === 0) return new Map()

    const valuesByScope = new Map<ShipmentStorageLocationScope, string[]>()
    for (const location of released.values()) {
      const values = valuesByScope.get(location.locationScope) ?? []
      values.push(location.warehouseValue)
      valuesByScope.set(location.locationScope, values)
    }
    const resolutions = await Promise.all([...valuesByScope].map(async ([scope, values]) => ({
      scope,
      items: await this.dictionary.resolveStoredValues({
        dictionaryCode: scope === 'MAINLAND' ? 'mainland.warehouse' : 'overseas.warehouse',
        values: [...new Set(values)],
      }),
    })))
    const labelByLocation = new Map<string, string>()
    for (const resolution of resolutions) {
      for (const item of resolution.items) {
        if (item.known) {
          labelByLocation.set(`${resolution.scope}:${item.value}`, item.label)
        }
      }
    }
    return new Map([...released].map(([recordId, location]) => [recordId, {
      ...location,
      warehouseLabel: labelByLocation.get(`${location.locationScope}:${location.warehouseValue}`) ?? null,
    }]))
  }

  /** 成本转移只在发生真实动账时留事件；零成本或历史记录返回空列表。 */
  private async withCostTransfers(
    rows: readonly StorageRecordRow[],
  ): Promise<ShipmentStorageDetailDto[]> {
    if (rows.length === 0) return []
    const events = await this.prisma.shipmentCostEvent.findMany({
      where: { storageRecordId: { in: rows.map(row => row.id) } },
      select: {
        storageRecordId: true,
        direction: true,
        amountCny: true,
        occurredAt: true,
        fundPostingBatchIds: true,
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    })
    const batchIds = [...new Set(events.flatMap(event => parseBatchIds(event.fundPostingBatchIds)))]
    const batches = batchIds.length === 0
      ? []
      : await this.prisma.fundPostingBatch.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, batchNo: true },
        })
    const batchNoById = new Map(batches.map(batch => [batch.id, batch.batchNo]))
    const byRecord = new Map<string, ShipmentStorageCostTransferDto[]>()
    for (const event of events) {
      const transfers = byRecord.get(event.storageRecordId) ?? []
      transfers.push({
        amountCny: event.amountCny.toFixed(2),
        batchNos: parseBatchIds(event.fundPostingBatchIds)
          .map(id => batchNoById.get(id))
          .filter((batchNo): batchNo is string => batchNo !== undefined),
        direction: event.direction,
        occurredAt: event.occurredAt.toISOString(),
      })
      byRecord.set(event.storageRecordId, transfers)
    }
    const [persons, initialLocations, productSummaries, containerItems] = await Promise.all([
      this.loadPersonContext(rows),
      this.loadInitialLocations(rows),
      this.loadProductSummaries(rows),
      this.loadContainerItems(rows),
    ])
    return rows.map(row => detailDto(
      row,
      byRecord.get(row.id) ?? [],
      persons,
      initialLocations.get(row.id) ?? null,
      productSummaries.get(row.id) ?? emptyLineSummary(),
      containerItems.get(row.id) ?? [],
    ))
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
    if (part.containerLoadingItems.length === 0) return null
    // 货件只能属于一个柜次，柜次头放在顶层；装柜明细按行完整保留，避免多唛头时丢失。
    const containerBatch = part.containerLoadingItems[0].containerBatch
    return {
      format: 'shipment-storage.container-snapshot.v2',
      containerBatch: {
        id: containerBatch.id,
        containerBatchNo: containerBatch.containerBatchNo,
        containerBatchName: containerBatch.containerBatchName,
        loadingDate: containerBatch.loadingDate.toISOString().slice(0, 10),
      },
      items: part.containerLoadingItems.map(item => ({
        id: item.id,
        lineNumber: item.lineNumber,
        oceanShippingMarkText: item.oceanShippingMarkText,
        goodsName: item.goodsName,
        packageCount: item.packageCount,
        packageUnit: item.packageUnit,
        recipientName: item.recipientName,
        recipientPhone: item.recipientPhone,
        recipientAddress: item.recipientAddress,
        codAmountTwd: item.codAmountTwd?.toFixed(2) ?? null,
        grossWeightKg: item.grossWeightKg?.toFixed(0) ?? null,
        lengthCm: item.lengthCm?.toFixed(0) ?? null,
        widthCm: item.widthCm?.toFixed(0) ?? null,
        heightCm: item.heightCm?.toFixed(0) ?? null,
        volumeCai: item.volumeCai?.toFixed(2) ?? null,
        chargeableVolumeCai: item.chargeableVolumeCai,
        reportedVolumeCai: item.reportedVolumeCai?.toFixed(2) ?? null,
        warehouseReceiptReference: item.warehouseReceiptReference,
        remark: item.remark,
      })),
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
