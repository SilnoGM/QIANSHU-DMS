import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { AuditEventType } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { AuditService } from '../audit/audit.service'
import { noopSystemNotifications } from '../notifications/noop-system-notification'
import { SystemNotificationService } from '../notifications/system-notification.service'
import {
  ADVERTISING_RECHARGE_FUND_SOURCE,
  ADVERTISING_RECHARGE_PAY_CONSUMER,
  ADVERTISING_RECHARGE_POSTING_TYPE,
  ADVERTISING_RECHARGE_SUMMARY,
  ADVERTISING_RECHARGE_VOID_CONSUMER,
} from '../fund-accounts/application/fund-advertising-recharge'
import { FundPostingService } from '../fund-accounts/application/fund-posting.contract'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  ADVERTISING_RECHARGE_ERROR_CODES,
  advertisingRechargeFailure,
  mapAdvertisingRechargeError,
} from './advertising-recharge.errors'
import {
  ADVERTISING_RECHARGE_NO_CONSUMER_CODE,
  ADVERTISING_RECHARGE_NO_RULE_CODE,
  ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE,
  ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE,
  type AdvertisingAccountTypeValue,
} from './advertising-recharge.contract'
import type {
  AdvertisingRechargeDto,
  CreateAdvertisingRechargeDto,
  PayAdvertisingRechargeDto,
  RejectAdvertisingRechargeDto,
  VoidAdvertisingRechargeDto,
} from './advertising-recharge.dto'
import { AdvertisingRechargeDocumentService } from './advertising-recharge-document.service'
import { AdvertisingRechargeQueryService } from './advertising-recharge-query.service'
import {
  hashAdvertisingRechargeNumberFingerprint,
  hashAdvertisingRechargeRequestKey,
  normalizeAdvertisingAccountText,
  normalizeAdvertisingRechargeAmount,
  normalizeAdvertisingRechargeCurrency,
  normalizeAdvertisingRechargeReason,
  normalizeAdvertisingRechargeRemark,
  requireAdvertisingRechargeMediaId,
  requireAdvertisingRechargeRequestKey,
} from './advertising-recharge.logic'

export interface AdvertisingRechargeCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

