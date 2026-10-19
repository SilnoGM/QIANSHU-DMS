import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { normalizeSalesOrderCreateCommand } from './sales-order-command.normalizer'
import { SalesOrderCommandService } from './sales-order-command.service'
import { calculateSalesOrderCreateFingerprint } from './sales-order-create-fingerprint'
import type { SalesOrderQueryService } from './sales-order-query.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000'

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderDate: '2026-08-20',
    currencyCode: 'TWD',
    customer: {
      name: '王小明',
      phone: '0912345678',
      countryRegionId: '11111111-1111-4111-8111-111111111111',
      provinceStateId: '22222222-2222-4222-8222-222222222222',
      cityId: '33333333-3333-4333-8333-333333333333',
      addressDetail: '苓雅区中正一路100号',
    },
    lines: [{
      lineType: 'CATALOG',
      productId: '44444444-4444-4444-8444-444444444444',
      actualUnitPriceAmount: '50',
      quantity: 2,
    }],
    agreedTotalAmount: '100',
    depositDueAmount: '30',
    balanceDueAmount: '70',
    issuanceVoucher: {
      mediaAssetId: '55555555-5555-4555-8555-555555555555',
    },
    remark: null,
    ...overrides,
  }
}

function setup() {
  const transaction = {
    $executeRaw: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([]),
    currency: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ code: 'TWD', minorUnit: 2 }),
    },
    region: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          code: 'TW',
          name: '中国台湾',
          level: 'COUNTRY_REGION',
          parentId: null,
          enabled: true,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          code: 'TW-TW',
          name: '台湾',
          level: 'PROVINCE_STATE',
          parentId: '11111111-1111-4111-8111-111111111111',
          enabled: true,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          code: 'TW-KHH',
          name: '高雄市',
          level: 'CITY',
          parentId: '22222222-2222-4222-8222-222222222222',
          enabled: true,
        },
      ]),
    },
    product: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: '44444444-4444-4444-8444-444444444444',
        productNo: 'P-001',
        name: '标准产品',
        status: 'ACTIVE',
        attributes: [{ title: '颜色', value: '红' }],
        twdSalePriceAmount: { toFixed: () => '60.00' },
        myrSalePriceAmount: null,
      }]),
    },
    mediaAsset: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: '55555555-5555-4555-8555-555555555555',
        status: 'UPLOADING',
        mediaType: 'IMAGE',
        createdByUserId: ACTOR_ID,
        deletedAt: null,
        objectKey: 'assets/order-proof.png',
      }]),
    },
    salesOrder: {
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: ORDER_ID }),
    },
    salesOrderLine: {
      createMany: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ count: 1 }),
    },
    salesOrderDocument: {
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: 'document-id' }),
    },
  }
  const prisma = {
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(null),
    },
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: typeof transaction) => Promise<unknown>, unknown?]
    >(callback => callback(transaction)),
  }
  const numbering = {
    generateScoped: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
      number: 'SO-20260820-0001',
      idempotentReplay: false,
    }),
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const media = {
    activate: jest.fn<Promise<void>, [unknown, string]>()
      .mockResolvedValue(undefined),
  }
  const detail = { id: ORDER_ID, orderNo: 'SO-20260820-0001' }
  const query = {
    getById: jest.fn<Promise<typeof detail>, [string]>().mockResolvedValue(detail),
  }
  const service = new SalesOrderCommandService(
    prisma as unknown as PrismaService,
    numbering as unknown as NumberingGeneratorService,
    audit as unknown as AuditService,
    media as unknown as MediaAssetService,
    query as unknown as SalesOrderQueryService,
    {
      businessToday: () => '2026-08-20',
      now: () => new Date('2026-08-20T01:02:03.004Z'),
    },
  )
  return { audit, detail, media, numbering, prisma, query, service, transaction }
}

