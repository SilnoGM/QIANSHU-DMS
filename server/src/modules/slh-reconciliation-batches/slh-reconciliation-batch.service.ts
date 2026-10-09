import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { slhBillUuid } from '../slh-bills/slh-bill.normalizer'
import { mapSlhReconciliationBatchError, slhReconciliationBatchFailure } from './slh-reconciliation-batch.errors'
import { matchBillUnreconciledLines } from './slh-reconciliation-batch.matcher'
import { slhReconciliationBatchUuid } from './slh-reconciliation-batch.normalizer'
import { SlhReconciliationBatchQueryService } from './slh-reconciliation-batch-query.service'
import type { SlhReconciliationBatchCreateDto, SlhReconciliationBatchDetailDto } from './slh-reconciliation-batch.dto'

const PERMISSION = 'slh-bills:reconcile'
/** 批次编号域与消费方：规则由管理员在编号管理页配置，迁移不预置规则。 */
const BATCH_RULE = 'SLH_RECON_BATCH_NO'
const BATCH_CONSUMER = 'SLH_RECON_BATCH.CREATE'
/** 创建语义指纹的格式标记：改口径时必须同时改版本号，避免新旧请求被当成同一个意图。 */
const CREATE_PAYLOAD_FORMAT = 'slh-reconciliation-batch.create.v1'

export interface SlhReconciliationBatchCommandContext { actorUserId: string, requestId: string }

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
/** 幂等键与指纹都以 SHA-256 落库，两者都必须是 32 字节。 */
const digest = (value: string) => Buffer.from(createHash('sha256').update(value).digest('hex'), 'hex')

