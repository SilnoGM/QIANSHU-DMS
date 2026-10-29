import { createHash, randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { Prisma, type Prisma as PrismaTypes } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { AuditService } from '../audit/audit.service'
import { FundPostingService } from '../fund-accounts/application/fund-posting.contract'

export const SHIPMENT_STORAGE_FUND_SOURCE = 'SHIPMENT_STORAGE'
export const SHIPMENT_STORAGE_RELEASE_CONSUMER = 'SHIPMENT_STORAGE.RELEASE'
export const SHIPMENT_STORAGE_CLAIM_CONSUMER = 'SHIPMENT_STORAGE.CLAIM'
export const SHIPMENT_STORAGE_RELEASE_POSTING_TYPE = 'SHIPMENT_STORAGE_RELEASE'
export const SHIPMENT_STORAGE_CLAIM_POSTING_TYPE = 'SHIPMENT_STORAGE_CLAIM'

export type ShipmentCostDirection = 'RELEASE' | 'CLAIM'

/** 成本快照只信任释放时冻结的采购 + 包装合计，不读实时采购金额。 */
export function totalCostFromSnapshot(snapshot: Prisma.JsonValue): string {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return '0.00'
  const value = (snapshot as Record<string, unknown>).totalCostCny
  return typeof value === 'string' ? value : '0.00'
}

export interface ShipmentCostTransferContext {
  readonly actorUserId: string
  readonly requestId: string
}

export interface ShipmentCostTransferInput {
  readonly storageRecordId: string
  readonly shipmentId: string
  readonly shipmentNo: string | null
  readonly userId: string
  readonly amountCny: string
}

export interface ShipmentCostTransferResult {
  readonly amountCny: string
  readonly batchId: string
}

function payloadHash(payload: unknown): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest()
  const result = new Uint8Array(new ArrayBuffer(digest.byteLength))
  result.set(digest)
  return result
}

/**
 * 寄仓成本两跳：
 * - 释放：按原出单人比例把成本退回原出单人与公司（只入账）；
 * - 认领：按新出单人比例向新出单人与公司收回（只出账）。
 * 两跳都不建池账户，净额与设计表一致；每跳一个资金批次 + 一条成本事件。
 * 必须在释放/认领事务内调用，资金、成本事件与业务事实同时提交或回滚。
 */
@Injectable()
export class ShipmentStorageCostService {
  constructor(
    private readonly funds: FundPostingService,
    private readonly audit: AuditService,
  ) {}

  async transfer(
    transaction: PrismaTypes.TransactionClient,
    context: ShipmentCostTransferContext,
    direction: ShipmentCostDirection,
    input: ShipmentCostTransferInput,
  ): Promise<ShipmentCostTransferResult | null> {
    const amount = new Prisma.Decimal(input.amountCny).toDecimalPlaces(2)
    // 成本为零时没有资金要转移；成本事件也只在真正发生转移时记录。
    if (amount.lessThanOrEqualTo(0)) return null

    const release = direction === 'RELEASE'
    const consumerCode = release ? SHIPMENT_STORAGE_RELEASE_CONSUMER : SHIPMENT_STORAGE_CLAIM_CONSUMER
    const postingTypeCode = release ? SHIPMENT_STORAGE_RELEASE_POSTING_TYPE : SHIPMENT_STORAGE_CLAIM_POSTING_TYPE
    const fundContext = {
      actorUserId: context.actorUserId,
      consumerCode,
      requestId: context.requestId,
      sourceCode: SHIPMENT_STORAGE_FUND_SOURCE,
    }
    const postingInput = {
      amount: amount.toFixed(2),
      businessId: input.storageRecordId,
      idempotencyKey: `${input.storageRecordId}:${direction}`,
      postingTypeCode,
      summary: release ? '寄仓成本转出' : '寄仓成本转入',
      userId: input.userId,
      ...(input.shipmentNo === null ? {} : { businessNo: input.shipmentNo }),
    }
    const preview = await this.funds.previewBusinessEventInTransaction(
      transaction,
      fundContext,
      postingInput,
    )
    const posting = await this.funds.postBusinessEventInTransaction(
      transaction,
      fundContext,
      postingInput,
      preview,
    )
    const transferGroupId = randomUUID()
    await transaction.shipmentCostEvent.create({ data: {
      storageRecordId: input.storageRecordId,
      direction,
      transferGroupId,
      fundPostingBatchIds: [posting.batchId],
      amountCny: amount,
      legsSnapshot: {
        userId: input.userId,
        userShareRate: posting.userShareRateSnapshot,
        companyShareRate: posting.companyShareRateSnapshot,
        amountCny: posting.businessAmount,
        entries: posting.entries.map(entry => ({
          accountTarget: entry.accountTarget,
          direction: entry.direction,
          amount: entry.amount,
        })),
      },
      actorUserId: context.actorUserId,
      requestKey: randomUUID(),
      payloadHash: payloadHash({
        amountCny: amount.toFixed(2),
        batchId: posting.batchId,
        direction,
        storageRecordId: input.storageRecordId,
        userId: input.userId,
      }),
    } })
    await this.audit.record(transaction, {
      eventType: AuditEventType.SHIPMENT_COST_TRANSFERRED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      targetType: 'SHIPMENT_STORAGE_RECORD',
      targetId: input.storageRecordId,
      metadata: {
        amountCny: amount.toFixed(2),
        direction,
        fundPostingBatchId: posting.batchId,
        shipmentId: input.shipmentId,
        transferGroupId,
        userId: input.userId,
      },
    })
    return { amountCny: amount.toFixed(2), batchId: posting.batchId }
  }
}
