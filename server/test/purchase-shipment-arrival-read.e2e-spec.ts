import { withDatabaseBusinessClock } from './fixtures/database-business-clock.fixture'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { attachRequestAuthContext } from '../src/modules/auth/auth-context'
import { Prisma } from '../src/generated/prisma/client'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseShipmentController } from '../src/modules/purchase-orders/shipments/purchase-shipment.controller'
import type { PurchaseShipmentFilterDto, PurchaseShipmentPageDto, PurchaseShipmentSort, PurchaseShipmentStatusCountsDto } from '../src/modules/purchase-orders/shipments/purchase-shipment.dto'
import { PurchaseShipmentQueryService } from '../src/modules/purchase-orders/shipments/purchase-shipment-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
import { destinationWarehouses, OTHER_DESTINATION_WAREHOUSE, TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'
import { createHistoricalCustomPurchase, reviewHistoricalPurchase, shipHistoricalPurchase } from './purchase-order-historical-review.fixture'
import { atomicFacts, createAtomicityFixture, createCommands, createReviewMutations, customInput, prepareImageReview, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

const UNKNOWN_WAREHOUSE = 'HISTORICAL-UNKNOWN'

async function reviewedOrder(fixture: AtomicityFixture, count: number) {
  const base = await customInput(fixture)
  const id = await createCommands(fixture).create(fixture.context(), {
    ...base, lines: [{ ...base.lines[0], quantity: count }],
    parts: Array.from({ length: count }, () => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
    purchaseTotalAmount: String(count * 10), balanceDueAmount: String(count * 10),
  })
  await createReviewMutations(fixture).review(fixture.context(), id, await prepareImageReview(fixture, id))
  return fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: { orderBy: { partNumber: 'asc' } } } })
}

