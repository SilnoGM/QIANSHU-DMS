import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { AuditActorType, AuditEventType, AuditOutcome } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  findImportCandidates,
  shipmentEligibility,
} from './container-import.shipments'
import { matchContainerShipment } from './import-matching'
import { markShipmentsContainerLoaded } from './container-load-fact'
import {
  advanceSalesOrdersWhenAllShipmentsLoaded,
  lockSalesOrderChains,
  salesOrderIdsOfShipments,
} from '../purchase-orders/shipments/sales-order-container-load-progress'

export interface ContainerShipmentBackfillOptions {
  readonly apply: boolean
  readonly actorUserId?: string
  readonly limit: number
}

export type ContainerShipmentBackfillOutcome =
  | 'MATCHED'
  | 'AMBIGUOUS'
  | 'UNMATCHED'
  | 'INELIGIBLE'
  | 'SKIPPED'
  | 'FAILED'

export interface ContainerShipmentBackfillSample {
  readonly itemId: string
  readonly containerBatchNo: string
  readonly warehouseReceiptReference: string
  readonly outcome: ContainerShipmentBackfillOutcome
  readonly shipmentId: string | null
  readonly shipmentNo: string | null
  readonly reason: string | null
  readonly code: string | null
}

export interface ContainerShipmentBackfillResult {
  readonly mode: 'DRY_RUN' | 'APPLY'
  readonly scanned: number
  readonly matched: number
  readonly applied: number
  readonly ambiguous: number
  readonly unmatched: number
  readonly ineligible: number
  readonly skipped: number
  readonly failed: number
  readonly affectedSalesOrderIds: readonly string[]
  readonly samples: readonly ContainerShipmentBackfillSample[]
  readonly errorCode: string | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAMPLE_LIMIT = 100

function backfillFailure(code: string, message: string, status: HttpStatus): never {
  throw new ApiException(status, code, message)
}

/**
 * 一次性历史回填：只把「未匹配货件、但入仓参考可以唯一命中」的装柜明细补上货件。
 *
 * 不猜测歧义或未命中数据；回填复用装柜事实、货件不跨柜和销售订单推进的既有领域逻辑。
 * 预览与执行共用同一匹配函数，执行时在行锁后重新匹配，避免预览后数据变化。
 */
@Injectable()
export class ContainerShipmentBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    options: ContainerShipmentBackfillOptions,
  ): Promise<ContainerShipmentBackfillResult> {
    const actorUserId = options.actorUserId
    if (options.apply) {
      if (actorUserId === undefined || !UUID_PATTERN.test(actorUserId)) {
        backfillFailure(
          'CONTAINER_BACKFILL_ACTOR_REQUIRED',
          '执行回填必须提供有效的操作人用户 ID',
          HttpStatus.UNPROCESSABLE_ENTITY,
        )
      }
      await this.assertActiveActor(actorUserId)
    }

    const items = await this.prisma.containerLoadingItem.findMany({
      where: {
        shipmentId: null,
        NOT: [
          { warehouseReceiptReference: null },
          { warehouseReceiptReference: '' },
        ],
      },
      select: {
        id: true,
        containerBatchId: true,
        warehouseReceiptReference: true,
        containerBatch: {
          select: { containerBatchNo: true, warehouseValue: true },
        },
      },
      orderBy: [{ containerBatchId: 'asc' }, { id: 'asc' }],
      take: options.limit,
    })

    let matched = 0
    let applied = 0
    let ambiguous = 0
    let unmatched = 0
    let ineligible = 0
    let skipped = 0
    let failed = 0
    const affectedSalesOrderIds = new Set<string>()
    const samples: ContainerShipmentBackfillSample[] = []

    for (const item of items) {
      if (item.warehouseReceiptReference === null || item.warehouseReceiptReference === '') {
        continue
      }
      const sampleBase = {
        itemId: item.id,
        containerBatchNo: item.containerBatch.containerBatchNo,
        warehouseReceiptReference: item.warehouseReceiptReference,
      }
      if (options.apply) {
        try {
          const outcome = await this.applyOne(
            item.id,
            item.warehouseReceiptReference,
            actorUserId!,
          )
          if (outcome.outcome === 'MATCHED') {
            matched += 1
            applied += 1
            for (const salesOrderId of outcome.salesOrderIds) {
              affectedSalesOrderIds.add(salesOrderId)
            }
          }
          else if (outcome.outcome === 'SKIPPED') {
            skipped += 1
          }
          else {
            failed += 1
          }
          this.pushSample(samples, { ...sampleBase, ...outcome, salesOrderIds: undefined })
        }
        catch (error) {
          failed += 1
          this.pushSample(samples, {
            ...sampleBase,
            outcome: 'FAILED',
            shipmentId: null,
            shipmentNo: null,
            reason: null,
            code: error instanceof ApiException ? error.code : 'CONTAINER_BACKFILL_FAILED',
          })
        }
        continue
      }

      const preview = await this.previewOne(
        item.warehouseReceiptReference,
        item.containerBatchId,
        item.containerBatch.warehouseValue,
      )
      if (preview.outcome === 'MATCHED') {
        matched += 1
        if (preview.salesOrderIds !== undefined) {
          for (const salesOrderId of preview.salesOrderIds) {
            affectedSalesOrderIds.add(salesOrderId)
          }
        }
      }
      else if (preview.outcome === 'AMBIGUOUS') ambiguous += 1
      else if (preview.outcome === 'UNMATCHED') unmatched += 1
      else if (preview.outcome === 'INELIGIBLE') ineligible += 1
      else failed += 1
      this.pushSample(samples, {
        ...sampleBase,
        ...preview,
        salesOrderIds: undefined,
      })
    }

    return {
      mode: options.apply ? 'APPLY' : 'DRY_RUN',
      scanned: items.length,
      matched,
      applied,
      ambiguous,
      unmatched,
      ineligible,
      skipped,
      failed,
      affectedSalesOrderIds: [...affectedSalesOrderIds].sort(),
      samples,
      errorCode: null,
    }
  }

  private async assertActiveActor(actorUserId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { status: true },
    })
    if (user?.status !== 'ACTIVE') {
      backfillFailure(
        'CONTAINER_BACKFILL_ACTOR_INVALID',
        '回填操作人不存在或已停用',
        HttpStatus.UNPROCESSABLE_ENTITY,
      )
    }
  }

  private async previewOne(
    reference: string,
    containerBatchId: string,
    warehouseValue: string,
  ): Promise<{
    readonly outcome: ContainerShipmentBackfillOutcome
    readonly shipmentId: string | null
    readonly shipmentNo: string | null
    readonly reason: string | null
    readonly code: string | null
    readonly salesOrderIds?: readonly string[]
  }> {
    const candidates = await findImportCandidates(this.prisma, [reference])
    const match = matchContainerShipment(reference, candidates)
    if (match.status === 'AMBIGUOUS') {
      return {
        outcome: 'AMBIGUOUS',
        shipmentId: null,
        shipmentNo: null,
        reason: match.reason,
        code: null,
      }
    }
    if (match.status === 'UNMATCHED' || match.shipmentId === null) {
      return {
        outcome: 'UNMATCHED',
        shipmentId: null,
        shipmentNo: null,
        reason: match.reason,
        code: null,
      }
    }
    const candidate = candidates.find(value => value.id === match.shipmentId)
    if (candidate === undefined) {
      return {
        outcome: 'UNMATCHED',
        shipmentId: null,
        shipmentNo: null,
        reason: '匹配货件当前不可用',
        code: null,
      }
    }
    const unavailableReason = shipmentEligibility(
      candidate,
      containerBatchId,
      warehouseValue,
    )
    if (unavailableReason !== null) {
      return {
        outcome: 'INELIGIBLE',
        shipmentId: candidate.id,
        shipmentNo: candidate.shipmentNo,
        reason: unavailableReason,
        code: null,
      }
    }
    const salesOrderIds = await salesOrderIdsOfShipments(this.prisma, [candidate.id])
    return {
      outcome: 'MATCHED',
      shipmentId: candidate.id,
      shipmentNo: candidate.shipmentNo,
      reason: null,
      code: null,
      salesOrderIds,
    }
  }

  private async applyOne(
    itemId: string,
    reference: string,
    actorUserId: string,
  ): Promise<{
    readonly outcome: ContainerShipmentBackfillOutcome
    readonly shipmentId: string | null
    readonly shipmentNo: string | null
    readonly reason: string | null
    readonly code: string | null
    readonly salesOrderIds: readonly string[]
  }> {
    return this.prisma.$transaction(async (transaction) => {
      const lockedItems = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "container_loading_items"
        WHERE "id" = ${itemId}::uuid AND "shipment_id" IS NULL
        FOR UPDATE
      `)
      if (lockedItems.length !== 1) {
        return {
          outcome: 'SKIPPED',
          shipmentId: null,
          shipmentNo: null,
          reason: '明细已匹配货件或不存在',
          code: null,
          salesOrderIds: [],
        }
      }

      const item = await transaction.containerLoadingItem.findUniqueOrThrow({
        where: { id: itemId },
        select: {
          id: true,
          containerBatchId: true,
          version: true,
          containerBatch: { select: { warehouseValue: true } },
        },
      })
      const candidates = await findImportCandidates(transaction, [reference])
      const match = matchContainerShipment(reference, candidates)
      if (match.status !== 'MATCHED' || match.shipmentId === null) {
        return {
          outcome: match.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'UNMATCHED',
          shipmentId: null,
          shipmentNo: null,
          reason: match.reason,
          code: null,
          salesOrderIds: [],
        }
      }

      const salesOrderIds = await salesOrderIdsOfShipments(transaction, [match.shipmentId])
      await lockSalesOrderChains(transaction, salesOrderIds)
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "purchase_order_parts"
        WHERE "id" = ${match.shipmentId}::uuid
        FOR UPDATE
      `)

      // 锁后重新匹配并校验，避免预览后的货件分配/状态变化被静默写入。
      const lockedCandidates = await findImportCandidates(transaction, [reference])
      const lockedMatch = matchContainerShipment(reference, lockedCandidates)
      const shipment = lockedCandidates.find(value => value.id === lockedMatch.shipmentId)
      if (lockedMatch.status !== 'MATCHED' || shipment === undefined) {
        return {
          outcome: lockedMatch.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'UNMATCHED',
          shipmentId: null,
          shipmentNo: null,
          reason: lockedMatch.reason,
          code: null,
          salesOrderIds: [],
        }
      }
      const unavailableReason = shipmentEligibility(
        shipment,
        item.containerBatchId,
        item.containerBatch.warehouseValue,
      )
      if (unavailableReason !== null) {
        return {
          outcome: 'INELIGIBLE',
          shipmentId: shipment.id,
          shipmentNo: shipment.shipmentNo,
          reason: unavailableReason,
          code: null,
          salesOrderIds: [],
        }
      }

      const requestId = `container-shipment-backfill:${itemId}`
      await markShipmentsContainerLoaded(transaction, this.audit, {
        actorUserId,
        requestId,
        containerBatchId: item.containerBatchId,
        shipmentIds: [shipment.id],
        source: 'BACKFILL',
        loadingItemId: itemId,
      })
      const updated = await transaction.containerLoadingItem.update({
        where: { id: itemId },
        data: {
          shipmentId: shipment.id,
          updatedById: actorUserId,
          version: { increment: 1 },
        },
        select: { version: true },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.CONTAINER_LOADING_ITEM_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId,
        requestId,
        targetType: 'CONTAINER_LOADING_ITEM',
        targetId: itemId,
        metadata: {
          containerBatchId: item.containerBatchId,
          previousVersion: item.version,
          version: updated.version,
          previousShipmentId: null,
          shipmentId: shipment.id,
          source: 'BACKFILL',
        },
      })
      await advanceSalesOrdersWhenAllShipmentsLoaded(transaction, this.audit, {
        actorUserId,
        containerBatchId: item.containerBatchId,
        requestId,
        salesOrderIds,
      })

      return {
        outcome: 'MATCHED',
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        reason: null,
        code: null,
        salesOrderIds,
      }
    })
  }

  private pushSample(
    samples: ContainerShipmentBackfillSample[],
    value: {
      readonly itemId: string
      readonly containerBatchNo: string
      readonly warehouseReceiptReference: string
      readonly outcome: ContainerShipmentBackfillOutcome
      readonly shipmentId: string | null
      readonly shipmentNo: string | null
      readonly reason: string | null
      readonly code: string | null
      readonly salesOrderIds?: readonly string[]
    },
  ): void {
    if (samples.length >= SAMPLE_LIMIT) return
    samples.push({
      itemId: value.itemId,
      containerBatchNo: value.containerBatchNo,
      warehouseReceiptReference: value.warehouseReceiptReference,
      outcome: value.outcome,
      shipmentId: value.shipmentId,
      shipmentNo: value.shipmentNo,
      reason: value.reason,
      code: value.code,
    })
  }
}
