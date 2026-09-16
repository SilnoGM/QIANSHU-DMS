import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService, AuditWriteFailedError } from '../audit/audit.service'
import { DictionaryLookupService, DictionaryValueUnavailableError } from '../dictionaries/dictionary-lookup.service'
import { FundPostingService } from '../fund-accounts/application/fund-posting.contract'
import { FundPostingError } from '../fund-accounts/application/fund-posting.errors'
import { FundCalculationError } from '../fund-accounts/domain/fund-calculation.errors'
import { MediaAssetService, MediaAssetLifecycleError } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { PackagingCostQueryService } from './packaging-cost-query.service'
import { normalizePackagingCostCreate, packagingCostFailure, packagingCostIdempotencyKey, packagingCostUuid, type PackagingCostContext } from './packaging-cost.normalizer'
import type { PackagingCostRequestCreateDto, PackagingCostRequestPayDto } from './packaging-cost.dto'

const hash = (value: string) => createHash('sha256').update(value).digest()
const imageFailure = () => packagingCostFailure('PACKAGING_COST_IMAGE_UNAVAILABLE', '所选截图凭证当前不可用，请重新上传')
function stateChanged(): never { return packagingCostFailure('PACKAGING_COST_STATE_CHANGED', '提报状态已变化，请刷新后重新核对', 409) }
function mapError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof DictionaryValueUnavailableError) return packagingCostFailure('PACKAGING_COST_TYPE_UNAVAILABLE', '包装类型当前不可用')
  if (error instanceof MediaAssetLifecycleError) return imageFailure()
  if (error instanceof FundPostingError) {
    if (error.code === 'FUND_CONCURRENT_STATE_CHANGED') return stateChanged()
    if (error.code === 'FUND_INTERNAL_ERROR') return packagingCostFailure('INTERNAL_ERROR', '资金服务内部错误', 500)
    return packagingCostFailure('PACKAGING_COST_POSTING_UNAVAILABLE', '归属人资金账户或 WOODEN_PACKING_COST 规则当前不可用，付款未完成')
  }
  if (error instanceof FundCalculationError) return packagingCostFailure('PACKAGING_COST_POSTING_UNAVAILABLE', '当前金额无法按包装费用规则记账，付款未完成')
  const facts = readPersistenceErrorFacts(error)
  if ((error instanceof AuditWriteFailedError && error.transactionConflict) || ['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) return stateChanged()
  throw error
}
@Injectable()
export class PackagingCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: PackagingCostQueryService,
    private readonly dictionary: DictionaryLookupService,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
    private readonly funds: FundPostingService,
  ) {}
  private async authorize(tx: Prisma.TransactionClient, context: PackagingCostContext, permissions: string[]) {
    const user = await tx.user.findUnique({ where: { id: context.actorUserId }, select: { status: true } })
    const granted = await this.access.getPermissionCodesInTransaction(tx, context.actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(granted, permissions)) return packagingCostFailure('FORBIDDEN', '权限不足', 403)
  }
  async submit(context: PackagingCostContext, input: PackagingCostRequestCreateDto, key: unknown) {
    const normalized = normalizePackagingCostCreate(input)
    const idempotencyKeyHash = hash(packagingCostIdempotencyKey(key))
    const requestFingerprintHash = hash(JSON.stringify({ format: 'packaging-cost.create.v1', ...normalized }))
    const replay = async (tx: Pick<Prisma.TransactionClient, 'packagingCostRequest'>) => {
      const row = await tx.packagingCostRequest.findFirst({ where: { submittedByUserId: context.actorUserId, idempotencyKeyHash } })
      if (row && !Buffer.from(row.requestFingerprintHash).equals(requestFingerprintHash)) return packagingCostFailure('PACKAGING_COST_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的提报内容', 409)
      return row
    }
    let id: string
    try {
      id = await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['packaging-costs:create'])
        const previous = await replay(tx)
        if (previous) return previous.id
        const locator = await tx.purchaseOrderPart.findUnique({ where: { id: normalized.shipmentId }, select: { purchaseOrderId: true } })
        if (!locator) return packagingCostFailure('PACKAGING_COST_NOT_ALLOWED', '货件不存在或当前不能提报')
        // 与入仓/采购变更保持父单到货件的锁序；只读取销售身份，不倒序申请销售行写锁。
        await tx.$queryRaw(Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${locator.purchaseOrderId}::uuid FOR UPDATE`)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE id = ${normalized.shipmentId}::uuid FOR UPDATE`)
        const raced = await replay(tx)
        if (raced) return raced.id
        const shipment = await tx.purchaseOrderPart.findUnique({ where: { id: normalized.shipmentId }, include: { purchaseOrder: { include: { salesOrder: true } } } })
        const order = shipment?.purchaseOrder, source = order?.salesOrder
        if (!shipment || shipment.status !== 'ACTIVE' || !shipment.warehouseReceivedAt || !shipment.shippedAt || !shipment.shipmentNo || !shipment.shippingMarkText
          || !order || !['CONFIRMED', 'COMPLETED'].includes(order.orderStatus) || !source) return packagingCostFailure('PACKAGING_COST_NOT_ALLOWED', '仅已到仓且有销售来源的有效货件可以提报')
        const packagingType = await this.dictionary.requireEffectiveValue(tx, { dictionaryCode: 'warehouse.packaging_type', value: normalized.packagingType })
        const assetIds = [normalized.packagingImageMediaAssetId, normalized.quotationImageMediaAssetId].sort()
        await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id IN (${Prisma.join(assetIds.map(value => Prisma.sql`${value}::uuid`))}) ORDER BY id FOR UPDATE`)
        const assets = await tx.mediaAsset.findMany({ where: {
          id: { in: assetIds }, createdByUserId: context.actorUserId, status: 'UPLOADING', uploadExpiresAt: { gt: new Date() },
          mediaType: 'IMAGE', mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] }, sizeBytes: { gt: 0n, lte: 10n * 1024n * 1024n },
          objectKey: { not: null }, checksumSha256: { not: null }, deletedAt: null,
        } })
        if (assets.length !== 2) return imageFailure()
        for (const asset of assets) {
          try {
            const stored = await this.delivery.stat(requireMediaObjectKeyNamespace(asset.objectKey!, 'assets'))
            if (!stored || stored.sizeBytes !== asset.sizeBytes) return imageFailure()
          } catch (error) {
            if (error instanceof ApiException) throw error
            return packagingCostFailure('MEDIA_STORAGE_UNAVAILABLE', '截图存储暂时不可用', 503)
          }
          await this.media.activate(tx, asset.id)
        }
        const row = await tx.packagingCostRequest.create({ data: {
          ...normalized, packagingVendor: normalized.packagingVendor as 'CHENGXIN' | 'OTHER', packagingTypeName: packagingType.label,
          shipmentNo: shipment.shipmentNo, shippingMarkText: shipment.shippingMarkText, purchaseOrderId: order.id, purchaseOrderNo: order.orderNo,
          salesOrderId: source.id, salesOrderNo: source.orderNo, ownerUserId: source.issuerUserId,
          currencyCode: 'CNY', submittedByUserId: context.actorUserId, idempotencyKeyHash, requestFingerprintHash,
        } })
        await this.audit.record(tx, { eventType: 'PACKAGING_COST_SUBMITTED', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, outcome: 'SUCCESS', targetType: 'PACKAGING_COST_REQUEST', targetId: row.id, metadata: { shipmentId: row.shipmentId, amount: row.amount.toFixed(4), currencyCode: 'CNY' } })
        return row.id
      }, { timeout: 30_000 })
    } catch (error) {
      // 不同货件使用同一幂等键会在唯一约束竞争；只能在回滚后读取已提交结果。
      if (hasPersistenceCode(readPersistenceErrorFacts(error), 'P2002')) {
        const previous = await replay(this.prisma)
        if (previous) return this.queries.getById(previous.id)
      }
      return mapError(error)
    }
    return this.queries.getById(id)
  }
  async pay(context: PackagingCostContext, rawId: string, input: PackagingCostRequestPayDto) {
    const id = packagingCostUuid(rawId)
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || Object.keys(input).some(key => key !== 'expectedVersion')) return packagingCostFailure('VALIDATION_FAILED', '付款确认版本无效')
    try {
      await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context, ['packaging-costs:read', 'packaging-costs:pay'])
        await tx.$queryRaw(Prisma.sql`SELECT id FROM packaging_cost_requests WHERE id = ${id}::uuid FOR UPDATE`)
        const row = await tx.packagingCostRequest.findUnique({ where: { id } })
        if (!row) return packagingCostFailure('PACKAGING_COST_NOT_FOUND', '打木架提报不存在', 404)
        // 同一付款人对同一版本的网络重试可重放；其他付款人或不同版本不能覆盖已付款事实。
        if (row.status === 'PAID' && row.paidByUserId === context.actorUserId && row.version === input.expectedVersion + 1) return
        if (row.status !== 'PENDING_PAYMENT' || row.version !== input.expectedVersion) return stateChanged()
        const fundContext = { ...context, sourceCode: 'PACKAGING_COST', consumerCode: 'PACKAGING_COST.PAY' }
        const postingInput = {
          postingTypeCode: 'WOODEN_PACKING_COST', userId: row.ownerUserId, amount: row.amount.toFixed(2),
          businessId: row.id, businessNo: row.shipmentNo, summary: '打木架费用付款', idempotencyKey: row.id,
        }
        // 以提报时固定的销售出单人为资金归属，不能使用当前付款人。
        // 预览和入账共用当前事务及配置/账户锁；规则、比例、资金和付款审计任一失败均回滚。
        const preview = await this.funds.previewBusinessEventInTransaction(tx, fundContext, postingInput)
        const posting = await this.funds.postBusinessEventInTransaction(tx, fundContext, postingInput, preview)
        const [{ now }] = await tx.$queryRaw<[{ now: Date }]>(Prisma.sql`SELECT clock_timestamp() AS now`)
        await tx.packagingCostRequest.update({ where: { id }, data: { status: 'PAID', paidByUserId: context.actorUserId, paidAt: now, version: { increment: 1 } } })
        await this.audit.record(tx, { eventType: 'PACKAGING_COST_PAID', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, outcome: 'SUCCESS', targetType: 'PACKAGING_COST_REQUEST', targetId: id, metadata: { amount: row.amount.toFixed(4), currencyCode: 'CNY', fundPostingBatchId: posting.batchId } })
      }, { timeout: 30_000 })
    } catch (error) { return mapError(error) }
    return this.queries.getById(id)
  }
}