describe('arrival shipment filters and stable ordering over isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let fixture: AtomicityFixture
  let application: INestApplication
  let service: PurchaseShipmentQueryService
  let lookup: DictionaryLookupService
  let legacyId: string, unknownId: string
  let parts: string[]
  let before: unknown

  async function facts() {
    return { ...await atomicFacts(fixture.prisma), parts: await fixture.prisma.purchaseOrderPart.findMany({ orderBy: { id: 'asc' } }), audits: await fixture.prisma.auditEvent.count() }
  }

  beforeAll(async () => {
    fixture = await createAtomicityFixture(false, false, false, true)
    const legacyOrderId = await createHistoricalCustomPurchase(fixture)
    await reviewHistoricalPurchase(fixture, legacyOrderId)
    await shipHistoricalPurchase(fixture, legacyOrderId)
    await fixture.migrateWarehouseReceipt()
    legacyId = (await fixture.prisma.purchaseOrderPart.findFirstOrThrow({ where: { purchaseOrderId: legacyOrderId }, select: { id: true } })).id

    lookup = new DictionaryLookupService(fixture.prisma)
    const orders = new PurchaseOrderQueryService(fixture.prisma, lookup, createPaymentRecipientFixture(fixture.prisma))
    const shipping = new PurchaseOrderFactoryShipmentService(fixture.prisma, fixture.audit, fixture.salesProgress, lookup)
    const receipts = new PurchaseOrderWarehouseReceiptService(fixture.prisma, fixture.audit, orders)
    const order = await reviewedOrder(fixture, 5)
    parts = order.parts.map(part => part.id)
    await withDatabaseBusinessClock(fixture.prisma, async () => shipping.shipPurchaseOrder(fixture.context(), order.id, {
      expectedVersion: order.version, partIds: parts.slice(0, 3),
      destinationWarehouses: [
        ...destinationWarehouses(parts.slice(0, 2)),
        ...destinationWarehouses([parts[2]], OTHER_DESTINATION_WAREHOUSE),
      ],
      trackingNumbers: [
        { partId: parts[0], trackingNo: 'ARRIVE-SF-SHARED-01' },
        { partId: parts[1], trackingNo: 'ARRIVE-SF-SHARED-02' },
        { partId: parts[2], trackingNo: 'ARRIVE-YT-03' },
      ],
    }))
    await withDatabaseBusinessClock(fixture.prisma, async () => shipping.shipPurchaseOrder(fixture.context(), order.id, {
      expectedVersion: (await orders.getById(order.id)).version, partIds: [parts[3]],
      destinationWarehouses: destinationWarehouses([parts[3]]),
      trackingNumbers: [{ partId: parts[3], trackingNo: 'ＳＦ-123' }],
    }))
    await receipts.receive(fixture.context(), order.id, {
      expectedVersion: (await orders.getById(order.id)).version, partIds: [parts[0], parts[2]],
    })
    await receipts.receive(fixture.context(), order.id, {
      expectedVersion: (await orders.getById(order.id)).version, partIds: [parts[3]],
    })
    const type = await fixture.prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'mainland.warehouse' } })
    await fixture.prisma.dictionaryItem.update({
      where: { dictionaryTypeId_value: { dictionaryTypeId: type.id, value: OTHER_DESTINATION_WAREHOUSE } },
      data: { enabled: false },
    })

    const unknown = await reviewedOrder(fixture, 1)
    unknownId = unknown.parts[0].id
    // 历史原值可能没有可解析字典项。仅在隔离库按守卫允许的一次发货写齐事实，
    // 不删除字典、不禁用触发器，也不覆盖任何已冻结发货字段。
    await fixture.prisma.$transaction(async transaction => {
      await transaction.$executeRaw(Prisma.sql`UPDATE purchase_order_parts
        SET shipped_at = clock_timestamp(), shipped_by_id = ${fixture.actor.id}::uuid,
          shipment_recorded_at = clock_timestamp(), destination_warehouse_value = ${UNKNOWN_WAREHOUSE},
          tracking_no = 'ARRIVE-UNKNOWN-01'
        WHERE id = ${unknownId}::uuid`)
      await transaction.purchaseOrder.update({ where: { id: unknown.id }, data: { fulfillmentStatus: 'SHIPPED', version: { increment: 1 } } })
    })

    service = new PurchaseShipmentQueryService(fixture.prisma, lookup)
    const module = await Test.createTestingModule({ controllers: [PurchaseShipmentController], providers: [{ provide: PurchaseShipmentQueryService, useValue: service }] }).compile()
    application = module.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    application.use((requestObject: object, _response: object, next: () => void) => {
      attachRequestAuthContext(requestObject, {
        id: '55555555-5555-4555-8555-555555555555',
        userId: fixture.actor.id,
        username: 'arrival_e2e',
        displayName: '到仓 E2E',
        mustChangePassword: false,
        createdAt: new Date('2026-09-14T00:00:00.000Z'),
        lastActivityAt: new Date('2026-09-14T00:00:00.000Z'),
        idleExpiresAt: new Date('2026-09-15T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-10-14T00:00:00.000Z'),
      })
      next()
    })
    await application.init()
    before = await facts()
  })

  afterAll(async () => {
    try { if (application) await application.close() }
    finally { if (fixture) await fixture.dispose() }
  })

  it('partitions pending arrivals and received shipments without including unshipped parts', async () => {
    const pending = await service.list({ view: 'SHIPPED' })
    const received = await service.list({ view: 'WAREHOUSE_RECEIVED' })
    expect(pending.items.map(part => part.id).sort()).toEqual([parts[1], unknownId, legacyId].sort())
    expect(received.items.map(part => part.id).sort()).toEqual([parts[0], parts[2], parts[3]].sort())
    expect(new Set([...pending.items, ...received.items].map(part => part.id)).size).toBe(6)
    expect(pending.items.every(part => part.shippedAt !== null && part.warehouseReceivedAt === null)).toBe(true)
    expect(received.items.every(part => part.warehouseReceivedAt !== null)).toBe(true)
  })

  it('filters exact warehouse values while retaining disabled, unknown and genuinely missing historical values', async () => {
    const active = await service.list({ view: 'ALL', destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE })
    expect(active.items.map(part => part.id)).toEqual([parts[0], parts[1], parts[3]])
    const disabled = await service.list({ view: 'WAREHOUSE_RECEIVED', destinationWarehouseValue: OTHER_DESTINATION_WAREHOUSE })
    expect(disabled.items).toHaveLength(1)
    expect(disabled.items[0]).toMatchObject({ id: parts[2], destinationWarehouse: { value: OTHER_DESTINATION_WAREHOUSE, label: '第二测试仓库', known: true, effectiveEnabled: false } })
    const unknown = await service.list({ view: 'SHIPPED', destinationWarehouseValue: UNKNOWN_WAREHOUSE })
    expect(unknown.items).toHaveLength(1)
    expect(unknown.items[0]).toMatchObject({ id: unknownId, destinationWarehouse: { value: UNKNOWN_WAREHOUSE, label: null, known: false, effectiveEnabled: false } })
    const missing = await service.list({ view: 'SHIPPED', destinationWarehouseMissing: true })
    expect(missing.items.map(part => part.id)).toEqual([legacyId])
    expect(missing.items[0]).toMatchObject({ destinationWarehouseValue: null, destinationWarehouse: null })
    expect((await service.list({ view: 'ALL', destinationWarehouseMissing: true })).items.map(part => part.id)).toEqual([parts[4], legacyId])
    expect((await service.list({ view: 'ALL', destinationWarehouseMissing: false })).total).toBe(7)
    expect((await service.list({ view: 'SHIPPED', destinationWarehouseValue: 'NOT-STORED' })).total).toBe(0)
  })

  it('searches tracking numbers case-insensitively and combines them with warehouse and arrival state', async () => {
    const filter = { keyword: 'sf-shared', destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE }
    expect((await service.list({ ...filter, view: 'ALL' })).items.map(part => part.id)).toEqual([parts[0], parts[1]])
    expect((await service.list({ ...filter, view: 'SHIPPED' })).items.map(part => part.id)).toEqual([parts[1]])
    expect((await service.list({ ...filter, view: 'WAREHOUSE_RECEIVED' })).items.map(part => part.id)).toEqual([parts[0]])
    expect((await service.list({ ...filter, view: 'ALL', destinationWarehouseValue: OTHER_DESTINATION_WAREHOUSE })).total).toBe(0)
  })

  it('finds stored full-width tracking numbers without changing their characters in list or count filters', async () => {
    const filter = { keyword: '  ＳＦ-123  ', destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE }
    const page = await service.list({ ...filter, view: 'WAREHOUSE_RECEIVED' })
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ id: parts[3], trackingNo: 'ＳＦ-123' })
    expect((await service.list({ ...filter, view: 'SHIPPED' })).total).toBe(0)
    const counts = await service.statusCounts(filter)
    expect(counts.items.filter(item => item.count > 0)).toEqual([{ value: 'ALL', count: 1 }, { value: 'WAREHOUSE_RECEIVED', count: 1 }])
  })

  it('sorts timestamps descending with nulls last and keeps equal-time pagination stable', async () => {
    const expectations: [PurchaseShipmentSort, string[]][] = [
      ['CREATED_DESC', [unknownId, ...parts, legacyId]],
      ['SHIPPED_DESC', [unknownId, parts[3], parts[0], parts[1], parts[2], legacyId, parts[4]]],
      ['WAREHOUSE_RECEIVED_DESC', [parts[3], parts[0], parts[2], unknownId, parts[1], parts[4], legacyId]],
    ]
    const first = await service.getById(parts[0]), second = await service.getById(parts[1]), third = await service.getById(parts[2])
    expect(first.shippedAt).toBe(second.shippedAt)
    expect(first.shippedAt).toBe(third.shippedAt)
    expect(first.warehouseReceivedAt).toBe(third.warehouseReceivedAt)
    for (const [sort, expectedIds] of expectations) {
      const full = await service.list({ view: 'ALL', sort })
      expect(full.items.map(part => part.id)).toEqual(expectedIds)
      const paginated: string[] = []
      for (let page = 1; page <= 4; page += 1) {
        const result = await service.list({ view: 'ALL', sort, page, pageSize: 2 })
        expect(result.total).toBe(7)
        paginated.push(...result.items.map(part => part.id))
      }
      expect(paginated).toEqual(expectedIds)
      expect(new Set(paginated).size).toBe(7)
    }
    expect((await service.list({ view: 'ALL' })).items.map(part => part.id)).toEqual(expectations[0][1])
  })

  it('shares every warehouse and tracking filter with status counts regardless of list sort', async () => {
    const filters: PurchaseShipmentFilterDto[] = [
      {}, { destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE }, { destinationWarehouseValue: OTHER_DESTINATION_WAREHOUSE },
      { destinationWarehouseValue: UNKNOWN_WAREHOUSE }, { destinationWarehouseMissing: true }, { destinationWarehouseMissing: false },
      { destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE, keyword: 'SF-SHARED' },
    ]
    for (const filter of filters) {
      const counts = await service.statusCounts(filter)
      for (const view of ['ALL', 'SHIPPED', 'WAREHOUSE_RECEIVED'] as const) {
        for (const sort of ['CREATED_DESC', 'SHIPPED_DESC', 'WAREHOUSE_RECEIVED_DESC'] as const) {
          expect((await service.list({ ...filter, view, sort })).total).toBe(counts.items.find(item => item.value === view)?.count)
        }
      }
    }
    const counts = await service.statusCounts({ destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE, keyword: 'SF-SHARED' })
    expect(counts.items.filter(item => item.count > 0)).toEqual([{ value: 'ALL', count: 2 }, { value: 'SHIPPED', count: 1 }, { value: 'WAREHOUSE_RECEIVED', count: 1 }])
  })

  it('applies the SELF sales-owner scope to list and counts consistently with detail', async () => {
    const outsider = '99999999-9999-4999-8999-999999999999'
    const scoped = new PurchaseShipmentQueryService(
      fixture.prisma,
      lookup,
      { resolve: jest.fn().mockResolvedValue('SELF') } as never,
    )
    const all = await scoped.list({ view: 'ALL' }, outsider)
    expect(all.total).toBe(0)
    expect(all.items).toEqual([])
    const counts = await scoped.statusCounts({}, outsider)
    expect(counts.items.every(item => item.count === 0)).toBe(true)
    await expect(scoped.getById(parts[0], outsider)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PART_NOT_FOUND' })
    // 该夹具的采购单全部是 STOCK，没有销售归属人，SELF 下连本单也不可见。
    expect((await scoped.list({ view: 'ALL' }, fixture.actor.id)).total).toBe(0)
    expect((await service.list({ view: 'ALL' })).total).toBe(7)
  })

  it('parses HTTP missing-value booleans strictly and rejects invalid or conflicting filters', async () => {
    const missing = await request(application.getHttpServer()).get('/api/purchase-order-parts?view=SHIPPED&destinationWarehouseMissing=true&sort=SHIPPED_DESC').expect(200)
    expect((missing.body as PurchaseShipmentPageDto).items.map(part => part.id)).toEqual([legacyId])
    const unchanged = await request(application.getHttpServer()).get('/api/purchase-order-parts?view=ALL&destinationWarehouseMissing=false').expect(200)
    expect((unchanged.body as PurchaseShipmentPageDto).total).toBe(7)
    const counts = await request(application.getHttpServer()).get('/api/purchase-order-parts/status-counts').query({ destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE, keyword: 'SF-SHARED' }).expect(200)
    expect((counts.body as PurchaseShipmentStatusCountsDto).items.find(item => item.value === 'SHIPPED')?.count).toBe(1)
    for (const query of [
      { destinationWarehouseMissing: '1' }, { destinationWarehouseMissing: 'invalid' },
      { destinationWarehouseMissing: 'true', destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE },
      { destinationWarehouseValue: 'invalid warehouse' },
    ]) {
      await request(application.getHttpServer()).get('/api/purchase-order-parts').query(query).expect(422)
      await request(application.getHttpServer()).get('/api/purchase-order-parts/status-counts').query(query).expect(422)
    }
    await request(application.getHttpServer()).get('/api/purchase-order-parts?sort=SHIPPED_ASC').expect(422)
    await request(application.getHttpServer()).get('/api/purchase-order-parts/status-counts?sort=SHIPPED_DESC').expect(422)
  })

  it('leaves shipment, audit and numbering facts unchanged after all reads', async () => {
    expect(await facts()).toEqual(before)
  })
})
