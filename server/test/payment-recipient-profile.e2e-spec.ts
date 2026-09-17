import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import { readPersistenceErrorFacts } from '../src/infrastructure/database/persistence-error-facts'
import type { AccessControlService } from '../src/modules/access-control/access-control.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../src/modules/media/media-asset.service'
import type { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'
import { MediaAssetReferenceRepository } from '../src/modules/media/media-reference.repository'
import { MediaReconciliationPersistence } from '../src/modules/media/media-reconciliation.persistence'
import { MediaAssetRetentionService } from '../src/modules/media/media-retention.service'
import type { MediaStorage } from '../src/modules/media/media-storage'
import { PaymentRecipientService } from '../src/modules/payment-recipients/payment-recipient.service'
import type { PaymentRecipientAccountInputDto } from '../src/modules/payment-recipients/payment-recipient.dto'
import { createPurchaseShippingMarkDatabase } from './purchase-shipping-mark-e2e-database'
import { IsolatedNumberingPrismaService } from './numbering-e2e-database'
import { createAtomicityFixture, createCommands, createReviewMutations, prepareCatalog, prepareImageReview } from './purchase-shipping-mark-atomicity.fixture'
import { createPaymentMediaFixture, createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'

const bank: PaymentRecipientAccountInputDto = { paymentMethod: 'BANK_TRANSFER', recipientName: '收款人', bankName: '银行', bankAccount: '12345678' }
describe('Payment recipient profiles with isolated PostgreSQL', () => {
  jest.setTimeout(60_000)
  let database: Awaited<ReturnType<typeof createPurchaseShippingMarkDatabase>>
  let prisma: PrismaService
  let actorId: string
  let supplierTypeId: string
  let service: PaymentRecipientService
  let retention: MediaAssetRetentionService
  const refs = new MediaAssetReferenceRepository()
  beforeAll(async () => {
    database = await createPurchaseShippingMarkDatabase()
    prisma = new IsolatedNumberingPrismaService(database) as unknown as PrismaService
    await prisma.onModuleInit()
    const actor = await prisma.user.create({ data: { username: 'recipient-operator', usernameNormalized: 'recipient-operator', displayName: 'Recipient operator', passwordHash: 'isolated-only', passwordChangedAt: new Date() } })
    actorId = actor.id
    const type = await prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'service_provider.supplier' } })
    supplierTypeId = type.id
    await prisma.dictionaryItem.create({ data: { dictionaryTypeId: type.id, value: 'BOOTSTRAP_RECIPIENT', label: 'Bootstrap recipient', enabled: true } })
    await prisma.dictionaryType.update({ where: { id: type.id }, data: { enabled: true } })
    retention = new MediaAssetRetentionService(new MediaReconciliationPersistence(prisma), refs, {} as MediaStorage, { trashRetentionDays: 7 })
    service = new PaymentRecipientService(prisma, new DictionaryLookupService(prisma), {
      activate: (tx: PrismaService, id: string) => tx.mediaAsset.update({ where: { id }, data: { status: 'READY', uploadExpiresAt: null } }),
    } as unknown as MediaAssetService, retention, { stat: () => Promise.resolve({ sizeBytes: 100n }) } as unknown as MediaContentDeliveryService,
    { getPermissionCodesInTransaction: () => Promise.resolve(['supplier-payment-profiles:read', 'supplier-payment-profiles:update']), hasAll: () => true } as unknown as AccessControlService, new AuditService())
  })
  afterAll(async () => { await prisma?.onModuleDestroy(); await database?.dispose() })
  const context = () => ({ actorUserId: actorId, requestId: randomUUID() })
  async function supplier() {
    const value = `SUPPLIER_${randomUUID().slice(0, 8).toUpperCase()}`
    await prisma.dictionaryItem.create({ data: { dictionaryTypeId: supplierTypeId, value, label: `测试供应商 ${value}`, enabled: true } })
    return value
  }
  async function image(purpose = 'PAYMENT_RECIPIENT_QR') {
    return prisma.mediaAsset.create({ data: { createdByUserId: actorId, mediaType: 'IMAGE', status: 'UPLOADING', uploadPurpose: purpose,
      uploadExpiresAt: new Date(Date.now() + 3600000), objectKey: `assets/recipient-test-${randomUUID()}.png`, originalFilename: 'qr.png', mimeType: 'image/png', sizeBytes: 100n,
      checksumSha256: 'a'.repeat(64), width: 100, height: 100 } })
  }
  it('lists unconfigured dictionary suppliers and retains disabled account rows', async () => {
    const value = await supplier()
    const empty = await service.list({ page: 1, pageSize: 20, keyword: value })
    expect(empty.items).toEqual([expect.objectContaining({ supplierValue: value, version: 0, accounts: [] })])
    const created = await service.save(context(), value, { expectedVersion: 0, accounts: [bank] })
    expect(created).toMatchObject({ version: 1, updatedBy: { id: actorId }, accounts: [bank] })
    const disabled = await service.save(context(), value, { expectedVersion: 1, accounts: [] })
    expect(disabled).toMatchObject({ version: 2, accounts: [] })
    expect(await prisma.paymentRecipientAccount.count({ where: { profile: { supplierValue: value }, enabled: false } })).toBe(1)
    expect(await prisma.auditEvent.count({ where: { eventType: 'SUPPLIER_PAYMENT_PROFILE_SAVED', targetId: { not: null } } })).toBeGreaterThanOrEqual(2)
  })
  it('serializes concurrent changes and rejects a stale profile version', async () => {
    const value = await supplier()
    await service.save(context(), value, { expectedVersion: 0, accounts: [bank] })
    const attempts = await Promise.allSettled([service.save(context(), value, { expectedVersion: 1, accounts: [{ ...bank, bankAccount: '222' }] }), service.save(context(), value, { expectedVersion: 1, accounts: [{ ...bank, bankAccount: '333' }] })])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((attempts.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'PAYMENT_RECIPIENT_STATE_CHANGED' })
    expect((await service.list({ page: 1, pageSize: 20, keyword: value })).items[0].version).toBe(2)
  })
  it('activates QR atomically, retains it while disabled, then safely retires replaced unreferenced media', async () => {
    const value = await supplier(), first = await image(), second = await image()
    const firstAccount: PaymentRecipientAccountInputDto = { paymentMethod: 'ALIPAY', recipientName: '收款人', qrMediaAssetId: first.id }
    await service.save(context(), value, { expectedVersion: 0, accounts: [firstAccount] })
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('READY')
    await service.save(context(), value, { expectedVersion: 1, accounts: [] })
    expect(await refs.hasActiveReferences(prisma, first.id)).toBe(true)
    expect(await prisma.$transaction(tx => retention.markUnreferencedForTrash(tx, first.id))).toBe('ACTIVE_REFERENCE')
    await service.save(context(), value, { expectedVersion: 2, accounts: [{ ...firstAccount, qrMediaAssetId: second.id }] })
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('TRASHED')
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('READY')
    expect(await refs.hasActiveReferences(prisma, second.id)).toBe(true)
  })
  it('rejects cross-purpose images without creating profile or activating media', async () => {
    const value = await supplier(), voucher = await image('PURCHASE_PAYMENT_VOUCHER')
    await expect(service.save(context(), value, { expectedVersion: 0, accounts: [{ paymentMethod: 'WECHAT', recipientName: '收款人', qrMediaAssetId: voucher.id }] })).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE' })
    expect(await prisma.paymentRecipientProfile.count({ where: { supplierValue: value } })).toBe(0)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: voucher.id } })).status).toBe('UPLOADING')
    await expect(prisma.mediaAsset.update({ where: { id: voucher.id }, data: { uploadPurpose: 'PAYMENT_RECIPIENT_QR' } })).rejects.toBeDefined()
  })
  it('enforces owned profile and method shape in the database independently of DTOs', async () => {
    const value = await supplier()
    const saved = await service.save(context(), value, { expectedVersion: 0, accounts: [bank] })
    const account = await prisma.paymentRecipientAccount.findUniqueOrThrow({ where: { id: saved.accounts[0].id } })
    const badShape = await prisma.paymentRecipientAccount.update({ where: { id: account.id }, data: { bankName: null } }).then(() => null, (error: unknown) => error)
    expect(readPersistenceErrorFacts(badShape).codes.has('23514')).toBe(true)
    // pg 保留 PostgreSQL 的精确约束字段，避免 Prisma adapter 的错误归一化掩盖拒绝来源。
    const client = new Client({ connectionString: database.databaseUrl })
    await client.connect()
    try {
      await expect(client.query(`INSERT INTO purchase_order_payments
        (purchase_order_id,payable_id,payment_type,amount,paid_at,payment_method,created_by_user_id,recipient_snapshot)
        VALUES ($1,$2,'DEPOSIT',1,now(),'BANK_TRANSFER',$3,$4::jsonb)`,
      [randomUUID(), randomUUID(), actorId, JSON.stringify({ id: account.id, paymentMethod: 'BANK_TRANSFER', recipientName: 'Forged', bankName: 'Bank', bankAccount: '123' })]))
        .rejects.toMatchObject({ code: '23514', constraint: 'purchase_payment_recipient_snapshot_check' })
    } finally { await client.end() }
  })

  it('retains the historical QR and immutable snapshot after payment and supplier changes, and replays without recharging', async () => {
    const h = await createAtomicityFixture()
    try {
      const catalog = await prepareCatalog(h)
      const qrRetention = new MediaAssetRetentionService(new MediaReconciliationPersistence(h.prisma), refs, {} as MediaStorage, { trashRetentionDays: 7 })
      const recipients = createPaymentRecipientFixture(h.prisma, { access: h.access, media: createPaymentMediaFixture(h.prisma), retention: qrRetention,
        delivery: { stat: () => Promise.resolve({ sizeBytes: 100n }) } as unknown as MediaContentDeliveryService })
      const upload = (purpose: string, purchasePayableUploadId: string | null = null) => h.prisma.mediaAsset.create({ data: { createdByUserId: h.actor.id, mediaType: 'IMAGE', status: 'UPLOADING', uploadPurpose: purpose, purchasePayableUploadId,
        uploadExpiresAt: new Date(Date.now() + 3600000), objectKey: `assets/recipient-history-${randomUUID()}.png`, originalFilename: 'image.png', mimeType: 'image/png', sizeBytes: 100n, checksumSha256: 'a'.repeat(64), width: 100, height: 100 } })
      const qr = await upload('PAYMENT_RECIPIENT_QR'), replacement = await upload('PAYMENT_RECIPIENT_QR')
      const profile = await recipients.save(h.context(), catalog.supplierValue, { expectedVersion: 0, accounts: [{ paymentMethod: 'ALIPAY', recipientName: '原收款人', qrMediaAssetId: qr.id }] })
      const orderId = await createCommands(h).create(h.context(), catalog.input)
      await createReviewMutations(h).review(h.context(), orderId, await prepareImageReview(h, orderId))
      const payable = await h.prisma.purchaseOrderPayable.findFirstOrThrow({ where: { purchaseOrderId: orderId, paymentType: 'BALANCE' } })
      const voucher = await upload('PURCHASE_PAYMENT_VOUCHER', payable.id)
      const changedScope = await h.prisma.mediaAsset.update({ where: { id: voucher.id }, data: { purchasePayableUploadId: null } }).then(() => null, (error: unknown) => error)
      expect(readPersistenceErrorFacts(changedScope).codes.has('23514')).toBe(true)
      const key = randomUUID()
      const input = { expectedVersion: payable.version, paymentMethod: 'ALIPAY', recipientAccountId: profile.accounts[0].id, recipientProfileVersion: profile.version, voucher: { mediaAssetId: voucher.id } }
      await createReviewMutations(h).payPayable(h.context(), payable.id, input, key)
      const payment = await h.prisma.purchaseOrderPayment.findFirstOrThrow({ where: { payableId: payable.id } })
      expect(payment.recipientQrMediaAssetId).toBe(qr.id)
      expect(payment.recipientSnapshot).toMatchObject({ recipientName: '原收款人', qrMediaAssetId: qr.id })
      expect(await h.prisma.purchaseOrderDocument.findFirst({ where: { paymentId: payment.id, documentType: 'PAYMENT_VOUCHER' } })).toMatchObject({ mediaAssetId: voucher.id, purchaseOrderId: orderId })
      await recipients.save(h.context(), catalog.supplierValue, { expectedVersion: 1, accounts: [{ paymentMethod: 'ALIPAY', recipientName: '新收款人', qrMediaAssetId: replacement.id }] })
      expect(await refs.hasActiveReferences(h.prisma, qr.id)).toBe(true)
      expect(await h.prisma.$transaction(tx => qrRetention.markUnreferencedForTrash(tx, qr.id))).toBe('ACTIVE_REFERENCE')
      expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: qr.id } })).status).toBe('READY')
      const forbiddenTrash = await h.prisma.mediaAsset.update({ where: { id: qr.id }, data: { status: 'TRASHED', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86400000) } }).then(() => null, (error: unknown) => error)
      expect(readPersistenceErrorFacts(forbiddenTrash).codes.has('23514')).toBe(true)
      await createReviewMutations(h).payPayable(h.context(), payable.id, input, key)
      expect(await h.prisma.purchaseOrderPayment.count({ where: { payableId: payable.id } })).toBe(1)
      expect((await h.prisma.purchaseOrderPayment.findUniqueOrThrow({ where: { id: payment.id } })).recipientSnapshot).toEqual(payment.recipientSnapshot)
      const overwrite = await h.prisma.purchaseOrderPayment.update({ where: { id: payment.id }, data: { recipientSnapshot: { recipientName: '篡改' } } }).then(() => null, (error: unknown) => error)
      expect(readPersistenceErrorFacts(overwrite).codes.has('23514')).toBe(true)
    } finally { await h.dispose() }
  })
})
