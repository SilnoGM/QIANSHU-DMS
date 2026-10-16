import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import { FundPostingService } from '../fund-accounts/application/fund-posting.contract'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { resolveInvoiceRequestViewer, type InvoiceRequestViewer } from './invoice-request-access'
import {
  INVOICE_REQUEST_DUPLICATE_POOL_STATUS_VALUES,
  INVOICE_REQUEST_OWNER_CANCEL_STATUS_VALUES,
  INVOICE_REQUEST_TERMINAL_STATUS_VALUES,
  type InvoiceRequestStatusValue,
} from './invoice-request.contract'
import { InvoiceRequestDocumentService } from './invoice-request-document.service'
import type {
  InvoiceRequestCancelDto,
  InvoiceRequestDto,
  InvoiceRequestNotifyDto,
  InvoiceRequestResubmitDto,
  InvoiceRequestReturnDto,
  InvoiceRequestSettleDto,
  InvoiceRequestSubmitDto,
} from './invoice-request.dto'
import { INVOICE_REQUEST_ERROR_CODES, invoiceRequestFailure, mapInvoiceRequestError } from './invoice-request.errors'
import {
  INVOICE_REQUEST_FUND_SOURCE,
  INVOICE_REQUEST_POSTING_TYPE,
  INVOICE_REQUEST_SETTLE_CONSUMER,
} from '../fund-accounts/application/fund-invoice-request'
import { calculateSettleAmountCny, calculateTaxAmount, INVOICE_MAILING_FEE_CNY, INVOICE_SERVICE_FEE_RATE, isSettleable, resolveSettleableAt, sumLineAmounts } from './invoice-request.logic'
import { InvoiceRequestQueryService } from './invoice-request-query.service'

export interface InvoiceRequestCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

const TWD = 'TWD'
const REQUEST_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
/** 幂等键与指纹都以 SHA-256 落库，两者都必须是 32 字节。 */
const digest = (value: string) => Buffer.from(createHash('sha256').update(value).digest('hex'), 'hex')
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')

interface NormalizedLine {
  readonly amount: bigint
  readonly productName: string
  readonly quantity: number
  readonly unitPrice: bigint
}

interface NormalizedSubmit {
  readonly buyerName: string
  readonly buyerTaxId: string
  readonly duplicateAcknowledged: boolean
  readonly internalRemark: string | null
  readonly invoiceRemark: string | null
  readonly lines: NormalizedLine[]
  readonly recipientAddress: string
  readonly recipientName: string
  readonly recipientPhone: string
  readonly salesAmount: bigint
  readonly taxAmount: bigint
  readonly totalAmount: bigint
}

/** 幂等键必须是客户端生成的 UUID：它同时用于咨询锁与幂等唯一键，必须稳定且不可预测。 */
function requireRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_KEY_PATTERN.test(value)) {
    invoiceRequestFailure('VALIDATION_FAILED', '缺少或非法的 Idempotency-Key 请求头', 422)
  }
  return value.toLowerCase()
}

/** 空串与纯空白按「没填」处理：备注是可选项，不该因为多打了一个空格就存下来。 */
function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 归一化提交载荷并复算金额：金额永不接受客户端传值，
 * 全部由「数量 × 单价」与服务端税率现算，客户端只提供数量与单价。
 */
function normalizeSubmit(input: InvoiceRequestSubmitDto): NormalizedSubmit {
  const lines: NormalizedLine[] = input.lines.map((line) => {
    const unitPrice = BigInt(line.unitPrice)
    if (unitPrice <= 0n || unitPrice > 900_000_000_000_000n) {
      invoiceRequestFailure('VALIDATION_FAILED', '单价必须是正整数', 422)
    }
    return { productName: line.productName.trim(), quantity: line.quantity, unitPrice, amount: unitPrice * BigInt(line.quantity) }
  })
  const salesAmount = sumLineAmounts(lines.map(line => ({ quantity: line.quantity, unitPrice: Number(line.unitPrice) })))
  const taxAmount = calculateTaxAmount(salesAmount)
  return {
    buyerName: input.buyerName.trim(),
    buyerTaxId: input.buyerTaxId.trim(),
    invoiceRemark: optionalText(input.invoiceRemark),
    internalRemark: optionalText(input.internalRemark),
    recipientName: input.recipientName.trim(),
    recipientPhone: input.recipientPhone.trim(),
    recipientAddress: input.recipientAddress.trim(),
    lines,
    salesAmount: BigInt(salesAmount),
    taxAmount: BigInt(taxAmount),
    totalAmount: BigInt(salesAmount + taxAmount),
    duplicateAcknowledged: input.duplicateAcknowledged === true,
  }
}

