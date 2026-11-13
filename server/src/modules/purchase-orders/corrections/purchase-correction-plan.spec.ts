import type {
  PurchaseCorrectionPartSnapshot,
  PurchaseCorrectionPurchaseSnapshot,
} from './purchase-correction-plan'
import { buildPurchaseCorrectionPlan } from './purchase-correction-plan'

const SALES_ORDER_ID = '00000000-0000-4000-8000-000000000101'
const PURCHASE_ORDER_ID = '00000000-0000-4000-8000-000000000102'
const PART_ID = '00000000-0000-4000-8000-000000000103'

function part(overrides: Partial<PurchaseCorrectionPartSnapshot> = {}): PurchaseCorrectionPartSnapshot {
  return {
    id: PART_ID,
    partNumber: 1,
    shipmentNo: 'PKG/20261113-00001',
    status: 'ACTIVE',
    shippedAt: new Date('2026-11-01T02:00:00.000Z'),
    warehouseReceivedAt: new Date('2026-11-03T02:00:00.000Z'),
    loadedAt: new Date('2026-11-05T02:00:00.000Z'),
    deliveredAt: null,
    storageRecordCount: 0,
    ownership: {
      ownerType: 'SALES_ORDER',
      ownerSalesOrderId: SALES_ORDER_ID,
      state: 'ACTIVE',
    },
    ...overrides,
  }
}

function purchase(overrides: Partial<PurchaseCorrectionPurchaseSnapshot> = {}): PurchaseCorrectionPurchaseSnapshot {
  return {
    id: PURCHASE_ORDER_ID,
    orderNo: 'PO/20261101-00001',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'SHIPPED',
    paymentStatus: 'UNPAID',
    version: 4,
    parts: [part()],
    payments: [],
    packagingCosts: [],
    containerItems: [{
      id: '00000000-0000-4000-8000-000000000104',
      shipmentId: PART_ID,
      containerBatchId: '00000000-0000-4000-8000-000000000105',
      containerBatchNo: 'CTN/2026-001',
      hasChanges: false,
      reconciliations: [],
    }],
    loadGroups: [],
    ...overrides,
  }
}

const order = {
  id: SALES_ORDER_ID,
  orderNo: 'SO/20261101-00001',
  orderStatus: 'CONFIRMED' as const,
  fulfillmentStatus: 'SEA_TRANSIT' as const,
  version: 7,
}

function plan(
  purchases = [purchase()],
  claimed = new Map<string, number>(),
  overrides: Partial<Parameters<typeof buildPurchaseCorrectionPlan>[0]> = {},
) {
  return buildPurchaseCorrectionPlan({
    order,
    purchases,
    claimedQuantities: claimed,
    deliveryReceipts: [],
    settlementCount: 0,
    salesPaymentCount: 0,
    salesPaidAmount: '0.00',
    ...overrides,
  })
}

