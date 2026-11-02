import { randomUUID } from 'node:crypto'

import request from 'supertest'

import type { ContainerBatchDto, ContainerLoadingItemDto } from '../src/modules/container-batches/container-batch.dto'
import type { ContainerSourceFileDto } from '../src/modules/container-batches/container-source-file.dto'
import type { ContainerSwapContextDto, ContainerSwapResultDto } from '../src/modules/container-batches/container-swap.dto'
import { createOceanXlsxFixture } from './fixtures/ocean-freight-xlsx.fixture'
import { createPackagingCostHarness, packagingHeaders, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'

const permissions = [
  'container-batches:read',
  'container-batches:create',
  'container-batches:update',
  'data-scope:all',
  'purchase-orders:read',
  'sales-orders:read',
  'sales-orders:update',
]
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('container swap over isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  let browser: ReturnType<typeof request.agent>
  let actorUserId: string
  let sequence = 70

  const post = (url: string, body: object, key = randomUUID()) => browser.post(url).set(packagingHeaders).set('Idempotency-Key', key).send(body)

  async function upload(): Promise<ContainerSourceFileDto> {
    return (await browser.post('/api/container-batches/source-file-uploads').set(packagingHeaders)
      .field('mediaType', 'DOCUMENT')
      .attach('file', createOceanXlsxFixture(), { filename: '装柜资料.xlsx', contentType: mime })
      .expect(201)).body as ContainerSourceFileDto
  }

  async function batch(): Promise<ContainerBatchDto> {
    const source = await upload()
    return (await post('/api/container-batches', {
      containerBatchName: `0921-${String(++sequence)}柜`,
      warehouseValue: TEST_DESTINATION_WAREHOUSE,
      sourceFileId: source.mediaAssetId,
    }).expect(201)).body as ContainerBatchDto
  }

  async function item(parent: ContainerBatchDto, extra: object): Promise<ContainerLoadingItemDto> {
    const current = (await browser.get(`/api/container-batches/${parent.id}`).expect(200)).body as ContainerBatchDto
    return (await post(`/api/container-batches/${parent.id}/items`, {
      expectedVersion: current.version,
      goodsName: '履带',
      packageCount: 1,
      ...extra,
    }).expect(201)).body as ContainerLoadingItemDto
  }

  beforeAll(async () => {
    h = await createPackagingCostHarness({ nativeImageProbe: true })
    await h.app.listen(0, '127.0.0.1')
    const session = await h.browserWithPermissions(permissions)
    browser = session.browser
    actorUserId = session.user.id
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const rule = await h.fixture.numberingCommands.create(context, {
      ruleCode: 'CONTAINER_BATCH_NO',
      purpose: 'BUSINESS',
      name: '柜次',
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'CB' },
        { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
      ],
    })
    const published = await h.fixture.numberingCommands.publish(context, rule.id, {
      expectedVersion: rule.version,
      draftRevision: 1,
    })
    await h.fixture.numberingCommands.enable(context, rule.id, { expectedVersion: published.version })
  })

  afterAll(async () => {
    await h?.dispose()
  })

  it('swaps loading-item recipient/remark, manual COD and sales ownership without cost or storage writes', async () => {
    const left = await h.shipment({ salesLinked: true })
    const right = await h.shipment({ salesLinked: true })
    const parent = await batch()
    const leftItem = await item(parent, {
      shipmentId: left.part.id,
      recipientName: 'A 收件',
      recipientPhone: '0911000000',
      recipientAddress: 'A 地址',
      codAmountTwd: '100.00',
      remark: 'A 备注',
    })
    const rightItem = await item(parent, {
      shipmentId: right.part.id,
      recipientName: 'B 收件',
      recipientPhone: '0922000000',
      recipientAddress: 'B 地址',
      codAmountTwd: '200.00',
      remark: 'B 备注',
    })
    for (const source of [left.source!, right.source!]) {
      expect((await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: source.id }, select: { fulfillmentStatus: true } })).fulfillmentStatus).toBe('SEA_TRANSIT')
    }

    const context = (await browser.get('/api/container-batches/swap-context')
      .query({ leftShipmentId: left.part.id, rightShipmentId: right.part.id })
      .expect(200)).body as ContainerSwapContextDto
    expect(context.canSwap).toBe(true)
    expect(context.errors).toEqual([])
    expect(context.left.containerLoadingItems[0]).toMatchObject({
      recipientName: 'A 收件',
      afterRecipientName: 'B 收件',
      afterRecipientAddress: 'B 地址',
      afterRemark: 'B 备注',
      codAmountTwd: '100.00',
    })
    expect(context.right.containerLoadingItems[0]).toMatchObject({
      recipientName: 'B 收件',
      afterRecipientName: 'A 收件',
      afterRecipientAddress: 'A 地址',
      afterRemark: 'A 备注',
      codAmountTwd: '200.00',
    })

    const fundBefore = await h.prisma.fundPostingBatch.count()
    const storageBefore = await h.prisma.shipmentStorageRecord.count()
    const costBefore = await h.prisma.shipmentCostEvent.count()
    const key = randomUUID()
    const payload = {
      leftShipmentId: left.part.id,
      rightShipmentId: right.part.id,
      leftLines: [{ loadingItemId: leftItem.id, expectedVersion: leftItem.version, codAmountTwd: '150.00' }],
      rightLines: [{ loadingItemId: rightItem.id, expectedVersion: rightItem.version, codAmountTwd: null }],
      note: 'e2e 货物对换',
    }
    const swap = () => browser.post('/api/container-batches/swap').set(packagingHeaders).set('Idempotency-Key', key).send(payload)
    const result = (await swap().expect(200)).body as ContainerSwapResultDto
    expect(result).toMatchObject({ leftShipmentId: left.part.id, rightShipmentId: right.part.id, changedLineCount: 2, replayed: false })

    const replay = (await swap().expect(200)).body as ContainerSwapResultDto
    expect(replay).toMatchObject({ changedLineCount: 2, replayed: true })

    const [leftOwner, rightOwner] = await Promise.all([
      h.prisma.shipmentOwnershipCurrent.findUniqueOrThrow({ where: { shipmentId: left.part.id } }),
      h.prisma.shipmentOwnershipCurrent.findUniqueOrThrow({ where: { shipmentId: right.part.id } }),
    ])
    expect(leftOwner.ownerSalesOrderId).toBe(right.source!.id)
    expect(rightOwner.ownerSalesOrderId).toBe(left.source!.id)

    const [leftAfter, rightAfter] = await Promise.all([
      h.prisma.containerLoadingItem.findUniqueOrThrow({ where: { id: leftItem.id } }),
      h.prisma.containerLoadingItem.findUniqueOrThrow({ where: { id: rightItem.id } }),
    ])
    expect(leftAfter).toMatchObject({
      recipientName: 'B 收件',
      recipientPhone: '0922000000',
      recipientAddress: 'B 地址',
      codAmountTwd: expect.anything() as unknown,
      remark: 'B 备注',
    })
    expect(leftAfter.codAmountTwd?.toFixed(2)).toBe('150.00')
    expect(rightAfter).toMatchObject({
      recipientName: 'A 收件',
      recipientPhone: '0911000000',
      recipientAddress: 'A 地址',
      codAmountTwd: null,
      remark: 'A 备注',
    })

    expect(await h.prisma.containerLoadingItemChange.count({
      where: { actorUserId, loadingItemId: { in: [leftItem.id, rightItem.id] } },
    })).toBe(4)
    expect(await h.prisma.shipmentOwnershipEvent.count({
      where: { shipmentId: { in: [left.part.id, right.part.id] }, reason: 'OTHER' },
    })).toBe(2)
    expect(await h.prisma.auditEvent.count({
      where: {
        eventType: 'SHIPMENT_OWNERSHIP_RELEASED',
        targetId: { in: [left.part.id, right.part.id] },
        metadata: { path: ['action'], equals: 'SWAP' },
      },
    })).toBe(2)
    expect(await h.prisma.fundPostingBatch.count()).toBe(fundBefore)
    expect(await h.prisma.shipmentStorageRecord.count()).toBe(storageBefore)
    expect(await h.prisma.shipmentCostEvent.count()).toBe(costBefore)

    const termination = await browser.get(`/api/sales-orders/${left.source!.id}/termination-context`).expect(409)
    expect(termination.body as { code: string }).toMatchObject({ code: 'SALES_ORDER_TERMINATION_SWAP_PENDING' })
  })
})
