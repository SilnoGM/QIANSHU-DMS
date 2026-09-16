import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import type { PurchaseShippingMarkResolverService } from '../purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { normalizePurchaseOrderCreateCommand } from './purchase-order-command.normalizer'
import { PurchaseOrderCommandService } from './purchase-order-command.service'
import type { PurchaseShipmentNumberingService } from './shipments/purchase-shipment-numbering.service'
import type {
  PurchaseOrderCreateDependencyService,
} from './purchase-order-create-dependency.service'
import { calculatePurchaseOrderCreateFingerprint } from './purchase-order-create-fingerprint'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_LINE_ID = '33333333-3333-4333-8333-333333333333'
const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000'

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    parts: [{ key: ACTOR_ID, items: [{ lineNumber: 1, quantity: 2 }] }],
    purchaseType: 'SALES_LINKED',
    productMode: 'CATALOG',
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    supplierValue: 'SUPPLIER_A',
    orderDate: '2026-08-27',
    expectedShippingMarkResolution: 'a'.repeat(64),
    lines: [{
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      sourceSalesOrderLineId: SOURCE_LINE_ID,
      actualPurchaseUnitPriceAmount: '10',
      quantity: 2,
    }],
    purchaseTotalAmount: '20',
    depositDueAmount: '5',
    balanceDueAmount: '15',
    remark: null,
    ...overrides,
  }
}

function setup() {
  const transaction = {
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([]),
    purchaseOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(null),
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: ORDER_ID }),
    },
    purchaseOrderLine: {
      findMany: jest.fn().mockResolvedValue([{ id: PRODUCT_ID, lineNumber: 1 }]),
      createMany: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ count: 1 }),
    },
    purchaseOrderPart: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    purchaseOrderPartItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  }
  const prisma = {
    purchaseOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(null),
    },
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: typeof transaction) => Promise<unknown>, unknown?]
    >(callback => callback(transaction)),
  }
  const numbering = {
    generateScopedInTransaction: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({
      number: 'AUTO-0001', issuanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ruleRevision: 1, idempotentReplay: false,
    }),
    generateScoped: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
      number: 'PO-20260827-0001',
      idempotentReplay: false,
    }),
  }
  const shipmentNumbers = { issue: jest.fn().mockResolvedValue([{ shipmentNo: 'SHIP/0001', numberingIssuanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }]) }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const dependencies = {
    requireDependencies: jest.fn<Promise<unknown>, [unknown, unknown, string, unknown]>()
      .mockResolvedValue({
        lines: [{
          lineNumber: 1,
          lineType: 'CATALOG',
          productId: PRODUCT_ID,
          sourceSalesOrderLineId: SOURCE_LINE_ID,
          productNoSnapshot: 'P-001',
          productNameSnapshot: '销售快照产品',
          productAttributesSnapshot: [],
          descriptionSnapshot: null,
          referencePurchaseUnitPriceAmount: '12.35',
          actualPurchaseUnitPriceAmount: '10.00',
          quantity: 2,
          lineTotalAmount: '20.00',
        }],
      }),
  }
  const resolver = {
    resolve: jest.fn<Promise<unknown>, [unknown, unknown, boolean]>().mockResolvedValue({
      availability: 'AVAILABLE', resolutionToken: 'a'.repeat(64),
      ruleId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ruleCode: 'TEST_MARK', activeRevision: 1,
    }),
  }
  const service = new PurchaseOrderCommandService(
    prisma as unknown as PrismaService,
    numbering as unknown as NumberingGeneratorService,
    audit as unknown as AuditService,
    dependencies as unknown as PurchaseOrderCreateDependencyService,
    resolver as unknown as PurchaseShippingMarkResolverService,
    shipmentNumbers as unknown as PurchaseShipmentNumberingService,
    { businessToday: () => '2026-08-27' },
  )
  return {
    audit,
    dependencies,
    numbering,
    prisma,
    resolver,
    shipmentNumbers,
    service,
    transaction,
  }
}

