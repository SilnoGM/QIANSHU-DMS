import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService } from '../../audit/audit.service'
import { SystemNotificationService } from '../../notifications/system-notification.service'
import { PurchaseOrderImageDraftService } from '../order-images/purchase-order-image-draft.service'
import { PurchaseOrderMutationService } from '../purchase-order-mutation.service'
import { PurchaseOrderQueryService } from '../purchase-order-query.service'
import {
  PURCHASE_AUTO_REVIEW_ACTOR_ID,
  PURCHASE_AUTO_REVIEW_DEFAULT_LIMIT,
  PURCHASE_AUTO_REVIEW_LEASE_MS,
  PURCHASE_AUTO_REVIEW_MAX_LIMIT,
  PURCHASE_AUTO_REVIEW_REASON,
} from './purchase-auto-review.constants'
import {
  autoReviewRetryDelayMs,
  classifyAutoReviewFailure,
  classifyAutoReviewOrder,
  type AutoReviewOrderState,
} from './purchase-auto-review.logic'
import { PurchaseAutoReviewService } from './purchase-auto-review.service'

export interface PurchaseAutoReviewScanOptions {
  readonly dryRun: boolean
  readonly limit?: number
  readonly now?: () => Date
}

export interface PurchaseAutoReviewScanSummary {
  readonly status: 'completed'
  readonly dryRun: boolean
  readonly enabled: boolean
  readonly claimed: number
  readonly succeeded: number
  readonly cancelled: number
  readonly retried: number
  readonly failed: number
  readonly notificationFailed: number
  readonly candidates: readonly string[]
}

interface ClaimedJob {
  readonly id: string
  readonly purchaseOrderId: string
  readonly attempts: number
}

type AutoReviewStage = 'PREFLIGHT' | 'PREPARE_MARKS' | 'GENERATE_IMAGE' | 'REVIEW'

interface JobOutcome {
  readonly state: 'SUCCEEDED' | 'CANCELLED' | 'RETRIED' | 'FAILED'
  readonly notificationFailed: boolean
}

const ACTOR_ID = PURCHASE_AUTO_REVIEW_ACTOR_ID

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return PURCHASE_AUTO_REVIEW_DEFAULT_LIMIT
  if (!Number.isSafeInteger(value) || value < 1) {
    return PURCHASE_AUTO_REVIEW_DEFAULT_LIMIT
  }
  return Math.min(value, PURCHASE_AUTO_REVIEW_MAX_LIMIT)
}

function errorCode(error: unknown): string {
  return error instanceof ApiException ? error.code : 'PURCHASE_AUTO_REVIEW_UNEXPECTED'
}

function errorMessage(error: unknown): string {
  return error instanceof ApiException ? error.message : '自动审核执行失败'
}

function truncateError(message: string): string {
  return [...message].slice(0, 500).join('')
}