describe('SalesOrderCommandService', () => {
  it('validates dependencies before issuing a number, then persists trusted snapshots', async () => {
    const fixture = setup()

    await expect(fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).resolves.toEqual(fixture.detail)

    const numberingCall = fixture.numbering.generateScoped.mock.calls[0]?.[0]
    expect(numberingCall).toMatchObject({
      ruleCode: 'SALES_ORDER',
      consumerCode: 'SALES_ORDER.CREATE',
      idempotencyKey: IDEMPOTENCY_KEY,
    })
    expect(JSON.stringify(numberingCall)).toMatch(
      /"requestFingerprint":"[0-9a-f]{64}"/u,
    )
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2)
    const createOrderCall = fixture.transaction.salesOrder.create
      .mock.calls[0]?.[0]
    expect(createOrderCall).toMatchObject({
      data: {
        orderNo: 'SO-20260820-0001',
        issuerUserId: ACTOR_ID,
        currencyCode: 'TWD',
        customerCountryRegionCodeSnapshot: 'TW',
        customerProvinceStateCodeSnapshot: 'TW-TW',
        customerCityCodeSnapshot: 'TW-KHH',
        customerAddressDetail: '苓雅区中正一路100号',
        customerFullAddressSnapshot:
          '中国台湾台湾高雄市苓雅区中正一路100号',
        lineSubtotalAmount: '100.00',
        agreedTotalAmount: '100.00',
        depositDueAmount: '30.00',
        balanceDueAmount: '70.00',
        orderStatus: 'CONFIRMED',
        paymentStatus: 'UNPAID',
      },
      select: { id: true },
    })
    const createLinesCall = fixture.transaction.salesOrderLine.createMany
      .mock.calls[0]?.[0]
    expect(createLinesCall).toMatchObject({ data: [{
        lineNumber: 1,
        lineType: 'CATALOG',
        productNoSnapshot: 'P-001',
        productNameSnapshot: '标准产品',
        standardUnitPriceAmount: '60.00',
        actualUnitPriceAmount: '50.00',
        lineTotalAmount: '100.00',
      }] })
    expect(fixture.media.activate).toHaveBeenCalledWith(
      fixture.transaction,
      '55555555-5555-4555-8555-555555555555',
    )
    expect(fixture.transaction.salesOrderDocument.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: ORDER_ID,
        mediaAssetId: '55555555-5555-4555-8555-555555555555',
        documentType: 'ORDER_ISSUANCE_VOUCHER',
        title: '王小明-出单凭证-20260820090203004',
        remark: null,
        createdByUserId: ACTOR_ID,
      },
      select: { id: true },
    })
    const createAuditCall = fixture.audit.record.mock.calls.find(
      call => JSON.stringify(call[1]).includes('SALES_ORDER_CREATED'),
    )
    expect(createAuditCall?.[0]).toBe(fixture.transaction)
    expect(createAuditCall?.[1]).toMatchObject({
      eventType: 'SALES_ORDER_CREATED',
    })
    const auditJson = JSON.stringify(createAuditCall?.[1])
    expect(auditJson).not.toContain('customerPhone')
    expect(auditJson).not.toContain('customerFullAddress')
    expect(auditJson).not.toContain('idempotencyKey')
  })

  it('allows an active catalog product without the current currency standard price', async () => {
    const fixture = setup()
    fixture.transaction.product.findMany.mockResolvedValue([{
      id: '44444444-4444-4444-8444-444444444444',
      productNo: 'P-001',
      name: '无台币标准价产品',
      status: 'ACTIVE',
      attributes: [],
      twdSalePriceAmount: null,
      myrSalePriceAmount: { toFixed: () => '20.00' },
    }])

    await expect(fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-no-standard-price',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).resolves.toEqual(fixture.detail)

    expect(fixture.transaction.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['44444444-4444-4444-8444-444444444444'] },
          status: 'ACTIVE',
        },
      }),
    )
    expect(fixture.transaction.salesOrderLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        productNameSnapshot: '无台币标准价产品',
        standardUnitPriceAmount: null,
        actualUnitPriceAmount: '50.00',
      })],
    })
  })

  it('does not issue a number for invalid input or changed dependencies', async () => {
    const future = setup()
    await expect(future.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input({ orderDate: '2026-08-21' }))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(future.numbering.generateScoped).not.toHaveBeenCalled()

    const unavailable = setup()
    unavailable.transaction.product.findMany.mockResolvedValue([])
    await expect(unavailable.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).rejects.toMatchObject({ code: 'SALES_ORDER_PRODUCT_UNAVAILABLE' })
    expect(unavailable.numbering.generateScoped).not.toHaveBeenCalled()
  })

  it('rejects a traditional abbreviated region before issuing a number', async () => {
    const fixture = setup()
    const request = input()
    request.customer = {
      ...(request.customer as Record<string, unknown>),
      addressDetail: '台灣高雄測試區測試22號',
    }

    await expect(fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, request)).rejects.toMatchObject({
      code: 'ADDRESS_DETAIL_CONTAINS_SELECTED_REGION',
    })
    expect(fixture.numbering.generateScoped).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrder.create).not.toHaveBeenCalled()
  })

  it('returns the existing order without dependency reads or another number', async () => {
    const fixture = setup()
    const firstFingerprint = calculateSalesOrderCreateFingerprint(
      ACTOR_ID,
      normalizeSalesOrderCreateCommand(input(), '2026-08-20'),
    )
    fixture.prisma.salesOrder.findUnique.mockResolvedValue({
      id: ORDER_ID,
      issuerUserId: ACTOR_ID,
      createRequestFingerprintHash: Buffer.from(firstFingerprint, 'hex'),
    })

    await expect(fixture.service.create({
      actorUserId: ACTOR_ID,
      requestId: 'request-2',
      idempotencyKey: IDEMPOTENCY_KEY,
    }, input())).resolves.toEqual(fixture.detail)
    expect(fixture.numbering.generateScoped).not.toHaveBeenCalled()
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
  })
})
