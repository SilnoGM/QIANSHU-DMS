import type { Prisma } from '../../generated/prisma/client'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AccessControlService } from '../access-control/access-control.service'
import type { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { MediaAssetRetentionService } from '../media/media-retention.service'
import type { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { PaymentRecipientService } from './payment-recipient.service'

const actor = '00000000-0000-4000-8000-000000000101'
const imageId = '00000000-0000-4000-8000-000000000102'
function fixture() {
  const account = { id: 'account', profileId: 'profile', paymentMethod: 'BANK_TRANSFER', enabled: true, recipientName: 'Recipient', bankName: 'Bank', bankAccount: '12345', bankBranch: null, qrMediaAssetId: null }
  const profile = { id: 'profile', version: 2, supplierValue: 'SUPPLIER', accounts: [account] }
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    paymentRecipientProfile: { findUnique: jest.fn().mockResolvedValue(profile), findUniqueOrThrow: jest.fn().mockResolvedValue(profile), create: jest.fn().mockResolvedValue(profile) },
    paymentRecipientAccount: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), upsert: jest.fn().mockResolvedValue(account) },
    mediaAsset: { findUnique: jest.fn().mockResolvedValue({ status: 'READY', deletedAt: null }), findMany: jest.fn().mockResolvedValue([]) },
  }
  const media = { activate: jest.fn().mockResolvedValue(undefined) }
  const service = new PaymentRecipientService({} as PrismaService, {} as DictionaryLookupService, media as unknown as MediaAssetService, {} as MediaAssetRetentionService,
    { stat: jest.fn().mockResolvedValue({ sizeBytes: 100n }) } as unknown as MediaContentDeliveryService, {} as AccessControlService, {} as AuditService)
  return { service, tx, transaction: tx as unknown as Prisma.TransactionClient, profile, account, media }
}
describe('PaymentRecipientService payment selection', () => {
  const order = { id: 'order', supplierValue: 'SUPPLIER', productMode: 'CATALOG' }
  const input = { recipientAccountId: 'account', recipientProfileVersion: 2, paymentMethod: 'BANK_TRANSFER' }
  it('locks and re-reads the correct supplier profile before returning an authoritative snapshot', async () => {
    const h = fixture()
    expect(await h.service.resolveForPayment(h.transaction, order, input)).toEqual({ qrMediaAssetId: null, snapshot: {
      id: 'account', paymentMethod: 'BANK_TRANSFER', recipientName: 'Recipient', bankName: 'Bank', bankAccount: '12345', bankBranch: null, qrMediaAssetId: null, qrContentUrl: null,
    } })
    expect(h.tx.paymentRecipientProfile.findUnique).toHaveBeenCalledWith({ where: { supplierValue: 'SUPPLIER' }, select: { id: true } })
    expect(h.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.tx.paymentRecipientProfile.findUniqueOrThrow.mock.invocationCallOrder[0])
  })
  it.each([
    { ...input, recipientProfileVersion: 1 },
    { ...input, recipientAccountId: 'another-supplier-account' },
    { ...input, paymentMethod: 'ALIPAY' },
  ])('rejects stale or unrelated account selection %#', async changed => {
    const h = fixture()
    await expect(h.service.resolveForPayment(h.transaction, order, changed)).rejects.toMatchObject({ code: changed.recipientProfileVersion === 1 ? 'PAYMENT_RECIPIENT_STATE_CHANGED' : 'PAYMENT_RECIPIENT_UNAVAILABLE' })
  })
  it('resolves custom accounts only from this order and rejects disabled accounts', async () => {
    const h = fixture()
    h.account.enabled = false
    await expect(h.service.resolveForPayment(h.transaction, { ...order, productMode: 'CUSTOM', supplierValue: null }, input)).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_UNAVAILABLE' })
    expect(h.tx.paymentRecipientProfile.findUnique).toHaveBeenCalledWith({ where: { purchaseOrderId: 'order' }, select: { id: true } })
  })
  it.each(['foreign', 'wrong-purpose', 'expired', 'ready'])('rejects %s temporary QR before creating order data', async state => {
    const h = fixture()
    h.tx.mediaAsset.findMany.mockResolvedValue([{ id: imageId, createdByUserId: state === 'foreign' ? 'someone-else' : actor,
      uploadPurpose: state === 'wrong-purpose' ? 'PURCHASE_PAYMENT_VOUCHER' : 'PAYMENT_RECIPIENT_QR', status: state === 'ready' ? 'READY' : 'UPLOADING',
      uploadExpiresAt: new Date(Date.now() + (state === 'expired' ? -1000 : 3600000)), mediaType: 'IMAGE', mimeType: 'image/png',
      objectKey: 'assets/test.png', checksumSha256: 'a'.repeat(64), sizeBytes: 100n, deletedAt: null }])
    await expect(h.service.createForOrder(h.transaction, actor, 'order', [{ paymentMethod: 'ALIPAY', recipientName: 'Recipient', qrMediaAssetId: imageId }])).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE' })
    expect(h.tx.paymentRecipientProfile.create).not.toHaveBeenCalled()
    expect(h.media.activate).not.toHaveBeenCalled()
  })
})
