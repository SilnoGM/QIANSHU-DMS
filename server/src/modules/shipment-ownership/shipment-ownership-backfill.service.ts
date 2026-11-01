import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'

export interface ShipmentOwnershipBackfillOptions {
  readonly apply: boolean
  readonly limit: number
}

export interface ShipmentOwnershipBackfillResult {
  readonly total: number
  readonly missingCurrent: number
  readonly repairedProjection: number
  readonly created: number
  readonly remaining: number
  readonly sampleIds: readonly string[]
}

const PART_SELECT = {
  id: true,
  status: true,
  purchaseOrder: { select: { purchaseType: true, salesOrderId: true, createdByUserId: true } },
} as const satisfies Prisma.PurchaseOrderPartSelect

type BackfillPart = Prisma.PurchaseOrderPartGetPayload<{ select: typeof PART_SELECT }>

/**
 * 只为缺失当前归属的货件补齐初始事件；已有归属的货件一律不动。
 * 正常迁移后应为 0 条；该命令用于环境重放与异常修复。
 */
@Injectable()
export class ShipmentOwnershipBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  async run(options: ShipmentOwnershipBackfillOptions): Promise<ShipmentOwnershipBackfillResult> {
    const total = await this.prisma.purchaseOrderPart.count()
    const missing = await this.prisma.purchaseOrderPart.findMany({
      where: { ownershipCurrent: { is: null } },
      select: PART_SELECT,
      orderBy: { id: 'asc' },
      take: options.limit,
    })
    const remaining = await this.prisma.purchaseOrderPart.count({
      where: { ownershipCurrent: { is: null } },
    })
    if (!options.apply || missing.length === 0) {
      return {
        total,
        missingCurrent: remaining,
        repairedProjection: 0,
        created: 0,
        remaining,
        sampleIds: missing.slice(0, 10).map(part => part.id),
      }
    }

    let created = 0
    let repairedProjection = 0
    await this.prisma.$transaction(async transaction => {
      for (const part of missing) {
        const existingEvent = await transaction.shipmentOwnershipEvent.findFirst({
          where: { shipmentId: part.id },
          orderBy: { sequence: 'desc' },
          select: { id: true },
        })
        if (existingEvent !== null) {
          await this.rebuildProjection(transaction, part.id, existingEvent.id)
          repairedProjection += 1
          continue
        }
        await this.createInitialEvent(transaction, part)
        created += 1
      }
    }, { timeout: 120_000 })

    const after = await this.prisma.purchaseOrderPart.count({
      where: { ownershipCurrent: { is: null } },
    })
    return {
      total,
      missingCurrent: remaining,
      repairedProjection,
      created,
      remaining: after,
      sampleIds: missing.slice(0, 10).map(part => part.id),
    }
  }

  private async createInitialEvent(
    transaction: Prisma.TransactionClient,
    part: BackfillPart,
  ): Promise<void> {
    const ownerSalesOrderId = part.purchaseOrder.purchaseType === 'SALES_LINKED'
      ? part.purchaseOrder.salesOrderId
      : null
    await transaction.shipmentOwnershipEvent.create({
      data: {
        shipmentId: part.id,
        sequence: 1,
        ownerType: ownerSalesOrderId === null ? 'COMPANY' : 'SALES_ORDER',
        ownerSalesOrderId,
        state: part.status === 'CANCELLED' ? 'VOIDED' : 'ACTIVE',
        reason: part.status === 'CANCELLED' ? 'ORDER_CANCELLED' : 'PURCHASE_CREATED',
        occurredAt: new Date(),
        actorUserId: part.purchaseOrder.createdByUserId,
        requestKey: part.id,
        payloadHash: createHash('sha256')
          .update(`shipment-ownership.backfill.v1:${part.id}`, 'utf8')
          .digest(),
      },
    })
  }

  private async rebuildProjection(
    transaction: Prisma.TransactionClient,
    shipmentId: string,
    eventId: string,
  ): Promise<void> {
    const event = await transaction.shipmentOwnershipEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: {
        ownerType: true,
        ownerSalesOrderId: true,
        state: true,
        occurredAt: true,
      },
    })
    await transaction.shipmentOwnershipCurrent.upsert({
      where: { shipmentId },
      create: {
        shipmentId,
        eventId,
        ownerType: event.ownerType,
        ownerSalesOrderId: event.ownerSalesOrderId,
        state: event.state,
        updatedAt: event.occurredAt,
      },
      update: {
        eventId,
        ownerType: event.ownerType,
        ownerSalesOrderId: event.ownerSalesOrderId,
        state: event.state,
        updatedAt: event.occurredAt,
      },
    })
  }
}
