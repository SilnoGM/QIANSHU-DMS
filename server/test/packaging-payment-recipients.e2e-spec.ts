import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { PackagingCostRequestDto, PackagingCostRequestPayDto } from '../src/modules/packaging-costs/packaging-cost.dto'
import type { PackagingPaymentProfileDto } from '../src/modules/payment-recipients/payment-recipient.dto'
import { MediaAssetReferenceRepository } from '../src/modules/media/media-reference.repository'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'

describe('packaging recipients, targeted payment voucher and immutable history', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  beforeAll(async () => { h = await createPackagingCostHarness({ nativeImageProbe: true }); await h.setupFunds(); await h.ensureProfile() })
  afterAll(async () => { await h?.dispose() })
  async function submit(browser: ReturnType<typeof request.agent>, input: object) {
    return (await browser.post('/api/packaging-cost-requests').set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(input).expect(201)).body as PackagingCostRequestDto
  }
  async function payment(browser: ReturnType<typeof request.agent>, row: PackagingCostRequestDto): Promise<PackagingCostRequestPayDto> {
    const profile = row.paymentRecipientProfile!
    const account = profile.accounts[0]
    const voucher = await h.upload(browser, 'png', `/api/packaging-cost-requests/${row.id}/voucher-uploads`)
    return { expectedVersion: row.version, recipientAccountId: account.id, recipientProfileVersion: profile.version, paymentMethod: account.paymentMethod as 'ALIPAY' | 'WECHAT', voucher: { mediaAssetId: voucher }, remark: '已核对收款人' }
  }
  function pay(browser: ReturnType<typeof request.agent>, row: PackagingCostRequestDto, input: object) {
    return browser.post(`/api/packaging-cost-requests/${row.id}/pay`).set(packagingHeaders).send(input)
  }
  it('separates packaging read/create access from administrator configuration writes', async () => {
    const creator = await h.browserWithPermissions(['packaging-costs:create'])
    const reader = await h.browserWithPermissions(['packaging-costs:read'])
    const procurement = await h.browserWithPermissions(['purchase-orders:payment'])
    const profile = (await creator.browser.get('/api/packaging-payment-profiles/CHENGXIN').expect(200)).body as PackagingPaymentProfileDto
    await reader.browser.get('/api/packaging-payment-profiles/CHENGXIN').expect(200)
    await procurement.browser.get('/api/packaging-payment-profiles/CHENGXIN').expect(403)
    await creator.browser.put('/api/packaging-payment-profiles/CHENGXIN').set(packagingHeaders).send({ expectedVersion: profile.version, accounts: [] }).expect(403)
    await creator.browser.get(profile.accounts[0].qrContentUrl!).expect(200)
    await procurement.browser.get(profile.accounts[0].qrContentUrl!).expect(404)
    await request(h.app.getHttpServer()).get('/api/packaging-payment-profiles/CHENGXIN').expect(401)
  })
  it('requires one of the three originating permissions to upload a QR', async () => {
    const none = await h.browserWithPermissions([])
    await none.browser.post('/api/payment-recipient-images').set(packagingHeaders)
      .field('mediaType', 'IMAGE')
      .attach('file', Buffer.from('not-an-image'), { filename: 'qr.png', contentType: 'image/png' })
      .expect(403)
  })
  it('requires one owned QR for OTHER and freezes it on the request', async () => {
    const actor = await h.browserWithPermissions()
    const stranger = await h.browserWithPermissions(['packaging-costs:create'])
    const shipment = await h.shipment()
    const input = { ...await h.input(actor.browser, shipment.part.id), packagingVendor: 'OTHER' }
    for (const paymentRecipients of [undefined, [], [{ paymentMethod: 'BANK_TRANSFER', recipientName: '收款人', bankName: '银行', bankAccount: '123' }]]) {
      await actor.browser.post('/api/packaging-cost-requests').set(packagingHeaders).set('Idempotency-Key', randomUUID()).send({ ...input, paymentRecipients }).expect(422)
    }
    const foreignQr = await h.upload(stranger.browser, 'png', '/api/payment-recipient-images')
    await actor.browser.post('/api/packaging-cost-requests').set(packagingHeaders).set('Idempotency-Key', randomUUID()).send({ ...input, paymentRecipients: [{ paymentMethod: 'WECHAT', recipientName: '收款人', qrMediaAssetId: foreignQr }] }).expect(422)
    const qr = await h.upload(actor.browser, 'png', '/api/payment-recipient-images')
    const row = await submit(actor.browser, { ...input, paymentRecipients: [{ paymentMethod: 'WECHAT', recipientName: '其他收款人', qrMediaAssetId: qr }] })
    expect(row.paymentRecipientProfile?.accounts).toMatchObject([{ paymentMethod: 'WECHAT', recipientName: '其他收款人', qrMediaAssetId: qr }])
    await expect(h.prisma.paymentRecipientAccount.update({ where: { id: row.paymentRecipientProfile!.accounts[0].id }, data: { recipientName: '篡改' } })).rejects.toThrow()
    await expect(h.prisma.paymentRecipientAccount.create({ data: { profileId: row.paymentRecipientProfile!.id, paymentMethod: 'ALIPAY', recipientName: '新增账户', qrMediaAssetId: qr } })).rejects.toThrow()
    const receipt = await payment(actor.browser, row)
    const paid = (await pay(actor.browser, row, receipt).expect(200)).body as PackagingCostRequestDto
    expect(paid.paymentReceipt).toMatchObject({ recipient: { recipientName: '其他收款人', paymentMethod: 'WECHAT' }, voucher: { mediaAssetId: receipt.voucher.mediaAssetId }, remark: '已核对收款人' })
    await actor.browser.get(`/api/packaging-cost-requests/${row.id}/images/PAYMENT`).expect(200)
    await stranger.browser.get(`/api/packaging-cost-requests/${row.id}/images/PAYMENT`).expect(403)
    await pay(actor.browser, row, receipt).expect(200)
    await pay(actor.browser, row, { ...receipt, remark: '不同内容' }).expect(409)
    for (const id of [qr, receipt.voucher.mediaAssetId]) {
      expect(await new MediaAssetReferenceRepository().hasActiveReferences(h.prisma, id)).toBe(true)
      await expect(h.prisma.mediaAsset.update({ where: { id }, data: { status: 'TRASHED', retentionUntil: new Date(Date.now() + 86400000) } })).rejects.toThrow()
    }
  })
  it('refuses missing, ordinary, foreign-target and foreign-owner vouchers before posting', async () => {
    const actor = await h.browserWithPermissions(), other = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const row = await submit(actor.browser, await h.input(actor.browser, shipment.part.id))
    const second = await submit(actor.browser, await h.input(actor.browser, shipment.part.id))
    const input = await payment(actor.browser, row)
    const initial = await h.prisma.fundPostingBatch.count()
    await pay(actor.browser, row, { ...input, voucher: undefined }).expect(422)
    const unrelated = await h.upload(actor.browser)
    const wrongTarget = await h.upload(actor.browser, 'png', `/api/packaging-cost-requests/${second.id}/voucher-uploads`)
    const wrongOwner = await h.upload(other.browser, 'png', `/api/packaging-cost-requests/${row.id}/voucher-uploads`)
    for (const mediaAssetId of [unrelated, wrongTarget, wrongOwner]) await pay(actor.browser, row, { ...input, voucher: { mediaAssetId } }).expect(422)
    expect(await h.prisma.fundPostingBatch.count()).toBe(initial)
    expect((await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING_PAYMENT')
  })
  it('rejects changed CHENGXIN profile versions and retains the actually paid QR after replacement', async () => {
    const actor = await h.browserWithPermissions()
    const admin = await h.browserWithPermissions(['supplier-payment-profiles:read', 'supplier-payment-profiles:update'])
    const shipment = await h.shipment()
    const row = await submit(actor.browser, await h.input(actor.browser, shipment.part.id))
    const input = await payment(actor.browser, row)
    const originalQr = row.paymentRecipientProfile!.accounts[0].qrMediaAssetId!
    const qr = await h.upload(admin.browser, 'png', '/api/payment-recipient-images')
    const profile = (await admin.browser.put('/api/packaging-payment-profiles/CHENGXIN').set(packagingHeaders).send({ expectedVersion: row.paymentRecipientProfile!.version, accounts: [{ paymentMethod: 'ALIPAY', recipientName: '新收款人', qrMediaAssetId: qr }] }).expect(200)).body as PackagingPaymentProfileDto
    expect((await pay(actor.browser, row, input).expect(409)).body as unknown).toMatchObject({ code: 'PAYMENT_RECIPIENT_STATE_CHANGED' })
    const paid = (await pay(actor.browser, row, { ...input, recipientProfileVersion: profile.version }).expect(200)).body as PackagingCostRequestDto
    expect(paid.paymentReceipt?.recipient).toMatchObject({ recipientName: '新收款人', qrMediaAssetId: qr })
    const replacement = await h.upload(admin.browser, 'png', '/api/payment-recipient-images')
    await admin.browser.put('/api/packaging-payment-profiles/CHENGXIN').set(packagingHeaders).send({ expectedVersion: profile.version, accounts: [{ paymentMethod: 'ALIPAY', recipientName: '再次更新', qrMediaAssetId: replacement }] }).expect(200)
    const detail = (await actor.browser.get(`/api/packaging-cost-requests/${row.id}`).expect(200)).body as PackagingCostRequestDto
    expect(detail.paymentReceipt?.recipient).toMatchObject({ recipientName: '新收款人', qrMediaAssetId: qr })
    await actor.browser.get(detail.paymentReceipt!.recipient!.qrContentUrl!).expect(200)
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: qr } })).status).toBe('READY')
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: originalQr } })).status).toBe('TRASHED')
  })
})
