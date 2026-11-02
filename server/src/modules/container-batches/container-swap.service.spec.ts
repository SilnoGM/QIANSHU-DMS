import { randomUUID } from 'node:crypto'

import { Prisma } from '../../generated/prisma/client'
import type { AccessControlService } from '../access-control/access-control.service'
import type { ShipmentOwnershipService } from '../shipment-ownership/shipment-ownership.service'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ContainerSwapService } from './container-swap.service'
import type { ContainerSwapRequestDto } from './container-swap.dto'

function owner(orderNo: string, customerName: string): {
  id: string
  orderNo: string
  customerName: string
  issuerUserId: string
  orderStatus: 'CONFIRMED'
  fulfillmentStatus: 'SEA_TRANSIT' | 'WAREHOUSE_ARRIVED'
} {
  return {
    id: randomUUID(),
    orderNo,
    customerName,
    issuerUserId: randomUUID(),
    orderStatus: 'CONFIRMED' as const,
    fulfillmentStatus: 'SEA_TRANSIT' as const,
  }
}

function part(input: {
  shipmentNo: string
  owner: ReturnType<typeof owner>
  productId: string
  recipientName: string
  cod: string | null
}) {
  const batch = { id: randomUUID(), containerBatchNo: `B-${input.shipmentNo}`, containerBatchName: `柜-${input.shipmentNo}` }
  const loadingItemId = randomUUID()
  return {
    id: randomUUID(),
    shipmentNo: input.shipmentNo,
    shippingMarkText: `MARK-${input.shipmentNo}`,
    status: 'ACTIVE' as const,
    loadedAt: new Date('2026-11-01T00:00:00.000Z'),
    deliveredAt: null,
    purchaseOrderId: randomUUID(),
    purchaseOrder: { id: randomUUID(), orderNo: `PO-${input.shipmentNo}`, orderStatus: 'CONFIRMED' as const },
    ownershipCurrent: {
      ownerType: 'SALES_ORDER' as const,
      ownerSalesOrderId: input.owner.id,
      state: 'ACTIVE' as const,
      ownerSalesOrder: input.owner,
    },
    items: [{
      quantity: 10,
      line: {
        id: randomUUID(),
        lineType: 'CATALOG' as const,
        productId: input.productId,
        productNameSnapshot: '产品 X',
        sourceSalesOrderLineId: randomUUID(),
        sourceSalesOrderLine: { productId: input.productId, productNameSnapshot: '产品 X' },
      },
    }],
    containerLoadingItems: [{
      id: loadingItemId,
      containerBatchId: batch.id,
      lineNumber: 1,
      version: 1,
      goodsName: '货物',
      oceanShippingMarkText: `OCEAN-${input.shipmentNo}`,
      recipientName: input.recipientName,
      recipientPhone: '0911000000',
      recipientAddress: `${input.recipientName}地址`,
      codAmountTwd: input.cod === null ? null : new Prisma.Decimal(input.cod),
      remark: `${input.recipientName}备注`,
      containerBatch: batch,
    }],
  }
}

