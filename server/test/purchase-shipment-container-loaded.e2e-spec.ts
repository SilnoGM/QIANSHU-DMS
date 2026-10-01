import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import type { ContainerImportPreviewDto } from '../src/modules/container-batches/container-import.dto'
import type { ContainerSourceFileDto } from '../src/modules/container-batches/container-source-file.dto'
import type { PurchaseShipmentPageDto, PurchaseShipmentStatusCountsDto } from '../src/modules/purchase-orders/shipments/purchase-shipment.dto'
import { containerImportHeader, containerImportRow, createContainerImportFixture } from './fixtures/container-import.fixture'
import { createOceanXlsxFixture } from './fixtures/ocean-freight-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['container-batches:read', 'container-batches:create', 'container-batches:update', 'purchase-orders:read']
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 关联即已装柜：覆盖新关联、幂等、解除不回退、未到仓门槛与视图计数五类情形。 */
describe('shipment container loading fact over isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness, browser: ReturnType<typeof request.agent>, receiptBrowser: ReturnType<typeof request.agent>
  let actorUserId: string
  let sequence = 50
  const post = (url: string, body: object) => browser.post(url).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(body)
  const patch = (url: string, body: object) => browser.patch(url).set(packagingHeaders).send(body)
  const reference = async <T>(url: string): Promise<T> => (await browser.get(url).expect(200)).body as T
  const upload = async (bytes: Buffer) => (await browser.post('/api/container-batches/source-file-uploads').set(packagingHeaders)
    .field('mediaType', 'DOCUMENT').attach('file', bytes, { filename: '装柜资料.xlsx', contentType: mime }).expect(201)).body as ContainerSourceFileDto
  async function batch(name = `0917-${String(++sequence).padStart(2, '0')}柜`) {
    const source = await upload(createOceanXlsxFixture())
    return (await post('/api/container-batches', { containerBatchName: name, warehouseValue: TEST_DESTINATION_WAREHOUSE, sourceFileId: source.mediaAssetId }).expect(201)).body as ContainerBatchDto
  }
  async function item(parentId: string, extra: object) {
    const parent = await reference<ContainerBatchDto>(`/api/container-batches/${parentId}`)
    return (await post(`/api/container-batches/${parentId}/items`, { expectedVersion: parent.version, goodsName: '履带', packageCount: 10, ...extra }).expect(201)).body as ContainerLoadingItemDto
  }
  async function fact(partId: string) {
    const row = await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: partId } })
    return { loadedAt: row.loadedAt?.toISOString() ?? null, loadedById: row.loadedById, loadedRecordedAt: row.loadedRecordedAt?.toISOString() ?? null }
  }
  const unloaded = { loadedAt: null, loadedById: null, loadedRecordedAt: null }
  const loadEvents = (partId: string) => h.prisma.auditEvent.count({ where: { eventType: 'PURCHASE_SHIPMENT_CONTAINER_LOADED', targetId: partId } })
  const loadedCount = async () => {
    const counts = (await reference<PurchaseShipmentStatusCountsDto>('/api/purchase-order-parts/status-counts'))
    return counts.items.find(entry => entry.value === 'CONTAINER_LOADED')?.count
  }
  const salesStatus = async (salesOrderId: string) => (await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId }, select: { fulfillmentStatus: true } })).fulfillmentStatus
  const loadEventsOfOrder = (salesOrderId: string) => h.prisma.auditEvent.count({ where: {
    eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', targetId: salesOrderId, metadata: { path: ['trigger'], equals: 'CONTAINER_LOAD' },
  } })

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    const session = await h.browserWithPermissions(permissions)
    browser = session.browser
    actorUserId = session.user.id
    receiptBrowser = (await h.browserWithPermissions(['purchase-orders:read', 'purchase-orders:update'])).browser
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, { ruleCode: 'CONTAINER_BATCH_NO', purpose: 'BUSINESS', name: '柜次', resetPolicy: 'NEVER', segments: [{ type: 'FIXED', value: 'CB' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
  })
  afterAll(async () => { await h?.dispose() })

  it('marks the shipment on the first association, stays idempotent and never reverts', async () => {
    const parent = await batch(), shipment = await h.shipment({ salesLinked: true })
    const before = await loadedCount()
    expect(await fact(shipment.part.id)).toEqual(unloaded)
    const first = await item(parent.id, { shipmentId: shipment.part.id })
    const marked = await fact(shipment.part.id)
    expect(marked).toMatchObject({ loadedById: actorUserId })
    expect(marked.loadedAt).not.toBeNull()
    expect(marked.loadedRecordedAt).not.toBeNull()
    expect(await loadEvents(shipment.part.id)).toBe(1)

    // 同柜再挂一行以及原行重存都不得改写事实或重复记审计。
    const second = await item(parent.id, { shipmentId: shipment.part.id })
    await patch(`/api/container-batches/${parent.id}/items/${second.id}`, { expectedVersion: (await reference<ContainerBatchDto>(`/api/container-batches/${parent.id}`)).version, itemExpectedVersion: second.version, shipmentId: shipment.part.id, goodsName: '履带', packageCount: 12 })
    expect(await fact(shipment.part.id)).toEqual(marked)
    expect(await loadEvents(shipment.part.id)).toBe(1)

    const listed = (await browser.get('/api/purchase-order-parts').query({ view: 'CONTAINER_LOADED', keyword: shipment.part.shipmentNo! }).expect(200)).body as PurchaseShipmentPageDto
    expect(listed.total).toBe(1)
    expect(listed.items[0]).toMatchObject({ id: shipment.part.id, viewStatus: 'CONTAINER_LOADED', loadedAt: marked.loadedAt, loadedBy: { id: actorUserId }, warehouseReceivedAt: expect.any(String) as unknown })
    expect(await loadedCount()).toBe(before! + 1)

    // 解除关联与换绑都不回退：事实保留、视图仍在已装柜。
    const parentVersion = (await reference<ContainerBatchDto>(`/api/container-batches/${parent.id}`)).version
    const cleared = (await patch(`/api/container-batches/${parent.id}/items/${first.id}`, { expectedVersion: parentVersion, itemExpectedVersion: first.version, goodsName: '履带', packageCount: 10 }).expect(200)).body as ContainerLoadingItemDto
    expect(cleared.shipmentId).toBeNull()
    expect(await fact(shipment.part.id)).toEqual(marked)
    expect((await browser.get('/api/purchase-order-parts').query({ view: 'CONTAINER_LOADED', keyword: shipment.part.shipmentNo! }).expect(200)).body as PurchaseShipmentPageDto).toMatchObject({ total: 1 })
  })

  it('keeps the container loading fact write-once at the database level', async () => {
    const parent = await batch(), shipment = await h.shipment()
    await item(parent.id, { shipmentId: shipment.part.id })
    const marked = await fact(shipment.part.id)
    await expect(h.prisma.$executeRaw`UPDATE purchase_order_parts SET loaded_at = NULL WHERE id = ${shipment.part.id}::uuid`).rejects.toThrow(/Purchase part configuration is immutable/u)
    await expect(h.prisma.$executeRaw`UPDATE purchase_order_parts SET loaded_recorded_at = clock_timestamp(), loaded_by_id = NULL WHERE id = ${shipment.part.id}::uuid`).rejects.toThrow(/Purchase part configuration is immutable/u)
    expect(await fact(shipment.part.id)).toEqual(marked)

    // 绕过服务端直写关联同样被拒绝：装柜事实必须先于关联存在。
    const unreceived = await h.shipment({ received: false })
    await expect(h.prisma.containerLoadingItem.create({ data: {
      containerBatchId: parent.id, shipmentId: unreceived.part.id, lineNumber: 9001, goodsName: '绕过服务端', packageCount: 1,
      creationRequestKey: randomUUID(), creationPayloadHash: 'f'.repeat(64), createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id,
    } })).rejects.toThrow(/Shipment must record the container loading fact before allocation/u)
    expect(await fact(unreceived.part.id)).toEqual(unloaded)
  })

  it('rejects container loading before the shipment is warehouse-received on every entry', async () => {
    const parent = await batch(), unreceived = await h.shipment({ received: false })
    const created = await post(`/api/container-batches/${parent.id}/items`, { expectedVersion: parent.version, goodsName: '履带', packageCount: 1, shipmentId: unreceived.part.id }).expect(422)
    expect(created.body as { code: string }).toMatchObject({ code: 'CONTAINER_SHIPMENT_NOT_RECEIVED' })

    const row = await item(parent.id, {})
    const rejected = await patch(`/api/container-batches/${parent.id}/items/${row.id}`, { expectedVersion: (await reference<ContainerBatchDto>(`/api/container-batches/${parent.id}`)).version, itemExpectedVersion: row.version, shipmentId: unreceived.part.id, goodsName: '履带', packageCount: 1 }).expect(422)
    expect(rejected.body as { code: string }).toMatchObject({ code: 'CONTAINER_SHIPMENT_NOT_RECEIVED' })

    // 导入侧：预览标注不可选，确认仍按同一错误码拒绝。
    const name = `0917-${String(++sequence).padStart(2, '0')}柜`
    const source = await upload(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + containerImportRow(3, { A: name, B: unreceived.part.shippingMarkText!, C: 'OCEAN-GATE' }) }] }))
    const importing = (await post('/api/container-batches', { containerBatchName: name, warehouseValue: TEST_DESTINATION_WAREHOUSE, sourceFileId: source.mediaAssetId }).expect(201)).body as ContainerBatchDto
    const preview = (await browser.get(`/api/container-batches/${importing.id}/import-preview`).expect(200)).body as { expectedVersion: number, sourceFileId: string, sourceHash: string, rows: Array<{ rowKey: string, candidates: Array<{ id: string, eligible: boolean, ineligibleReason: string | null }> }> }
    expect(preview.rows[0].candidates[0]).toMatchObject({ id: unreceived.part.id, eligible: false, ineligibleReason: expect.stringContaining('尚未到仓') as unknown })
    const confirmed = await post(`/api/container-batches/${importing.id}/import`, { expectedVersion: preview.expectedVersion, sourceFileId: preview.sourceFileId, sourceHash: preview.sourceHash, allowUnmatched: false, rows: [{ rowKey: preview.rows[0].rowKey, shipmentId: unreceived.part.id }] }).expect(422)
    expect(confirmed.body as { code: string }).toMatchObject({ code: 'CONTAINER_SHIPMENT_NOT_RECEIVED' })
    expect(await fact(unreceived.part.id)).toEqual(unloaded)
    expect(await h.prisma.containerLoadingItem.count({ where: { shipmentId: unreceived.part.id } })).toBe(0)
  })

  it('partitions every view exactly once after loading a received shipment', async () => {
    const parent = await batch(), shipment = await h.shipment()
    const before = (await reference<PurchaseShipmentStatusCountsDto>('/api/purchase-order-parts/status-counts')).items
    await item(parent.id, { shipmentId: shipment.part.id })
    const after = (await reference<PurchaseShipmentStatusCountsDto>('/api/purchase-order-parts/status-counts')).items
    const delta = new Map(after.map(entry => [entry.value, entry.count - (before.find(prior => prior.value === entry.value)?.count ?? 0)]))
    // 计数口径与列表谓词一致：装柜只把货件从「已到仓」搬到「已装柜」，不影响其它视图。
    expect(delta.get('CONTAINER_LOADED')).toBe(1)
    expect(delta.get('WAREHOUSE_RECEIVED')).toBe(-1)
    expect(delta.get('AWAITING_SHIPMENT')).toBe(0)
    expect(delta.get('SHIPPED')).toBe(0)
    expect(delta.get('PENDING_REVIEW')).toBe(0)
    expect(delta.get('CANCELLED')).toBe(0)
    const received = (await browser.get('/api/purchase-order-parts').query({ view: 'WAREHOUSE_RECEIVED', keyword: shipment.part.shipmentNo! }).expect(200)).body as PurchaseShipmentPageDto
    expect(received.total).toBe(0)
  })

  it('advances the sales order only after every shipment is loaded, and never reverts', async () => {
    const parent = await batch(), order = await h.shipment({ partCount: 2, salesLinked: true })
    const salesOrderId = order.source!.id, [first, second] = order.parts
    // 入仓已把订单推进到待装柜；单个货件装柜不足以推进。
    expect(await salesStatus(salesOrderId)).toBe('WAREHOUSE_ARRIVED')
    await item(parent.id, { shipmentId: first.id })
    expect(await salesStatus(salesOrderId)).toBe('WAREHOUSE_ARRIVED')

    await item(parent.id, { shipmentId: second.id })
    expect(await salesStatus(salesOrderId)).toBe('SEA_TRANSIT')
    expect(await h.prisma.salesOrderStatusHistory.count({ where: { salesOrderId, dimension: 'FULFILLMENT', toStatus: 'SEA_TRANSIT' } })).toBe(1)
    expect(await h.prisma.salesOrderStatusHistory.findFirstOrThrow({ where: { salesOrderId, toStatus: 'SEA_TRANSIT' } })).toMatchObject({ fromStatus: 'WAREHOUSE_ARRIVED' })
    expect(await loadEventsOfOrder(salesOrderId)).toBe(1)

    // 幂等：已推进后再关联同一货件不重复推进、不重复记审计。
    await item(parent.id, { shipmentId: second.id })
    expect(await h.prisma.salesOrderStatusHistory.count({ where: { salesOrderId, toStatus: 'SEA_TRANSIT' } })).toBe(1)
    expect(await loadEventsOfOrder(salesOrderId)).toBe(1)

    // 不回退：解除关联后销售订单保持海运在途。
    const items = (await browser.get(`/api/container-batches/${parent.id}/items`).expect(200)).body as { items: ContainerLoadingItemDto[] }
    const target = items.items.find(entry => entry.shipmentId === second.id)!
    const batchVersion = (await reference<ContainerBatchDto>(`/api/container-batches/${parent.id}`)).version
    await patch(`/api/container-batches/${parent.id}/items/${target.id}`, { expectedVersion: batchVersion, itemExpectedVersion: target.version, goodsName: '履带', packageCount: 10 }).expect(200)
    expect(await salesStatus(salesOrderId)).toBe('SEA_TRANSIT')
    expect(await fact(second.id)).not.toEqual(unloaded)
  })

  it('keeps the order in warehouse-arrived when the sales lines are no longer covered', async () => {
    const parent = await batch(), order = await h.shipment({ partCount: 2, salesLinked: true })
    const salesOrderId = order.source!.id
    // 入仓后销售明细被改量或追加，覆盖判断必须在装柜时按持锁现状重算（单价 10，行/订单金额同步调整）。
    await h.prisma.$transaction(async transaction => {
      await transaction.salesOrderLine.updateMany({ where: { salesOrderId }, data: { quantity: 3, lineTotalAmount: '30' } })
      await transaction.salesOrder.update({ where: { id: salesOrderId }, data: { lineSubtotalAmount: '30', agreedTotalAmount: '30', balanceDueAmount: '30' } })
    })
    await item(parent.id, { shipmentId: order.parts[0].id })
    await item(parent.id, { shipmentId: order.parts[1].id })
    expect(await salesStatus(salesOrderId)).toBe('WAREHOUSE_ARRIVED')
    expect(await loadEventsOfOrder(salesOrderId)).toBe(0)
  })

  it('advances every sales order touched by one bulk import', async () => {
    const first = await h.shipment({ salesLinked: true }), second = await h.shipment({ salesLinked: true })
    const name = `0917-${String(++sequence).padStart(2, '0')}柜`
    const source = await upload(createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader()
      + containerImportRow(3, { A: name, B: first.part.shippingMarkText!, C: 'OCEAN-BULK-A' })
      + containerImportRow(4, { A: name, B: second.part.shippingMarkText!, C: 'OCEAN-BULK-B' }) }] }))
    const importing = (await post('/api/container-batches', { containerBatchName: name, warehouseValue: TEST_DESTINATION_WAREHOUSE, sourceFileId: source.mediaAssetId }).expect(201)).body as ContainerBatchDto
    const preview = (await browser.get(`/api/container-batches/${importing.id}/import-preview`).expect(200)).body as ContainerImportPreviewDto
    expect(preview.rows.map(row => row.matchedShipmentId).sort()).toEqual([first.part.id, second.part.id].sort())
    await post(`/api/container-batches/${importing.id}/import`, {
      expectedVersion: preview.expectedVersion, sourceFileId: preview.sourceFileId, sourceHash: preview.sourceHash, allowUnmatched: false,
      rows: preview.rows.map(row => ({ rowKey: row.rowKey, shipmentId: row.matchedShipmentId })),
    }).expect(200)
    // 一次导入同时推进两个销售订单。
    expect(await salesStatus(first.source!.id)).toBe('SEA_TRANSIT')
    expect(await salesStatus(second.source!.id)).toBe('SEA_TRANSIT')
    expect(await loadEventsOfOrder(first.source!.id)).toBe(1)
    expect(await loadEventsOfOrder(second.source!.id)).toBe(1)
  })

  it('serializes a container load racing the last warehouse receipt', async () => {
    const parent = await batch(), order = await h.shipment({ partCount: 2, salesLinked: true, received: false })
    const salesOrderId = order.source!.id, [first, second] = order.parts
    const purchaseOrderId = order.order.id
    const purchaseVersion = async () => (await h.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { version: true } })).version
    const receive = async (partIds: string[]) => receiptBrowser.post(`/api/purchase-orders/${purchaseOrderId}/warehouse-receipts`).set(packagingHeaders)
      .send({ expectedVersion: await purchaseVersion(), partIds })
    expect((await receive([first.id])).status).toBe(200)
    expect(await salesStatus(salesOrderId)).toBe('LAND_TRANSIT')

    // 一个货件装柜与最后一个货件入仓并发：两侧都按同一把销售链条锁串行，不能死锁。
    const version = (await reference<ContainerBatchDto>(`/api/container-batches/${parent.id}`)).version
    const [loaded, received] = await Promise.all([
      post(`/api/container-batches/${parent.id}/items`, { expectedVersion: version, goodsName: '履带', packageCount: 10, shipmentId: first.id }),
      receive([second.id]),
    ])
    expect([loaded.status, received.status]).toEqual([201, 200])
    // 入仓推进到待装柜；此时只有第一个货件装柜，海运在途需要再装第二个。
    expect(await salesStatus(salesOrderId)).toBe('WAREHOUSE_ARRIVED')
    await item(parent.id, { shipmentId: second.id })
    expect(await salesStatus(salesOrderId)).toBe('SEA_TRANSIT')
  })
})
