import type { Prisma } from '../../generated/prisma/client'
import type { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { ShipmentOwnershipService } from '../shipment-ownership/shipment-ownership.service'
import type { ShipmentStorageCostService } from './shipment-storage-cost.service'
import { ShipmentStorageService } from './shipment-storage.service'

const ACTOR_ID = '00000000-0000-4000-8000-000000000501'
const RECORD_ID = '00000000-0000-4000-8000-000000000502'
const REQUEST_KEY = '00000000-0000-4000-8000-000000000503'
const SHIPMENT_ID = '00000000-0000-4000-8000-000000000504'
const SALES_ORDER_ID = '00000000-0000-4000-8000-000000000505'
const SALES_LINE_ID = '00000000-0000-4000-8000-000000000506'
const PURCHASE_LINE_ID = '00000000-0000-4000-8000-000000000509'
const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

function claimFixture(options: {
  readonly claimedQuantity?: number
  readonly orderStatus?: 'CONFIRMED' | 'CANCELLED'
  readonly containerItems?: readonly Record<string, unknown>[]
} = {}) {
  const claimedQuantity = options.claimedQuantity ?? 2
  let claimedWritten = false
  let containerVersion = 1
  const containerItems = options.containerItems ?? []
  const transaction = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{
        fulfillmentStatus: 'PENDING',
        id: SALES_ORDER_ID,
        orderStatus: options.orderStatus ?? 'CONFIRMED',
      }]),
    purchaseOrderLine: {
      findMany: jest.fn().mockResolvedValue([{
        id: PURCHASE_LINE_ID,
        lineNumber: 1,
        lineType: 'CUSTOM',
        productId: null,
        productNameSnapshot: 'Custom item',
        sourceSalesOrderLine: { productNameSnapshot: 'Custom item' },
      }]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    containerLoadingItem: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(containerItems)),
      update: jest.fn().mockImplementation(() => {
        containerVersion += 1
        return Promise.resolve({ version: containerVersion })
      }),
    },
    containerLoadingItemChange: {
      create: jest.fn().mockImplementation(({ data }: { data: { kind: string } }) => (
        Promise.resolve({ id: `change-${data.kind}` })
      )),
    },
    containerBatch: { update: jest.fn().mockResolvedValue({}) },
    purchaseOrderPartItem: { findMany: jest.fn().mockResolvedValue([]) },
    // 默认货件不属于合并组；组成员结算阻断由寄仓 e2e 覆盖。
    shipmentLoadGroupMember: { findFirst: jest.fn().mockResolvedValue(null) },
    purchaseOrderPart: {
      findMany: jest.fn().mockResolvedValue([{
        id: SHIPMENT_ID,
        items: [],
        loadedAt: null,
        shippedAt: new Date('2026-10-20T00:00:00Z'),
        status: 'ACTIVE',
        warehouseReceivedAt: new Date('2026-10-21T00:00:00Z'),
      }]),
    },
    fundAccount: {
      findUnique: jest.fn().mockResolvedValue({ userShareRate: '30.00' }),
    },
    salesOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: SALES_ORDER_ID,
        issuerUserId: '00000000-0000-4000-8000-000000000508',
        orderNo: 'SO/20261028-00001',
        orderStatus: options.orderStatus ?? 'CONFIRMED',
        fulfillmentStatus: 'PENDING',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    salesOrderLine: {
      findMany: jest.fn().mockResolvedValue([{
        id: SALES_LINE_ID,
        lineNumber: 1,
        lineType: 'CUSTOM',
        productId: null,
        productNameSnapshot: 'Custom item',
        quantity: 2,
      }]),
    },
    salesOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    shipmentClaimLine: {
      // 认领写入前余量校验只能看到既有认领；写入后履约推进才应看到本次认领。
      createMany: jest.fn().mockImplementation(() => {
        claimedWritten = true
        return Promise.resolve({ count: 1 })
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(
        claimedWritten
          ? [{ salesOrderLineId: SALES_LINE_ID, quantity: claimedQuantity }]
          : [],
      )),
    },
    shipmentStorageClaimRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    shipmentOwnershipCurrent: {
      findUnique: jest.fn().mockResolvedValue({ ownerType: 'STORAGE_POOL', state: 'ACTIVE' }),
    },
    slhReconciliationSettlement: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    shipmentStorageRecord: {
      findUnique: jest.fn().mockResolvedValue({
        claimedBy: null,
        claimedSalesOrderId: null,
        costSnapshot: { totalCostCny: '100.00' },
        id: RECORD_ID,
        originAllocations: [{
          purchaseOrderLineId: PURCHASE_LINE_ID,
          lineNumber: 1,
          productName: 'Custom item',
          quantity: 2,
        }],
        originSalesOrderId: '00000000-0000-4000-8000-000000000507',
        shipmentId: SHIPMENT_ID,
        shipmentNoSnapshot: 'PKG/20261028-00001',
        status: 'IN_STORAGE',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as Prisma.TransactionClient
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(transaction)),
  }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  const ownership = { recordMany: jest.fn().mockResolvedValue(undefined) }
  const cost = { transfer: jest.fn().mockResolvedValue(null) }
  const instance = new ShipmentStorageService(
    prisma as never,
    audit,
    {} as DictionaryLookupService,
    ownership as unknown as ShipmentOwnershipService,
    cost as unknown as ShipmentStorageCostService,
  )
  jest.spyOn(instance, 'getById').mockResolvedValue({} as never)
  return { audit, cost, instance, ownership, transaction }
}

function service(prisma: unknown = {}) {
  return new ShipmentStorageService(
    prisma as never,
    {} as AuditService,
    {} as DictionaryLookupService,
    {} as ShipmentOwnershipService,
    { transfer: jest.fn().mockResolvedValue(null) } as unknown as ShipmentStorageCostService,
  )
}

describe('ShipmentStorageService', () => {
  it('requires an overseas warehouse when releasing to overseas storage', async () => {
    await expect(service().release(context, {
      shipmentIds: [SHIPMENT_ID],
      locationScope: 'OVERSEAS',
      reason: 'CUSTOMER_CANCEL',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects an overseas warehouse for mainland storage', async () => {
    await expect(service().release(context, {
      shipmentIds: [SHIPMENT_ID],
      locationScope: 'MAINLAND',
      overseasWarehouseValue: 'RF_TZ',
      reason: 'CUSTOMER_CANCEL',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects relocation after the record is claimed', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      shipmentStorageRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: RECORD_ID,
          status: 'CLAIMED',
          locationScope: 'OVERSEAS',
          warehouseValue: 'RF_TZ',
        }),
      },
    } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(transaction)),
    }

    await expect(service(prisma).relocate(context, RECORD_ID, {
      warehouseValue: 'RF_LK',
      reason: '转运',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_STATE_CHANGED' })
  })

  it('rejects relocation from a mainland storage record', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      shipmentStorageRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: RECORD_ID,
          status: 'IN_STORAGE',
          locationScope: 'MAINLAND',
          warehouseValue: 'SLH.SZ.BA.SJJD.HSNP.B5',
        }),
      },
    } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(transaction)),
    }

    await expect(service(prisma).relocate(context, RECORD_ID, {
      warehouseValue: 'RF_LK',
      reason: '转运',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_LOCATION_INVALID' })
  })

  it('returns zero-filled status counts with an ALL total', async () => {
    const prisma = {
      shipmentStorageRecord: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'IN_STORAGE', _count: { _all: 2 } },
          { status: 'CLAIMED', _count: { _all: 1 } },
        ]),
      },
    }

    const result = await service(prisma).statusCounts({})

    expect(result.items).toEqual([
      { value: 'ALL', count: 3 },
      { value: 'IN_STORAGE', count: 2 },
      { value: 'CLAIMED', count: 1 },
      { value: 'VOIDED', count: 0 },
    ])
  })

  it('rejects a claim when the matched bill line already has an active settlement', async () => {
    const fixture = claimFixture()
    jest.mocked(fixture.transaction.slhReconciliationSettlement.findFirst).mockResolvedValue({ id: 'settlement-1' } as never)

    await expect(fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_SETTLED' })
    expect(fixture.transaction.slhReconciliationSettlement.findFirst).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        OR: expect.arrayContaining([{ loadingItem: { shipmentId: SHIPMENT_ID } }]) as unknown,
      },
      select: { id: true },
    })
    expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
  })

  it('advances the claiming sales order to the stage implied by the claimed shipment', async () => {
    const fixture = claimFixture()

    await fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledTimes(3)
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenLastCalledWith({
      data: {
        salesOrderId: SALES_ORDER_ID,
        dimension: 'FULFILLMENT',
        fromStatus: 'LAND_TRANSIT',
        toStatus: 'WAREHOUSE_ARRIVED',
        reason: '认领寄仓货件后按货件事实推进',
        changedByUserId: ACTOR_ID,
      },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        metadata: expect.objectContaining({
          storageRecordId: RECORD_ID,
          toStatus: 'WAREHOUSE_ARRIVED',
          trigger: 'SHIPMENT_CLAIM',
        }) as unknown,
      }),
    )
    expect(fixture.cost.transfer).toHaveBeenCalledWith(
      fixture.transaction,
      context,
      'CLAIM',
      expect.objectContaining({
        amountCny: '100.00',
        storageRecordId: RECORD_ID,
        userId: '00000000-0000-4000-8000-000000000508',
      }) as unknown,
    )
  })

  it('requires every storage allocation to be claimed in full', async () => {
    const fixture = claimFixture()

    await expect(fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 1, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({
      code: 'SHIPMENT_STORAGE_CLAIM_ALLOCATION_QUANTITY_MISMATCH',
    })
    expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
  })

  it('rejects a source allocation that does not belong to the storage record', async () => {
    const fixture = claimFixture()

    await expect(fixture.instance.claim(context, RECORD_ID, {
      lines: [{
        purchaseOrderLineId: '00000000-0000-4000-8000-000000000599',
        quantity: 2,
        salesOrderLineId: SALES_LINE_ID,
      }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({
      code: 'SHIPMENT_STORAGE_CLAIM_ALLOCATION_INVALID',
    })
    expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
  })

  it('rejects catalog products with different product ids even when names match', async () => {
    const fixture = claimFixture()
    const sourceFindMany = fixture.transaction.purchaseOrderLine.findMany as unknown as jest.Mock
    sourceFindMany.mockResolvedValue([{
      id: PURCHASE_LINE_ID,
      lineNumber: 1,
      lineType: 'CATALOG',
      productId: '00000000-0000-4000-8000-000000000601',
      productNameSnapshot: '产品甲',
      descriptionSnapshot: null,
      sourceSalesOrderLine: null,
    }])
    const targetFindMany = fixture.transaction.salesOrderLine.findMany as unknown as jest.Mock
    targetFindMany.mockResolvedValue([{
      id: SALES_LINE_ID,
      lineNumber: 1,
      lineType: 'CATALOG',
      productId: '00000000-0000-4000-8000-000000000602',
      productNameSnapshot: '产品甲',
      descriptionSnapshot: null,
      quantity: 2,
    }])

    await expect(fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({
      code: 'SHIPMENT_STORAGE_CLAIM_PRODUCT_MISMATCH',
    })
    expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
  })

  it('rejects a claim that would push the line beyond its remaining coverage', async () => {
    const fixture = claimFixture()
    const groupBy = fixture.transaction.purchaseOrderLine.groupBy as unknown as jest.Mock
    groupBy.mockResolvedValue([{
      _sum: { quantity: 2 },
      sourceSalesOrderLineId: SALES_LINE_ID,
    }])

    await expect(fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({
      code: 'SHIPMENT_STORAGE_CLAIM_EXCEEDS_COVERAGE',
      message: expect.stringContaining('第1行') as unknown,
    })

    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        purchaseOrder: expect.objectContaining({ orderStatus: { not: 'CANCELLED' } }) as unknown,
      }) as unknown,
    }))
    expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('keeps the claiming order pending when claims leave a line uncovered', async () => {
    const fixture = claimFixture({ claimedQuantity: 1 })

    await fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
  })

  it('rejects a claim into an order that is no longer pending purchase', async () => {
    const fixture = claimFixture()
    const findOrder = fixture.transaction.salesOrder.findUnique as unknown as jest.Mock
    findOrder.mockResolvedValueOnce({
      fulfillmentStatus: 'PREPARING',
      id: SALES_ORDER_ID,
      issuerUserId: '00000000-0000-4000-8000-000000000508',
      orderNo: 'SO/20261028-00001',
      orderStatus: 'CONFIRMED',
    })

    await expect(fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({
      code: 'SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED',
      message: expect.stringContaining('待采购') as unknown,
    })
    expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
  })

  it('rejects a claim when the target issuer has no fund account or share rate', async () => {
    for (const account of [null, { userShareRate: null }]) {
      const fixture = claimFixture()
      const findAccount = fixture.transaction.fundAccount.findUnique as unknown as jest.Mock
      findAccount.mockResolvedValueOnce(account)

      await expect(fixture.instance.claim(context, RECORD_ID, {
        lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
        requestKey: REQUEST_KEY,
        salesOrderId: SALES_ORDER_ID,
      })).rejects.toMatchObject({
        code: 'SHIPMENT_STORAGE_SHARE_RATE_MISSING',
      })
      expect(fixture.cost.transfer).not.toHaveBeenCalled()
      expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
    }
  })

  it('preserves an untouched zero COD and rejects an empty recipient', async () => {
    const item = {
      id: '00000000-0000-4000-8000-000000000711',
      shipmentId: SHIPMENT_ID,
      containerBatchId: '00000000-0000-4000-8000-000000000712',
      version: 1,
      lineNumber: 2,
      oceanShippingMarkText: 'J-030549-02',
      recipientName: '原收件人',
      recipientPhone: '0911000000',
      recipientAddress: '原地址',
      codAmountTwd: { toFixed: () => '0.00' },
      remark: null,
      containerBatch: {
        id: '00000000-0000-4000-8000-000000000712',
        containerBatchName: '测试柜次',
      },
    }
    const fixture = claimFixture({ containerItems: [item] })

    const result = await fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      containerChanges: [{
        loadingItemId: item.id,
        expectedVersion: 1,
        recipientName: '原收件人',
        recipientPhone: '0911000000',
        recipientAddress: '原地址',
        codTouched: false,
      }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })
    expect(result.containerChanges).toEqual([])
    expect(fixture.transaction.containerLoadingItem.update).not.toHaveBeenCalled()
    expect(fixture.transaction.containerLoadingItemChange.create).not.toHaveBeenCalled()

    const invalid = claimFixture({ containerItems: [item] })
    await expect(invalid.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      containerChanges: [{
        loadingItemId: item.id,
        expectedVersion: 1,
        recipientName: ' ',
        recipientPhone: '0911000000',
        recipientAddress: '原地址',
        codTouched: false,
      }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_RECIPIENT_REQUIRED' })
  })

  it('applies per-item recipient and COD changes inside the claim transaction', async () => {
    const fixture = claimFixture({
      containerItems: [{
        id: '00000000-0000-4000-8000-000000000701',
        shipmentId: SHIPMENT_ID,
        containerBatchId: '00000000-0000-4000-8000-000000000702',
        version: 1,
        lineNumber: 2,
        oceanShippingMarkText: 'J-030549-01',
        recipientName: '旧收件人',
        recipientPhone: '0911000000',
        recipientAddress: '旧地址',
        codAmountTwd: { toFixed: () => '0.00' },
        remark: null,
        containerBatch: {
          id: '00000000-0000-4000-8000-000000000702',
          containerBatchName: '测试柜次',
        },
      }],
    })

    const result = await fixture.instance.claim(context, RECORD_ID, {
      lines: [{ purchaseOrderLineId: PURCHASE_LINE_ID, quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      containerChanges: [{
        loadingItemId: '00000000-0000-4000-8000-000000000701',
        expectedVersion: 1,
        recipientName: '新收件人',
        recipientPhone: '0922000000',
        recipientAddress: '新地址',
        codTouched: true,
        codAmountTwd: '0.00',
      }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })

    expect(result.containerChanges).toEqual([expect.objectContaining({
      afterCodAmountTwd: null,
      afterRecipientName: '新收件人',
      codChanged: true,
      recipientChanged: true,
    })])
    expect(fixture.transaction.containerLoadingItem.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        recipientName: '新收件人',
        recipientPhone: '0922000000',
        recipientAddress: '新地址',
        version: { increment: 1 },
      }) as unknown,
    }))
    expect(fixture.transaction.containerLoadingItem.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        codAmountTwd: null,
        version: { increment: 1 },
      }) as unknown,
    }))
    expect(fixture.transaction.containerLoadingItemChange.create).toHaveBeenCalledTimes(2)
    expect(fixture.transaction.containerBatch.update).toHaveBeenCalledTimes(1)
  })

  it('scopes storageId to list and status counts', async () => {
    const groupBy = jest.fn().mockResolvedValue([])
    const prisma = {
      shipmentStorageRecord: { groupBy },
    }

    await service(prisma).statusCounts({ storageId: RECORD_ID })

    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: RECORD_ID }) as unknown,
    }))
  })

  it('matches container shipping marks in the keyword filter', async () => {
    const groupBy = jest.fn().mockResolvedValue([])
    const prisma = {
      shipmentStorageRecord: { groupBy },
    }

    await service(prisma).statusCounts({ keyword: 'J-030549-01' })

    // 卡片上的装柜唛头来自货件的实时装柜行，关键词必须走同一条关系，不能只查寄仓快照。
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          shipment: {
            containerLoadingItems: {
              some: { oceanShippingMarkText: { contains: 'J-030549-01', mode: 'insensitive' } },
            },
          },
        }]) as unknown,
      }) as unknown,
    }))
  })

  it('derives the first location event start from the release audit', async () => {
    const occurredAt = new Date('2026-10-29T01:00:00.000Z')
    const updatedAt = new Date('2026-10-29T02:00:00.000Z')
    const purchaseLineId = '00000000-0000-4000-8000-000000000510'
    const purchaseMediaId = '00000000-0000-4000-8000-000000000511'
    const purchaseOrderId = '00000000-0000-4000-8000-000000000509'
    const row = {
      id: RECORD_ID,
      shipmentId: SHIPMENT_ID,
      status: 'IN_STORAGE',
      locationScope: 'OVERSEAS',
      warehouseValue: 'RF_LK',
      warehouseLabelSnapshot: '瑞锋-林口仓',
      locationUpdatedAt: updatedAt,
      shipmentNoSnapshot: 'PKG/20261029-00001',
      shippingMarkSnapshot: 'MARK-1',
      originPurchaseOrderId: purchaseOrderId,
      originPurchaseOrderNoSnapshot: 'PO/20261029-00001',
      originSalesOrderId: SALES_ORDER_ID,
      originSalesOrderNoSnapshot: 'SO/20261029-00001',
      originCustomerNameSnapshot: '客户甲',
      originIssuerUserId: '00000000-0000-4000-8000-000000000508',
      originAllocations: [{
        purchaseOrderLineId: purchaseLineId,
        lineNumber: 2,
        productName: '释放时产品名',
        quantity: 2,
        unitPriceCny: '50.00',
      }],
      containerSnapshot: null,
      costSnapshot: { purchaseCostCny: '100.00', packagingCostCny: '0.00', totalCostCny: '100.00' },
      snapshotAt: occurredAt,
      claimedSalesOrderId: null,
      claimedAt: null,
      createdAt: occurredAt,
      locationEvents: [{
        sequence: 1,
        locationScope: 'OVERSEAS',
        warehouseValue: 'RF_LK',
        warehouseLabelSnapshot: '瑞锋-林口仓',
        reason: '移仓',
        occurredAt,
      }],
    }
    const resolveStoredValues = jest.fn().mockResolvedValue([{
      known: true,
      dictionaryCode: 'overseas.warehouse',
      value: 'RF_TZ',
      label: '瑞锋-台中仓',
      tone: 'neutral',
      typeEnabled: true,
      itemEnabled: true,
      effectiveEnabled: true,
    }])
    const prisma = {
      shipmentStorageRecord: { findUnique: jest.fn().mockResolvedValue(row) },
      shipmentCostEvent: { findMany: jest.fn().mockResolvedValue([]) },
      auditEvent: {
        findMany: jest.fn().mockResolvedValue([{
          metadata: {
            storageRecordId: RECORD_ID,
            locationScope: 'OVERSEAS',
            warehouseValue: 'RF_TZ',
          },
        }]),
      },
      fundPostingBatch: { findMany: jest.fn().mockResolvedValue([]) },
      shipmentStorageClaimRequest: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
      containerLoadingItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'container-item-1',
            shipmentId: SHIPMENT_ID,
            lineNumber: 1,
            oceanShippingMarkText: 'J-030549-01',
            goodsName: '产品甲',
            packageCount: 1,
            packageUnit: '件',
            grossWeightKg: { toFixed: () => '11' },
            lengthCm: { toFixed: () => '37' },
            widthCm: { toFixed: () => '34' },
            heightCm: { toFixed: () => '35' },
            volumeCai: { toFixed: () => '1.55' },
            chargeableVolumeCai: 2,
            reportedVolumeCai: null,
            recipientName: '收件人甲',
            recipientPhone: '0900000001',
            recipientAddress: '地址甲',
            codAmountTwd: { toFixed: () => '100.00' },
            warehouseReceiptReference: 'RECEIPT-1',
            remark: '备注甲',
            containerBatch: {
              id: 'batch-1',
              containerBatchNo: 'CTN/2026-001',
              containerBatchName: '0305柜',
              loadingDate: new Date('2026-03-05T00:00:00.000Z'),
            },
          },
          {
            id: 'container-item-2',
            shipmentId: SHIPMENT_ID,
            lineNumber: 2,
            oceanShippingMarkText: 'J-030549-02',
            goodsName: '产品乙',
            packageCount: 2,
            packageUnit: null,
            grossWeightKg: null,
            lengthCm: null,
            widthCm: null,
            heightCm: null,
            volumeCai: null,
            chargeableVolumeCai: null,
            reportedVolumeCai: null,
            recipientName: null,
            recipientPhone: null,
            recipientAddress: null,
            codAmountTwd: null,
            warehouseReceiptReference: null,
            remark: null,
            containerBatch: {
              id: 'batch-1',
              containerBatchNo: 'CTN/2026-001',
              containerBatchName: '0305柜',
              loadingDate: new Date('2026-03-05T00:00:00.000Z'),
            },
          },
        ]),
      },
      purchaseOrderLine: {
        findMany: jest.fn().mockResolvedValue([{
          id: purchaseLineId,
          purchaseOrderId,
          lineNumber: 2,
          productNoSnapshot: 'P-001',
          productNameSnapshot: '当前产品名',
          product: { media: [{ id: purchaseMediaId }] },
        }]),
      },
    }
    const instance = new ShipmentStorageService(
      prisma as never,
      {} as AuditService,
      { resolveStoredValues } as unknown as DictionaryLookupService,
      {} as ShipmentOwnershipService,
      { transfer: jest.fn() } as unknown as ShipmentStorageCostService,
    )

    const detail = await instance.getById(RECORD_ID)

    expect(detail.locationEvents).toEqual([{
      sequence: 1,
      fromLocationScope: 'OVERSEAS',
      fromWarehouseValue: 'RF_TZ',
      fromWarehouseLabel: '瑞锋-台中仓',
      locationScope: 'OVERSEAS',
      warehouseValue: 'RF_LK',
      warehouseLabel: '瑞锋-林口仓',
      reason: '移仓',
      occurredAt: occurredAt.toISOString(),
    }])
    expect(detail.lineSummary).toEqual({
      lineCount: 1,
      totalQuantity: 2,
      previews: [{
        lineId: purchaseLineId,
        lineNumber: 2,
        lineType: 'UNRESOLVED',
        productId: null,
        productNo: 'P-001',
        productName: '释放时产品名',
        productDescription: null,
        sourceSalesProductName: null,
        normalizedNames: [],
        quantity: 2,
        mainImage: {
          id: purchaseMediaId,
          contentUrl: `/api/shipment-storage/${RECORD_ID}/lines/${purchaseLineId}/main-image/${purchaseMediaId}/content`,
        },
      }],
    })
    expect(detail.containerMarks).toEqual(['J-030549-01', 'J-030549-02'])
    expect(detail.containerLoadingItems).toHaveLength(2)
    expect(detail.containerLoadingItems[0]).toMatchObject({
      id: 'container-item-1',
      lineNumber: 1,
      oceanShippingMarkText: 'J-030549-01',
      goodsName: '产品甲',
      grossWeightKg: '11',
      volumeCai: '1.55',
      codAmountTwd: '100.00',
      containerBatch: {
        containerBatchNo: 'CTN/2026-001',
        loadingDate: '2026-03-05',
      },
    })
    expect(resolveStoredValues).toHaveBeenCalledWith({
      dictionaryCode: 'overseas.warehouse',
      values: ['RF_TZ'],
    })
  })

  it('keeps every loading item in the versioned release snapshot', () => {
    const snapshot = (service() as unknown as {
      containerSnapshot(part: unknown): unknown
    }).containerSnapshot({
      containerLoadingItems: [
        {
          id: 'container-item-1',
          lineNumber: 1,
          oceanShippingMarkText: 'J-030549-01',
          goodsName: '产品甲',
          packageCount: 1,
          packageUnit: '件',
          grossWeightKg: null,
          lengthCm: null,
          widthCm: null,
          heightCm: null,
          volumeCai: null,
          chargeableVolumeCai: null,
          reportedVolumeCai: null,
          recipientName: null,
          recipientPhone: null,
          recipientAddress: null,
          codAmountTwd: null,
          warehouseReceiptReference: null,
          remark: null,
          containerBatch: {
            id: 'batch-1',
            containerBatchNo: 'CTN/2026-001',
            containerBatchName: '0305柜',
            loadingDate: new Date('2026-03-05T00:00:00.000Z'),
          },
        },
        {
          id: 'container-item-2',
          lineNumber: 2,
          oceanShippingMarkText: 'J-030549-02',
          goodsName: '产品乙',
          packageCount: 1,
          packageUnit: null,
          grossWeightKg: null,
          lengthCm: null,
          widthCm: null,
          heightCm: null,
          volumeCai: null,
          chargeableVolumeCai: null,
          reportedVolumeCai: null,
          recipientName: null,
          recipientPhone: null,
          recipientAddress: null,
          codAmountTwd: null,
          warehouseReceiptReference: null,
          remark: null,
          containerBatch: {
            id: 'batch-1',
            containerBatchNo: 'CTN/2026-001',
            containerBatchName: '0305柜',
            loadingDate: new Date('2026-03-05T00:00:00.000Z'),
          },
        },
      ],
    })

    expect(snapshot).toMatchObject({
      format: 'shipment-storage.container-snapshot.v2',
      containerBatch: {
        containerBatchNo: 'CTN/2026-001',
        loadingDate: '2026-03-05',
      },
      items: [
        { id: 'container-item-1', lineNumber: 1, oceanShippingMarkText: 'J-030549-01' },
        { id: 'container-item-2', lineNumber: 2, oceanShippingMarkText: 'J-030549-02' },
      ],
    })
  })
})
