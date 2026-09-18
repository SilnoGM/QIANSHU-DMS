import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService } from '../../audit/audit.service'
import { PurchaseShipmentNumberingService, type NumberablePurchaseShipment } from './purchase-shipment-numbering.service'

export interface ShipmentNumberBackfillOptions {
  readonly actorUserId: string
  readonly apply?: boolean
  readonly limit?: number
}

export interface ShipmentNumberBackfillResult {
  mode: 'DRY_RUN' | 'APPLY'
  selected: number
  assigned: number
  skipped: number
  failed: number
  remaining: number
  ruleAvailable: boolean
  errorCode: string | null
}

type StoredShipment = NumberablePurchaseShipment & { shipmentNo: string | null, numberingIssuanceId: string | null }

function unavailableActor(): ApiException {
  return new ApiException(409, 'SHIPMENT_BACKFILL_ACTOR_UNAVAILABLE', '补号操作人不存在或已停用')
}

@Injectable()
export class PurchaseShipmentNumberBackfillService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: PurchaseShipmentNumberingService, private readonly audit: AuditService) {}

  async run(options: ShipmentNumberBackfillOptions): Promise<ShipmentNumberBackfillResult> {
    const limit = options.limit ?? 1000
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(options.actorUserId)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new ApiException(422, 'VALIDATION_FAILED', '补号参数无效')
    }
    const actor = await this.prisma.user.findUnique({ where: { id: options.actorUserId }, select: { status: true } })
    if (actor?.status !== 'ACTIVE') throw unavailableActor()
    // 已有编号也必须核验账本身份，不能将错误绑定当作“已处理”静默跳过。
    const checks = await this.prisma.$queryRaw<{ invalid: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM purchase_order_parts part
        WHERE (part.shipment_no IS NOT NULL OR part.numbering_issuance_id IS NOT NULL)
          AND NOT purchase_shipment_number_matches(part.id, part.purchase_order_id, part.key, part.shipment_no, part.numbering_issuance_id)) AS invalid
    `
    if (checks[0]?.invalid !== false) throw new ApiException(409, 'PURCHASE_SHIPMENT_NUMBER_CONFLICT', '已有货件编号与派发记录不一致')
    const where = { shipmentNo: null, numberingIssuanceId: null }
    const [candidates, remaining, rule] = await Promise.all([
      this.prisma.purchaseOrderPart.findMany({ where, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit }),
      this.prisma.purchaseOrderPart.count({ where }),
      this.prisma.numberingRule.findUnique({ where: { ruleCode: 'SHIPMENT_NO' }, select: { purpose: true, status: true, versions: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 } } }),
    ])
    const result: ShipmentNumberBackfillResult = {
      mode: options.apply ? 'APPLY' : 'DRY_RUN', selected: candidates.length, assigned: 0, skipped: 0, failed: 0, remaining,
      ruleAvailable: rule?.purpose === 'BUSINESS' && rule.status === 'ENABLED' && rule.versions.length === 1, errorCode: null,
    }
    if (!options.apply || candidates.length === 0) return result
    if (!result.ruleAvailable) return { ...result, errorCode: 'PURCHASE_SHIPMENT_NUMBERING_UNAVAILABLE' }
    for (const candidate of candidates) {
      try {
        const assigned = await this.assignOne(options.actorUserId, candidate.id)
        if (assigned) result.assigned += 1
        else result.skipped += 1
      }
      catch (error) {
        // 单件事务已退出；保留已完成数量供运维核对。再次执行从双空记录继续，不生成替代幂等键。
        result.failed += 1
        result.errorCode = error instanceof ApiException ? error.code : 'SHIPMENT_BACKFILL_FAILED'
        break
      }
    }
    result.remaining = await this.prisma.purchaseOrderPart.count({ where })
    return result
  }

  private async assignOne(actorUserId: string, partId: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await applyTransactionTimeouts(transaction)
      const actors = await transaction.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM users WHERE id = ${actorUserId}::uuid FOR SHARE`
      if (actors[0]?.status !== 'ACTIVE') throw unavailableActor()
      const parts = await transaction.$queryRaw<StoredShipment[]>`
        SELECT id, purchase_order_id AS "purchaseOrderId", key, shipment_no AS "shipmentNo", numbering_issuance_id AS "numberingIssuanceId"
        FROM purchase_order_parts WHERE id = ${partId}::uuid FOR UPDATE
      `
      const part = parts[0]
      if (!part) throw new ApiException(404, 'PURCHASE_ORDER_PART_NOT_FOUND', '采购货件不存在')
      if (part.shipmentNo !== null || part.numberingIssuanceId !== null) {
        const rows = await transaction.$queryRaw<{ valid: boolean }[]>`
          SELECT purchase_shipment_number_matches(${part.id}::uuid, ${part.purchaseOrderId}::uuid, ${part.key}::uuid, ${part.shipmentNo}, ${part.numberingIssuanceId}::uuid) AS valid
        `
        if (rows[0]?.valid !== true) throw new ApiException(409, 'PURCHASE_SHIPMENT_NUMBER_CONFLICT', '货件编号与派发记录不一致')
        return false
      }
      const [number] = await this.numbering.issue(transaction, [part])
      await transaction.purchaseOrderPart.update({ where: { id: part.id }, data: { shipmentNo: number.shipmentNo, numberingIssuanceId: number.numberingIssuanceId } })
      await this.audit.record(transaction, {
        eventType: 'PURCHASE_SHIPMENT_NUMBER_ASSIGNED', outcome: 'SUCCESS', actorType: 'USER', actorUserId,
        requestId: randomUUID(), targetType: 'PURCHASE_ORDER_PART', targetId: part.id, reasonCode: 'BACKFILL',
        metadata: { purchaseOrderId: part.purchaseOrderId, shipmentNo: number.shipmentNo, numberingIssuanceId: number.numberingIssuanceId, issuedAt: number.issuedAt },
      })
      return true
    }, { timeout: 30_000 })
  }
}
