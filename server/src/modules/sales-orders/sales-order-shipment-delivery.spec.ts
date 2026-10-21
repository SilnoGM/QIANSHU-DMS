import type { AuditService } from '../audit/audit.service'
import type { SalesOrderAutomaticStateService } from './sales-order-automatic-state.service'
import {
  autoSignSalesOrderWhenAllShipmentsDelivered,
  deliverAllShipmentsForOrderSign,
} from './sales-order-shipment-delivery'

const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LOADED_AT = new Date('2026-10-21T08:44:38.000Z')
const DELIVERED_AT = new Date('2026-10-21T08:55:21.000Z')
const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

function part(overrides: Record<string, unknown> = {}) {
  return {
    id: 'part-1',
    purchaseOrderId: 'po-1',
    shipmentNo: 'PKG/20261021-00001',
    partNumber: 1,
    status: 'ACTIVE',
    loadedAt: LOADED_AT,
    deliveredAt: null,
    ...overrides,
  }
}

function fixture(parts: unknown[] = [part()]) {
  const transaction = {
    purchaseOrderPart: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue(parts),
      updateMany: jest.fn<Promise<{ count: number }>, [unknown]>()
        .mockResolvedValue({ count: parts.filter(item => (item as { deliveredAt?: unknown }).deliveredAt == null).length }),
    },
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' }),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrderDocument: {
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
    },
    salesOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
  }
  const audit = { record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}) }
  const automaticState = {
    advanceWhenEligible: jest.fn<Promise<'NONE'>, [unknown, unknown, string, string]>().mockResolvedValue('NONE'),
  }
  return {
    audit,
    automaticState,
    transaction,
    deliverAll: () => deliverAllShipmentsForOrderSign(
      transaction as never,
      audit as unknown as AuditService,
      context,
      ORDER_ID,
    ),
    autoSign: () => autoSignSalesOrderWhenAllShipmentsDelivered(
      transaction as never,
      audit as unknown as AuditService,
      automaticState as unknown as SalesOrderAutomaticStateService,
      context,
      ORDER_ID,
      'part-1',
    ),
  }
}

describe('sales order shipment delivery helpers', () => {
  it('signs every undelivered active shipment and audits each purchase order', async () => {
    const f = fixture([
      part(),
      part({ id: 'part-2', purchaseOrderId: 'po-2', shipmentNo: 'PKG/20261021-00002', partNumber: 2 }),
    ])
    await expect(f.deliverAll()).resolves.toBe(2)
    expect(f.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['part-1', 'part-2'] },
        status: 'ACTIVE',
        loadedAt: { not: null },
        deliveredAt: null,
      },
      data: {
        deliveredAt: expect.any(Date) as unknown,
        deliveredById: ACTOR_ID,
        deliveredRecordedAt: expect.any(Date) as unknown,
      },
    })
    expect(f.audit.record).toHaveBeenCalledTimes(2)
    expect(f.audit.record).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'PURCHASE_SHIPMENT_DELIVERED',
      targetType: 'PURCHASE_ORDER',
      targetId: 'po-1',
    }))
    const auditMetadata = (f.audit.record.mock.calls[0]?.[1] as { metadata: Record<string, unknown> }).metadata
    expect(auditMetadata).toMatchObject({ salesOrderId: ORDER_ID, partIds: ['part-1'], source: 'SALES_ORDER_SIGN' })
  })

  it('rejects order signing while a shipment is still pending review', async () => {
    const f = fixture([part({ status: 'PENDING_REVIEW' })])
    await expect(f.deliverAll()).rejects.toMatchObject({ code: 'SALES_ORDER_SHIPMENTS_NOT_READY' })
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('rejects order signing while an active shipment is not loaded', async () => {
    const f = fixture([part({ loadedAt: null })])
    await expect(f.deliverAll()).rejects.toMatchObject({
      code: 'SALES_ORDER_SHIPMENTS_NOT_READY',
      message: expect.stringContaining('PKG/20261021-00001') as unknown,
    })
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing when every active shipment is already delivered', async () => {
    const f = fixture([part({ deliveredAt: DELIVERED_AT })])
    await expect(f.deliverAll()).resolves.toBe(0)
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('fails closed when the shipment set changed between validation and update', async () => {
    const f = fixture([part()])
    f.transaction.purchaseOrderPart.updateMany.mockResolvedValue({ count: 0 })
    await expect(f.deliverAll()).rejects.toMatchObject({ code: 'SALES_ORDER_SHIPMENTS_CHANGED' })
  })

  it('auto signs the order only when all shipments are delivered and a receipt exists', async () => {
    const f = fixture([part({ deliveredAt: DELIVERED_AT })])
    await expect(f.autoSign()).resolves.toEqual({
      salesOrderSigned: true,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: false,
    })
    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { fulfillmentStatus: 'SIGNED', version: { increment: 1 } },
    })
    expect(f.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dimension: 'FULFILLMENT',
        fromStatus: 'SEA_TRANSIT',
        toStatus: 'SIGNED',
        changedByUserId: ACTOR_ID,
      }) as unknown,
    })
    expect(f.automaticState.advanceWhenEligible).toHaveBeenCalledWith(
      f.transaction,
      context,
      ORDER_ID,
      'SHIPMENT_SIGNED',
    )
  })

  it('keeps the order waiting when all shipments are delivered but the receipt is missing', async () => {
    const f = fixture([part({ deliveredAt: DELIVERED_AT })])
    f.transaction.salesOrderDocument.count.mockResolvedValue(0)
    await expect(f.autoSign()).resolves.toEqual({
      salesOrderSigned: false,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: true,
    })
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('does not advance the order while other shipments remain undelivered', async () => {
    const f = fixture([part(), part({ id: 'part-2', deliveredAt: DELIVERED_AT })])
    await expect(f.autoSign()).resolves.toEqual({
      salesOrderSigned: false,
      remainingShipmentCount: 1,
      salesOrderReceiptRequired: false,
    })
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('treats an already signed order as signed without writing again', async () => {
    const f = fixture([part({ deliveredAt: DELIVERED_AT })])
    f.transaction.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'PENDING_RECONCILIATION', fulfillmentStatus: 'SIGNED' })
    await expect(f.autoSign()).resolves.toEqual({
      salesOrderSigned: true,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: false,
    })
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })
})
