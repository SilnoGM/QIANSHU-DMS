import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import {
  SLH_BILL_FINANCE_SETTLEMENT_FEE_CONSUMER,
  SLH_BILL_FINANCE_SETTLEMENT_RECONCILE_CONSUMER,
  SLH_BILL_FINANCE_SETTLEMENT_SOURCE,
  SLH_BILL_SETTLEMENT_FEE_POSTING_TYPE,
  SLH_BILL_SETTLEMENT_POSTING_TYPE,
} from '../fund-accounts/application/fund-bill-settlement'
import { FundPostingService } from '../fund-accounts/application/fund-posting.contract'
import type { FundBusinessTransactionContext, PostBusinessEventInput } from '../fund-accounts/application/fund-posting.contract'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  deriveSalesOrderPaymentStatus,
  formatSalesOrderAmountUnits,
  sumSalesOrderReceivedUnits,
} from '../sales-orders/domain/sales-order-decimal'
import { SalesOrderAutomaticStateService } from '../sales-orders/sales-order-automatic-state.service'
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
/** 完成批次入账的摘要：结算与金流费用是两个独立动作、两条资金流水。 */
const COMPLETION_SETTLEMENT_SUMMARY = '顺联航账单对账结算'
const COMPLETION_FEE_SUMMARY = '顺联航账单全流程金流费用'
/** 代收回填收款的收款方式：受控字典值，数据库形状约束锁定同一值。 */
const COD_SETTLEMENT_PAYMENT_METHOD = 'BILL_COD_SETTLEMENT'
/** 代收回填收款的固定备注。 */
const COD_SETTLEMENT_PAYMENT_REMARK = 'COD代收货款顺联航账单结算'

export interface SlhReconciliationBatchCommandContext { actorUserId: string, requestId: string }

/**
 * 完成批次逐行入账所需的最小事实：成员行 + 该行当前有效（ACTIVE）的结算记录。
 * 同一成员行的历史记录已被取代，不作为入账依据。
 */
interface CompletedBatchMemberRecord {
  readonly id: string
  readonly lineId: string
  readonly reconciledAt: Date | null
  readonly line: { readonly lineNumber: number }
  readonly settlements: readonly {
    readonly id: string
    readonly salesOrderId: string
    readonly settlementAmountCny: Prisma.Decimal | null
    readonly paymentFeeAmountCny: Prisma.Decimal | null
    readonly codAmountTwd: Prisma.Decimal | null
    readonly createdAt: Date
    readonly rateSource: string
    readonly foreignUnitsPerCny: Prisma.Decimal
  }[]
}