@Injectable()
export class PurchaseAutoReviewScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoReview: PurchaseAutoReviewService,
    private readonly query: PurchaseOrderQueryService,
    private readonly mutations: PurchaseOrderMutationService,
    private readonly imageDrafts: PurchaseOrderImageDraftService,
    private readonly notifications: SystemNotificationService,
    private readonly audit: AuditService,
  ) {}

  async run(options: PurchaseAutoReviewScanOptions): Promise<PurchaseAutoReviewScanSummary> {
    const now = options.now?.() ?? new Date()
    const limit = normalizeLimit(options.limit)
    const setting = await this.autoReview.read()

    if (options.dryRun) {
      const candidates = setting.enabled ? await this.listDue(now, limit) : []
      return {
        status: 'completed',
        dryRun: true,
        enabled: setting.enabled,
        claimed: 0,
        succeeded: 0,
        cancelled: 0,
        retried: 0,
        failed: 0,
        notificationFailed: 0,
        candidates,
      }
    }

    if (!setting.enabled) {
      // 关闭端点已取消未开始的任务；这里兜底处理切换与扫描之间的并发窗口。
      await this.prisma.purchaseOrderAutoReviewJob.updateMany({
        where: { state: 'PENDING' },
        data: { state: 'CANCELLED', completedAt: now, leaseExpiresAt: null },
      })
      await this.autoReview.touchLastScan(now)
      return {
        status: 'completed',
        dryRun: false,
        enabled: false,
        claimed: 0,
        succeeded: 0,
        cancelled: 0,
        retried: 0,
        failed: 0,
        notificationFailed: 0,
        candidates: [],
      }
    }

    const jobs = await this.claim(now, limit)
    const counts = { succeeded: 0, cancelled: 0, retried: 0, failed: 0, notificationFailed: 0 }
    for (const job of jobs) {
      const outcome = await this.process(job, now)
      if (outcome.state === 'SUCCEEDED') counts.succeeded += 1
      else if (outcome.state === 'CANCELLED') counts.cancelled += 1
      else if (outcome.state === 'RETRIED') counts.retried += 1
      else counts.failed += 1
      if (outcome.notificationFailed) counts.notificationFailed += 1
    }
    await this.autoReview.touchLastScan(now)
    return {
      status: 'completed',
      dryRun: false,
      enabled: true,
      claimed: jobs.length,
      ...counts,
      candidates: [],
    }
  }

  private async listDue(now: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ purchaseOrderId: string }>>(Prisma.sql`
      SELECT "purchase_order_id" AS "purchaseOrderId"
      FROM "purchase_order_auto_review_jobs"
      WHERE (
          "state" = 'PENDING'::"purchase_auto_review_job_state"
          AND "next_attempt_at" <= ${now}
        )
        OR (
          "state" = 'PROCESSING'::"purchase_auto_review_job_state"
          AND "lease_expires_at" IS NOT NULL
          AND "lease_expires_at" < ${now}
        )
      ORDER BY "next_attempt_at" ASC, "created_at" ASC
      LIMIT ${limit}
    `)
    return rows.map(row => row.purchaseOrderId)
  }

  private async claim(now: Date, limit: number): Promise<ClaimedJob[]> {
    const leaseUntil = new Date(now.getTime() + PURCHASE_AUTO_REVIEW_LEASE_MS)
    // 单条语句领取：并发运行靠 SKIP LOCKED 互斥，崩溃导致的 PROCESSING 由租约回收。
    return this.prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "purchase_order_auto_review_jobs"
        WHERE (
            "state" = 'PENDING'::"purchase_auto_review_job_state"
            AND "next_attempt_at" <= ${now}
          )
          OR (
            "state" = 'PROCESSING'::"purchase_auto_review_job_state"
            AND "lease_expires_at" IS NOT NULL
            AND "lease_expires_at" < ${now}
          )
        ORDER BY "next_attempt_at" ASC, "created_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "purchase_order_auto_review_jobs" AS job
      SET "state" = 'PROCESSING'::"purchase_auto_review_job_state",
          "lease_expires_at" = ${leaseUntil},
          "attempts" = job."attempts" + 1,
          "updated_at" = ${now}
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING
        job."id" AS "id",
        job."purchase_order_id" AS "purchaseOrderId",
        job."attempts" AS "attempts"
    `)
  }

  private async loadOrderState(purchaseOrderId: string): Promise<AutoReviewOrderState | null> {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        orderStatus: true,
        fulfillmentStatus: true,
        purchaseType: true,
        productMode: true,
        shippingMarkText: true,
        shippingMarkIssuanceId: true,
        salesOrder: { select: { orderStatus: true } },
        _count: { select: { parts: true } },
        documents: {
          where: { documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    })
    if (order === null) return null
    return {
      orderStatus: order.orderStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      purchaseType: order.purchaseType,
      productMode: order.productMode,
      shippingMarkText: order.shippingMarkText,
      shippingMarkIssuanceId: order.shippingMarkIssuanceId,
      partCount: order._count.parts,
      salesOrderStatus: order.salesOrder?.orderStatus ?? null,
      hasVoucher: order.documents.length > 0,
    }
  }

  private async process(job: ClaimedJob, now: Date): Promise<JobOutcome> {
    const context = {
      actorUserId: ACTOR_ID,
      // 请求标识复用任务 ID：长度固定、可在审计里与任务一一对应。
      requestId: job.id,
    }
    const state = await this.loadOrderState(job.purchaseOrderId)
    if (state === null) {
      return this.finishFailure(
        job,
        now,
        'PREFLIGHT',
        'PURCHASE_ORDER_NOT_FOUND',
        '采购订单不存在',
        false,
      )
    }
    const preflight = classifyAutoReviewOrder(state)
    if (preflight.action === 'DONE') {
      await this.markSucceeded(job.id, now)
      return { state: 'SUCCEEDED', notificationFailed: false }
    }
    if (preflight.action === 'CANCELLED') {
      await this.markCancelled(job.id, now)
      return { state: 'CANCELLED', notificationFailed: false }
    }
    if (preflight.action === 'BLOCKED') {
      return this.finishFailure(
        job,
        now,
        'PREFLIGHT',
        preflight.code,
        preflight.message,
        preflight.retryable,
      )
    }

    let stage: AutoReviewStage = 'PREPARE_MARKS'
    try {
      const detail = await this.query.getById(job.purchaseOrderId, ACTOR_ID)
      if (detail.orderStatus !== 'PENDING_REVIEW') {
        return this.finishFailure(
          job,
          now,
          'PREFLIGHT',
          'PURCHASE_ORDER_STATE_CHANGED',
          '采购订单已不处于待审核状态',
          false,
        )
      }
      const prepared = await this.mutations.prepareReviewShippingMarks(
        context,
        job.purchaseOrderId,
        { expectedVersion: detail.version },
      )
      stage = 'GENERATE_IMAGE'
      const draft = await this.imageDrafts.generate(context, job.purchaseOrderId, {
        expectedVersion: prepared.version,
        regenerate: false,
      })
      stage = 'REVIEW'
      await this.mutations.review(context, job.purchaseOrderId, {
        expectedVersion: prepared.version,
        imageDraftId: draft.id,
        reason: PURCHASE_AUTO_REVIEW_REASON,
      })
      await this.markSucceeded(job.id, now)
      return { state: 'SUCCEEDED', notificationFailed: false }
    }
    catch (error) {
      const code = errorCode(error)
      const message = errorMessage(error)
      // 状态冲突后重读：人工已审核/已取消不算失败，避免把并发人工操作记成自动任务错误。
      if (code === 'PURCHASE_ORDER_STATE_CHANGED' || code === 'PURCHASE_ORDER_IMAGE_NOT_ALLOWED') {
        const latest = await this.loadOrderState(job.purchaseOrderId)
        if (latest !== null) {
          const recheck = classifyAutoReviewOrder(latest)
          if (recheck.action === 'DONE') {
            await this.markSucceeded(job.id, now)
            return { state: 'SUCCEEDED', notificationFailed: false }
          }
          if (recheck.action === 'CANCELLED') {
            await this.markCancelled(job.id, now)
            return { state: 'CANCELLED', notificationFailed: false }
          }
        }
      }
      return this.finishFailure(
        job,
        now,
        stage,
        code,
        message,
        classifyAutoReviewFailure(code) === 'RETRYABLE',
      )
    }
  }

  private async markSucceeded(jobId: string, now: Date): Promise<void> {
    await this.prisma.purchaseOrderAutoReviewJob.update({
      where: { id: jobId },
      data: {
        state: 'SUCCEEDED',
        completedAt: now,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    })
  }

  private async markCancelled(jobId: string, now: Date): Promise<void> {
    await this.prisma.purchaseOrderAutoReviewJob.update({
      where: { id: jobId },
      data: {
        state: 'CANCELLED',
        completedAt: now,
        leaseExpiresAt: null,
      },
    })
  }

  private async finishFailure(
    job: ClaimedJob,
    now: Date,
    stage: AutoReviewStage,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<JobOutcome> {
    const delay = retryable ? autoReviewRetryDelayMs(job.attempts) : null
    if (delay !== null) {
      await this.prisma.purchaseOrderAutoReviewJob.update({
        where: { id: job.id },
        data: {
          state: 'PENDING',
          nextAttemptAt: new Date(now.getTime() + delay),
          leaseExpiresAt: null,
          lastErrorCode: code.slice(0, 64),
          lastErrorMessage: truncateError(message),
        },
      })
      return { state: 'RETRIED', notificationFailed: false }
    }

    // 任务终态与审计同事务：审计写不进去时租约到期可重试，不会出现「已转人工但无审计」。
    await this.prisma.$transaction(async transaction => {
      await transaction.purchaseOrderAutoReviewJob.update({
        where: { id: job.id },
        data: {
          state: 'FAILED',
          completedAt: now,
          leaseExpiresAt: null,
          lastErrorCode: code.slice(0, 64),
          lastErrorMessage: truncateError(message),
        },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.PURCHASE_ORDER_AUTO_REVIEW_FAILED,
        outcome: AuditOutcome.FAILURE,
        actorType: AuditActorType.USER,
        actorUserId: ACTOR_ID,
        requestId: job.id,
        targetType: 'PURCHASE_ORDER',
        targetId: job.purchaseOrderId,
        reasonCode: code.slice(0, 128),
        metadata: {
          stage,
          errorCode: code.slice(0, 128),
          attempts: job.attempts,
        },
      })
    })
    const notified = await this.notifyReviewers(job.purchaseOrderId)
    return { state: 'FAILED', notificationFailed: !notified }
  }

  private async notifyReviewers(purchaseOrderId: string): Promise<boolean> {
    try {
      const detail = await this.query.getById(purchaseOrderId, ACTOR_ID)
      await this.notifications.publish({
        eventType: 'PURCHASE_REVIEW_PENDING',
        source: { type: 'PURCHASE_ORDER', id: purchaseOrderId },
        target: { kind: 'PERMISSION', permissionCode: 'purchase-orders:review' },
        variables: {
          orderNo: detail.orderNo,
          orderId: purchaseOrderId,
          vendorName: detail.supplier.label,
          totalAmount: detail.purchaseTotalAmount,
          currencyCode: detail.currencyCode,
          lineCount: detail.lineSummary.lineCount,
          partCount: detail.partCount,
          customerName: detail.customerName ?? '—',
        },
        dedupeKey: `purchase-review:${purchaseOrderId}`,
        requestedByUserId: ACTOR_ID,
      })
      return true
    }
    catch {
      // 通知入队失败不回滚任务终态；人工仍可在待审核列表看到该单。
      return false
    }
  }
}
