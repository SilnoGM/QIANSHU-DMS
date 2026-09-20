import { randomUUID } from 'node:crypto'

import request from 'supertest'

import type { Prisma } from '../src/generated/prisma/client'
import { createPackagingCostHarness, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

interface Overview {
  id: string
  containerBatchNo: string
  containerBatchName: string
  loadingDate: string
  warehouseValue: string
  warehouseName: string
  itemCount: number
  myItemCount: number
  grossWeightKgTotal: string | null
  volumeCaiTotal: string | null
}

interface PersonalLine {
  id: string
  goodsName: string
  oceanShippingMarkText: string | null
  codAmountTwd: string | null
  shippingMark: string | null
  salesOrderId: string | null
  salesOrderNo: string | null
  purchaseOrderId: string | null
  purchaseOrderNo: string | null
}

interface Page<T> { items: T[], total: number }

const basePath = '/api/operations/ocean-containers'
const overviewKeys = ['id', 'containerBatchNo', 'containerBatchName', 'loadingDate', 'warehouseValue', 'warehouseName', 'itemCount', 'myItemCount', 'grossWeightKgTotal', 'volumeCaiTotal'].sort()
const personalLineKeys = ['id', 'containerBatchId', 'version', 'lineNumber', 'oceanShippingMarkText', 'goodsName', 'shippingMark', 'salesOrderId', 'salesOrderNo', 'purchaseOrderId', 'purchaseOrderNo', 'recipientName', 'codAmountTwd', 'warehouseReceiptReference', 'recipientPhone', 'recipientAddress', 'packageCount', 'packageUnit', 'grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'volumeCai', 'remark'].sort()
const forbiddenKeys = ['sourceData', 'sourceFileId', 'sourceFile', 'sourceSheetName', 'sourceRowNumber', 'billLines', 'bills', 'creationRequestKey', 'creationPayloadHash', 'createdById', 'updatedById', 'issuerUserId']

describe('operations ocean containers with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  let alice: Awaited<ReturnType<PackagingCostHarness['browserWithPermissions']>>
  let bob: typeof alice, admin: typeof alice, transportReader: typeof alice
  let mixedId: string, incompleteId: string, noPersonalId: string, emptyId: string
  let aliceShipment: Awaited<ReturnType<PackagingCostHarness['shipment']>>
  const ownIds: string[] = [], hiddenIds: string[] = []

  async function createBatch(day: number) {
    return h.prisma.$transaction(async (tx) => {
      const key = randomUUID(), fingerprint = 'a'.repeat(64)
      const issuance = await h.fixture.numbering.generateScopedInTransaction(tx, {
        ruleCode: 'CONTAINER_BATCH_NO', consumerCode: 'CONTAINER_BATCH.CREATE',
        idempotencyKey: key, requestFingerprint: fingerprint,
      })
      return tx.containerBatch.create({ data: {
        containerBatchNo: issuance.number, numberingIssuanceId: issuance.issuanceId,
        containerBatchName: `09${day}柜`, loadingDate: new Date(`2026-09-${day}T00:00:00Z`), sequenceInDay: 1,
        warehouseValue: TEST_DESTINATION_WAREHOUSE, remark: 'INTERNAL_CONTAINER_REMARK',
        creationRequestKey: key, creationPayloadHash: fingerprint,
        createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id,
      } })
    })
  }

  async function createLine(containerBatchId: string, lineNumber: number, data: Partial<Prisma.ContainerLoadingItemUncheckedCreateInput> = {}) {
    // 仅在 harness 随机测试 schema 内种入完整、历史缺值和未匹配明细，避免夹具过滤掉需要验证的边界。
    return h.prisma.containerLoadingItem.create({ data: {
      containerBatchId, lineNumber, creationRequestKey: randomUUID(), creationPayloadHash: 'b'.repeat(64),
      goodsName: `装柜产品-${lineNumber}`, oceanShippingMarkText: `L-${containerBatchId.slice(0, 8)}-${lineNumber}`,
      packageCount: 1, packageUnit: 'CTN', recipientName: '测试收件人', recipientPhone: '0900123456',
      recipientAddress: '测试收件地址', remark: '请提前联系',
      sourceSheetName: 'INTERNAL_SOURCE_SHEET', sourceRowNumber: lineNumber + 5,
      sourceData: { privateMarker: 'INTERNAL_SOURCE_DATA' },
      createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id, ...data,
    } })
  }

  beforeAll(async () => {
    h = await createPackagingCostHarness()
    await h.app.listen(0, '127.0.0.1')
    alice = await h.browserWithPermissions(['sales-orders:read'])
    bob = await h.browserWithPermissions(['sales-orders:read'])
    admin = await h.browserWithPermissions(['sales-orders:read', 'container-batches:read'])
    transportReader = await h.browserWithPermissions(['container-batches:read'])
    const systemRole = await h.prisma.role.findUniqueOrThrow({ where: { code: 'system_admin' } })
    await h.prisma.userRole.create({ data: { userId: admin.user.id, roleId: systemRole.id } })

    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, {
      ruleCode: 'CONTAINER_BATCH_NO', purpose: 'BUSINESS', name: '柜次编号', resetPolicy: 'NEVER',
      segments: [{ type: 'FIXED', value: 'CB' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
    })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })

    aliceShipment = await h.shipment({ salesLinked: true, ownerUserId: alice.user.id })
    const bobShipment = await h.shipment({ salesLinked: true, ownerUserId: bob.user.id })
    const stockShipment = await h.shipment({ salesLinked: false })
    const incompleteShipment = await h.shipment({ salesLinked: true, ownerUserId: alice.user.id })
    mixedId = (await createBatch(20)).id
    incompleteId = (await createBatch(19)).id
    noPersonalId = (await createBatch(18)).id
    emptyId = (await createBatch(17)).id

    const ownValues = [
      { grossWeightKg: '1173', volumeCai: '150.12345678', codAmountTwd: '0' },
      { grossWeightKg: '180', volumeCai: '12.88272063', codAmountTwd: null, packageCount: 10, oceanShippingMarkText: 'L-010831-01~10' },
      { grossWeightKg: '47', volumeCai: '7.10000001', codAmountTwd: '2500.12' },
    ]
    for (const [index, data] of ownValues.entries()) {
      ownIds.push((await createLine(mixedId, index + 1, { shipmentId: aliceShipment.part.id, ...data })).id)
    }
    for (const [index, data] of [
      { shipmentId: bobShipment.part.id, grossWeightKg: '400', volumeCai: '20' },
      { shipmentId: stockShipment.part.id, grossWeightKg: '200', volumeCai: '10.99999999' },
      { shipmentId: null, grossWeightKg: '50', volumeCai: '5.12345678' },
    ].entries()) {
      hiddenIds.push((await createLine(mixedId, index + 4, data)).id)
    }
    await createLine(incompleteId, 1, { shipmentId: incompleteShipment.part.id, grossWeightKg: null, volumeCai: '9' })
    await createLine(incompleteId, 2, { grossWeightKg: '20', volumeCai: null })
    await createLine(noPersonalId, 1, { grossWeightKg: '12', volumeCai: '1' })
  })

  afterAll(async () => { await h?.dispose() })

  it('requires authentication and sales read permission on every read entry point', async () => {
    const paths = [basePath, `${basePath}/${mixedId}/items`, `${basePath}/${mixedId}/items/${ownIds[0]}`]
    for (const path of paths) {
      await request(h.app.getHttpServer()).get(path).expect(401)
      await transportReader.browser.get(path).expect(403)
      await alice.browser.get(path).expect(200)
    }
  })

  it('returns all container overviews with whole-container totals, personal counts, and a strict public field list', async () => {
    const result = (await alice.browser.get(basePath).expect(200)).body as Page<Overview>
    expect(result.total).toBe(4)
    expect(result.items.map(item => item.id)).toEqual([mixedId, incompleteId, noPersonalId, emptyId])
    for (const item of result.items) expect(Object.keys(item).sort()).toEqual(overviewKeys)
    expect(result.items[0]).toMatchObject({
      itemCount: 6, myItemCount: 3, loadingDate: '2026-09-20', warehouseValue: TEST_DESTINATION_WAREHOUSE,
      grossWeightKgTotal: '2050.000', volumeCaiTotal: '206.22963419',
    })
    expect(result.items[1]).toMatchObject({ itemCount: 2, myItemCount: 1, grossWeightKgTotal: null, volumeCaiTotal: null })
    expect(result.items[2]).toMatchObject({ itemCount: 1, myItemCount: 0, grossWeightKgTotal: '12.000', volumeCaiTotal: '1.00000000' })
    expect(result.items[3]).toMatchObject({ itemCount: 0, myItemCount: 0, grossWeightKgTotal: '0.000', volumeCaiTotal: '0.00000000' })
    expect(result.items[0].warehouseName).toBeTruthy()
    const first = (await alice.browser.get(basePath).query({ page: 1, pageSize: 2 }).expect(200)).body as Page<Overview>
    const second = (await alice.browser.get(basePath).query({ page: 2, pageSize: 2 }).expect(200)).body as Page<Overview>
    expect(first.total).toBe(4)
    expect(second.total).toBe(4)
    expect([...first.items, ...second.items].map(item => item.id)).toEqual(result.items.map(item => item.id))
  })

  it('counts and paginates only sales-owned lines while preserving grouped ocean marks and zero versus missing COD', async () => {
    const path = `${basePath}/${mixedId}/items`
    const all = (await alice.browser.get(path).expect(200)).body as Page<PersonalLine>
    expect(all.total).toBe(3)
    expect(all.items.map(item => item.id)).toEqual(ownIds)
    expect(all.items.map(item => item.codAmountTwd)).toEqual(['0.00', null, '2500.12'])
    expect(all.items[1].oceanShippingMarkText).toBe('L-010831-01~10')
    for (const item of all.items) {
      expect(Object.keys(item).sort()).toEqual(personalLineKeys)
      expect(item.salesOrderNo).toBe(aliceShipment.source!.orderNo)
      expect(item.salesOrderId).toBe(aliceShipment.source!.id)
      expect(item.purchaseOrderNo).toBe(aliceShipment.order.orderNo)
      expect(item.purchaseOrderId).toBe(aliceShipment.order.id)
      for (const key of forbiddenKeys) expect(item).not.toHaveProperty(key)
    }
    const second = (await alice.browser.get(path).query({ page: 2, pageSize: 2 }).expect(200)).body as Page<PersonalLine>
    expect(second.total).toBe(3)
    expect(second.items.map(item => item.id)).toEqual([ownIds[2]])
    const beyond = (await alice.browser.get(path).query({ page: 3, pageSize: 2 }).expect(200)).body as Page<PersonalLine>
    expect(beyond).toMatchObject({ total: 3, items: [] })
    for (const id of [noPersonalId, emptyId]) {
      expect((await alice.browser.get(`${basePath}/${id}/items`).expect(200)).body as Page<PersonalLine>)
        .toMatchObject({ total: 0, items: [] })
    }
  })

  it('uses the authenticated sales owner for each user including the system administrator', async () => {
    const bobList = (await bob.browser.get(basePath).expect(200)).body as Page<Overview>
    expect(bobList.items.find(item => item.id === mixedId)?.myItemCount).toBe(1)
    expect(bobList.items.find(item => item.id === mixedId)?.itemCount).toBe(6)
    const bobItems = (await bob.browser.get(`${basePath}/${mixedId}/items`).expect(200)).body as Page<PersonalLine>
    expect(bobItems.total).toBe(1)
    expect(bobItems.items.map(item => item.id)).toEqual([hiddenIds[0]])
    const adminList = (await admin.browser.get(basePath).expect(200)).body as Page<Overview>
    expect(adminList.items.every(item => item.myItemCount === 0)).toBe(true)
    expect((await admin.browser.get(`${basePath}/${mixedId}/items`).expect(200)).body as Page<PersonalLine>)
      .toMatchObject({ total: 0, items: [] })
    await admin.browser.get(`${basePath}/${mixedId}/items/${ownIds[0]}`).expect(404)
  })

  it('returns a personal detail and rejects other-owner, unmatched, stock, unknown, and cross-container IDs', async () => {
    const detail = (await alice.browser.get(`${basePath}/${mixedId}/items/${ownIds[0]}`).expect(200)).body as PersonalLine
    expect(detail).toMatchObject({
      id: ownIds[0], shippingMark: aliceShipment.part.shippingMarkText, codAmountTwd: '0.00',
      salesOrderId: aliceShipment.source!.id, salesOrderNo: aliceShipment.source!.orderNo,
      purchaseOrderId: aliceShipment.order.id, purchaseOrderNo: aliceShipment.order.orderNo,
      recipientName: '测试收件人',
      recipientPhone: '0900123456', recipientAddress: '测试收件地址', remark: '请提前联系',
    })
    expect(Object.keys(detail).sort()).toEqual(personalLineKeys)
    for (const key of forbiddenKeys) expect(detail).not.toHaveProperty(key)
    for (const itemId of [...hiddenIds, randomUUID()]) {
      await alice.browser.get(`${basePath}/${mixedId}/items/${itemId}`).expect(404)
    }
    await alice.browser.get(`${basePath}/${emptyId}/items/${ownIds[0]}`).expect(404)
    await alice.browser.get(`${basePath}/${randomUUID()}/items/${ownIds[0]}`).expect(404)
    await alice.browser.get(`${basePath}/${randomUUID()}/items`).expect(404)
    await bob.browser.get(`${basePath}/${mixedId}/items/${ownIds[0]}`).expect(404)
  })

  it('rejects client-supplied owner filters instead of widening access', async () => {
    for (const path of [basePath, `${basePath}/${mixedId}/items`]) {
      await alice.browser.get(path).query({ issuerUserId: bob.user.id }).expect(422)
      await alice.browser.get(path).query({ ownerUserId: bob.user.id }).expect(422)
    }
  })

  it('does not change container versions, accounting, or audit records through reads', async () => {
    const facts = async () => ({
      batches: await h.prisma.containerBatch.findMany({ select: { id: true, version: true }, orderBy: { id: 'asc' } }),
      items: await h.prisma.containerLoadingItem.count(), audits: await h.prisma.auditEvent.count(),
      fundBatches: await h.prisma.fundPostingBatch.count(), ledger: await h.prisma.fundLedgerEntry.count(),
    })
    const before = await facts()
    await alice.browser.get(basePath).expect(200)
    await alice.browser.get(`${basePath}/${mixedId}/items`).expect(200)
    await alice.browser.get(`${basePath}/${mixedId}/items/${ownIds[0]}`).expect(200)
    expect(await facts()).toEqual(before)
    expect(before.fundBatches).toBe(0)
    expect(before.ledger).toBe(0)
  })

  it('immediately revokes detail and list access when sales ownership changes', async () => {
    await h.prisma.salesOrder.update({ where: { id: aliceShipment.source!.id }, data: { issuerUserId: bob.user.id } })
    await alice.browser.get(`${basePath}/${mixedId}/items/${ownIds[0]}`).expect(404)
    expect((await alice.browser.get(`${basePath}/${mixedId}/items`).expect(200)).body as Page<PersonalLine>)
      .toMatchObject({ total: 0, items: [] })
    const aliceList = (await alice.browser.get(basePath).expect(200)).body as Page<Overview>
    expect(aliceList.items.find(item => item.id === mixedId)?.myItemCount).toBe(0)
    await bob.browser.get(`${basePath}/${mixedId}/items/${ownIds[0]}`).expect(200)
    expect((await bob.browser.get(`${basePath}/${mixedId}/items`).expect(200)).body as Page<PersonalLine>).toMatchObject({ total: 4 })
  })
})
