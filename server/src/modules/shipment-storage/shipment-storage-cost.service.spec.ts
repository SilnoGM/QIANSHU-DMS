import type { Prisma } from '../../generated/prisma/client'
import type { FundPostingService } from '../fund-accounts/application/fund-posting.contract'
import { ShipmentStorageCostService } from './shipment-storage-cost.service'

const ACTOR_ID = '00000000-0000-4000-8000-000000000601'
const RECORD_ID = '00000000-0000-4000-8000-000000000602'
const SHIPMENT_ID = '00000000-0000-4000-8000-000000000603'
const USER_ID = '00000000-0000-4000-8000-000000000604'
const BATCH_ID = '00000000-0000-4000-8000-000000000605'
const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }
const input = {
  amountCny: '100.00',
  shipmentId: SHIPMENT_ID,
  shipmentNo: 'PKG/20261029-00001',
  storageRecordId: RECORD_ID,
  userId: USER_ID,
}
const storageRecord = {
  originCustomerNameSnapshot: '李育泉',
  originPurchaseOrderNoSnapshot: 'PO/20261114-00820',
  originSalesOrderNoSnapshot: 'SO/20261114-00825',
  shippingMarkSnapshot: 'QS-001',
  shipmentNoSnapshot: 'PKG/20261029-00001',
}

function setup(options: { readonly record?: typeof storageRecord } = {}) {
  const preview = jest.fn().mockResolvedValue({
    businessAmount: '100.00',
    companyShareRate: '70.00',
    entries: [
      { accountTarget: 'USER', direction: 'DEBIT', amount: '30.00' },
      { accountTarget: 'COMPANY', direction: 'DEBIT', amount: '70.00' },
    ],
    ruleVersionId: 'rule-1',
    userShareRate: '30.00',
  })
  const post = jest.fn().mockResolvedValue({
    batchId: BATCH_ID,
    businessAmount: '100.00',
    businessCategory: 'COST',
    companyShareRateSnapshot: '70.00',
    entries: [{
      accountId: 'account-1',
      accountSequence: '1',
      accountTarget: 'USER',
      amount: '30.00',
      balanceAfter: '-30.00',
      balanceBefore: '0.00',
      direction: 'DEBIT',
      entryId: 'entry-1',
    }],
    idempotentReplay: false,
    postedAt: '2026-10-29T00:00:00.000Z',
    postingTypeCode: 'SHIPMENT_STORAGE_CLAIM',
    userShareRateSnapshot: '30.00',
  })
  const funds = {
    postBusinessEventInTransaction: post,
    previewBusinessEventInTransaction: preview,
  } as unknown as FundPostingService
  const transaction = {
    shipmentCostEvent: { create: jest.fn().mockResolvedValue({}) },
    // 来源说明读取寄仓记录上冻结的客户与单号快照；没有记录时仍要能入账。
    shipmentStorageRecord: {
      findUnique: jest.fn().mockResolvedValue(options.record ?? null),
    },
  } as unknown as Prisma.TransactionClient
  const audit = { record: jest.fn().mockResolvedValue({}) }
  const service = new ShipmentStorageCostService(funds, audit)
  return { audit, post, preview, service, transaction }
}

