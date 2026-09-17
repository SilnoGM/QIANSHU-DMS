import type { Prisma } from '../../src/generated/prisma/client'
import { MediaAssetPersistence } from '../../src/modules/media/media-asset.persistence'
import type { PrismaService } from '../../src/infrastructure/database/prisma.service'
import { AccessControlService } from '../../src/modules/access-control/access-control.service'
import { AuditService } from '../../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../../src/modules/dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../../src/modules/media/media-asset.service'
import type { MediaContentDeliveryService } from '../../src/modules/media/media-content-delivery.service'
import type { MediaAssetRetentionService } from '../../src/modules/media/media-retention.service'
import type { PaymentRecipientAccountInputDto } from '../../src/modules/payment-recipients/payment-recipient.dto'
import { PaymentRecipientService } from '../../src/modules/payment-recipients/payment-recipient.service'

export function paymentRecipientBankAccounts(): PaymentRecipientAccountInputDto[] {
  return [{ paymentMethod: 'BANK_TRANSFER', recipientName: 'Fixture recipient', bankName: 'Fixture bank', bankAccount: 'TEST-BANK-0001', bankBranch: null, qrMediaAssetId: null }]
}

/** 银行资料沿用真实持久化；旧的非图片用例若误触媒体路径必须失败，图片用例须显式传入真实媒体依赖。 */
export function createPaymentRecipientFixture(prisma: PrismaService, options: {
  dictionary?: DictionaryLookupService
  audit?: AuditService
  access?: AccessControlService
  media?: MediaAssetService
  retention?: MediaAssetRetentionService
  delivery?: MediaContentDeliveryService
} = {}): PaymentRecipientService {
  const unsupportedMedia = (): never => { throw new Error('This fixture requires explicit image dependencies') }
  return new PaymentRecipientService(
    prisma, options.dictionary ?? new DictionaryLookupService(prisma),
    options.media ?? { activate: unsupportedMedia } as unknown as MediaAssetService,
    options.retention ?? { markUnreferencedForTrash: unsupportedMedia } as unknown as MediaAssetRetentionService,
    options.delivery ?? { stat: unsupportedMedia } as unknown as MediaContentDeliveryService,
    options.access ?? new AccessControlService(prisma), options.audit ?? new AuditService(),
  )
}

/** 使用正式媒体状态迁移；旧业务测试可直接准备完整元数据，不能凭空把空媒体置为 READY。 */
export function createPaymentMediaFixture(prisma: PrismaService): MediaAssetService {
  const persistence = new MediaAssetPersistence(prisma)
  return {
    activate: async (tx: Prisma.TransactionClient, id: string) => {
      const result = await persistence.activate(tx, id)
      if (result !== 'ACTIVATED' && result !== 'ALREADY_READY') throw new Error('Fixture media cannot be activated')
    },
  } as unknown as MediaAssetService
}

/** 非上传测试准备一张已完成内容校验、尚未归档的图片，绑定到确切应付款；归档仍走正式付款事务。 */
export async function createPaymentVoucherFixture(prisma: PrismaService, purchaseOrderId: string, actorUserId: string, paymentType: 'DEPOSIT' | 'BALANCE') {
  const profile = await prisma.paymentRecipientProfile.findUniqueOrThrow({ where: { purchaseOrderId }, include: { accounts: { where: { enabled: true } } } })
  const payable = await prisma.purchaseOrderPayable.findFirstOrThrow({ where: { purchaseOrderId, paymentType } })
  const asset = await prisma.mediaAsset.create({ data: {
    mediaType: 'IMAGE', uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER', purchasePayableUploadId: payable.id, status: 'UPLOADING',
    mimeType: 'image/png', sizeBytes: 1n, checksumSha256: '0'.repeat(64), width: 1, height: 1,
    originalFilename: 'payment-fixture.png', objectKey: `assets/payment-fixture-${payable.id}.png`,
    createdByUserId: actorUserId, uploadExpiresAt: new Date('2099-01-01'),
  } })
  return { recipientAccountId: profile.accounts[0].id, recipientProfileVersion: profile.version, voucher: { mediaAssetId: asset.id } }
}
