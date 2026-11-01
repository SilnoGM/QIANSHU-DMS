import { randomBytes, randomUUID } from 'node:crypto'

import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { FundPostingService } from '../src/modules/fund-accounts/application/fund-posting.contract'
import { PurchasePayableQueryService } from '../src/modules/purchase-orders/payables/purchase-payable-query.service'
import { PurchaseOrderSourceQueryService } from '../src/modules/purchase-orders/purchase-order-source-query.service'
import { PurchaseShipmentQueryService } from '../src/modules/purchase-orders/shipments/purchase-shipment-query.service'
import { SalesOrderMutationService } from '../src/modules/sales-orders/sales-order-mutation.service'
import { SalesOrderQueryService } from '../src/modules/sales-orders/sales-order-query.service'
import { ShipmentOwnershipService } from '../src/modules/shipment-ownership/shipment-ownership.service'
import { ShipmentStorageCostService } from '../src/modules/shipment-storage/shipment-storage-cost.service'
import { ShipmentStorageService } from '../src/modules/shipment-storage/shipment-storage.service'
import { markShipmentsContainerLoaded } from './fixtures/container-loaded.fixture'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { createPackagingCostHarness, type PackagingCostHarness } from './packaging-cost.fixture'
import { TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'
import { createCommands, createReviewMutations, customInput } from './purchase-shipping-mark-atomicity.fixture'

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
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    for (const [ruleCode, prefix] of [['CONTAINER_BATCH_NO', 'CB']] as const) {
      const rule = await h.fixture.numberingCommands.create(context, {
        ruleCode,
        purpose: 'BUSINESS',
        name: ruleCode,
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: prefix },
          { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
        ],
      })
      const published = await h.fixture.numberingCommands.publish(context, rule.id, {
        expectedVersion: rule.version,
        draftRevision: 1,
      })
      await h.fixture.numberingCommands.enable(context, rule.id, {
        expectedVersion: published.version,
      })
    }
  })
  afterAll(async () => { await h?.dispose() })

  async function createTargetOrder(
    originId: string,
    issuerUserId: string = h.fixture.actor.id,
    lineCount = 1,
    productName = 'Custom item',
  ) {
    const origin = await h.prisma.salesOrder.findUniqueOrThrow({ where: { id: originId } })
    const lineAmount = String(10 * lineCount)
    return h.prisma.salesOrder.create({
      data: {
        orderNo: `CLAIM-SO-${randomUUID()}`,
        createIdempotencyKeyHash: randomBytes(32),
        createRequestFingerprintHash: randomBytes(32),
        orderDate: origin.orderDate,
        issuerUserId,
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
        lineSubtotalAmount: lineAmount,
        agreedTotalAmount: lineAmount,
        depositDueAmount: '0',
        balanceDueAmount: lineAmount,
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PENDING',
        paymentStatus: 'UNPAID',
        lines: { create: Array.from({ length: lineCount }, (_, index) => ({
          lineNumber: index + 1,
          lineType: 'CUSTOM' as const,
          productNameSnapshot: productName,
          actualUnitPriceAmount: '10',
          quantity: 1,
          lineTotalAmount: '10',
        })) },
      },
      include: { lines: true },
    })
  }

  async function allocationLineId(recordId: string): Promise<string> {
    const detail = await storage.getById(recordId)
    const lineId = detail.lineSummary.previews[0]?.lineId
    if (lineId === undefined) throw new Error('Storage allocation line is missing')
    return lineId
  }

  async function createStorageRecord(
    origin: Awaited<ReturnType<typeof h.shipment>>,
  ): Promise<string> {
    const ownershipService = new ShipmentOwnershipService()
    return h.prisma.$transaction(async (transaction) => {
      const batch = await transaction.shipmentReleaseBatch.create({ data: {
        actorUserId: h.fixture.actor.id,
        originSalesOrderId: origin.source!.id,
        payloadHash: randomBytes(32),
        reason: 'CUSTOMER_CANCEL',
        requestKey: randomUUID(),
      } })
      const part = origin.parts[0]
      const full = await transaction.purchaseOrderPart.findUniqueOrThrow({
        where: { id: part.id },
        include: { items: { include: { line: true } } },
      })
      await ownershipService.recordMany(transaction, [{
        actorUserId: h.fixture.actor.id,
        ownerSalesOrderId: null,
        ownerType: 'STORAGE_POOL',
        reason: 'RELEASE',
        releaseBatchId: batch.id,
        shipmentId: part.id,
      }])
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
      return record.id
    })
  }

  async function createContainerItem(
    shipmentId: string,
  ): Promise<{ batchId: string, itemId: string }> {
    await markShipmentsContainerLoaded(h.prisma, [shipmentId], h.fixture.actor.id)
    return h.prisma.$transaction(async (transaction) => {
      const key = randomUUID()
      const fingerprint = 'c'.repeat(64)
      const issuance = await h.fixture.numbering.generateScopedInTransaction(transaction, {
        ruleCode: 'CONTAINER_BATCH_NO',
        consumerCode: 'CONTAINER_BATCH.CREATE',
        idempotencyKey: key,
        requestFingerprint: fingerprint,
      })
      const batch = await transaction.containerBatch.create({ data: {
        containerBatchNo: issuance.number,
        numberingIssuanceId: issuance.issuanceId,
        containerBatchName: '测试柜',
        loadingDate: new Date('2026-09-20'),
        sequenceInDay: 1,
        warehouseValue: TEST_DESTINATION_WAREHOUSE,
        creationRequestKey: key,
        creationPayloadHash: fingerprint,
        createdById: h.fixture.actor.id,
        updatedById: h.fixture.actor.id,
      } })
      const item = await transaction.containerLoadingItem.create({ data: {
        containerBatchId: batch.id,
        shipmentId,
        lineNumber: 1,
        creationRequestKey: randomUUID(),
        creationPayloadHash: 'd'.repeat(64),
        oceanShippingMarkText: 'J-030549-01',
        goodsName: '测试装柜货品',
        packageCount: 1,
        recipientName: '旧收件人',
        recipientPhone: '0911000000',
        recipientAddress: '旧地址',
        codAmountTwd: '100.00',
        createdById: h.fixture.actor.id,
        updatedById: h.fixture.actor.id,
      } })
      return { batchId: batch.id, itemId: item.id }
    })
  }

  async function arrivalPartIds(
    scope: 'ALL' | 'SELF',
    actorUserId: string,
    excludeStoragePool = false,
  ): Promise<string[]> {
    const queries = new PurchaseShipmentQueryService(
      h.prisma,
      new DictionaryLookupService(h.prisma),
      { resolve: () => Promise.resolve(scope) } as never,
    )
    const page = await queries.list({
      pageSize: 100,
      view: 'WAREHOUSE_RECEIVED',
      ...(excludeStoragePool ? { excludeStoragePool: true } : {}),
    }, actorUserId)
    return page.items.map(item => item.id)
  }

  it('refunds the original issuer and company when releasing a paid shipment', async () => {
    const origin = await h.shipment({ salesLinked: true })
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const queries = new PurchasePayableQueryService(
      h.prisma,
      new DictionaryLookupService(h.prisma),
      createPaymentRecipientFixture(h.prisma),
    )
    const payableOrder = await queries.getOrder(origin.order.id, h.fixture.actor.id)
    const profile = payableOrder.paymentRecipientProfile
    if (profile === null) throw new Error('Purchase payment recipient profile is missing')
    const mutations = createReviewMutations(h.fixture)
    for (const payable of payableOrder.items) {
      if (payable.status === 'PAID' || payable.remainingAmount === '0.00') continue
      const voucher = await h.prisma.mediaAsset.create({ data: {
        mediaType: 'IMAGE',
        status: 'UPLOADING',
        uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER',
        purchasePayableUploadId: payable.id,
        objectKey: `assets/${randomUUID()}.png`,
        originalFilename: 'payment.png',
        mimeType: 'image/png',
        sizeBytes: 1n,
        checksumSha256: '0'.repeat(64),
        width: 1,
        height: 1,
        createdByUserId: h.fixture.actor.id,
        uploadExpiresAt: new Date(Date.now() + 3_600_000),
      } })
      await mutations.payPayable(context, payable.id, {
        expectedVersion: payable.version,
        paymentMethod: 'BANK_TRANSFER',
        recipientAccountId: profile.accounts[0].id,
        recipientProfileVersion: profile.version,
        voucher: { mediaAssetId: voucher.id },
      }, randomUUID())
    }
    expect((await h.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: origin.order.id },
      select: { paymentStatus: true },
    })).paymentStatus).toBe('PAID')

    const released = await storage.release(context, {
      shipmentIds: [origin.part.id],
      locationScope: 'MAINLAND',
      reason: 'CUSTOMER_CANCEL',
      requestKey: randomUUID(),
    })
    expect(released).toHaveLength(1)

    // 采购付款先扣甲 3、公司 7；释放按 30% 原路退回，余额回到 0。
    expect((await h.prisma.fundAccount.findUniqueOrThrow({
      where: { userId: h.fixture.actor.id },
      select: { balance: true },
    })).balance.toFixed(2)).toBe('0.00')
    expect((await h.prisma.fundAccount.findFirstOrThrow({
      where: { ownerType: 'COMPANY' },
      select: { balance: true },
    })).balance.toFixed(2)).toBe('0.00')
    expect((await h.prisma.shipmentCostEvent.findUniqueOrThrow({
      where: { storageRecordId_direction: { direction: 'RELEASE', storageRecordId: released[0].id } },
      select: { amountCny: true },
    })).amountCny.toFixed(2)).toBe('10.00')
    const detail = await storage.getById(released[0].id)
    expect(detail.costTransfers).toHaveLength(1)
    expect(detail.costTransfers[0]).toMatchObject({
      amountCny: '10.00',
      direction: 'RELEASE',
    })
    expect(detail.costTransfers[0]?.batchNos).toHaveLength(1)
    expect(detail.originIssuer?.id).toBe(h.fixture.actor.id)
    expect(detail.originPurchaseCreator?.id).toBe(h.fixture.actor.id)
    const releasedList = await storage.list({ storageId: released[0].id })
    expect(releasedList.items[0]?.originIssuer?.id).toBe(h.fixture.actor.id)
    expect(releasedList.items[0]?.originPurchaseCreator?.id).toBe(h.fixture.actor.id)

    // 到仓货件：池内货件对原出单人和管理员（带排除参数）都不可见；货件管理不带参数时仍可见。
    expect(await arrivalPartIds('SELF', h.fixture.actor.id)).not.toContain(origin.part.id)
    expect(await arrivalPartIds('ALL', h.fixture.actor.id)).toContain(origin.part.id)
    expect(await arrivalPartIds('ALL', h.fixture.actor.id, true)).not.toContain(origin.part.id)

    // 认领给乙单后，新出单人能在到仓货件看到该货件；原出单人看不到。
    const username = `bob-${randomUUID()}`
    const bob = await h.prisma.user.create({ data: {
      username,
      usernameNormalized: username,
      displayName: '乙出单人',
      passwordHash: 'isolated-test-only',
      passwordChangedAt: new Date(),
    } })
    await new FundAccountCommandService(h.prisma, h.fixture.audit).createUserAccount(context, {
      userId: bob.id,
      userShareRate: '30',
    })
    const target = await createTargetOrder(origin.source!.id, bob.id, 2)
    const targetLines = [...target.lines].sort((left, right) => left.lineNumber - right.lineNumber)
    const firstSourceLineId = await allocationLineId(released[0].id)
    await storage.claim(context, released[0].id, {
      lines: [{
        purchaseOrderLineId: firstSourceLineId,
        quantity: 1,
        salesOrderLineId: targetLines[0].id,
      }],
      requestKey: randomUUID(),
      salesOrderId: target.id,
    })
    expect(await h.prisma.shipmentClaimLine.findFirstOrThrow({
      where: { storageRecordId: released[0].id },
      select: {
        productMatchMode: true,
        productMatchNote: true,
        purchaseOrderLineId: true,
        salesOrderLineId: true,
      },
    })).toEqual({
      productMatchMode: 'AUTO',
      productMatchNote: null,
      purchaseOrderLineId: firstSourceLineId,
      salesOrderLineId: targetLines[0].id,
    })
    expect(await arrivalPartIds('SELF', bob.id)).toContain(origin.part.id)
    expect(await arrivalPartIds('SELF', h.fixture.actor.id)).not.toContain(origin.part.id)
    expect(await arrivalPartIds('ALL', h.fixture.actor.id, true)).toContain(origin.part.id)
    const arrivalQueries = new PurchaseShipmentQueryService(
      h.prisma,
      new DictionaryLookupService(h.prisma),
      { resolve: () => Promise.resolve('ALL') } as never,
    )
    const arrivalPage = await arrivalQueries.list({
      pageSize: 100,
      view: 'WAREHOUSE_RECEIVED',
      excludeStoragePool: true,
    }, bob.id)
    expect(arrivalPage.items.find(item => item.id === origin.part.id)?.salesSource).toMatchObject({
      id: target.id,
      orderNo: target.orderNo,
    })

    // 采购来源行必须把已调货数量从可采购剩余中扣除，未调货行仍可继续采购。
    const sourceQueries = new PurchaseOrderSourceQueryService(
      h.prisma,
      new DictionaryLookupService(h.prisma),
      { resolve: () => Promise.resolve('ALL') } as never,
    )
    const source = await sourceQueries.salesOrderLines(target.id, { productMode: 'CUSTOM' })
    expect(source.items.find(item => item.id === targetLines[0].id)).toMatchObject({
      claimedQuantity: 1,
      purchasedQuantity: 0,
      remainingQuantity: 0,
    })
    expect(source.items.find(item => item.id === targetLines[1].id)).toMatchObject({
      claimedQuantity: 0,
      purchasedQuantity: 0,
      remainingQuantity: 1,
    })

    // 已认领行与审核中采购共同占满全部销售行时，列表必须进入“采购审核中”分桶。
    const baseInput = await customInput(h.fixture)
    await createCommands(h.fixture).create(h.fixture.context(), {
      ...baseInput,
      purchaseType: 'SALES_LINKED',
      salesOrderId: target.id,
      lines: [{
        ...baseInput.lines[0],
        quantity: 1,
        sourceSalesOrderLineId: targetLines[1].id,
      }],
      parts: [{ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] }],
      purchaseTotalAmount: '10',
      depositDueAmount: '0',
      balanceDueAmount: '10',
    })
    const salesQueries = new SalesOrderQueryService(
      h.prisma,
      { resolve: () => Promise.resolve('ALL') } as never,
    )
    const awaiting = await salesQueries.list({
      page: 1,
      pageSize: 50,
      purchaseHold: 'AWAITING_PURCHASE_REVIEW',
    })
    expect(awaiting.items.find(item => item.id === target.id)?.purchaseHold).toEqual({
      reason: 'AWAITING_PURCHASE_REVIEW',
      pendingReviewOrderCount: 1,
    })
  })

  it('returns claimed shipments to storage when the claiming order is cancelled', async () => {
    const origin = await h.shipment({ salesLinked: true })
    if (origin.source === null) throw new Error('sales linked shipment must create a sales order')
    const storageRecordId = await createStorageRecord(origin)
    const target = await createTargetOrder(origin.source.id, h.fixture.actor.id, 1)
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    await storage.claim(context, storageRecordId, {
      lines: [{
        purchaseOrderLineId: await allocationLineId(storageRecordId),
        quantity: 1,
        salesOrderLineId: target.lines[0].id,
      }],
      requestKey: randomUUID(),
      salesOrderId: target.id,
    })

    await h.app.get(SalesOrderMutationService).updateOrderStatus(context, target.id, {
      toStatus: 'CANCELLED',
      reason: '客户取消',
    })

    const records = await h.prisma.shipmentStorageRecord.findMany({
      where: { shipmentId: origin.parts[0].id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true, releaseBatch: { select: { reason: true, originSalesOrderId: true } } },
    })
    expect(records.map(record => record.status).sort()).toEqual(['CLAIMED', 'IN_STORAGE'])
    const returned = records.find(record => record.status === 'IN_STORAGE')
    if (returned === undefined) throw new Error('returned storage record is missing')
    expect(returned.releaseBatch).toMatchObject({
      reason: 'CUSTOMER_CANCEL',
      originSalesOrderId: target.id,
    })
    const ownership = await h.prisma.shipmentOwnershipCurrent.findUniqueOrThrow({
      where: { shipmentId: origin.parts[0].id },
      select: { ownerType: true, ownerSalesOrderId: true },
    })
    expect(ownership).toEqual({ ownerType: 'STORAGE_POOL', ownerSalesOrderId: null })
    const releaseEvent = await h.prisma.shipmentCostEvent.findUniqueOrThrow({
      where: { storageRecordId_direction: { storageRecordId: returned.id, direction: 'RELEASE' } },
      select: { amountCny: true, actorUserId: true },
    })
    expect(releaseEvent.amountCny.toFixed(2)).toBe('100.00')
    expect(releaseEvent.actorUserId).toBe(h.fixture.actor.id)
    const cancelled = await h.prisma.salesOrder.findUniqueOrThrow({
      where: { id: target.id },
      select: { orderStatus: true },
    })
    expect(cancelled.orderStatus).toBe('CANCELLED')
  })

  it('advances the claiming order and rejects a second claim after it leaves pending purchase', async () => {
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
    // 前一个用例已产生一次释放退款与乙单认领，本用例按增量核对，避免依赖账户初始余额。
    const actorBalanceBefore = (await h.prisma.fundAccount.findUniqueOrThrow({
      where: { userId: h.fixture.actor.id },
      select: { balance: true },
    })).balance
    const companyBalanceBefore = (await h.prisma.fundAccount.findFirstOrThrow({
      where: { ownerType: 'COMPANY' },
      select: { balance: true },
    })).balance

    const claimed = await storage.claim(context, released[0], {
      lines: [{
        purchaseOrderLineId: await allocationLineId(released[0]),
        quantity: 1,
        salesOrderLineId: target.lines[0].id,
      }],
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
        businessId: released[0],
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
    })).balance.minus(actorBalanceBefore).toFixed(2)).toBe('-30.00')
    expect((await h.prisma.fundAccount.findFirstOrThrow({
      where: { ownerType: 'COMPANY' },
      select: { balance: true },
    })).balance.minus(companyBalanceBefore).toFixed(2)).toBe('-70.00')
    expect(await h.prisma.shipmentCostEvent.findUniqueOrThrow({
      where: { storageRecordId_direction: { direction: 'CLAIM', storageRecordId: released[0] } },
      select: { fundPostingBatchIds: true },
    })).toEqual({ fundPostingBatchIds: [batch.id] })
    expect((await storage.getById(released[0])).costTransfers).toEqual([{
      amountCny: '100.00',
      batchNos: [batch.batchNo],
      direction: 'CLAIM',
      occurredAt: expect.any(String) as unknown,
    }])

    await expect(storage.claim(context, released[1], {
      lines: [{
        purchaseOrderLineId: await allocationLineId(released[1]),
        quantity: 1,
        salesOrderLineId: target.lines[0].id,
      }],
      requestKey: randomUUID(),
      salesOrderId: target.id,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED' })

    expect((await h.prisma.shipmentStorageRecord.findUniqueOrThrow({
      where: { id: released[1] },
      select: { status: true },
    })).status).toBe('IN_STORAGE')
  })

  it('creates, rejects, withdrawals and approves a claim request with a record lock', async () => {
    const origin = await h.shipment({ partCount: 1, salesLinked: true })
    const target = await createTargetOrder(origin.source!.id)
    const ownershipService = new ShipmentOwnershipService()
    const recordId = await h.prisma.$transaction(async transaction => {
      const batch = await transaction.shipmentReleaseBatch.create({ data: {
        actorUserId: h.fixture.actor.id,
        originSalesOrderId: origin.source!.id,
        payloadHash: randomBytes(32),
        reason: 'CUSTOMER_CANCEL',
        requestKey: randomUUID(),
      } })
      const part = origin.parts[0]
      const full = await transaction.purchaseOrderPart.findUniqueOrThrow({
        where: { id: part.id },
        include: { items: { include: { line: true } } },
      })
      await ownershipService.recordMany(transaction, [{
        actorUserId: h.fixture.actor.id,
        ownerSalesOrderId: null,
        ownerType: 'STORAGE_POOL',
        reason: 'RELEASE',
        releaseBatchId: batch.id,
        shipmentId: part.id,
      }])
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
      return record.id
    })
    const targetLine = target.lines[0]
    const sourceLineId = await allocationLineId(recordId)
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }
    const foreignUsername = `foreign-${randomUUID()}`
    const foreignUser = await h.prisma.user.create({ data: {
      username: foreignUsername,
      usernameNormalized: foreignUsername,
      displayName: '非本人出单人',
      passwordHash: 'isolated-test-only',
      passwordChangedAt: new Date(),
    } })
    const foreignTarget = await createTargetOrder(origin.source!.id, foreignUser.id)
    await expect(storage.createClaimRequest(context, recordId, {
      salesOrderId: foreignTarget.id,
      lines: [{ purchaseOrderLineId: sourceLineId, quantity: 1, salesOrderLineId: foreignTarget.lines[0].id }],
      requestKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_REQUEST_SALES_ORDER_FORBIDDEN' })

    const request = await storage.createClaimRequest(context, recordId, {
      salesOrderId: target.id,
      lines: [{ purchaseOrderLineId: sourceLineId, quantity: 1, salesOrderLineId: targetLine.id }],
      requestKey: randomUUID(),
    })
    expect(request).toMatchObject({
      applicant: { id: h.fixture.actor.id },
      costTotalCny: '100.00',
      status: 'PENDING',
      targetSalesOrderId: target.id,
    })
    expect(request.allocations).toEqual([expect.objectContaining({
      productMatchMode: 'AUTO',
      productMatchNote: null,
      productName: 'Custom item',
      purchaseOrderLineId: sourceLineId,
      quantity: 1,
      salesOrderLineId: targetLine.id,
      sourceProductName: 'Custom item',
    })])
    const listed = await storage.list({ storageId: recordId })
    expect(listed.items[0]?.claimRequest).toMatchObject({
      applicant: { id: h.fixture.actor.id },
      id: request.id,
      targetSalesOrderNo: target.orderNo,
    })

    await expect(storage.claim(context, recordId, {
      salesOrderId: target.id,
      lines: [{ purchaseOrderLineId: sourceLineId, quantity: 1, salesOrderLineId: targetLine.id }],
      requestKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_REQUEST_PENDING' })

    const rejected = await storage.rejectClaimRequest(context, recordId, request.id, {
      reason: '测试拒绝',
    })
    expect(rejected.status).toBe('REJECTED')
    await expect(storage.withdrawClaimRequest(context, recordId, request.id))
      .rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED' })
    expect((await storage.list({ storageId: recordId })).items[0]?.claimRequest).toBeNull()

    const secondRequest = await storage.createClaimRequest(context, recordId, {
      salesOrderId: target.id,
      lines: [{ purchaseOrderLineId: sourceLineId, quantity: 1, salesOrderLineId: targetLine.id }],
      requestKey: randomUUID(),
    })
    // 采运同意后复检失败：申请自动转为拒绝，寄仓记录保持锁定前状态。
    await h.prisma.salesOrder.update({
      where: { id: target.id },
      data: { orderStatus: 'CANCELLED' },
    })
    await expect(storage.approveClaimRequest(context, recordId, secondRequest.id))
      .rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED' })
    expect((await storage.getClaimRequest(recordId, secondRequest.id)).status).toBe('REJECTED')
    await h.prisma.salesOrder.update({
      where: { id: target.id },
      data: { orderStatus: 'CONFIRMED' },
    })

    const thirdRequest = await storage.createClaimRequest(context, recordId, {
      salesOrderId: target.id,
      lines: [{ purchaseOrderLineId: sourceLineId, quantity: 1, salesOrderLineId: targetLine.id }],
      requestKey: randomUUID(),
    })
    const claimed = await storage.approveClaimRequest(context, recordId, thirdRequest.id)
    expect(claimed.status).toBe('CLAIMED')
    expect((await storage.getClaimRequest(recordId, thirdRequest.id)).status).toBe('APPROVED')
  })

  it('requires an explicit reason for a custom product mapping mismatch and persists it', async () => {
    const origin = await h.shipment({ partCount: 1, salesLinked: true })
    const target = await createTargetOrder(origin.source!.id, h.fixture.actor.id, 1, 'Different item')
    const recordId = await createStorageRecord(origin)
    const sourceLineId = await allocationLineId(recordId)
    const targetLine = target.lines[0]
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }

    await expect(storage.createClaimRequest(context, recordId, {
      salesOrderId: target.id,
      lines: [{
        purchaseOrderLineId: sourceLineId,
        quantity: 1,
        salesOrderLineId: targetLine.id,
      }],
      requestKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_PRODUCT_MISMATCH' })

    await expect(storage.createClaimRequest(context, recordId, {
      salesOrderId: target.id,
      lines: [{
        purchaseOrderLineId: sourceLineId,
        productMatchOverride: true,
        quantity: 1,
        salesOrderLineId: targetLine.id,
      }],
      requestKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_PRODUCT_OVERRIDE_REASON_REQUIRED' })

    const request = await storage.createClaimRequest(context, recordId, {
      salesOrderId: target.id,
      lines: [{
        purchaseOrderLineId: sourceLineId,
        productMatchNote: '采购改名，实物一致',
        productMatchOverride: true,
        quantity: 1,
        salesOrderLineId: targetLine.id,
      }],
      requestKey: randomUUID(),
    })
    expect(request.allocations).toEqual([expect.objectContaining({
      productMatchMode: 'MANUAL_OVERRIDE',
      productMatchNote: '采购改名，实物一致',
      productName: 'Different item',
      purchaseOrderLineId: sourceLineId,
      quantity: 1,
      salesOrderLineId: targetLine.id,
      sourceProductName: 'Custom item',
    })])

    const claimed = await storage.approveClaimRequest(context, recordId, request.id)
    expect(claimed.status).toBe('CLAIMED')
    expect(await h.prisma.shipmentClaimLine.findFirstOrThrow({
      where: { storageRecordId: recordId },
      select: {
        productMatchMode: true,
        productMatchNote: true,
        purchaseOrderLineId: true,
        salesOrderLineId: true,
      },
    })).toEqual({
      productMatchMode: 'MANUAL_OVERRIDE',
      productMatchNote: '采购改名，实物一致',
      purchaseOrderLineId: sourceLineId,
      salesOrderLineId: targetLine.id,
    })
  })

  it('applies loaded container recipient/COD changes with item versions and returns the applied copy data', async () => {
    const origin = await h.shipment({ partCount: 1, salesLinked: true })
    const container = await createContainerItem(origin.part.id)
    const recordId = await createStorageRecord(origin)
    const target = await createTargetOrder(origin.source!.id)
    const sourceLineId = await allocationLineId(recordId)
    const targetLine = target.lines[0]
    const context = { actorUserId: h.fixture.actor.id, requestId: randomUUID() }

    const request = await storage.createClaimRequest(context, recordId, {
      salesOrderId: target.id,
      lines: [{
        purchaseOrderLineId: sourceLineId,
        quantity: 1,
        salesOrderLineId: targetLine.id,
      }],
      containerChanges: [{
        loadingItemId: container.itemId,
        expectedVersion: 1,
        recipientName: '新收件人',
        recipientPhone: '0922000000',
        recipientAddress: '新地址',
        codTouched: true,
        codAmountTwd: '0.00',
      }],
      requestKey: randomUUID(),
    })
    expect(request.containerChanges).toEqual([expect.objectContaining({
      afterCodAmountTwd: null,
      afterRecipientName: '新收件人',
      codChanged: true,
      expectedVersion: 1,
      loadingItemId: container.itemId,
      recipientChanged: true,
    })])

    const claimed = await storage.approveClaimRequest(context, recordId, request.id)
    expect(claimed.containerChanges).toEqual([expect.objectContaining({
      afterCodAmountTwd: null,
      afterRecipientName: '新收件人',
      codChanged: true,
      recipientChanged: true,
    })])
    expect(await h.prisma.containerLoadingItem.findUniqueOrThrow({
      where: { id: container.itemId },
      select: {
        codAmountTwd: true,
        recipientName: true,
        recipientPhone: true,
        recipientAddress: true,
        version: true,
      },
    })).toEqual({
      codAmountTwd: null,
      recipientName: '新收件人',
      recipientPhone: '0922000000',
      recipientAddress: '新地址',
      version: 3,
    })
    expect(await h.prisma.containerLoadingItemChange.count({
      where: { loadingItemId: container.itemId },
    })).toBe(2)
  })
})