describe('buildPurchaseCorrectionPlan', () => {
  it('允许未签收且无其他覆盖的整单误建采购，并计算反冲金额', () => {
    const result = plan([
      purchase({
        payments: [{
          id: '00000000-0000-4000-8000-000000000106',
          purchaseOrderId: PURCHASE_ORDER_ID,
          purchaseOrderNo: 'PO/20261101-00001',
          paymentType: 'DEPOSIT',
          amount: '1200.00',
          paidAt: new Date('2026-11-02T02:00:00.000Z'),
          paymentMethod: '银行转账',
        }, {
          id: '00000000-0000-4000-8000-000000000107',
          purchaseOrderId: PURCHASE_ORDER_ID,
          purchaseOrderNo: 'PO/20261101-00001',
          paymentType: 'BALANCE',
          amount: '300.50',
          paidAt: new Date('2026-11-03T02:00:00.000Z'),
          paymentMethod: '银行转账',
        }],
        packagingCosts: [{
          id: '00000000-0000-4000-8000-000000000108',
          purchaseOrderId: PURCHASE_ORDER_ID,
          shipmentId: PART_ID,
          shipmentNo: 'PKG/20261113-00001',
          amount: '80.00',
          status: 'PENDING_PAYMENT',
        }],
      }),
    ])

    expect(result.canApply).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.totalPaymentAmount).toBe('1500.50')
    expect(result.packagingCostsToCancel).toHaveLength(1)
    expect(result.containerItemsToDetach).toHaveLength(1)
  })

  it('已签收订单进入签收纠正计划，签收单随上下文返回', () => {
    const result = plan(
      [purchase({ parts: [part({ deliveredAt: new Date('2026-11-10T02:00:00.000Z') })] })],
      new Map(),
      { deliveryReceipts: [{ id: '00000000-0000-4000-8000-000000000120', mediaAssetId: '00000000-0000-4000-8000-000000000124', createdAt: new Date('2026-11-10T02:00:00.000Z') }] },
    )
    expect(result.canApply).toBe(true)
    expect(result.blockers.map(row => row.code)).not.toContain('PURCHASE_CORRECTION_SIGNED')
    expect(result.signed).toBe(true)
    expect(result.deliveryReceipts).toHaveLength(1)
    expect(result.containerItemsToDelete).toHaveLength(1)
    expect(result.containerItemsToDetach).toEqual([])
  })

  it('已有对账结算时阻断签收纠正', () => {
    const result = plan([purchase()], new Map(), { settlementCount: 1 })
    expect(result.canApply).toBe(false)
    expect(result.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_SETTLED')
  })

  it('有变更记录的装柜行在签收纠正中只能解绑', () => {
    const result = plan([purchase({
      parts: [part({ deliveredAt: new Date('2026-11-10T02:00:00.000Z') })],
      containerItems: [{
        id: '00000000-0000-4000-8000-000000000121',
        shipmentId: PART_ID,
        containerBatchId: '00000000-0000-4000-8000-000000000122',
        containerBatchNo: 'CTN/2026-004',
        hasChanges: true,
        reconciliations: [],
      }],
    })], new Map(), { deliveryReceipts: [{ id: '00000000-0000-4000-8000-000000000123', mediaAssetId: '00000000-0000-4000-8000-000000000125', createdAt: new Date() }] })
    expect(result.signed).toBe(true)
    expect(result.containerItemsToDelete).toEqual([])
    expect(result.containerItemsToDetach).toHaveLength(1)
  })

  it('已付款包装费阻断，待付款包装费进入取消计划', () => {
    const result = plan([purchase({
      packagingCosts: [{
        id: '00000000-0000-4000-8000-000000000109',
        purchaseOrderId: PURCHASE_ORDER_ID,
        shipmentId: PART_ID,
        shipmentNo: 'PKG/20261113-00001',
        amount: '80.00',
        status: 'PAID',
      }],
    })])
    expect(result.canApply).toBe(false)
    expect(result.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_PACKAGING_PAID')
    expect(result.packagingCostsToCancel).toEqual([])
  })

  it('进行中的对账批次阻断，已完成的批次保留', () => {
    const inProgress = plan([purchase({
      containerItems: [{
        id: '00000000-0000-4000-8000-000000000110',
        shipmentId: PART_ID,
        containerBatchId: '00000000-0000-4000-8000-000000000111',
        containerBatchNo: 'CTN/2026-002',
        hasChanges: true,
        reconciliations: [{
          id: '00000000-0000-4000-8000-000000000112',
          batchNo: 'RECON/2026-001',
          completedAt: null,
        }],
      }],
    })])
    expect(inProgress.canApply).toBe(false)
    expect(inProgress.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_RECONCILING')

    const completed = plan([purchase({
      containerItems: [{
        id: '00000000-0000-4000-8000-000000000113',
        shipmentId: PART_ID,
        containerBatchId: '00000000-0000-4000-8000-000000000114',
        containerBatchNo: 'CTN/2026-003',
        hasChanges: false,
        reconciliations: [{
          id: '00000000-0000-4000-8000-000000000115',
          batchNo: 'RECON/2026-002',
          completedAt: new Date('2026-11-04T02:00:00.000Z'),
        }],
      }],
    })])
    expect(completed.canApply).toBe(true)
    expect(completed.preservedReconciliations).toHaveLength(1)
  })

  it('已有寄仓认领覆盖时阻断', () => {
    const result = plan([purchase()], new Map([['line-1', 1]]))
    expect(result.canApply).toBe(false)
    expect(result.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_OTHER_COVERAGE')
  })

  it('归属变化、寄仓记录和合并组跨单分别阻断', () => {
    const ownership = plan([purchase({
      parts: [part({ ownership: { ownerType: 'SALES_ORDER', ownerSalesOrderId: '00000000-0000-4000-8000-000000000999', state: 'ACTIVE' } })],
    })])
    expect(ownership.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_OWNERSHIP_CHANGED')

    const storage = plan([purchase({ parts: [part({ storageRecordCount: 1 })] })])
    expect(storage.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_STORAGE_RECORD')

    const group = plan([purchase({
      loadGroups: [{
        id: '00000000-0000-4000-8000-000000000116',
        version: 1,
        memberShipmentIds: [PART_ID, '00000000-0000-4000-8000-000000000999'],
      }],
    })])
    expect(group.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_LOAD_GROUP_MISMATCH')
  })

  it('没有有效采购单时阻断', () => {
    const result = plan([])
    expect(result.canApply).toBe(false)
    expect(result.blockers.map(row => row.code)).toContain('PURCHASE_CORRECTION_NO_ACTIVE_PURCHASE')
  })
})
