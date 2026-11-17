import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import {
  InvoiceRequestDocumentService,
  isUsableInvoiceDocumentAsset,
} from './invoice-request-document.service'
import type {
  InvoiceRequestImportBatchDto,
  InvoiceRequestImportBatchResultDto,
  InvoiceRequestImportItemDto,
  InvoiceRequestImportItemResultDto,
} from './invoice-request-import.dto'
import {
  buildInvoiceRequestImportKey,
  InvoiceRequestImportItemError,
  planInvoiceRequestImportItem,
  type InvoiceRequestImportItemPlan,
} from './invoice-request-import.logic'
import { INVOICE_REQUEST_ERROR_CODES } from './invoice-request.errors'
import type { InvoiceRequestCommandContext } from './invoice-request.service'

/** 幂等键与请求指纹都以 SHA-256 落库；编号域只接受 64 位十六进制摘要。 */
const digest = (value: string) => Buffer.from(createHash('sha256').update(value).digest('hex'), 'hex')
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

type ImportReader = Pick<Prisma.TransactionClient, 'invoiceRequest'>

interface ExistingImportRow {
  readonly id: string
  readonly invoiceNo: string
  readonly salesAmount: Prisma.Decimal
  readonly taxAmount: Prisma.Decimal
  readonly totalAmount: Prisma.Decimal
}

interface ImportItemOutcome {
  readonly row: ExistingImportRow
  readonly created: boolean
}

/**
 * 代导入：由持有 `invoice-requests:import` 的特权账号，替历史开票人建立开票申请。
 *
 * 三条不可协商的口径：
 * - 归属写在开票人（`created_by_id`），代操作人另存 `submitted_on_behalf_by_user_id`，
 *   否则「运营仅可见本人」会被导入动作击穿。
 * - 写入必须从「开票审核中」起步，再在同一事务内按触发器白名单走到目标状态；
 *   绝不直接插入 `ISSUED`，也不放宽触发器。
 * - 全程不发通知：历史回填不该给用户推送几个月前的消息。
 */