function harness() {
  const ownerA = owner('SO-A', '客户 A')
  const ownerB = owner('SO-B', '客户 B')
  const productId = randomUUID()
  const left = part({ shipmentNo: 'SHIP-A', owner: ownerA, productId, recipientName: 'A 收件', cod: '100' })
  const right = part({ shipmentNo: 'SHIP-B', owner: ownerB, productId, recipientName: 'B 收件', cod: '200' })
  const orderLines = [
    { id: randomUUID(), salesOrderId: ownerA.id, lineType: 'CATALOG' as const, productId, productNameSnapshot: '产品 X', quantity: 10 },
    { id: randomUUID(), salesOrderId: ownerB.id, lineType: 'CATALOG' as const, productId, productNameSnapshot: '产品 X', quantity: 10 },
  ]
  const read = {
    purchaseOrderPart: { findMany: jest.fn().mockResolvedValue([left, right]) },
    salesOrderLine: { findMany: jest.fn().mockResolvedValue(orderLines) },
    salesOrderDocument: { count: jest.fn().mockResolvedValue(0) },
    shipmentStorageRecord: { findMany: jest.fn().mockResolvedValue([]) },
    shipmentStorageClaimRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    slhReconciliationSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
    slhReconciliationBatchLine: { findFirst: jest.fn().mockResolvedValue(null) },
    packagingCostRequest: { count: jest.fn().mockResolvedValue(0) },
  }
  const versions = new Map<string, number>([[left.containerLoadingItems[0].id, 1], [right.containerLoadingItems[0].id, 1]])
  const tx = {
    ...read,
    user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    shipmentOwnershipEvent: { findMany: jest.fn().mockResolvedValue([]) },
    containerLoadingItem: {
      update: jest.fn(({ where }: { where: { id: string } }) => {
        const next = (versions.get(where.id) ?? 1) + 1
        versions.set(where.id, next)
        return Promise.resolve({ version: next })
      }),
    },
    containerLoadingItemChange: { create: jest.fn().mockResolvedValue({ id: randomUUID() }) },
    containerBatch: { update: jest.fn().mockResolvedValue({}) },
  }
  const prisma = {
    ...read,
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  }
  const access = {
    getPermissionCodesInTransaction: jest.fn().mockResolvedValue(['container-batches:update']),
    hasAll: jest.fn().mockReturnValue(true),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const ownership = { recordMany: jest.fn().mockResolvedValue([]) }
  const service = new ContainerSwapService(
    prisma as unknown as PrismaService,
    access as unknown as AccessControlService,
    audit,
    ownership as unknown as ShipmentOwnershipService,
  )
  return { service, prisma, tx, left, right, ownerA, ownerB, orderLines, audit, ownership, access }
}

function context() {
  return { actorUserId: randomUUID(), requestId: randomUUID() }
}

function request(left: ReturnType<typeof part>, right: ReturnType<typeof part>, leftCod: string | null, rightCod: string | null): ContainerSwapRequestDto {
  return {
    leftShipmentId: left.id,
    rightShipmentId: right.id,
    leftLines: [{ loadingItemId: left.containerLoadingItems[0].id, expectedVersion: 1, codAmountTwd: leftCod }],
    rightLines: [{ loadingItemId: right.containerLoadingItems[0].id, expectedVersion: 1, codAmountTwd: rightCod }],
    note: '测试对换',
  }
}

describe('ContainerSwapService context', () => {
  it('exchanges recipient/remark previews while keeping COD for manual input', async () => {
    const test = harness()
    const result = await test.service.getContext(test.left.id, test.right.id)
    expect(result.canSwap).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.left.containerLoadingItems[0]).toMatchObject({
      recipientName: 'A 收件',
      afterRecipientName: 'B 收件',
      afterRecipientAddress: 'B 收件地址',
      afterRemark: 'B 收件备注',
      codAmountTwd: '100.00',
    })
    expect(result.right.containerLoadingItems[0]).toMatchObject({
      recipientName: 'B 收件',
      afterRecipientName: 'A 收件',
      afterRemark: 'A 收件备注',
      codAmountTwd: '200.00',
    })
  })

  it('blocks orders that are not in SEA_TRANSIT', async () => {
    const test = harness()
    test.right.ownershipCurrent.ownerSalesOrder.fulfillmentStatus = 'WAREHOUSE_ARRIVED'
    const result = await test.service.getContext(test.left.id, test.right.id)
    expect(result.canSwap).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CONTAINER_SWAP_NOT_ALLOWED' })]))
  })

  it('blocks product or quantity mismatches', async () => {
    const test = harness()
    test.prisma.salesOrderLine.findMany.mockResolvedValue(test.orderLines.map((line, index) => (
      index === 1 ? { ...line, quantity: 9 } : line
    )))
    const result = await test.service.getContext(test.left.id, test.right.id)
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CONTAINER_SWAP_PRODUCT_MISMATCH' })]))
  })

  it('blocks pending packaging, settled items and reconciliation batch members', async () => {
    const packaging = harness()
    packaging.prisma.packagingCostRequest.count.mockResolvedValue(1)
    expect((await packaging.service.getContext(packaging.left.id, packaging.right.id)).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONTAINER_SWAP_PACKAGING_UNPAID' })]),
    )

    const settled = harness()
    settled.prisma.slhReconciliationSettlement.findFirst.mockResolvedValue({ id: randomUUID() })
    expect((await settled.service.getContext(settled.left.id, settled.right.id)).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONTAINER_SWAP_SETTLED' })]),
    )

    const reconciling = harness()
    reconciling.prisma.slhReconciliationBatchLine.findFirst.mockResolvedValue({ id: randomUUID() })
    expect((await reconciling.service.getContext(reconciling.left.id, reconciling.right.id)).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONTAINER_SWAP_RECONCILING' })]),
    )
  })

  it('blocks stored/claimed shipments and existing delivery receipts', async () => {
    const stored = harness()
    stored.prisma.shipmentStorageRecord.findMany.mockResolvedValue([{ shipmentId: stored.left.id }])
    expect((await stored.service.getContext(stored.left.id, stored.right.id)).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONTAINER_SWAP_NOT_ALLOWED' })]),
    )

    const receipt = harness()
    receipt.prisma.salesOrderDocument.count.mockResolvedValue(1)
    expect((await receipt.service.getContext(receipt.left.id, receipt.right.id)).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONTAINER_SWAP_NOT_ALLOWED' })]),
    )
  })
})

describe('ContainerSwapService swap', () => {
  it('writes recipient/remark and manual COD changes, then swaps ownership in one transaction', async () => {
    const test = harness()
    const result = await test.service.swap(
      context(),
      request(test.left, test.right, '150', null),
      randomUUID(),
    )
    expect(result).toMatchObject({ changedLineCount: 2, replayed: false })
    expect(test.tx.containerLoadingItem.update).toHaveBeenCalledTimes(4)
    expect(test.tx.containerLoadingItemChange.create).toHaveBeenCalledTimes(4)
    expect(test.tx.containerBatch.update).toHaveBeenCalledTimes(2)
    expect(test.ownership.recordMany).toHaveBeenCalledWith(
      test.tx,
      expect.arrayContaining([
        expect.objectContaining({
          shipmentId: test.left.id,
          ownerSalesOrderId: test.ownerB.id,
          ownerType: 'SALES_ORDER',
          reason: 'OTHER',
        }),
        expect.objectContaining({
          shipmentId: test.right.id,
          ownerSalesOrderId: test.ownerA.id,
          ownerType: 'SALES_ORDER',
          reason: 'OTHER',
        }),
      ]),
    )
    expect(test.audit.record).toHaveBeenCalledTimes(6)
  })

  it('rejects stale loading item versions before writing', async () => {
    const test = harness()
    test.left.containerLoadingItems[0].version = 2
    await expect(test.service.swap(context(), request(test.left, test.right, '150', null), randomUUID()))
      .rejects.toMatchObject({ code: 'CONTAINER_SWAP_LINE_CHANGED' })
    expect(test.ownership.recordMany).not.toHaveBeenCalled()
    expect(test.tx.containerLoadingItem.update).not.toHaveBeenCalled()
  })
})
