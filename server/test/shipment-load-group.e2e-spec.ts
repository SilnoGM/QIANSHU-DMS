import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import type { ContainerSourceFileDto } from '../src/modules/container-batches/container-source-file.dto'
import type { PurchaseShipmentPageDto } from '../src/modules/purchase-orders/shipments/purchase-shipment.dto'
import type { ShipmentLoadGroupDto } from '../src/modules/purchase-orders/shipments/shipment-load-group.dto'
import { createOceanXlsxFixture } from './fixtures/ocean-freight-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['container-batches:read', 'container-batches:create', 'container-batches:update', 'purchase-orders:read', 'purchase-orders:update']
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 装柜合并组：两个同单货件按一票装柜、解绑回退、释放与跨单拒绝。 */
describe('shipment load group over isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness, browser: ReturnType<typeof request.agent>
  let sequence = 60

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, { ruleCode: 'CONTAINER_BATCH_NO', purpose: 'BUSINESS', name: '柜次', resetPolicy: 'NEVER', segments: [{ type: 'FIXED', value: 'CB' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
  })
  afterAll(async () => { await h?.dispose() })

  async function batch(): Promise<ContainerBatchDto> {
    const upload = await browser.post('/api/container-batches/source-file-uploads').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT')
      .attach('file', createOceanXlsxFixture(), { filename: '装柜资料.xlsx', contentType: mime })
      .expect(201)
    const source = upload.body as ContainerSourceFileDto
    const created = await browser.post('/api/container-batches')
      .set(packagingHeaders)
      .set('Idempotency-Key', randomUUID())
      .send({
        containerBatchName: `1102-${String(++sequence).padStart(2, '0')}柜`,
        warehouseValue: TEST_DESTINATION_WAREHOUSE,
        sourceFileId: source.mediaAssetId,
      })
      .expect(201)
    return created.body as ContainerBatchDto
  }

  async function createItem(parentId: string, shipmentId: string): Promise<ContainerLoadingItemDto> {
    const parent = (await browser.get(`/api/container-batches/${parentId}`).expect(200)).body as ContainerBatchDto
    const response = await browser.post(`/api/container-batches/${parentId}/items`)
      .set(packagingHeaders)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedVersion: parent.version,
        goodsName: '履带',
        packageCount: 10,
        shipmentId,
      })
      .expect(201)
    return response.body as ContainerLoadingItemDto
  }

  function createGroup(shipmentIds: string[], primaryShipmentId: string) {
    return browser.post('/api/purchase-order-parts/load-groups').set(packagingHeaders).send({
      shipmentIds,
      primaryShipmentId,
      requestKey: randomUUID(),
    })
  }

  it('loads both members under the primary shipment and reverses both on unbind', async () => {
    const shipment = await h.shipment({ salesLinked: true, partCount: 2 })
    const [primary, member] = shipment.parts
    const group = (await createGroup([primary.id, member.id], primary.id).expect(200)).body as ShipmentLoadGroupDto
    expect(group.members).toHaveLength(2)
    expect(group.primaryShipmentId).toBe(primary.id)

    const parent = await batch()
    const row = await createItem(parent.id, member.id)
    // 选成员也归一到主货件，装柜行只保存主货件。
    expect(row.shipmentId).toBe(primary.id)
    const loaded = await h.prisma.purchaseOrderPart.findMany({ where: { id: { in: [primary.id, member.id] } }, select: { loadedAt: true } })
    expect(loaded.every(part => part.loadedAt !== null)).toBe(true)

    const page = (await browser.get('/api/purchase-order-parts').query({ view: 'ALL', pageSize: 100 }).expect(200)).body as PurchaseShipmentPageDto
    expect(page.items.find(item => item.id === member.id)).toMatchObject({
      containerBatch: { id: parent.id },
      loadGroup: { id: group.id, primaryShipmentId: primary.id },
    })

    const currentParent = (await browser.get(`/api/container-batches/${parent.id}`).expect(200)).body as ContainerBatchDto
    await browser.patch(`/api/container-batches/${parent.id}/items/${row.id}`).set(packagingHeaders).send({
      expectedVersion: currentParent.version,
      itemExpectedVersion: row.version,
      goodsName: '履带',
      packageCount: 10,
    }).expect(200)
    const unloaded = await h.prisma.purchaseOrderPart.findMany({ where: { id: { in: [primary.id, member.id] } }, select: { loadedAt: true } })
    expect(unloaded.every(part => part.loadedAt === null)).toBe(true)
  })

  it('releases an unloaded group and removes active memberships', async () => {
    const shipment = await h.shipment({ salesLinked: true, partCount: 2 })
    const [primary, member] = shipment.parts
    const group = (await createGroup([primary.id, member.id], primary.id).expect(200)).body as ShipmentLoadGroupDto
    const released = (await browser.post(`/api/purchase-order-parts/load-groups/${group.id}/release`).set(packagingHeaders).send({
      expectedVersion: group.version,
      reason: '测试撤销',
    }).expect(200)).body as ShipmentLoadGroupDto
    expect(released.status).toBe('RELEASED')
    expect(await h.prisma.shipmentLoadGroupMember.count({ where: { groupId: group.id, active: true } })).toBe(0)
  })

  it('rejects grouping shipments from different purchase orders', async () => {
    const first = await h.shipment({ salesLinked: true })
    const second = await h.shipment({ salesLinked: true })
    const response = await createGroup([first.part.id, second.part.id], first.part.id).expect(422)
    expect(response.body).toMatchObject({ code: 'SHIPMENT_LOAD_GROUP_NOT_ALLOWED' })
  })
})
