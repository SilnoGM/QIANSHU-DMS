import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import type { PurchasePayablePayDto } from '../src/modules/purchase-orders/payables/purchase-payable.dto'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Prisma } from '../src/generated/prisma/client'
import { readPersistenceErrorFacts } from '../src/infrastructure/database/persistence-error-facts'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { PurchasePayableQueryService } from '../src/modules/purchase-orders/payables/purchase-payable-query.service'
import { createAtomicityFixture, createCommands, createReviewMutations, customInput, prepareImageReview, prepareSalesSource, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

/** 全量正式迁移落在临时 schema；除权限查询与图片存储探测外，采购、资金、锁及约束均为正式实现。 */
describe('Purchase payables with isolated PostgreSQL', () => {
  jest.setTimeout(60_000)
  let h: AtomicityFixture
  let payerId: string
  let paymentMethod: string
  let queries: PurchasePayableQueryService
  beforeAll(async () => {
    h = await createAtomicityFixture()
    const user = await h.prisma.user.create({ data: { username: 'purchase-finance', usernameNormalized: 'purchase-finance', displayName: 'Purchase finance', passwordHash: 'isolated-test-only', passwordChangedAt: new Date() } })
    payerId = user.id
    paymentMethod = 'BANK_TRANSFER'
    await new FundAccountCommandService(h.prisma, h.audit).createUserAccount({ actorUserId: h.actor.id, requestId: randomUUID() }, { userId: h.actor.id, userShareRate: '30' })
    queries = new PurchasePayableQueryService(h.prisma, new DictionaryLookupService(h.prisma), createPaymentRecipientFixture(h.prisma))
  })
  afterAll(async () => { await h?.dispose() })
  const finance = () => ({ actorUserId: payerId, requestId: randomUUID() })
  async function draft(deposit = '3', balance = '7') {
    return createCommands(h).create(h.context(), { ...await customInput(h), depositDueAmount: deposit, balanceDueAmount: balance })
  }
  async function reviewed(deposit = '3', balance = '7') {
    const id = await draft(deposit, balance)
    await createReviewMutations(h).review(h.context(), id, await prepareImageReview(h, id))
    return queries.getOrder(id)
  }
  async function paymentInput(id: string, expectedVersion = 1): Promise<PurchasePayablePayDto> {
    const order = await queries.getByPayableId(id)
    const profile = order.paymentRecipientProfile!
    const image = await h.prisma.mediaAsset.create({ data: {
      mediaType: 'IMAGE', status: 'UPLOADING', uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER', purchasePayableUploadId: id,
      objectKey: `assets/${randomUUID()}.png`, originalFilename: 'payment.png', mimeType: 'image/png',
      sizeBytes: 1n, checksumSha256: '0'.repeat(64), width: 1, height: 1, createdByUserId: payerId,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
    } })
    return { expectedVersion, paymentMethod, recipientAccountId: profile.accounts[0].id, recipientProfileVersion: profile.version, voucher: { mediaAssetId: image.id } }
  }
  // 同一 key 的并发/未知结果重试必须复用原截图与收款版本，验证真实幂等语义。
  const submissions = new Map<string, Promise<PurchasePayablePayDto>>()
  async function pay(id: string, expectedVersion = 1, key = randomUUID()) {
    if (!submissions.has(key)) submissions.set(key, paymentInput(id, expectedVersion))
    return createReviewMutations(h).payPayable(finance(), id, await submissions.get(key)!, key)
  }
  async function expectDatabaseConstraint(action: Promise<unknown>) {
    const result = await action.then(() => null, (error: unknown) => error)
    // 证明由数据库业务约束拒绝，而不是拼错委托、外键或测试客户端异常造成假阳性。
    expect(readPersistenceErrorFacts(result).codes.has('23514')).toBe(true)
  }
  async function financialFacts(orderId: string) {
    return {
      order: await h.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } }),
      payables: await h.prisma.purchaseOrderPayable.findMany({ where: { purchaseOrderId: orderId }, orderBy: { id: 'asc' } }),
      payments: await h.prisma.purchaseOrderPayment.findMany({ where: { purchaseOrderId: orderId }, orderBy: { id: 'asc' } }),
      batches: await h.prisma.fundPostingBatch.findMany({ orderBy: { id: 'asc' } }),
      entries: await h.prisma.fundLedgerEntry.findMany({ orderBy: { id: 'asc' } }),
      accounts: await h.prisma.fundAccount.findMany({ orderBy: { id: 'asc' } }),
      audits: await h.prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    }
  }

  it('lists only outstanding order groups before pagination and restores a group after payment void', async () => {
    const keyword = `Pending purchase ${randomUUID()}`
    const groups = []
    for (const [deposit, balance] of [['3', '7'], ['0', '10'], ['3', '7'], ['0', '0']]) {
      const input = await customInput(h)
      const zero = deposit === '0' && balance === '0'
      const id = await createCommands(h).create(h.context(), {
        ...input, customSupplierName: keyword, depositDueAmount: deposit, balanceDueAmount: balance,
        ...(zero ? { purchaseTotalAmount: '0', lines: input.lines.map(line => ({ ...line, referencePurchaseUnitPriceAmount: '0', actualPurchaseUnitPriceAmount: '0' })) } : {}),
      })
      await createReviewMutations(h).review(h.context(), id, await prepareImageReview(h, id))
      groups.push(await queries.getOrder(id))
    }
    const [partial, zeroDeposit, cancelled] = groups
    const first = await queries.list({ keyword, page: 1, pageSize: 1 })
    const second = await queries.list({ keyword, page: 2, pageSize: 1 })
    expect(first.total).toBe(3)
    expect(second.total).toBe(3)
    expect(first.items).toHaveLength(1)
    expect(second.items).toHaveLength(1)
    expect(first.items[0].id).not.toBe(second.items[0].id)
    expect(first.items[0].items).toHaveLength(2)
    await pay(partial.items[0].id)
    await pay(zeroDeposit.items[1].id)
    await createReviewMutations(h).updateOrderStatus(h.context(), cancelled.id, { toStatus: 'CANCELLED', reason: 'Cancelled' })
    const pending = await queries.list({ keyword, page: 1, pageSize: 1 })
    expect(pending.total).toBe(1)
    expect(pending.items.map(order => order.id)).toEqual([partial.id])
    expect(pending.items[0].items.map(item => item.status)).toEqual(['PAID', 'PENDING_PAYMENT'])
    await pay(partial.items[1].id)
    expect(await queries.list({ keyword })).toMatchObject({ items: [], total: 0 })
    expect((await queries.getOrder(partial.id)).items.map(item => item.status)).toEqual(['PAID', 'PAID'])
    const balancePayment = await h.prisma.purchaseOrderPayment.findFirstOrThrow({ where: { purchaseOrderId: partial.id, paymentType: 'BALANCE' } })
    await createReviewMutations(h).voidPayment(finance(), partial.id, balancePayment.id, { reason: 'Reopen outstanding balance' })
    const reopened = await queries.list({ keyword })
    expect(reopened.total).toBe(1)
    expect(reopened.items[0].id).toBe(partial.id)
    expect(reopened.items[0].items[1].status).toBe('PENDING_PAYMENT')
  })

  it('atomically reviews once and generates deposit plus balance, preserving a zero stage without posting', async () => {
    const id = await draft('0', '10')
    const review = await prepareImageReview(h, id)
    const batchCount = await h.prisma.fundPostingBatch.count()
    const attempts = await Promise.allSettled([createReviewMutations(h).review(h.context(), id, review), createReviewMutations(h).review(h.context(), id, review)])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
    const group = await queries.getOrder(id)
    expect(group).toMatchObject({ accountOwnerType: 'COMPANY', owner: null, items: [
      { paymentType: 'DEPOSIT', dueAmount: '0.00', remainingAmount: '0.00', status: 'NO_PAYMENT', version: 1 },
      { paymentType: 'BALANCE', dueAmount: '10.00', remainingAmount: '10.00', status: 'PENDING_PAYMENT', version: 1 },
    ] })
    expect(await h.prisma.fundPostingBatch.count()).toBe(batchCount)
    await expect(pay(group.items[0].id)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PAYMENT_AMOUNT_INVALID' })
  })

  it('rolls review and archived image back if payable generation fails', async () => {
    const id = await draft()
    const review = await prepareImageReview(h, id)
    const before = await financialFacts(id)
    const imagesBefore = await h.prisma.purchaseOrderDocument.findMany({ where: { purchaseOrderId: id } })
    const mutations = createReviewMutations(h, tx => new Proxy(tx, { get(target, property, receiver) {
      if (property === 'purchaseOrderPayable') return { ...target.purchaseOrderPayable, createMany: async (args: Prisma.PurchaseOrderPayableCreateManyArgs) => {
        await target.purchaseOrderPayable.createMany(args)
        throw new Error('Injected failure after payable creation')
      } }
      return Reflect.get(target, property, receiver) as unknown
    } }))
    await expect(mutations.review(h.context(), id, review)).rejects.toThrow('Injected failure after payable creation')
    expect(await financialFacts(id)).toEqual(before)
    expect(await h.prisma.purchaseOrderDocument.findMany({ where: { purchaseOrderId: id } })).toEqual(imagesBefore)
    expect(await h.prisma.purchaseOrderImageDraft.findUniqueOrThrow({ where: { id: review.imageDraftId } })).toMatchObject({ archivedAt: null, invalidatedAt: null })
  })

  it('rejects review at commit if an implementation accidentally omits the two payable rows', async () => {
    const id = await draft()
    const input = await prepareImageReview(h, id)
    const before = await financialFacts(id)
    const mutations = createReviewMutations(h, tx => new Proxy(tx, { get(target, property, receiver) {
      if (property === 'purchaseOrderPayable') return { ...target.purchaseOrderPayable, createMany: () => Promise.resolve({ count: 2 }) }
      return Reflect.get(target, property, receiver) as unknown
    } }))
    await expectDatabaseConstraint(mutations.review(h.context(), id, input))
    expect(await financialFacts(id)).toEqual(before)
  })

  it('serializes identical and distinct concurrent requests and charges stock company only once without rewriting the rule', async () => {
    const order = await reviewed()
    const postingType = await h.prisma.fundPostingType.findUniqueOrThrow({ where: { code: 'PURCHASE_PAYMENT' }, include: { currentRuleVersion: { include: { legs: true } } } })
    const account = await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' } })
    const key = randomUUID()
    await expect(Promise.all([pay(order.items[0].id, 1, key), pay(order.items[0].id, 1, key)])).resolves.toEqual([order.id, order.id])
    await expect(pay(order.items[0].id, 1, key)).resolves.toBe(order.id)
    const attempts = await Promise.allSettled([pay(order.items[1].id), pay(order.items[1].id)])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'PURCHASE_PAYABLE_STATE_CHANGED' })
    expect(await h.prisma.purchaseOrderPayment.count({ where: { purchaseOrderId: order.id } })).toBe(2)
    const after = await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: account.id } })
    expect(after.balance.sub(account.balance).toFixed(2)).toBe('-10.00')
    expect(await h.prisma.fundAccount.count({ where: { userId: payerId } })).toBe(0)
    expect(await h.prisma.fundPostingType.findUniqueOrThrow({ where: { id: postingType.id }, include: { currentRuleVersion: { include: { legs: true } } } })).toEqual(postingType)
    const payments = await h.prisma.purchaseOrderPayment.findMany({ where: { purchaseOrderId: order.id } })
    for (const payment of payments) {
      const batch = await h.prisma.fundPostingBatch.findUniqueOrThrow({ where: { id: payment.fundPostingBatchId! }, include: { entries: true } })
      expect(batch).toMatchObject({ consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY', userId: null, actorUserId: payerId, ruleVersionId: postingType.currentRuleVersionId, businessId: payment.id })
      expect(batch.userShareRateSnapshot?.toFixed(2)).toBe('0.00')
      expect(batch.companyShareRateSnapshot?.toFixed(2)).toBe('100.00')
      expect(batch.entries).toHaveLength(1)
      expect(batch.entries[0]).toMatchObject({ accountTarget: 'COMPANY', amountStrategy: 'COMPANY_REMAINDER', direction: 'DEBIT' })
    }
  })

  it('charges the sales issuer at the configured rate while the finance operator has no account', async () => {
    const source = await prepareSalesSource(h)
    const account = await h.prisma.fundAccount.findFirstOrThrow({ where: { userId: h.actor.id } })
    const company = await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' } })
    const id = await createCommands(h).create(h.context(), source.input)
    await createReviewMutations(h).review(h.context(), id, await prepareImageReview(h, id))
    const group = await queries.getOrder(id)
    expect(group).toMatchObject({ owner: { id: h.actor.id }, accountOwnerType: 'USER' })
    await pay(group.items[1].id)
    const payment = await h.prisma.purchaseOrderPayment.findFirstOrThrow({ where: { purchaseOrderId: id } })
    const batch = await h.prisma.fundPostingBatch.findUniqueOrThrow({ where: { id: payment.fundPostingBatchId! }, include: { entries: true } })
    expect(batch).toMatchObject({ consumerCode: 'PURCHASE_PAYMENT.PAY', userId: h.actor.id, actorUserId: payerId })
    expect(batch.entries.map(entry => ({ target: entry.accountTarget, direction: entry.direction, amount: entry.amount.toFixed(2) }))).toEqual(expect.arrayContaining([
      { target: 'USER', direction: 'DEBIT', amount: '3.00' }, { target: 'COMPANY', direction: 'DEBIT', amount: '7.00' },
    ]))
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: account.id } })).balance.toFixed(2)).toBe('-3.00')
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: company.id } })).balance.sub(company.balance).toFixed(2)).toBe('-7.00')
    expect(await h.prisma.fundAccount.count({ where: { userId: payerId } })).toBe(0)
  })

  it('voids through the purchase endpoint, fully restores money and reopens the installment, then permits a fresh payment', async () => {
    const group = await reviewed()
    const company = await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' } })
    await pay(group.items[0].id)
    const payment = await h.prisma.purchaseOrderPayment.findFirstOrThrow({ where: { purchaseOrderId: group.id } })
    const funds = new FundPostingApplicationService(h.prisma, h.audit)
    await expect(funds.reversePostingBatch(finance(), { originalBatchId: payment.fundPostingBatchId!, amount: '3.00', reason: 'Bypass attempt', idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'FUND_REVERSAL_TARGET_INVALID' })
    await createReviewMutations(h).voidPayment(finance(), group.id, payment.id, { reason: 'Correction' })
    const after = await queries.getOrder(group.id)
    expect(after.items[0]).toMatchObject({ status: 'PENDING_PAYMENT', paidAmount: '0.00', remainingAmount: '3.00', version: 3, paidAt: null })
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: company.id } })).balance).toEqual(company.balance)
    const voided = await h.prisma.purchaseOrderPayment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(voided.fundReversalBatchId).not.toBeNull()
    const reversal = await h.prisma.fundPostingBatch.findUniqueOrThrow({ where: { id: voided.fundReversalBatchId! }, include: { entries: true } })
    expect(reversal).toMatchObject({ consumerCode: 'PURCHASE_PAYMENT.VOID', reversalOfBatchId: payment.fundPostingBatchId, userId: null })
    expect(reversal.businessAmount.toFixed(2)).toBe('-3.00')
    expect(reversal.entries[0].direction).toBe('CREDIT')
    await expect(createReviewMutations(h).voidPayment(finance(), group.id, payment.id, { reason: 'Again' })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PAYMENT_ALREADY_VOIDED' })
    await pay(group.items[0].id, 3)
    expect((await queries.getOrder(group.id)).items[0]).toMatchObject({ status: 'PAID', version: 4 })
  })

  it('closes both installments on cancellation and rejects any later payment', async () => {
    const group = await reviewed()
    await createReviewMutations(h).updateOrderStatus(h.context(), group.id, { toStatus: 'CANCELLED', reason: 'Cancelled' })
    expect((await queries.getOrder(group.id)).items.map(item => item.status)).toEqual(['CANCELLED', 'CANCELLED'])
    const before = await financialFacts(group.id)
    await expect(pay(group.items[0].id, 2)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_CANCELLED' })
    expect(await financialFacts(group.id)).toEqual(before)
  })

  it('rolls back on disabled fund rules and on a later purchase audit failure after funds were written', async () => {
    const group = await reviewed()
    await h.prisma.fundPostingType.update({ where: { code: 'PURCHASE_PAYMENT' }, data: { enabled: false } })
    const beforeDisabled = await financialFacts(group.id)
    await expect(pay(group.items[0].id)).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE' })
    expect(await financialFacts(group.id)).toEqual(beforeDisabled)
    await h.prisma.fundPostingType.update({ where: { code: 'PURCHASE_PAYMENT' }, data: { enabled: true } })
    const before = await financialFacts(group.id)
    let observedPosting = false
    const mutations = createReviewMutations(h, tx => new Proxy(tx, { get(target, property, receiver) {
      if (property === 'auditEvent') return { ...target.auditEvent, create: async (args: Prisma.AuditEventCreateArgs) => {
        if (args.data.eventType === 'PURCHASE_ORDER_PAYMENT_RECORDED') {
          observedPosting = await target.fundPostingBatch.count({ where: { businessSourceCodeSnapshot: 'PURCHASE_PAYMENT' } }) > before.batches.filter(batch => batch.businessSourceCodeSnapshot === 'PURCHASE_PAYMENT').length
          throw new Error('Injected audit failure after posting')
        }
        return target.auditEvent.create(args)
      } }
      return Reflect.get(target, property, receiver) as unknown
    } }))
    await expect(mutations.payPayable(finance(), group.items[0].id, await paymentInput(group.items[0].id), randomUUID())).rejects.toMatchObject({ code: 'AUDIT_WRITE_FAILED' })
    expect(observedPosting).toBe(true)
    expect(await financialFacts(group.id)).toEqual(before)
  })

  it('requires an owned payment screenshot and the current recipient before posting, and archives the exact image', async () => {
    const group = await reviewed(), id = group.items[0].id
    const input = await paymentInput(id)
    const before = await financialFacts(group.id)
    const mutations = createReviewMutations(h)
    await expect(mutations.payPayable(finance(), id, { ...input, voucher: null } as unknown as PurchasePayablePayDto, randomUUID())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE' })
    await expect(mutations.payPayable(finance(), id, { ...input, recipientProfileVersion: 99 }, randomUUID())).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_STATE_CHANGED' })
    await expect(mutations.payPayable(finance(), id, { ...input, recipientAccountId: randomUUID() }, randomUUID())).rejects.toMatchObject({ code: 'PAYMENT_RECIPIENT_UNAVAILABLE' })
    await expect(mutations.payPayable(finance(), group.items[1].id, input, randomUUID())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE' })
    expect(await financialFacts(group.id)).toEqual(before)
    const key = randomUUID()
    await mutations.payPayable(finance(), id, input, key)
    const paid = (await queries.getByPayableId(id)).items[0]
    expect(paid.paymentReceipt).toMatchObject({ recipient: group.paymentRecipientProfile!.accounts[0], voucher: { mediaAssetId: input.voucher.mediaAssetId } })
    const document = await h.prisma.purchaseOrderDocument.findUniqueOrThrow({ where: { id: paid.paymentReceipt!.voucher!.id } })
    expect(document).toMatchObject({ purchaseOrderId: group.id, documentType: 'PAYMENT_VOUCHER', detachedAt: null })
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: input.voucher.mediaAssetId } })).status).toBe('READY')
    await expect(mutations.payPayable(finance(), id, input, key)).resolves.toBe(group.id)
    await expect(mutations.payPayable(finance(), id, { ...input, voucher: { mediaAssetId: randomUUID() } }, key)).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT' })
    await expectDatabaseConstraint(h.prisma.purchaseOrderDocument.update({ where: { id: document.id }, data: { detachedAt: new Date(), detachedByUserId: payerId } }))
  })

  it('rolls back the complete payment if its screenshot is not archived at commit', async () => {
    const group = await reviewed(), input = await paymentInput(group.items[0].id)
    const before = await financialFacts(group.id)
    const mutations = createReviewMutations(h, tx => new Proxy(tx, { get(target, property, receiver) {
      if (property === 'purchaseOrderDocument') return { ...target.purchaseOrderDocument, create: () => Promise.resolve({ id: randomUUID() }) }
      return Reflect.get(target, property, receiver) as unknown
    } }))
    await expectDatabaseConstraint(mutations.payPayable(finance(), group.items[0].id, input, randomUUID()))
    expect(await financialFacts(group.id)).toEqual(before)
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: input.voucher.mediaAssetId } })).status).toBe('UPLOADING')
  })

  it('constrains the old payment endpoint to exactly the outstanding stage', async () => {
    const group = await reviewed()
    const { expectedVersion: _version, ...recipient } = await paymentInput(group.items[0].id)
    void _version
    const input = { ...recipient, paidAt: new Date().toISOString(), paymentType: 'DEPOSIT', amount: '2.00' }
    await expect(createReviewMutations(h).recordPayment(finance(), group.id, input)).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_AVAILABLE' })
    await expect(createReviewMutations(h).recordPayment(finance(), group.id, { ...input, paymentType: 'OTHER' })).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_NOT_AVAILABLE' })
    await createReviewMutations(h).recordPayment(finance(), group.id, { ...input, amount: '3.00' })
    expect((await queries.getOrder(group.id)).items[0]).toMatchObject({ status: 'PAID', paidAmount: '3.00' })
  })

  it('rejects forged payable identities, unlinked payment facts, and mutation of paid facts at the database boundary', async () => {
    const group = await reviewed()
    await expectDatabaseConstraint(h.prisma.purchaseOrderPayable.update({ where: { id: group.items[0].id }, data: { dueAmount: '1.00', version: { increment: 1 } } }))
    await expectDatabaseConstraint(h.prisma.purchaseOrderPayable.update({ where: { id: group.items[0].id }, data: { accountOwnerType: 'USER', ownerUserId: payerId, version: { increment: 1 } } }))
    await expectDatabaseConstraint(h.prisma.purchaseOrderPayable.delete({ where: { id: group.items[0].id } }))
    await expectDatabaseConstraint(h.prisma.purchaseOrderPayment.create({ data: { purchaseOrderId: group.id, paymentType: 'DEPOSIT', amount: '3.00', paymentMethod, paidAt: new Date(), createdByUserId: payerId } }))
    await pay(group.items[0].id)
    const payment = await h.prisma.purchaseOrderPayment.findFirstOrThrow({ where: { purchaseOrderId: group.id } })
    await expectDatabaseConstraint(h.prisma.purchaseOrderPayment.update({ where: { id: payment.id }, data: { amount: '1.00' } }))
    await expectDatabaseConstraint(h.prisma.purchaseOrderPayment.update({ where: { id: payment.id }, data: { voidedAt: new Date(), voidedByUserId: payerId, voidReason: 'Missing reversal' } }))
    await expectDatabaseConstraint(h.prisma.purchaseOrderPayment.delete({ where: { id: payment.id } }))
    expect((await queries.getOrder(group.id)).items[0]).toMatchObject({ status: 'PAID', paidAmount: '3.00' })
  })

  it('rejects an orphan controlled fund posting and leaves balances unchanged', async () => {
    const group = await reviewed()
    const before = await financialFacts(group.id)
    const funds = new FundPostingApplicationService(h.prisma, h.audit)
    const context = { ...finance(), sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY' }
    const input = { postingTypeCode: 'PURCHASE_PAYMENT', amount: '3.00', businessId: randomUUID(), summary: 'Orphan payment', idempotencyKey: randomUUID() }
    await expectDatabaseConstraint(h.prisma.$transaction(async tx => {
      const preview = await funds.previewBusinessEventInTransaction(tx, context, input)
      return funds.postBusinessEventInTransaction(tx, context, input, preview)
    }))
    expect(await financialFacts(group.id)).toEqual(before)
  })

  it.each(['amount', 'stage', 'actor'])('rejects forged payment-to-batch association: %s', async forged => {
    const group = await reviewed()
    const before = await financialFacts(group.id)
    const funds = new FundPostingApplicationService(h.prisma, h.audit)
    const recipientSnapshot = group.paymentRecipientProfile!.accounts[0]
    await expectDatabaseConstraint(h.prisma.$transaction(async tx => {
      const paymentId = randomUUID()
      const context = { ...finance(), sourceCode: 'PURCHASE_PAYMENT', consumerCode: 'PURCHASE_PAYMENT.STOCK_PAY' }
      const input = { postingTypeCode: 'PURCHASE_PAYMENT', amount: '3.00', businessId: paymentId, summary: 'Forged association', idempotencyKey: randomUUID() }
      const preview = await funds.previewBusinessEventInTransaction(tx, context, input)
      const batch = await funds.postBusinessEventInTransaction(tx, context, input, preview)
      await tx.purchaseOrderPayment.create({ data: {
        recipientSnapshot: recipientSnapshot as unknown as Prisma.InputJsonObject,
        id: paymentId, purchaseOrderId: group.id, payableId: group.items[0].id,
        fundPostingBatchId: batch.batchId, idempotencyKeyHash: randomBytes(32), requestFingerprintHash: randomBytes(32),
        paymentType: forged === 'stage' ? 'BALANCE' : 'DEPOSIT', amount: forged === 'amount' ? '2.00' : '3.00',
        createdByUserId: forged === 'actor' ? h.actor.id : payerId, paymentMethod, paidAt: new Date(),
      } })
      // 精确触发本次跨域约束，避免旧付款汇总约束先失败而掩盖伪造关联的漏洞。
      await tx.$executeRawUnsafe('SET CONSTRAINTS purchase_order_payments_payable_consistency_trigger IMMEDIATE')
    }))
    expect(await financialFacts(group.id)).toEqual(before)
  })

  it('keeps unrelated manual adjustments usable', async () => {
    const account = await h.prisma.fundAccount.findFirstOrThrow({ where: { userId: h.actor.id } })
    const result = await new FundPostingApplicationService(h.prisma, h.audit).postManualAdjustment(finance(), { userAccountId: account.id, amount: '1', adjustmentMode: 'USER_ONLY', reason: 'Unrelated adjustment regression', idempotencyKey: randomUUID() })
    expect(result).toMatchObject({ postingTypeCode: 'ADMIN_MANUAL_ADJUSTMENT', businessAmount: '1.00' })
  })
})
