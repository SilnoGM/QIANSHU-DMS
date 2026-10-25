import { randomUUID } from 'node:crypto'

import request from 'supertest'

import type { Prisma } from '../src/generated/prisma/client'
import { markShipmentsContainerLoaded } from './fixtures/container-loaded.fixture'
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

interface AllLine extends PersonalLine {
  mine: boolean
}

interface Page<T> { items: T[], total: number }
interface OverviewPage extends Page<Overview> { dataScope: 'SELF' | 'ALL' }

const basePath = '/api/operations/ocean-containers'
const overviewKeys = ['id', 'containerBatchNo', 'containerBatchName', 'loadingDate', 'warehouseValue', 'warehouseName', 'itemCount', 'myItemCount', 'grossWeightKgTotal', 'volumeCaiTotal'].sort()
// shipmentNo 是「可查看采购」的查看者才拿到的辅助字段（货件唛头下的 PKG 编号），DTO 增列后这里必须同步。
const personalLineKeys = ['id', 'containerBatchId', 'version', 'lineNumber', 'oceanShippingMarkText', 'goodsName', 'shippingMark', 'shipmentNo', 'salesOrderId', 'salesOrderNo', 'purchaseOrderId', 'purchaseOrderNo', 'recipientName', 'codAmountTwd', 'warehouseReceiptReference', 'recipientPhone', 'recipientAddress', 'packageCount', 'packageUnit', 'grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'volumeCai', 'remark'].sort()
const allLineKeys = [...personalLineKeys, 'mine'].sort()
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
    await markShipmentsContainerLoaded(h.prisma, data.shipmentId ? [data.shipmentId] : [], h.fixture.actor.id)
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
      { grossWeightKg: '1173', volumeCai: '150.12', codAmountTwd: '0' },
      { grossWeightKg: '180', volumeCai: '12.88', codAmountTwd: null, packageCount: 10, oceanShippingMarkText: 'L-010831-01~10' },
      { grossWeightKg: '47', volumeCai: '7.1', codAmountTwd: '2500.12' },
    ]
    for (const [index, data] of ownValues.entries()) {
      ownIds.push((await createLine(mixedId, index + 1, { shipmentId: aliceShipment.part.id, ...data })).id)
    }
    for (const [index, data] of [
      { shipmentId: bobShipment.part.id, grossWeightKg: '400', volumeCai: '20' },
      { shipmentId: stockShipment.part.id, grossWeightKg: '200', volumeCai: '11' },
      { shipmentId: null, grossWeightKg: '50', volumeCai: '5.12' },
    ].entries()) {
      hiddenIds.push((await createLine(mixedId, index + 4, data)).id)
    }
    await createLine(incompleteId, 1, { shipmentId: incompleteShipment.part.id, grossWeightKg: null, volumeCai: '9' })
    await createLine(incompleteId, 2, { grossWeightKg: '20', volumeCai: null })
    await createLine(noPersonalId, 1, { grossWeightKg: '12', volumeCai: '1' })
  })

  afterAll(async () => { await h?.dispose() })

  it('requires authentication and sales read permission on every read entry point', async () => {
    const paths = [
      basePath,
      `${basePath}/all`,
      `${basePath}/all/${mixedId}/items`,
      `${basePath}/all/${mixedId}/items/${hiddenIds[0]}`,
      `${basePath}/${mixedId}/items`,
      `${basePath}/${mixedId}/items/${ownIds[0]}`,
    ]
    for (const path of paths) {
      await request(h.app.getHttpServer()).get(path).expect(401)
      await transportReader.browser.get(path).expect(403)
      await alice.browser.get(path).expect(200)
    }
  })

  it('returns all container overviews with whole-container totals for ALL scope and a strict public field list', async () => {
    const result = (await alice.browser.get(basePath).expect(200)).body as OverviewPage
    expect(result.dataScope).toBe('ALL')
    expect(result.total).toBe(4)
    expect(result.items.map(item => item.id)).toEqual([mixedId, incompleteId, noPersonalId, emptyId])
    for (const item of result.items) expect(Object.keys(item).sort()).toEqual(overviewKeys)
    expect(result.items[0]).toMatchObject({
      itemCount: 6, myItemCount: 3, loadingDate: '2026-09-20', warehouseValue: TEST_DESTINATION_WAREHOUSE,
      grossWeightKgTotal: '2050', volumeCaiTotal: '206.22',
    })
    expect(result.items[1]).toMatchObject({ itemCount: 2, myItemCount: 1, grossWeightKgTotal: null, volumeCaiTotal: null })
    expect(result.items[2]).toMatchObject({ itemCount: 1, myItemCount: 0, grossWeightKgTotal: '12', volumeCaiTotal: '1.00' })
    expect(result.items[3]).toMatchObject({ itemCount: 0, myItemCount: 0, grossWeightKgTotal: '0', volumeCaiTotal: '0.00' })
    expect(result.items[0].warehouseName).toBeTruthy()
    const first = (await alice.browser.get(basePath).query({ page: 1, pageSize: 2 }).expect(200)).body as OverviewPage
    const second = (await alice.browser.get(basePath).query({ page: 2, pageSize: 2 }).expect(200)).body as OverviewPage
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

  it('filters containers and totals for SELF scope while ALL scope keeps full data', async () => {
    const withoutSelfScope = (await alice.browser.get(basePath).expect(200)).body as OverviewPage
    expect(withoutSelfScope.dataScope).toBe('ALL')
    expect(withoutSelfScope.total).toBe(4)

    const selfScope = await h.prisma.permission.findUniqueOrThrow({ where: { code: 'data-scope:self' }, select: { id: true } })
    await h.prisma.rolePermission.create({ data: { roleId: alice.role.id, permissionId: selfScope.id } })
    try {
      const result = (await alice.browser.get(basePath).expect(200)).body as OverviewPage
      expect(result.dataScope).toBe('SELF')
      expect(result.total).toBe(2)
      expect(result.items.map(item => item.id)).toEqual([mixedId, incompleteId])
      expect(result.items.every(item => item.myItemCount > 0)).toBe(true)
      // SELF 的合计取本人明细：mixedId 的 3 行完整；incompleteId 的本人行缺毛重。
      expect(result.items[0]).toMatchObject({ itemCount: 6, myItemCount: 3, grossWeightKgTotal: '1400', volumeCaiTotal: '170.10' })
      expect(result.items[1]).toMatchObject({ itemCount: 2, myItemCount: 1, grossWeightKgTotal: null, volumeCaiTotal: '9.00' })
      const first = (await alice.browser.get(basePath).query({ page: 1, pageSize: 1 }).expect(200)).body as OverviewPage
      const second = (await alice.browser.get(basePath).query({ page: 2, pageSize: 1 }).expect(200)).body as OverviewPage
      expect(first.total).toBe(2)
      expect(second.total).toBe(2)
      expect([...first.items, ...second.items].map(item => item.id)).toEqual([mixedId, incompleteId])
    }
    finally {
      await h.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: alice.role.id, permissionId: selfScope.id } } }).catch(() => undefined)
    }
    const afterRemoval = (await alice.browser.get(basePath).expect(200)).body as OverviewPage
    expect(afterRemoval.dataScope).toBe('ALL')
    expect(afterRemoval.total).toBe(4)
  })

  it('uses the authenticated sales owner for each user including the system administrator', async () => {
    const bobList = (await bob.browser.get(basePath).expect(200)).body as OverviewPage
    expect(bobList.dataScope).toBe('ALL')
    expect(bobList.total).toBe(4)
    expect(bobList.items.find(item => item.id === mixedId)?.myItemCount).toBe(1)
    expect(bobList.items.find(item => item.id === mixedId)?.itemCount).toBe(6)
    const bobItems = (await bob.browser.get(`${basePath}/${mixedId}/items`).expect(200)).body as Page<PersonalLine>
    expect(bobItems.total).toBe(1)
    expect(bobItems.items.map(item => item.id)).toEqual([hiddenIds[0]])
    const adminList = (await admin.browser.get(basePath).expect(200)).body as OverviewPage
    expect(adminList.dataScope).toBe('ALL')
    expect(adminList.total).toBe(4)
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

  it('returns every container and all loading lines with per-line ownership for the all view', async () => {
    const allList = (await alice.browser.get(`${basePath}/all`).expect(200)).body as OverviewPage
    expect(allList.dataScope).toBe('ALL')
    expect(allList.total).toBe(4)
    expect(allList.items.map(item => item.id)).toEqual([mixedId, incompleteId, noPersonalId, emptyId])
    for (const item of allList.items) expect(Object.keys(item).sort()).toEqual(overviewKeys)
    expect(allList.items[0]).toMatchObject({ itemCount: 6, myItemCount: 3, grossWeightKgTotal: '2050', volumeCaiTotal: '206.22' })
    expect(allList.items[2]).toMatchObject({ itemCount: 1, myItemCount: 0 })
    expect(allList.items[3]).toMatchObject({ itemCount: 0, myItemCount: 0, grossWeightKgTotal: '0', volumeCaiTotal: '0.00' })
    const searched = (await alice.browser.get(`${basePath}/all`).query({ search: '0919' }).expect(200)).body as OverviewPage
    expect(searched.items.map(item => item.id)).toEqual([incompleteId])

    const allLines = (await alice.browser.get(`${basePath}/all/${mixedId}/items`).expect(200)).body as Page<AllLine>
    expect(allLines.total).toBe(6)
    expect(allLines.items.map(item => item.id)).toEqual([...ownIds, ...hiddenIds])
    expect(allLines.items.map(item => item.mine)).toEqual([true, true, true, false, false, false])
    for (const item of allLines.items) {
      expect(Object.keys(item).sort()).toEqual(allLineKeys)
      for (const key of forbiddenKeys) expect(item).not.toHaveProperty(key)
    }
    const secondPage = (await alice.browser.get(`${basePath}/all/${mixedId}/items`).query({ page: 2, pageSize: 2 }).expect(200)).body as Page<AllLine>
    expect(secondPage).toMatchObject({ total: 6 })
    expect(secondPage.items.map(item => item.id)).toEqual([ownIds[2], hiddenIds[0]])
    const beyond = (await alice.browser.get(`${basePath}/all/${mixedId}/items`).query({ page: 4, pageSize: 2 }).expect(200)).body as Page<AllLine>
    expect(beyond).toMatchObject({ total: 6, items: [] })

    const noPersonal = (await alice.browser.get(`${basePath}/all/${noPersonalId}/items`).expect(200)).body as Page<AllLine>
    expect(noPersonal).toMatchObject({ total: 1 })
    expect(noPersonal.items[0].mine).toBe(false)
    expect((await alice.browser.get(`${basePath}/all/${emptyId}/items`).expect(200)).body as Page<AllLine>)
      .toMatchObject({ total: 0, items: [] })
    await alice.browser.get(`${basePath}/all/${randomUUID()}/items`).expect(404)

    const ownDetail = (await alice.browser.get(`${basePath}/all/${mixedId}/items/${ownIds[0]}`).expect(200)).body as AllLine
    expect(ownDetail).toMatchObject({ id: ownIds[0], mine: true })
    expect(Object.keys(ownDetail).sort()).toEqual(allLineKeys)
    const otherDetail = (await alice.browser.get(`${basePath}/all/${mixedId}/items/${hiddenIds[0]}`).expect(200)).body as AllLine
    expect(otherDetail).toMatchObject({ id: hiddenIds[0], mine: false })
    expect(Object.keys(otherDetail).sort()).toEqual(allLineKeys)
    for (const key of forbiddenKeys) expect(otherDetail).not.toHaveProperty(key)
    await alice.browser.get(`${basePath}/all/${emptyId}/items/${ownIds[0]}`).expect(404)
    await alice.browser.get(`${basePath}/all/${randomUUID()}/items/${ownIds[0]}`).expect(404)
    await alice.browser.get(`${basePath}/all/${mixedId}/items/${randomUUID()}`).expect(404)
  })

  it('rejects client-supplied owner filters instead of widening access', async () => {
    for (const path of [basePath, `${basePath}/all`, `${basePath}/${mixedId}/items`, `${basePath}/all/${mixedId}/items`]) {
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
    await alice.browser.get(`${basePath}/all`).expect(200)
    await alice.browser.get(`${basePath}/${mixedId}/items`).expect(200)
    await alice.browser.get(`${basePath}/all/${mixedId}/items`).expect(200)
    await alice.browser.get(`${basePath}/all/${mixedId}/items/${hiddenIds[0]}`).expect(200)
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
    const aliceList = (await alice.browser.get(basePath).expect(200)).body as OverviewPage
    expect(aliceList.dataScope).toBe('ALL')
    expect(aliceList.total).toBe(4)
    expect(aliceList.items.find(item => item.id === mixedId)?.myItemCount).toBe(0)
    await bob.browser.get(`${basePath}/${mixedId}/items/${ownIds[0]}`).expect(200)
    expect((await bob.browser.get(`${basePath}/${mixedId}/items`).expect(200)).body as Page<PersonalLine>).toMatchObject({ total: 4 })
    const aliceAll = (await alice.browser.get(`${basePath}/all/${mixedId}/items`).expect(200)).body as Page<AllLine>
    expect(aliceAll.items.every(item => item.mine === false)).toBe(true)
    expect((await alice.browser.get(`${basePath}/all/${mixedId}/items/${ownIds[0]}`).expect(200)).body as AllLine)
      .toMatchObject({ id: ownIds[0], mine: false })
    const bobAll = (await bob.browser.get(`${basePath}/all/${mixedId}/items`).expect(200)).body as Page<AllLine>
    expect(bobAll.items.filter(item => item.mine)).toHaveLength(4)
    expect((await bob.browser.get(`${basePath}/all/${mixedId}/items/${ownIds[0]}`).expect(200)).body as AllLine)
      .toMatchObject({ id: ownIds[0], mine: true })
  })
})
