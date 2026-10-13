import type { Prisma } from '../../../generated/prisma/client'
import {
  readSalesOrderReconciliationStates,
  resolveSalesOrderCompletionHold,
  type SalesOrderReconciliationState,
} from './sales-order-reconciliation-state'

const ORDER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const COMPLETED_AT = new Date('2026-10-13T03:00:00.000Z')

/** 成员行的读取替身：完成判定只依赖「成员数」与「成员所属批次是否都已结束」两维事实。 */
function memberRow(overrides: {
  readonly salesOrderId?: string | null
  readonly batchId?: string
  readonly reconciledAt?: Date | null
  readonly completedAt?: Date | null
} = {}) {
  return {
    batchId: overrides.batchId ?? 'batch-1',
    reconciledAt: overrides.reconciledAt === undefined ? COMPLETED_AT : overrides.reconciledAt,
    batch: {
      completedAt: overrides.completedAt === undefined ? COMPLETED_AT : overrides.completedAt,
    },
    matchedLoadingItem: {
      shipment: overrides.salesOrderId === null
        ? null
        : { purchaseOrder: { salesOrderId: overrides.salesOrderId ?? ORDER_A } },
    },
  }
}

function clientWith(rows: readonly unknown[]) {
  const findMany = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(rows)
  return {
    findMany,
    client: {
      slhReconciliationBatchLine: { findMany },
    } as unknown as Prisma.TransactionClient,
  }
}

const settledState: SalesOrderReconciliationState = {
  memberCount: 2,
  pendingBatchCount: 0,
  unreconciledMemberCount: 0,
  settled: true,
}
const inProgressState: SalesOrderReconciliationState = {
  memberCount: 3,
  pendingBatchCount: 2,
  unreconciledMemberCount: 1,
  settled: false,
}
const noCoverageState: SalesOrderReconciliationState = {
  memberCount: 0,
  pendingBatchCount: 0,
  unreconciledMemberCount: 0,
  settled: false,
}
const payable = { fulfillmentStatus: 'SIGNED', paymentStatus: 'PAID' } as const

describe('readSalesOrderReconciliationStates', () => {
  it('不请求空入参，未被覆盖的订单落到「未完结」而不是已完成', async () => {
    const empty = clientWith([])
    await expect(readSalesOrderReconciliationStates(empty.client, []))
      .resolves.toEqual(new Map())
    expect(empty.findMany).not.toHaveBeenCalled()

    const { client } = clientWith([memberRow()])
    const states = await readSalesOrderReconciliationStates(client, [ORDER_A, ORDER_B])
    expect(states.get(ORDER_A)).toEqual({
      memberCount: 1,
      pendingBatchCount: 0,
      unreconciledMemberCount: 0,
      settled: true,
    })
    expect(states.get(ORDER_B)).toEqual({
      memberCount: 0,
      pendingBatchCount: 0,
      unreconciledMemberCount: 0,
      settled: false,
    })
  })

  it('按订单去重统计进行中的批次，并保留未核对行数', async () => {
    const { client } = clientWith([
      // 同一进行中批次的两行只算一个批次；其中一行未核对。
      memberRow({ batchId: 'pending-1', reconciledAt: null, completedAt: null }),
      memberRow({ batchId: 'pending-1', completedAt: null }),
      // 已结束批次里的行仍然计入成员数，但不占进行中计数。
      memberRow({ batchId: 'done-1' }),
    ])
    const states = await readSalesOrderReconciliationStates(client, [ORDER_A])
    expect(states.get(ORDER_A)).toEqual({
      memberCount: 3,
      pendingBatchCount: 1,
      unreconciledMemberCount: 1,
      settled: false,
    })
  })

  it('备货采购的货件没有来源销售订单，不归到任何订单名下', async () => {
    const { client } = clientWith([memberRow({ salesOrderId: null })])
    const states = await readSalesOrderReconciliationStates(client, [ORDER_A])
    expect(states.get(ORDER_A)?.settled).toBe(false)
  })
})

describe('resolveSalesOrderCompletionHold', () => {
  it.each(['CONFIRMED', 'COMPLETED', 'CANCELLED'] as const)(
    '%s 订单不显示停留原因',
    (orderStatus) => {
      expect(resolveSalesOrderCompletionHold({ orderStatus, ...payable }, settledState)).toBeNull()
    },
  )

  it('待对账但未签收或未收齐：付清前置先于对账完备性，且带上现有计数', () => {
    expect(resolveSalesOrderCompletionHold(
      { orderStatus: 'PENDING_RECONCILIATION', fulfillmentStatus: 'SEA_TRANSIT', paymentStatus: 'PAID' },
      inProgressState,
    )).toEqual({ reason: 'PAYMENT_INCOMPLETE', pendingBatchCount: 2, unreconciledMemberCount: 1 })
    expect(resolveSalesOrderCompletionHold(
      { orderStatus: 'PENDING_RECONCILIATION', fulfillmentStatus: 'SIGNED', paymentStatus: 'PARTIALLY_PAID' },
      noCoverageState,
    )).toEqual({ reason: 'PAYMENT_INCOMPLETE', pendingBatchCount: 0, unreconciledMemberCount: 0 })
  })

  it('待对账且有进行中批次：给出批次与未核对行数', () => {
    expect(resolveSalesOrderCompletionHold(
      { orderStatus: 'PENDING_RECONCILIATION', ...payable },
      inProgressState,
    )).toEqual({ reason: 'RECONCILIATION_IN_PROGRESS', pendingBatchCount: 2, unreconciledMemberCount: 1 })
  })

  it('待对账且对账已完结或读取缺失：不显示原因（正常会被自动推进到已完成）', () => {
    expect(resolveSalesOrderCompletionHold(
      { orderStatus: 'PENDING_RECONCILIATION', ...payable },
      settledState,
    )).toBeNull()
    expect(resolveSalesOrderCompletionHold(
      { orderStatus: 'PENDING_RECONCILIATION', ...payable },
      undefined,
    )).toBeNull()
  })

  it('待对账且从未被账单覆盖：等待账单对账', () => {
    expect(resolveSalesOrderCompletionHold(
      { orderStatus: 'PENDING_RECONCILIATION', ...payable },
      noCoverageState,
    )).toEqual({ reason: 'AWAITING_RECONCILIATION_COVERAGE', pendingBatchCount: 0, unreconciledMemberCount: 0 })
  })
})