@Injectable()
export class SlhReconciliationBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: SlhReconciliationBatchQueryService,
    private readonly numbering: NumberingGeneratorService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
  ) {}

  /** 与账单写路径同一口径：事务内复核用户状态与权限，前端条件不可信。 */
  private async authorize(tx: Prisma.TransactionClient, actorUserId: string, permission: string) {
    slhReconciliationBatchUuid(actorUserId)
    const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    const codes = await this.access.getPermissionCodesInTransaction(tx, actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(codes, [permission])) {
      return slhReconciliationBatchFailure('FORBIDDEN', '权限不足', 403)
    }
  }

  /**
   * 开始对账：为一张账单创建批次，并把当前匹配命中的明细行冻结为成员。
   *
   * 事务顺序即不变量顺序：幂等键 → 账单行锁 → 准入复检 → 重跑匹配 → 范围比对 → 取号 → 落库。
   * 匹配在事务内重跑，前端「当前可核对」的结果只用于比对，不参与创建决策。
   */
  async create(context: SlhReconciliationBatchCommandContext, input: SlhReconciliationBatchCreateDto, key: unknown): Promise<SlhReconciliationBatchDetailDto> {
    const billId = slhBillUuid(input.billId)
    const requestKey = slhReconciliationBatchUuid(key)
    // 指纹只描述创建语义（哪张账单）；可核对行集合是客户端的比对依据，不参与指纹。
    const payloadFingerprint = hash({ format: CREATE_PAYLOAD_FORMAT, billId })
    const payloadBytes = Buffer.from(payloadFingerprint, 'hex')
    try {
      const created = await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, PERMISSION)
        // 幂等锁在发号之前：网络重试只恢复同一批次，不再次消耗编号。
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`slh-reconciliation-batch.create:${context.actorUserId}:${requestKey}`}, 0))`)
        const previous = await tx.slhReconciliationBatch.findUnique({
          where: {
            createdById_creationRequestKeyHash: {
              createdById: context.actorUserId,
              creationRequestKeyHash: digest(requestKey),
            },
          },
          select: { id: true, creationPayloadHash: true },
        })
        if (previous) {
          if (!Buffer.from(previous.creationPayloadHash).equals(payloadBytes)) {
            return slhReconciliationBatchFailure('SLH_RECON_BATCH_IDEMPOTENCY_CONFLICT', '该提交标识已用于另一个对账批次', 409)
          }
          return previous.id
        }
        // 锁账单行：并发为同一账单建批次时串行化，配合下面的占用复检保证「一张账单同时只有一个进行中批次」。
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM slh_bills WHERE id = ${billId}::uuid FOR UPDATE`)
        if (locked.length === 0) {
          return slhReconciliationBatchFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
        }
        const bill = await tx.slhBill.findUnique({
          where: { id: billId },
          select: { id: true, slhBillNo: true, supersededById: true },
        })
        if (!bill) {
          return slhReconciliationBatchFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
        }
        if (bill.supersededById !== null) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_CONFLICT', '该账单已被取代，不能再发起对账', 409)
        }
        const inProgress = await tx.slhReconciliationBatch.count({ where: { billId, completedAt: null } })
        if (inProgress > 0) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_CONFLICT', '该账单正在对账中，请先结束当前对账批次', 409)
        }
        const matches = await matchBillUnreconciledLines(tx, billId)
        const matched = matches.flatMap(match => match.loadingItemId === null || match.source === null
          ? []
          : [{ lineId: match.line.id, loadingItemId: match.loadingItemId, source: match.source }])
        if (matched.length === 0) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NO_LINES_TO_RECONCILE', '该账单当前没有可核对的明细行', 409)
        }
        if (input.reconcilableLineIds !== undefined) {
          // 静默算与创建之间柜次数据可能变化：范围不一致就让用户重看，不静默少核对几行。
          const seen = [...input.reconcilableLineIds].sort()
          const current = matched.map(item => item.lineId).sort()
          if (seen.length !== current.length || seen.some((lineId, index) => lineId !== current[index])) {
            return slhReconciliationBatchFailure('SLH_RECON_BATCH_SCOPE_CHANGED', '可核对的行已发生变化，请重新查看核对范围', 409)
          }
        }

        const issuance = await this.numbering.generateScopedInTransaction(tx, {
          ruleCode: BATCH_RULE, consumerCode: BATCH_CONSUMER,
          idempotencyKey: `${context.actorUserId}:${requestKey}`, requestFingerprint: payloadFingerprint,
        })
        const batch = await tx.slhReconciliationBatch.create({
          data: {
            batchNo: issuance.number,
            numberingIssuanceId: issuance.issuanceId,
            billId,
            creationRequestKeyHash: digest(requestKey),
            creationPayloadHash: payloadBytes,
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
            members: {
              create: matched.map(item => ({
                lineId: item.lineId,
                matchedLoadingItemId: item.loadingItemId,
                matchSource: item.source,
              })),
            },
          },
          select: { id: true },
        })
        await this.audit.record(tx, {
          eventType: 'SLH_RECONCILIATION_BATCH_CREATED', outcome: 'SUCCESS', actorType: 'USER',
          actorUserId: context.actorUserId, requestId: context.requestId,
          targetType: 'SLH_RECONCILIATION_BATCH', targetId: batch.id,
          metadata: { batchNo: issuance.number, slhBillNo: bill.slhBillNo, memberCount: matched.length },
        })
        return batch.id
      }, { timeout: 60_000 })
      return await this.queries.detail(created)
    }
    catch (error) { return mapSlhReconciliationBatchError(error) }
  }

  /**
   * 完成批次对账：结束本次对账，解除账单占用。
   *
   * 允许账单仍有未核对的行：剩余行留给下一次对账重新发起。结束是单次动作，
   * 已结束的批次不能再次结束。
   */
  async complete(context: SlhReconciliationBatchCommandContext, id: string): Promise<SlhReconciliationBatchDetailDto> {
    const batchId = slhReconciliationBatchUuid(id)
    try {
      await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, PERMISSION)
        const batch = await tx.slhReconciliationBatch.findUnique({
          where: { id: batchId },
          select: {
            id: true, batchNo: true, completedAt: true,
            bill: { select: { slhBillNo: true } },
            members: { select: { reconciledAt: true } },
          },
        })
        if (!batch) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '对账批次不存在', 404)
        }
        if (batch.completedAt !== null) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_IN_PROGRESS', '该批次已经结束', 409)
        }
        await tx.slhReconciliationBatch.update({
          where: { id: batchId },
          data: {
            completedAt: new Date(), completedById: context.actorUserId,
            updatedById: context.actorUserId, version: { increment: 1 },
          },
        })
        await this.audit.record(tx, {
          eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', outcome: 'SUCCESS', actorType: 'USER',
          actorUserId: context.actorUserId, requestId: context.requestId,
          targetType: 'SLH_RECONCILIATION_BATCH', targetId: batchId,
          metadata: {
            batchNo: batch.batchNo, slhBillNo: batch.bill.slhBillNo,
            memberCount: batch.members.length,
            reconciledMemberCount: batch.members.filter(member => member.reconciledAt !== null).length,
          },
        })
      }, { timeout: 60_000 })
      return await this.queries.detail(batchId)
    }
    catch (error) { return mapSlhReconciliationBatchError(error) }
  }
}
