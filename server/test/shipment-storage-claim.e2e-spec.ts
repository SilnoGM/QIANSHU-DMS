import { randomBytes, randomUUID } from 'node:crypto'

import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { FundPostingService } from '../src/modules/fund-accounts/application/fund-posting.contract'
import { ShipmentOwnershipService } from '../src/modules/shipment-ownership/shipment-ownership.service'
import { ShipmentStorageCostService } from '../src/modules/shipment-storage/shipment-storage-cost.service'
import { ShipmentStorageService } from '../src/modules/shipment-storage/shipment-storage.service'
import { createPackagingCostHarness, type PackagingCostHarness } from './packaging-cost.fixture'

/**
 * 认领闭环：释放进池的原单货件被新销售单整件取走后，
 * 新单应按货件事实推进履约；同一销售行的剩余可认领量必须受采购与既有认领约束。
 */
describe('shipment storage claim over isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let h: PackagingCostHarness
  let storage: ShipmentStorageService

  beforeAll(async () => {
    h = await createPackagingCostHarness()
    storage = new ShipmentStorageService(
      h.prisma,
      h.fixture.audit,
      new DictionaryLookupService(h.prisma),
      new ShipmentOwnershipService(),
      new ShipmentStorageCostService(
        h.app.get(FundPostingService),
        h.fixture.audit,
      ),
    )
    // 认领成本按新出单人比例收回，出单人必须有资金账户与比例。
    await new FundAccountCommandService(h.prisma, h.fixture.audit).createUserAccount(
      { actorUserId: h.fixture.actor.id, requestId: randomUUID() },
      { userId: h.fixture.actor.id, userShareRate: '30' },
    )
  })
  afterAll(async () => { await h?.dispose() })

  async function createTargetOrder(originId: string) {
    const origin = await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: originId } })
    return h.prisma.salesOrder.create({
      data: {
        orderNo: `CLAIM-SO-${randomUUID()}`,
        createIdempotencyKeyHash: randomBytes(32),
        createRequestFingerprintHash: randomBytes(32),
        orderDate: origin.orderDate,
        issuerUserId: h.fixture.actor.id,
        currencyCode: origin.currencyCode,
        customerName: origin.customerName,
        customerPhone: origin.customerPhone,
        customerCountryRegionId: origin.customerCountryRegionId,
        customerProvinceStateId: origin.customerProvinceStateId,
        customerCityId: origin.customerCityId,
        customerCountryRegionCodeSnapshot: origin.customerCountryRegionCodeSnapshot,
        customerProvinceStateCodeSnapshot: origin.customerProvinceStateCodeSnapshot,
        customerCityCodeSnapshot: origin.customerCityCodeSnapshot,
        customerCountryRegionNameSnapshot: origin.customerCountryRegionNameSnapshot,
        customerProvinceStateNameSnapshot: origin.customerProvinceStateNameSnapshot,
        customerCityNameSnapshot: origin.customerCityNameSnapshot,
        customerAddressDetail: origin.customerAddressDetail,
        customerFullAddressSnapshot: origin.customerFullAddressSnapshot,
        lineSubtotalAmount: '10',
        agreedTotalAmount: '10',
        depositDueAmount: '0',
        balanceDueAmount: '10',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PENDING',
        paymentStatus: 'UNPAID',
        lines: { create: {
          lineNumber: 1,
          lineType: 'CUSTOM',
          productNameSnapshot: 'Custom item',
          actualUnitPriceAmount: '10',
          quantity: 1,
          lineTotalAmount: '10',
        } },
      },
      include: { lines: true },
    })
  }

  it('advances the claiming order and rejects a second claim beyond the line remaining quantity', async () => {
    const origin = await h.shipment({ partCount: 2, salesLinked: true })
    const target = await createTargetOrder(origin.source!.id)
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }

    // 释放接口要求采购款已付清，付款链路不在本用例范围；直接准备等价的寄仓事实。
    const ownershipService = new ShipmentOwnershipService()
    const released = await h.prisma.$transaction(async transaction => {
      const batch = await transaction.shipmentReleaseBatch.create({ data: {
        actorUserId: h.fixture.actor.id,
        originSalesOrderId: origin.source!.id,
        payloadHash: randomBytes(32),
        reason: 'CUSTOMER_CANCEL',
        requestKey: randomUUID(),
      } })
      await ownershipService.recordMany(transaction, origin.parts.map(part => ({
        actorUserId: h.fixture.actor.id,
        ownerSalesOrderId: null,
        ownerType: 'STORAGE_POOL' as const,
        reason: 'RELEASE' as const,
        releaseBatchId: batch.id,
        shipmentId: part.id,
      })))
      const ids: string[] = []
      for (const part of origin.parts) {
        const full = await transaction.purchaseOrderPart.findUniqueOrThrow({
          where: { id: part.id },
          include: { items: { include: { line: true } } },
        })
        const record = await transaction.shipmentStorageRecord.create({
          data: {
            shipmentId: part.id,
            releaseBatchId: batch.id,
            status: 'IN_STORAGE',
            locationScope: 'MAINLAND',
            warehouseValue: 'E2E-MAINLAND',
            warehouseLabelSnapshot: '大陆测试仓库',
            locationUpdatedAt: new Date(),
            shipmentNoSnapshot: part.shipmentNo,
            shippingMarkSnapshot: full.shippingMarkText,
            originPurchaseOrderId: full.purchaseOrderId,
            originPurchaseOrderNoSnapshot: origin.order.orderNo,
            originSalesOrderId: origin.source!.id,
            originSalesOrderNoSnapshot: origin.source!.orderNo,
            originCustomerNameSnapshot: origin.source!.customerName,
            originIssuerUserId: origin.source!.issuerUserId,
            originAllocations: full.items.map(item => ({
              purchaseOrderLineId: item.purchaseOrderLineId,
              lineNumber: item.line.lineNumber,
              productName: item.line.productNameSnapshot,
              quantity: item.quantity,
              unitPriceCny: '10.00',
            })),
            costSnapshot: { totalCostCny: '100.00' },
            snapshotAt: new Date(),
          },
          select: { id: true },
        })
        ids.push(record.id)
      }
      return ids
    })
    expect(released).toHaveLength(2)

    const claimed = await storage.claim(context, released[0], {
      lines: [{ quantity: 1, salesOrderLineId: target.lines[0].id }],
      requestKey: randomUUID(),
      salesOrderId: target.id,
    })
    expect(claimed.status).toBe('CLAIMED')
    expect(claimed.claimedSalesOrderId).toBe(target.id)

    const targetOrder = await h.prisma.salesOrder.findUniqueOrThrow({
      where: { id: target.id },
      select: { fulfillmentStatus: true },
    })
    expect(targetOrder.fulfillmentStatus).toBe('WAREHOUSE_ARRIVED')
    expect(await h.prisma.salesOrderStatusHistory.count({
      where: { salesOrderId: target.id, dimension: 'FULFILLMENT', toStatus: 'WAREHOUSE_ARRIVED' },
    })).toBe(1)

    const ownership = await h.prisma.shipmentOwnershipCurrent.findUniqueOrThrow({
      where: { shipmentId: origin.parts[0].id },
      select: { ownerType: true, ownerSalesOrderId: true },
    })
    expect(ownership).toEqual({ ownerSalesOrderId: target.id, ownerType: 'SALES_ORDER' })

    const batch = await h.prisma.fundPostingBatch.findFirstOrThrow({
      where: {
        businessSourceCodeSnapshot: 'SHIPMENT_STORAGE',
        consumerCode: 'SHIPMENT_STORAGE.CLAIM',
      },
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    })
    expect(batch.businessAmount.toFixed(2)).toBe('100.00')
    expect(batch.entries.map(entry => [
      entry.accountTarget,
      entry.direction,
      entry.amount.toFixed(2),
    ])).toEqual([
      ['USER', 'DEBIT', '30.00'],
      ['COMPANY', 'DEBIT', '70.00'],
    ])
    expect((await h.prisma.fundAccount.findUniqueOrThrow({
      where: { userId: h.fixture.actor.id },
      select: { balance: true },
    })).balance.toFixed(2)).toBe('-30.00')
    expect((await h.prisma.fundAccount.findFirstOrThrow({
      where: { ownerType: 'COMPANY' },
      select: { balance: true },
    })).balance.toFixed(2)).toBe('-70.00')
    expect(await h.prisma.shipmentCostEvent.findUniqueOrThrow({
      where: { storageRecordId_direction: { direction: 'CLAIM', storageRecordId: released[0] } },
      select: { fundPostingBatchIds: true },
    })).toEqual({ fundPostingBatchIds: [batch.id] })

    await expect(storage.claim(context, released[1], {
      lines: [{ quantity: 1, salesOrderLineId: target.lines[0].id }],
      requestKey: randomUUID(),
      salesOrderId: target.id,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_EXCEEDS_COVERAGE' })

    expect((await h.prisma.shipmentStorageRecord.findUniqueOrThrow({
      where: { id: released[1] },
      select: { status: true },
    })).status).toBe('IN_STORAGE')
  })
})
