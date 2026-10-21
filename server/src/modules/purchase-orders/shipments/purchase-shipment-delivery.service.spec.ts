import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { DataScopeService } from '../../access-control/data-scope.service'
import type { AuditService } from '../../audit/audit.service'
import type { SalesOrderAutomaticStateService } from '../../sales-orders/sales-order-automatic-state.service'
import { PurchaseShipmentDeliveryService } from './purchase-shipment-delivery.service'
import type { PurchaseShipmentQueryService } from './purchase-shipment-query.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PART_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PART_ID = '22222222-2222-4222-8222-222222222222'
const LOADED_AT = new Date('2026-10-21T08:44:38.000Z')
const DELIVERED_AT = new Date('2026-10-21T08:55:21.000Z')
const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

function part(overrides: Record<string, unknown> = {}) {
  return {
    id: PART_ID,
    purchaseOrderId: 'po-1',
    shipmentNo: 'PKG/20261021-00001',
    partNumber: 1,
    status: 'ACTIVE',
    loadedAt: LOADED_AT,
    deliveredAt: null,
    ...overrides,
  }
}

function lockedPart(overrides: Record<string, unknown> = {}) {
  return {
    ...part(),
    purchaseOrder: {
      id: 'po-1',
      purchaseType: 'SALES_LINKED',
      orderStatus: 'CONFIRMED',
      salesOrderId: ORDER_ID,
    },
    ...overrides,
  }
}

function fixture(options: {
  readonly parts?: readonly Record<string, unknown>[]
  readonly orderFulfillment?: string
  readonly orderStatus?: string
  readonly receiptCount?: number
  readonly scope?: 'ALL' | 'SELF'
  readonly loaded?: boolean
} = {}) {
  let delivered = false
  let orderFulfillment = options.orderFulfillment ?? 'SEA_TRANSIT'
  const orderStatus = options.orderStatus ?? 'CONFIRMED'
  let parts = (options.parts ?? [part()]).map(item => ({ ...item }))

  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID, orderStatus, fulfillmentStatus: orderFulfillment }]),
    purchaseOrderPart: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockImplementation(() => Promise.resolve(lockedPart({
        loadedAt: options.loaded === false ? null : LOADED_AT,
        deliveredAt: delivered ? DELIVERED_AT : null,
      }))),
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockImplementation(() => Promise.resolve(lockedPart({
        loadedAt: options.loaded === false ? null : LOADED_AT,
        deliveredAt: delivered ? DELIVERED_AT : null,
      }))),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockImplementation(() => Promise.resolve(
        parts.map(item => ({ ...item, deliveredAt: item.id === PART_ID && delivered ? DELIVERED_AT : item.deliveredAt })),
      )),
      updateMany: jest.fn<Promise<{ count: number }>, [{ where: { id?: string | { in: string[] } } }]>().mockImplementation(({ where }) => {
        const ids = typeof where.id === 'string' ? [where.id] : where.id?.in ?? []
        if (!ids.includes(PART_ID)) return Promise.resolve({ count: 0 })
        delivered = true
        return Promise.resolve({ count: 1 })
      }),
    },
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockImplementation(() => Promise.resolve({
        orderStatus,
        fulfillmentStatus: orderFulfillment,
      })),
      update: jest.fn<Promise<unknown>, [unknown]>().mockImplementation(() => {
        orderFulfillment = 'SIGNED'
        return Promise.resolve({})
      }),
    },
    salesOrderDocument: {
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(options.receiptCount ?? 1),
    },
    salesOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
  }
  const prisma = {
    $transaction: jest.fn<Promise<unknown>, [(tx: typeof transaction) => Promise<unknown>]>(callback => callback(transaction)),
  }
  const audit = { record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}) }
  const queries = { getById: jest.fn<Promise<unknown>, [string, string]>().mockResolvedValue({ id: PART_ID }) }
  const automaticState = {
    advanceWhenEligible: jest.fn<Promise<'NONE'>, [unknown, unknown, string, string]>().mockResolvedValue('NONE'),
  }
  const dataScope = {
    resolveInTransaction: jest.fn().mockResolvedValue(options.scope ?? 'ALL'),
  }
  const service = new PurchaseShipmentDeliveryService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queries as unknown as PurchaseShipmentQueryService,
    automaticState as unknown as SalesOrderAutomaticStateService,
    dataScope as unknown as DataScopeService,
  )
  return {
    audit,
    automaticState,
    dataScope,
    parts,
    prisma,
    queries,
    service,
    setDelivered: (value: boolean) => { delivered = value },
    setParts: (value: readonly Record<string, unknown>[]) => { parts = value.map(item => ({ ...item })) },
    transaction,
  }
}

