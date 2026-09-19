import { Readable } from 'node:stream'
import { MediaAssetService } from '../src/modules/media/media-asset.service'
import { createOceanXlsxFixture } from './fixtures/ocean-freight-xlsx.fixture'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { AuditService } from '../src/modules/audit/audit.service'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import type { ContainerSourceFileDto } from '../src/modules/container-batches/container-source-file.dto'
import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import type { OceanFreightBillDto, OceanFreightBillLineDto } from '../src/modules/ocean-freight-bills/ocean-freight-bill.dto'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['container-batches:read', 'container-batches:create', 'container-batches:update', 'ocean-freight-bills:read', 'ocean-freight-bills:create', 'ocean-freight-bills:update']
const headers = packagingHeaders

describe('ocean freight foundation HTTP API with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  let browser: ReturnType<typeof request.agent>
  let reader: ReturnType<typeof request.agent>
  let actorId: string
  let fundSpy: jest.SpyInstance
  let container: ContainerBatchDto
  let bill: OceanFreightBillDto
  let loadingItem: ContainerLoadingItemDto
  let normalLine: OceanFreightBillLineDto
  let sequence = 10

  const post = (url: string, body: object, key = randomUUID()) => browser.post(url).set(headers).set('Idempotency-Key', key).send(body)
  const newContainerInput = () => ({ containerBatchName: `0919-${++sequence}柜`, warehouseValue: TEST_DESTINATION_WAREHOUSE })
  const newBillInput = () => ({ billName: `Reconciliation ${randomUUID()}`, twdPerCny: '4.8' })
  async function uploadedContainerInput() {
    const source = (await browser.post('/api/container-batches/source-file-uploads').set(headers).field('mediaType', 'DOCUMENT')
      .attach('file', createOceanXlsxFixture(), { filename: 'manifest.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).expect(201)).body as ContainerSourceFileDto
    return { ...newContainerInput(), sourceFileId: source.mediaAssetId }
  }
  async function createContainer() { return (await post('/api/container-batches', await uploadedContainerInput()).expect(201)).body as ContainerBatchDto }
  async function createBill() { return (await post('/api/ocean-freight-bills', newBillInput()).expect(201)).body as OceanFreightBillDto }

  beforeAll(async () => {
    // 复用真实采购审核/货件及应用认证夹具，数据库和文件目录均独立，未启用任何资金准备步骤。
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    // 并发请求共享固定监听生命周期，避免 Supertest 按请求自动开启/关闭同一 Server。
    await h.app.listen(0, '127.0.0.1')
    const actor = await h.browserWithPermissions(permissions)
    browser = actor.browser
    actorId = actor.user.id
    reader = (await h.browserWithPermissions(['container-batches:read', 'ocean-freight-bills:read'])).browser
    for (const [ruleCode, prefix] of [['CONTAINER_BATCH_NO', 'CB'], ['CTN_BILL_NO', 'OFB']]) {
      const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
      const rule = await h.fixture.numberingCommands.create(context, { ruleCode, purpose: 'BUSINESS', name: ruleCode, resetPolicy: 'NEVER',
        segments: [{ type: 'FIXED', value: prefix }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
      const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
      await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
    }
    fundSpy = jest.spyOn(h.app.get(FundPostingApplicationService), 'postBusinessEventInTransaction')
  })
  afterAll(async () => {
    fundSpy?.mockRestore()
    await h?.dispose()
  })

  it.each([
    ['/api/container-batches', () => newContainerInput()],
    ['/api/ocean-freight-bills', () => newBillInput()],
  ] as const)('enforces login, permission, CSRF, and strict DTOs on %s', async (url, input) => {
    await request(h.app.getHttpServer()).get(url).expect(401)
    await request(h.app.getHttpServer()).post(url).set(headers).set('Idempotency-Key', randomUUID()).send(input()).expect(401)
    await reader.post(url).set(headers).set('Idempotency-Key', randomUUID()).send(input()).expect(403)
    await browser.post(url).set('Idempotency-Key', randomUUID()).send(input()).expect(403)
    await post(url, { ...input(), inventedField: 'no' }).expect(422)
    await browser.post(url).set(headers).send(input()).expect(422)
    await reader.get(url).expect(200)
  })
  it('creates each header with one scoped number under concurrent identical requests and rejects key reuse', async () => {
    const containerInput = await uploadedContainerInput(), containerKey = randomUUID()
    const containerResponses = await Promise.all([post('/api/container-batches', containerInput, containerKey), post('/api/container-batches', containerInput, containerKey)])
    expect(containerResponses.map(response => response.status)).toEqual([201, 201])
    container = containerResponses[0].body as ContainerBatchDto
    expect(containerResponses[1].body as ContainerBatchDto).toEqual(container)
    expect(container).toMatchObject({ containerBatchName: containerInput.containerBatchName, warehouseValue: TEST_DESTINATION_WAREHOUSE, version: 1 })
    expect(container.containerBatchNo).toMatch(/^CB\d{8}$/u)
    expect(container.loadingDate).toMatch(/^\d{4}-09-19$/u)
    await post('/api/container-batches', { ...containerInput, remark: 'different' }, containerKey).expect(409)

    const billInput = newBillInput(), billKey = randomUUID()
    const billResponses = await Promise.all([post('/api/ocean-freight-bills', billInput, billKey), post('/api/ocean-freight-bills', billInput, billKey)])
    expect(billResponses.map(response => response.status)).toEqual([201, 201])
    bill = billResponses[0].body as OceanFreightBillDto
    expect(billResponses[1].body as OceanFreightBillDto).toEqual(bill)
    expect(bill).toMatchObject({ billName: billInput.billName, version: 1, netReturnAmountCny: null, returnAmountCny: null })
    expect(bill.billNo).toMatch(/^OFB\d{8}$/u)
    await post('/api/ocean-freight-bills', { ...billInput, twdPerCny: '4.9' }, billKey).expect(409)
    for (const consumerCode of ['CONTAINER_BATCH.CREATE', 'OCEAN_FREIGHT_BILL.CREATE']) {
      expect(await h.prisma.numberingIssuance.count({ where: { consumerCode } })).toBe(1)
    }
    for (const [path, id] of [['/api/container-batches', container.id], ['/api/ocean-freight-bills', bill.id]]) {
      const response = await reader.get(`${path}/${id}`).expect(200)
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect(response.headers['x-request-id']).toBeTruthy()
      expect(JSON.stringify(response.body)).not.toMatch(/creationPayloadHash|creationRequestKey|numberingIssuanceId/u)
      await reader.get(`${path}/${randomUUID()}`).expect(404)
    }
  })
  it('validates dictionary and source identifiers before consuming a number', async () => {
    const before = await h.prisma.numberingIssuance.count()
    await post('/api/container-batches', { ...await uploadedContainerInput(), warehouseValue: 'UNKNOWN' }).expect(422)
    await post('/api/container-batches', { ...newContainerInput(), sourceFileId: randomUUID() }).expect(422)
    await post('/api/ocean-freight-bills', { ...newBillInput(), twdPerCny: '0' }).expect(422)
    await post('/api/ocean-freight-bills', { ...newBillInput(), sourceFileId: randomUUID() }).expect(422)
    expect(await h.prisma.numberingIssuance.count()).toBe(before)
  })
  it('uses parent version for loading items, permits same-batch multiple packages, and rejects cross-batch assignment', async () => {
    const shipment = await h.shipment({ salesLinked: false })
    const statusBefore = shipment.part
    const input = { expectedVersion: 1, shipmentId: shipment.part.id, goodsName: 'Parts', packageCount: 10, oceanShippingMarkText: 'L-010831-01~10' }
    const key = randomUUID(), path = `/api/container-batches/${container.id}/items`
    loadingItem = (await post(path, input, key).expect(201)).body as ContainerLoadingItemDto
    expect(loadingItem).toMatchObject({ shipmentId: shipment.part.id, packageCount: 10, lineNumber: 1 })
    expect((await post(path, input, key).expect(201)).body as ContainerLoadingItemDto).toEqual(loadingItem)
    await post(path, { ...input, packageCount: 11 }, key).expect(409)
    await post(path, input).expect(409)
    await post(path, { ...input, expectedVersion: 2, packageCount: 2 }).expect(201)
    const other = await createContainer()
    await post(`/api/container-batches/${other.id}/items`, input).expect(409)
    expect((await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipment.part.id } }))).toEqual(statusBefore)
    expect((await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: container.id } })).version).toBe(3)
    const rows = await reader.get(path).expect(200)
    expect(rows.body as { total: number }).toMatchObject({ total: 2 })
    await reader.post(path).set(headers).set('Idempotency-Key', randomUUID()).send(input).expect(403)
  })
  it('prevents duplicate normal lines across bills and permits separate idempotent adjustment rows', async () => {
    const input = { lineType: 'NORMAL', goodsName: 'Parts', loadingItemId: loadingItem.id, packageCount: 10, codAmountTwd: '1000.00' }
    const key = randomUUID(), path = `/api/ocean-freight-bills/${bill.id}/lines`
    const responses = await Promise.all([post(path, input, key), post(path, input, key)])
    expect(responses.map(response => response.status)).toEqual([201, 201])
    normalLine = responses[0].body as OceanFreightBillLineDto
    expect(responses[1].body as OceanFreightBillLineDto).toEqual(normalLine)
    expect(normalLine).toMatchObject({ reconciliationStatus: 'PENDING', loadingItemId: loadingItem.id, packageCount: 10, netReturnAmountCny: null })
    await post(path, { ...input, goodsName: 'Changed' }, key).expect(409)
    await post(path, input).expect(409)
    const otherBill = await createBill(), otherPath = `/api/ocean-freight-bills/${otherBill.id}/lines`
    await post(otherPath, input).expect(409)
    const adjustment = { lineType: 'ADJUSTMENT', goodsName: 'Additional delivery', loadingItemId: loadingItem.id, adjustsBillLineId: normalLine.id }
    const adjusted = (await post(otherPath, adjustment).expect(201)).body as OceanFreightBillLineDto
    expect(adjusted).toMatchObject({ codAmountTwd: null, packageCount: null, reconciliationStatus: 'PENDING' })
    await post(otherPath, adjustment).expect(201)
    await post(otherPath, { ...adjustment, loadingItemId: randomUUID() }).expect(422)
    await post(otherPath, { ...adjustment, adjustsBillLineId: randomUUID() }).expect(422)
    const unlinked = (await post(otherPath, { lineType: 'ADJUSTMENT', goodsName: 'Unmatched fee' }).expect(201)).body as OceanFreightBillLineDto
    expect(unlinked.reconciliationStatus).toBe('UNMATCHED')
    expect((await reader.get(otherPath).expect(200)).body as { total: number }).toMatchObject({ total: 3 })
    await reader.post(otherPath).set(headers).set('Idempotency-Key', randomUUID()).send(adjustment).expect(403)
  })
  it('rolls back header numbering and row versions when mandatory audit recording fails', async () => {
    const audit = h.app.get(AuditService), realRecord = audit.record.bind(audit)
    const cases = [
      { event: 'CONTAINER_BATCH_CREATED', url: '/api/container-batches', input: await uploadedContainerInput() },
      { event: 'OCEAN_FREIGHT_BILL_CREATED', url: '/api/ocean-freight-bills', input: newBillInput() },
      { event: 'CONTAINER_LOADING_ITEM_CREATED', url: `/api/container-batches/${container.id}/items`, input: { expectedVersion: 3, goodsName: 'Rolled back item', packageCount: 1 } },
      { event: 'OCEAN_FREIGHT_BILL_LINE_CREATED', url: `/api/ocean-freight-bills/${bill.id}/lines`, input: { lineType: 'ADJUSTMENT', goodsName: 'Rolled back line' } },
    ]
    const facts = async () => ({
      numbers: await h.prisma.numberingIssuance.count(), batches: await h.prisma.containerBatch.count(), items: await h.prisma.containerLoadingItem.count(),
      bills: await h.prisma.oceanFreightBill.count(), lines: await h.prisma.oceanFreightBillLine.count(),
      batchVersion: (await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: container.id } })).version,
      billVersion: (await h.prisma.oceanFreightBill.findUniqueOrThrow({ where: { id: bill.id } })).version,
    })
    for (const testCase of cases) {
      const key = randomUUID(), before = await facts()
      const failure = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === testCase.event
        ? Promise.reject(new Error('injected ocean audit failure')) : realRecord(tx, event))
      try { await post(testCase.url, testCase.input, key).expect(500) } finally { failure.mockRestore() }
      expect(await facts()).toEqual(before)
      await post(testCase.url, testCase.input, key).expect(201)
    }
  })
  it('rolls back real source activation with numbering on audit failure and permits the same request to recover', async () => {
    const source = await h.app.get(MediaAssetService).prepare({ actorUserId: actorId, allowedTypes: ['DOCUMENT'], requestedType: 'DOCUMENT',
      originalFilename: 'manifest.xlsx', declaredMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', stream: Readable.from([createOceanXlsxFixture()]) })
    await h.prisma.mediaAsset.update({ where: { id: source.id }, data: { uploadPurpose: 'OCEAN_FREIGHT_SOURCE_XLSX' } })
    const input = { ...newContainerInput(), sourceFileId: source.id }, key = randomUUID()
    const beforeNumbers = await h.prisma.numberingIssuance.count(), beforeBatches = await h.prisma.containerBatch.count()
    const audit = h.app.get(AuditService), realRecord = audit.record.bind(audit)
    const failure = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === 'CONTAINER_BATCH_CREATED'
      ? Promise.reject(new Error('injected source audit failure')) : realRecord(tx, event))
    try {
      const response = await post('/api/container-batches', input, key)
      expect({ status: response.status, code: (response.body as { code?: string }).code }).toEqual({ status: 500, code: 'INTERNAL_ERROR' })
    } finally { failure.mockRestore() }
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('UPLOADING')
    expect(await h.prisma.numberingIssuance.count()).toBe(beforeNumbers)
    expect(await h.prisma.containerBatch.count()).toBe(beforeBatches)
    const created = (await post('/api/container-batches', input, key).expect(201)).body as ContainerBatchDto
    expect(created.sourceFileId).toBe(source.id)
    expect((await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('READY')
  })
  it('records one success audit per persisted object and leaves all financial facts untouched', async () => {
    expect(await h.prisma.auditEvent.count({ where: { actorUserId: actorId, eventType: 'CONTAINER_BATCH_CREATED' } })).toBe(await h.prisma.containerBatch.count())
    expect(await h.prisma.auditEvent.count({ where: { actorUserId: actorId, eventType: 'OCEAN_FREIGHT_BILL_CREATED' } })).toBe(await h.prisma.oceanFreightBill.count())
    expect(await h.prisma.fundPostingBatch.count()).toBe(0)
    expect(await h.prisma.fundLedgerEntry.count()).toBe(0)
    expect(await h.prisma.salesOrderPayment.count()).toBe(0)
    expect(await h.prisma.oceanFreightBillCharge.count()).toBe(0)
    expect(fundSpy).not.toHaveBeenCalled()
  })
})
