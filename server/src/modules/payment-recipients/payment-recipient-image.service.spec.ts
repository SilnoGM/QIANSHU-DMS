import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AccessControlService } from '../access-control/access-control.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { PaymentRecipientImageService } from './payment-recipient-image.service'

function fixture(permissions: string[], overrides: Record<string, unknown> = {}) {
  const asset = { id: 'image', createdByUserId: 'actor', uploadPurpose: 'PAYMENT_RECIPIENT_QR', status: 'UPLOADING', uploadExpiresAt: new Date(Date.now() + 10000),
    deletedAt: null, mediaType: 'IMAGE', mimeType: 'image/png', objectKey: 'assets/qr.png', checksumSha256: 'a'.repeat(64), originalFilename: 'qr.png',
    packagingRecipientSnapshots: [], paymentRecipientAccounts: [], paymentRecipientSnapshots: [], ...overrides }
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) }, mediaAsset: { findUnique: jest.fn().mockResolvedValue(asset) }, purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: 'catalog-order' }) } }
  const delivery = { stat: jest.fn().mockResolvedValue({ sizeBytes: 100n }), mode: 'stream' }
  const media = { prepare: jest.fn() }
  const service = new PaymentRecipientImageService(prisma as unknown as PrismaService, media as unknown as MediaAssetService, delivery as unknown as MediaContentDeliveryService,
    { getPermissionCodes: jest.fn().mockResolvedValue(permissions) } as unknown as AccessControlService)
  return { service, delivery, media, prisma }
}
describe('Payment recipient image authorization', () => {
  it('allows an uploader with create permission to preview only their unexpired QR', async () => {
    const h = fixture(['purchase-orders:create'])
    await expect(h.service.content('actor', 'image', undefined, 'HEAD')).resolves.toMatchObject({ status: 200, headers: { 'Content-Type': 'image/png' } })
  })
  it.each([{ createdByUserId: 'another' }, { uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER' }, { uploadExpiresAt: new Date(0) }])('rejects a foreign, wrong-purpose or expired temporary image %#', async overrides => {
    const h = fixture(['purchase-orders:create'], overrides)
    await expect(h.service.content('actor', 'image', undefined, 'HEAD')).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_IMAGE_NOT_FOUND' })
    expect(h.delivery.stat).not.toHaveBeenCalled()
  })
  it('keeps historical QR readable to finance after profile replacement', async () => {
    const h = fixture(['purchase-orders:payment'], { status: 'READY', paymentRecipientSnapshots: [{ id: 'payment' }] })
    await expect(h.service.content('actor', 'image', undefined, 'HEAD')).resolves.toMatchObject({ status: 200 })
  })
  it.each(['purchase-orders:read', 'purchase-orders:review'])('allows %s to read a QR referenced by a catalog order', async permission => {
    const h = fixture([permission], { status: 'READY', paymentRecipientAccounts: [{ profile: { supplierValue: 'SUPPLIER', purchaseOrderId: null, createdByUserId: 'another' } }] })
    await expect(h.service.content('actor', 'image', undefined, 'HEAD')).resolves.toMatchObject({ status: 200 })
    expect(h.prisma.purchaseOrder.findFirst).toHaveBeenCalledWith({ where: { supplierValue: { in: ['SUPPLIER'] } }, select: { id: true } })
    h.prisma.purchaseOrder.findFirst.mockResolvedValue(null)
    await expect(h.service.content('actor', 'image', undefined, 'HEAD')).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_IMAGE_NOT_FOUND' })
  })
  it('does not allow a creator to read another order or an unassociated READY image', async () => {
    const h = fixture(['purchase-orders:create'], { status: 'READY', paymentRecipientAccounts: [{ profile: { supplierValue: null, purchaseOrderId: 'order', createdByUserId: 'another' } }] })
    await expect(h.service.content('actor', 'image', undefined, 'HEAD')).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_IMAGE_NOT_FOUND' })
  })
  it('refuses unauthorized upload before consuming its stream', async () => {
    const h = fixture(['purchase-orders:payment'])
    await expect(h.service.upload('actor', {} as SalesOrderDocumentMultipartRequest)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(h.media.prepare).not.toHaveBeenCalled()
  })
})

describe('Packaging recipient QR isolation', () => {
  it('allows packaging creators to preview CHENGXIN while denying procurement finance', async () => {
    const overrides = { status: 'READY', paymentRecipientAccounts: [{ profile: { packagingVendor: 'CHENGXIN' } }] }
    await expect(fixture(['packaging-costs:create'], overrides).service.content('actor', 'image', undefined, 'HEAD')).resolves.toMatchObject({ status: 200 })
    await expect(fixture(['purchase-orders:payment'], overrides).service.content('actor', 'image', undefined, 'HEAD')).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_IMAGE_NOT_FOUND' })
  })
  it('retains historical packaging QR access after administrator replacement', async () => {
    await expect(fixture(['packaging-costs:read'], { status: 'READY', packagingRecipientSnapshots: [{ id: 'paid' }] }).service.content('actor', 'image', undefined, 'HEAD')).resolves.toMatchObject({ status: 200 })
  })
})