describe('PurchaseShipmentDeliveryService', () => {
  it('signs the shipment and auto signs the sales order when it is the last one with a receipt', async () => {
    const f = fixture()
    await expect(f.service.deliver(context, PART_ID, { remark: '  客户已收  ' })).resolves.toMatchObject({
      shipment: { id: PART_ID },
      salesOrderSigned: true,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: false,
    })
    expect(f.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
      where: {
        id: PART_ID,
        status: 'ACTIVE',
        loadedAt: { not: null },
        deliveredAt: null,
      },
      data: {
        deliveredAt: expect.any(Date) as unknown,
        deliveredById: ACTOR_ID,
        deliveredRecordedAt: expect.any(Date) as unknown,
        deliveryRemark: '客户已收',
      },
    })
    expect(f.audit.record).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'PURCHASE_SHIPMENT_DELIVERED',
      targetType: 'PURCHASE_ORDER_PART',
      targetId: PART_ID,
    }))
    const auditMetadata = (f.audit.record.mock.calls[0]?.[1] as { metadata: Record<string, unknown> }).metadata
    expect(auditMetadata).toMatchObject({ purchaseOrderId: 'po-1', salesOrderId: ORDER_ID, source: 'SHIPMENT_SIGN' })
    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { fulfillmentStatus: 'SIGNED', version: { increment: 1 } },
    })
    expect(f.automaticState.advanceWhenEligible).toHaveBeenCalledWith(
      f.transaction,
      context,
      ORDER_ID,
      'SHIPMENT_SIGNED',
    )
  })

  it('keeps the order waiting when other shipments are still undelivered', async () => {
    const f = fixture({ parts: [part(), part({ id: OTHER_PART_ID, shipmentNo: 'PKG/20261021-00002', partNumber: 2 })] })
    await expect(f.service.deliver(context, PART_ID, {})).resolves.toMatchObject({
      salesOrderSigned: false,
      remainingShipmentCount: 1,
      salesOrderReceiptRequired: false,
    })
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('keeps the order waiting when every shipment is delivered but the receipt is missing', async () => {
    const f = fixture({ receiptCount: 0 })
    await expect(f.service.deliver(context, PART_ID, {})).resolves.toMatchObject({
      salesOrderSigned: false,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: true,
    })
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('rejects signing when the sales order is not awaiting signature', async () => {
    const f = fixture({ orderFulfillment: 'WAREHOUSE_ARRIVED' })
    await expect(f.service.deliver(context, PART_ID, {})).rejects.toMatchObject({
      code: 'PURCHASE_SHIPMENT_DELIVERY_NOT_ALLOWED',
      message: expect.stringContaining('待签收') as unknown,
    })
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('rejects signing a shipment that is not loaded', async () => {
    const f = fixture({ loaded: false })
    await expect(f.service.deliver(context, PART_ID, {})).rejects.toMatchObject({
      code: 'PURCHASE_SHIPMENT_DELIVERY_NOT_ALLOWED',
      message: expect.stringContaining('装柜') as unknown,
    })
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('rejects signing while another shipment under the order is pending review', async () => {
    const f = fixture({ parts: [part(), part({ id: OTHER_PART_ID, status: 'PENDING_REVIEW' })] })
    await expect(f.service.deliver(context, PART_ID, {})).rejects.toMatchObject({
      code: 'PURCHASE_SHIPMENT_DELIVERY_NOT_ALLOWED',
      message: expect.stringContaining('待审核') as unknown,
    })
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('is idempotent for an already delivered shipment and repairs a missing order sign', async () => {
    const f = fixture()
    f.setDelivered(true)
    await expect(f.service.deliver(context, PART_ID, {})).resolves.toMatchObject({
      salesOrderSigned: true,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: false,
    })
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { fulfillmentStatus: 'SIGNED', version: { increment: 1 } },
    })
  })

  it('does not require a sales order for stock purchases and never advances one', async () => {
    const f = fixture({ parts: [part()] })
    f.transaction.purchaseOrderPart.findFirst.mockResolvedValue(lockedPart({
      purchaseOrder: { id: 'po-1', purchaseType: 'STOCK', orderStatus: 'CONFIRMED', salesOrderId: null },
    }))
    f.transaction.purchaseOrderPart.findUnique.mockResolvedValue(lockedPart({
      purchaseOrder: { id: 'po-1', purchaseType: 'STOCK', orderStatus: 'CONFIRMED', salesOrderId: null },
    }))
    await expect(f.service.deliver(context, PART_ID, {})).resolves.toMatchObject({
      salesOrderSigned: false,
      remainingShipmentCount: 0,
      salesOrderReceiptRequired: false,
    })
    // 事务超时设置 + 货件行锁，没有销售订单锁。
    expect(f.transaction.$queryRaw).toHaveBeenCalledTimes(2)
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('returns 404 for a shipment outside the actor scope', async () => {
    const f = fixture({ scope: 'SELF' })
    f.transaction.purchaseOrderPart.findFirst.mockResolvedValue(null)
    await expect(f.service.deliver(context, PART_ID, {})).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PART_NOT_FOUND' })
    expect(f.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
    expect(f.transaction.purchaseOrderPart.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ purchaseOrder: { is: { salesOrder: { is: { issuerUserId: ACTOR_ID } } } } }) as unknown,
    }))
  })

  it('fails closed when the shipment was changed concurrently', async () => {
    const f = fixture()
    f.transaction.purchaseOrderPart.updateMany.mockResolvedValue({ count: 0 })
    await expect(f.service.deliver(context, PART_ID, {})).rejects.toMatchObject({ code: 'PURCHASE_SHIPMENT_DELIVERY_STATE_CHANGED' })
  })
})
