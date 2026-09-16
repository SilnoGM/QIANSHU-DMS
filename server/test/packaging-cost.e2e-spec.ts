import { randomUUID } from 'node:crypto'

import request from 'supertest'

import type { PackagingCostRequestDto, PackagingCostRequestPageDto } from '../src/modules/packaging-costs/packaging-cost.dto'
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
  function pay(browser: ReturnType<typeof request.agent>, id: string, expectedVersion = 1) {
    return browser.post(`/api/packaging-cost-requests/${id}/pay`).set(packagingHeaders).send({ expectedVersion })
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
    // 仅在隔离库模拟旧版付款事实；保留正式不可变触发器，不为历史付款补造资金批次。
    await h.prisma.packagingCostRequest.update({ where: { id: created.id }, data: { status: 'PAID', version: 2, paidByUserId: payer.user.id, paidAt: new Date() } })
    const before = await fundFacts(created.id)
    expect(before.batches).toEqual([])
    await payer.browser.get(`/api/packaging-cost-requests/${created.id}`).expect(200)
    await pay(payer.browser, created.id).expect(200)
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
