import { HttpStatus } from '@nestjs/common'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import { SalesOrderProductEditService } from './sales-order-product-edit.service'

jest.mock(
  '../../infrastructure/database/transaction-timeouts',
  () => ({ applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined) }),
)

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const LINE_A_ID = '33333333-3333-4333-8333-333333333333'
const LINE_B_ID = '44444444-4444-4444-8444-444444444444'
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555'

function decimal(value: string) {
  return { toFixed: () => Number(value).toFixed(2) }
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    currencyCode: 'TWD',
    lineSubtotalAmount: decimal('300'),
    agreedTotalAmount: decimal('300'),
    depositDueAmount: decimal('100'),
    balanceDueAmount: decimal('200'),
    version: 4,
    lines: [{
      id: LINE_A_ID,
      lineNumber: 1,
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      productNameSnapshot: '原目录产品',
      descriptionSnapshot: null,
      actualUnitPriceAmount: decimal('50'),
      quantity: 2,
      lineTotalAmount: decimal('100'),
    }, {
      id: LINE_B_ID,
      lineNumber: 2,
      lineType: 'CUSTOM',
      productId: null,
      productNameSnapshot: '原临时产品',
      descriptionSnapshot: '原备注',
      actualUnitPriceAmount: decimal('200'),
      quantity: 1,
      lineTotalAmount: decimal('200'),
    }],
    ...overrides,
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    expectedVersion: 4,
    reason: '客户调整产品',
    confirmDepositReduction: false,
    existingLines: [{
      lineId: LINE_A_ID,
      name: '修改后的目录产品',
      description: '目录备注',
      actualUnitPriceAmount: '60',
      desiredQuantity: 3,
    }, {
      lineId: LINE_B_ID,
      name: '原临时产品',
      description: '原备注',
      actualUnitPriceAmount: '200',
      desiredQuantity: 0,
    }],
    newLines: [{
      lineType: 'CUSTOM',
      name: '现场服务',
      description: null,
      actualUnitPriceAmount: '30',
      quantity: 1,
    }],
    ...overrides,
  }
}

interface TestLineUpdateInput {
  readonly where: { readonly id: string }
  readonly data: {
    readonly quantity?: number
    readonly lineTotalAmount?: string
    readonly removedAt?: Date
    readonly productNameSnapshot?: string
    readonly descriptionSnapshot?: string | null
    readonly actualUnitPriceAmount?: string
  }
}

function setup(overrides: {
  readonly order?: Record<string, unknown>
  readonly purchasedRows?: readonly Record<string, unknown>[]
  readonly activePurchaseOrderCount?: number
  readonly paidAmount?: string
} = {}) {
  const queryRaw = jest.fn<Promise<Array<{ readonly id: string }>>, [unknown]>()
    .mockResolvedValueOnce([{ id: LINE_A_ID }, { id: LINE_B_ID }])
    .mockResolvedValueOnce([{ id: ORDER_ID }])
  const lineUpdate = jest.fn<Promise<Record<string, never>>, [TestLineUpdateInput]>()
    .mockResolvedValue({})
  const statusHistoryCreate = jest.fn<
    Promise<{ readonly id: string }>,
    [{ readonly data: Record<string, unknown> }]
  >().mockResolvedValue({ id: 'history-id' })
  const transaction = {
    $queryRaw: queryRaw,
    salesOrder: {
      findUnique: jest.fn().mockResolvedValue(orderRow(overrides.order)),
      update: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    },
    salesOrderLine: {
      update: lineUpdate,
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    purchaseOrder: {
      count: jest.fn().mockResolvedValue(overrides.activePurchaseOrderCount ?? 1),
    },
    purchaseOrderLine: {
      findMany: jest.fn().mockResolvedValue(overrides.purchasedRows ?? [{
        sourceSalesOrderLineId: LINE_A_ID,
        quantity: 2,
        purchaseOrder: { orderStatus: 'CONFIRMED' },
      }]),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    salesReceiptRequest: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
    salesOrderPayment: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: decimal(overrides.paidAmount ?? '80') },
      }),
    },
    salesOrderAmountRevision: {
      create: jest.fn().mockResolvedValue({ id: 'revision-id' }),
    },
    salesOrderStatusHistory: {
      create: statusHistoryCreate,
    },
  }
  const prisma = {
    $transaction: jest.fn((operation: (client: typeof transaction) => unknown) => (
      Promise.resolve(operation(transaction))
    )),
  }
  const audit = {
    record: jest.fn<
      ReturnType<AuditService['record']>,
      Parameters<AuditService['record']>
    >(),
  }
  return {
    audit,
    prisma,
    transaction,
    service: new SalesOrderProductEditService(
      prisma as unknown as PrismaService,
      audit,
    ),
  }
}

