import { createHash, randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  ShipmentOwnerType,
  ShipmentOwnershipReason,
  ShipmentOwnershipState,
} from '../../generated/prisma/enums'

export interface ShipmentOwnershipEntry {
  readonly shipmentId: string
  readonly ownerType: ShipmentOwnerType
  readonly ownerSalesOrderId: string | null
  readonly reason: ShipmentOwnershipReason
  readonly actorUserId: string
  readonly state?: ShipmentOwnershipState
  readonly releaseBatchId?: string | null
  readonly occurredAt?: Date
  readonly requestKey?: string
  readonly payload?: Record<string, unknown>
}

export interface ShipmentOwnershipRecordResult {
  readonly id: string
  readonly shipmentId: string
  readonly sequence: number
}

/**
 * 归属事实的唯一写入口：先锁货件行，再取当前最大序号。
 * 数据库触发器会再次校验序号连续性，服务层锁只用于减少并发冲突。
 */
@Injectable()
export class ShipmentOwnershipService {
  async recordMany(
    transaction: Prisma.TransactionClient,
    entries: readonly ShipmentOwnershipEntry[],
  ): Promise<ShipmentOwnershipRecordResult[]> {
    const results: ShipmentOwnershipRecordResult[] = []
    for (const entry of entries) {
      // 与货件不可变触发器共用行锁；同一货件的并发追加在此串行。
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM purchase_order_parts WHERE id = ${entry.shipmentId}::uuid FOR UPDATE`,
      )
      const aggregate = await transaction.shipmentOwnershipEvent.aggregate({
        where: { shipmentId: entry.shipmentId },
        _max: { sequence: true },
      })
      const sequence = (aggregate._max.sequence ?? 0) + 1
      const requestKey = entry.requestKey ?? randomUUID()
      const payload = entry.payload ?? {
        format: 'shipment-ownership.event.v1',
        shipmentId: entry.shipmentId,
        reason: entry.reason,
        sequence,
      }
      const event = await transaction.shipmentOwnershipEvent.create({
        data: {
          shipmentId: entry.shipmentId,
          sequence,
          ownerType: entry.ownerType,
          ownerSalesOrderId: entry.ownerSalesOrderId,
          state: entry.state ?? 'ACTIVE',
          reason: entry.reason,
          releaseBatchId: entry.releaseBatchId ?? null,
          occurredAt: entry.occurredAt ?? new Date(),
          actorUserId: entry.actorUserId,
          requestKey,
          payloadHash: createHash('sha256')
            .update(JSON.stringify(payload), 'utf8')
            .digest(),
        },
        select: { id: true },
      })
      results.push({ id: event.id, shipmentId: entry.shipmentId, sequence })
    }
    return results
  }

  findCurrent(
    transaction: Pick<Prisma.TransactionClient, 'shipmentOwnershipCurrent'>,
    shipmentId: string,
  ) {
    return transaction.shipmentOwnershipCurrent.findUnique({
      where: { shipmentId },
      select: {
        shipmentId: true,
        eventId: true,
        ownerType: true,
        ownerSalesOrderId: true,
        state: true,
        updatedAt: true,
      },
    })
  }

  listCurrentByShipmentIds(
    transaction: Pick<Prisma.TransactionClient, 'shipmentOwnershipCurrent'>,
    shipmentIds: readonly string[],
  ) {
    return transaction.shipmentOwnershipCurrent.findMany({
      where: { shipmentId: { in: [...shipmentIds] } },
      select: {
        shipmentId: true,
        ownerType: true,
        ownerSalesOrderId: true,
        state: true,
      },
    })
  }
}
