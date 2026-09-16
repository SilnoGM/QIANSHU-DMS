import { randomUUID } from 'node:crypto'

import request from 'supertest'

import type { PackagingCostRequestDto, PackagingCostRequestPageDto } from '../src/modules/packaging-costs/packaging-cost.dto'
import { AuditService } from '../src/modules/audit/audit.service'
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

  it('persists the received shipment, sales issuer and two private images, then confirms the immutable CNY payment', async () => {
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
    expect(await h.prisma.fundPostingBatch.count()).toBe(initialPostings)
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
    await pay(winner.browser, created.id).expect(200)
    await pay(loser.browser, created.id).expect(409)
    await pay(winner.browser, created.id, 2).expect(409)
    expect(await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })).toEqual(paid)
    expect(await h.prisma.auditEvent.count({ where: { targetId: created.id, eventType: 'PACKAGING_COST_PAID' } })).toBe(1)
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
    const payFailure = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === 'PACKAGING_COST_PAID'
      ? Promise.reject(new Error('injected packaging payment audit failure')) : realRecord(tx, event))
    try { await pay(actor.browser, created.id).expect(500) } finally { payFailure.mockRestore() }
    expect(await h.prisma.packagingCostRequest.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ status: 'PENDING_PAYMENT', paidAt: null, paidByUserId: null, version: 1 })
    expect(await h.prisma.auditEvent.count({ where: { targetId: created.id, eventType: 'PACKAGING_COST_PAID' } })).toBe(0)
    await pay(actor.browser, created.id).expect(200)
  })
})
