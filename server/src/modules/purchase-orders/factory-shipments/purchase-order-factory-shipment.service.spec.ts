import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import { DictionaryValueUnavailableError, type DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import type { AuditService } from '../../audit/audit.service'
import type { SalesOrderPurchaseCoverageService } from '../sales-order-purchase-coverage.service'
import { PurchaseOrderFactoryShipmentService } from './purchase-order-factory-shipment.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PURCHASE_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SECOND_PURCHASE_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SALES_ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SALES_LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function purchaseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: PURCHASE_ORDER_ID,
    orderNo: 'PO/20260904-00001',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
    purchaseType: 'SALES_LINKED',
    salesOrderId: SALES_ORDER_ID,
    version: 3,
    parts: [{ id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null }],
    ...overrides,
  }
}

function setup(overrides: Record<string, unknown> = {}) {
  const first = purchaseOrder(overrides)
  const orders = [first]
  const transaction = {
    $executeRaw: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: PURCHASE_ORDER_ID }]),
    purchaseOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(first),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue(orders),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderPart: { updateMany: jest.fn<Promise<{ count: number }>, [unknown]>().mockResolvedValue({ count: 1 }) },
    purchaseOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: SALES_ORDER_ID,
        orderNo: 'SO/20260904-00001',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
      }),
    },
    salesOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([{ id: SALES_LINE_ID }]),
    },
  }
  const prisma = {
    $transaction: jest.fn<Promise<unknown>, [(tx: typeof transaction) => Promise<unknown>]>()
      .mockImplementation(callback => callback(transaction)),
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const coverage = {
    advanceWhenAllPurchasesShipped:
      jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({
        advancedToLandTransit: false,
        fulfillmentStatus: 'PREPARING',
      }),
  }
  const dictionary = { requireEffectiveValue: jest.fn((_transaction: unknown, input: { value: string }) => Promise.resolve({ value: input.value })) }
  const service = new PurchaseOrderFactoryShipmentService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    coverage as unknown as SalesOrderPurchaseCoverageService,
    dictionary as unknown as DictionaryLookupService,
  )
  return { audit, coverage, dictionary, first, orders, prisma, service, transaction }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('PurchaseOrderFactoryShipmentService', () => {
  it('writes warehouses per shipment even when both shipments share a tracking number', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null },
    ] })
    await fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      expectedVersion: 3, partIds: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID],
      trackingNumbers: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID].map(partId => ({ partId, trackingNo: 'SF123' })),
      destinationWarehouses: [
        { partId: PURCHASE_ORDER_ID, warehouseValue: 'cn-a' },
        { partId: SECOND_PURCHASE_ORDER_ID, warehouseValue: 'CN-B' },
      ],
    })
    expect(fixture.dictionary.requireEffectiveValue).toHaveBeenCalledTimes(2)
    for (const [partId, warehouseValue] of [[PURCHASE_ORDER_ID, 'CN-A'], [SECOND_PURCHASE_ORDER_ID, 'CN-B']]) {
      expect(fixture.dictionary.requireEffectiveValue).toHaveBeenCalledWith(fixture.transaction, { dictionaryCode: 'mainland.warehouse', value: warehouseValue })
      expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
        where: { purchaseOrderId: PURCHASE_ORDER_ID, id: { in: [partId] }, status: 'ACTIVE', shippedAt: null },
        data: expect.objectContaining({ trackingNo: 'SF123', destinationWarehouseValue: warehouseValue, shippedAt: expect.any(Date) as unknown }) as unknown,
      })
    }
  })

  it.each(['DICTIONARY_TYPE_NOT_FOUND', 'DICTIONARY_TYPE_DISABLED', 'DICTIONARY_ITEM_NOT_FOUND', 'DICTIONARY_ITEM_DISABLED'] as const)(
    'rejects unavailable warehouses before all shipment writes: %s', async reason => {
      const fixture = setup()
      fixture.dictionary.requireEffectiveValue.mockRejectedValue(new DictionaryValueUnavailableError(reason))
      await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
        expectedVersion: 3, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [{ partId: PURCHASE_ORDER_ID, warehouseValue: 'CN-A' }],
      })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
      expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    },
  )

  it('deduplicates warehouse validation and stores the effective lookup value', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null },
    ] })
    fixture.dictionary.requireEffectiveValue.mockResolvedValue({ value: 'CANONICAL' })
    fixture.transaction.purchaseOrderPart.updateMany.mockResolvedValue({ count: 2 })
    await fixture.service.shipSalesOrder(context, SALES_ORDER_ID, { mode: 'SELECTED', targets: [{
      purchaseOrderId: PURCHASE_ORDER_ID, expectedVersion: 3, partIds: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID],
      destinationWarehouses: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })),
    }] })
    expect(fixture.dictionary.requireEffectiveValue).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ destinationWarehouseValue: 'CANONICAL' }) as unknown,
    }))
  })

  it('accepts an identical warehouse replay without revalidating a retired dictionary value', async () => {
    const fixture = setup({ fulfillmentStatus: 'SHIPPED', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: new Date(), destinationWarehouseValue: 'CN-A' },
    ] })
    fixture.dictionary.requireEffectiveValue.mockRejectedValue(new DictionaryValueUnavailableError('DICTIONARY_ITEM_DISABLED'))
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      expectedVersion: 3, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [{ partId: PURCHASE_ORDER_ID, warehouseValue: 'CN-A' }],
    })).resolves.toMatchObject({ changedPurchaseOrderCount: 0 })
    expect(fixture.dictionary.requireEffectiveValue).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it.each([null, 'CN-B'])('rejects warehouse changes on shipped replay, including historical null: %s', async destinationWarehouseValue => {
    const fixture = setup({ fulfillmentStatus: 'SHIPPED', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: new Date(), destinationWarehouseValue },
    ] })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      expectedVersion: 3, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [{ partId: PURCHASE_ORDER_ID, warehouseValue: 'CN-A' }],
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('rejects pending-review stock purchases before shipment writes', async () => {
    const fixture = setup({ purchaseType: 'STOCK', salesOrderId: null, orderStatus: 'PENDING_REVIEW' })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_NOT_ALLOWED' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it.each(['ORDERED', 'PREPARING', 'SHIPPED', 'SIGNED'])(
    'rejects a pending-review purchase even when its fulfillment snapshot is %s',
    async (fulfillmentStatus) => {
      const fixture = setup({ orderStatus: 'PENDING_REVIEW', fulfillmentStatus })
      await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
        partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
      })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_NOT_ALLOWED' })
      expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
      expect(fixture.coverage.advanceWhenAllPurchasesShipped).not.toHaveBeenCalled()
    },
  )

  it('ships all approved pending targets without including pending-review orders', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })
    fixture.orders.push(purchaseOrder({
      id: SECOND_PURCHASE_ORDER_ID, orderStatus: 'PENDING_REVIEW',
    }))

    await expect(fixture.service.shipSalesOrder(context, SALES_ORDER_ID, {
      mode: 'ALL_PENDING',
      targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 }],
    })).resolves.toMatchObject({
      changedPurchaseOrderCount: 1, remainingPendingShipmentCount: 0,
      purchaseOrders: [{ id: PURCHASE_ORDER_ID, changed: true }],
      salesOrder: { advancedToLandTransit: false },
    })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: PURCHASE_ORDER_ID },
      data: { fulfillmentStatus: 'SHIPPED', version: { increment: 1 } },
    })
  })

  it.each(['SELECTED', 'ALL_PENDING'])(
    'rejects %s sales shipping atomically when a pending-review order is explicitly targeted',
    async (mode) => {
      const fixture = setup({ fulfillmentStatus: 'PREPARING' })
      fixture.orders.push(purchaseOrder({
        id: SECOND_PURCHASE_ORDER_ID, orderStatus: 'PENDING_REVIEW',
      }))
      await expect(fixture.service.shipSalesOrder(context, SALES_ORDER_ID, {
        mode,
        targets: [
          { purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 },
          { purchaseOrderId: SECOND_PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 },
        ],
      })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_NOT_ALLOWED' })
      expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    },
  )

  it('advances ORDERED through PREPARING to SHIPPED in one transaction', async () => {
    const fixture = setup({ purchaseType: 'STOCK', salesOrderId: null })

    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
      reason: '工厂已交货',
    })).resolves.toMatchObject({
      changedPurchaseOrderCount: 1,
      alreadySatisfiedCount: 0,
      remainingPendingShipmentCount: 0,
      salesOrder: null,
      purchaseOrders: [{
        id: PURCHASE_ORDER_ID,
        fulfillmentStatus: 'SHIPPED',
        changed: true,
      }],
    })

    expect(fixture.transaction.purchaseOrder.update.mock.calls).toEqual([
      [{
        where: { id: PURCHASE_ORDER_ID },
        data: { fulfillmentStatus: 'PREPARING', version: { increment: 1 } },
      }],
      [{
        where: { id: PURCHASE_ORDER_ID },
        data: { fulfillmentStatus: 'SHIPPED', version: { increment: 1 } },
      }],
    ])
    expect(JSON.stringify(
      fixture.transaction.purchaseOrderStatusHistory.create.mock.calls,
    )).toContain(
      '"fromStatus":"ORDERED","toStatus":"PREPARING",'
      + '"reason":"确认发货时系统自动完成备货状态"',
    )
    expect(JSON.stringify(
      fixture.transaction.purchaseOrderStatusHistory.create.mock.calls,
    )).toContain(
      '"fromStatus":"PREPARING","toStatus":"SHIPPED",'
      + '"reason":"本次发货：货件-01；工厂已交货"',
    )
    expect(fixture.coverage.advanceWhenAllPurchasesShipped).not.toHaveBeenCalled()
  })

  it('rejects a stale pending purchase order before writing', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', version: 4 })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('treats SHIPPED as an idempotent satisfied target', async () => {
    const fixture = setup({ fulfillmentStatus: 'SHIPPED', version: 9, parts: [{ id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: new Date(), destinationWarehouseValue: 'CN-A' }] })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
    })).resolves.toMatchObject({
      changedPurchaseOrderCount: 0,
      alreadySatisfiedCount: 1,
    })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('ships selected parts and keeps the order partially shipped', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null },
    ] })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
    })).resolves.toMatchObject({
      remainingPendingShipmentCount: 1,
      purchaseOrders: [{ fulfillmentStatus: 'PARTIALLY_SHIPPED' }],
    })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { purchaseOrderId: PURCHASE_ORDER_ID, id: { in: [PURCHASE_ORDER_ID] }, status: 'ACTIVE', shippedAt: null },
      data: expect.objectContaining({ shippedAt: expect.any(Date) as unknown, shippedById: ACTOR_ID, shipmentRecordedAt: expect.any(Date) as unknown, shipmentRemark: null }) as unknown,
    }))
  })

  it('records each selected part tracking number in the same conditional shipment write', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null, trackingNo: null },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null, trackingNo: null },
      { id: SALES_LINE_ID, status: 'ACTIVE', partNumber: 3, shippedAt: null, trackingNo: null },
    ] })
    await fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
      trackingNumbers: [
        { partId: PURCHASE_ORDER_ID, trackingNo: '  SF123  ' },
        { partId: SECOND_PURCHASE_ORDER_ID, trackingNo: 'YT456' },
      ],
    })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledTimes(2)
    for (const [partId, trackingNo] of [[PURCHASE_ORDER_ID, 'SF123'], [SECOND_PURCHASE_ORDER_ID, 'YT456']]) {
      expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
        where: { purchaseOrderId: PURCHASE_ORDER_ID, id: { in: [partId] }, status: 'ACTIVE', shippedAt: null },
        data: expect.objectContaining({ trackingNo, shippedAt: expect.any(Date) as unknown }) as unknown,
      })
    }
  })

  it('records tracking numbers from sales shipment targets', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })
    await fixture.service.shipSalesOrder(context, SALES_ORDER_ID, {
      mode: 'SELECTED', targets: [{
        purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
        trackingNumbers: [{ partId: PURCHASE_ORDER_ID, trackingNo: 'SF123' }],
      }],
    })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ trackingNo: 'SF123' }) as unknown,
    }))
  })

  it.each([null, '', '   '])('does not clear an existing tracking number when blank %#', async (trackingNo) => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null, trackingNo: 'SF123' },
    ] })
    await fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
      trackingNumbers: [{ partId: PURCHASE_ORDER_ID, trackingNo }],
    })
    const write = fixture.transaction.purchaseOrderPart.updateMany.mock.calls[0]?.[0] as { data: unknown }
    expect(write.data).not.toHaveProperty('trackingNo')
  })

  it.each(['SF123', null, ''])('accepts identical or omitted tracking numbers on shipped replay %#', async (trackingNo) => {
    const fixture = setup({ fulfillmentStatus: 'SHIPPED', version: 9, parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: new Date(), destinationWarehouseValue: 'CN-A', trackingNo: 'SF123' },
    ] })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
      trackingNumbers: [{ partId: PURCHASE_ORDER_ID, trackingNo }],
    })).resolves.toMatchObject({ changedPurchaseOrderCount: 0 })
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it.each([null, 'SF123'])('rejects replay with a different tracking number instead of overwriting %#', async (trackingNo) => {
    const fixture = setup({ fulfillmentStatus: 'SHIPPED', version: 9, parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: new Date(), destinationWarehouseValue: 'CN-A', trackingNo },
    ] })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
      trackingNumbers: [{ partId: PURCHASE_ORDER_ID, trackingNo: 'YT456' }],
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('records another partial shipment even when the status stays unchanged', async () => {
    const fixture = setup({ fulfillmentStatus: 'PARTIALLY_SHIPPED', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null },
      { id: SALES_LINE_ID, status: 'ACTIVE', partNumber: 3, shippedAt: new Date(), destinationWarehouseValue: 'CN-A' },
    ] })
    await fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 })
    expect(fixture.transaction.purchaseOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      fromStatus: 'PARTIALLY_SHIPPED', toStatus: 'PARTIALLY_SHIPPED', reason: expect.stringContaining('货件-01') as unknown,
    }) as unknown })
  })

  it.each([[], [{ id: PURCHASE_ORDER_ID, status: 'PENDING_REVIEW', partNumber: 1, shippedAt: null }], [{ id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null }]])('rejects missing, inactive or foreign parts without writes %#', async (...parts) => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', parts })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 }))
      .rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_TARGET_INVALID' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a mixed shipped and unshipped selection atomically', async () => {
    const fixture = setup({ fulfillmentStatus: 'PARTIALLY_SHIPPED', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: new Date(), destinationWarehouseValue: 'CN-A' },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null },
    ] })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, { partIds: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID, SECOND_PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 }))
      .rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('requires ALL_PENDING to include every pending part', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: null },
    ] })
    await expect(fixture.service.shipSalesOrder(context, SALES_ORDER_ID, {
      mode: 'ALL_PENDING', targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, expectedVersion: 3, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })) }],
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an unsuccessful conditional part update', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })
    fixture.transaction.purchaseOrderPart.updateMany.mockResolvedValue({ count: 0 })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 }))
      .rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrderStatusHistory.create).not.toHaveBeenCalled()
  })

  it('ships the last pending part and preserves full remarks without overflowing history', async () => {
    const fixture = setup({ fulfillmentStatus: 'PARTIALLY_SHIPPED', parts: [
      { id: PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 1, shippedAt: null },
      { id: SECOND_PURCHASE_ORDER_ID, status: 'ACTIVE', partNumber: 2, shippedAt: new Date(), destinationWarehouseValue: 'CN-A' },
    ] })
    const reason = '发'.repeat(500)
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3, reason }))
      .resolves.toMatchObject({ purchaseOrders: [{ fulfillmentStatus: 'SHIPPED' }] })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shipmentRemark: reason }) as unknown }))
    const history = fixture.transaction.purchaseOrderStatusHistory.create.mock.calls[0]?.[0] as { data: { reason: string } }
    expect([...history.data.reason]).toHaveLength(500)
    expect(fixture.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: expect.objectContaining({ partIds: [PURCHASE_ORDER_ID] }) as unknown }))
  })

  it('rejects an invalid sales target without partially updating valid orders', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })
    fixture.transaction.purchaseOrder.findMany.mockResolvedValue([
      fixture.first,
      purchaseOrder({
        id: SECOND_PURCHASE_ORDER_ID,
        orderNo: 'PO/20260904-00002',
        fulfillmentStatus: 'PREPARING',
        version: 2,
      }),
    ])

    await expect(fixture.service.shipSalesOrder(context, SALES_ORDER_ID, {
      mode: 'SELECTED',
      targets: [
        { purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3 },
        {
          purchaseOrderId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1,
        },
      ],
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_TARGET_INVALID' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })
})
