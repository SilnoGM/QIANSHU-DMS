import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { AuditService } from '../src/modules/audit/audit.service'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

describe('confirmed operations ocean changes and undo with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness, batchId: string, shipmentId: string, nextLine = 0
  let alice: Awaited<ReturnType<PackagingCostHarness['browserWithPermissions']>>, bob: typeof alice, reader: typeof alice, admin: typeof alice
  const path = (itemId: string, parentId = batchId) => `/api/operations/ocean-containers/${parentId}/items/${itemId}`
  const post = (itemId: string, input: object, browser = alice.browser) => browser.post(`${path(itemId)}/changes`).set(packagingHeaders).send(input)
  async function line() {
    return h.prisma.containerLoadingItem.create({ data: { containerBatchId: batchId, shipmentId, lineNumber: ++nextLine, creationRequestKey: randomUUID(), creationPayloadHash: 'a'.repeat(64),
      goodsName: '测试装柜货品', packageCount: 1, oceanShippingMarkText: `L-TEST-${nextLine}`, recipientName: '原客户', recipientPhone: '0900000000', recipientAddress: '原地址', remark: '原备注', codAmountTwd: '120.50', createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id } })
  }
  const changeInput = (codAmountTwd: string | null = '200.12', expectedVersion = 1) => ({ requestKey: randomUUID(), kind: 'COD', expectedVersion, notificationConfirmed: true, codAmountTwd })
  const undo = (itemId: string, changeId: string, input = { requestKey: randomUUID(), expectedVersion: 2 }, browser = alice.browser) => browser.post(`${path(itemId)}/changes/${changeId}/undo`).set(packagingHeaders).send(input)
  const errorCode = (response: request.Response) => (response.body as { code: string }).code
  beforeAll(async () => {
    h = await createPackagingCostHarness()
    await h.app.listen(0, '127.0.0.1')
    const rights = ['sales-orders:read', 'sales-orders:update']
    alice = await h.browserWithPermissions([...rights, 'ocean-freight-bills:read', 'ocean-freight-bills:create', 'ocean-freight-bills:update'])
    bob = await h.browserWithPermissions(rights)
    reader = await h.browserWithPermissions(['sales-orders:read'])
    admin = await h.browserWithPermissions(rights)
    const role = await h.prisma.role.findUniqueOrThrow({ where: { code: 'system_admin' } })
    await h.prisma.userRole.create({ data: { userId: admin.user.id, roleId: role.id } })
    for (const [ruleCode, prefix] of [['CONTAINER_BATCH_NO', 'CB'], ['CTN_BILL_NO', 'OFB']]) {
      const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
      const rule = await h.fixture.numberingCommands.create(context, { ruleCode, purpose: 'BUSINESS', name: ruleCode, resetPolicy: 'NEVER', segments: [{ type: 'FIXED', value: prefix }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
      const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
      await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
    }
    const shipment = await h.shipment({ salesLinked: true, ownerUserId: alice.user.id })
    shipmentId = shipment.part.id
    batchId = (await h.prisma.$transaction(async tx => {
      const key = randomUUID(), fingerprint = 'b'.repeat(64)
      const issuance = await h.fixture.numbering.generateScopedInTransaction(tx, { ruleCode: 'CONTAINER_BATCH_NO', consumerCode: 'CONTAINER_BATCH.CREATE', idempotencyKey: key, requestFingerprint: fingerprint })
      return tx.containerBatch.create({ data: { containerBatchNo: issuance.number, numberingIssuanceId: issuance.issuanceId, containerBatchName: '0920柜', loadingDate: new Date('2026-09-20'), sequenceInDay: 1, warehouseValue: TEST_DESTINATION_WAREHOUSE, creationRequestKey: key, creationPayloadHash: fingerprint, createdById: h.fixture.actor.id, updatedById: h.fixture.actor.id } })
    })).id
  })
  afterAll(async () => { await h?.dispose() })

  it('requires login, CSRF, update permission and current sales ownership including admins', async () => {
    const row = await line(), input = changeInput()
    await request(h.app.getHttpServer()).post(`${path(row.id)}/changes`).set(packagingHeaders).send(input).expect(401)
    await alice.browser.post(`${path(row.id)}/changes`).send(input).expect(403)
    await post(row.id, input, reader.browser).expect(403)
    for (const browser of [bob.browser, admin.browser]) await post(row.id, input, browser).expect(404)
    await alice.browser.post(`${path(row.id, randomUUID())}/changes`).set(packagingHeaders).send(input).expect(404)
    expect((await h.prisma.containerLoadingItem.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(1)
  })

  it('does not write when group notification has not been explicitly confirmed', async () => {
    const row = await line(), parent = await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batchId } })
    for (const notificationConfirmed of [false, undefined, 'true', 1]) await post(row.id, { ...changeInput(), notificationConfirmed }).expect(422)
    expect(await h.prisma.containerLoadingItemChange.count({ where: { loadingItemId: row.id } })).toBe(0)
    expect(await h.prisma.containerLoadingItem.findUnique({ where: { id: row.id } })).toMatchObject({ version: 1, recipientName: '原客户', codAmountTwd: row.codAmountTwd })
    expect((await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batchId } })).version).toBe(parent.version)
  })

  it('commits recipient diff, immutable history, versions and audit atomically', async () => {
    const row = await line(), parent = await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batchId } })
    const input = { requestKey: randomUUID(), kind: 'RECIPIENT', expectedVersion: 1, notificationConfirmed: true, recipientName: '新客户', recipientPhone: '0912345678', recipientAddress: '新地址\n第二行', remark: '提前联系\n自备叉车' }
    const response = (await post(row.id, input).expect(200)).body as { line: object, changeId: string }
    expect(response.line).toMatchObject({ recipientName: '新客户', recipientAddress: input.recipientAddress, remark: input.remark, codAmountTwd: '120.50', version: 2 })
    expect(await h.prisma.containerLoadingItemChange.findUnique({ where: { id: response.changeId } })).toMatchObject({ previousVersion: 1, version: 2, beforeData: { recipientName: '原客户', recipientPhone: '0900000000', recipientAddress: '原地址', remark: '原备注' }, afterData: { recipientName: input.recipientName, recipientPhone: input.recipientPhone, recipientAddress: input.recipientAddress, remark: input.remark }, reversesChangeId: null })
    expect((await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batchId } })).version).toBe(parent.version + 1)
    await expect(h.prisma.containerLoadingItemChange.delete({ where: { id: response.changeId } })).rejects.toThrow()
    await expect(h.prisma.containerLoadingItemChange.update({ where: { id: response.changeId }, data: { afterData: {} } })).rejects.toThrow()
    expect(await h.prisma.auditEvent.count({ where: { eventType: 'CONTAINER_LOADING_ITEM_UPDATED', targetId: row.id } })).toBe(1)
    // 收件信息撤销恢复全部四个字段，代收和其他物流字段保持原值。
    const reversed = (await undo(row.id, response.changeId).expect(200)).body as { line: object }
    expect(reversed.line).toMatchObject({ recipientName: '原客户', recipientPhone: '0900000000', recipientAddress: '原地址', remark: '原备注', codAmountTwd: '120.50', version: 3 })
  })

  it('serializes concurrent identical retries and rejects changed payload under the same key', async () => {
    const row = await line(), input = changeInput()
    const results = await Promise.all([post(row.id, input), post(row.id, input)])
    expect(results.map(result => result.status)).toEqual([200, 200])
    expect(results[0].body).toEqual(results[1].body)
    expect(await h.prisma.containerLoadingItemChange.count({ where: { loadingItemId: row.id } })).toBe(1)
    expect(errorCode(await post(row.id, { ...input, codAmountTwd: '300.00' }).expect(409))).toBe('CONTAINER_CHANGE_IDEMPOTENCY_CONFLICT')
    expect(errorCode(await post(row.id, { ...input, requestKey: randomUUID() }).expect(409))).toBe('CONTAINER_STATE_CHANGED')
    await post(row.id, input, bob.browser).expect(404)
  })

  it('rejects no change, missing recipient fields and invalid precision, preserving explicit zero and null', async () => {
    const row = await line()
    expect(errorCode(await post(row.id, changeInput('120.50')).expect(422))).toBe('CONTAINER_CHANGE_NO_DIFFERENCE')
    for (const amount of ['-1', '1.234', '1e2', '99999999999999999999999999999', 'NaN']) await post(row.id, changeInput(amount)).expect(422)
    await post(row.id, { ...changeInput(), recipientName: 'injected' }).expect(422)
    await post(row.id, { requestKey: randomUUID(), kind: 'RECIPIENT', expectedVersion: 1, notificationConfirmed: true, recipientName: 'new' }).expect(422)
    expect((await post(row.id, changeInput('0')).expect(200)).body).toMatchObject({ line: { version: 2, codAmountTwd: '0.00', recipientName: '原客户' } })
    expect((await post(row.id, changeInput(null, 2)).expect(200)).body).toMatchObject({ line: { version: 3, codAmountTwd: null } })
  })

  it('restores COD through a unique inverse record and makes identical undo retries idempotent', async () => {
    const row = await line(), changed = (await post(row.id, changeInput()).expect(200)).body as { changeId: string }
    const input = { requestKey: randomUUID(), expectedVersion: 2 }
    const results = await Promise.all([undo(row.id, changed.changeId, input), undo(row.id, changed.changeId, input)])
    expect(results.map(result => result.status)).toEqual([200, 200])
    expect(results[0].body).toEqual(results[1].body)
    const result = results[0].body as { line: object, changeId: string }
    expect(result.line).toMatchObject({ version: 3, codAmountTwd: '120.50', recipientName: '原客户' })
    expect(await h.prisma.containerLoadingItemChange.findUnique({ where: { id: result.changeId } })).toMatchObject({ reversesChangeId: changed.changeId, previousVersion: 2, version: 3, beforeData: { codAmountTwd: '200.12' }, afterData: { codAmountTwd: '120.50' } })
    expect(await h.prisma.containerLoadingItemChange.count({ where: { loadingItemId: row.id } })).toBe(2)
    expect(errorCode(await undo(row.id, changed.changeId, { requestKey: randomUUID(), expectedVersion: 3 }).expect(409))).toBe('CONTAINER_CHANGE_ALREADY_UNDONE')
    expect(errorCode(await undo(row.id, result.changeId, { requestKey: randomUUID(), expectedVersion: 3 }).expect(404))).toBe('CONTAINER_CHANGE_NOT_FOUND')
  })

  it('never overwrites a later change when an earlier change is undone', async () => {
    const row = await line(), changed = (await post(row.id, changeInput()).expect(200)).body as { changeId: string }
    await post(row.id, changeInput('700.00', 2)).expect(200)
    for (const expectedVersion of [2, 3]) expect(errorCode(await undo(row.id, changed.changeId, { requestKey: randomUUID(), expectedVersion }).expect(409))).toBe('CONTAINER_STATE_CHANGED')
    expect((await h.prisma.containerLoadingItem.findUniqueOrThrow({ where: { id: row.id } })).codAmountTwd?.toFixed(2)).toBe('700.00')
    expect(await h.prisma.containerLoadingItemChange.count({ where: { loadingItemId: row.id } })).toBe(2)
  })

  it('rolls back change and undo data, versions and history if audit persistence fails', async () => {
    const row = await line(), input = changeInput(), parent = await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batchId } })
    let spy = jest.spyOn(h.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('Injected audit failure'))
    try { await post(row.id, input).expect(500) } finally { spy.mockRestore() }
    expect(await h.prisma.containerLoadingItem.findUnique({ where: { id: row.id } })).toMatchObject({ version: 1, codAmountTwd: row.codAmountTwd })
    expect((await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: batchId } })).version).toBe(parent.version)
    expect(await h.prisma.containerLoadingItemChange.count({ where: { loadingItemId: row.id } })).toBe(0)
    const changed = (await post(row.id, input).expect(200)).body as { changeId: string }
    const reverseInput = { requestKey: randomUUID(), expectedVersion: 2 }
    spy = jest.spyOn(h.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('Injected undo audit failure'))
    try { await undo(row.id, changed.changeId, reverseInput).expect(500) } finally { spy.mockRestore() }
    expect((await h.prisma.containerLoadingItem.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(2)
    expect(await h.prisma.containerLoadingItemChange.count({ where: { loadingItemId: row.id } })).toBe(1)
    await undo(row.id, changed.changeId, reverseInput).expect(200)
  })

  it('refuses changes and undo after the line becomes a bill reconciliation reference', async () => {
    const row = await line(), changed = (await post(row.id, changeInput()).expect(200)).body as { changeId: string }
    const create = (url: string, input: object) => alice.browser.post(url).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(input)
    const bill = (await create('/api/ocean-freight-bills', { billName: '测试锁定账单', twdPerCny: '4.8' }).expect(201)).body as { id: string }
    await create(`/api/ocean-freight-bills/${bill.id}/lines`, { lineType: 'NORMAL', goodsName: row.goodsName, loadingItemId: row.id, packageCount: 1 }).expect(201)
    expect(errorCode(await post(row.id, changeInput('10', 2)).expect(409))).toBe('CONTAINER_ITEM_BILLED')
    expect(errorCode(await undo(row.id, changed.changeId).expect(409))).toBe('CONTAINER_ITEM_BILLED')
  })

  it('requires both current ownership and original actor for undo, including retry after reassignment', async () => {
    const row = await line(), changed = (await post(row.id, changeInput()).expect(200)).body as { changeId: string }
    await undo(row.id, changed.changeId, undefined, bob.browser).expect(404)
    await undo(row.id, changed.changeId, undefined, admin.browser).expect(404)
    await undo(row.id, changed.changeId, undefined, reader.browser).expect(403)
    const source = await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipmentId }, include: { purchaseOrder: true } })
    await h.prisma.salesOrder.update({ where: { id: source.purchaseOrder.salesOrderId! }, data: { issuerUserId: bob.user.id } })
    try {
      // Bob 已获得这条明细的读取归属，仍不能撤销 Alice 的历史修改。
      await bob.browser.get(path(row.id)).expect(200)
      expect(errorCode(await undo(row.id, changed.changeId, undefined, bob.browser).expect(404))).toBe('CONTAINER_CHANGE_NOT_FOUND')
      await undo(row.id, changed.changeId).expect(404)
    } finally {
      await h.prisma.salesOrder.update({ where: { id: source.purchaseOrder.salesOrderId! }, data: { issuerUserId: alice.user.id } })
    }
  })
})
