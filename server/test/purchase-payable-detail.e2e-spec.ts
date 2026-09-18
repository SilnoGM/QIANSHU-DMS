import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { PurchasePayableOrderDto } from '../src/modules/purchase-orders/payables/purchase-payable.dto'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { createCommands, createReviewMutations, customInput, prepareImageReview } from './purchase-shipping-mark-atomicity.fixture'

/** 复用临时 schema + 正式 AppModule/登录守卫的现有夹具，不替代 HTTP 权限或查询服务。 */
describe('Purchase payable detail HTTP with isolated PostgreSQL', () => {
  jest.setTimeout(60_000)
  let h: PackagingCostHarness
  let finance: Awaited<ReturnType<PackagingCostHarness['browserWithPermissions']>>
  let forbidden: Awaited<ReturnType<PackagingCostHarness['browserWithPermissions']>>
  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    finance = await h.browserWithPermissions(['purchase-orders:payment'])
    forbidden = await h.browserWithPermissions([])
    // payment.method 由正式迁移提供；沿用已配置的 BANK_TRANSFER，不重复创建字典。
  })
  afterAll(async () => { await h?.dispose() })

  async function reviewed(zero = false) {
    const input = await customInput(h.fixture)
    const id = await createCommands(h.fixture).create(h.fixture.context(), zero ? {
      ...input, purchaseTotalAmount: '0', depositDueAmount: '0', balanceDueAmount: '0',
      lines: input.lines.map(line => ({ ...line, referencePurchaseUnitPriceAmount: '0', actualPurchaseUnitPriceAmount: '0' })),
    } : input)
    await createReviewMutations(h.fixture).review(h.fixture.context(), id, await prepareImageReview(h.fixture, id))
    const items = await h.prisma.purchaseOrderPayable.findMany({ where: { purchaseOrderId: id }, orderBy: { paymentType: 'asc' } })
    return { id, items }
  }
  const path = (id: string) => `/api/purchase-order-payables/${id}`
  const orderPath = (id: string) => `/api/purchase-order-payables/orders/${id}`
  function expectPrivate(response: request.Response) {
    expect(response.headers['cache-control']).toContain('private')
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toMatch(/^req_/u)
  }

  it.each(['payable', 'order'])('requires a logged-in user with payment permission before exposing any %s', async scope => {
    const group = await reviewed()
    const detailPath = scope === 'order' ? orderPath : path
    const id = scope === 'order' ? group.id : group.items[0].id
    const unauthenticated = await request(h.app.getHttpServer()).get(detailPath(id)).expect(401)
    expectPrivate(unauthenticated)
    const denied = await forbidden.browser.get(detailPath(id)).expect(403)
    expect(denied.body as { code: string }).toMatchObject({ code: 'FORBIDDEN' })
    expectPrivate(denied)
    await forbidden.browser.get(detailPath(randomUUID())).expect(403)
  })

  it.each(['payable', 'order'])('resolves the exact %s UUID to its complete order group without writing payment data', async scope => {
    const first = await reviewed()
    const second = await reviewed()
    const before = await h.prisma.purchaseOrderPayable.findMany({ orderBy: { id: 'asc' } })
    const counts = [await h.prisma.purchaseOrderPayment.count(), await h.prisma.fundPostingBatch.count(), await h.prisma.fundLedgerEntry.count()]
    const urls = scope === 'order' ? [orderPath(first.id)] : first.items.map(item => path(item.id))
    for (const url of urls) {
      const response = await finance.browser.get(url).expect(200)
      expectPrivate(response)
      const body = response.body as PurchasePayableOrderDto
      expect(body).toMatchObject({ id: first.id, accountOwnerType: 'COMPANY', owner: null, purchaseTotalAmount: '10.00', currencyCode: 'CNY' })
      expect(body.items.map(value => value.id).sort()).toEqual(first.items.map(value => value.id).sort())
      expect(body.items.map(value => value.paymentType)).toEqual(['DEPOSIT', 'BALANCE'])
      expect(body.id).not.toBe(second.id)
    }
    expect(await h.prisma.purchaseOrderPayable.findMany({ orderBy: { id: 'asc' } })).toEqual(before)
    expect([await h.prisma.purchaseOrderPayment.count(), await h.prisma.fundPostingBatch.count(), await h.prisma.fundLedgerEntry.count()]).toEqual(counts)
  })

  it.each(['payable', 'order'])('validates the %s UUID and rejects unknown or wrong-domain IDs', async scope => {
    const group = await reviewed()
    const detailPath = scope === 'order' ? orderPath : path
    const invalid = await finance.browser.get(detailPath('not-a-uuid')).expect(422)
    expect(invalid.body as { code: string }).toMatchObject({ code: 'VALIDATION_FAILED' })
    expectPrivate(invalid)
    const wrongDomainIds = scope === 'order' ? group.items.map(item => item.id) : [group.id]
    for (const id of [randomUUID(), ...wrongDomainIds]) {
      const missing = await finance.browser.get(detailPath(id)).expect(404)
      expect(missing.body as { code: string }).toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_FOUND' })
      expectPrivate(missing)
    }
  })

  it('keeps paid, cancelled and all-zero link targets readable after they leave the outstanding list', async () => {
    const paid = await reviewed()
    const cancelled = await reviewed()
    const zero = await reviewed(true)
    const balance = paid.items.find(item => item.paymentType === 'BALANCE')!
    const profile = (await finance.browser.get(path(balance.id)).expect(200)).body as PurchasePayableOrderDto
    const recipient = profile.paymentRecipientProfile!
    const voucherId = await h.upload(finance.browser, 'png', `${path(balance.id)}/voucher-uploads`)
    // 历史详情测试也通过正式支付上传并归档真实凭证，不能跳过现在的收款资料校验。
    await finance.browser.post(`${path(balance.id)}/pay`).set(packagingHeaders).set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: balance.version, paymentMethod: 'BANK_TRANSFER', recipientAccountId: recipient.accounts[0].id, recipientProfileVersion: recipient.version, voucher: { mediaAssetId: voucherId } }).expect(200)
    await createReviewMutations(h.fixture).updateOrderStatus(h.fixture.context(), cancelled.id, { toStatus: 'CANCELLED', reason: 'Detail link cancellation' })
    const pending = await finance.browser.get('/api/purchase-order-payables').expect(200)
    const pendingIds = (pending.body as { items: PurchasePayableOrderDto[] }).items.map(group => group.id)
    for (const group of [paid, cancelled, zero]) expect(pendingIds).not.toContain(group.id)
    for (const [group, expected] of [[paid, ['NO_PAYMENT', 'PAID']], [cancelled, ['CANCELLED', 'CANCELLED']], [zero, ['NO_PAYMENT', 'NO_PAYMENT']]] as const) {
      for (const url of [orderPath(group.id), ...group.items.map(item => path(item.id))]) {
        const detail = await finance.browser.get(url).expect(200)
        const body = detail.body as PurchasePayableOrderDto
        expect(body.id).toBe(group.id)
        expect(body.items.map(value => value.status)).toEqual(expected)
        expectPrivate(detail)
      }
    }
  })
})
