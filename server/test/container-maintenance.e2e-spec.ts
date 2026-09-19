import { randomUUID } from 'node:crypto'
import { createOceanXlsxFixture } from './fixtures/ocean-freight-xlsx.fixture'
import type { ContainerSourceFileDto } from '../src/modules/container-batches/container-source-file.dto'
import request from 'supertest'
import { AuditService } from '../src/modules/audit/audit.service'
import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['container-batches:read', 'container-batches:create', 'container-batches:update', 'purchase-orders:read', 'sales-orders:read', 'ocean-freight-bills:read', 'ocean-freight-bills:create', 'ocean-freight-bills:update']
describe('container maintenance with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness, browser: ReturnType<typeof request.agent>, reader: ReturnType<typeof request.agent>
  let sequence = 30
  const post = (url: string, body: object) => browser.post(url).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(body)
  const patch = (url: string, body: object) => browser.patch(url).set(packagingHeaders).send(body)
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const uploadForCreate = (agent = browser) => agent.post('/api/container-batches/source-file-uploads').set(packagingHeaders)
    .field('mediaType', 'DOCUMENT').attach('file', createOceanXlsxFixture(), { filename: '装柜资料.xlsx', contentType: mime })
  async function batch() {
    const source = (await uploadForCreate().expect(201)).body as ContainerSourceFileDto
    return (await post('/api/container-batches', { containerBatchName: `0919-${++sequence}柜`, warehouseValue: TEST_DESTINATION_WAREHOUSE, sourceFileId: source.mediaAssetId }).expect(201)).body as ContainerBatchDto
  }
  async function legacyBatch() {
    // 只在隔离测试库种入旧版允许无来源文件的记录，验证新建必填不会锁死历史编辑。
    const row = await h.prisma.$transaction(async tx => {
      const key = randomUUID(), fingerprint = 'a'.repeat(64), sequenceInDay = ++sequence
      const issuance = await h.fixture.numbering.generateScopedInTransaction(tx, { ruleCode: 'CONTAINER_BATCH_NO', consumerCode: 'CONTAINER_BATCH.CREATE', idempotencyKey: key, requestFingerprint: fingerprint })
      return tx.containerBatch.create({ data: { containerBatchNo: issuance.number, numberingIssuanceId: issuance.issuanceId,
        containerBatchName: `0919-${sequenceInDay}柜`, loadingDate: new Date('2026-09-19T00:00:00Z'), sequenceInDay,
        warehouseValue: TEST_DESTINATION_WAREHOUSE, creationRequestKey: key, creationPayloadHash: fingerprint,
        createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id } })
    })
    return (await browser.get(`/api/container-batches/${row.id}`).expect(200)).body as ContainerBatchDto
  }
  async function item(parent: ContainerBatchDto, extra: object = {}) { return (await post(`/api/container-batches/${parent.id}/items`, { expectedVersion: parent.version, goodsName: '履带', packageCount: 10, ...extra }).expect(201)).body as ContainerLoadingItemDto }
  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    reader = (await h.browserWithPermissions(['container-batches:read'])).browser
    for (const [ruleCode, prefix] of [['CONTAINER_BATCH_NO', 'CB'], ['CTN_BILL_NO', 'OFB']]) {
      const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
      const created = await h.fixture.numberingCommands.create(context, { ruleCode, purpose: 'BUSINESS', name: ruleCode, resetPolicy: 'NEVER', segments: [{ type: 'FIXED', value: prefix }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
      const published = await h.fixture.numberingCommands.publish(context, created.id, { expectedVersion: created.version, draftRevision: 1 })
      await h.fixture.numberingCommands.enable(context, created.id, { expectedVersion: published.version })
    }
  })
  afterAll(async () => { await h?.dispose() })

  it('requires a current-user source upload before creating a batch and protects the pre-upload endpoint', async () => {
    const path = '/api/container-batches/source-file-uploads'
    await request(h.app.getHttpServer()).post(path).set(packagingHeaders).field('mediaType', 'DOCUMENT')
      .attach('file', createOceanXlsxFixture(), { filename: 'source.xlsx', contentType: mime }).expect(401)
    await uploadForCreate(reader).expect(403)
    await browser.post(path).field('mediaType', 'DOCUMENT').attach('file', createOceanXlsxFixture(), { filename: 'source.xlsx', contentType: mime }).expect(403)
    const creator = (await h.browserWithPermissions(['container-batches:create'])).browser
    const before = await h.prisma.containerBatch.count(), beforeNumbers = await h.prisma.numberingIssuance.count()
    const source = (await uploadForCreate(creator).expect(201)).body as ContainerSourceFileDto
    expect(await h.prisma.containerBatch.count()).toBe(before)
    expect(await h.prisma.numberingIssuance.count()).toBe(beforeNumbers)
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.mediaAssetId } })).status).toBe('UPLOADING')
    const fields = { containerBatchName: `0919-${++sequence}柜`, warehouseValue: TEST_DESTINATION_WAREHOUSE }
    for (const sourceFileId of [undefined, null, randomUUID(), source.mediaAssetId]) {
      await post('/api/container-batches', { ...fields, sourceFileId }).expect(422)
    }
    expect(await h.prisma.containerBatch.count()).toBe(before)
    expect(await h.prisma.numberingIssuance.count()).toBe(beforeNumbers)
    const key = randomUUID(), input = { ...fields, sourceFileId: source.mediaAssetId }
    const create = () => creator.post('/api/container-batches').set(packagingHeaders).set('Idempotency-Key', key).send(input)
    const created = (await create().expect(201)).body as ContainerBatchDto
    expect(created.sourceFileId).toBe(source.mediaAssetId)
    expect((await create().expect(201)).body as ContainerBatchDto).toEqual(created)
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.mediaAssetId } })).status).toBe('READY')
    expect(await h.prisma.containerBatch.count()).toBe(before + 1)
    expect(await h.prisma.numberingIssuance.count()).toBe(beforeNumbers + 1)
  })

  it('updates the header within its creation year and rejects stale, unauthorized, forged writes', async () => {
    const parent = await legacyBatch(), url = `/api/container-batches/${parent.id}`
    await h.prisma.containerBatch.update({ where: { id: parent.id }, data: { createdAt: new Date('2024-09-19T00:00:00Z'), loadingDate: new Date('2024-09-19T00:00:00Z') } })
    const input = { expectedVersion: 1, containerBatchName: '0229柜', warehouseValue: parent.warehouseValue, remark: '历史柜次' }
    await request(h.app.getHttpServer()).patch(url).set(packagingHeaders).send(input).expect(401)
    await reader.patch(url).set(packagingHeaders).send(input).expect(403)
    await browser.patch(url).send(input).expect(403)
    await patch(url, { ...input, containerBatchNo: 'FORGED' }).expect(422)
    const result = (await patch(url, input).expect(200)).body as ContainerBatchDto
    expect(result).toMatchObject({ loadingDate: '2024-02-29', containerBatchNo: parent.containerBatchNo, version: 2 })
    await patch(url, input).expect(409)
    const found = await browser.get('/api/container-batches').query({ search: parent.containerBatchNo, warehouseValue: parent.warehouseValue }).expect(200)
    expect(found.body as { total: number }).toMatchObject({ total: 1 })
    expect((await browser.get('/api/container-batches').query({ search: 'not-a-container' }).expect(200)).body as { total: number }).toMatchObject({ total: 0 })
  })

  it('recalculates editable rows, aggregates exact totals, keeps missing values and redacts source references', async () => {
    const parent = await batch(), shipment = await h.shipment({ salesLinked: true })
    const before = await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipment.part.id } })
    const row = await item(parent)
    const url = `/api/container-batches/${parent.id}/items/${row.id}`
    const input = { expectedVersion: 2, itemExpectedVersion: 1, shipmentId: shipment.part.id, goodsName: '履带', packageCount: 10, lengthCm: '128', widthCm: '19', heightCm: '15', grossWeightKg: '180', codAmountTwd: '200.01', recipientName: '客户', recipientPhone: '0900123456', recipientAddress: '地址' }
    const result = (await patch(url, input).expect(200)).body as ContainerLoadingItemDto
    expect(result).toMatchObject({ volumeCai: '12.88272063', chargeableVolumeCai: 13, grossWeightKg: '180.000', codAmountTwd: '200.01', version: 2 })
    await patch(url, input).expect(409)
    await patch(`/api/container-batches/${parent.id}/items/${randomUUID()}`, input).expect(404)
    const detail = (await browser.get(`/api/container-batches/${parent.id}`).expect(200)).body as ContainerBatchDto
    expect(detail).toMatchObject({ version: 3, itemCount: 1, shipmentCount: 1, packageCountTotal: 10, grossWeightKgTotal: '180.000', volumeCaiTotal: '12.88272063', chargeableVolumeCaiTotal: 13 })
    const authorized = (await browser.get(`/api/container-batches/${parent.id}/items`).expect(200)).body as { items: ContainerLoadingItemDto[] }
    expect(authorized.items[0]).toMatchObject({ shipmentNo: before.shipmentNo, shippingMark: before.shippingMarkText, purchaseOrderId: shipment.order.id, salesOrderId: expect.any(String) as unknown })
    const restricted = (await reader.get(`/api/container-batches/${parent.id}/items`).expect(200)).body as { items: ContainerLoadingItemDto[] }
    expect(restricted.items[0]).toMatchObject({ shipmentNo: null, shippingMark: null, purchaseOrderId: null, purchaseOrderNo: null, salesOrderId: null, salesOrderNo: null })
    const emptied = (await patch(url, { expectedVersion: 3, itemExpectedVersion: 2, goodsName: '履带', packageCount: 10 }).expect(200)).body as ContainerLoadingItemDto
    expect(emptied).toMatchObject({ shipmentId: null, volumeCai: null, codAmountTwd: null, recipientName: null, version: 3 })
    expect((await browser.get(`/api/container-batches/${parent.id}`).expect(200)).body as ContainerBatchDto).toMatchObject({ grossWeightKgTotal: null, volumeCaiTotal: null })
    expect(await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipment.part.id } })).toEqual(before)
  })

  it('serializes competing edits and prevents cross-container assignment while allowing same-container rows', async () => {
    const first = await batch(), second = await batch(), shipment = await h.shipment({ salesLinked: false })
    const firstItem = await item(first), secondItem = await item(second)
    const input = { expectedVersion: 2, itemExpectedVersion: 1, shipmentId: shipment.part.id, goodsName: '货物', packageCount: 1 }
    const assigned = await Promise.all([patch(`/api/container-batches/${first.id}/items/${firstItem.id}`, input), patch(`/api/container-batches/${second.id}/items/${secondItem.id}`, input)])
    expect(assigned.map(result => result.status).sort()).toEqual([200, 409])
    const winner = assigned[0].status === 200 ? first : second
    await item({ ...winner, version: 3 }, { shipmentId: shipment.part.id })
    expect(await h.prisma.containerLoadingItem.count({ where: { shipmentId: shipment.part.id } })).toBe(2)
    const itemId = assigned[0].status === 200 ? firstItem.id : secondItem.id
    const concurrent = await Promise.all([patch(`/api/container-batches/${winner.id}/items/${itemId}`, { ...input, expectedVersion: 4, itemExpectedVersion: 2, goodsName: 'A' }), patch(`/api/container-batches/${winner.id}/items/${itemId}`, { ...input, expectedVersion: 4, itemExpectedVersion: 2, goodsName: 'B' })])
    expect(concurrent.map(result => result.status).sort()).toEqual([200, 409])
  })

  it('freezes bill-referenced loading data and header identity, with permission-filtered bill links', async () => {
    const parent = await batch(), row = await item(parent)
    const bill = (await post('/api/ocean-freight-bills', { billName: '账单', twdPerCny: '4.8' }).expect(201)).body as { id: string, billNo: string }
    await post(`/api/ocean-freight-bills/${bill.id}/lines`, { lineType: 'NORMAL', goodsName: '履带', loadingItemId: row.id, packageCount: 10 }).expect(201)
    const edit = { expectedVersion: 2, itemExpectedVersion: 1, goodsName: '不可修改', packageCount: 10 }
    const denied = await patch(`/api/container-batches/${parent.id}/items/${row.id}`, edit).expect(409)
    expect(denied.body as { code: string }).toMatchObject({ code: 'CONTAINER_ITEM_BILLED' })
    await patch(`/api/container-batches/${parent.id}`, { expectedVersion: 2, containerBatchName: '0920-88柜', warehouseValue: parent.warehouseValue }).expect(409)
    await patch(`/api/container-batches/${parent.id}`, { expectedVersion: 2, containerBatchName: parent.containerBatchName, warehouseValue: parent.warehouseValue, sourceFileId: parent.sourceFileId, remark: '仅备注' }).expect(200)
    const full = (await browser.get(`/api/container-batches/${parent.id}/items`).expect(200)).body as { items: ContainerLoadingItemDto[] }
    expect(full.items[0]).toMatchObject({ isBilled: true, billReferences: [{ id: bill.id, billNo: bill.billNo, billName: '账单' }] })
    const limited = (await reader.get(`/api/container-batches/${parent.id}/items`).expect(200)).body as { items: ContainerLoadingItemDto[] }
    expect(limited.items[0]).toMatchObject({ isBilled: true, billReferences: [] })
  })

  it('uploads, attaches and downloads private source files with strict access and immutable attachment', async () => {
    const parent = await legacyBatch(), path = `/api/container-batches/${parent.id}`, bytes = createOceanXlsxFixture()
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const upload = (agent = browser) => agent.post(`${path}/source-file-uploads`).set(packagingHeaders).field('mediaType', 'DOCUMENT').attach('file', bytes, { filename: '装柜资料.xlsx', contentType: mime })
    await reader.get(`${path}/source-file`).expect(404)
    await request(h.app.getHttpServer()).get(`${path}/source-file`).expect(401)
    await upload(reader).expect(403)
    await browser.post(`${path}/source-file-uploads`).field('mediaType', 'DOCUMENT').attach('file', bytes, { filename: 'source.xlsx', contentType: mime }).expect(403)
    await browser.post(`${path}/source-file-uploads`).set(packagingHeaders).field('mediaType', 'DOCUMENT').attach('file', Buffer.from('not an xlsx file'), { filename: 'forged.xlsx', contentType: mime }).expect(422)
    const uploaded = (await upload().expect(201)).body as ContainerSourceFileDto
    expect(uploaded).toMatchObject({ mimeType: mime, sizeBytes: bytes.length.toString() })
    expect(JSON.stringify(uploaded)).not.toMatch(/objectKey|checksumSha256|createdByUserId/u)
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: uploaded.mediaAssetId } })).status).toBe('UPLOADING')
    await reader.get(`${path}/source-file`).expect(404)
    const input = { expectedVersion: 1, containerBatchName: parent.containerBatchName, warehouseValue: parent.warehouseValue, sourceFileId: uploaded.mediaAssetId }
    const attached = (await patch(path, input).expect(200)).body as ContainerBatchDto
    expect(attached).toMatchObject({ sourceFileId: uploaded.mediaAssetId, version: 2 })
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: uploaded.mediaAssetId } })).status).toBe('READY')
    const metadata = await reader.get(`${path}/source-file`).expect(200)
    expect(metadata.body as ContainerSourceFileDto).toEqual(uploaded)
    expect(metadata.headers['cache-control']).toBe('private, no-store')
    const download = await reader.get(`${path}/source-file/content`).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => callback(null, Buffer.concat(chunks)))
      response.on('error', (error: Error) => callback(error, null))
    }).expect(200)
    expect(download.body as Buffer).toEqual(bytes)
    expect(download.headers['content-type']).toContain(mime)
    expect(download.headers['content-disposition']).toContain('attachment;')
    expect(download.headers['cache-control']).toBe('private, no-store')
    const head = await reader.head(`${path}/source-file/content`).expect(200)
    expect(head.headers['content-length']).toBe(bytes.length.toString())
    expect(head.text).toBeUndefined()
    await request(h.app.getHttpServer()).get(`${path}/source-file/content`).expect(401)
    const withoutRead = (await h.browserWithPermissions(['container-batches:update'])).browser
    await withoutRead.get(`${path}/source-file`).expect(403)
    await withoutRead.get(`${path}/source-file/content`).expect(403)
    await withoutRead.head(`${path}/source-file/content`).expect(403)
    const duplicate = await upload().expect(422)
    expect(duplicate.body as { code: string }).toMatchObject({ code: 'CONTAINER_SOURCE_FILE_LOCKED' })
    await patch(path, { ...input, expectedVersion: 2, sourceFileId: null }).expect(422)
    await patch(path, { ...input, expectedVersion: 2, sourceFileId: randomUUID() }).expect(422)
    expect((await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: parent.id } })).sourceFileId).toBe(uploaded.mediaAssetId)
  })

  it('filters loading rows by goods, ocean mark or warehouse receipt before pagination and count', async () => {
    const parent = await batch()
    const first = await item(parent, { goodsName: '履带', oceanShippingMarkText: 'OCEAN-A1', warehouseReceiptReference: 'RECEIPT-ONE' })
    const second = await item({ ...parent, version: 2 }, { goodsName: '叉车', oceanShippingMarkText: 'OCEAN-B2', warehouseReceiptReference: 'RECEIPT-TWO' })
    await item({ ...parent, version: 3 }, { goodsName: '机械配件', oceanShippingMarkText: 'OTHER', warehouseReceiptReference: 'OTHER' })
    const path = `/api/container-batches/${parent.id}/items`
    for (const [search, expectedId] of [['履带', first.id], ['ocean-b2', second.id], ['receipt-one', first.id]]) {
      const result = (await browser.get(path).query({ search }).expect(200)).body as { total: number, items: ContainerLoadingItemDto[] }
      expect(result.total).toBe(1)
      expect(result.items.map(row => row.id)).toEqual([expectedId])
    }
    const page = (await browser.get(path).query({ search: ' ocean- ', page: 2, pageSize: 1 }).expect(200)).body as { total: number, items: ContainerLoadingItemDto[] }
    expect(page.total).toBe(2)
    expect(page.items.map(row => row.id)).toEqual([second.id])
    expect((await browser.get(path).query({ search: 'absent' }).expect(200)).body as { total: number, items: ContainerLoadingItemDto[] }).toMatchObject({ total: 0, items: [] })
    expect((await browser.get(path).query({ search: ' ' }).expect(200)).body as { total: number }).toMatchObject({ total: 3 })
  })

  it('rolls back each edit and its versions on audit failure without financial side effects', async () => {
    const parent = await batch(), row = await item(parent), audit = h.app.get(AuditService), original = audit.record.bind(audit)
    const snapshot = async () => ({ batch: await h.prisma.containerBatch.findUnique({ where: { id: parent.id } }), item: await h.prisma.containerLoadingItem.findUnique({ where: { id: row.id } }) })
    for (const operation of [
      { event: 'CONTAINER_BATCH_UPDATED', path: `/api/container-batches/${parent.id}`, input: { expectedVersion: 2, containerBatchName: parent.containerBatchName, warehouseValue: parent.warehouseValue, sourceFileId: parent.sourceFileId, remark: 'rollback' } },
      { event: 'CONTAINER_LOADING_ITEM_UPDATED', path: `/api/container-batches/${parent.id}/items/${row.id}`, input: { expectedVersion: 2, itemExpectedVersion: 1, goodsName: 'rollback', packageCount: 3 } },
    ]) {
      const before = await snapshot()
      const injected = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === operation.event ? Promise.reject(new Error('Injected maintenance audit failure')) : original(tx, event))
      try { await patch(operation.path, operation.input).expect(500) } finally { injected.mockRestore() }
      expect(await snapshot()).toEqual(before)
    }
    expect(await h.prisma.fundPostingBatch.count()).toBe(0)
    expect(await h.prisma.fundLedgerEntry.count()).toBe(0)
    expect(await h.prisma.salesOrderPayment.count()).toBe(0)
  })
})
