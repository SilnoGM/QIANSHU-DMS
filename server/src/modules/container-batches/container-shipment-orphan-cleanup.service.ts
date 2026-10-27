import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  lockSalesOrderChains,
  retreatSalesOrdersWhenShipmentsUnloaded,
  salesOrderIdsOfShipments,
} from '../purchase-orders/shipments/sales-order-container-load-progress'
import { clearShipmentsContainerLoaded } from './container-unload-fact'

export interface ContainerShipmentOrphanCleanupOptions {
  readonly apply: boolean
  readonly actorUserId?: string
  readonly limit: number
}

export type ContainerShipmentOrphanCleanupOutcome =
  | 'CLEARABLE'
  | 'CLEARED'
  | 'SKIPPED_DELIVERED'
  | 'SKIPPED'
  | 'FAILED'

export interface ContainerShipmentOrphanCleanupSample {
  readonly shipmentId: string
  readonly shipmentNo: string | null
  readonly loadedAt: string
  readonly outcome: ContainerShipmentOrphanCleanupOutcome
  readonly code: string | null
}

export interface ContainerShipmentOrphanCleanupResult {
  readonly mode: 'DRY_RUN' | 'APPLY'
  readonly scanned: number
  readonly cleared: number
  readonly skippedDelivered: number
  readonly skipped: number
  readonly failed: number
  readonly samples: readonly ContainerShipmentOrphanCleanupSample[]
  readonly errorCode: string | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAMPLE_LIMIT = 100

function cleanupFailure(code: string, message: string, status: HttpStatus): never {
  throw new ApiException(status, code, message)
}

/**
 * 一次性清理历史「已装柜但没有装柜明细」的孤立事实：解绑回退上线前解绑留下的数据。
 *
 * 只处理未签收的货件；已签收受签收 CHECK 约束保持原样并单独计数，交人工核对。
 * 执行复用与服务端解绑同一套撤销逻辑（含销售订单回退），预览默认只读。
 */
@Injectable()
export class ContainerShipmentOrphanCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(
    options: ContainerShipmentOrphanCleanupOptions,
  ): Promise<ContainerShipmentOrphanCleanupResult> {
    const actorUserId = options.actorUserId
    if (options.apply) {
      if (actorUserId === undefined || !UUID_PATTERN.test(actorUserId)) {
        cleanupFailure('CONTAINER_ORPHAN_CLEANUP_ACTOR_REQUIRED', '执行清理必须提供有效的操作人用户 ID', HttpStatus.UNPROCESSABLE_ENTITY)
      }
      await this.assertActiveActor(actorUserId)
    }

    const rows = await this.prisma.purchaseOrderPart.findMany({
      where: { loadedAt: { not: null }, containerLoadingItems: { none: {} } },
      select: { id: true, shipmentNo: true, loadedAt: true, deliveredAt: true },
      orderBy: [{ id: 'asc' }],
      take: options.limit,
    })

    let cleared = 0
    let skippedDelivered = 0
    let skipped = 0
    let failed = 0
    const samples: ContainerShipmentOrphanCleanupSample[] = []
    const push = (sample: ContainerShipmentOrphanCleanupSample) => {
      if (samples.length < SAMPLE_LIMIT) samples.push(sample)
    }

    for (const row of rows) {
      const base = { shipmentId: row.id, shipmentNo: row.shipmentNo, loadedAt: row.loadedAt!.toISOString() }
      if (row.deliveredAt !== null) {
        skippedDelivered += 1
        push({ ...base, outcome: 'SKIPPED_DELIVERED', code: null })
        continue
      }
      if (!options.apply) {
        cleared += 1
        push({ ...base, outcome: 'CLEARABLE', code: null })
        continue
      }
      try {
        const outcome = await this.applyOne(row.id, actorUserId!)
        if (outcome === 'CLEARED') {
          cleared += 1
          push({ ...base, outcome, code: null })
        }
        else {
          skipped += 1
          push({ ...base, outcome, code: null })
        }
      }
      catch (error) {
        failed += 1
        push({ ...base, outcome: 'FAILED', code: error instanceof ApiException ? error.code : 'CONTAINER_ORPHAN_CLEANUP_FAILED' })
      }
    }

    return {
      mode: options.apply ? 'APPLY' : 'DRY_RUN',
      scanned: rows.length,
      cleared,
      skippedDelivered,
      skipped,
      failed,
      samples,
      errorCode: null,
    }
  }

  private async assertActiveActor(actorUserId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    if (user?.status !== 'ACTIVE') {
      cleanupFailure('CONTAINER_ORPHAN_CLEANUP_ACTOR_INVALID', '清理操作人不存在或已停用', HttpStatus.UNPROCESSABLE_ENTITY)
    }
  }

  private async applyOne(shipmentId: string, actorUserId: string): Promise<'CLEARED' | 'SKIPPED'> {
    return this.prisma.$transaction(async (transaction) => {
      // 与解绑同一锁序：销售链条先于货件；锁后复查，避免预览后的重新装柜被静默撤销。
      const salesOrderIds = await salesOrderIdsOfShipments(transaction, [shipmentId])
      await lockSalesOrderChains(transaction, salesOrderIds)
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "purchase_order_parts"
        WHERE "id" = ${shipmentId}::uuid AND "loaded_at" IS NOT NULL AND "delivered_at" IS NULL
        FOR UPDATE
      `)
      if (locked.length !== 1) return 'SKIPPED'
      const stillOrphan = await transaction.containerLoadingItem.count({ where: { shipmentId } })
      if (stillOrphan > 0) return 'SKIPPED'

      const requestId = `container-orphan-cleanup:${shipmentId}`
      const cleared = await clearShipmentsContainerLoaded(transaction, this.audit, {
        actorUserId, requestId, containerBatchId: null, loadingItemId: null, shipmentIds: [shipmentId], source: 'ORPHAN_CLEANUP',
      })
      if (cleared === 0) return 'SKIPPED'
      await retreatSalesOrdersWhenShipmentsUnloaded(transaction, this.audit, {
        actorUserId, requestId, containerBatchId: null, shipmentId, salesOrderIds,
      })
      return 'CLEARED'
    })
  }
}
