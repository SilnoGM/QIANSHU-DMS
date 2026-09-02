import { HttpStatus } from '@nestjs/common'

import type {
  AuditService,
  RecordAuditEventInput,
} from '../audit/audit.service'
import { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { SalesOrderAddOnService } from './sales-order-add-on.service'

jest.mock(
  '../../infrastructure/database/transaction-timeouts',
  () => ({ applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined) }),
)

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const REVISION_ID = '44444444-4444-4444-8444-444444444444'

function decimal(value: string) {
  return { toFixed: () => Number(value).toFixed(4) }
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PAID',
    currencyCode: 'TWD',
    lineSubtotalAmount: decimal('300'),
    agreedTotalAmount: decimal('300'),
    depositDueAmount: decimal('100'),
    balanceDueAmount: decimal('200'),
    version: 4,
    lines: [{ id: 'sales-line-a', lineNumber: 1, quantity: 2 }, {
      id: 'sales-line-b', lineNumber: 2, quantity: 1,
    }],
    ...overrides,
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    expectedVersion: 4,
    supplierValue: 'SUPPLIER_TW_01',
    reason: '客户加购产品',
    lines: [{
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      actualUnitPriceAmount: '50',
      quantity: 2,
    }, {
      lineType: 'CUSTOM',
      name: '现场安装服务',
      description: '客户加购',
      actualUnitPriceAmount: '30',
      quantity: 1,
    }],
    ...overrides,
  }
}

function setup() {
  const createMany = jest.fn<
    Promise<{ count: number }>,
    [{ data: readonly Record<string, unknown>[] }]
  >().mockResolvedValue({ count: 2 })
  const createStatusHistory = jest.fn<
    Promise<{ id: string }>,
    [{ data: Record<string, unknown> }]
  >().mockResolvedValue({ id: 'history-id' })
  const transaction = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: ORDER_ID }])
      .mockResolvedValueOnce([{ id: 'dictionary-type-id', enabled: true }])
      .mockResolvedValueOnce([{
        value: 'SUPPLIER_TW_01', label: '供应商甲', tone: 'DEFAULT', enabled: true,
      }]),
    salesOrder: {
      findUnique: jest.fn().mockResolvedValue(orderRow()),
      update: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    },
    purchaseOrder: { count: jest.fn().mockResolvedValue(1) },
    purchaseOrderLine: {
      findMany: jest.fn().mockResolvedValue([{
        sourceSalesOrderLineId: 'sales-line-a', quantity: 2,
      }, {
        sourceSalesOrderLineId: 'sales-line-b', quantity: 1,
      }]),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([{
        id: PRODUCT_ID,
        productNo: 'P-001',
        name: '目录产品',
        attributes: [],
        supplierValue: 'SUPPLIER_TW_01',
        twdSalePriceAmount: decimal('55'),
        myrSalePriceAmount: decimal('9'),
      }]),
    },
    salesOrderPayment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: decimal('300') } }),
    },
    salesOrderLine: { createMany },
    salesOrderAmountRevision: {
      create: jest.fn().mockResolvedValue({ id: REVISION_ID }),
    },
    salesOrderStatusHistory: { create: createStatusHistory },
  }
  const prisma = {
    $transaction: jest.fn((
      operation: (client: typeof transaction) => unknown,
    ) => Promise.resolve(operation(transaction))),
  }
  const auditRecord = jest.fn<
    Promise<Record<string, string>>,
    [unknown, RecordAuditEventInput]
  >().mockResolvedValue({ id: 'audit-id' })
  const audit = { record: auditRecord }
  const dictionaryLookup = new DictionaryLookupService(
    prisma as unknown as PrismaService,
  )
  const service = new SalesOrderAddOnService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    dictionaryLookup,
  )
  return { audit, prisma, service, transaction }
}

