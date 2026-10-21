import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { MediaAssetRetentionService } from '../media/media-retention.service'
import { MediaAssetLifecycleError } from '../media/media-asset.service'
import { normalizePackagingRecipients } from '../packaging-costs/packaging-cost.normalizer'
import type { PackagingPaymentProfileDto, PaymentRecipientAccountInputDto, SupplierPaymentProfileSaveDto } from './payment-recipient.dto'
import { PaymentRecipientService, mapProfile, mapRecipientAccount, profileInclude } from './payment-recipient.service'
import { recipientFailure, recipientStateChanged } from './payment-recipient.normalizer'

export interface PackagingRecipientSource { id: string, packagingVendor: string }
@Injectable()
export class PackagingPaymentProfileService {
  constructor(private readonly prisma: PrismaService, private readonly recipients: PaymentRecipientService,
    private readonly access: AccessControlService, private readonly audit: AuditService, private readonly retention: MediaAssetRetentionService) {}
  async read(actorUserId: string): Promise<PackagingPaymentProfileDto> {
    const [user, permissions] = await Promise.all([this.prisma.user.findUnique({ where: { id: actorUserId }, select: { status: true } }), this.access.getPermissionCodes(actorUserId)])
    if (user?.status !== 'ACTIVE' || !permissions.some(code => ['supplier-payment-profiles:read', 'packaging-costs:create', 'packaging-costs:read'].includes(code))) return recipientFailure('FORBIDDEN', '权限不足', 403)
    return this.dto(await this.prisma.paymentRecipientProfile.findUnique({ where: { packagingVendor: 'CHENGXIN' }, include: profileInclude }))
  }
  async save(context: { actorUserId: string, requestId: string }, input: SupplierPaymentProfileSaveDto): Promise<PackagingPaymentProfileDto> {
    const accounts = normalizePackagingRecipients(input.accounts)
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || Object.keys(input).some(key => !['accounts', 'expectedVersion'].includes(key))) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '收款资料版本无效')
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        const [user, permissions] = await Promise.all([tx.user.findUnique({ where: { id: context.actorUserId }, select: { status: true } }), this.access.getPermissionCodesInTransaction(tx, context.actorUserId)])
        if (user?.status !== 'ACTIVE' || !this.access.hasAll(permissions, ['supplier-payment-profiles:read', 'supplier-payment-profiles:update'])) return recipientFailure('FORBIDDEN', '权限不足', 403)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM payment_recipient_profiles WHERE packaging_vendor = 'CHENGXIN' FOR UPDATE`)
        let profile = await tx.paymentRecipientProfile.findUnique({ where: { packagingVendor: 'CHENGXIN' }, include: profileInclude })
        if ((profile?.version ?? 0) !== input.expectedVersion) return recipientStateChanged()
        await this.recipients.prepareImages(tx, context.actorUserId, accounts, profile?.accounts ?? [])
        const previousIds = profile?.accounts.flatMap(row => row.qrMediaAssetId ? [row.qrMediaAssetId] : []) ?? []
        profile = profile
          ? await tx.paymentRecipientProfile.update({ where: { id: profile.id }, data: { version: { increment: 1 }, updatedByUserId: context.actorUserId }, include: profileInclude })
          : await tx.paymentRecipientProfile.create({ data: { packagingVendor: 'CHENGXIN', createdByUserId: context.actorUserId, updatedByUserId: context.actorUserId }, include: profileInclude })
        await this.recipients.writeAccounts(tx, profile.id, accounts)
        for (const assetId of new Set(previousIds)) {
          const result = await this.retention.markUnreferencedForTrash(tx, assetId)
          if (!['ACTIVE_REFERENCE', 'TRASHED'].includes(result)) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '收款码状态已变化，请刷新后重试')
        }
        const saved = await tx.paymentRecipientProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
        await this.audit.record(tx, { eventType: 'PACKAGING_PAYMENT_PROFILE_SAVED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId,
          targetType: 'PAYMENT_RECIPIENT_PROFILE', targetId: saved.id, metadata: { packagingVendor: 'CHENGXIN', version: saved.version, paymentMethods: accounts.map(row => row.paymentMethod).join(',') } })
        return this.dto(saved)
      }, { timeout: 30_000 })
    } catch (error) {
      if (error instanceof ApiException) throw error
      if (error instanceof MediaAssetLifecycleError) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '收款码已失效，请重新上传')
      if (['P2002', '23505', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(readPersistenceErrorFacts(error), code))) return recipientStateChanged()
      throw error
    }
  }
  async createForRequest(tx: Prisma.TransactionClient, actorUserId: string, requestId: string, input: readonly PaymentRecipientAccountInputDto[]) {
    const accounts = normalizePackagingRecipients(input, 1)
    await this.recipients.prepareImages(tx, actorUserId, accounts, [])
    const profile = await tx.paymentRecipientProfile.create({ data: { packagingRequestId: requestId, createdByUserId: actorUserId, updatedByUserId: actorUserId } })
    await this.recipients.writeAccounts(tx, profile.id, accounts)
  }
  async getForRequest(tx: Pick<Prisma.TransactionClient, 'paymentRecipientProfile'>, row: PackagingRecipientSource) {
    const profile = await tx.paymentRecipientProfile.findUnique({ where: row.packagingVendor === 'CHENGXIN' ? { packagingVendor: 'CHENGXIN' } : { packagingRequestId: row.id }, include: profileInclude })
    return profile ? mapProfile(profile) : null
  }
  async requireConfigured(tx: Prisma.TransactionClient) {
    const profile = await this.getForRequest(tx, { id: '', packagingVendor: 'CHENGXIN' })
    if (!profile?.accounts.length) return recipientFailure('PAYMENT_RECIPIENT_UNAVAILABLE', '诚信木箱尚未配置收款方式，请联系管理员')
  }
  async resolveForPayment(tx: Prisma.TransactionClient, source: PackagingRecipientSource, input: { recipientAccountId: string, recipientProfileVersion: number, paymentMethod: string }) {
    const profile = await this.getForRequest(tx, source)
    if (!profile) return recipientFailure('PAYMENT_RECIPIENT_UNAVAILABLE', '该提报尚未配置收款方式，暂不能付款')
    // 付款已持有提报锁，随后锁 profile；与配置更新串行，防止核对后被换码。
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payment_recipient_profiles WHERE id = ${profile.id}::uuid FOR UPDATE`)
    const latest = await tx.paymentRecipientProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileInclude })
    if (latest.version !== input.recipientProfileVersion) return recipientStateChanged()
    const account = latest.accounts.find(item => item.id === input.recipientAccountId && item.enabled && item.paymentMethod === input.paymentMethod && ['ALIPAY', 'WECHAT'].includes(item.paymentMethod))
    if (!account?.qrMediaAssetId) return recipientFailure('PAYMENT_RECIPIENT_UNAVAILABLE', '请选择该包装厂商已配置的收款方式')
    const image = await tx.mediaAsset.findUnique({ where: { id: account.qrMediaAssetId }, select: { status: true, deletedAt: true } })
    if (image?.status !== 'READY' || image.deletedAt) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '收款码当前不可用')
    return { snapshot: mapRecipientAccount(account), qrMediaAssetId: account.qrMediaAssetId }
  }
  private dto(profile: Prisma.PaymentRecipientProfileGetPayload<{ include: typeof profileInclude }> | null): PackagingPaymentProfileDto {
    return { vendor: 'CHENGXIN', vendorName: '沙井·诚信木箱', version: profile?.version ?? 0, accounts: profile ? mapProfile(profile).accounts : [], updatedAt: profile?.updatedAt.toISOString() ?? null, updatedBy: profile ? { id: profile.updatedBy.id, name: profile.updatedBy.displayName, avatarUrl: profile.updatedBy.profile?.avatarUrl ?? null } : null }
  }
}