/** 四项比对的指纹载荷：只放参与比对的字段，改备注不该影响「是否同一张票」的判断。 */
function submitFingerprint(payload: NormalizedSubmit): string {
  return hash({
    format: 'invoice-request.submit.v1',
    buyerName: payload.buyerName,
    buyerTaxId: payload.buyerTaxId,
    salesAmount: payload.salesAmount.toString(),
    taxAmount: payload.taxAmount.toString(),
    totalAmount: payload.totalAmount.toString(),
    lines: payload.lines.map(line => ({
      productName: line.productName,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toString(),
    })),
    invoiceRemark: payload.invoiceRemark,
    internalRemark: payload.internalRemark,
    recipientName: payload.recipientName,
    recipientPhone: payload.recipientPhone,
    recipientAddress: payload.recipientAddress,
  })
}

@Injectable()
export class InvoiceRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: InvoiceRequestQueryService,
    private readonly documents: InvoiceRequestDocumentService,
    private readonly funds: FundPostingService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- 提交与重新提交

  /**
   * 提交：幂等键 → 四项比对（软提示）→ 派发单号 → 写单据、明细与状态历史 → 审计。
   * 金额一律服务端复算；客户端acknowledged 之后才允许落库。
   */
  async submit(context: InvoiceRequestCommandContext, input: InvoiceRequestSubmitDto, key: unknown): Promise<InvoiceRequestDto> {
    const requestKey = requireRequestKey(key)
    const payload = normalizeSubmit(input)
    const fingerprint = submitFingerprint(payload)
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        // 幂等锁在发号之前：网络重试只恢复同一张单，不再次消耗编号。
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${['invoice-request.submit:', context.actorUserId, ':', requestKey].join('')}, 0))`)
        // 提交标识唯一：同一个键重放恢复原单，绝不产生第二张（唯一索引是这条不变量的数据库级保证）。
        // 客户端复用键却改了内容属于客户端错误，按重放处理——键才是这次请求的身份。
        const previous = await tx.invoiceRequest.findUnique({
          where: { createdById_requestKeyHash: { createdById: context.actorUserId, requestKeyHash: digest(requestKey) } },
          select: { id: true },
        })
        if (previous !== null) {
          return previous.id
        }
        if (!payload.duplicateAcknowledged) {
          await this.assertNoDuplicate(tx, payload)
        }
        const issuance = await this.numbering.generateScopedInTransaction(tx, {
          ruleCode: 'INVOICE_REQUEST',
          consumerCode: 'INVOICE_REQUEST.CREATE',
          idempotencyKey: [context.actorUserId, ':', requestKey].join(''),
          requestFingerprint: fingerprint,
        })
        const created = await tx.invoiceRequest.create({
          data: {
            invoiceNo: issuance.number,
            numberingIssuanceId: issuance.issuanceId,
            buyerName: payload.buyerName,
            buyerTaxId: payload.buyerTaxId,
            salesAmount: payload.salesAmount,
            taxAmount: payload.taxAmount,
            totalAmount: payload.totalAmount,
            invoiceRemark: payload.invoiceRemark,
            internalRemark: payload.internalRemark,
            recipientName: payload.recipientName,
            recipientPhone: payload.recipientPhone,
            recipientAddress: payload.recipientAddress,
            lastSubmittedAt: new Date(),
            requestKeyHash: digest(requestKey),
            createdById: context.actorUserId,
            lines: { create: payload.lines.map((line, index) => ({ lineNo: index + 1, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount })) },
          },
          select: { id: true, invoiceNo: true },
        })
        await this.writeHistory(tx, {
          action: 'SUBMIT', fromStatus: null, toStatus: 'PENDING_REVIEW', reason: null,
          requestId: created.id, actorUserId: context.actorUserId,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_CREATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: created.id,
          metadata: { invoiceNo: created.invoiceNo, lineCount: payload.lines.length, totalAmount: payload.totalAmount.toString() },
        })
        return created.id
      }, { timeout: 60_000 })
      return await this.queries.get(context.actorUserId, id)
    }
    catch (error) {
      return mapInvoiceRequestError(error)
    }
  }

  /**
   * 重新提交：只有本人、只有「已退回」。明细行先改（触发器只在退回态放行），
   * 业务字段与状态必须在同一条 UPDATE 里一起写，这是数据库层的流转约定。
   */
  async resubmit(context: InvoiceRequestCommandContext, id: string, input: InvoiceRequestResubmitDto): Promise<InvoiceRequestDto> {
    const payload = normalizeSubmit(input)
    try {
      await this.prisma.$transaction(async (tx) => {
        const viewer = await resolveInvoiceRequestViewer(tx, context.actorUserId)
        const row = await this.lockRequest(tx, id)
        this.assertOwner(row.createdById, viewer)
        this.assertStatus(row.status, ['RETURNED'], '只有已退回的申请单可以重新提交')
        this.assertVersion(row.version, input.expectedVersion)
        if (!payload.duplicateAcknowledged) {
          await this.assertNoDuplicate(tx, payload, id)
        }
        await tx.invoiceRequestLine.deleteMany({ where: { requestId: id } })
        await tx.invoiceRequestLine.createMany({
          data: payload.lines.map((line, index) => ({ requestId: id, lineNo: index + 1, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount })),
        })
        await tx.invoiceRequest.update({
          where: { id },
          data: {
            status: 'PENDING_REVIEW',
            lastSubmittedAt: new Date(),
            buyerName: payload.buyerName,
            buyerTaxId: payload.buyerTaxId,
            salesAmount: payload.salesAmount,
            taxAmount: payload.taxAmount,
            totalAmount: payload.totalAmount,
            invoiceRemark: payload.invoiceRemark,
            internalRemark: payload.internalRemark,
            recipientName: payload.recipientName,
            recipientPhone: payload.recipientPhone,
            recipientAddress: payload.recipientAddress,
            version: { increment: 1 },
          },
        })
        await this.writeHistory(tx, {
          action: 'RESUBMIT', fromStatus: 'RETURNED', toStatus: 'PENDING_REVIEW', reason: null,
          requestId: id, actorUserId: context.actorUserId,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_RESUBMITTED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: id,
          metadata: { invoiceNo: row.invoiceNo, lineCount: payload.lines.length, totalAmount: payload.totalAmount.toString() },
        })
      }, { timeout: 60_000 })
      return await this.queries.get(context.actorUserId, id)
    }
    catch (error) {
      return mapInvoiceRequestError(error)
    }
  }

  // ---------------------------------------------------------------- 财务动作

  /** 退回重填：审核中 → 已退回，原因必填（运营据此知道改什么）。 */
  async returnForCorrection(context: InvoiceRequestCommandContext, id: string, input: InvoiceRequestReturnDto): Promise<InvoiceRequestDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await resolveInvoiceRequestViewer(tx, context.actorUserId)
        const row = await this.lockRequest(tx, id)
        this.assertStatus(row.status, ['PENDING_REVIEW'], '只有开票审核中的申请单可以退回')
        this.assertVersion(row.version, input.expectedVersion)
        await tx.invoiceRequest.update({
          where: { id },
          data: { status: 'RETURNED', returnedAt: new Date(), returnedByUserId: context.actorUserId, version: { increment: 1 } },
        })
        await this.writeHistory(tx, {
          action: 'RETURN', fromStatus: 'PENDING_REVIEW', toStatus: 'RETURNED', reason: input.reason.trim(),
          requestId: id, actorUserId: context.actorUserId,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_RETURNED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: id,
          metadata: { invoiceNo: row.invoiceNo, reason: input.reason.trim() },
        })
      }, { timeout: 30_000 })
      return await this.queries.get(context.actorUserId, id)
    }
    catch (error) {
      return mapInvoiceRequestError(error)
    }
  }

  /** 审核并通知：审核中 → 已通知开票。通知动作本身在线下完成，系统只记录这一次流转。 */
  async notify(context: InvoiceRequestCommandContext, id: string, input: InvoiceRequestNotifyDto): Promise<InvoiceRequestDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await resolveInvoiceRequestViewer(tx, context.actorUserId)
        const row = await this.lockRequest(tx, id)
        this.assertStatus(row.status, ['PENDING_REVIEW'], '只有开票审核中的申请单可以审核并通知')
        this.assertVersion(row.version, input.expectedVersion)
        await tx.invoiceRequest.update({
          where: { id },
          data: { status: 'NOTIFIED', notifiedAt: new Date(), notifiedByUserId: context.actorUserId, version: { increment: 1 } },
        })
        await this.writeHistory(tx, {
          action: 'NOTIFY', fromStatus: 'PENDING_REVIEW', toStatus: 'NOTIFIED', reason: null,
          requestId: id, actorUserId: context.actorUserId,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_NOTIFIED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: id,
          metadata: { invoiceNo: row.invoiceNo },
        })
      }, { timeout: 30_000 })
      return await this.queries.get(context.actorUserId, id)
    }
    catch (error) {
      return mapInvoiceRequestError(error)
    }
  }

  /**
   * 取消是终态：运营只能取消本人且尚未通知的单（此时撤回零成本），
   * 财务（持有跨提交人权限）可以在结算入账之前的任意状态取消，原因必填。
   */
  async cancel(context: InvoiceRequestCommandContext, id: string, input: InvoiceRequestCancelDto): Promise<InvoiceRequestDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const viewer = await resolveInvoiceRequestViewer(tx, context.actorUserId)
        const row = await this.lockRequest(tx, id)
        const isOwner = row.createdById === context.actorUserId
        if (!viewer.canManageOthers && !isOwner) {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.NOT_FOUND, '开票申请不存在', 404)
        }
        if (viewer.canManageOthers) {
          // 财务可以在结算入账之前的任意状态取消（终态再取消没有意义）。
          this.assertNotTerminal(row.status, '已结算入账或已取消的申请单不能再取消')
        }
        else {
          // 运营只能取消本人且尚未通知代开票方的单：此时撤回不涉及实物发票。
          this.assertStatus(row.status, INVOICE_REQUEST_OWNER_CANCEL_STATUS_VALUES, '只有开票审核中或已退回的申请单可以自行取消，请联系财务处理')
        }
        this.assertVersion(row.version, input.expectedVersion)
        await tx.invoiceRequest.update({
          where: { id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: context.actorUserId, cancelReason: input.reason.trim(), version: { increment: 1 } },
        })
        await this.writeHistory(tx, {
          action: 'CANCEL', fromStatus: row.status, toStatus: 'CANCELLED', reason: input.reason.trim(),
          requestId: id, actorUserId: context.actorUserId,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_CANCELLED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: id,
          metadata: { invoiceNo: row.invoiceNo, fromStatus: row.status, reason: input.reason.trim(), documentUploaded: row.documentMediaAssetId !== null },
        })
      }, { timeout: 30_000 })
      return await this.queries.get(context.actorUserId, id)
    }
    catch (error) {
      return mapInvoiceRequestError(error)
    }
  }

  /**
   * 上传发票照片：已通知开票 → 已开出邮寄，一张即定稿（重复上传直接拒绝，不覆盖）。
   * 上传时间同时是 5 天等待期的起点。
   */
  async uploadDocument(context: InvoiceRequestCommandContext, id: string, mediaAssetId: string): Promise<InvoiceRequestDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await resolveInvoiceRequestViewer(tx, context.actorUserId)
        const row = await this.lockRequest(tx, id)
        this.assertStatus(row.status, ['NOTIFIED'], '只有已通知开票的申请单可以上传发票照片')
        if (row.documentMediaAssetId !== null) {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_EXISTS, '这张申请单已经上传过发票照片，上传后不可替换', 409)
        }
        await this.documents.attach(tx, { actorUserId: context.actorUserId, mediaAssetId })
        const uploadedAt = new Date()
        await tx.invoiceRequest.update({
          where: { id },
          data: {
            status: 'ISSUED',
            documentMediaAssetId: mediaAssetId,
            documentUploadedAt: uploadedAt,
            documentUploadedByUserId: context.actorUserId,
            version: { increment: 1 },
          },
        })
        await this.writeHistory(tx, {
          action: 'UPLOAD_DOCUMENT', fromStatus: 'NOTIFIED', toStatus: 'ISSUED', reason: null,
          requestId: id, actorUserId: context.actorUserId,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_DOCUMENT_UPLOADED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: id,
          metadata: { invoiceNo: row.invoiceNo, mediaAssetId },
        })
      }, { timeout: 60_000 })
      return await this.queries.get(context.actorUserId, id)
    }
    catch (error) {
      return mapInvoiceRequestError(error)
    }
  }

  /**
   * 结算入账：前置是「已上传照片且满 120 小时」。汇率在入账事务内读取当前值并冻结，
   * 与客户端展示的汇率不一致就要求刷新重算；成本按公式入账并回写批次 id。
   */
  async settle(context: InvoiceRequestCommandContext, id: string, input: InvoiceRequestSettleDto): Promise<InvoiceRequestDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await resolveInvoiceRequestViewer(tx, context.actorUserId)
        const row = await this.lockRequest(tx, id)
        this.assertStatus(row.status, ['ISSUED'], '只有已开出邮寄的申请单可以结算入账')
        this.assertVersion(row.version, input.expectedVersion)
        if (row.documentUploadedAt === null) {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_REQUIRED, '请先上传发票照片', 422)
        }
        const now = new Date()
        if (!isSettleable(row.documentUploadedAt, now)) {
          invoiceRequestFailure(
            INVOICE_REQUEST_ERROR_CODES.SETTLE_WAIT_PERIOD,
            ['发票上传满 120 小时后才能结算入账，可结算时间为 ', resolveSettleableAt(row.documentUploadedAt).toISOString()].join(''),
            422,
          )
        }
        const rate = await this.systemRateTwd(tx)
        if (rate.id !== input.exchangeRateId || rate.version !== input.exchangeRateVersion) {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.RATE_CHANGED, '台币汇率已更新，请刷新后按最新汇率重新确认', 409)
        }
        const amount = calculateSettleAmountCny(row.totalAmount, rate.foreignUnitsPerCny)
        const fundPostingBatchId = await this.postSettlement(tx, context, { id, invoiceNo: row.invoiceNo, totalAmount: row.totalAmount, taxAmount: row.taxAmount, amount, rate })
        const settledAt = new Date()
        // 批次 id 必须与状态流转写在同一条 UPDATE 里：触发器只放行 ISSUED → SETTLED 那一次写入。
        await tx.invoiceRequest.update({
          where: { id },
          data: {
            status: 'SETTLED',
            settledAt,
            settledByUserId: context.actorUserId,
            fundPostingBatchId,
            settleAmountCny: new Prisma.Decimal(amount),
            exchangeRateId: rate.id,
            exchangeRateVersionSnapshot: rate.version,
            foreignUnitsPerCnySnapshot: rate.foreignUnitsPerCny,
            rateCapturedAt: settledAt,
            version: { increment: 1 },
          },
        })
        await this.writeHistory(tx, {
          action: 'SETTLE', fromStatus: 'ISSUED', toStatus: 'SETTLED', reason: null,
          requestId: id, actorUserId: context.actorUserId,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_SETTLED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: id,
          metadata: { invoiceNo: row.invoiceNo, settleAmountCny: amount, foreignUnitsPerCny: rate.foreignUnitsPerCny.toFixed(12) },
        })
      }, { timeout: 60_000 })
      return await this.queries.get(context.actorUserId, id)
    }
    catch (error) {
      return mapInvoiceRequestError(error)
    }
  }

  // ---------------------------------------------------------------- 内部工具

  /** 结算入账：资金批次与单据状态在同一事务里；任一失败整体回滚，单据保持「已开出邮寄」。 */
  private async postSettlement(
    tx: Prisma.TransactionClient,
    context: InvoiceRequestCommandContext,
    input: { readonly amount: string, readonly id: string, readonly invoiceNo: string, readonly rate: { readonly foreignUnitsPerCny: Prisma.Decimal, readonly id: string, readonly version: number }, readonly taxAmount: bigint, readonly totalAmount: bigint },
  ): Promise<string> {
    const fundContext = {
      actorUserId: context.actorUserId,
      consumerCode: INVOICE_REQUEST_SETTLE_CONSUMER,
      requestId: context.requestId,
      sourceCode: INVOICE_REQUEST_FUND_SOURCE,
    }
    const fundInput = {
      postingTypeCode: INVOICE_REQUEST_POSTING_TYPE,
      userId: context.actorUserId,
      amount: input.amount,
      businessId: input.id,
      businessNo: input.invoiceNo,
      summary: '开票服务费及邮寄费',
      metadata: {
        invoiceRequestId: input.id,
        invoiceNo: input.invoiceNo,
        totalAmountTwd: input.totalAmount.toString(),
        taxAmountTwd: input.taxAmount.toString(),
        exchangeRateId: input.rate.id,
        exchangeRateVersion: input.rate.version,
        foreignUnitsPerCny: input.rate.foreignUnitsPerCny.toFixed(12),
        serviceFeeRate: INVOICE_SERVICE_FEE_RATE,
        mailingFeeCny: INVOICE_MAILING_FEE_CNY,
      },
      idempotencyKey: [input.id, ':SETTLE'].join(''),
    }
    await this.funds.lockBusinessEventAccountsInTransaction(tx, [{ context: fundContext, input: fundInput }])
    const preview = await this.funds.previewBusinessEventInTransaction(tx, fundContext, fundInput)
    const posting = await this.funds.postBusinessEventInTransaction(tx, fundContext, fundInput, preview)
    return posting.batchId
  }

  /**
   * 系统当前汇率：按 Currency → ExchangeRate 的确定锁序读取，缺失即明确报错，
   * 不静默兜底成 1，否则单据会带着错误汇率结算。
   */
  private async systemRateTwd(tx: Prisma.TransactionClient): Promise<{ id: string, foreignUnitsPerCny: Prisma.Decimal, version: number }> {
    const currencies = await tx.$queryRaw<Array<{ id: string, enabled: boolean }>>(Prisma.sql`
      SELECT id, enabled FROM currencies WHERE code = ${TWD} FOR SHARE`)
    const currency = currencies[0]
    if (currency === undefined || !currency.enabled) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.RATE_UNAVAILABLE, '新台币当前未启用，请先在货币管理中启用并配置当前汇率', 409)
    }
    const rates = await tx.$queryRaw<Array<{ id: string, rate: Prisma.Decimal, version: number }>>(Prisma.sql`
      SELECT id, version, foreign_units_per_cny AS rate FROM exchange_rates
      WHERE currency_id = ${currency.id}::uuid FOR SHARE`)
    const rate = rates[0]
    if (rate === undefined || rate.rate.lte(0)) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.RATE_UNAVAILABLE, '新台币当前缺少有效汇率，请先在货币管理中配置', 409)
    }
    return { id: rate.id, foreignUnitsPerCny: rate.rate, version: rate.version }
  }

  /**
   * 四项比对（抬头 + 统编 + 营业税 + 总计，字面完全一致，不做归一化）。
   * 命中即软提示：带 duplicateAcknowledged 重试即可继续提交。比对池不含已取消与已退回，
   * 因此「取消后新建」与「退回重填」都不会自己撞自己。
   */
  private async assertNoDuplicate(tx: Prisma.TransactionClient, payload: NormalizedSubmit, excludeId?: string): Promise<void> {
    const suspects = await tx.invoiceRequest.findMany({
      where: {
        buyerName: payload.buyerName,
        buyerTaxId: payload.buyerTaxId,
        taxAmount: payload.taxAmount,
        totalAmount: payload.totalAmount,
        status: { in: [...INVOICE_REQUEST_DUPLICATE_POOL_STATUS_VALUES] },
        ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { invoiceNo: true, status: true, createdAt: true },
    })
    if (suspects.length === 0) return
    throw new ApiException(409, INVOICE_REQUEST_ERROR_CODES.DUPLICATE_SUSPECTED,
      ['存在抬头、统编、营业税与总计完全一致的申请单：', suspects.map(suspect => suspect.invoiceNo).join('、'), '，确认后可继续提交'].join(''),
      { duplicateSuspects: suspects.map(suspect => [suspect.invoiceNo, suspect.status, suspect.createdAt.toISOString().slice(0, 10)].join(' ｜ ')) })
  }

  /** 锁定单据行（`FOR UPDATE`）并回表读取流转需要的字段；行不存在按 404 处理。 */
  private async lockRequest(tx: Prisma.TransactionClient, id: string): Promise<{
    readonly createdById: string
    readonly documentMediaAssetId: string | null
    readonly documentUploadedAt: Date | null
    readonly invoiceNo: string
    readonly status: InvoiceRequestStatusValue
    readonly taxAmount: bigint
    readonly totalAmount: bigint
    readonly version: number
  }> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM invoice_requests WHERE id = CAST(${id} AS uuid) FOR UPDATE`)
    if (rows.length !== 1) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.NOT_FOUND, '开票申请不存在', 404)
    }
    const row = await tx.invoiceRequest.findUnique({
      where: { id },
      select: { createdById: true, documentMediaAssetId: true, documentUploadedAt: true, invoiceNo: true, status: true, taxAmount: true, totalAmount: true, version: true },
    })
    if (row === null) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.NOT_FOUND, '开票申请不存在', 404)
    }
    return row
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.STATE_CHANGED, '申请单已被其他人处理，请刷新后重试', 409)
    }
  }

  private assertStatus(current: InvoiceRequestStatusValue, allowed: readonly InvoiceRequestStatusValue[], message: string): void {
    if (!allowed.includes(current)) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.STATUS_NOT_ALLOWED, message, 409)
    }
  }

  private assertNotTerminal(current: InvoiceRequestStatusValue, message: string): void {
    if (INVOICE_REQUEST_TERMINAL_STATUS_VALUES.includes(current)) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.STATUS_NOT_ALLOWED, message, 409)
    }
  }

  private assertOwner(createdById: string, viewer: InvoiceRequestViewer): void {
    if (createdById !== viewer.actorUserId) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.OWNER_ONLY, '只有提交人可以重新提交这张申请单', 403)
    }
  }

  private async writeHistory(
    tx: Prisma.TransactionClient,
    input: { readonly action: 'SUBMIT' | 'RESUBMIT' | 'RETURN' | 'NOTIFY' | 'UPLOAD_DOCUMENT' | 'SETTLE' | 'CANCEL', readonly actorUserId: string, readonly fromStatus: InvoiceRequestStatusValue | null, readonly reason: string | null, readonly requestId: string, readonly toStatus: InvoiceRequestStatusValue },
  ): Promise<void> {
    await tx.invoiceRequestStatusHistory.create({
      data: {
        requestId: input.requestId,
        action: input.action,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        actorUserId: input.actorUserId,
      },
    })
  }
}
