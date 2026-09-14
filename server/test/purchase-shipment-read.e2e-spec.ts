import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { PrivateNoStoreInterceptor } from '../src/infrastructure/http/private-no-store.interceptor'
import type { AccessControlService } from '../src/modules/access-control/access-control.service'
import { attachRequestAuthContext } from '../src/modules/auth/auth-context'
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseShipmentController } from '../src/modules/purchase-orders/shipments/purchase-shipment.controller'
import { PurchaseShipmentQueryService } from '../src/modules/purchase-orders/shipments/purchase-shipment-query.service'
import type { PurchaseShipmentDetailDto, PurchaseShipmentPageDto, PurchaseShipmentStatusCountsDto } from '../src/modules/purchase-orders/shipments/purchase-shipment.dto'
import { atomicFacts, createAtomicityFixture, createCommands, createReviewMutations, customInput, prepareCatalog, prepareSalesSource, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

describe('purchase shipment reads over isolated PostgreSQL and HTTP', () => {
  jest.setTimeout(120_000)
  let fixture: AtomicityFixture
  let application: INestApplication
  let service: PurchaseShipmentQueryService
  let pendingId: string, activeId: string, cancelledId: string, linkedId: string
  let shippedPartId: string, cancelledPartId: string
  let authenticated = true
  let granted = true
  let before: unknown

  async function facts() {
    return { ...await atomicFacts(fixture.prisma), parts: await fixture.prisma.purchaseOrderPart.findMany({ orderBy: { id: 'asc' } }), items: await fixture.prisma.purchaseOrderPartItem.findMany({ orderBy: { id: 'asc' } }) }
  }

  beforeAll(async () => {
    fixture = await createAtomicityFixture()
    const commands = createCommands(fixture), base = await customInput(fixture)
    pendingId = await commands.create(fixture.context(), {
      ...base,
      lines: [{ ...base.lines[0], name: 'Only shipment alpha', quantity: 3 }, { ...base.lines[0], name: 'Only shipment beta', quantity: 4 }],
      parts: [{ key: randomUUID(), items: [{ lineNumber: 1, quantity: 3 }] }, { key: randomUUID(), items: [{ lineNumber: 2, quantity: 4 }] }],
      purchaseTotalAmount: '70', balanceDueAmount: '70',
    })
    activeId = await commands.create(fixture.context(), {
      ...base, lines: [{ ...base.lines[0], quantity: 3 }],
      parts: [1, 2, 3].map(() => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
      purchaseTotalAmount: '30', balanceDueAmount: '30',
    })
    const review = createReviewMutations(fixture)
    await review.review(fixture.context(), activeId, { expectedVersion: 1 })
    const active = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: activeId }, include: { parts: { orderBy: { partNumber: 'asc' } } } })
    shippedPartId = active.parts[0].id
    const shipping = new PurchaseOrderFactoryShipmentService(fixture.prisma, fixture.audit, fixture.salesProgress)
    await shipping.shipPurchaseOrder(fixture.context(), activeId, { expectedVersion: active.version, partIds: [shippedPartId], reason: 'First shipment' })
    const catalog = await prepareCatalog(fixture)
    cancelledId = await commands.create(fixture.context(), catalog.input)
    await review.review(fixture.context(), cancelledId, { expectedVersion: 1 })
    const cancelled = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: cancelledId }, include: { parts: true } })
    cancelledPartId = cancelled.parts[0].id
    // 当前数据库禁止已发货再取消；通过正式取消命令准备合法终态，保留已派发的唛头和分配。
    await review.updateOrderStatus(fixture.context(), cancelledId, { toStatus: 'CANCELLED', reason: 'Cancelled before shipment' })
    await fixture.prisma.dictionaryType.update({ where: { code: 'service_provider.supplier' }, data: { enabled: false } })
    const linked = await prepareSalesSource(fixture)
    linkedId = await commands.create(fixture.context(), linked.input)
    await fixture.prisma.user.create({ data: {
      username: 'shipment-unassigned', usernameNormalized: 'shipment-unassigned', displayName: 'Unassigned user',
      passwordChangedAt: new Date(), passwordHash: 'e2e-only-not-a-real-password-hash',
    } })

    service = new PurchaseShipmentQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma))
    const module = await Test.createTestingModule({ controllers: [PurchaseShipmentController], providers: [{ provide: PurchaseShipmentQueryService, useValue: service }] }).compile()
    application = module.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    application.use((req: object, _res: object, next: () => void) => {
      if (authenticated) attachRequestAuthContext(req, {
        id: randomUUID(), userId: fixture.actor.id, username: fixture.actor.username, displayName: fixture.actor.displayName,
        mustChangePassword: false, createdAt: new Date(), lastActivityAt: new Date(), idleExpiresAt: new Date(Date.now() + 100000), absoluteExpiresAt: new Date(Date.now() + 100000),
      })
      next()
    })
    const access = {
      getPermissionCodes: () => Promise.resolve(granted ? ['purchase-orders:read'] : []),
      hasAll: (actual: readonly string[], required: readonly string[]) => required.every(value => actual.includes(value)),
    } as unknown as AccessControlService
    application.useGlobalGuards(new PermissionGuard(new Reflector(), access))
    application.useGlobalInterceptors(new PrivateNoStoreInterceptor())
    await application.init()
    before = await facts()
  })

  afterAll(async () => {
    try { if (application) await application.close() }
    finally { if (fixture) await fixture.dispose() }
  })
  afterEach(() => { authenticated = true; granted = true })

  it('counts each part once across all five views and defaults to active unshipped parts', async () => {
    const counts = (await request(application.getHttpServer()).get('/api/purchase-order-parts/status-counts').expect(200)).body as PurchaseShipmentStatusCountsDto
    expect(counts.items).toEqual([{ value: 'ALL', count: 7 }, { value: 'PENDING_REVIEW', count: 3 }, { value: 'AWAITING_SHIPMENT', count: 2 }, { value: 'SHIPPED', count: 1 }, { value: 'CANCELLED', count: 1 }])
    const response = await request(application.getHttpServer()).get('/api/purchase-order-parts').expect(200)
    const page = response.body as PurchaseShipmentPageDto
    expect(page.total).toBe(2)
    expect(page.items.every(item => item.purchaseOrder.id === activeId && item.shippedAt === null)).toBe(true)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-request-id']).toEqual(expect.any(String))
  })

  it('paginates a multi-part order without duplicates or sibling omission', async () => {
    const parts: string[] = []
    for (let page = 1; page <= 4; page += 1) {
      const result = await service.list({ view: 'ALL', page, pageSize: 2 })
      expect(result.total).toBe(7)
      parts.push(...result.items.map(item => item.id))
    }
    expect(new Set(parts).size).toBe(7)
    expect(parts).toHaveLength(7)
  })

  it('searches shipment-specific products without returning other products in the same order', async () => {
    const page = await service.list({ view: 'ALL', keyword: 'shipment alpha' })
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ purchaseOrder: { id: pendingId }, lineSummary: { totalQuantity: 3, previews: [{ productName: 'Only shipment alpha', quantity: 3, mainImage: null }] } })
    expect((await service.statusCounts({ keyword: 'shipment alpha' })).items[0].count).toBe(1)
  })

  it('searches order number, both marks, source order/customer and custom supplier', async () => {
    const detail = await service.getById(shippedPartId)
    expect((await service.list({ view: 'ALL', keyword: detail.purchaseOrder.orderNo })).total).toBe(3)
    expect((await service.list({ view: 'ALL', keyword: detail.shippingMarkText! })).items.map(item => item.id)).toEqual([shippedPartId])
    // 两套夹具规则都有 MARK 固定段，基础唛头相同的历史货件也应被完整搜出。
    expect((await service.list({ view: 'ALL', keyword: detail.purchaseOrder.shippingMarkText! })).total).toBe(4)
    for (const keyword of ['ATOMIC_SALES', 'Customer']) {
      const page = await service.list({ view: 'ALL', keyword })
      expect(page.items).toHaveLength(1)
      expect(page.items[0]).toMatchObject({ purchaseOrder: { id: linkedId }, salesSource: { orderNo: 'ATOMIC_SALES', customerName: 'Customer' } })
    }
    expect((await service.list({ view: 'ALL', keyword: 'Custom supplier' })).total).toBe(6)
  })

  it('keeps historical supplier labels available and supports source/date/buyer/type filters', async () => {
    const page = await service.list({ view: 'ALL', supplierSource: 'DICTIONARY', supplierValue: 'MARK_SUPPLIER', createdByUserId: fixture.actor.id, purchaseType: 'STOCK', orderDateFrom: '2026-09-07', orderDateTo: '2026-09-07' })
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ id: cancelledPartId, supplier: { label: 'Mark supplier', source: 'DICTIONARY', effectiveEnabled: false } })
    expect((await service.list({ view: 'ALL', supplierSource: 'CUSTOM_TEXT' })).total).toBe(6)
    expect((await service.list({ view: 'ALL', purchaseType: 'SALES_LINKED' })).total).toBe(1)
    const emptyCounts = await service.statusCounts({ orderDateFrom: '2026-09-08', createdByUserId: randomUUID() })
    expect(emptyCounts.items.every(item => item.count === 0)).toBe(true)
    expect(emptyCounts.buyerOptions).toEqual([{ id: fixture.actor.id, displayName: fixture.actor.displayName }])
  })

  it('returns full cancelled detail retaining marks/allocations and active shipment metadata independently', async () => {
    const response = await request(application.getHttpServer()).get(`/api/purchase-order-parts/${cancelledPartId}`).expect(200)
    const detail = response.body as PurchaseShipmentDetailDto
    expect(detail).toMatchObject({ viewStatus: 'CANCELLED', shippingMarkText: expect.any(String) as unknown, shippedAt: null, shippedBy: null, shipmentRemark: null, purchaseOrder: { id: cancelledId }, items: [{ lineType: 'CATALOG', productName: 'Atomic product', quantity: 1, productAttributes: [], mainImage: null }] })
    expect(await service.getById(shippedPartId)).toMatchObject({ viewStatus: 'SHIPPED', shippedAt: expect.any(String) as unknown, shippedBy: { id: fixture.actor.id }, shipmentRemark: 'First shipment' })
    expect((await service.list({ view: 'SHIPPED' })).items.map(item => item.id)).toEqual([shippedPartId])
  })

  it('rejects malformed/extra query parameters and unknown shipment IDs through HTTP', async () => {
    for (const suffix of ['?view=ACTIVE', '?pageSize=101', '?orderDateFrom=2026-02-30', '?orderDateFrom=2026-09-14&orderDateTo=2026-09-01', '?createdByUserId=invalid', '?supplierSource=CUSTOM_TEXT&supplierValue=MARK_SUPPLIER']) {
      await request(application.getHttpServer()).get(`/api/purchase-order-parts${suffix}`).expect(422)
    }
    await request(application.getHttpServer()).get('/api/purchase-order-parts/status-counts?view=ALL').expect(422)
    await request(application.getHttpServer()).get('/api/purchase-order-parts/invalid').expect(422)
    const missing = await request(application.getHttpServer()).get(`/api/purchase-order-parts/${randomUUID()}`).expect(404)
    expect(missing.body as unknown).toMatchObject({ code: 'PURCHASE_ORDER_PART_NOT_FOUND' })
  })

  it('enforces purchase-orders:read for all endpoints without requiring global users access', async () => {
    for (const path of ['', '/status-counts', `/${shippedPartId}`]) {
      authenticated = false
      await request(application.getHttpServer()).get(`/api/purchase-order-parts${path}`).expect(401)
      authenticated = true; granted = false
      await request(application.getHttpServer()).get(`/api/purchase-order-parts${path}`).expect(403)
      granted = true
      await request(application.getHttpServer()).get(`/api/purchase-order-parts${path}`).expect(200)
    }
  })

  it('leaves all business records, shipment allocations and numbering facts unchanged', async () => {
    expect(await facts()).toEqual(before)
  })
})
