import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { PERSON_REFERENCE_SELECT, toNullablePersonReference } from '../../../infrastructure/database/person-reference'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService } from '../../audit/audit.service'
import { isCanonicalPurchaseOrderActorId } from '../purchase-order-command.normalizer'
import { purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import { PURCHASE_AUTO_REVIEW_SETTINGS_ID } from './purchase-auto-review.constants'
import type { PurchaseAutoReviewSettingDto } from './purchase-auto-review.dto'

const REQUEST_ID_MAXIMUM_CODE_POINTS = 64

export interface PurchaseAutoReviewContext {
  readonly actorUserId: string
  readonly requestId: string
}

interface PurchaseAutoReviewUpdateInput {
  readonly enabled: boolean
  readonly expectedVersion: number
}

function internalError(): ApiException {
  return new ApiException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function validateContext(
  context: PurchaseAutoReviewContext,
): PurchaseAutoReviewContext {
  if (
    !isCanonicalPurchaseOrderActorId(context.actorUserId)
    || typeof context.requestId !== 'string'
    || context.requestId.length < 1
    || [...context.requestId].length > REQUEST_ID_MAXIMUM_CODE_POINTS
  ) {
    throw internalError()
  }
  return context
}

function normalizeUpdateInput(input: unknown): PurchaseAutoReviewUpdateInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return purchaseOrderValidationFailure('body')
  }
  const body = input as Record<string, unknown>
  if (Object.keys(body).some(key => !['enabled', 'expectedVersion'].includes(key))) {
    return purchaseOrderValidationFailure('body')
  }
  if (typeof body.enabled !== 'boolean') {
    return purchaseOrderValidationFailure('enabled')
  }
  if (
    typeof body.expectedVersion !== 'number'
    || !Number.isSafeInteger(body.expectedVersion)
    || body.expectedVersion < 1
  ) {
    return purchaseOrderValidationFailure('expectedVersion')
  }
  return { enabled: body.enabled, expectedVersion: body.expectedVersion }
}

@Injectable()
export class PurchaseAutoReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 采购单创建事务开始前读取快照：值在本次请求内固定，避免 Serializable 事务
   * 与管理员切换开关互相产生序列化冲突。
   */
  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.purchaseAutoReviewSettings.findUnique({
      where: { id: PURCHASE_AUTO_REVIEW_SETTINGS_ID },
      select: { enabled: true },
    })
    return row?.enabled === true
  }

  /** 与采购单创建同一事务写入，保证「订单存在」与「任务存在」原子一致。 */
  async enqueueForOrder(
    transaction: Prisma.TransactionClient,
    purchaseOrderId: string,
  ): Promise<void> {
    await transaction.purchaseOrderAutoReviewJob.create({
      data: { purchaseOrderId },
    })
  }

  async read(): Promise<PurchaseAutoReviewSettingDto> {
    const [row, pendingJobCount, failedJobCount] = await Promise.all([
      this.prisma.purchaseAutoReviewSettings.findUnique({
        where: { id: PURCHASE_AUTO_REVIEW_SETTINGS_ID },
        select: {
          enabled: true,
          version: true,
          updatedAt: true,
          lastScanAt: true,
          updatedBy: { select: PERSON_REFERENCE_SELECT },
        },
      }),
      this.prisma.purchaseOrderAutoReviewJob.count({
        where: { state: { in: ['PENDING', 'PROCESSING'] } },
      }),
      this.prisma.purchaseOrderAutoReviewJob.count({
        where: { state: 'FAILED' },
      }),
    ])
    if (row === null) throw internalError()
    return {
      enabled: row.enabled,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: toNullablePersonReference(row.updatedBy),
      lastScanAt: row.lastScanAt?.toISOString() ?? null,
      pendingJobCount,
      failedJobCount,
    }
  }

  async update(
    context: PurchaseAutoReviewContext,
    input: unknown,
  ): Promise<PurchaseAutoReviewSettingDto> {
    const trusted = validateContext(context)
    const command = normalizeUpdateInput(input)
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      // 行锁保证并发切换只有一个版本推进；版本不一致由调用方刷新后重试。
      const rows = await transaction.$queryRaw<Array<{ enabled: boolean, version: number }>>(
        Prisma.sql`
          SELECT "enabled", "version"
          FROM "purchase_auto_review_settings"
          WHERE "id" = ${PURCHASE_AUTO_REVIEW_SETTINGS_ID}
          FOR UPDATE
        `,
      )
      const current = rows[0]
      if (current === undefined) throw internalError()
      if (current.version !== command.expectedVersion) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'PURCHASE_AUTO_REVIEW_STATE_CHANGED',
          '自动托管设置已变化，请刷新后重试',
        )
      }
      if (current.enabled === command.enabled) return
      await transaction.purchaseAutoReviewSettings.update({
        where: { id: PURCHASE_AUTO_REVIEW_SETTINGS_ID },
        data: {
          enabled: command.enabled,
          version: { increment: 1 },
          updatedByUserId: trusted.actorUserId,
        },
      })
      // 关闭即停止未开始的任务；处理中的任务让本轮跑完，三步各自独立事务可安全续跑。
      if (!command.enabled) {
        await transaction.purchaseOrderAutoReviewJob.updateMany({
          where: { state: 'PENDING' },
          data: {
            state: 'CANCELLED',
            completedAt: new Date(),
            leaseExpiresAt: null,
          },
        })
      }
      await this.audit.record(transaction, {
        eventType: AuditEventType.PURCHASE_AUTO_REVIEW_SETTING_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: trusted.actorUserId,
        requestId: trusted.requestId,
        targetType: 'PURCHASE_AUTO_REVIEW_SETTING',
        targetId: PURCHASE_AUTO_REVIEW_SETTINGS_ID,
        metadata: {
          enabled: command.enabled,
          previousEnabled: current.enabled,
        },
      })
    })
    return this.read()
  }

  /**
   * 心跳只写 last_scan_at，绕过 Prisma 的 @updatedAt，避免设置页把每分钟的
   * 扫描误报成「设置最后修改时间」。
   */
  async touchLastScan(at: Date): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "purchase_auto_review_settings"
      SET "last_scan_at" = ${at}
      WHERE "id" = ${PURCHASE_AUTO_REVIEW_SETTINGS_ID}
    `)
  }
}

/**
 * 直接构造采购命令服务的测试夹具默认关闭自动托管；Nest 运行时会注入真实服务。
 */
export const noopPurchaseAutoReview = {
  isEnabled: () => Promise.resolve(false),
  enqueueForOrder: () => Promise.resolve(),
} as unknown as PurchaseAutoReviewService
