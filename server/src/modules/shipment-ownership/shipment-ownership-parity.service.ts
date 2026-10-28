import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'

export interface ShipmentOwnershipParityDifference {
  readonly shipmentId: string
  readonly expectedOwnerType: string
  readonly expectedSalesOrderId: string | null
  readonly actualOwnerType: string | null
  readonly actualSalesOrderId: string | null
  readonly kind: 'MISSING' | 'OWNER' | 'STATE'
}

export interface ShipmentOwnershipParityResult {
  readonly total: number
  readonly matched: number
  readonly differences: number
  readonly samples: readonly ShipmentOwnershipParityDifference[]
}

const PART_SELECT = {
  id: true,
  status: true,
  purchaseOrder: { select: { purchaseType: true, salesOrderId: true } },
  ownershipCurrent: {
    select: { ownerType: true, ownerSalesOrderId: true, state: true },
  },
} as const satisfies Prisma.PurchaseOrderPartSelect

/**
 * 迁移期等价性检查：当前归属必须与采购来源完全一致。
 * 释放/认领功能上线后，差异是预期结果，本命令只作为迁移阶段门禁。
 */
@Injectable()
export class ShipmentOwnershipParityService {
  constructor(private readonly prisma: PrismaService) {}

  async run(limit = 50): Promise<ShipmentOwnershipParityResult> {
    const parts = await this.prisma.purchaseOrderPart.findMany({
      select: PART_SELECT,
      orderBy: { id: 'asc' },
    })
    const samples: ShipmentOwnershipParityDifference[] = []
    let matched = 0
    for (const part of parts) {
      const expectedSalesOrderId = part.purchaseOrder.purchaseType === 'SALES_LINKED'
        ? part.purchaseOrder.salesOrderId
        : null
      const expectedOwnerType = expectedSalesOrderId === null ? 'COMPANY' : 'SALES_ORDER'
      const expectedState = part.status === 'CANCELLED' ? 'VOIDED' : 'ACTIVE'
      const actual = part.ownershipCurrent
      if (actual === null) {
        if (samples.length < limit) {
          samples.push({
            shipmentId: part.id,
            expectedOwnerType,
            expectedSalesOrderId,
            actualOwnerType: null,
            actualSalesOrderId: null,
            kind: 'MISSING',
          })
        }
        continue
      }
      if (actual.ownerType !== expectedOwnerType || actual.ownerSalesOrderId !== expectedSalesOrderId) {
        if (samples.length < limit) {
          samples.push({
            shipmentId: part.id,
            expectedOwnerType,
            expectedSalesOrderId,
            actualOwnerType: actual.ownerType,
            actualSalesOrderId: actual.ownerSalesOrderId,
            kind: 'OWNER',
          })
        }
        continue
      }
      if (actual.state !== expectedState) {
        if (samples.length < limit) {
          samples.push({
            shipmentId: part.id,
            expectedOwnerType,
            expectedSalesOrderId,
            actualOwnerType: actual.ownerType,
            actualSalesOrderId: actual.ownerSalesOrderId,
            kind: 'STATE',
          })
        }
        continue
      }
      matched += 1
    }
    return {
      total: parts.length,
      matched,
      differences: parts.length - matched,
      samples,
    }
  }
}