@Injectable()
export class InvoiceRequestImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: InvoiceRequestDocumentService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
  ) {}

  async importBatch(context: InvoiceRequestCommandContext, input: InvoiceRequestImportBatchDto): Promise<InvoiceRequestImportBatchResultDto> {
    const dryRun = input.dryRun === true
    const items: InvoiceRequestImportItemResultDto[] = []
    // 逐条独立事务：一条失败不影响其他条，回执按 sourceRef 定位。
    for (const item of input.items) {
      items.push(await this.importItem(context, input.batchRef, dryRun, item))
    }
    return {
      batchRef: input.batchRef,
      dryRun,
      created: items.filter(item => item.outcome === 'CREATED').length,
      replayed: items.filter(item => item.outcome === 'REPLAYED').length,
      valid: items.filter(item => item.outcome === 'VALID').length,
      failed: items.filter(item => item.outcome === 'FAILED').length,
      items,
    }
  }

  private async importItem(
    context: InvoiceRequestCommandContext,
    batchRef: string,
    dryRun: boolean,
    input: InvoiceRequestImportItemDto,
  ): Promise<InvoiceRequestImportItemResultDto> {
    let plan: InvoiceRequestImportItemPlan
    try {
      plan = planInvoiceRequestImportItem(input, new Date())
    }
    catch (error) {
      return this.failure(input.sourceRef, error)
    }

    if (plan.ownerUserId === context.actorUserId) {
      return this.failed(input.sourceRef, INVOICE_REQUEST_ERROR_CODES.IMPORT_OWNER_INVALID, '代导入人不能同时是归属开票人，请指定被代的开票人账号')
    }

    try {
      if (!await this.assertOwnerImportable(plan.ownerUserId)) {
        return this.failed(input.sourceRef, INVOICE_REQUEST_ERROR_CODES.IMPORT_OWNER_INVALID, '归属开票人不存在、未启用或缺少 invoice-requests:read 权限')
      }
      const requestKeyHash = digest(buildInvoiceRequestImportKey(batchRef, plan.sourceRef))

      if (dryRun) {
        const existing = await this.findExisting(this.prisma, plan.ownerUserId, requestKeyHash)
        if (existing !== null) {
          return this.replayed(input.sourceRef, existing)
        }
        if (plan.documentMediaAssetId !== null) {
          const asset = await this.prisma.mediaAsset.findUnique({ where: { id: plan.documentMediaAssetId } })
          if (asset === null || !isUsableInvoiceDocumentAsset(asset, context.actorUserId)) {
            return this.failed(input.sourceRef, INVOICE_REQUEST_ERROR_CODES.DOCUMENT_UNAVAILABLE, '所选发票照片当前不可用')
          }
        }
        return this.valid(input.sourceRef, plan)
      }

      const outcome = await this.prisma.$transaction(async (tx) => {
        // 幂等锁在发号之前：网络重试只恢复同一张单，不再次消耗编号。
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${['invoice-request.import:', plan.ownerUserId, ':', buildInvoiceRequestImportKey(batchRef, plan.sourceRef)].join('')}, 0))`)
        const existing = await this.findExisting(tx, plan.ownerUserId, requestKeyHash)
        if (existing !== null) {
          return { row: existing, created: false } satisfies ImportItemOutcome
        }
        const issuance = await this.numbering.generateScopedInTransaction(tx, {
          ruleCode: 'INVOICE_REQUEST',
          consumerCode: 'INVOICE_REQUEST.CREATE',
          // 编号域的幂等键有 200 字节上限，这里用摘要而不是拼接原文。
          idempotencyKey: hash(['invoice-request.import', plan.ownerUserId, batchRef, plan.sourceRef].join(':')),
          requestFingerprint: hash({
            format: 'invoice-request.import.v1',
            ownerUserId: plan.ownerUserId,
            batchRef,
            sourceRef: plan.sourceRef,
            buyerName: plan.buyerName,
            buyerTaxId: plan.buyerTaxId,
            salesAmount: plan.salesAmount.toString(),
            taxAmount: plan.taxAmount.toString(),
            totalAmount: plan.totalAmount.toString(),
            lines: plan.lines.map(line => ({ productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice.toString() })),
            targetStatus: plan.targetStatus,
            submittedAt: plan.submittedAt.toISOString(),
          }),
        })
        const created = await tx.invoiceRequest.create({
          data: {
            invoiceNo: issuance.number,
            numberingIssuanceId: issuance.issuanceId,
            status: 'PENDING_REVIEW',
            buyerName: plan.buyerName,
            buyerTaxId: plan.buyerTaxId,
            salesAmount: plan.salesAmount.toString(),
            taxAmount: plan.taxAmount.toString(),
            totalAmount: plan.totalAmount.toString(),
            invoiceRemark: plan.invoiceRemark,
            internalRemark: plan.internalRemark,
            recipientName: plan.recipientName,
            recipientPhone: plan.recipientPhone,
            recipientAddress: plan.recipientAddress,
            lastSubmittedAt: plan.submittedAt,
            createdAt: plan.submittedAt,
            requestKeyHash,
            createdById: plan.ownerUserId,
            submittedOnBehalfByUserId: context.actorUserId,
            lines: {
              create: plan.lines.map((line, index) => ({
                lineNo: index + 1,
                productName: line.productName,
                quantity: line.quantity,
                unitPrice: line.unitPrice.toString(),
                amount: line.amount.toString(),
              })),
            },
          },
          select: { id: true, invoiceNo: true, salesAmount: true, taxAmount: true, totalAmount: true },
        })
        await this.writeHistory(tx, {
          requestId: created.id, action: 'SUBMIT', fromStatus: null, toStatus: 'PENDING_REVIEW',
          actorUserId: context.actorUserId, actingForUserId: plan.ownerUserId, occurredAt: plan.submittedAt,
        })
        await this.audit.record(tx, {
          eventType: 'INVOICE_REQUEST_CREATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: created.id,
          metadata: {
            invoiceNo: created.invoiceNo,
            importBatchRef: batchRef,
            sourceRef: plan.sourceRef,
            onBehalfOfUserId: plan.ownerUserId,
            lineCount: plan.lines.length,
            totalAmount: plan.totalAmount.toString(),
            taxOverridden: plan.taxOverridden,
            computedTaxAmount: plan.computedTaxAmount.toString(),
            appliedTaxAmount: plan.taxAmount.toString(),
          },
        })

        if (plan.targetStatus === 'NOTIFIED' || plan.targetStatus === 'ISSUED') {
          await tx.invoiceRequest.update({
            where: { id: created.id },
            data: { status: 'NOTIFIED', notifiedAt: plan.notifiedAt, notifiedByUserId: context.actorUserId, version: { increment: 1 } },
          })
          await this.writeHistory(tx, {
            requestId: created.id, action: 'NOTIFY', fromStatus: 'PENDING_REVIEW', toStatus: 'NOTIFIED',
            actorUserId: context.actorUserId, actingForUserId: plan.ownerUserId, occurredAt: plan.notifiedAt ?? plan.submittedAt,
          })
          await this.audit.record(tx, {
            eventType: 'INVOICE_REQUEST_NOTIFIED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
            requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: created.id,
            metadata: { invoiceNo: created.invoiceNo, importBatchRef: batchRef, sourceRef: plan.sourceRef, onBehalfOfUserId: plan.ownerUserId },
          })
        }

        if (plan.targetStatus === 'ISSUED' && plan.documentMediaAssetId !== null) {
          // 复用正式链路的认领校验：归属、用途、形状与字节校验和都必须过，导入不享受豁免。
          await this.documents.attach(tx, { actorUserId: context.actorUserId, mediaAssetId: plan.documentMediaAssetId })
          await tx.invoiceRequest.update({
            where: { id: created.id },
            data: {
              status: 'ISSUED',
              documentMediaAssetId: plan.documentMediaAssetId,
              documentUploadedAt: plan.documentUploadedAt ?? plan.notifiedAt ?? plan.submittedAt,
              documentUploadedByUserId: context.actorUserId,
              version: { increment: 1 },
            },
          })
          await this.writeHistory(tx, {
            requestId: created.id, action: 'UPLOAD_DOCUMENT', fromStatus: 'NOTIFIED', toStatus: 'ISSUED',
            actorUserId: context.actorUserId, actingForUserId: plan.ownerUserId,
            occurredAt: plan.documentUploadedAt ?? plan.notifiedAt ?? plan.submittedAt,
          })
          await this.audit.record(tx, {
            eventType: 'INVOICE_REQUEST_DOCUMENT_UPLOADED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
            requestId: context.requestId, targetType: 'INVOICE_REQUEST', targetId: created.id,
            metadata: {
              invoiceNo: created.invoiceNo,
              importBatchRef: batchRef,
              sourceRef: plan.sourceRef,
              onBehalfOfUserId: plan.ownerUserId,
              mediaAssetId: plan.documentMediaAssetId,
            },
          })
        }

        return { row: created, created: true } satisfies ImportItemOutcome
      }, { timeout: 60_000 })

      if (outcome.created) {
        return {
          sourceRef: input.sourceRef,
          outcome: 'CREATED',
          invoiceRequestId: outcome.row.id,
          invoiceNo: outcome.row.invoiceNo,
          code: null,
          message: null,
          salesAmount: plan.salesAmount.toString(),
          taxAmount: plan.taxAmount.toString(),
          totalAmount: plan.totalAmount.toString(),
          taxOverridden: plan.taxOverridden,
        }
      }
      return this.replayed(input.sourceRef, outcome.row)
    }
    catch (error) {
      return this.failure(input.sourceRef, error)
    }
  }

  /** 归属开票人：必须启用且仍持有读权限，否则建出来的单连本人都看不见。 */
  private async assertOwnerImportable(ownerUserId: string): Promise<boolean> {
    const owner = await this.prisma.user.findFirst({ where: { id: ownerUserId, status: 'ACTIVE' }, select: { id: true } })
    if (owner === null) return false
    const grant = await this.prisma.userRole.findFirst({
      where: {
        userId: ownerUserId,
        role: { permissions: { some: { permission: { code: 'invoice-requests:read' } } } },
      },
      select: { userId: true },
    })
    return grant !== null
  }

  private async findExisting(reader: ImportReader, ownerUserId: string, requestKeyHash: Uint8Array<ArrayBuffer>): Promise<ExistingImportRow | null> {
    return await reader.invoiceRequest.findUnique({
      where: { createdById_requestKeyHash: { createdById: ownerUserId, requestKeyHash } },
      select: { id: true, invoiceNo: true, salesAmount: true, taxAmount: true, totalAmount: true },
    })
  }

  private async writeHistory(
    tx: Prisma.TransactionClient,
    input: {
      readonly action: 'SUBMIT' | 'NOTIFY' | 'UPLOAD_DOCUMENT'
      readonly actingForUserId: string
      readonly actorUserId: string
      readonly fromStatus: 'PENDING_REVIEW' | 'NOTIFIED' | null
      readonly occurredAt: Date
      readonly requestId: string
      readonly toStatus: 'PENDING_REVIEW' | 'NOTIFIED' | 'ISSUED'
    },
  ): Promise<void> {
    await tx.invoiceRequestStatusHistory.create({
      data: {
        requestId: input.requestId,
        action: input.action,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: null,
        actorUserId: input.actorUserId,
        actingForUserId: input.actingForUserId,
        occurredAt: input.occurredAt,
      },
    })
  }

  private valid(sourceRef: string, plan: InvoiceRequestImportItemPlan): InvoiceRequestImportItemResultDto {
    return {
      sourceRef,
      outcome: 'VALID',
      invoiceRequestId: null,
      invoiceNo: null,
      code: null,
      message: null,
      salesAmount: plan.salesAmount.toString(),
      taxAmount: plan.taxAmount.toString(),
      totalAmount: plan.totalAmount.toString(),
      taxOverridden: plan.taxOverridden,
    }
  }

  private replayed(sourceRef: string, row: ExistingImportRow): InvoiceRequestImportItemResultDto {
    const salesAmount = BigInt(row.salesAmount.toFixed(0))
    const appliedTaxAmount = BigInt(row.taxAmount.toFixed(0))
    const computedTaxAmount = (salesAmount * 5n + 50n) / 100n
    return {
      sourceRef,
      outcome: 'REPLAYED',
      invoiceRequestId: row.id,
      invoiceNo: row.invoiceNo,
      code: null,
      message: null,
      salesAmount: row.salesAmount.toFixed(0),
      taxAmount: row.taxAmount.toFixed(0),
      totalAmount: row.totalAmount.toFixed(0),
      taxOverridden: appliedTaxAmount !== computedTaxAmount,
    }
  }

  private failed(sourceRef: string, code: string, message: string): InvoiceRequestImportItemResultDto {
    return { sourceRef, outcome: 'FAILED', invoiceRequestId: null, invoiceNo: null, code, message, salesAmount: null, taxAmount: null, totalAmount: null, taxOverridden: false }
  }

  /**
   * 单条失败只回执不带批：已知的域内失败转成 FAILED，未知异常继续上抛，
   * 避免把程序缺陷伪装成「这一条数据不合法」。
   */
  private failure(sourceRef: string, error: unknown): InvoiceRequestImportItemResultDto {
    if (error instanceof InvoiceRequestImportItemError) {
      return this.failed(sourceRef, error.code, error.message)
    }
    if (error instanceof ApiException) {
      return this.failed(sourceRef, error.code, error.publicMessage)
    }
    if (error instanceof NumberingGenerationError) {
      return this.failed(sourceRef, INVOICE_REQUEST_ERROR_CODES.NUMBER_UNAVAILABLE, '申请单号暂时无法派发，请检查编号规则 INVOICE_REQUEST 后重试')
    }
    throw error
  }
}