const NOTIFICATION_TIME_FORMAT = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
  day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', month: '2-digit', timeZone: 'Asia/Shanghai', year: 'numeric',
})
function notificationTime(value: Date): string {
  const parts = new Map(NOTIFICATION_TIME_FORMAT.formatToParts(value).map(part => [part.type, part.value]))
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`
}
function accountTypeLabel(value: AdvertisingAccountTypeValue): string {
  return value === 'PERSONAL' ? '个人户' : '非个人户'
}

interface LockedRow {
  readonly applicantUserId: string
  readonly rechargeNo: string
  readonly status: string
  readonly version: number
  readonly accountType: AdvertisingAccountTypeValue
  readonly adAccountName: string
  readonly adAccountNo: string
  readonly rechargeAmount: Prisma.Decimal
  readonly rechargeCurrency: string
  readonly paymentAmountCny: Prisma.Decimal | null
  readonly fundPostingBatchId: string | null
  readonly applicantName: string
}

@Injectable()
export class AdvertisingRechargeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: AdvertisingRechargeQueryService,
    private readonly documents: AdvertisingRechargeDocumentService,
    private readonly funds: FundPostingService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
    private readonly notifications: SystemNotificationService = noopSystemNotifications,
  ) {}

  /**
   * 提交只产生 PENDING 申请，不动资金。提交前先确认申请人有资金账户与分成比例，
   * 让配置问题在运营侧立刻暴露，而不是等到财务付款时才失败。
   */
  async submit(
    context: AdvertisingRechargeCommandContext,
    input: CreateAdvertisingRechargeDto,
    key: unknown,
  ): Promise<AdvertisingRechargeDto> {
    let requestKey: string
    let amount: string
    let currency: string
    let adAccountName: string
    let adAccountNo: string
    let remark: string | null
    let qrMediaAssetId: string | null
    try {
      requestKey = requireAdvertisingRechargeRequestKey(key)
      amount = normalizeAdvertisingRechargeAmount(input.rechargeAmount)
      currency = normalizeAdvertisingRechargeCurrency(input.rechargeCurrency)
      adAccountName = normalizeAdvertisingAccountText(input.adAccountName, '广告账户名称')
      adAccountNo = normalizeAdvertisingAccountText(input.adAccountNo, '广告账户编号')
      remark = normalizeAdvertisingRechargeRemark(input.remark)
      qrMediaAssetId = input.paymentQrMediaAssetId == null
        ? null
        : requireAdvertisingRechargeMediaId(input.paymentQrMediaAssetId)
    }
    catch {
      advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.VALIDATION_FAILED,
        '申请内容无效，请核对金额、币种与广告账户信息',
      )
    }
    if (input.accountType === 'PERSONAL' && qrMediaAssetId === null) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.QR_REQUIRED, '个人户必须上传收款二维码')
    }
    if (input.accountType === 'NON_PERSONAL' && qrMediaAssetId !== null) {
      advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.VALIDATION_FAILED,
        '非个人户不需要收款二维码，请重新选择账户类型',
      )
    }

    try {
      const id = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await transaction.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${['advertising-recharge.create:', context.actorUserId, ':', requestKey].join('')}, 0)
          )
        `)
        const requestKeyHash = hashAdvertisingRechargeRequestKey(requestKey)
        const previous = await transaction.advertisingRechargeRequest.findUnique({
          where: { applicantUserId_requestKeyHash: { applicantUserId: context.actorUserId, requestKeyHash } },
          select: {
            id: true,
            accountType: true,
            adAccountName: true,
            adAccountNo: true,
            rechargeAmount: true,
            rechargeCurrency: true,
            paymentQrMediaAssetId: true,
            remark: true,
          },
        })
        if (previous !== null) {
          const same = previous.accountType === input.accountType
            && previous.adAccountName === adAccountName
            && previous.adAccountNo === adAccountNo
            && previous.rechargeAmount.toFixed(2) === amount
            && previous.rechargeCurrency === currency
            && previous.paymentQrMediaAssetId === qrMediaAssetId
            && previous.remark === remark
          if (!same) {
            advertisingRechargeFailure(
              ADVERTISING_RECHARGE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              '同一个提交标识已用于不同的充值申请',
              409,
            )
          }
          return previous.id
        }

        const account = await transaction.fundAccount.findFirst({
          where: { ownerType: 'USER', userId: context.actorUserId },
          select: { id: true, userShareRate: true },
        })
        if (account === null || account.userShareRate === null) {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.ACCOUNT_UNAVAILABLE,
            '当前用户还没有可参与分摊的资金账户或分成比例，请联系财务开户',
            409,
          )
        }
        const applicant = await transaction.user.findUnique({
          where: { id: context.actorUserId },
          select: { displayName: true },
        })

        if (qrMediaAssetId !== null) {
          await this.documents.attach(transaction, {
            actorUserId: context.actorUserId,
            mediaAssetId: qrMediaAssetId,
            purpose: ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE,
            unavailableCode: ADVERTISING_RECHARGE_ERROR_CODES.QR_UNAVAILABLE,
            label: '收款二维码',
          })
        }

        const issuance = await this.numbering.generateScopedInTransaction(transaction, {
          ruleCode: ADVERTISING_RECHARGE_NO_RULE_CODE,
          consumerCode: ADVERTISING_RECHARGE_NO_CONSUMER_CODE,
          idempotencyKey: [context.actorUserId, ':', requestKey].join(''),
          requestFingerprint: hashAdvertisingRechargeNumberFingerprint({
            applicantUserId: context.actorUserId,
            accountType: input.accountType,
            adAccountName,
            adAccountNo,
            rechargeAmount: amount,
            rechargeCurrency: currency,
            paymentQrMediaAssetId: qrMediaAssetId,
            remark,
            requestKey,
          }),
        })
        const created = await transaction.advertisingRechargeRequest.create({
          data: {
            rechargeNo: issuance.number,
            numberingIssuanceId: issuance.issuanceId,
            applicantUserId: context.actorUserId,
            accountType: input.accountType,
            adAccountName,
            adAccountNo,
            rechargeAmount: new Prisma.Decimal(amount),
            rechargeCurrency: currency,
            paymentQrMediaAssetId: qrMediaAssetId,
            remark,
            status: 'PENDING',
            requestKeyHash,
          },
          select: { id: true, rechargeNo: true, version: true },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.ADVERTISING_RECHARGE_SUBMITTED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ADVERTISING_RECHARGE_REQUEST',
          targetId: created.id,
          metadata: {
            rechargeNo: created.rechargeNo,
            accountType: input.accountType,
            adAccountName,
            adAccountNo,
            rechargeAmount: amount,
            rechargeCurrency: currency,
          },
        })
        await this.notifications.publish({
          eventType: 'ADVERTISING_RECHARGE_PAYMENT_PENDING',
          source: { type: 'ADVERTISING_RECHARGE_REQUEST', id: created.id },
          target: { kind: 'PERMISSION', permissionCode: 'advertising-recharges:pay' },
          templateKey: 'operations.advertising-recharge.pending',
          variables: {
            accountType: accountTypeLabel(input.accountType),
            adAccountName,
            applicantName: applicant?.displayName ?? '—',
            rechargeAmount: amount,
            rechargeCurrency: currency,
            rechargeNo: created.rechargeNo,
          },
          dedupeKey: `advertising-recharge-pending:${created.id}:v${created.version}`,
          priority: 'HIGH',
          requestedByUserId: context.actorUserId,
        }, { transaction })
        return created.id
      }, { timeout: 60_000 })
      return await this.queries.getOwn(context.actorUserId, id)
    }
    catch (error) {
      return mapAdvertisingRechargeError(error)
    }
  }

  /** 撤回只允许申请人本人在待付款阶段操作，不触碰资金。 */
  async withdraw(context: AdvertisingRechargeCommandContext, id: string, expectedVersion: number): Promise<AdvertisingRechargeDto> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lock(transaction, id)
        if (row.applicantUserId !== context.actorUserId) {
          advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.NOT_FOUND, '广告充值申请不存在', 404)
        }
        this.assertPendingVersion(row, expectedVersion)
        const withdrawnAt = new Date()
        await transaction.advertisingRechargeRequest.update({
          where: { id },
          data: { status: 'WITHDRAWN', withdrawnAt, version: { increment: 1 } },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.ADVERTISING_RECHARGE_WITHDRAWN,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ADVERTISING_RECHARGE_REQUEST',
          targetId: id,
          metadata: { rechargeNo: row.rechargeNo },
        })
      }, { timeout: 60_000 })
      return await this.queries.getOwn(context.actorUserId, id)
    }
    catch (error) {
      return mapAdvertisingRechargeError(error)
    }
  }

  /** 驳回只改状态与原因，不触碰资金。 */
  async reject(
    context: AdvertisingRechargeCommandContext,
    id: string,
    input: RejectAdvertisingRechargeDto,
  ): Promise<AdvertisingRechargeDto> {
    let reason: string
    try {
      reason = normalizeAdvertisingRechargeReason(input.reason)
    }
    catch {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.VALIDATION_FAILED, '请填写驳回原因')
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lock(transaction, id)
        this.assertPendingVersion(row, input.expectedVersion)
        const reviewedAt = new Date()
        await transaction.advertisingRechargeRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            reviewedAt,
            reviewedByUserId: context.actorUserId,
            rejectReason: reason,
            version: { increment: 1 },
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.ADVERTISING_RECHARGE_REJECTED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ADVERTISING_RECHARGE_REQUEST',
          targetId: id,
          metadata: { reason, rechargeNo: row.rechargeNo },
        })
        await this.notifications.publish({
          eventType: 'ADVERTISING_RECHARGE_REJECTED',
          source: { type: 'ADVERTISING_RECHARGE_REQUEST', id },
          target: { kind: 'USERS', userIds: [row.applicantUserId] },
          templateKey: 'operations.advertising-recharge.rejected',
          variables: {
            occurredAt: notificationTime(reviewedAt),
            reason,
            rechargeNo: row.rechargeNo,
          },
          dedupeKey: `advertising-recharge-rejected:${id}:v${row.version + 1}`,
          priority: 'HIGH',
          requestedByUserId: context.actorUserId,
        }, { transaction })
      }, { timeout: 60_000 })
      return await this.queries.getAll(id)
    }
    catch (error) {
      return mapAdvertisingRechargeError(error)
    }
  }

  /**
   * 付款：认领付款截图、按 ADVERTISING_FEE 规则过账、状态流转三者同一事务。
   * 个人与公司的分摊金额由资金域按申请人当时的分成比例计算，业务侧只传实付 CNY。
   */
  async pay(
    context: AdvertisingRechargeCommandContext,
    id: string,
    input: PayAdvertisingRechargeDto,
  ): Promise<AdvertisingRechargeDto> {
    let paymentAmount: string
    let proofMediaAssetId: string
    try {
      paymentAmount = normalizeAdvertisingRechargeAmount(input.paymentAmountCny)
      proofMediaAssetId = requireAdvertisingRechargeMediaId(input.paymentProofMediaAssetId)
    }
    catch {
      advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.VALIDATION_FAILED,
        '付款金额或付款截图无效',
      )
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lock(transaction, id)
        this.assertPendingVersion(row, input.expectedVersion)
        await this.documents.attach(transaction, {
          actorUserId: context.actorUserId,
          mediaAssetId: proofMediaAssetId,
          purpose: ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE,
          unavailableCode: ADVERTISING_RECHARGE_ERROR_CODES.PROOF_UNAVAILABLE,
          label: '付款截图',
        })

        const fundContext = {
          actorUserId: context.actorUserId,
          consumerCode: ADVERTISING_RECHARGE_PAY_CONSUMER,
          requestId: context.requestId,
          sourceCode: ADVERTISING_RECHARGE_FUND_SOURCE,
        }
        const fundInput = {
          postingTypeCode: ADVERTISING_RECHARGE_POSTING_TYPE,
          userId: row.applicantUserId,
          amount: paymentAmount,
          businessId: id,
          businessNo: row.rechargeNo,
          summary: ADVERTISING_RECHARGE_SUMMARY,
          source: {
            headline: `${row.applicantName} · ${ADVERTISING_RECHARGE_SUMMARY}`,
            subject: row.applicantName,
            action: ADVERTISING_RECHARGE_SUMMARY,
            documentNo: row.rechargeNo,
            link: { kind: 'ADVERTISING_RECHARGE' as const, id },
            detail: [
              { label: '广告账户', value: row.adAccountName },
              { label: '充值金额', value: `${row.rechargeCurrency} ${row.rechargeAmount.toFixed(2)}` },
            ],
          },
          metadata: {
            advertisingRechargeId: id,
            accountType: row.accountType,
            rechargeAmount: row.rechargeAmount.toFixed(2),
            rechargeCurrency: row.rechargeCurrency,
          },
          idempotencyKey: `advertising-recharge:${id}:pay`,
        }
        await this.funds.lockBusinessEventAccountsInTransaction(transaction, [{ context: fundContext, input: fundInput }])
        const preview = await this.funds.previewBusinessEventInTransaction(transaction, fundContext, fundInput)
        const posting = await this.funds.postBusinessEventInTransaction(transaction, fundContext, fundInput, preview)
        const paidAt = new Date()
        await transaction.advertisingRechargeRequest.update({
          where: { id },
          data: {
            status: 'PAID',
            paymentAmountCny: new Prisma.Decimal(paymentAmount),
            paymentProofMediaAssetId: proofMediaAssetId,
            paidAt,
            paidByUserId: context.actorUserId,
            fundPostingBatchId: posting.batchId,
            version: { increment: 1 },
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.ADVERTISING_RECHARGE_PAID,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ADVERTISING_RECHARGE_REQUEST',
          targetId: id,
          metadata: {
            rechargeNo: row.rechargeNo,
            paymentAmountCny: paymentAmount,
            paymentProofMediaAssetId: proofMediaAssetId,
            fundPostingBatchId: posting.batchId,
            userShareRate: posting.userShareRateSnapshot,
            companyShareRate: posting.companyShareRateSnapshot,
          },
        })
        await this.notifications.publish({
          eventType: 'ADVERTISING_RECHARGE_PAID',
          source: { type: 'ADVERTISING_RECHARGE_REQUEST', id },
          target: { kind: 'USERS', userIds: [row.applicantUserId] },
          templateKey: 'operations.advertising-recharge.paid',
          variables: {
            occurredAt: notificationTime(paidAt),
            paymentAmountCny: paymentAmount,
            rechargeNo: row.rechargeNo,
          },
          dedupeKey: `advertising-recharge-paid:${id}:v${row.version + 1}`,
          priority: 'NORMAL',
          requestedByUserId: context.actorUserId,
        }, { transaction })
      }, { timeout: 60_000 })
      return await this.queries.getAll(id)
    }
    catch (error) {
      return mapAdvertisingRechargeError(error)
    }
  }

  /** 作废：整单反向冲正，申请保留原付款事实，只追加作废与冲正批次。 */
  async void(
    context: AdvertisingRechargeCommandContext,
    id: string,
    input: VoidAdvertisingRechargeDto,
  ): Promise<AdvertisingRechargeDto> {
    let reason: string
    try {
      reason = normalizeAdvertisingRechargeReason(input.reason)
    }
    catch {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.VALIDATION_FAILED, '请填写作废原因')
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lock(transaction, id)
        if (row.status !== 'PAID') {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.STATUS_NOT_ALLOWED,
            '只有已付款的申请可以作废',
            409,
          )
        }
        if (row.version !== input.expectedVersion) {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.STATE_CHANGED,
            '广告充值申请已被其他人处理，请刷新后重试',
            409,
          )
        }
        if (row.paymentAmountCny === null || row.fundPostingBatchId === null) {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.STATE_CHANGED,
            '申请缺少付款事实，无法作废，请刷新后核对',
            409,
          )
        }
        const reversal = await this.funds.reverseBusinessEventInTransaction(
          transaction,
          {
            actorUserId: context.actorUserId,
            consumerCode: ADVERTISING_RECHARGE_VOID_CONSUMER,
            requestId: context.requestId,
            sourceCode: ADVERTISING_RECHARGE_FUND_SOURCE,
          },
          {
            originalBatchId: row.fundPostingBatchId,
            amount: row.paymentAmountCny.toFixed(2),
            reason,
            idempotencyKey: `advertising-recharge:${id}:void`,
          },
        )
        const voidedAt = new Date()
        await transaction.advertisingRechargeRequest.update({
          where: { id },
          data: {
            status: 'VOIDED',
            voidedAt,
            voidedByUserId: context.actorUserId,
            voidReason: reason,
            fundReversalBatchId: reversal.batchId,
            version: { increment: 1 },
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.ADVERTISING_RECHARGE_VOIDED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'ADVERTISING_RECHARGE_REQUEST',
          targetId: id,
          metadata: {
            reason,
            rechargeNo: row.rechargeNo,
            fundReversalBatchId: reversal.batchId,
          },
        })
        await this.notifications.publish({
          eventType: 'ADVERTISING_RECHARGE_VOIDED',
          source: { type: 'ADVERTISING_RECHARGE_REQUEST', id },
          target: { kind: 'USERS', userIds: [row.applicantUserId] },
          templateKey: 'operations.advertising-recharge.voided',
          variables: {
            occurredAt: notificationTime(voidedAt),
            paymentAmountCny: row.paymentAmountCny.toFixed(2),
            reason,
            rechargeNo: row.rechargeNo,
          },
          dedupeKey: `advertising-recharge-voided:${id}:v${row.version + 1}`,
          priority: 'HIGH',
          requestedByUserId: context.actorUserId,
        }, { transaction })
      }, { timeout: 60_000 })
      return await this.queries.getAll(id)
    }
    catch (error) {
      return mapAdvertisingRechargeError(error)
    }
  }

  private async lock(transaction: Prisma.TransactionClient, id: string): Promise<LockedRow> {
    const locks = await transaction.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`
      SELECT id FROM advertising_recharge_requests WHERE id = CAST(${id} AS uuid) FOR UPDATE
    `)
    if (locks.length !== 1) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.NOT_FOUND, '广告充值申请不存在', 404)
    }
    const row = await transaction.advertisingRechargeRequest.findUnique({
      where: { id },
      select: {
        applicantUserId: true,
        rechargeNo: true,
        status: true,
        version: true,
        accountType: true,
        adAccountName: true,
        adAccountNo: true,
        rechargeAmount: true,
        rechargeCurrency: true,
        paymentAmountCny: true,
        fundPostingBatchId: true,
        applicant: { select: { displayName: true } },
      },
    })
    if (row === null) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.NOT_FOUND, '广告充值申请不存在', 404)
    }
    return {
      applicantUserId: row.applicantUserId,
      rechargeNo: row.rechargeNo,
      status: row.status,
      version: row.version,
      accountType: row.accountType,
      adAccountName: row.adAccountName,
      adAccountNo: row.adAccountNo,
      rechargeAmount: row.rechargeAmount,
      rechargeCurrency: row.rechargeCurrency,
      paymentAmountCny: row.paymentAmountCny,
      fundPostingBatchId: row.fundPostingBatchId,
      applicantName: row.applicant.displayName,
    }
  }

  private assertPendingVersion(row: { readonly status: string, readonly version: number }, expectedVersion: number): void {
    if (row.version !== expectedVersion) {
      advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.STATE_CHANGED,
        '广告充值申请已被其他人处理，请刷新后重试',
        409,
      )
    }
    if (row.status !== 'PENDING') {
      advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.STATUS_NOT_ALLOWED,
        '只有待付款的申请可以执行该操作',
        409,
      )
    }
  }
}