describe('SalesOrderProductEditService', () => {
  it.each(['PENDING_REVIEW', 'CONFIRMED', 'COMPLETED'])(
    'keeps %s quantities reserved while requiring approved coverage to advance',
    async (orderStatus) => {
      const fixture = setup({
        order: { fulfillmentStatus: 'PENDING' },
        purchasedRows: [{
          sourceSalesOrderLineId: LINE_A_ID, quantity: 2,
          purchaseOrder: { orderStatus },
        }, {
          sourceSalesOrderLineId: LINE_B_ID, quantity: 1,
          purchaseOrder: { orderStatus: 'CONFIRMED' },
        }],
      })
      const existingLines = input().existingLines.map((line, index) => ({
        ...line, desiredQuantity: index === 0 ? 2 : 1,
      }))
      const result = await fixture.service.updateProducts({
        actorUserId: ACTOR_ID, requestId: 'product-edit-approved-coverage',
      }, ORDER_ID, input({ existingLines, newLines: [] }))
      expect(result.fulfillmentStatus).toBe(orderStatus === 'PENDING_REVIEW' ? 'PENDING' : 'PREPARING')

      for (const desiredQuantity of [0, 1]) {
        const reserved = setup({ purchasedRows: [{
          sourceSalesOrderLineId: LINE_A_ID, quantity: 2, purchaseOrder: { orderStatus },
        }] })
        await expect(reserved.service.updateProducts({
          actorUserId: ACTOR_ID, requestId: 'product-edit-pending-reservation',
        }, ORDER_ID, input({
          existingLines: existingLines.map((line, index) => ({
            ...line, desiredQuantity: index === 0 ? desiredQuantity : line.desiredQuantity,
          })),
          newLines: [],
        }))).rejects.toMatchObject({ code: 'SALES_ORDER_PRODUCT_DECREASE_PURCHASE_LOCKED' })
        expect(reserved.transaction.salesOrder.update).not.toHaveBeenCalled()
      }
      expect(fixture.transaction.purchaseOrderLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {
          sourceSalesOrderLineId: { in: [LINE_A_ID, LINE_B_ID] },
          purchaseOrder: { is: {
            purchaseType: 'SALES_LINKED', salesOrderId: ORDER_ID,
            orderStatus: { not: 'CANCELLED' },
          } },
        } }),
      )
    },
  )

  it('locks lines before order and atomically updates products, amounts and fulfillment', async () => {
    const fixture = setup()

    await expect(fixture.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-1',
    }, ORDER_ID, input())).resolves.toMatchObject({
      salesOrderId: ORDER_ID,
      previousVersion: 4,
      version: 5,
      updatedLineIds: [LINE_A_ID],
      removedLineIds: [LINE_B_ID],
      addedLineIds: [expect.any(String)],
      amountDelta: '-90.00',
      fulfillmentStatus: 'PENDING',
      paymentStatus: 'PARTIALLY_PAID',
      depositReduced: false,
      amounts: {
        lineSubtotalAmount: '210.00',
        agreedTotalAmount: '210.00',
        depositDueAmount: '100.00',
        balanceDueAmount: '110.00',
        paidAmount: '80.00',
        outstandingAmount: '130.00',
      },
    })

    const sqlCalls = fixture.transaction.$queryRaw.mock.calls.map(call => (
      (call[0] as { strings: readonly string[] }).strings.join(' ')
    ))
    expect(sqlCalls[0]).toContain('sales_order_lines')
    expect(sqlCalls[0]).toContain('removed_at')
    expect(sqlCalls[0]).toContain('ORDER BY "id"')
    expect(sqlCalls[0]).toContain('FOR UPDATE')
    expect(sqlCalls[1]).toContain('sales_orders')
    expect(fixture.transaction.salesOrderLine.update).toHaveBeenCalledWith({
      where: { id: LINE_A_ID },
      data: {
        productNameSnapshot: '修改后的目录产品',
        descriptionSnapshot: '目录备注',
        actualUnitPriceAmount: '60.00',
        quantity: 3,
        lineTotalAmount: '180.00',
      },
    })
    const removalWrite = fixture.transaction.salesOrderLine.update.mock.calls
      .find(([write]) => write.where.id === LINE_B_ID)?.[0]
    expect(removalWrite?.data.removedAt).toBeInstanceOf(Date)
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        lineSubtotalAmount: '210.00',
        agreedTotalAmount: '210.00',
        depositDueAmount: '100.00',
        balanceDueAmount: '110.00',
        fulfillmentStatus: 'PENDING',
        paymentStatus: 'PARTIALLY_PAID',
        version: { increment: 1 },
      },
    })
    const historyWrites = fixture.transaction.salesOrderStatusHistory.create.mock.calls
      .map(([write]) => write.data)
    expect(historyWrites).toContainEqual(expect.objectContaining({
      dimension: 'FULFILLMENT',
      fromStatus: 'PREPARING',
      toStatus: 'PENDING',
    }))
    expect(fixture.audit.record).toHaveBeenCalledTimes(1)
    const auditInput = fixture.audit.record.mock.calls[0]?.[1]
    expect(auditInput).toMatchObject({
      eventType: 'SALES_ORDER_PRODUCTS_CHANGED',
      targetType: 'SALES_ORDER',
      targetId: ORDER_ID,
      requestId: 'product-edit-1',
      metadata: {
        removedLineIds: [LINE_B_ID],
        amountDelta: '-90.00',
        previousVersion: 4,
        version: 5,
      },
    })
    expect(auditInput?.metadata?.quantityChanges).toEqual(expect.arrayContaining([
      { lineId: LINE_A_ID, from: 2, to: 3 },
      { lineId: LINE_B_ID, from: 1, to: 0 },
    ]))
  })

  it('rejects a decrease below the active purchased quantity', async () => {
    const fixture = setup()

    await expect(fixture.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-locked',
    }, ORDER_ID, input({
      existingLines: [{
        lineId: LINE_A_ID,
        name: '原目录产品',
        description: null,
        actualUnitPriceAmount: '50',
        desiredQuantity: 1,
      }, {
        lineId: LINE_B_ID,
        name: '原临时产品',
        description: '原备注',
        actualUnitPriceAmount: '200',
        desiredQuantity: 1,
      }],
      newLines: [],
    }))).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'SALES_ORDER_PRODUCT_DECREASE_PURCHASE_LOCKED',
    })
    expect(fixture.transaction.salesOrderLine.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('allows a purchased line to decrease to its purchased quantity and updates only sales snapshots', async () => {
    const fixture = setup({
      order: {
        lineSubtotalAmount: decimal('350'),
        agreedTotalAmount: decimal('350'),
        balanceDueAmount: decimal('250'),
        lines: [{
          id: LINE_A_ID,
          lineNumber: 1,
          lineType: 'CATALOG',
          productId: PRODUCT_ID,
          productNameSnapshot: '原目录产品',
          descriptionSnapshot: null,
          actualUnitPriceAmount: decimal('50'),
          quantity: 3,
          lineTotalAmount: decimal('150'),
        }, {
          id: LINE_B_ID,
          lineNumber: 2,
          lineType: 'CUSTOM',
          productId: null,
          productNameSnapshot: '原临时产品',
          descriptionSnapshot: '原备注',
          actualUnitPriceAmount: decimal('200'),
          quantity: 1,
          lineTotalAmount: decimal('200'),
        }],
      },
    })

    await expect(fixture.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-snapshot',
    }, ORDER_ID, input({
      existingLines: [{
        lineId: LINE_A_ID,
        name: '销售快照新名称',
        description: '销售快照新备注',
        actualUnitPriceAmount: '55',
        desiredQuantity: 2,
      }, {
        lineId: LINE_B_ID,
        name: '原临时产品',
        description: '原备注',
        actualUnitPriceAmount: '200',
        desiredQuantity: 1,
      }],
      newLines: [],
    }))).resolves.toMatchObject({
      amountDelta: '-40.00',
      updatedLineIds: [LINE_A_ID],
      removedLineIds: [],
      amounts: { lineSubtotalAmount: '310.00' },
    })
    expect(fixture.transaction.salesOrderLine.update).toHaveBeenCalledWith({
      where: { id: LINE_A_ID },
      data: {
        productNameSnapshot: '销售快照新名称',
        descriptionSnapshot: '销售快照新备注',
        actualUnitPriceAmount: '55.00',
        quantity: 2,
        lineTotalAmount: '110.00',
      },
    })
    expect(fixture.transaction.product.findMany).not.toHaveBeenCalled()
  })

  it('requires explicit deposit reduction confirmation and then lowers deposit', async () => {
    const fixture = setup({
      order: {
        fulfillmentStatus: 'PENDING',
        depositDueAmount: decimal('250'),
        balanceDueAmount: decimal('50'),
      },
    })
    const reductionInput = input({
      existingLines: [{
        lineId: LINE_A_ID,
        name: '原目录产品',
        description: null,
        actualUnitPriceAmount: '50',
        desiredQuantity: 2,
      }, {
        lineId: LINE_B_ID,
        name: '原临时产品',
        description: '原备注',
        actualUnitPriceAmount: '200',
        desiredQuantity: 0,
      }],
      newLines: [],
    })

    await expect(fixture.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-deposit-missing',
    }, ORDER_ID, reductionInput)).rejects.toMatchObject({
      code: 'SALES_ORDER_DEPOSIT_REDUCTION_CONFIRMATION_REQUIRED',
    })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()

    const confirmed = setup({
      order: {
        fulfillmentStatus: 'PENDING',
        depositDueAmount: decimal('250'),
        balanceDueAmount: decimal('50'),
      },
    })
    await expect(confirmed.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-deposit-confirmed',
    }, ORDER_ID, {
      ...reductionInput,
      confirmDepositReduction: true,
    })).resolves.toMatchObject({
      depositReduced: true,
      fulfillmentStatus: 'PREPARING',
      amounts: {
        agreedTotalAmount: '100.00',
        depositDueAmount: '100.00',
        balanceDueAmount: '0.00',
      },
    })
  })

  it('rejects a total below active receipts before writing', async () => {
    const fixture = setup({ paidAmount: '150' })

    await expect(fixture.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-below-paid',
    }, ORDER_ID, input({
      confirmDepositReduction: true,
      existingLines: [{
        lineId: LINE_A_ID,
        name: '原目录产品',
        description: null,
        actualUnitPriceAmount: '50',
        desiredQuantity: 2,
      }, {
        lineId: LINE_B_ID,
        name: '原临时产品',
        description: '原备注',
        actualUnitPriceAmount: '200',
        desiredQuantity: 0,
      }],
      newLines: [],
    }))).rejects.toMatchObject({ code: 'SALES_ORDER_TOTAL_BELOW_RECEIVED' })
    expect(fixture.transaction.salesOrderLine.update).not.toHaveBeenCalled()
  })

  it.each([
    ['version', { expectedVersion: 3 }, 'SALES_ORDER_PRODUCT_EDIT_VERSION_CONFLICT'],
    ['line set', { existingLines: [{
      lineId: LINE_A_ID,
      name: '原目录产品',
      description: null,
      actualUnitPriceAmount: '50',
      desiredQuantity: 2,
    }] }, 'SALES_ORDER_PRODUCT_EDIT_STATE_CHANGED'],
  ])('rejects a stale %s before writes', async (_name, override, code) => {
    const fixture = setup()

    await expect(fixture.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-stale',
    }, ORDER_ID, input(override))).rejects.toMatchObject({ code })
    expect(fixture.transaction.salesOrderLine.update).not.toHaveBeenCalled()
  })

  it('maps serialization conflicts to the stable product-edit conflict', async () => {
    const fixture = setup()
    fixture.prisma.$transaction.mockRejectedValue({
      code: 'P2010', meta: { database_error: { code: '40001' } },
    })

    await expect(fixture.service.updateProducts({
      actorUserId: ACTOR_ID,
      requestId: 'product-edit-concurrent',
    }, ORDER_ID, input())).rejects.toMatchObject({
      code: 'SALES_ORDER_PRODUCT_EDIT_VERSION_CONFLICT',
      status: HttpStatus.CONFLICT,
    })
  })
})
