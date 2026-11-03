import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { Prisma } from '../src/generated/prisma/client'
import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import type { ContainerImportPreviewDto } from '../src/modules/container-batches/container-import.dto'
import type { ContainerSourceFileDto } from '../src/modules/container-batches/container-source-file.dto'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { FundPostingService } from '../src/modules/fund-accounts/application/fund-posting.contract'
import { PurchasePayableQueryService } from '../src/modules/purchase-orders/payables/purchase-payable-query.service'
import type { PurchaseShipmentPageDto } from '../src/modules/purchase-orders/shipments/purchase-shipment.dto'
import type { ShipmentLoadGroupDto } from '../src/modules/purchase-orders/shipments/shipment-load-group.dto'
import { ShipmentOwnershipService } from '../src/modules/shipment-ownership/shipment-ownership.service'
import { ShipmentStorageCostService } from '../src/modules/shipment-storage/shipment-storage-cost.service'
import { ShipmentStorageService } from '../src/modules/shipment-storage/shipment-storage.service'
import { containerImportHeader, containerImportRow, createContainerImportFixture } from './fixtures/container-import.fixture'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { createReviewMutations } from './purchase-shipping-mark-atomicity.fixture'
import { createOceanXlsxFixture } from './fixtures/ocean-freight-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = ['container-batches:read', 'container-batches:create', 'container-batches:update', 'purchase-orders:read', 'purchase-orders:update']
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 装柜合并组：两个同单货件按一票装柜、解绑回退、释放与跨单拒绝。 */
describe('shipment load group over isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness, browser: ReturnType<typeof request.agent>
  let storage: ShipmentStorageService
  let sequence = 60

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    browser = (await h.browserWithPermissions(permissions)).browser
    storage = new ShipmentStorageService(
      h.prisma,
      h.fixture.audit,
      new DictionaryLookupService(h.prisma),
      new ShipmentOwnershipService(),
      new ShipmentStorageCostService(h.app.get(FundPostingService), h.fixture.audit),
    )
    await h.setupFunds('30')
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, { ruleCode: 'CONTAINER_BATCH_NO', purpose: 'BUSINESS', name: '柜次', resetPolicy: 'NEVER', segments: [{ type: 'FIXED', value: 'CB' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }] })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, { expectedVersion: rule.version, draftRevision: 1 })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
  })
  afterAll(async () => { await h?.dispose() })

  async function uploadSource(bytes: Buffer, filename = '装柜资料.xlsx'): Promise<string> {
    const upload = await browser.post('/api/container-batches/source-file-uploads').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT')
      .attach('file', bytes, { filename, contentType: mime })
      .expect(201)
    return (upload.body as ContainerSourceFileDto).mediaAssetId
  }

  async function createBatch(name: string, sourceFileId: string): Promise<ContainerBatchDto> {
    const created = await browser.post('/api/container-batches')
      .set(packagingHeaders)
      .set('Idempotency-Key', randomUUID())
      .send({
        containerBatchName: name,
        warehouseValue: TEST_DESTINATION_WAREHOUSE,
        sourceFileId,
      })
      .expect(201)
    return created.body as ContainerBatchDto
  }

  async function batch(): Promise<ContainerBatchDto> {
    return createBatch(`1102-${String(++sequence).padStart(2, '0')}柜`, await uploadSource(createOceanXlsxFixture()))
  }

  async function createItem(parentId: string, shipmentId: string, extra: Record<string, unknown> = {}): Promise<ContainerLoadingItemDto> {
    const parent = (await browser.get(`/api/container-batches/${parentId}`).expect(200)).body as ContainerBatchDto
    const response = await browser.post(`/api/container-batches/${parentId}/items`)
      .set(packagingHeaders)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedVersion: parent.version,
        goodsName: '履带',
        packageCount: 10,
        shipmentId,
        ...extra,
      })
      .expect(201)
    return response.body as ContainerLoadingItemDto
  }

  async function payOrder(orderId: string): Promise<void> {
    const queries = new PurchasePayableQueryService(
      h.prisma,
      new DictionaryLookupService(h.prisma),
      createPaymentRecipientFixture(h.prisma),
    )
    const order = await queries.getOrder(orderId, h.fixture.actor.id)
    const profile = order.paymentRecipientProfile
    if (profile === null) throw new Error('Purchase payment recipient profile is missing')
    const mutations = createReviewMutations(h.fixture)
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    for (const payable of order.items) {
      if (payable.status === 'PAID' || payable.remainingAmount === '0.00') continue
      const voucher = await h.prisma.mediaAsset.create({ data: {
        mediaType: 'IMAGE',
        status: 'UPLOADING',
        uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER',
        purchasePayableUploadId: payable.id,
        objectKey: `assets/${randomUUID()}.png`,
        originalFilename: 'payment.png',
        mimeType: 'image/png',
        sizeBytes: 1n,
        checksumSha256: '0'.repeat(64),
        width: 1,
        height: 1,
        createdByUserId: h.fixture.actor.id,
        uploadExpiresAt: new Date(Date.now() + 3_600_000),
      } })
      await mutations.payPayable(context, payable.id, {
        expectedVersion: payable.version,
        paymentMethod: 'BANK_TRANSFER',
        recipientAccountId: profile.accounts[0].id,
        recipientProfileVersion: profile.version,
        voucher: { mediaAssetId: voucher.id },
      }, randomUUID())
    }
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

  it('previews a group member as the primary shipment and imports one loading row', async () => {
    const shipment = await h.shipment({ salesLinked: true, partCount: 2 })
    const [primary, member] = shipment.parts
    const group = (await createGroup([primary.id, member.id], primary.id).expect(200)).body as ShipmentLoadGroupDto
    const name = `1102-${String(++sequence).padStart(2, '0')}柜`
    const sourceFileId = await uploadSource(createContainerImportFixture({
      sheets: [{
        name: '装柜资料',
        rows: containerImportHeader() + containerImportRow(3, {
          A: name,
          B: member.shippingMarkText!,
          C: 'OCEAN-GROUP-1',
        }),
      }],
    }))
    const parent = await createBatch(name, sourceFileId)
    const preview = (await browser.get(`/api/container-batches/${parent.id}/import-preview`).expect(200)).body as ContainerImportPreviewDto
    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0]).toMatchObject({
      matchedShipmentId: primary.id,
      matchStatus: 'MATCHED',
    })
    expect(preview.rows[0]?.matchReason).toContain('同票合并')
    expect(preview.rows[0]?.candidates[0]?.loadGroup).toMatchObject({
      id: group.id,
      primaryShipmentId: primary.id,
    })

    await browser.post(`/api/container-batches/${parent.id}/import`)
      .set(packagingHeaders)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedVersion: preview.expectedVersion,
        sourceFileId: preview.sourceFileId,
        sourceHash: preview.sourceHash,
        allowUnmatched: false,
        rows: preview.rows.map(row => ({ rowKey: row.rowKey, shipmentId: row.matchedShipmentId })),
      })
      .expect(200)

    const imported = await h.prisma.containerLoadingItem.findMany({
      where: { containerBatchId: parent.id },
      select: { shipmentId: true },
    })
    expect(imported).toEqual([{ shipmentId: primary.id }])
    const loaded = await h.prisma.purchaseOrderPart.findMany({
      where: { id: { in: [primary.id, member.id] } },
      select: { loadedAt: true },
    })
    expect(loaded.every(part => part.loadedAt !== null)).toBe(true)
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

  it('blocks claiming a KEEP member when the primary loading item is settled', async () => {
    const shipment = await h.shipment({ salesLinked: true, partCount: 2 })
    const [primary, member] = shipment.parts
    await payOrder(shipment.order.id)
    const group = (await createGroup([primary.id, member.id], primary.id).expect(200)).body as ShipmentLoadGroupDto
    const parent = await batch()
    const row = await createItem(parent.id, primary.id, { oceanShippingMarkText: 'OCEAN-GROUP-KEEP' })

    const released = await storage.release(
      { actorUserId: h.fixture.actor.id, requestId: randomUUID() },
      {
        shipmentIds: group.members.map(entry => entry.shipmentId),
        locationScope: 'MAINLAND',
        reason: 'OTHER',
        note: '合并组保留历史',
        requestKey: randomUUID(),
        loadGroupHandling: 'KEEP',
      },
    )
    expect(released).toHaveLength(2)
    expect((await h.prisma.shipmentLoadGroup.findUniqueOrThrow({
      where: { id: group.id },
      select: { status: true },
    })).status).toBe('ARCHIVED')
    const memberRecord = await h.prisma.shipmentStorageRecord.findFirstOrThrow({
      where: { shipmentId: member.id, status: 'IN_STORAGE' },
      select: { id: true, containerSnapshot: true },
    })
    expect(memberRecord.containerSnapshot).toMatchObject({
      format: 'shipment-storage.container-snapshot.v2',
      items: [expect.objectContaining({ oceanShippingMarkText: 'OCEAN-GROUP-KEEP' })],
    })

    // 真实寄仓链路已覆盖 KEEP；结算行用受控 replica 会话插入，只验证组成员认领的阻断口径。
    const hash = 'ab'.repeat(32)
    await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "slh_reconciliation_settlements" (
          "batch_id", "batch_line_id", "bill_id", "bill_line_id", "loading_item_id", "container_batch_id",
          "purchase_order_id", "sales_order_id", "status", "rate_source", "foreign_units_per_cny", "payment_fee_rate",
          "sales_order_no", "purchase_order_no", "container_batch_no", "shipment_no", "slh_bill_no",
          "cod_amount_twd", "cod_amount_currency", "ntd_surcharge_amount_twd", "ntd_surcharge_currency",
          "payable_amount_cny", "payable_currency", "settlement_amount_cny", "settlement_currency",
          "sales_amount", "sales_currency", "payment_fee_amount_cny", "payment_fee_currency",
          "request_key_hash", "payload_hash", "created_by_id"
        ) VALUES (
          gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
          ${row.id}::uuid, ${parent.id}::uuid, ${shipment.order.id}::uuid, ${shipment.source!.id}::uuid,
          'ACTIVE', 'SYSTEM', 5.2000, 0.007,
          ${shipment.source!.orderNo}, ${shipment.order.orderNo}, ${parent.containerBatchNo}, ${primary.shipmentNo}, 'BILL-KEEP-TEST',
          0, 'TWD', 0, 'TWD', 0, 'CNY', 0, 'CNY', 0, 'TWD', 0, 'CNY',
          decode(${hash}, 'hex'), decode(${hash}, 'hex'), ${h.fixture.actor.id}::uuid
        )`)
    })

    await expect(storage.claim(
      { actorUserId: h.fixture.actor.id, requestId: randomUUID() },
      memberRecord.id,
      {
        salesOrderId: shipment.source!.id,
        lines: [],
        requestKey: randomUUID(),
      },
    )).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_SETTLED' })
  })
})
