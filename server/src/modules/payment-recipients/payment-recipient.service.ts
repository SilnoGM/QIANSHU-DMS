import { Injectable } from '@nestjs/common'
import { Prisma, type PaymentRecipientAccount } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { DictionaryLookupService, DictionaryLookupValidationError, DictionaryValueUnavailableError } from '../dictionaries/dictionary-lookup.service'
import { MediaAssetService, MediaAssetLifecycleError } from '../media/media-asset.service'
import { MediaAssetRetentionService } from '../media/media-retention.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import type { PaymentRecipientAccountDto, PaymentRecipientAccountInputDto, PaymentRecipientProfileDto, SupplierPaymentProfileDto, SupplierPaymentProfilePageDto, SupplierPaymentProfileQueryDto, SupplierPaymentProfileSaveDto } from './payment-recipient.dto'
import { PAYMENT_RECIPIENT_METHODS } from './payment-recipient.dto'
import { normalizePaymentRecipientAccounts, recipientFailure, recipientStateChanged, type NormalizedPaymentRecipientAccount } from './payment-recipient.normalizer'

export interface PaymentRecipientOrder { readonly id: string, readonly supplierValue: string | null, readonly productMode: string }
export const profileInclude = { accounts: true, updatedBy: { select: { id: true, displayName: true } } } satisfies Prisma.PaymentRecipientProfileInclude
type Profile = Prisma.PaymentRecipientProfileGetPayload<{ include: typeof profileInclude }>
export const recipientContentUrl = (id: string) => `/api/payment-recipient-images/${id}/content`
export function mapRecipientAccount(row: Pick<PaymentRecipientAccount, 'id' | 'paymentMethod' | 'recipientName' | 'qrMediaAssetId' | 'bankName' | 'bankAccount' | 'bankBranch'>): PaymentRecipientAccountDto {
  return { id: row.id, paymentMethod: row.paymentMethod as PaymentRecipientAccountDto['paymentMethod'], recipientName: row.recipientName,
    qrMediaAssetId: row.qrMediaAssetId, qrContentUrl: row.qrMediaAssetId ? recipientContentUrl(row.qrMediaAssetId) : null,
    bankName: row.bankName, bankAccount: row.bankAccount, bankBranch: row.bankBranch }
}
export function mapProfile(row: Profile): PaymentRecipientProfileDto {
  return { id: row.id, version: row.version, accounts: row.accounts.filter(account => account.enabled)
    .sort((a, b) => PAYMENT_RECIPIENT_METHODS.indexOf(a.paymentMethod as PaymentRecipientAccountDto['paymentMethod']) - PAYMENT_RECIPIENT_METHODS.indexOf(b.paymentMethod as PaymentRecipientAccountDto['paymentMethod']))
    .map(mapRecipientAccount) }
}
function profileWhere(order: PaymentRecipientOrder): Prisma.PaymentRecipientProfileWhereUniqueInput | null {
  if (order.productMode === 'CUSTOM') return { purchaseOrderId: order.id }
  return order.supplierValue ? { supplierValue: order.supplierValue } : null
}
function mapError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof DictionaryValueUnavailableError) return recipientFailure('PAYMENT_RECIPIENT_SUPPLIER_UNAVAILABLE', '供应商当前不可用，请检查字典配置')
  if (error instanceof DictionaryLookupValidationError) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '供应商标识格式无效')
  if (error instanceof MediaAssetLifecycleError) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '收款码已失效，请重新上传')
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) return recipientStateChanged()
  return recipientFailure('INTERNAL_ERROR', '服务器内部错误', 500)
}

@Injectable()
export class PaymentRecipientService {
  constructor(private readonly prisma: PrismaService, private readonly dictionary: DictionaryLookupService,
    private readonly media: MediaAssetService, private readonly retention: MediaAssetRetentionService,
    private readonly delivery: MediaContentDeliveryService, private readonly access: AccessControlService, private readonly audit: AuditService) {}

