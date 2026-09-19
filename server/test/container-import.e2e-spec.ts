import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { AuditService } from '../src/modules/audit/audit.service'
import type { ContainerBatchDto } from '../src/modules/container-batches/container-batch.dto'
import type { ContainerImportConfirmDto, ContainerImportPreviewDto, ContainerImportResultDto } from '../src/modules/container-batches/container-import.dto'
import { OceanFreightSourceFileService } from '../src/modules/media/ocean-freight-source-file.service'
import { containerImportHeader, containerImportRow, createContainerImportFixture } from './fixtures/container-import.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { OTHER_DESTINATION_WAREHOUSE, TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['container-batches:read', 'container-batches:create', 'container-batches:update', 'purchase-orders:read', 'sales-orders:read']
describe('container source import with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness, browser: ReturnType<typeof request.agent>
  let sequence = 1
  const post = (path: string, body: object, key = randomUUID(), agent = browser) => agent.post(path).set(packagingHeaders).set('Idempotency-Key', key).send(body)
  const upload = async (bytes: Buffer) => (await browser.post('/api/container-batches/source-file-uploads').set(packagingHeaders).field('mediaType', 'DOCUMENT')
    .attach('file', bytes, { filename: '装柜明细.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).expect(201)).body as { mediaAssetId: string }
  async function batch(changes: Record<string, string | null>[] = [{}], warehouseValue = TEST_DESTINATION_WAREHOUSE) {
    const name = `0917-${String(sequence++).padStart(2, '0')}柜`
    const bytes = createContainerImportFixture({ sheets: [{ name: '装柜资料', rows: containerImportHeader() + changes.map((values, index) => containerImportRow(index + 3, { A: name, C: `OCEAN-${index}`, ...values })).join('') }] })
    const source = await upload(bytes)
    const created = (await post('/api/container-batches', { containerBatchName: name, warehouseValue, sourceFileId: source.mediaAssetId }).expect(201)).body as ContainerBatchDto
    return { ...created, bytes }
  }
  const preview = async (id: string, agent = browser) => (await agent.get(`/api/container-batches/${id}/import-preview`).expect(200)).body as ContainerImportPreviewDto
  const input = (data: ContainerImportPreviewDto, allowUnmatched = false): ContainerImportConfirmDto => ({ expectedVersion: data.expectedVersion, sourceFileId: data.sourceFileId, sourceHash: data.sourceHash, allowUnmatched, rows: data.rows.map(row => ({ rowKey: row.rowKey, shipmentId: row.matchedShipmentId })) })
  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, { ruleCode: 'CONTAINER_BATCH_NO', purpose: 'BUSINESS', name: '柜次', resetPolicy: 'NEVER', segments: [{ type: 'FIXED', value: 'CTN' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
  })
  afterAll(async () => { await h?.dispose() })

  it('previews immutable source data, exact matches and calculated volume without creating records', async () => {
    const shipment = await h.shipment(), parent = await batch([{ B: shipment.part.shippingMarkText! }])
    const before = await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipment.part.id } })
    const result = await preview(parent.id)
    expect(result).toMatchObject({ containerBatchId: parent.id, warehouseValue: parent.warehouseValue, alreadyImported: false, expectedVersion: 1 })
    expect(result.rows[0]).toMatchObject({ matchStatus: 'MATCHED', matchedShipmentId: shipment.part.id, volumeCai: '12.88272063', chargeableVolumeCai: 13,
      candidates: [expect.objectContaining({ id: shipment.part.id, eligible: true, salesOrderNo: shipment.source!.orderNo }) as unknown] })
    expect(JSON.stringify(result)).not.toMatch(/sourceData|objectKey|checksumSha256|password/u)
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(0)
    expect(await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipment.part.id } })).toEqual(before)
  })

  it('requires session, all permissions, CSRF and a request key while masking sales references', async () => {
    const shipment = await h.shipment(), parent = await batch([{ B: shipment.part.shipmentNo }]), path = `/api/container-batches/${parent.id}`
    await request(h.app.getHttpServer()).get(`${path}/import-preview`).expect(401)
    const reader = (await h.browserWithPermissions(['container-batches:read'])).browser
    await reader.get(`${path}/import-preview`).expect(403)
    const limited = (await h.browserWithPermissions(permissions.filter(code => code !== 'sales-orders:read'))).browser
    const data = await preview(parent.id, limited)
    expect(data.rows[0].candidates[0].salesOrderNo).toBeNull()
    const body = input(data)
    await reader.post(`${path}/import`).set(packagingHeaders).set('Idempotency-Key', randomUUID()).send(body).expect(403)
    await browser.post(`${path}/import`).send(body).expect(403)
    await browser.post(`${path}/import`).set(packagingHeaders).send(body).expect(422)
    await post(`${path}/import`, { ...body, rows: [{ ...body.rows[0], goodsName: 'forged' }] }).expect(422)
  })

  it('imports all selected rows atomically, persists provenance and replays without duplicating or moving shipments/funds', async () => {
    const shipment = await h.shipment(), parent = await batch([{ B: shipment.part.shippingMarkText! }, { B: shipment.part.shipmentNo }])
    const before = await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipment.part.id } })
    const data = await preview(parent.id), body = input(data), path = `/api/container-batches/${parent.id}/import`, key = randomUUID()
    expect((await post(path, body, key).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 2, unmatchedCount: 0, replayed: false })
    // 模拟成功响应丢失：完全相同请求和新请求键均恢复既有导入，不消耗新的明细序号。
    for (const nextKey of [key, randomUUID()]) expect((await post(path, body, nextKey).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 2, replayed: true })
    const stored = await h.prisma.containerLoadingItem.findMany({ where: { containerBatchId: parent.id }, orderBy: { lineNumber: 'asc' } })
    expect(stored.map(row => row.lineNumber)).toEqual([1, 2])
    expect(stored[0]).toMatchObject({ sourceSheetName: '装柜资料', sourceRowNumber: 3, sourceData: { sourceFileId: data.sourceFileId, sourceHash: data.sourceHash, source: { cells: expect.any(Object) as unknown } } })
    expect((await preview(parent.id)).alreadyImported).toBe(true)
    await post(path, { ...body, allowUnmatched: true, rows: body.rows.map(row => ({ ...row, shipmentId: null })) }).expect(409)
    expect(await h.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: shipment.part.id } })).toEqual(before)
    expect(await h.prisma.fundPostingBatch.count()).toBe(0)
    expect(await h.prisma.fundLedgerEntry.count()).toBe(0)
  })

  it('requires explicit unmatched acknowledgement and rejects missing/extra/duplicate source rows or forged source hash', async () => {
    const parent = await batch([{}, { B: 'UNKNOWN' }]), data = await preview(parent.id), body = input(data), path = `/api/container-batches/${parent.id}/import`
    expect((await post(path, body).expect(422)).body as { code: string }).toMatchObject({ code: 'CONTAINER_IMPORT_UNMATCHED' })
    for (const rows of [[body.rows[0]], [...body.rows, { rowKey: '1:99', shipmentId: null }], [body.rows[0], body.rows[0]]]) await post(path, { ...body, allowUnmatched: true, rows }).expect(422)
    await post(path, { ...body, allowUnmatched: true, sourceHash: 'f'.repeat(64) }).expect(409)
    await post(path, { ...body, allowUnmatched: true, sourceFileId: randomUUID() }).expect(409)
    expect((await post(path, { ...body, allowUnmatched: true }).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 2, unmatchedCount: 2 })
  })

  it('flags invalid source rows and cabinet mismatches, then prevents confirmation', async () => {
    const parent = await batch([{ E: '0' }, { A: '1231柜' }]), data = await preview(parent.id)
    expect(data.rows.every(row => row.matchStatus === 'INVALID' && row.errors.length > 0)).toBe(true)
    await post(`/api/container-batches/${parent.id}/import`, input(data, true)).expect(422)
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(0)
  })

  it('rejects stale previews but treats an entirely existing source as a no-op', async () => {
    const parent = await batch(), data = await preview(parent.id), path = `/api/container-batches/${parent.id}`
    await post(`${path}/items`, { expectedVersion: 1, goodsName: '手工明细', packageCount: 1, oceanShippingMarkText: data.rows[0].oceanShippingMarkText }).expect(201)
    await post(`${path}/import`, input(data, true)).expect(409)
    const updated = await preview(parent.id)
    expect(updated).toMatchObject({ alreadyImported: true, rows: [{ matchStatus: 'SKIPPED', matchedShipmentId: null, candidates: [], matchReason: expect.stringContaining('相同海运唛头') as unknown }] })
    expect((await post(`${path}/import`, input(updated)).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 0, skippedCount: 1, unmatchedCount: 0 })
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(1)
    expect((await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: parent.id } })).version).toBe(updated.expectedVersion)
  })

  it('skips existing ocean marks while importing normal rows, preserving originals and replaying concurrent retries', async () => {
    const shipment = await h.shipment(), parent = await batch([{ B: 'EXISTING-UNKNOWN' }, { B: shipment.part.shippingMarkText! }]), path = `/api/container-batches/${parent.id}`
    await post(`${path}/items`, { expectedVersion: 1, goodsName: '保留手工明细', packageCount: 1, oceanShippingMarkText: 'OCEAN-0', codAmountTwd: '99.00' }).expect(201)
    const original = await h.prisma.containerLoadingItem.findFirstOrThrow({ where: { containerBatchId: parent.id } })
    const data = await preview(parent.id), body = input(data), key = randomUUID()
    expect(data.alreadyImported).toBe(false)
    expect(data.rows.map(row => row.matchStatus)).toEqual(['SKIPPED', 'MATCHED'])
    expect(data.rows[0]).toMatchObject({ errors: [], matchedShipmentId: null, candidates: [] })
    const outcomes = await Promise.all([post(`${path}/import`, body, key), post(`${path}/import`, body)])
    expect(outcomes.map(response => response.status)).toEqual([200, 200])
    for (const response of outcomes) expect(response.body as ContainerImportResultDto).toMatchObject({ importedCount: 1, skippedCount: 1, unmatchedCount: 0 })
    expect(outcomes.map(response => (response.body as ContainerImportResultDto).replayed).sort()).toEqual([false, true])
    expect((await post(`${path}/import`, body, key).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 1, skippedCount: 1, unmatchedCount: 0, replayed: true })
    const stored = await h.prisma.containerLoadingItem.findMany({ where: { containerBatchId: parent.id }, orderBy: { lineNumber: 'asc' } })
    expect(stored[0]).toEqual(original)
    expect(stored[1]).toMatchObject({ lineNumber: 2, oceanShippingMarkText: 'OCEAN-1', shipmentId: shipment.part.id, sourceRowNumber: 4 })
    expect(stored).toHaveLength(2)
    expect((await preview(parent.id)).alreadyImported).toBe(true)
    await post(`${path}/import`, { ...body, allowUnmatched: true, rows: body.rows.map(row => ({ ...row, shipmentId: null })) }).expect(409)
  })

  it('still validates unmatched and invalid pending rows after skipping existing marks', async () => {
    const parent = await batch([{}, { B: 'UNKNOWN' }]), path = `/api/container-batches/${parent.id}`
    await post(`${path}/items`, { expectedVersion: 1, goodsName: '已有明细', packageCount: 1, oceanShippingMarkText: 'OCEAN-0' }).expect(201)
    const data = await preview(parent.id)
    expect(data.rows.map(row => row.matchStatus)).toEqual(['SKIPPED', 'UNMATCHED'])
    expect((await post(`${path}/import`, input(data)).expect(422)).body as { code: string }).toMatchObject({ code: 'CONTAINER_IMPORT_UNMATCHED' })
    expect((await post(`${path}/import`, input(data, true)).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 1, skippedCount: 1, unmatchedCount: 1 })
    const invalid = await batch([{}, { E: '0' }]), invalidPath = `/api/container-batches/${invalid.id}`
    await post(`${invalidPath}/items`, { expectedVersion: 1, goodsName: '已有明细', packageCount: 1, oceanShippingMarkText: 'OCEAN-0' }).expect(201)
    const invalidData = await preview(invalid.id)
    expect(invalidData.rows.map(row => row.matchStatus)).toEqual(['SKIPPED', 'INVALID'])
    await post(`${invalidPath}/import`, input(invalidData, true)).expect(422)
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: invalid.id } })).toBe(1)
  })

  it('shows wrong-warehouse candidates and rejects manually selected unavailable or foreign-warehouse shipments', async () => {
    const shipment = await h.shipment(), parent = await batch([{ B: shipment.part.shippingMarkText! }], OTHER_DESTINATION_WAREHOUSE), data = await preview(parent.id)
    expect(data.rows[0]).toMatchObject({ matchStatus: 'AMBIGUOUS', matchedShipmentId: null, candidates: [expect.objectContaining({ eligible: false, ineligibleReason: expect.stringContaining('仓库') as unknown }) as unknown] })
    for (const shipmentId of [shipment.part.id, randomUUID()]) await post(`/api/container-batches/${parent.id}/import`, { ...input(data), rows: data.rows.map(row => ({ rowKey: row.rowKey, shipmentId })) }).expect(422)
  })

  it('imports newly available rows from a fresh preview while skipping edited source identities', async () => {
    // 使用两行来源：首行手工已有，另一行先正常导入；随后编辑唛头再补导首行。
    const source = await batch([{}, { B: 'SECOND-UNKNOWN' }]), sourcePath = `/api/container-batches/${source.id}`
    await post(`${sourcePath}/items`, { expectedVersion: 1, goodsName: '手工明细', packageCount: 1, oceanShippingMarkText: 'OCEAN-0' }).expect(201)
    const firstBody = input(await preview(source.id), true)
    await post(`${sourcePath}/import`, firstBody).expect(200)
    const stored = await h.prisma.containerLoadingItem.findMany({ where: { containerBatchId: source.id }, orderBy: { lineNumber: 'asc' } })
    for (const [index, item] of stored.entries()) {
      await browser.patch(`${sourcePath}/items/${item.id}`).set(packagingHeaders).send({ expectedVersion: 3 + index, itemExpectedVersion: item.version, goodsName: item.goodsName, packageCount: item.packageCount, oceanShippingMarkText: `EDITED-${index}` }).expect(200)
    }
    const data = await preview(source.id), nextBody = input(data, true)
    expect(data.alreadyImported).toBe(false)
    expect(data.rows.map(row => row.matchStatus)).toEqual(['UNMATCHED', 'SKIPPED'])
    expect(nextBody.rows).toEqual(firstBody.rows)
    expect((await post(`${sourcePath}/import`, nextBody).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 1, skippedCount: 1, unmatchedCount: 1, replayed: false })
    expect((await post(`${sourcePath}/import`, nextBody).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 1, skippedCount: 1, unmatchedCount: 1, replayed: true })
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: source.id } })).toBe(3)
    expect((await preview(source.id)).alreadyImported).toBe(true)
  })

  it('ignores invalid source fields on skipped rows without blocking valid pending rows', async () => {
    const parent = await batch([{ E: '0' }, {}]), path = `/api/container-batches/${parent.id}`
    await post(`${path}/items`, { expectedVersion: 1, goodsName: '已有明细', packageCount: 1, oceanShippingMarkText: 'OCEAN-0' }).expect(201)
    const data = await preview(parent.id)
    expect(data.rows[0].matchStatus).toBe('SKIPPED')
    expect(data.rows[0].errors.length).toBeGreaterThan(0)
    expect((await post(`${path}/import`, input(data, true)).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 1, skippedCount: 1, unmatchedCount: 1 })
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(2)
  })

  it('serializes duplicate imports and competing cross-container assignments', async () => {
    const shipment = await h.shipment(), first = await batch([{ B: shipment.part.shippingMarkText! }]), second = await batch([{ B: shipment.part.shippingMarkText! }])
    const [left, right] = await Promise.all([preview(first.id), preview(second.id)])
    const outcomes = await Promise.all([post(`/api/container-batches/${first.id}/import`, input(left)), post(`/api/container-batches/${second.id}/import`, input(right))])
    expect(outcomes.map(response => response.status).sort()).toEqual([200, 409])
    expect(await h.prisma.containerLoadingItem.count({ where: { shipmentId: shipment.part.id } })).toBe(1)
    const loser = outcomes[0].status === 200 ? second : first
    expect((await preview(loser.id)).rows[0].candidates[0]).toMatchObject({ eligible: false, ineligibleReason: expect.stringContaining('其他柜次') as unknown })
    const empty = await batch(), data = await preview(empty.id)
    const duplicated = await Promise.all([post(`/api/container-batches/${empty.id}/import`, input(data, true)), post(`/api/container-batches/${empty.id}/import`, input(data, true))])
    expect(duplicated.map(response => response.status)).toEqual([200, 200])
    expect(duplicated.map(response => (response.body as ContainerImportResultDto).replayed).sort()).toEqual([false, true])
  })

  it('keeps content-based duplicate protection even if the same bytes are rebound through a different media record', async () => {
    const parent = await batch([{ C: null }]), data = await preview(parent.id)
    await post(`/api/container-batches/${parent.id}/import`, input(data, true)).expect(200)
    const replacement = await upload(parent.bytes)
    // 保留旧附件的有效归属，测试恢复过程同样遵守 READY 媒体必须有业务引用的约束。
    await post('/api/container-batches', { containerBatchName: '0921-99柜', warehouseValue: parent.warehouseValue, sourceFileId: data.sourceFileId }).expect(201)
    // 常规接口禁止替换已绑定来源；隔离库模拟资料维护恢复，验证防重身份也不依赖媒体 ID。
    const actor = (await h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: replacement.mediaAssetId } })).createdByUserId
    await h.prisma.$transaction(async tx => {
      await h.app.get(OceanFreightSourceFileService).attach(tx, replacement.mediaAssetId, actor)
      await tx.containerBatch.update({ where: { id: parent.id }, data: { sourceFileId: replacement.mediaAssetId, version: { increment: 1 } } })
    })
    const updated = await preview(parent.id)
    expect(updated.alreadyImported).toBe(true)
    await post(`/api/container-batches/${parent.id}/import`, input(updated, true)).expect(409)
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(1)
  })

  it('rolls back every imported row and the batch version when a later audit write fails', async () => {
    const parent = await batch([{}, { B: 'OTHER' }]), data = await preview(parent.id), audit = h.app.get(AuditService), original = audit.record.bind(audit)
    let count = 0
    const injected = jest.spyOn(audit, 'record').mockImplementation((tx, event) => event.eventType === 'CONTAINER_LOADING_ITEM_CREATED' && ++count === 2 ? Promise.reject(new Error('Injected import audit failure')) : original(tx, event))
    try { await post(`/api/container-batches/${parent.id}/import`, input(data, true)).expect(500) } finally { injected.mockRestore() }
    expect(await h.prisma.containerLoadingItem.count({ where: { containerBatchId: parent.id } })).toBe(0)
    expect((await h.prisma.containerBatch.findUniqueOrThrow({ where: { id: parent.id } })).version).toBe(1)
    expect((await post(`/api/container-batches/${parent.id}/import`, input(data, true)).expect(200)).body as ContainerImportResultDto).toMatchObject({ importedCount: 2, replayed: false })
  })
})