describe('SalesOrderAddOnService', () => {
  it('locks, appends independent lines and atomically updates amounts, payment and audits', async () => {
    const fixture = setup()

    const result = await fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-1',
    }, ORDER_ID, input())
    expect(result).toMatchObject({
      salesOrderId: ORDER_ID,
      previousVersion: 4,
      version: 5,
      amountDelta: '130.0000',
      paymentStatus: 'PARTIALLY_PAID',
      amounts: {
        lineSubtotalAmount: '430.0000',
        agreedTotalAmount: '430.0000',
        depositDueAmount: '100.0000',
        balanceDueAmount: '330.0000',
        paidAmount: '300.0000',
        outstandingAmount: '130.0000',
      },
    })
    expect(result.addedLineIds).toHaveLength(2)
    for (const addedLineId of result.addedLineIds) {
      expect(addedLineId).toMatch(/^[0-9a-f-]{36}$/u)
    }

    const lockOrder = fixture.transaction.$queryRaw.mock.invocationCallOrder[0]
    const readOrder = fixture.transaction.salesOrder.findUnique.mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(readOrder ?? 0)
    const createdLines = fixture.transaction.salesOrderLine.createMany.mock
      .calls[0]?.[0].data
    expect(createdLines).toEqual([
      expect.objectContaining({
        salesOrderId: ORDER_ID,
        lineNumber: 3,
        lineType: 'CATALOG',
        productId: PRODUCT_ID,
        productNameSnapshot: '目录产品',
        standardUnitPriceAmount: '55.0000',
        actualUnitPriceAmount: '50.0000',
        quantity: 2,
        lineTotalAmount: '100.0000',
      }),
      expect.objectContaining({
        salesOrderId: ORDER_ID,
        lineNumber: 4,
        lineType: 'CUSTOM',
        productNameSnapshot: '现场安装服务',
        actualUnitPriceAmount: '30.0000',
        quantity: 1,
        lineTotalAmount: '30.0000',
      }),
    ])
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        lineSubtotalAmount: '430.0000',
        agreedTotalAmount: '430.0000',
        depositDueAmount: '100.0000',
        balanceDueAmount: '330.0000',
        paymentStatus: 'PARTIALLY_PAID',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.salesOrderAmountRevision.create)
      .toHaveBeenCalledWith({
        data: {
          salesOrderId: ORDER_ID,
          oldLineSubtotalAmount: '300.0000',
          oldAgreedTotalAmount: '300.0000',
          oldDepositDueAmount: '100.0000',
          oldBalanceDueAmount: '200.0000',
          newLineSubtotalAmount: '430.0000',
          newAgreedTotalAmount: '430.0000',
          newDepositDueAmount: '100.0000',
          newBalanceDueAmount: '330.0000',
          reason: '客户加购产品',
          changedByUserId: ACTOR_ID,
        },
        select: { id: true },
      })
    const statusHistoryData = fixture.transaction.salesOrderStatusHistory
      .create.mock.calls[0]?.[0].data
    expect(statusHistoryData).toMatchObject({
      dimension: 'PAYMENT',
      fromStatus: 'PAID',
      toStatus: 'PARTIALLY_PAID',
    })
    expect(fixture.audit.record).toHaveBeenCalledTimes(2)
    for (const auditCall of fixture.audit.record.mock.calls) {
      expect(auditCall[1]).toMatchObject({
        eventType: 'SALES_ORDER_PRODUCT_APPENDED',
        targetType: 'SALES_ORDER_LINE',
        requestId: 'request-add-on-1',
        metadata: {
          salesOrderId: ORDER_ID,
          amountRevisionId: REVISION_ID,
          operationAmountDelta: '130.0000',
          reason: '客户加购产品',
          supplierValue: 'SUPPLIER_TW_01',
          previousVersion: 4,
          version: 5,
        },
      })
      expect(Object.keys(auditCall[1].metadata ?? {}).sort()).toEqual([
        'amountRevisionId',
        'lineAmountDelta',
        'lineNumber',
        'lineType',
        'operationAmountDelta',
        'previousVersion',
        'reason',
        'salesOrderId',
        'supplierValue',
        'version',
      ])
    }
  })

  it('rejects a stale expectedVersion before any write', async () => {
    const fixture = setup()

    await expect(fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-2',
    }, ORDER_ID, input({ expectedVersion: 3 }))).rejects.toMatchObject({
      code: 'SALES_ORDER_ADD_ON_VERSION_CONFLICT',
    })
    expect(fixture.transaction.salesOrderLine.createMany).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('maps a nested PostgreSQL serialization failure to the stable version conflict', async () => {
    const fixture = setup()
    fixture.prisma.$transaction.mockRejectedValue({
      code: 'P2010',
      meta: { database_error: { code: '40001' } },
    })

    await expect(fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-serialization',
    }, ORDER_ID, input())).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      code: 'SALES_ORDER_ADD_ON_VERSION_CONFLICT',
    })
  })

  it.each([
    ['SEA_TRANSIT', 1, 3],
    ['SIGNED', 1, 3],
    ['PREPARING', 0, 3],
    ['PREPARING', 1, 2],
  ])('rejects ineligible facts for %s with active=%i purchased=%i', async (
    fulfillmentStatus,
    activePurchaseOrderCount,
    purchasedQuantity,
  ) => {
    const fixture = setup()
    fixture.transaction.salesOrder.findUnique.mockResolvedValue(orderRow({
      fulfillmentStatus,
    }))
    fixture.transaction.purchaseOrder.count.mockResolvedValue(activePurchaseOrderCount)
    fixture.transaction.purchaseOrderLine.findMany.mockResolvedValue([{
      sourceSalesOrderLineId: 'sales-line-a', quantity: purchasedQuantity,
    }])

    await expect(fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-3',
    }, ORDER_ID, input())).rejects.toMatchObject({
      code: 'SALES_ORDER_ADD_ON_NOT_ALLOWED',
    })
    expect(fixture.transaction.salesOrderLine.createMany).not.toHaveBeenCalled()
  })

  it('rejects a non-confirmed order without writing any add-on fact', async () => {
    const fixture = setup()
    fixture.transaction.salesOrder.findUnique.mockResolvedValue(orderRow({
      orderStatus: 'CANCELLED',
    }))

    await expect(fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-non-confirmed',
    }, ORDER_ID, input())).rejects.toMatchObject({
      code: 'SALES_ORDER_ADD_ON_NOT_ALLOWED',
    })
    expect(fixture.transaction.salesOrderLine.createMany).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrderAmountRevision.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('rejects a disabled or supplier-mismatched product and the cumulative line limit', async () => {
    const unavailableProduct = setup()
    unavailableProduct.transaction.product.findMany.mockResolvedValue([])
    await expect(unavailableProduct.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-4',
    }, ORDER_ID, input())).rejects.toMatchObject({
      code: 'SALES_ORDER_ADD_ON_PRODUCT_SUPPLIER_MISMATCH',
    })

    const lineLimit = setup()
    lineLimit.transaction.salesOrder.findUnique.mockResolvedValue(orderRow({
      lines: Array.from({ length: 100 }, (_, index) => ({
        id: `sales-line-${index}`,
        lineNumber: index + 1,
        quantity: 1,
      })),
    }))
    lineLimit.transaction.purchaseOrderLine.findMany.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => ({
        sourceSalesOrderLineId: `sales-line-${index}`,
        quantity: 1,
      })),
    )
    await expect(lineLimit.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-5',
    }, ORDER_ID, input({ lines: [input().lines[0]] }))).rejects.toMatchObject({
      code: 'SALES_ORDER_LINE_LIMIT_EXCEEDED',
    })
  })

  it('rejects a supplier dictionary value that becomes ineffective under the lock', async () => {
    const fixture = setup()
    fixture.transaction.$queryRaw.mockReset()
      .mockResolvedValueOnce([{ id: ORDER_ID }])
      .mockResolvedValueOnce([{ id: 'dictionary-type-id', enabled: true }])
      .mockResolvedValueOnce([{
        value: 'SUPPLIER_TW_01',
        label: '供应商甲',
        tone: 'DEFAULT',
        enabled: false,
      }])

    await expect(fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-disabled-supplier',
    }, ORDER_ID, input())).rejects.toMatchObject({
      code: 'SALES_ORDER_ADD_ON_SUPPLIER_UNAVAILABLE',
    })
    expect(fixture.transaction.salesOrderLine.createMany).not.toHaveBeenCalled()
  })

  it('keeps payment history untouched when the derived payment status is unchanged', async () => {
    const fixture = setup()
    fixture.transaction.salesOrder.findUnique.mockResolvedValue(orderRow({
      paymentStatus: 'PARTIALLY_PAID',
    }))
    fixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('100') },
    })

    await expect(fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-payment-unchanged',
    }, ORDER_ID, input())).resolves.toMatchObject({
      paymentStatus: 'PARTIALLY_PAID',
      amounts: { paidAmount: '100.0000', outstandingAmount: '330.0000' },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        lineSubtotalAmount: '430.0000',
        agreedTotalAmount: '430.0000',
        depositDueAmount: '100.0000',
        balanceDueAmount: '330.0000',
        paymentStatus: 'PARTIALLY_PAID',
        version: { increment: 1 },
      },
    })
  })

  it('appends repeated catalog selections as independent lines without merging old facts', async () => {
    const fixture = setup()
    const catalogLine = input().lines[0]

    await fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-repeated-product',
    }, ORDER_ID, input({ lines: [catalogLine, catalogLine] }))

    const createdLines = fixture.transaction.salesOrderLine.createMany.mock
      .calls[0]?.[0].data
    expect(createdLines).toHaveLength(2)
    expect(createdLines?.map(line => ({
      lineNumber: line.lineNumber,
      productId: line.productId,
      quantity: line.quantity,
    }))).toEqual([
      { lineNumber: 3, productId: PRODUCT_ID, quantity: 2 },
      { lineNumber: 4, productId: PRODUCT_ID, quantity: 2 },
    ])
    expect(Object.keys(fixture.transaction.salesOrderLine)).toEqual(['createMany'])
  })

  it.each([
    'sales-line',
    'amount-revision',
    'payment-history',
    'order-update',
    'audit',
  ])('propagates a %s write failure and never returns partial success', async (step) => {
    const fixture = setup()
    const failure = new Error('database write failed')
    if (step === 'sales-line') {
      fixture.transaction.salesOrderLine.createMany.mockRejectedValue(failure)
    }
    else if (step === 'amount-revision') {
      fixture.transaction.salesOrderAmountRevision.create.mockRejectedValue(failure)
    }
    else if (step === 'payment-history') {
      fixture.transaction.salesOrderStatusHistory.create.mockRejectedValue(failure)
    }
    else if (step === 'order-update') {
      fixture.transaction.salesOrder.update.mockRejectedValue(failure)
    }
    else {
      fixture.audit.record.mockRejectedValue(failure)
    }

    await expect(fixture.service.appendLines({
      actorUserId: ACTOR_ID,
      requestId: 'request-add-on-6',
    }, ORDER_ID, input())).rejects.toThrow()
  })
})