describe('PurchaseOrderCommandService', () => {
  const context = { actorUserId: ACTOR_ID, requestId: 'mark-create', idempotencyKey: IDEMPOTENCY_KEY }

  it('issues shipment numbers in the business transaction and aborts creation when numbering is unavailable', async () => {
    const fixture = setup()
    fixture.shipmentNumbers.issue.mockRejectedValue(new ApiException(409, 'PURCHASE_SHIPMENT_NUMBERING_UNAVAILABLE', 'Unavailable'))
    await expect(fixture.service.create(context, input())).rejects.toMatchObject({ code: 'PURCHASE_SHIPMENT_NUMBERING_UNAVAILABLE' })
    expect(fixture.shipmentNumbers.issue).toHaveBeenCalledWith(fixture.transaction, [expect.objectContaining({ purchaseOrderId: ORDER_ID, key: ACTOR_ID })])
    expect(fixture.transaction.purchaseOrderPart.createMany).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it.each([
    ['40001', 409, 'PURCHASE_ORDER_STATE_CHANGED'],
    ['23514', 500, 'INTERNAL_ERROR'],
  ])('maps audit persistence %s without retrying the business transaction', async (code, status, expectedCode) => {
    const fixture = setup()
    fixture.transaction.auditEvent.create.mockRejectedValue({
      code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: code } } },
    })
    fixture.audit.record.mockImplementation((tx, event) => new AuditService().record(
      tx as Parameters<AuditService['record']>[0], event as Parameters<AuditService['record']>[1],
    ))
    await expect(fixture.service.create(context, input())).rejects.toMatchObject({ status, code: expectedCode })
    expect(fixture.transaction.purchaseOrder.create).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledTimes(1)
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
  })

  it('creates v6 with sealed allocation inputs and null marks without consuming a shipping issuance', async () => {
    const fixture = setup()
    await fixture.service.create(context, input())
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createRequestFingerprintVersion: 'purchase-order.create.v6', shippingMarkText: null, shippingMarkIssuanceId: null }) as unknown,
    }))
    expect(fixture.transaction.purchaseOrderPart.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      purchaseOrderId: ORDER_ID, key: ACTOR_ID, partNumber: 1, status: 'PENDING_REVIEW',
      shipmentNo: 'SHIP/0001', numberingIssuanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      shippingMarkText: null, shippingMarkIssuanceId: null, shippingMarkKeyHash: null,
    })] })
  })

  it('retains the locked configuration precheck without reserving a mark or audit issuance', async () => {
    const fixture = setup()
    await fixture.service.create(context, input())
    expect(fixture.resolver.resolve.mock.calls.map(call => call[2])).toEqual([false, true])
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, expect.objectContaining({
      metadata: expect.objectContaining({ partCount: 1 }) as unknown,
    }))
    expect(fixture.audit.record.mock.calls[0][1]).not.toHaveProperty('metadata.shippingMarkIssuanceIds')
  })

  it('blocks unavailable or changed rules before either number is issued', async () => {
    for (const [resolution, code] of [
      [{ availability: 'UNBOUND', message: '供应商尚未绑定唛头规则' }, 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE'],
      [{ availability: 'AVAILABLE', resolutionToken: 'b'.repeat(64), ruleCode: 'TEST_MARK' }, 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED'],
    ] as const) {
      const fixture = setup()
      fixture.resolver.resolve.mockResolvedValue(resolution)
      await expect(fixture.service.create(context, input())).rejects.toMatchObject({ status: 409, code })
      expect(fixture.numbering.generateScoped).not.toHaveBeenCalled()
      expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
    }
  })

  it('does not issue a mark when configuration changes between preflight and final transaction', async () => {
    const fixture = setup()
    fixture.resolver.resolve.mockResolvedValueOnce({ availability: 'AVAILABLE', resolutionToken: 'a'.repeat(64), ruleCode: 'TEST_MARK' })
      .mockResolvedValueOnce({ availability: 'AVAILABLE', resolutionToken: 'b'.repeat(64), ruleCode: 'TEST_MARK' })
    await expect(fixture.service.create(context, input())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED' })
    expect(fixture.numbering.generateScoped).toHaveBeenCalledTimes(1)
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrder.create).not.toHaveBeenCalled()
  })

  it('recovers a concurrently committed order outside the failed transaction', async () => {
    const fixture = setup()
    const fingerprint = calculatePurchaseOrderCreateFingerprint(ACTOR_ID, normalizePurchaseOrderCreateCommand(input(), '2026-08-27'))
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: ORDER_ID, createdByUserId: ACTOR_ID, createRequestFingerprintHash: Buffer.from(fingerprint, 'hex'),
    })
    fixture.transaction.purchaseOrder.create.mockRejectedValue(new Error('Transaction failed after another commit'))
    await expect(fixture.service.create(context, input())).resolves.toBe(ORDER_ID)
    expect(fixture.prisma.purchaseOrder.findUnique).toHaveBeenCalledTimes(2)
  })

  it('recovers a same-key order committed while preflight was reading dependencies', async () => {
    const fixture = setup()
    const fingerprint = calculatePurchaseOrderCreateFingerprint(ACTOR_ID, normalizePurchaseOrderCreateCommand(input(), '2026-08-27'))
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: ORDER_ID, createdByUserId: ACTOR_ID, createRequestFingerprintHash: Buffer.from(fingerprint, 'hex'),
    })
    fixture.dependencies.requireDependencies.mockRejectedValue(new ApiException(409, 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED', '采购数量超限'))
    await expect(fixture.service.create(context, input())).resolves.toBe(ORDER_ID)
    expect(fixture.numbering.generateScoped).not.toHaveBeenCalled()
  })

  it('does not inspect or consume shipping-mark capacity during creation', async () => {
    const fixture = setup()
    fixture.numbering.generateScopedInTransaction.mockRejectedValue(new NumberingGenerationError('NUMBERING_CAPACITY_EXHAUSTED'))
    await expect(fixture.service.create(context, input())).resolves.toBe(ORDER_ID)
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
  })

  it('prechecks before numbering, then locks dependencies and persists trusted snapshots', async () => {
    const fixture = setup()
    await expect(fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).resolves.toBe(ORDER_ID)

    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(fixture.dependencies.requireDependencies.mock.calls[0]?.[3])
      .toEqual({ lockSalesLines: false })
    expect(fixture.dependencies.requireDependencies.mock.calls[1]?.[3])
      .toEqual({ lockSalesLines: true })
    expect(fixture.dependencies.requireDependencies.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.numbering.generateScoped.mock.invocationCallOrder[0] ?? 0)
    const numberingInput = fixture.numbering.generateScoped.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined
    expect(numberingInput).toMatchObject({
      ruleCode: 'PURCHASE_ORDER',
      consumerCode: 'PURCHASE_ORDER.CREATE',
      idempotencyKey: IDEMPOTENCY_KEY,
    })
    expect(numberingInput?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    const createInput = fixture.transaction.purchaseOrder.create.mock.calls[0]?.[0] as
      | { data?: Record<string, unknown>, select?: Record<string, unknown> }
      | undefined
    expect(createInput?.data).toMatchObject({
        orderNo: 'PO-20260827-0001',
        purchaseType: 'SALES_LINKED',
        productMode: 'CATALOG',
        salesOrderId: '11111111-1111-4111-8111-111111111111',
        supplierValue: 'SUPPLIER_A',
        customSupplierName: null,
        currencyCode: 'CNY',
      shippingMarkText: null,
      shippingMarkIssuanceId: null,
        lineSubtotalAmount: '20.00',
        purchaseTotalAmount: '20.00',
        depositDueAmount: '5.00',
        balanceDueAmount: '15.00',
        orderStatus: 'PENDING_REVIEW',
        fulfillmentStatus: 'ORDERED',
        paymentStatus: 'UNPAID',
        createdByUserId: ACTOR_ID,
    })
    expect(createInput?.select).toEqual({ id: true })
    expect(fixture.transaction.purchaseOrderLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        purchaseOrderId: ORDER_ID,
        productNoSnapshot: 'P-001',
        productNameSnapshot: '销售快照产品',
        referencePurchaseUnitPriceAmount: '12.35',
        actualPurchaseUnitPriceAmount: '10.00',
      })],
    })
    const auditInput = fixture.audit.record.mock.calls[0]?.[1]
    expect(auditInput).toMatchObject({
      eventType: 'PURCHASE_ORDER_CREATED',
      targetType: 'PURCHASE_ORDER',
      targetId: ORDER_ID,
      metadata: {
        orderNo: 'PO-20260827-0001',
        purchaseType: 'SALES_LINKED',
        productMode: 'CATALOG',
        lineCount: 1,
      },
    })
    expect(JSON.stringify(auditInput)).not.toContain('AUTO-0001')
    expect(JSON.stringify(auditInput)).not.toContain(IDEMPOTENCY_KEY)
  })

  it('derives zero-value STOCK orders as PAID', async () => {
    const fixture = setup()
    fixture.dependencies.requireDependencies.mockResolvedValue({ lines: [{
      lineNumber: 1,
      lineType: 'CUSTOM',
      productId: null,
      sourceSalesOrderLineId: null,
      productNoSnapshot: null,
      productNameSnapshot: '赠品包装',
      productAttributesSnapshot: [],
      descriptionSnapshot: null,
      referencePurchaseUnitPriceAmount: '0.00',
      actualPurchaseUnitPriceAmount: '0.00',
      quantity: 1,
      lineTotalAmount: '0.00',
    }] })
    await fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-zero',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, {
      parts: [{ key: ACTOR_ID, items: [{ lineNumber: 1, quantity: 1 }] }],
      purchaseType: 'STOCK',
      productMode: 'CUSTOM',
      customSupplierName: '礼品供应商',
      orderDate: '2026-08-27',
      expectedShippingMarkResolution: 'a'.repeat(64),
      lines: [{
        lineType: 'CUSTOM',
        name: '赠品包装',
        referencePurchaseUnitPriceAmount: '0',
        actualPurchaseUnitPriceAmount: '0',
        quantity: 1,
      }],
      purchaseTotalAmount: '0',
      depositDueAmount: '0',
      balanceDueAmount: '0',
    })
    const createInput = fixture.transaction.purchaseOrder.create.mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined
    expect(createInput?.data).toMatchObject({ paymentStatus: 'PAID' })
  })

  it('returns the existing matching order without dependencies or another number', async () => {
    const fixture = setup()
    const fingerprint = calculatePurchaseOrderCreateFingerprint(
      ACTOR_ID,
      normalizePurchaseOrderCreateCommand(input(), '2026-08-27'),
    )
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue({
      id: ORDER_ID,
      createdByUserId: ACTOR_ID,
      createRequestFingerprintHash: Buffer.from(fingerprint, 'hex'),
    })
    await expect(fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-replay',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).resolves.toBe(ORDER_ID)
    expect(fixture.dependencies.requireDependencies).not.toHaveBeenCalled()
    expect(fixture.numbering.generateScoped).not.toHaveBeenCalled()
    expect(fixture.resolver.resolve).not.toHaveBeenCalled()
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
  })

  it.each(['purchase-order.create.v3', 'purchase-order.create.v4', 'purchase-order.create.v5'])('restores the exact committed %s request without rule checks or issuance', async version => {
    const fixture = setup()
    const body = input()
    if (version === 'purchase-order.create.v3') delete body.parts
    const normalized = normalizePurchaseOrderCreateCommand(body, '2026-08-27', version === 'purchase-order.create.v3')
    const fingerprint = calculatePurchaseOrderCreateFingerprint(ACTOR_ID, normalized, version)
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue({
      id: ORDER_ID, createdByUserId: ACTOR_ID, createRequestFingerprintVersion: version,
      createRequestFingerprintHash: Buffer.from(fingerprint, 'hex'),
    })
    await expect(fixture.service.create(context, body)).resolves.toBe(ORDER_ID)
    await expect(fixture.service.create(context, { ...body, remark: 'Changed request' })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_CREATE_IDEMPOTENCY_CONFLICT' })
    expect(fixture.dependencies.requireDependencies).not.toHaveBeenCalled()
    expect(fixture.resolver.resolve).not.toHaveBeenCalled()
    expect(fixture.numbering.generateScoped).not.toHaveBeenCalled()
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
  })

  it('rejects a reused key for another actor or normalized payload', async () => {
    for (const existing of [
      {
        id: ORDER_ID,
        createdByUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        createRequestFingerprintHash: Buffer.alloc(32),
      },
      {
        id: ORDER_ID,
        createdByUserId: ACTOR_ID,
        createRequestFingerprintHash: Buffer.alloc(32),
      },
    ]) {
      const fixture = setup()
      fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(existing)
      await expect(fixture.service.create({
        actorUserId: ACTOR_ID,
        requestId: 'request-conflict',
        idempotencyKey: IDEMPOTENCY_KEY,
      }, input())).rejects.toMatchObject({
        status: 409,
        code: 'PURCHASE_ORDER_CREATE_IDEMPOTENCY_CONFLICT',
      })
    }
  })

  it('does not issue a number when input or precheck is invalid', async () => {
    const invalid = setup()
    await expect(invalid.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-invalid',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input({ orderDate: '2026-08-28' }))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(invalid.numbering.generateScoped).not.toHaveBeenCalled()

    const dependency = setup()
    dependency.dependencies.requireDependencies.mockRejectedValue(
      new ApiException(422, 'PURCHASE_ORDER_PRODUCT_UNAVAILABLE', '产品不可用'),
    )
    await expect(dependency.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-dependency',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PRODUCT_UNAVAILABLE' })
    expect(dependency.numbering.generateScoped).not.toHaveBeenCalled()
  })

  it('keeps the issued number consumed when final dependencies change', async () => {
    const fixture = setup()
    fixture.dependencies.requireDependencies
      .mockResolvedValueOnce({ lines: [] })
      .mockRejectedValueOnce(new ApiException(
        409,
        'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED',
        '采购数量超限',
      ))
    await expect(fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-final-change',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED',
    })
    expect(fixture.numbering.generateScoped).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.purchaseOrder.create).not.toHaveBeenCalled()
  })

})