  async list(query: SupplierPaymentProfileQueryDto): Promise<SupplierPaymentProfilePageDto> {
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20, keyword = query.keyword?.trim()
    return this.prisma.$transaction(async tx => {
      const where: Prisma.DictionaryItemWhereInput = { dictionaryType: { code: 'service_provider.supplier' },
        ...(keyword ? { OR: [{ value: { contains: keyword, mode: 'insensitive' } }, { label: { contains: keyword, mode: 'insensitive' } }] } : {}) }
      const [total, suppliers] = await Promise.all([tx.dictionaryItem.count({ where }), tx.dictionaryItem.findMany({ where,
        include: { dictionaryType: { select: { enabled: true } } }, orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })])
      const profiles = await tx.paymentRecipientProfile.findMany({ where: { supplierValue: { in: suppliers.map(row => row.value) } }, include: profileInclude })
      return { total, page, pageSize, items: suppliers.map(supplier => this.supplierDto(supplier.value, supplier.label, supplier.enabled && supplier.dictionaryType.enabled, profiles.find(row => row.supplierValue === supplier.value) ?? null)) }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }

  async save(context: { actorUserId: string, requestId: string }, supplierValue: string, input: SupplierPaymentProfileSaveDto): Promise<SupplierPaymentProfileDto> {
    const accounts = normalizePaymentRecipientAccounts(input.accounts)
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || Object.keys(input).some(key => !['accounts', 'expectedVersion'].includes(key))) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '收款资料版本无效')
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        const [actor, granted] = await Promise.all([tx.user.findUnique({ where: { id: context.actorUserId }, select: { status: true } }), this.access.getPermissionCodesInTransaction(tx, context.actorUserId)])
        if (actor?.status !== 'ACTIVE' || !this.access.hasAll(granted, ['supplier-payment-profiles:read', 'supplier-payment-profiles:update'])) return recipientFailure('FORBIDDEN', '权限不足', 403)
        // 字典锁先于收款资料锁；支付侧仅锁已存在 profile，不反向申请供应商字典写锁。
        const supplier = await this.dictionary.requireEffectiveValue(tx, { dictionaryCode: 'service_provider.supplier', value: supplierValue })
        await tx.$queryRaw(Prisma.sql`SELECT id FROM payment_recipient_profiles WHERE supplier_value = ${supplier.value} FOR UPDATE`)
        let profile = await tx.paymentRecipientProfile.findUnique({ where: { supplierValue: supplier.value }, include: profileInclude })
        if ((profile?.version ?? 0) !== input.expectedVersion) return recipientStateChanged()
        await this.prepareImages(tx, context.actorUserId, accounts, profile?.accounts ?? [])
        const oldImages = profile?.accounts.flatMap(row => row.qrMediaAssetId ? [row.qrMediaAssetId] : []) ?? []
        profile = profile
          ? await tx.paymentRecipientProfile.update({ where: { id: profile.id }, data: { version: { increment: 1 }, updatedByUserId: context.actorUserId }, include: profileInclude })
          : await tx.paymentRecipientProfile.create({ data: { supplierValue: supplier.value, createdByUserId: context.actorUserId, updatedByUserId: context.actorUserId }, include: profileInclude })
        await this.writeAccounts(tx, profile.id, accounts)
        for (const assetId of [...new Set(oldImages)]) {
          const retained = await this.retention.markUnreferencedForTrash(tx, assetId)
          if (!['ACTIVE_REFERENCE', 'TRASHED'].includes(retained)) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '收款码状态已变化，请刷新后重试')
        }
        const saved = await tx.paymentRecipientProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
        await this.audit.record(tx, { eventType: 'SUPPLIER_PAYMENT_PROFILE_SAVED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId,
          targetType: 'PAYMENT_RECIPIENT_PROFILE', targetId: saved.id, metadata: { supplierValue: supplier.value, version: saved.version, paymentMethods: accounts.map(row => row.paymentMethod).join(',') } })
        return this.supplierDto(supplier.value, supplier.label, true, saved)
      }, { timeout: 30_000 })
    } catch (error) { return mapError(error) }
  }

  async createForOrder(tx: Prisma.TransactionClient, actorUserId: string, orderId: string, input: readonly PaymentRecipientAccountInputDto[]): Promise<PaymentRecipientProfileDto> {
    const accounts = normalizePaymentRecipientAccounts(input, 1)
    await this.prepareImages(tx, actorUserId, accounts, [])
    const profile = await tx.paymentRecipientProfile.create({ data: { purchaseOrderId: orderId, createdByUserId: actorUserId, updatedByUserId: actorUserId } })
    await this.writeAccounts(tx, profile.id, accounts)
    return mapProfile(await tx.paymentRecipientProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude }))
  }

  async getForOrder(tx: Prisma.TransactionClient, order: PaymentRecipientOrder): Promise<PaymentRecipientProfileDto | null> {
    const where = profileWhere(order)
    const profile = where ? await tx.paymentRecipientProfile.findUnique({ where, include: profileInclude }) : null
    return profile ? mapProfile(profile) : null
  }

  async resolveForPayment(tx: Prisma.TransactionClient, order: PaymentRecipientOrder, input: { recipientAccountId: string, recipientProfileVersion: number, paymentMethod: string }): Promise<{ snapshot: PaymentRecipientAccountDto, qrMediaAssetId: string | null }> {
    const where = profileWhere(order)
    if (!where) return recipientFailure('PAYMENT_RECIPIENT_UNAVAILABLE', '该采购单尚未配置收款方式')
    const located = await tx.paymentRecipientProfile.findUnique({ where, select: { id: true } })
    if (!located) return recipientFailure('PAYMENT_RECIPIENT_UNAVAILABLE', '该采购单尚未配置收款方式')
    // 调用方已持有采购父单锁；profile 锁与管理员保存串行化，防止核对后更换收款码。
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payment_recipient_profiles WHERE id = ${located.id}::uuid FOR UPDATE`)
    const profile = await tx.paymentRecipientProfile.findUniqueOrThrow({ where: { id: located.id }, include: profileInclude })
    if (profile.version !== input.recipientProfileVersion) return recipientStateChanged()
    const account = profile.accounts.find(row => row.id === input.recipientAccountId && row.enabled && row.paymentMethod === input.paymentMethod)
    if (!account) return recipientFailure('PAYMENT_RECIPIENT_UNAVAILABLE', '请选择该供应商已配置的收款方式')
    if (account.qrMediaAssetId) {
      const image = await tx.mediaAsset.findUnique({ where: { id: account.qrMediaAssetId }, select: { status: true, deletedAt: true } })
      if (image?.status !== 'READY' || image.deletedAt) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '收款码当前不可用')
    }
    return { snapshot: mapRecipientAccount(account), qrMediaAssetId: account.qrMediaAssetId }
  }

  private supplierDto(supplierValue: string, supplierName: string, supplierEnabled: boolean, profile: Profile | null): SupplierPaymentProfileDto {
    return { supplierValue, supplierName, supplierEnabled, version: profile?.version ?? 0, accounts: profile ? mapProfile(profile).accounts : [],
      updatedAt: profile?.updatedAt.toISOString() ?? null, updatedBy: profile ? { id: profile.updatedBy.id, name: profile.updatedBy.displayName } : null }
  }
  async writeAccounts(tx: Prisma.TransactionClient, profileId: string, accounts: NormalizedPaymentRecipientAccount[]) {
    await tx.paymentRecipientAccount.updateMany({ where: { profileId }, data: { enabled: false } })
    for (const account of accounts) await tx.paymentRecipientAccount.upsert({ where: { profileId_paymentMethod: { profileId, paymentMethod: account.paymentMethod } },
      create: { profileId, ...account }, update: { ...account, enabled: true } })
  }
  async prepareImages(tx: Prisma.TransactionClient, actorUserId: string, accounts: NormalizedPaymentRecipientAccount[], previous: PaymentRecipientAccount[]) {
    const ids = [...new Set(accounts.flatMap(row => row.qrMediaAssetId ? [row.qrMediaAssetId] : []))].sort()
    if (!ids.length) return
    await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`)
    const images = await tx.mediaAsset.findMany({ where: { id: { in: ids } } })
    for (const account of accounts) {
      if (!account.qrMediaAssetId) continue
      const asset = images.find(row => row.id === account.qrMediaAssetId)
      const reused = previous.some(row => row.paymentMethod === account.paymentMethod && row.qrMediaAssetId === account.qrMediaAssetId)
      if (!asset || asset.deletedAt || asset.uploadPurpose !== 'PAYMENT_RECIPIENT_QR' || asset.mediaType !== 'IMAGE' || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType ?? '') || !asset.objectKey || !asset.checksumSha256 || !asset.sizeBytes || asset.sizeBytes > 10485760n
        || (reused ? asset.status !== 'READY' : asset.status !== 'UPLOADING' || asset.createdByUserId !== actorUserId || !asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date())) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '所选收款码不可用，请重新上传')
      try {
        const stored = await this.delivery.stat(requireMediaObjectKeyNamespace(asset.objectKey, 'assets'))
        if (!stored || stored.sizeBytes !== asset.sizeBytes) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '所选收款码不可用，请重新上传')
      } catch (error) {
        if (error instanceof ApiException) throw error
        return recipientFailure('MEDIA_STORAGE_UNAVAILABLE', '图片存储暂时不可用', 503)
      }
      if (!reused) await this.media.activate(tx, asset.id)
    }
  }
}
