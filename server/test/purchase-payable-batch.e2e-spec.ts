import { randomUUID } from 'node:crypto'
import type { Prisma } from '../src/generated/prisma/client'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { PurchasePayableQueryService } from '../src/modules/purchase-orders/payables/purchase-payable-query.service'
import type { PurchasePayableBatchPayDto, PurchasePayableOrderDto } from '../src/modules/purchase-orders/payables/purchase-payable.dto'
import { createPaymentRecipientFixture, paymentRecipientBankAccounts } from './fixtures/payment-recipient.fixture'
import { createAtomicityFixture, createCommands, createReviewMutations, customInput, prepareCatalog, prepareImageReview, prepareSalesSource, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

describe('atomic purchase payable batches with isolated PostgreSQL', () => {
  jest.setTimeout(90_000)
  let h: AtomicityFixture
  let catalog: Awaited<ReturnType<typeof prepareCatalog>>
  let queries: PurchasePayableQueryService
  let profile: { version: number, accounts: { id: string }[] }
  beforeAll(async () => {
    h = await createAtomicityFixture()
    catalog = await prepareCatalog(h)
    const supplierType = await h.prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'service_provider.supplier' } })
    await h.prisma.dictionaryItem.create({ data: { dictionaryTypeId: supplierType.id, value: 'BATCH_OTHER', label: 'Other supplier', enabled: true } })
    const recipients = createPaymentRecipientFixture(h.prisma, { access: h.access })
    profile = await recipients.save(h.configContext, catalog.supplierValue, { expectedVersion: 0, accounts: paymentRecipientBankAccounts() })
    queries = new PurchasePayableQueryService(h.prisma, new DictionaryLookupService(h.prisma), recipients)
    await new FundAccountCommandService(h.prisma, h.audit).createUserAccount(h.configContext, { userId: h.actor.id, userShareRate: '30' })
  })
  afterAll(async () => { await h?.dispose() })
  async function order(deposit = '3', balance = '7') {
    const id = await createCommands(h).create(h.context(), { ...catalog.input, depositDueAmount: deposit, balanceDueAmount: balance })
    await createReviewMutations(h).review(h.context(), id, await prepareImageReview(h, id))
    return queries.getOrder(id)
  }
  async function input(orders: PurchasePayableOrderDto[]): Promise<PurchasePayableBatchPayDto> {
    const items = []
    for (const group of orders) for (const payable of group.items.filter(item => item.status === 'PENDING_PAYMENT')) {
      const asset = await h.prisma.mediaAsset.create({ data: {
        mediaType: 'IMAGE', status: 'UPLOADING', uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER', purchasePayableUploadId: payable.id,
        objectKey: `assets/${randomUUID()}.png`, originalFilename: 'batch.png', mimeType: 'image/png', sizeBytes: 1n,
        checksumSha256: '0'.repeat(64), width: 1, height: 1, createdByUserId: h.actor.id, uploadExpiresAt: new Date(Date.now() + 3_600_000),
      } })
      items.push({ payableId: payable.id, expectedVersion: payable.version, voucher: { mediaAssetId: asset.id } })
    }
    return { supplierValue: catalog.supplierValue, recipientAccountId: profile.accounts[0].id, recipientProfileVersion: profile.version, paymentMethod: 'BANK_TRANSFER', items }
  }
  async function facts() {
    const orderBy = { id: 'asc' as const }
    return Promise.all([h.prisma.purchaseOrder.findMany({ orderBy }), h.prisma.purchaseOrderPayable.findMany({ orderBy }),
      h.prisma.purchaseOrderPayment.findMany({ orderBy }), h.prisma.purchaseOrderDocument.findMany({ orderBy }),
      h.prisma.fundAccount.findMany({ orderBy }), h.prisma.fundPostingBatch.findMany({ orderBy }), h.prisma.fundLedgerEntry.findMany({ orderBy }),
      h.prisma.auditEvent.findMany({ orderBy }), h.prisma.mediaAsset.findMany({ orderBy })])
  }
  it('queries complete outstanding groups using stable dictionary suppliers including historical disabled entries', async () => {
    const first = await order(), zeroDeposit = await order('0', '10')
    const customId = await createCommands(h).create(h.context(), await customInput(h))
    await createReviewMutations(h).review(h.context(), customId, await prepareImageReview(h, customId))
    await h.prisma.dictionaryItem.updateMany({ where: { dictionaryType: { code: 'service_provider.supplier' }, value: catalog.supplierValue }, data: { enabled: false } })
    try {
      expect((await queries.batchSuppliers()).items).toContainEqual({ value: catalog.supplierValue, label: 'Mark supplier' })
      const groups = (await queries.batchOrders(catalog.supplierValue)).items
      expect(groups.map(item => item.id)).toEqual(expect.arrayContaining([first.id, zeroDeposit.id]))
      expect(groups.map(item => item.id)).not.toContain(customId)
      expect(groups.every(item => item.items.length === 2)).toBe(true)
    } finally {
      await h.prisma.dictionaryItem.updateMany({ where: { dictionaryType: { code: 'service_provider.supplier' }, value: catalog.supplierValue }, data: { enabled: true } })
    }
  })
  it('pays every selected outstanding installment atomically, archives each voucher, and replays only the identical complete batch', async () => {
    const groups = [await order(), await order('0', '10')], body = await input(groups), key = randomUUID()
    const before = await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' } })
    const mutations = createReviewMutations(h)
    const result = await mutations.payBatch(h.context(), body, key)
    expect(result).toEqual({ orderIds: groups.map(group => group.id).sort(), paymentCount: 3 })
    expect(await mutations.payBatch(h.context(), { ...body, items: [...body.items].reverse() }, key)).toEqual(result)
    expect(await h.prisma.purchaseOrderPayment.count({ where: { purchaseOrderId: { in: result.orderIds } } })).toBe(3)
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: before.id } })).balance.sub(before.balance).toFixed(2)).toBe('-20.00')
    const documents = await h.prisma.purchaseOrderDocument.findMany({ where: { purchaseOrderId: { in: result.orderIds }, documentType: 'PAYMENT_VOUCHER' }, include: { mediaAsset: true, payment: true } })
    expect(documents).toHaveLength(3)
    expect(documents.every(document => document.mediaAsset.status === 'READY' && document.mediaAsset.purchasePayableUploadId === document.payment?.payableId)).toBe(true)
    expect((await queries.batchOrders(catalog.supplierValue)).items.some(group => result.orderIds.includes(group.id))).toBe(false)
    await expect(mutations.payBatch(h.context(), { ...body, items: body.items.slice(1) }, key)).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT' })
    const extra = await input([await order()])
    await expect(mutations.payBatch(h.context(), { ...body, items: [...body.items, ...extra.items] }, key)).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT' })
    const beforeReplay = await facts()
    await h.prisma.user.update({ where: { id: h.actor.id }, data: { status: 'DISABLED', disabledAt: new Date(), disabledByUserId: h.actor.id } })
    try {
      await expect(mutations.payBatch(h.context(), body, key)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await facts()).toEqual(beforeReplay)
    } finally { await h.prisma.user.update({ where: { id: h.actor.id }, data: { status: 'ACTIVE', disabledAt: null, disabledByUserId: null } }) }
  })
  it('pays mixed sales and stock ownership while excluding an already paid deposit from the batch total', async () => {
    const { source } = await prepareSalesSource(h)
    // 隔离 fixture 在采购引用前补齐真实目录产品销售行，沿用正式采购创建、审核与动账服务。
    await h.prisma.salesOrderLine.update({ where: { id: source.lines[0].id }, data: { lineType: 'CATALOG', productId: catalog.input.lines[0].productId, productNoSnapshot: 'ATOMIC_PRODUCT', standardUnitPriceAmount: '10' } })
    const salesId = await createCommands(h).create(h.context(), { ...catalog.input, purchaseType: 'SALES_LINKED', salesOrderId: source.id,
      lines: catalog.input.lines.map(line => ({ ...line, sourceSalesOrderLineId: source.lines[0].id })), depositDueAmount: '3', balanceDueAmount: '7' })
    await createReviewMutations(h).review(h.context(), salesId, await prepareImageReview(h, salesId))
    const stock = await order(), initial = await input([stock]), deposit = initial.items.find(item => item.payableId === stock.items[0].id)!
    await createReviewMutations(h).payPayable(h.context(), deposit.payableId, {
      expectedVersion: deposit.expectedVersion, voucher: deposit.voucher, paymentMethod: initial.paymentMethod,
      recipientAccountId: initial.recipientAccountId, recipientProfileVersion: initial.recipientProfileVersion,
    }, randomUUID())
    const body = await input([await queries.getOrder(salesId), await queries.getOrder(stock.id)])
    const user = await h.prisma.fundAccount.findFirstOrThrow({ where: { userId: h.actor.id } })
    const company = await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' } })
    expect((await createReviewMutations(h).payBatch(h.context(), body, randomUUID())).paymentCount).toBe(3)
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: user.id } })).balance.sub(user.balance).toFixed(2)).toBe('-3.00')
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: company.id } })).balance.sub(company.balance).toFixed(2)).toBe('-14.00')
    const payments = await h.prisma.purchaseOrderPayment.findMany({ where: { purchaseOrderId: salesId }, include: { fundPostingBatch: true } })
    expect(payments).toHaveLength(2)
    expect(payments.every(payment => payment.fundPostingBatch?.consumerCode === 'PURCHASE_PAYMENT.PAY' && payment.fundPostingBatch.userId === h.actor.id)).toBe(true)
  })
  it('rejects omitted installments, different suppliers, custom orders, stale versions and mismatched vouchers before any committed mutation', async () => {
    const group = await order(), body = await input([group])
    const customId = await createCommands(h).create(h.context(), await customInput(h))
    await createReviewMutations(h).review(h.context(), customId, await prepareImageReview(h, customId))
    const custom = await input([await queries.getOrder(customId)])
    const before = await facts()
    for (const [invalid, code] of [
      [{ ...body, items: body.items.slice(0, 1) }, 'PURCHASE_PAYABLE_STATE_CHANGED'],
      [{ ...body, supplierValue: 'DIFFERENT' }, 'PURCHASE_PAYABLE_NOT_AVAILABLE'], [custom, 'PURCHASE_PAYABLE_NOT_AVAILABLE'],
      [{ ...body, recipientProfileVersion: profile.version + 1 }, 'PAYMENT_RECIPIENT_STATE_CHANGED'],
      [{ ...body, items: body.items.map((item, index) => index ? item : { ...item, expectedVersion: 99 }) }, 'PURCHASE_PAYABLE_STATE_CHANGED'],
      [{ ...body, items: body.items.map((item, index) => ({ ...item, voucher: body.items[1 - index].voucher })) }, 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE'],
    ] as const) {
      await expect(createReviewMutations(h).payBatch(h.context(), invalid, randomUUID())).rejects.toMatchObject({ code })
      expect(await facts()).toEqual(before)
    }
  })
  it('rolls earlier fund postings, receipts, media activation and statuses back when the last payment fails', async () => {
    const body = await input([await order(), await order()]), before = await facts()
    let count = 0
    const mutations = createReviewMutations(h, tx => new Proxy(tx, { get(target, property, receiver) {
      if (property === 'purchaseOrderPayment') return { ...target.purchaseOrderPayment, create: async (args: Prisma.PurchaseOrderPaymentCreateArgs) => {
        const result = await target.purchaseOrderPayment.create(args)
        if (++count === body.items.length) throw new Error('Injected final batch payment failure')
        return result
      } }
      return Reflect.get(target, property, receiver) as unknown
    } }))
    await expect(mutations.payBatch(h.context(), body, randomUUID())).rejects.toThrow('Injected final batch payment failure')
    expect(count).toBe(body.items.length)
    expect(await facts()).toEqual(before)
  })
  it('serializes matching retries and competing batches without duplicate payment', async () => {
    const body = await input([await order(), await order()]), key = randomUUID()
    const results = await Promise.all([createReviewMutations(h).payBatch(h.context(), body, key), createReviewMutations(h).payBatch(h.context(), body, key)])
    expect(results[0]).toEqual(results[1])
    const contested = await order(), first = await input([contested]), second = await input([contested])
    const attempts = await Promise.allSettled([createReviewMutations(h).payBatch(h.context(), first, randomUUID()), createReviewMutations(h).payBatch(h.context(), second, randomUUID())])
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(await h.prisma.purchaseOrderPayment.count({ where: { purchaseOrderId: contested.id } })).toBe(2)
  })
})
