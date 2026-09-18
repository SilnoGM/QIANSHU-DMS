import { randomUUID } from 'node:crypto'

import request from 'supertest'
import sharp from 'sharp'

import type { PackagingCostRequestDto, PackagingCostRequestPageDto, PackagingCostShipmentContextDto } from '../src/modules/packaging-costs/packaging-cost.dto'
import { AuditService } from '../src/modules/audit/audit.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { MediaAssetReferenceRepository } from '../src/modules/media/media-reference.repository'
import { MediaAssetRetentionService } from '../src/modules/media/media-retention.service'
import { createPackagingCostHarness, packagingHeaders, packagingPermissions, type PackagingCostHarness } from './packaging-cost.fixture'

describe('packaging cost submission and payment over isolated PostgreSQL and real image storage', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    for (const code of packagingPermissions) {
      const permission = await h.prisma.permission.findUniqueOrThrow({ where: { code }, include: { roles: { include: { role: true } } } })
      expect(permission.roles.map(grant => grant.role.code)).toEqual(['system_admin'])
    }
    await h.setupFunds()
  })
  afterAll(async () => { await h?.dispose() })

  function submit(browser: ReturnType<typeof request.agent>, input: object, key = randomUUID()) {
    return browser.post('/api/packaging-cost-requests').set(packagingHeaders).set('Idempotency-Key', key).send(input)
  }
  const payments = new WeakMap<ReturnType<typeof request.agent>, Map<string, object>>()
  function pay(browser: ReturnType<typeof request.agent>, id: string, expectedVersion = 1) {
    async function execute() {
      let cache = payments.get(browser)
      if (!cache) { cache = new Map(); payments.set(browser, cache) }
      let payment = cache.get(id)
      if (!payment) {
        const response = await browser.get(`/api/packaging-cost-requests/${id}`)
        const row = response.body as PackagingCostRequestDto
        const account = row.paymentRecipientProfile?.accounts[0]
        const buffer = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#112233' } }).png().toBuffer()
        const upload = await browser.post(`/api/packaging-cost-requests/${id}/voucher-uploads`).set(packagingHeaders).field('mediaType', 'IMAGE').attach('file', buffer, { filename: 'payment.png', contentType: 'image/png' })
        payment = { recipientAccountId: account?.id ?? randomUUID(), recipientProfileVersion: row.paymentRecipientProfile?.version ?? 1, paymentMethod: 'ALIPAY', voucher: { mediaAssetId: (upload.body as { mediaAssetId?: string }).mediaAssetId ?? randomUUID() } }
        cache.set(id, payment)
      }
      return browser.post(`/api/packaging-cost-requests/${id}/pay`).set(packagingHeaders).send({ ...payment, expectedVersion })
    }
    return {
      async expect(status: number) { const response = await execute(); expect({ status: response.status, code: (response.body as { code?: string }).code }).toEqual({ status, code: (response.body as { code?: string }).code }); return response },
      then: (resolve: (value: request.Response) => unknown, reject: (reason: unknown) => unknown) => execute().then(resolve, reject),
    }
  }
  async function imagesAreStaged(ids: string[]) {
    expect(await h.prisma.mediaAsset.count({ where: { id: { in: ids }, status: 'UPLOADING' } })).toBe(ids.length)
  }
  async function fundFacts(id: string, harness = h) {
    return {
      request: await harness.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id }, select: { status: true, version: true, paidAt: true, paidByUserId: true } }),
      accounts: await harness.prisma.fundAccount.findMany({ select: { id: true, balance: true, nextSequence: true, version: true }, orderBy: { id: 'asc' } }),
      batches: await harness.prisma.fundPostingBatch.findMany({ where: { businessId: id }, include: { entries: true } }),
      audits: await harness.prisma.auditEvent.findMany({ where: { eventType: { in: ['FUND_BUSINESS_POSTED', 'PACKAGING_COST_PAID'] } }, orderBy: { id: 'asc' } }),
    }
  }

  it('persists the received shipment, sales issuer and two private images, then confirms the immutable CNY payment', async () => {
    const ownerAccount = await h.prisma.fundAccount.findUniqueOrThrow({ where: { userId: h.fixture.actor.id } })
    const creator = await h.browserWithPermissions(['packaging-costs:create'])
    const finance = await h.browserWithPermissions(['packaging-costs:read', 'packaging-costs:pay'])
    const shipment = await h.shipment()
    const input = await h.input(creator.browser, shipment.part.id)
    const initialPostings = await h.prisma.fundPostingBatch.count()
    const submitted = (await submit(creator.browser, input).expect(201)).body as PackagingCostRequestDto
    expect(submitted).toMatchObject({
      shipmentId: shipment.part.id, shipmentNo: shipment.part.shipmentNo,
      shippingMarkText: shipment.part.shippingMarkText, purchaseOrderNo: shipment.order.orderNo,
      salesOrderNo: shipment.source!.orderNo, owner: { id: h.fixture.actor.id },
      submittedBy: { id: creator.user.id }, status: 'PENDING_PAYMENT', amount: '280.5000', currencyCode: 'CNY',
      packagingTypeName: '木箱', packagingVendor: 'CHENGXIN', paidAt: null, paidBy: null, version: 1,
      packagingImage: { mediaAssetId: input.packagingImageMediaAssetId }, quotationImage: { mediaAssetId: input.quotationImageMediaAssetId },
    })
    expect(submitted.owner.id).not.toBe(creator.user.id)
    expect(JSON.stringify(submitted)).not.toContain('objectKey')
    const pending = await finance.browser.get('/api/packaging-cost-requests').query({ status: 'PENDING_PAYMENT', keyword: shipment.part.shipmentNo }).expect(200)
    expect(pending.body as PackagingCostRequestPageDto).toMatchObject({ total: 1, items: [{ id: submitted.id }], statusCounts: { PENDING_PAYMENT: 1, PAID: 0 } })
    expect(pending.headers['cache-control']).toBe('private, no-store')
    expect(pending.headers['x-request-id']).toBeTruthy()
    expect(await h.prisma.fundPostingBatch.count()).toBe(initialPostings)
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: ownerAccount.id } })).balance.toFixed(2)).toBe('0.00')
    for (const [kind, mime] of [['PACKAGING', 'image/png'], ['QUOTATION', 'image/webp']]) {
      const url = `/api/packaging-cost-requests/${submitted.id}/images/${kind}`
      const image = await finance.browser.get(url).expect(200)
      expect(image.headers['content-type']).toContain(mime)
      expect(image.headers['cache-control']).toContain('private')
      expect(Buffer.isBuffer(image.body)).toBe(true)
      await finance.browser.head(url).expect(200)
      await creator.browser.get(url).expect(403)
      await request(h.app.getHttpServer()).get(url).expect(401)
    }
    const paid = (await pay(finance.browser, submitted.id).expect(200)).body as PackagingCostRequestDto
    expect(paid).toMatchObject({ id: submitted.id, status: 'PAID', amount: submitted.amount, version: 2, paidBy: { id: finance.user.id } })
    expect(paid.paidAt).toEqual(expect.any(String))
    const after = await finance.browser.get('/api/packaging-cost-requests').query({ status: 'PAID', keyword: shipment.source!.orderNo }).expect(200)
    expect(after.body as PackagingCostRequestPageDto).toMatchObject({ total: 1, items: [{ id: submitted.id }], statusCounts: { PENDING_PAYMENT: 0, PAID: 1 } })
    expect(await h.prisma.fundPostingBatch.count()).toBe(initialPostings + 1)
    const batch = await h.prisma.fundPostingBatch.findFirstOrThrow({ where: { businessId: submitted.id }, include: { entries: { orderBy: { lineNo: 'asc' } } } })
    expect(batch).toMatchObject({ businessSourceCodeSnapshot: 'PACKAGING_COST', consumerCode: 'PACKAGING_COST.PAY', postingTypeCodeSnapshot: 'WOODEN_PACKING_COST', userId: submitted.owner.id })
    expect(batch.businessAmount.toFixed(2)).toBe('280.50')
    expect(batch.userShareRateSnapshot?.toFixed(2)).toBe('30.00')
    expect(batch.entries.map(entry => ({ accountTarget: entry.accountTarget, direction: entry.direction, amount: entry.amount.toFixed(2) }))).toEqual([
      { accountTarget: 'USER', direction: 'DEBIT', amount: '84.15' }, { accountTarget: 'COMPANY', direction: 'DEBIT', amount: '196.35' },
    ])
    expect(batch.entries[0].accountId).toBe(ownerAccount.id)
    expect((await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: ownerAccount.id } })).balance.toFixed(2)).toBe('-84.15')
    expect((await h.prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' } })).balance.toFixed(2)).toBe('-196.35')
    expect(await h.prisma.fundAccount.count({ where: { userId: { in: [creator.user.id, finance.user.id] } } })).toBe(0)
    const audit = await h.prisma.auditEvent.findFirstOrThrow({ where: { targetId: submitted.id, eventType: 'PACKAGING_COST_PAID' } })
    expect(audit.metadata).toMatchObject({ fundPostingBatchId: batch.id })
  })

  it('corrects pending amounts for submitters, preserving submission identity and charging only the corrected amount', async () => {
    const creator = await h.browserWithPermissions(['packaging-costs:create'])
    const finance = await h.browserWithPermissions(['packaging-costs:read', 'packaging-costs:pay'])
    const shipment = await h.shipment()
    const input = await h.input(creator.browser, shipment.part.id)
    const key = randomUUID()
    const created = (await submit(creator.browser, input, key).expect(201)).body as PackagingCostRequestDto
    const url = `/api/packaging-cost-requests/${created.id}/amount`
    const before = await fundFacts(created.id)
    await request(h.app.getHttpServer()).patch(url).set(packagingHeaders).send({ amount: '310.25', expectedVersion: 1 }).expect(401)
    await finance.browser.patch(url).set(packagingHeaders).send({ amount: '310.25', expectedVersion: 1 }).expect(403)
    await creator.browser.patch(url).send({ amount: '310.25', expectedVersion: 1 }).expect(403)
    for (const change of [{ amount: '0' }, { amount: '1.234' }, { expectedVersion: 0 }, { status: 'PAID' }]) {
      await creator.browser.patch(url).set(packagingHeaders).send({ amount: '310.25', expectedVersion: 1, ...change }).expect(422)
    }
    await creator.browser.patch(`/api/packaging-cost-requests/${randomUUID()}/amount`).set(packagingHeaders).send({ amount: '310.25', expectedVersion: 1 }).expect(404)
    const updated = await creator.browser.patch(url).set(packagingHeaders).send({ amount: '310.25', expectedVersion: 1 }).expect(200)
    expect(updated.body as unknown).toMatchObject({ id: created.id, amount: '310.2500', version: 2, status: 'PENDING_PAYMENT' })
    expect(updated.body as unknown).not.toHaveProperty('paymentRecipientProfile')
    expect(updated.headers['cache-control']).toBe('private, no-store')
    const after = await fundFacts(created.id)
    expect({ ...after, request: before.request }).toEqual(before)
    const audit = await h.prisma.auditEvent.findFirstOrThrow({ where: { targetId: created.id, eventType: 'PACKAGING_COST_AMOUNT_UPDATED' } })
    expect(audit.metadata).toMatchObject({ previousAmount: '280.5000', amount: '310.2500', previousVersion: 1, version: 2 })
    expect((await submit(creator.browser, input, key).expect(201)).body as unknown).toMatchObject({ id: created.id, amount: '310.2500', version: 2 })
    await submit(creator.browser, { ...input, amount: '310.25' }, key).expect(409)
    await creator.browser.patch(url).set(packagingHeaders).send({ amount: '100', expectedVersion: 1 }).expect(409)
    await creator.browser.patch(url).set(packagingHeaders).send({ amount: '310.25', expectedVersion: 2 }).expect(200)
    expect(await h.prisma.auditEvent.count({ where: { targetId: created.id, eventType: 'PACKAGING_COST_AMOUNT_UPDATED' } })).toBe(1)
    const context = (await creator.browser.get(`/api/packaging-cost-requests/shipment-context/${shipment.part.id}`).expect(200)).body as PackagingCostShipmentContextDto
    expect(context.existingRequests).toMatchObject([{ id: created.id, amount: '310.2500', version: 2 }])
    await pay(finance.browser, created.id, 1).expect(409)
    await pay(finance.browser, created.id, 2).expect(200)
    expect((await h.prisma.fundPostingBatch.findFirstOrThrow({ where: { businessId: created.id } })).businessAmount.toFixed(2)).toBe('310.25')
    await creator.browser.patch(url).set(packagingHeaders).send({ amount: '100', expectedVersion: 3 }).expect(409)
    await expect(h.prisma.packagingCostRequest.update({ where: { id: created.id }, data: { amount: '100', version: { increment: 1 } } })).rejects.toThrow()
  })

  it('allows only amount/version changes while pending at the database boundary', async () => {
    const actor = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const created = (await submit(actor.browser, await h.input(actor.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
    const before = await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })
    const changes = [
      { amount: '100' }, { amount: '100', version: 3 }, { amount: '0', version: 2 }, { amount: '1.234', version: 2 },
      { amount: '100', version: 2, remark: 'changed' }, { amount: '100', version: 2, ownerUserId: actor.user.id },
      { amount: '100', version: 2, requestFingerprintHash: Buffer.alloc(32) },
      { amount: '100', version: 2, paymentRemark: 'spoof' },
    ]
    for (const data of changes) await expect(h.prisma.packagingCostRequest.update({ where: { id: created.id }, data })).rejects.toThrow()
    expect(await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before)
    await expect(h.prisma.packagingCostRequest.delete({ where: { id: created.id } })).rejects.toThrow()
  })

  it('serializes amount edits against payment so exactly one original-version command wins', async () => {
    const actor = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const created = (await submit(actor.browser, await h.input(actor.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
    // 先准备凭证，让并发点只覆盖金额修改与实际付款两条事务。
    await pay(actor.browser, created.id, 999).expect(409)
    const results = await Promise.all([
      actor.browser.patch(`/api/packaging-cost-requests/${created.id}/amount`).set(packagingHeaders).send({ amount: '120', expectedVersion: 1 }),
      pay(actor.browser, created.id, 1),
    ])
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
    const row = await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.version).toBe(2)
    if (results[0].status === 200) {
      expect(row.status).toBe('PENDING_PAYMENT')
      expect(row.amount.toFixed(2)).toBe('120.00')
      expect(await h.prisma.fundPostingBatch.count({ where: { businessId: row.id } })).toBe(0)
      await pay(actor.browser, created.id, 2).expect(200)
    } else {
      expect(row.status).toBe('PAID')
      expect(row.amount.toFixed(2)).toBe('280.50')
      expect(await h.prisma.auditEvent.count({ where: { targetId: row.id, eventType: 'PACKAGING_COST_AMOUNT_UPDATED' } })).toBe(0)
    }
    const batch = await h.prisma.fundPostingBatch.findFirstOrThrow({ where: { businessId: row.id } })
    expect(batch.businessAmount.toFixed(2)).toBe(row.amount.toFixed(2))
    expect(await h.prisma.fundPostingBatch.count({ where: { businessId: row.id } })).toBe(1)
  })

  it('rolls back corrected amounts when the audit write fails', async () => {
    const actor = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const created = (await submit(actor.browser, await h.input(actor.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
    const before = await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })
    const audit = h.app.get(AuditService)
    const realRecord = audit.record.bind(audit)
    const failure = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === 'PACKAGING_COST_AMOUNT_UPDATED'
      ? Promise.reject(new Error('injected amount audit failure')) : realRecord(tx, event))
    try {
      await actor.browser.patch(`/api/packaging-cost-requests/${created.id}/amount`).set(packagingHeaders).send({ amount: '100', expectedVersion: 1 }).expect(500)
    } finally { failure.mockRestore() }
    expect(await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before)
    expect(await h.prisma.auditEvent.count({ where: { targetId: created.id, eventType: 'PACKAGING_COST_AMOUNT_UPDATED' } })).toBe(0)
  })

  it('replays concurrent submissions once and rejects a changed amount with the same idempotency key', async () => {
    const actor = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const input = await h.input(actor.browser, shipment.part.id)
    const key = randomUUID()
    const responses = await Promise.all([submit(actor.browser, input, key).expect(201), submit(actor.browser, input, key).expect(201)])
    const first = responses[0].body as PackagingCostRequestDto
    expect(responses[1].body as PackagingCostRequestDto).toEqual(first)
    expect((await submit(actor.browser, input, key).expect(201)).body as PackagingCostRequestDto).toEqual(first)
    const conflict = await submit(actor.browser, { ...input, amount: '281' }, key).expect(409)
    expect(conflict.body as unknown).toMatchObject({ code: 'PACKAGING_COST_IDEMPOTENCY_CONFLICT' })
    expect(await h.prisma.packagingCostRequest.count({ where: { shipmentId: shipment.part.id } })).toBe(1)
    expect(await h.prisma.auditEvent.count({ where: { targetId: first.id, eventType: 'PACKAGING_COST_SUBMITTED' } })).toBe(1)
  })

  it('serializes competing payers into a single fact and safely replays only the winning original request', async () => {
    const first = await h.browserWithPermissions()
    const second = await h.browserWithPermissions(['packaging-costs:read', 'packaging-costs:pay'])
    const shipment = await h.shipment()
    const created = (await submit(first.browser, await h.input(first.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
    await pay(first.browser, created.id, 999).expect(409)
    await first.browser.post(`/api/packaging-cost-requests/${created.id}/pay`).set(packagingHeaders).send({ expectedVersion: 1, amount: '1' }).expect(422)
    const results = await Promise.all([pay(first.browser, created.id), pay(second.browser, created.id)])
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
    const winner = results[0].status === 200 ? first : second
    const loser = results[0].status === 200 ? second : first
    const paid = await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })
    expect(paid).toMatchObject({ status: 'PAID', version: 2, paidByUserId: winner.user.id })
    expect(paid.paidAt).toBeInstanceOf(Date)
    const posted = await fundFacts(created.id)
    expect(posted.batches).toHaveLength(1)
    expect(posted.batches[0].entries).toHaveLength(2)
    await pay(winner.browser, created.id).expect(200)
    await Promise.all([pay(winner.browser, created.id).expect(200), pay(winner.browser, created.id).expect(200)])
    await pay(loser.browser, created.id).expect(409)
    await pay(winner.browser, created.id, 2).expect(409)
    expect(await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })).toEqual(paid)
    expect(await h.prisma.auditEvent.count({ where: { targetId: created.id, eventType: 'PACKAGING_COST_PAID' } })).toBe(1)
    expect(await fundFacts(created.id)).toEqual(posted)
  })

  it('keeps both images referenced after payment and rejects direct changes to frozen financial facts', async () => {
    const actor = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const input = await h.input(actor.browser, shipment.part.id)
    const created = (await submit(actor.browser, input).expect(201)).body as PackagingCostRequestDto
    await pay(actor.browser, created.id).expect(200)
    for (const id of [input.packagingImageMediaAssetId, input.quotationImageMediaAssetId]) {
      expect(await new MediaAssetReferenceRepository().hasActiveReferences(h.prisma, id)).toBe(true)
      expect(await h.prisma.$transaction(tx => h.app.get(MediaAssetRetentionService).markUnreferencedForTrash(tx, id))).toBe('ACTIVE_REFERENCE')
      await expect(h.prisma.mediaAsset.update({ where: { id }, data: { status: 'TRASHED', retentionUntil: new Date(Date.now() + 8 * 86_400_000) } })).rejects.toThrow()
      expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id } })).status).toBe('READY')
    }
    await expect(h.prisma.packagingCostRequest.update({ where: { id: created.id }, data: { amount: '1' } })).rejects.toThrow()
    await expect(h.prisma.packagingCostRequest.update({ where: { id: created.id }, data: { status: 'PENDING_PAYMENT', paidByUserId: null, paidAt: null } })).rejects.toThrow()
    await expect(h.prisma.packagingCostRequest.delete({ where: { id: created.id } })).rejects.toThrow()
  })

  it('lets submitters inspect only the exact shipment history with pending and paid summaries', async () => {
    const creator = await h.browserWithPermissions(['packaging-costs:create'])
    const finance = await h.browserWithPermissions(['packaging-costs:read', 'packaging-costs:pay'])
    const shipment = await h.shipment()
    const url = `/api/packaging-cost-requests/shipment-context/${shipment.part.id}`
    expect((await creator.browser.get(url).expect(200)).body as PackagingCostShipmentContextDto).toMatchObject({ existingRequests: [], eligible: true })
    const first = (await submit(creator.browser, await h.input(creator.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
    const paid = (await pay(finance.browser, first.id).expect(200)).body as PackagingCostRequestDto
    const pending = (await submit(creator.browser, { ...await h.input(creator.browser, shipment.part.id), packagingType: 'WOODEN_FRAME', amount: '110.25' }).expect(201)).body as PackagingCostRequestDto
    const otherShipment = await h.shipment()
    const unrelated = (await submit(creator.browser, await h.input(creator.browser, otherShipment.part.id)).expect(201)).body as PackagingCostRequestDto
    const before = await fundFacts(paid.id)
    const response = await creator.browser.get(url).expect(200)
    const context = response.body as PackagingCostShipmentContextDto
    const summary = (row: PackagingCostRequestDto) => ({
      id: row.id, version: row.version, packagingTypeName: row.packagingTypeName, packagingVendor: row.packagingVendor, amount: row.amount,
      currencyCode: row.currencyCode, status: row.status, submittedBy: row.submittedBy, submittedAt: row.submittedAt,
      paidBy: row.paidBy, paidAt: row.paidAt, remark: row.remark,
    })
    expect(context.existingRequests).toEqual([summary(pending), summary(paid)])
    expect(context.eligible).toBe(true)
    expect(JSON.stringify(context)).not.toContain(unrelated.id)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(await fundFacts(paid.id)).toEqual(before)
    await creator.browser.get(`/api/packaging-cost-requests/${paid.id}`).expect(403)
    await finance.browser.get(url).expect(403)
    await request(h.app.getHttpServer()).get(url).expect(401)
    const missing = (await creator.browser.get(`/api/packaging-cost-requests/shipment-context/${randomUUID()}`).expect(200)).body as PackagingCostShipmentContextDto
    expect(missing).toMatchObject({ existingRequests: [], eligible: false, unavailableReason: 'invalidShipment' })
  })

  it('separates create, read and pay permissions and applies revocation on the next request', async () => {
    await request(h.app.getHttpServer()).get('/api/packaging-cost-requests').expect(401)
    const creator = await h.browserWithPermissions(['packaging-costs:create'])
    const reader = await h.browserWithPermissions(['packaging-costs:read'])
    const payer = await h.browserWithPermissions(['packaging-costs:read', 'packaging-costs:pay'])
    const payOnly = await h.browserWithPermissions(['packaging-costs:pay'])
    const shipment = await h.shipment()
    await creator.browser.get(`/api/packaging-cost-requests/shipment-context/${shipment.part.id}`).expect(200)
    await reader.browser.get(`/api/packaging-cost-requests/shipment-context/${shipment.part.id}`).expect(403)
    const input = await h.input(creator.browser, shipment.part.id)
    const created = (await submit(creator.browser, input).expect(201)).body as PackagingCostRequestDto
    await creator.browser.get('/api/packaging-cost-requests').expect(403)
    await pay(creator.browser, created.id).expect(403)
    await reader.browser.get('/api/packaging-cost-requests').expect(200)
    await submit(reader.browser, input).expect(403)
    await reader.browser.post('/api/packaging-cost-requests/images').set(packagingHeaders).field('mediaType', 'IMAGE').attach('file', Buffer.from('not-an-image'), 'x.png').expect(403)
    await pay(reader.browser, created.id).expect(403)
    await payOnly.browser.get('/api/packaging-cost-requests').expect(403)
    await pay(payOnly.browser, created.id).expect(403)
    await h.prisma.rolePermission.deleteMany({ where: { roleId: payer.role.id } })
    await pay(payer.browser, created.id).expect(403)
    expect((await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('PENDING_PAYMENT')
  })

  it('rejects fabricated ownership, currencies, amounts and image cardinality without activating evidence', async () => {
    const actor = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const input = await h.input(actor.browser, shipment.part.id)
    for (const change of [
      { ownerUserId: actor.user.id }, { currencyCode: 'USD' }, { status: 'PAID' },
      { amount: '0' }, { amount: '-1' }, { amount: '1.234' }, { amount: '1e3' }, { amount: '9'.repeat(27) },
      { amount: 100 }, { packagingVendor: 'UNLISTED' }, { packagingImageMediaAssetId: [input.packagingImageMediaAssetId] },
      { quotationImageMediaAssetId: input.packagingImageMediaAssetId }, { quotationImageMediaAssetId: null }, { remark: '字'.repeat(501) },
    ]) await submit(actor.browser, { ...input, ...change }).expect(422)
    await actor.browser.post('/api/packaging-cost-requests').set(packagingHeaders).send(input).expect(422)
    expect(await h.prisma.packagingCostRequest.count({ where: { shipmentId: shipment.part.id } })).toBe(0)
    await imagesAreStaged([input.packagingImageMediaAssetId, input.quotationImageMediaAssetId])
  })

  it('rejects not-yet-received and stock shipments and disabled packaging types', async () => {
    const actor = await h.browserWithPermissions()
    for (const options of [{ received: false }, { salesLinked: false }]) {
      const shipment = await h.shipment(options)
      const input = await h.input(actor.browser, shipment.part.id)
      const response = await submit(actor.browser, input).expect(422)
      expect(response.body as unknown).toMatchObject({ code: 'PACKAGING_COST_NOT_ALLOWED' })
      expect(await h.prisma.packagingCostRequest.count({ where: { shipmentId: shipment.part.id } })).toBe(0)
      await imagesAreStaged([input.packagingImageMediaAssetId, input.quotationImageMediaAssetId])
    }
    const shipment = await h.shipment()
    const input = await h.input(actor.browser, shipment.part.id)
    const dictionary = await h.prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'warehouse.packaging_type' } })
    await h.prisma.dictionaryItem.update({ where: { dictionaryTypeId_value: { dictionaryTypeId: dictionary.id, value: input.packagingType } }, data: { enabled: false } })
    try {
      const response = await submit(actor.browser, input).expect(422)
      expect(response.body as unknown).toMatchObject({ code: 'PACKAGING_COST_TYPE_UNAVAILABLE' })
      await imagesAreStaged([input.packagingImageMediaAssetId, input.quotationImageMediaAssetId])
    } finally {
      await h.prisma.dictionaryItem.update({ where: { dictionaryTypeId_value: { dictionaryTypeId: dictionary.id, value: input.packagingType } }, data: { enabled: true } })
    }
  })

  it('rejects expired, absent, foreign and reused images without leaving partial requests or ready assets', async () => {
    const actor = await h.browserWithPermissions()
    const foreign = await h.browserWithPermissions(['packaging-costs:create'])
    const shipment = await h.shipment()
    const input = await h.input(actor.browser, shipment.part.id)
    const foreignId = await h.upload(foreign.browser, 'jpeg')
    for (const id of [randomUUID(), foreignId]) {
      const response = await submit(actor.browser, { ...input, quotationImageMediaAssetId: id }).expect(422)
      expect(response.body as unknown).toMatchObject({ code: 'PACKAGING_COST_IMAGE_UNAVAILABLE' })
    }
    await h.prisma.mediaAsset.update({ where: { id: input.packagingImageMediaAssetId }, data: { uploadExpiresAt: new Date(Date.now() - 1000) } })
    expect((await submit(actor.browser, input).expect(422)).body as unknown).toMatchObject({ code: 'PACKAGING_COST_IMAGE_UNAVAILABLE' })
    expect(await h.prisma.packagingCostRequest.count({ where: { shipmentId: shipment.part.id } })).toBe(0)
    await imagesAreStaged([input.packagingImageMediaAssetId, input.quotationImageMediaAssetId, foreignId])
    const fresh = await h.input(actor.browser, shipment.part.id)
    await submit(actor.browser, fresh).expect(201)
    const replacementId = await h.upload(actor.browser)
    await submit(actor.browser, { ...fresh, quotationImageMediaAssetId: replacementId }).expect(422)
    await imagesAreStaged([replacementId])
    expect(await h.prisma.packagingCostRequest.count({ where: { shipmentId: shipment.part.id } })).toBe(1)
  })

  it('rejects malformed, oversized and multiple uploaded screenshots through the real stream parser', async () => {
    const actor = await h.browserWithPermissions(['packaging-costs:create'])
    const corrupted = await actor.browser.post('/api/packaging-cost-requests/images').set(packagingHeaders)
      .field('mediaType', 'IMAGE').attach('file', Buffer.from('not-an-image'), { filename: 'corrupt.png', contentType: 'image/png' }).expect(422)
    expect(corrupted.body as unknown).toMatchObject({ code: 'PACKAGING_COST_IMAGE_INVALID' })
    const oversized = await actor.browser.post('/api/packaging-cost-requests/images').set(packagingHeaders)
      .field('mediaType', 'IMAGE').attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' }).expect(422)
    expect(oversized.body as unknown).toMatchObject({ code: 'PACKAGING_COST_IMAGE_TOO_LARGE' })
    await actor.browser.post('/api/packaging-cost-requests/images').set(packagingHeaders)
      .field('mediaType', 'IMAGE').attach('file', Buffer.from('first'), { filename: 'first.png', contentType: 'image/png' })
      .attach('file', Buffer.from('second'), { filename: 'second.png', contentType: 'image/png' }).expect(422)
    await actor.browser.post('/api/packaging-cost-requests/images').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT').attach('file', Buffer.from('%PDF-1.7'), { filename: 'evidence.pdf', contentType: 'application/pdf' }).expect(422)
    expect(await h.prisma.mediaAsset.count({ where: { createdByUserId: actor.user.id, status: { in: ['READY', 'UPLOADING'] } } })).toBe(0)
  })

  it('rolls back submission and payment with the same transaction when the audit cannot be saved', async () => {
    const actor = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const input = await h.input(actor.browser, shipment.part.id)
    const audit = h.app.get(AuditService)
    const realRecord = audit.record.bind(audit)
    const failure = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === 'PACKAGING_COST_SUBMITTED'
      ? Promise.reject(new Error('injected packaging audit failure')) : realRecord(tx, event))
    try { await submit(actor.browser, input).expect(500) } finally { failure.mockRestore() }
    expect(await h.prisma.packagingCostRequest.count({ where: { shipmentId: shipment.part.id } })).toBe(0)
    await imagesAreStaged([input.packagingImageMediaAssetId, input.quotationImageMediaAssetId])
    const created = (await submit(actor.browser, input).expect(201)).body as PackagingCostRequestDto
    const beforePayment = await fundFacts(created.id)
    const payFailure = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === 'PACKAGING_COST_PAID'
      ? Promise.reject(new Error('injected packaging payment audit failure')) : realRecord(tx, event))
    try { await pay(actor.browser, created.id).expect(500) } finally { payFailure.mockRestore() }
    expect(await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ status: 'PENDING_PAYMENT', paidAt: null, paidByUserId: null, version: 1 })
    expect(await h.prisma.auditEvent.count({ where: { targetId: created.id, eventType: 'PACKAGING_COST_PAID' } })).toBe(0)
    expect(await fundFacts(created.id)).toEqual(beforePayment)
    await pay(actor.browser, created.id).expect(200)
  })

  it('refuses missing owner accounts without charging the payer or changing payment state', async () => {
    const payer = await h.browserWithPermissions()
    const owner = await h.browserWithPermissions([])
    const shipment = await h.shipment({ ownerUserId: owner.user.id })
    const created = (await submit(payer.browser, await h.input(payer.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
    await h.app.get(FundAccountCommandService).createUserAccount({ actorUserId: payer.user.id, requestId: randomUUID() }, { userId: payer.user.id, userShareRate: '70' })
    const before = await fundFacts(created.id)
    const failed = await pay(payer.browser, created.id).expect(422)
    expect(failed.body as unknown).toMatchObject({ code: 'PACKAGING_COST_POSTING_UNAVAILABLE' })
    expect(await fundFacts(created.id)).toEqual(before)
    expect(await h.prisma.fundAccount.count({ where: { userId: owner.user.id } })).toBe(0)
  })

  it('fails closed for missing or disabled posting configuration and authorization without partial ledger writes', async () => {
    const isolated = await createPackagingCostHarness({ nativeImageProbe: true })
    try {
      const { postingType } = await isolated.setupFunds()
      const source = await isolated.prisma.fundBusinessSource.findUniqueOrThrow({ where: { code: 'PACKAGING_COST' } })
      const payer = await isolated.browserWithPermissions()
      const shipment = await isolated.shipment()
      const created = (await submit(payer.browser, await isolated.input(payer.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
      const authorization = { businessSourceId: source.id, postingTypeId: postingType.id }
      const scenarios: { break: () => Promise<unknown>, restore: () => Promise<unknown> }[] = [
        { break: () => isolated.prisma.fundBusinessSource.update({ where: { id: source.id }, data: { enabled: false } }), restore: () => isolated.prisma.fundBusinessSource.update({ where: { id: source.id }, data: { enabled: true } }) },
        { break: () => isolated.prisma.fundPostingType.update({ where: { id: postingType.id }, data: { enabled: false } }), restore: () => isolated.prisma.fundPostingType.update({ where: { id: postingType.id }, data: { enabled: true } }) },
        { break: () => isolated.prisma.fundPostingType.update({ where: { id: postingType.id }, data: { currentRuleVersionId: null } }), restore: () => isolated.prisma.fundPostingType.update({ where: { id: postingType.id }, data: { currentRuleVersionId: postingType.currentRuleVersionId } }) },
        { break: () => isolated.prisma.fundBusinessSourcePostingType.delete({ where: { businessSourceId_postingTypeId: authorization } }), restore: () => isolated.prisma.fundBusinessSourcePostingType.create({ data: authorization }) },
        { break: () => isolated.prisma.fundBusinessSource.update({ where: { id: source.id }, data: { code: 'PACKAGING_COST_UNAVAILABLE' } }), restore: () => isolated.prisma.fundBusinessSource.update({ where: { id: source.id }, data: { code: 'PACKAGING_COST' } }) },
        { break: () => isolated.prisma.fundPostingType.update({ where: { id: postingType.id }, data: { code: 'WOODEN_PACKING_COST_UNAVAILABLE' } }), restore: () => isolated.prisma.fundPostingType.update({ where: { id: postingType.id }, data: { code: 'WOODEN_PACKING_COST' } }) },
      ]
      for (const scenario of scenarios) {
        await scenario.break()
        try {
          const before = await fundFacts(created.id, isolated)
          const failed = await pay(payer.browser, created.id).expect(422)
          expect(failed.body as unknown).toMatchObject({ code: 'PACKAGING_COST_POSTING_UNAVAILABLE' })
          expect(await fundFacts(created.id, isolated)).toEqual(before)
          expect(before.request).toMatchObject({ status: 'PENDING_PAYMENT', version: 1 })
        } finally { await scenario.restore() }
      }
      await pay(payer.browser, created.id).expect(200)
      expect((await fundFacts(created.id, isolated)).batches).toHaveLength(1)
    } finally { await isolated.dispose() }
  })

  it('keeps historical paid requests without ledger batches unchanged when read or retried', async () => {
    const payer = await h.browserWithPermissions()
    const shipment = await h.shipment()
    const created = (await submit(payer.browser, await h.input(payer.browser, shipment.part.id)).expect(201)).body as PackagingCostRequestDto
    // 仅在隔离测试库模拟迁移前已付款且没有新证据的旧记录；恢复触发器后仍不补造资金批次。
    await h.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE packaging_cost_requests DISABLE TRIGGER packaging_cost_requests_identity_trigger')
      await tx.packagingCostRequest.update({ where: { id: created.id }, data: { status: 'PAID', version: 2, paidByUserId: payer.user.id, paidAt: new Date() } })
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
      await tx.$executeRawUnsafe('ALTER TABLE packaging_cost_requests ENABLE TRIGGER packaging_cost_requests_identity_trigger')
    })
    const before = await fundFacts(created.id)
    expect(before.batches).toEqual([])
    await payer.browser.get(`/api/packaging-cost-requests/${created.id}`).expect(200)
    await pay(payer.browser, created.id).expect(409)
    expect(await fundFacts(created.id)).toEqual(before)
  })

  it('applies zero and full user shares without creating zero-value entries', async () => {
    const payer = await h.browserWithPermissions()
    const commands = h.app.get(FundAccountCommandService)
    const owner = await h.prisma.fundAccount.findUniqueOrThrow({ where: { userId: h.fixture.actor.id } })
    async function setShare(value: string) {
      const current = await h.prisma.fundAccount.findUniqueOrThrow({ where: { id: owner.id } })
      await commands.updateUserShareRate({ actorUserId: h.fixture.actor.id, requestId: randomUUID() }, { accountId: owner.id, expectedVersion: current.version, userShareRate: value, reason: '包装费用边界验证' })
    }
    try {
      for (const share of ['0', '100']) {
        await setShare(share)
        const shipment = await h.shipment()
        const created = (await submit(payer.browser, { ...await h.input(payer.browser, shipment.part.id), amount: '10' }).expect(201)).body as PackagingCostRequestDto
        await pay(payer.browser, created.id).expect(200)
        const batch = await h.prisma.fundPostingBatch.findFirstOrThrow({ where: { businessId: created.id }, include: { entries: true } })
        expect(batch.userShareRateSnapshot?.toFixed(2)).toBe(`${share}.00`)
        expect(batch.entries).toHaveLength(1)
        expect(batch.entries[0].accountTarget).toBe(share === '0' ? 'COMPANY' : 'USER')
        expect(batch.entries[0].direction).toBe('DEBIT')
        expect(batch.entries[0].amount.toFixed(2)).toBe('10.00')
      }
    } finally { await setShare('30') }
  })
})