describe('ShipmentStorageCostService', () => {
  it('posts a claim charge with the claim consumer and records one cost event', async () => {
    const fixture = setup({ record: storageRecord })

    await expect(fixture.service.transfer(
      fixture.transaction,
      context,
      'CLAIM',
      {
        ...input,
        customerName: '胡憲政',
        targetSalesOrderNo: 'SO/20261114-00824',
      },
    )).resolves.toEqual({ amountCny: '100.00', batchId: BATCH_ID })

    expect(fixture.preview).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        consumerCode: 'SHIPMENT_STORAGE.CLAIM',
        sourceCode: 'SHIPMENT_STORAGE',
      }),
      expect.objectContaining({
        amount: '100.00',
        idempotencyKey: `${RECORD_ID}:CLAIM`,
        postingTypeCode: 'SHIPMENT_STORAGE_CLAIM',
        userId: USER_ID,
        // 认领是承接方承担随货件转移的成本，主体与动作都站在承接方一侧。
        summary: '调寄仓货物成本转入',
        source: expect.objectContaining({
          action: '调寄仓货物成本转入',
          customerName: '胡憲政',
          detail: [
            { label: '成本方向', value: '转入（出账）' },
            { label: '原销售单', value: 'SO/20261114-00825' },
            { label: '调入销售单', value: 'SO/20261114-00824' },
            { label: '原采购单', value: 'PO/20261114-00820' },
            { label: '唛头', value: 'QS-001' },
          ],
          headline: 'PKG/20261029-00001 · 调寄仓货物成本转入',
          subject: '胡憲政',
        }) as unknown,
      }),
    )
    expect(fixture.post).toHaveBeenCalledTimes(1)
    const create = fixture.transaction.shipmentCostEvent.create as unknown as jest.Mock
    const calls = create.mock.calls as unknown[][]
    const eventInput = calls[0]?.[0] as {
      data: {
        amountCny: { toFixed: (digits: number) => string }
        direction: string
        fundPostingBatchIds: string[]
        storageRecordId: string
      }
    } | undefined
    expect(eventInput?.data).toMatchObject({
      direction: 'CLAIM',
      fundPostingBatchIds: [BATCH_ID],
      storageRecordId: RECORD_ID,
    })
    expect(eventInput?.data.amountCny.toFixed(2)).toBe('100.00')
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: 'SHIPMENT_COST_TRANSFERRED',
        metadata: expect.objectContaining({
          direction: 'CLAIM',
          fundPostingBatchId: BATCH_ID,
        }) as unknown,
      }),
    )
  })

  it('posts a release refund with the release consumer', async () => {
    const fixture = setup({ record: storageRecord })

    await fixture.service.transfer(fixture.transaction, context, 'RELEASE', input)

    expect(fixture.preview).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({ consumerCode: 'SHIPMENT_STORAGE.RELEASE' }),
      expect.objectContaining({
        idempotencyKey: `${RECORD_ID}:RELEASE`,
        postingTypeCode: 'SHIPMENT_STORAGE_RELEASE',
        // 退还方向由取消/拒收把货件回收进寄仓触发，金额退回原客户与公司。
        summary: '寄仓货物成本退还',
        source: expect.objectContaining({
          action: '寄仓货物成本退还',
          customerName: '李育泉',
          detail: [
            { label: '成本方向', value: '退还（入账）' },
            { label: '原销售单', value: 'SO/20261114-00825' },
            { label: '原采购单', value: 'PO/20261114-00820' },
            { label: '唛头', value: 'QS-001' },
          ],
          subject: '李育泉',
        }) as unknown,
      }),
    )
  })

  it('falls back to the frozen origin customer when the claim has no target customer', async () => {
    const fixture = setup({ record: storageRecord })

    await fixture.service.transfer(fixture.transaction, context, 'CLAIM', input)

    expect(fixture.preview).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({ consumerCode: 'SHIPMENT_STORAGE.CLAIM' }),
      expect.objectContaining({
        source: expect.objectContaining({
          detail: [
            { label: '成本方向', value: '转入（出账）' },
            { label: '原销售单', value: 'SO/20261114-00825' },
            { label: '原采购单', value: 'PO/20261114-00820' },
            { label: '唛头', value: 'QS-001' },
          ],
          subject: '李育泉',
        }) as unknown,
      }),
    )
  })

  it('skips zero-cost transfers without touching funds or cost events', async () => {
    const fixture = setup()

    await expect(fixture.service.transfer(
      fixture.transaction,
      context,
      'CLAIM',
      { ...input, amountCny: '0.00' },
    )).resolves.toBeNull()

    expect(fixture.preview).not.toHaveBeenCalled()
    expect(fixture.transaction.shipmentCostEvent.create).not.toHaveBeenCalled()
  })

  it('does not write a cost event when fund posting fails', async () => {
    const fixture = setup()
    fixture.post.mockRejectedValue(new Error('fund unavailable'))

    await expect(fixture.service.transfer(
      fixture.transaction,
      context,
      'CLAIM',
      input,
    )).rejects.toThrow('fund unavailable')

    expect(fixture.transaction.shipmentCostEvent.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })
})
