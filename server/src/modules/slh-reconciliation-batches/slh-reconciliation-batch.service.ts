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
import {
  compareSettlementAmounts, isSameSettlement,
  PAYMENT_FEE_RATE, SETTLEMENT_BILL_AMOUNT_CURRENCY, SETTLEMENT_CURRENCY, SETTLEMENT_SYSTEM_RATE_CURRENCY,
  resolveSettlementAmounts,
} from './slh-reconciliation-settlement.logic'
import { SlhReconciliationBatchQueryService } from './slh-reconciliation-batch-query.service'
import { SlhReconciliationSettlementRateSourceDto } from './slh-reconciliation-batch.dto'
import type {
  SlhReconciliationBatchCreateDto, SlhReconciliationBatchDetailDto,
  SlhReconciliationSettlementCreateDto, SlhReconciliationSettlementDto,
} from './slh-reconciliation-batch.dto'

const PERMISSION = 'slh-bills:reconcile'
/** 批次编号域与消费方：规则由管理员在编号管理页配置，迁移不预置规则。 */
const BATCH_RULE = 'SLH_RECON_BATCH_NO'
const BATCH_CONSUMER = 'SLH_RECON_BATCH.CREATE'
/** 创建语义指纹的格式标记：改口径时必须同时改版本号，避免新旧请求被当成同一个意图。 */
const CREATE_PAYLOAD_FORMAT = 'slh-reconciliation-batch.create.v1'
/** 结算语义指纹的格式标记：口径（含金额与汇率）变化时必须递增。 */
const SETTLEMENT_PAYLOAD_FORMAT = 'slh-reconciliation-settlement.create.v1'

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

  /**
   * 确认结算：把这一行的结算结果留痕。
   *
   * 事务顺序即不变量顺序：幂等键 → 批次行锁 → 准入复检（含批次状态）→ 回表取事实 →
   * 按来源取汇率并与界面值比对 → 重算六个金额并与界面值比对 → 取代旧有效记录 →
   * 写入新记录 → 首次核对时标记成员行与账单行 → 审计。
   * 金额一律由服务端重算：客户端传来的是「界面上看到的」，不一致就拒绝，不静默纠正。
   */
  async settle(
    context: SlhReconciliationBatchCommandContext,
    id: string,
    input: SlhReconciliationSettlementCreateDto,
    key: unknown,
  ): Promise<SlhReconciliationSettlementDto> {
    const batchId = slhReconciliationBatchUuid(id)
    const requestKey = slhReconciliationBatchUuid(key)
    const payloadFingerprint = hash({
      format: SETTLEMENT_PAYLOAD_FORMAT,
      batchLineId: input.batchLineId,
      rateSource: input.rateSource,
      rate: input.rate,
      amounts: input.amounts,
    })
    const payloadBytes = Buffer.from(payloadFingerprint, 'hex')
    try {
      const settlementId = await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, PERMISSION)
        // 幂等锁在落库之前：双击或网络重试只会恢复同一条记录。
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`slh-reconciliation-settlement.create:${context.actorUserId}:${requestKey}`}, 0))`)
        const replay = await tx.slhReconciliationSettlement.findUnique({
          where: {
            createdById_requestKeyHash: {
              createdById: context.actorUserId,
              requestKeyHash: digest(requestKey),
            },
          },
          select: { id: true, payloadHash: true },
        })
        if (replay !== null) {
          if (Buffer.from(replay.payloadHash).equals(payloadBytes)) {
            return replay.id
          }
          return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_KEY_REUSED', '提交标识已被使用，请刷新后重试', 409)
        }
        const batchLineId = slhReconciliationBatchUuid(input.batchLineId)
        const locked = await tx.$queryRaw<Array<{ id: string, completed_at: Date | null }>>(Prisma.sql`SELECT id, completed_at FROM slh_reconciliation_batches WHERE id = ${batchId}::uuid FOR UPDATE`)
        const batchRow = locked[0]
        if (batchRow === undefined) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '对账批次不存在', 404)
        }
        if (batchRow.completed_at !== null) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_IN_PROGRESS', '该批次已经结束，不能再确认结算', 409)
        }
        const batch = await tx.slhReconciliationBatch.findUnique({
          where: { id: batchId },
          select: {
            batchNo: true,
            billId: true,
            bill: { select: { slhBillNo: true, embeddedForeignUnitsPerCny: true } },
            members: {
              where: { id: batchLineId },
              select: {
                id: true, lineId: true, reconciledAt: true,
                line: { select: { reconciledAt: true, codAmountTwd: true, ntdSurchargeAmountTwd: true, payableAmountCny: true, warehouseReceiptReference: true, shippingMarkText: true } },
                matchedLoadingItem: {
                  select: {
                    id: true, containerBatchId: true,
                    containerBatch: { select: { containerBatchName: true } },
                    shipment: {
                      select: {
                        shipmentNo: true,
                        purchaseOrder: {
                          select: {
                            id: true, orderNo: true,
                            salesOrder: { select: { id: true, orderNo: true, currencyCode: true, agreedTotalAmount: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        })
        const member = batch?.members[0]
        if (batch === null || member === undefined) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '批次成员行不存在', 404)
        }
        const purchaseOrder = member.matchedLoadingItem.shipment?.purchaseOrder ?? null
        const salesOrder = purchaseOrder?.salesOrder ?? null
        if (purchaseOrder === null || salesOrder === null) {
          return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_SOURCE_MISSING', '这一行的采购或销售来源缺失，暂时无法结算', 409)
        }
        const rate = await this.resolveSettlementRate(tx, input.rateSource, batch.billId, batch.bill.embeddedForeignUnitsPerCny)
        if (!new Prisma.Decimal(rate).equals(new Prisma.Decimal(input.rate))) {
          return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_RATE_CHANGED', '该来源的汇率已变化，请重新打开结算弹窗', 409)
        }
        const amounts = resolveSettlementAmounts({
          codAmountTwd: member.line.codAmountTwd?.toFixed(2) ?? null,
          ntdSurchargeAmountTwd: member.line.ntdSurchargeAmountTwd?.toFixed(2) ?? null,
          payableAmountCny: member.line.payableAmountCny?.toFixed(2) ?? null,
          salesAmount: salesOrder.agreedTotalAmount.toFixed(4),
          rate,
          paymentFeeRate: PAYMENT_FEE_RATE,
        })
        const mismatched = compareSettlementAmounts(amounts, input.amounts)
        if (mismatched.length > 0) {
          return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_MISMATCH', `结算金额与重算结果不一致：${mismatched.join('、')}`, 409)
        }
        const active = await tx.slhReconciliationSettlement.findFirst({
          where: { batchLineId, status: 'ACTIVE' },
          select: {
            id: true, rateSource: true, foreignUnitsPerCny: true, paymentFeeRate: true,
            codAmountTwd: true, ntdSurchargeAmountTwd: true, payableAmountCny: true,
            settlementAmountCny: true, salesAmount: true, paymentFeeAmountCny: true,
          },
        })
        if (active !== null && isSameSettlement({
          rateSource: active.rateSource,
          foreignUnitsPerCny: active.foreignUnitsPerCny.toFixed(12),
          paymentFeeRate: active.paymentFeeRate.toFixed(12),
          codAmountTwd: active.codAmountTwd?.toFixed(2) ?? null,
          ntdSurchargeAmountTwd: active.ntdSurchargeAmountTwd?.toFixed(2) ?? null,
          payableAmountCny: active.payableAmountCny?.toFixed(2) ?? null,
          settlementAmountCny: active.settlementAmountCny?.toFixed(2) ?? null,
          salesAmount: active.salesAmount?.toFixed(4) ?? null,
          paymentFeeAmountCny: active.paymentFeeAmountCny?.toFixed(2) ?? null,
        }, input.rateSource, rate, amounts)) {
          return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_UNCHANGED', '已有相同的结算结果，未重复记录', 409)
        }
        // 先失效旧记录再写新的有效记录：部分唯一索引保证同一行最多一条有效。
        if (active !== null) {
          await tx.slhReconciliationSettlement.update({
            where: { id: active.id },
            data: { status: 'SUPERSEDED' },
          })
        }
        const created = await tx.slhReconciliationSettlement.create({
          data: {
            batchId,
            batchLineId,
            billId: batch.billId,
            billLineId: member.lineId,
            loadingItemId: member.matchedLoadingItem.id,
            containerBatchId: member.matchedLoadingItem.containerBatchId,
            purchaseOrderId: purchaseOrder.id,
            salesOrderId: salesOrder.id,
            rateSource: input.rateSource,
            foreignUnitsPerCny: rate,
            paymentFeeRate: PAYMENT_FEE_RATE,
            salesOrderNo: salesOrder.orderNo,
            purchaseOrderNo: purchaseOrder.orderNo,
            containerBatchNo: member.matchedLoadingItem.containerBatch.containerBatchName,
            shipmentNo: member.matchedLoadingItem.shipment?.shipmentNo ?? null,
            slhBillNo: batch.bill.slhBillNo,
            warehouseReceiptReference: member.line.warehouseReceiptReference,
            shippingMarkText: member.line.shippingMarkText,
            codAmountTwd: amounts.codAmountTwd,
            codAmountCurrency: SETTLEMENT_BILL_AMOUNT_CURRENCY,
            ntdSurchargeAmountTwd: amounts.ntdSurchargeAmountTwd,
            ntdSurchargeCurrency: SETTLEMENT_BILL_AMOUNT_CURRENCY,
            payableAmountCny: amounts.payableAmountCny,
            payableCurrency: SETTLEMENT_CURRENCY,
            settlementAmountCny: amounts.settlementAmountCny,
            settlementCurrency: SETTLEMENT_CURRENCY,
            salesAmount: amounts.salesAmount,
            salesCurrency: salesOrder.currencyCode,
            paymentFeeAmountCny: amounts.paymentFeeAmountCny,
            paymentFeeCurrency: SETTLEMENT_CURRENCY,
            requestKeyHash: digest(requestKey),
            payloadHash: payloadBytes,
            createdById: context.actorUserId,
          },
          select: { id: true },
        })
        // 首次核对才写核对留痕：重新结算不刷新「首次核对时刻」，批次进度与账单三态都按首次计。
        const reconciledAt = new Date()
        if (member.reconciledAt === null) {
          await tx.slhReconciliationBatchLine.update({
            where: { id: member.id },
            data: { reconciledAt, reconciledById: context.actorUserId },
          })
        }
        if (member.line.reconciledAt === null) {
          await tx.slhBillLine.update({
            where: { id: member.lineId },
            // 账单行的「凭证不可改」触发器只放行 reconciled_at 等白名单列，这里也只改这一列。
            data: { reconciledAt },
          })
        }
        await this.audit.record(tx, {
          eventType: 'SLH_BILL_LINES_RECONCILED', outcome: 'SUCCESS', actorType: 'USER',
          actorUserId: context.actorUserId, requestId: context.requestId,
          targetType: 'SLH_RECONCILIATION_SETTLEMENT', targetId: created.id,
          metadata: {
            batchNo: batch.batchNo, slhBillNo: batch.bill.slhBillNo, batchLineId,
            rateSource: input.rateSource, foreignUnitsPerCny: rate,
            settlementAmountCny: amounts.settlementAmountCny,
            paymentFeeAmountCny: amounts.paymentFeeAmountCny,
            supersededSettlementId: active?.id ?? null,
          },
        })
        return created.id
      }, { timeout: 60_000 })
      return await this.readSettlement(settlementId)
    }
    catch (error) { return mapSlhReconciliationBatchError(error) }
  }

  /** 按来源取当前汇率：系统汇率表口径为台币，账单内置汇率在账单头冻结。 */
  private async resolveSettlementRate(
    tx: Prisma.TransactionClient,
    source: SlhReconciliationSettlementCreateDto['rateSource'],
    billId: string,
    embeddedRate: Prisma.Decimal | null,
  ): Promise<string> {
    if (source === SlhReconciliationSettlementRateSourceDto.EMBEDDED) {
      if (embeddedRate === null) {
        return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_RATE_UNAVAILABLE', '该账单没有内嵌汇率，请改用系统当前汇率', 409)
      }
      return embeddedRate.toFixed(12)
    }
    const rate = await tx.exchangeRate.findFirst({
      where: { currency: { code: SETTLEMENT_SYSTEM_RATE_CURRENCY } },
      select: { foreignUnitsPerCny: true },
    })
    if (rate === null) {
      return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_RATE_UNAVAILABLE', '当前没有可用的系统汇率', 409)
    }
    return rate.foreignUnitsPerCny.toFixed(12)
  }

  /** 读回刚写入的结算结果，供接口返回（不额外暴露列表读接口）。 */
  private async readSettlement(id: string): Promise<SlhReconciliationSettlementDto> {
    const row = await this.prisma.slhReconciliationSettlement.findUnique({
      where: { id },
      select: {
        id: true, batchLineId: true, status: true, rateSource: true,
        foreignUnitsPerCny: true, paymentFeeRate: true, createdAt: true,
        createdBy: { select: { displayName: true } },
      },
    })
    if (row === null) {
      return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '结算结果不存在', 404)
    }
    return {
      id: row.id,
      batchLineId: row.batchLineId,
      status: row.status as SlhReconciliationSettlementDto['status'],
      rateSource: row.rateSource as SlhReconciliationSettlementDto['rateSource'],
      foreignUnitsPerCny: row.foreignUnitsPerCny.toFixed(12),
      paymentFeeRate: row.paymentFeeRate.toFixed(12),
      createdByDisplayName: row.createdBy.displayName,
      createdAt: row.createdAt.toISOString(),
    }
  }
}