/** 完成事务里成员与它当前有效结算的配对：回填、入账与超收退回都以它为最小单位。 */
type ReconciledMemberSettlement = {
  readonly member: CompletedBatchMemberRecord
  readonly settlement: CompletedBatchMemberRecord['settlements'][number]
}

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
    private readonly funds: FundPostingService,
    private readonly salesOrderStates: SalesOrderAutomaticStateService,
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
        // 顺联航对账域只支持台币销售单与台币账单（代收回填按 1:1）。非台币订单在创建口拒绝，
        // 不进入批次后静默按 1:1 回填；销售来源缺失的行不在此断言范围（结算与完成时会单独拦）。
        const foreignCurrency = await tx.containerLoadingItem.findFirst({
          where: {
            id: { in: matched.map(item => item.loadingItemId) },
            shipment: { purchaseOrder: { salesOrder: { currencyCode: { not: 'TWD' } } } },
          },
          select: { id: true },
        })
        if (foreignCurrency !== null) {
          return slhReconciliationBatchFailure('SLH_RECON_SALES_CURRENCY_UNSUPPORTED', '该账单匹配到非台币销售订单，当前对账仅支持台币订单', 409)
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
   * 完成批次对账：结束本次对账，解除账单占用，把每行的核对结果入账并回填代收货款收款。
   *
   * 允许账单仍有未核对的行：剩余行留给下一次对账重新发起。结束是单次动作，
   * 已结束的批次不能再次结束。全部校验、回填、入账与完成同一事务：任一失败整体回滚，
   * 批次保持进行中。唯一的例外是代收超收——同一事务内先把相关行退回未核对、作废其结算记录，
   * 提交这份重置后再以业务失败响应（批次同样保持进行中，等待重新核对）。
   */
  async complete(context: SlhReconciliationBatchCommandContext, id: string): Promise<SlhReconciliationBatchDetailDto> {
    const batchId = slhReconciliationBatchUuid(id)
    try {
      const rejection = await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, PERMISSION)
        // 批次行锁：与「确认结算」串行化，并挡住两个并发完成。
        const lockedBatch = await tx.$queryRaw<Array<{ id: string, completed_at: Date | null }>>(Prisma.sql`
          SELECT "id", "completed_at"
          FROM "slh_reconciliation_batches"
          WHERE "id" = ${batchId}::uuid
          FOR UPDATE
        `)
        const batchRow = lockedBatch[0]
        if (batchRow === undefined) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '对账批次不存在', 404)
        }
        if (batchRow.completed_at !== null) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_IN_PROGRESS', '该批次已经结束', 409)
        }
        const batch = await tx.slhReconciliationBatch.findUnique({
          where: { id: batchId },
          select: {
            id: true, batchNo: true,
            bill: { select: { slhBillNo: true } },
            members: {
              // 成员按账单行号排序：同一事务写入的成员行 created_at 完全相同，只用主键兜底
              // 会让「费用归属哪一行」随随机 uuid 漂移；账单行号是用户可见的稳定顺序。
              orderBy: [{ line: { lineNumber: 'asc' } }, { id: 'asc' }],
              select: {
                id: true, lineId: true, reconciledAt: true,
                line: { select: { lineNumber: true } },
                settlements: {
                  where: { status: 'ACTIVE' },
                  orderBy: { createdAt: 'asc' },
                  select: {
                    id: true, salesOrderId: true, settlementAmountCny: true, paymentFeeAmountCny: true,
                    codAmountTwd: true, createdAt: true,
                    rateSource: true, foreignUnitsPerCny: true,
                  },
                },
              },
            },
          },
        })
        if (!batch) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '对账批次不存在', 404)
        }
        // 完成前必须全部已核对：核对与留痕在结算事务里一起写入，缺留痕的行不能被完成吞掉。
        if (batch.members.some(member => member.reconciledAt === null)) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_UNRECONCILED_MEMBERS', '还有明细行未完成核对，不能完成批次对账', 409)
        }
        const reconciled = batch.members.flatMap(member => member.settlements.map(settlement => ({ member, settlement })))
        if (reconciled.length !== batch.members.length) {
          return slhReconciliationBatchFailure('SLH_RECON_BATCH_STATE_CHANGED', '批次核对留痕不完整，请刷新后重试', 409)
        }
        let postingBatchIds: readonly string[] = []
        let backfilledPaymentCount = 0
        if (reconciled.length > 0) {
          const writeBack = await this.postCompletionSettlement(tx, context, batch, reconciled)
          if (writeBack.kind === 'REJECTED') {
            return writeBack
          }
          postingBatchIds = writeBack.postingBatchIds
          backfilledPaymentCount = writeBack.backfilledPaymentCount
        }
        await tx.slhReconciliationBatch.update({
          where: { id: batchId },
          data: {
            completedAt: new Date(), completedById: context.actorUserId,
            updatedById: context.actorUserId, version: { increment: 1 },
          },
        })
        // 订单状态收敛必须放在批次标记完成之后：完成判定要求「该订单的所有批次都已结束」，
        // 本批次刚结束的事实要先在同一事务里落库，再按订单重评（判决读的是事务内的先后状态）。
        // 已在待对账且对账已完结（口径 R3）的订单会在此自动完成；其余停在待对账等下一次事件。
        let autoCompletedOrderCount = 0
        for (const orderId of [...new Set(reconciled.map(entry => entry.settlement.salesOrderId))].sort()) {
          if (await this.salesOrderStates.advanceWhenEligible(tx, context, orderId, 'RECONCILIATION') === 'COMPLETED') {
            autoCompletedOrderCount += 1
          }
        }
        await this.audit.record(tx, {
          eventType: 'SLH_RECONCILIATION_BATCH_COMPLETED', outcome: 'SUCCESS', actorType: 'USER',
          actorUserId: context.actorUserId, requestId: context.requestId,
          targetType: 'SLH_RECONCILIATION_BATCH', targetId: batchId,
          metadata: {
            batchNo: batch.batchNo, slhBillNo: batch.bill.slhBillNo,
            memberCount: batch.members.length,
            reconciledMemberCount: batch.members.filter(member => member.reconciledAt !== null).length,
            // 审计 metadata 只收标量：单笔入账直接记批次 id，多笔只记数量。
            // 逐笔关联在资金侧可回查（资金批次的 business_id = 结算记录 id）。
            fundPostingCount: postingBatchIds.length,
            fundPostingBatchId: postingBatchIds.length === 1 ? postingBatchIds[0] ?? null : null,
            backfilledPaymentCount,
            autoCompletedOrderCount,
          },
        })
        return null
      }, { timeout: 60_000 })
      if (rejection !== null) {
        return slhReconciliationBatchFailure(rejection.code, rejection.message, 409)
      }
      return await this.queries.detail(batchId)
    }
    catch (error) { return mapSlhReconciliationBatchError(error) }
  }

  /**
   * 完成批次的结算回填：锁内校验（订单可用/币种/取消/待审收款/超收）→ 逐行入账 → 回填 COD 收款
   * → 重算付款状态并驱动「已签收且已付清 → 待对账」的自动推进。
   *
   * 超收不封顶：账单代收合计超出订单实际待收款时，把该订单在本批次的全部已核对行退回未核对、
   * 作废其结算记录，然后拒绝本次完成（重置与检测在同一事务提交，入账与回填都不执行）；
   * 少收只写实收金额，差额留给直付渠道追收。
   * 调用方须已持有批次行锁；销售订单行锁在本方法内按既有锁序取得。
   */
  private async postCompletionSettlement(
    tx: Prisma.TransactionClient,
    context: SlhReconciliationBatchCommandContext,
    batch: { readonly id: string, readonly batchNo: string, readonly bill: { readonly slhBillNo: string } },
    reconciled: readonly ReconciledMemberSettlement[],
  ): Promise<
    | { readonly kind: 'REJECTED', readonly code: string, readonly message: string }
    | { readonly kind: 'POSTED', readonly postingBatchIds: readonly string[], readonly backfilledPaymentCount: number }
  > {
    const orderIds = [...new Set(reconciled.map(entry => entry.settlement.salesOrderId))].sort()
    // 锁序：批次行 → 销售订单行（升序）→ 资金账户，与收款审核/采购付款的「业务行先于账户」一致。
    // 回填的残额判定必须在订单行锁内，否则并发完成或收款审核可能各写一笔越过约定总额。
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "sales_orders"
      WHERE "id" IN (${Prisma.join(orderIds.map(orderId => Prisma.sql`${orderId}::uuid`))})
      ORDER BY "id" FOR UPDATE
    `)
    const orders = await tx.salesOrder.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true, orderNo: true, orderStatus: true, currencyCode: true, agreedTotalAmount: true,
        payments: { select: { amount: true, voidedAt: true } },
        receiptRequests: { where: { status: 'PENDING_REVIEW' }, select: { amount: true } },
      },
    })
    const orderById = new Map(orders.map(order => [order.id, order]))
    // 超收检测：账单代收合计（本批次该订单全部已核对行）对比实际待收款（锁内重读）。
    const overcollected: Array<{
      readonly orderId: string
      readonly orderNo: string
      readonly lineNumbers: readonly number[]
      readonly collected: Prisma.Decimal
      readonly outstanding: Prisma.Decimal
    }> = []
    for (const orderId of orderIds) {
      const order = orderById.get(orderId)
      if (order === undefined) {
        return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_SOURCE_MISSING', '这一行的销售订单已不可用，暂时无法入账', 409)
      }
      // 创建与结算都已断言台币；这里再挡一次，避免非台币订单被按 1:1 回填。
      if (order.currencyCode !== 'TWD') {
        return slhReconciliationBatchFailure('SLH_RECON_SALES_CURRENCY_UNSUPPORTED', '销售订单不是台币，暂不支持对账', 409)
      }
      if (order.orderStatus === 'CANCELLED') {
        return slhReconciliationBatchFailure('SLH_RECON_BATCH_STATE_CHANGED', `销售订单 ${order.orderNo} 已取消，请刷新核对`, 409)
      }
      const entries = reconciled.filter(entry => entry.settlement.salesOrderId === orderId)
      let collected = new Prisma.Decimal(0)
      for (const entry of entries) {
        if (entry.settlement.codAmountTwd !== null) {
          collected = collected.plus(entry.settlement.codAmountTwd)
        }
      }
      const received = new Prisma.Decimal(formatSalesOrderAmountUnits(sumSalesOrderReceivedUnits(order.payments)))
      const outstanding = order.agreedTotalAmount.minus(received)
      // 回填会顶到数据库的「待审核收款预留金额」不变量：叠加后超过约定总额时先让财务处理申请，
      // 否则收尾的订单更新会以延迟约束失败回滚，报出无法理解的系统错误。
      const pending = order.receiptRequests.reduce((sum, request) => sum.plus(request.amount), new Prisma.Decimal(0))
      if (pending.gt(0) && received.plus(collected).plus(pending).gt(order.agreedTotalAmount)) {
        return slhReconciliationBatchFailure('SLH_RECON_BATCH_PENDING_RECEIPTS', `销售订单 ${order.orderNo} 的待审核收款与代收回填金额叠加超过约定总额，请先处理收款申请`, 409)
      }
      if (collected.gt(outstanding)) {
        overcollected.push({
          orderId, orderNo: order.orderNo,
          lineNumbers: entries.map(entry => entry.member.line.lineNumber),
          collected, outstanding,
        })
      }
    }
    if (overcollected.length > 0) {
      // 重置范围＝该订单在本批次的全部已核对行：金额互相牵连，只退回触发行重新核对仍可能对不上。
      const rejectedOrderIds = new Set(overcollected.map(item => item.orderId))
      const rejected = reconciled.filter(entry => rejectedOrderIds.has(entry.settlement.salesOrderId))
      await tx.slhReconciliationBatchLine.updateMany({
        where: { id: { in: rejected.map(entry => entry.member.id) } },
        data: { reconciledAt: null, reconciledById: null },
      })
      // 账单行的核对标记是账单三态的唯一来源，与批次进度一起退回。
      await tx.slhBillLine.updateMany({
        where: { id: { in: rejected.map(entry => entry.member.lineId) } },
        data: { reconciledAt: null },
      })
      // 已核对记录作废：结算记录只允许 ACTIVE → SUPERSEDED 的受控转换，历史留在核对记录里可查。
      await tx.slhReconciliationSettlement.updateMany({
        where: { batchLineId: { in: rejected.map(entry => entry.member.id) }, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED' },
      })
      const detail = overcollected
        .map(item => `第 ${item.lineNumbers.join('、')} 行（订单 ${item.orderNo}）：账单代收合计 NT$${item.collected.toFixed(2)} 超出实际待收款 NT$${item.outstanding.toFixed(2)}`)
        .join('；')
      const message = [...`${detail}，本行未核对正确，已退回重新核对`].slice(0, 500).join('')
      await this.audit.record(tx, {
        eventType: 'SLH_RECONCILIATION_BATCH_COMPLETION_REJECTED', outcome: 'SUCCESS', actorType: 'USER',
        actorUserId: context.actorUserId, requestId: context.requestId,
        targetType: 'SLH_RECONCILIATION_BATCH', targetId: batch.id,
        metadata: {
          batchNo: batch.batchNo, slhBillNo: batch.bill.slhBillNo,
          rejectedOrderCount: overcollected.length,
          rejectedMemberCount: rejected.length,
          firstRejectedOrderNo: overcollected[0]?.orderNo ?? null,
          firstCollectedTwd: overcollected[0]?.collected.toFixed(2) ?? null,
          firstOutstandingTwd: overcollected[0]?.outstanding.toFixed(2) ?? null,
        },
      })
      return { kind: 'REJECTED', code: 'SLH_RECON_SETTLEMENT_COD_OVERCOLLECTED', message }
    }
    // 入账先于回填：回填收款要绑定该行 RECONCILE 入账的资金批次（金额为零的结算行没有批次，绑空）。
    const posted = await this.postCompletedMembers(tx, context, batch, reconciled)
    let backfilledPaymentCount = 0
    for (const entry of reconciled) {
      const cod = entry.settlement.codAmountTwd
      if (cod === null || cod.isZero()) {
        continue
      }
      await tx.salesOrderPayment.create({
        data: {
          salesOrderId: entry.settlement.salesOrderId,
          paymentType: 'COD_BALANCE',
          amount: cod,
          // 收款时间＝结算时间；备注固定文案，来源靠 origin 标识。
          receivedAt: entry.settlement.createdAt,
          paymentMethod: COD_SETTLEMENT_PAYMENT_METHOD,
          remark: COD_SETTLEMENT_PAYMENT_REMARK,
          createdByUserId: context.actorUserId,
          origin: 'COD_SETTLEMENT',
          slhReconciliationSettlementId: entry.settlement.id,
          fundPostingBatchId: posted.reconcileBatchIdBySettlementId.get(entry.settlement.id) ?? null,
        },
      })
      backfilledPaymentCount += 1
    }
    // 回填后按订单重算付款状态并驱动自动推进（与收款审核同一条派生链路）。
    for (const orderId of orderIds) {
      await this.refreshSalesOrderPaymentStatus(tx, context, batch, orderId)
    }
    return { kind: 'POSTED', postingBatchIds: posted.postingBatchIds, backfilledPaymentCount }
  }

  /**
   * 回填后重算订单付款状态：与销售域的派生口径同源（未作废收款累加对约定总额）。
   * 订单状态收敛不在这里做——自动状态服务的完成判定要求「该订单的所有批次都已结束」，
   * 必须等批次标记完成后再统一驱动（见 complete() 的时序说明）。
   */
  private async refreshSalesOrderPaymentStatus(
    tx: Prisma.TransactionClient,
    context: SlhReconciliationBatchCommandContext,
    batch: { readonly bill: { readonly slhBillNo: string } },
    salesOrderId: string,
  ): Promise<void> {
    const order = await tx.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        id: true, paymentStatus: true, agreedTotalAmount: true,
        payments: { select: { amount: true, voidedAt: true } },
      },
    })
    if (order === null) {
      return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_SOURCE_MISSING', '这一行的销售订单已不可用，暂时无法入账', 409)
    }
    const received = formatSalesOrderAmountUnits(sumSalesOrderReceivedUnits(order.payments))
    const newStatus = deriveSalesOrderPaymentStatus(order.agreedTotalAmount.toFixed(2), received)
    if (newStatus !== order.paymentStatus) {
      await tx.salesOrder.update({
        where: { id: order.id },
        data: { paymentStatus: newStatus, version: { increment: 1 } },
      })
      await tx.salesOrderStatusHistory.create({
        data: {
          salesOrderId: order.id,
          dimension: 'PAYMENT',
          fromStatus: order.paymentStatus,
          toStatus: newStatus,
          reason: `顺联航账单 ${batch.bill.slhBillNo} 结算回填代收货款，重算累计有效收款 ${received}，约定总额 ${order.agreedTotalAmount.toFixed(2)}`,
          changedByUserId: context.actorUserId,
        },
      })
    }
  }

  /**
   * 逐行入账：每行的依据是它最新的有效核对（ACTIVE 结算记录），结算金额与金流费用
   * 各成一条独立资金流水，不做同出单人合并；资金归属人取销售订单出单人（不是当前操作人）。
   * 结算金额为空或为 0、金流费用为空或为 0 时跳过该笔；两者都跳过时这一行不产生资金流水，
   * 因此「没有任何可入账内容」的批次完成仍然成功、只是零流水。
   *
   * **结算与费用的记账单位不同**：结算金额是本行的钱（代收/杂费/应付），逐行各入一笔；
   * 金流费用是对**整张销售订单的销售金额**收的（销售金额 ÷ 汇率 × 费率），而一个销售单可能
   * 对应多行账单（多货件，或一个货件装柜时拆成多个唛头/装柜行），逐行入账会按行数翻倍。
   * 因此费用按销售单去重：同一销售单只入一次，以**首次遇到的那一行**的汇率快照与费用为准，
   * 已入过就跳过（不重算、不补差）。
   *
   * 返回值同时给出「结算记录 id → RECONCILE 入账批次 id」的映射：代收回填收款要绑定它。
   */
  private async postCompletedMembers(
    tx: Prisma.TransactionClient,
    context: SlhReconciliationBatchCommandContext,
    batch: { readonly id: string, readonly batchNo: string, readonly bill: { readonly slhBillNo: string } },
    reconciled: readonly ReconciledMemberSettlement[],
  ): Promise<{ postingBatchIds: string[], reconcileBatchIdBySettlementId: Map<string, string> }> {
    if (reconciled.length === 0) {
      return { postingBatchIds: [], reconcileBatchIdBySettlementId: new Map() }
    }
    const salesOrderIds = [...new Set(reconciled.map(entry => entry.settlement.salesOrderId))]
    const orders = await tx.salesOrder.findMany({
      where: { id: { in: salesOrderIds } },
      select: { id: true, orderNo: true, issuerUserId: true },
    })
    const orderById = new Map(orders.map(order => [order.id, order]))
    // 已收过费用的销售单：按业务身份查（source + consumer + business_id = 销售单），
    // 不能只靠幂等键——不同结算记录触发的费用 memo 不同，同键会被资金层判为幂等冲突而不是重放。
    const charged = await tx.fundPostingBatch.findMany({
      where: {
        businessSourceCodeSnapshot: SLH_BILL_FINANCE_SETTLEMENT_SOURCE,
        consumerCode: SLH_BILL_FINANCE_SETTLEMENT_FEE_CONSUMER,
        businessId: { in: salesOrderIds },
      },
      select: { businessId: true },
    })
    const feeChargedOrderIds = new Set(charged.map(row => row.businessId))
    const metadata = (memberId: string, settlementId: string, salesOrderNo: string, rateSource: string, foreignUnitsPerCny: string) => ({
      slhReconciliationBatchId: batch.id,
      slhReconciliationBatchNo: batch.batchNo,
      slhReconciliationBatchLineId: memberId,
      slhReconciliationSettlementId: settlementId,
      slhReconciliationSalesOrderNo: salesOrderNo,
      slhBillNo: batch.bill.slhBillNo,
      rateSource,
      foreignUnitsPerCny,
    })
    const entries: Array<{
      readonly kind: 'RECONCILE' | 'FEE'
      readonly settlementId: string | null
      readonly context: FundBusinessTransactionContext
      readonly input: PostBusinessEventInput
    }> = []
    for (const { member, settlement } of reconciled) {
      const order = orderById.get(settlement.salesOrderId)
      if (order === undefined) {
        return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_SOURCE_MISSING', '这一行的销售订单已不可用，暂时无法入账', 409)
      }
      const rateSource = settlement.rateSource
      const foreignUnitsPerCny = settlement.foreignUnitsPerCny.toFixed(4)
      const settlementAmount = settlement.settlementAmountCny
      if (settlementAmount !== null && !settlementAmount.isZero()) {
        entries.push({
          kind: 'RECONCILE',
          settlementId: settlement.id,
          context: { ...context, sourceCode: SLH_BILL_FINANCE_SETTLEMENT_SOURCE, consumerCode: SLH_BILL_FINANCE_SETTLEMENT_RECONCILE_CONSUMER },
          input: {
            postingTypeCode: SLH_BILL_SETTLEMENT_POSTING_TYPE, userId: order.issuerUserId,
            amount: settlementAmount.toFixed(2), businessId: settlement.id, businessNo: batch.batchNo,
            summary: COMPLETION_SETTLEMENT_SUMMARY,
            metadata: metadata(member.id, settlement.id, order.orderNo, rateSource, foreignUnitsPerCny),
            idempotencyKey: `${settlement.id}:RECONCILE`,
          },
        })
      }
      const feeAmount = settlement.paymentFeeAmountCny
      // 本批内同一销售单的后续行也不重复入：集合在构建过程中就地扩充。
      if (feeAmount !== null && feeAmount.gt(0) && !feeChargedOrderIds.has(order.id)) {
        feeChargedOrderIds.add(order.id)
        entries.push({
          kind: 'FEE',
          settlementId: null,
          context: { ...context, sourceCode: SLH_BILL_FINANCE_SETTLEMENT_SOURCE, consumerCode: SLH_BILL_FINANCE_SETTLEMENT_FEE_CONSUMER },
          input: {
            postingTypeCode: SLH_BILL_SETTLEMENT_FEE_POSTING_TYPE, userId: order.issuerUserId,
            amount: feeAmount.toFixed(2), businessId: order.id, businessNo: order.orderNo,
            summary: COMPLETION_FEE_SUMMARY,
            metadata: metadata(member.id, settlement.id, order.orderNo, rateSource, foreignUnitsPerCny),
            idempotencyKey: `${order.id}:FEE`,
          },
        })
      }
    }
    if (entries.length === 0) {
      return { postingBatchIds: [], reconcileBatchIdBySettlementId: new Map() }
    }
    // 跨行批量入账先取齐账户集合并统一排序加锁：逐笔锁用户/公司组合可能形成反序等待。
    await this.funds.lockBusinessEventAccountsInTransaction(tx, entries)
    const postingBatchIds: string[] = []
    const reconcileBatchIdBySettlementId = new Map<string, string>()
    for (const entry of entries) {
      // 预览与入账共用当前事务：规则版本、比例、账户金额任一并发变化都会以并发冲突失败并整体回滚。
      const preview = await this.funds.previewBusinessEventInTransaction(tx, entry.context, entry.input)
      const posting = await this.funds.postBusinessEventInTransaction(tx, entry.context, entry.input, preview)
      postingBatchIds.push(posting.batchId)
      if (entry.kind === 'RECONCILE' && entry.settlementId !== null) {
        reconcileBatchIdBySettlementId.set(entry.settlementId, posting.batchId)
      }
    }
    return { postingBatchIds, reconcileBatchIdBySettlementId }
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
        if (salesOrder.currencyCode !== 'TWD') {
          return slhReconciliationBatchFailure('SLH_RECON_SALES_CURRENCY_UNSUPPORTED', '销售订单不是台币，暂不支持对账', 409)
        }
        const rate = await this.resolveSettlementRate(tx, input.rateSource, batch.billId, batch.bill.embeddedForeignUnitsPerCny)
        if (!new Prisma.Decimal(rate).equals(new Prisma.Decimal(input.rate))) {
          return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_RATE_CHANGED', '该来源的汇率已变化，请重新打开结算弹窗', 409)
        }
        const amounts = resolveSettlementAmounts({
          codAmountTwd: member.line.codAmountTwd?.toFixed(2) ?? null,
          ntdSurchargeAmountTwd: member.line.ntdSurchargeAmountTwd?.toFixed(2) ?? null,
          payableAmountCny: member.line.payableAmountCny?.toFixed(2) ?? null,
          salesAmount: salesOrder.agreedTotalAmount.toFixed(2),
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
          foreignUnitsPerCny: active.foreignUnitsPerCny.toFixed(4),
          paymentFeeRate: active.paymentFeeRate.toFixed(3),
          codAmountTwd: active.codAmountTwd?.toFixed(2) ?? null,
          ntdSurchargeAmountTwd: active.ntdSurchargeAmountTwd?.toFixed(2) ?? null,
          payableAmountCny: active.payableAmountCny?.toFixed(2) ?? null,
          settlementAmountCny: active.settlementAmountCny?.toFixed(2) ?? null,
          salesAmount: active.salesAmount?.toFixed(2) ?? null,
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
      return embeddedRate.toFixed(4)
    }
    const rate = await tx.exchangeRate.findFirst({
      where: { currency: { code: SETTLEMENT_SYSTEM_RATE_CURRENCY } },
      select: { foreignUnitsPerCny: true },
    })
    if (rate === null) {
      return slhReconciliationBatchFailure('SLH_RECON_SETTLEMENT_RATE_UNAVAILABLE', '当前没有可用的系统汇率', 409)
    }
    return rate.foreignUnitsPerCny.toFixed(4)
  }

  /** 读回刚写入的结算结果，供接口返回（不额外暴露列表读接口）。 */
  private async readSettlement(id: string): Promise<SlhReconciliationSettlementDto> {
    const row = await this.prisma.slhReconciliationSettlement.findUnique({
      where: { id },
      select: {
        id: true, batchLineId: true, status: true, rateSource: true,
        foreignUnitsPerCny: true, paymentFeeRate: true, createdAt: true,
        createdBy: { select: { displayName: true, profile: { select: { avatarUrl: true } } } },
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
      foreignUnitsPerCny: row.foreignUnitsPerCny.toFixed(4),
      paymentFeeRate: row.paymentFeeRate.toFixed(3),
      createdByDisplayName: row.createdBy.displayName,
      createdByAvatarUrl: row.createdBy.profile?.avatarUrl ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  }
}
