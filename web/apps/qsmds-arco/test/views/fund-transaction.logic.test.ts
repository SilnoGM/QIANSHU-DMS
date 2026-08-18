import type {
  FundPostingBatchDetailDto,
  FundPostingBatchEntryDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 资金流水纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildFundTransactionQuery,
  calculateFundReversalPreview,
  canReverseFundBatch,
  getFundBatchKindLabel,
  getFundBusinessCategoryLabel,
  getFundDirectionState,
  getFundReversalStatusLabel,
} from '../../src/views/admin/fund-account-management/transactions/fund-transaction.logic'

const USER_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
const COMPANY_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const TYPE_ID = '44444444-4444-4444-8444-444444444444'
const SOURCE_ID = '55555555-5555-4555-8555-555555555555'

function entryFixture(
  overrides: Partial<FundPostingBatchEntryDto>,
): FundPostingBatchEntryDto {
  return {
    account: {
      id: USER_ACCOUNT_ID,
      ownerType: 'USER',
      user: {
        displayName: '测试用户',
        id: USER_ID,
        status: 'ACTIVE',
        username: 'tester',
      },
    },
    accountSequence: '1',
    accountTarget: 'USER',
    amount: '30.0000',
    amountStrategy: 'USER_SHARE',
    balanceAfter: '30.0000',
    balanceBefore: '0.0000',
    direction: 'CREDIT',
    entryId: 'entry-user',
    lineNo: 1,
    postedAt: '2026-08-18T01:00:01.000Z',
    ...overrides,
  }
}

function batchFixture(
  overrides: Partial<FundPostingBatchDetailDto> = {},
): FundPostingBatchDetailDto {
  return {
    actorUserId: null,
    // OpenAPI 当前把 nullable 字段生成成必填联合；普通业务批次运行时返回 null。
    adjustmentMode: null as unknown as 'USER_ONLY',
    batchNo: 'FB202608180001',
    businessAmount: '100.0000',
    businessCategory: 'REVENUE',
    businessId: 'order-id',
    businessNo: '0000011',
    businessOccurredAt: '2026-08-18T01:00:00.000Z',
    businessSourceCode: 'ORDER_DOMAIN',
    businessSourceId: SOURCE_ID,
    businessSourceName: '订单域',
    companyShareRateSnapshot: '70.0000',
    correlationId: null,
    currency: 'CNY',
    entries: [
      entryFixture({}),
      entryFixture({
        account: {
          id: COMPANY_ACCOUNT_ID,
          ownerType: 'COMPANY',
          user: null,
        },
        accountSequence: '5',
        accountTarget: 'COMPANY',
        amount: '70.0000',
        amountStrategy: 'COMPANY_REMAINDER',
        balanceAfter: '1070.0000',
        balanceBefore: '1000.0000',
        entryId: 'entry-company',
        lineNo: 2,
      }),
    ],
    id: 'batch-id',
    kind: 'BUSINESS',
    metadata: { orderNo: '0000011' },
    postedAt: '2026-08-18T01:00:01.000Z',
    postingTypeCode: 'ORDER_SETTLEMENT',
    postingTypeId: TYPE_ID,
    postingTypeName: '订单结算',
    requestId: 'request-id',
    reversalChain: {
      originalAmount: '100.0000',
      originalBatchId: 'batch-id',
      originalBatchNo: 'FB202608180001',
      remainingAmount: '80.0000',
      reversals: [{
        actorUserId: 'admin-id',
        amount: '20.0000',
        batchId: 'reversal-1',
        batchNo: 'FR202608180001',
        postedAt: '2026-08-18T02:00:00.000Z',
        reason: '第一次部分冲账',
      }],
      reversedAmount: '20.0000',
      status: 'PARTIAL',
    },
    reversalOfBatchId: null,
    reversalReason: null,
    ruleRevision: 1,
    ruleVersionId: 'rule-version-id',
    summary: '订单 0000011 结算',
    user: {
      displayName: '测试用户',
      id: USER_ID,
      status: 'ACTIVE',
      username: 'tester',
    },
    userShareRateSnapshot: '30.0000',
    ...overrides,
  }
}

test('流水查询只输出服务端支持的稳定分页、筛选和 ISO 时间字段', () => {
  const occurredFrom = '2026-08-18T09:00'
  const occurredTo = '2026-08-18T18:30'
  assert.deepEqual(buildFundTransactionQuery({
    filters: {
      accountId: USER_ACCOUNT_ID,
      businessCategory: 'REVENUE',
      businessNo: '  0000011  ',
      businessSourceId: SOURCE_ID,
      direction: 'CREDIT',
      occurredFrom,
      occurredTo,
      postingTypeId: TYPE_ID,
      reversalStatus: 'PARTIAL',
      userId: USER_ID,
    },
    page: 3,
    pageSize: 50,
    sortBy: 'businessOccurredAt',
    sortOrder: 'asc',
  }), {
    accountId: USER_ACCOUNT_ID,
    businessCategory: 'REVENUE',
    businessNo: '0000011',
    businessSourceId: SOURCE_ID,
    direction: 'CREDIT',
    occurredFrom: new Date(occurredFrom).toISOString(),
    occurredTo: new Date(occurredTo).toISOString(),
    page: 3,
    pageSize: 50,
    postingTypeId: TYPE_ID,
    reversalStatus: 'PARTIAL',
    sortBy: 'businessOccurredAt',
    sortOrder: 'asc',
    userId: USER_ID,
  })

  assert.deepEqual(buildFundTransactionQuery({
    filters: { businessNo: '   ' },
    page: 1,
    pageSize: 20,
    sortBy: 'postedAt',
    sortOrder: 'desc',
  }), {
    page: 1,
    pageSize: 20,
    sortBy: 'postedAt',
    sortOrder: 'desc',
  })
  assert.throws(() => buildFundTransactionQuery({
    filters: {
      occurredFrom: '2026-08-19T00:00',
      occurredTo: '2026-08-18T00:00',
    },
    page: 1,
    pageSize: 20,
    sortBy: 'postedAt',
    sortOrder: 'desc',
  }))
})

test('部分冲账预览使用累计目标差额并保持用户比例与公司尾差守恒', () => {
  assert.deepEqual(calculateFundReversalPreview(batchFixture(), '40'), {
    cumulativeReversedAmount: '60.0000',
    entries: [
      {
        accountTarget: 'USER',
        amount: '12.0000',
        direction: 'DEBIT',
        originalLineNo: 1,
      },
      {
        accountTarget: 'COMPANY',
        amount: '28.0000',
        direction: 'DEBIT',
        originalLineNo: 2,
      },
    ],
    reversalAmount: '40.0000',
    reversalBusinessAmount: '-40.0000',
    reversalStatus: 'PARTIAL',
  })
})

test('负数订单亏损冲账生成入账方向，最后一次冲账与原分录精确闭合', () => {
  const loss = batchFixture({
    businessAmount: '-100.0000',
    entries: batchFixture().entries.map(entry => ({
      ...entry,
      balanceAfter: entry.accountTarget === 'USER' ? '-30.0000' : '930.0000',
      direction: 'DEBIT' as const,
    })),
  })
  const lossPreview = calculateFundReversalPreview(loss, '40')
  assert.equal(lossPreview.reversalBusinessAmount, '40.0000')
  assert.deepEqual(
    lossPreview.entries.map(entry => entry.direction),
    ['CREDIT', 'CREDIT'],
  )

  const rounding = batchFixture({
    businessAmount: '0.0003',
    entries: [
      entryFixture({ amount: '0.0001' }),
      entryFixture({
        account: { id: COMPANY_ACCOUNT_ID, ownerType: 'COMPANY', user: null },
        accountTarget: 'COMPANY',
        amount: '0.0002',
        amountStrategy: 'COMPANY_REMAINDER',
        entryId: 'entry-company',
        lineNo: 2,
      }),
    ],
    reversalChain: {
      originalAmount: '0.0003',
      originalBatchId: 'batch-id',
      originalBatchNo: 'FB202608180001',
      remainingAmount: '0.0002',
      reversals: [],
      reversedAmount: '0.0001',
      status: 'PARTIAL',
    },
    userShareRateSnapshot: '50.0000',
    companyShareRateSnapshot: '50.0000',
  })
  assert.deepEqual(calculateFundReversalPreview(rounding, '0.0002').entries, [
    {
      accountTarget: 'COMPANY',
      amount: '0.0002',
      direction: 'DEBIT',
      originalLineNo: 2,
    },
  ])
})

test('冲账资格同时受批次类型、剩余额度和独立权限约束', () => {
  const detail = batchFixture()
  assert.equal(canReverseFundBatch(detail, true), true)
  assert.equal(canReverseFundBatch(detail, false), false)
  assert.equal(canReverseFundBatch({
    ...detail,
    kind: 'REVERSAL',
    reversalOfBatchId: 'original-id',
  }, true), false)
  assert.equal(canReverseFundBatch({
    ...detail,
    reversalChain: { ...detail.reversalChain, remainingAmount: '0.0000', status: 'FULL' },
  }, true), false)
})

test('方向状态同时提供符号与中文语义，不只依赖颜色', () => {
  assert.deepEqual(getFundDirectionState('CREDIT'), {
    label: '入账',
    sign: '+',
    tone: 'credit',
  })
  assert.deepEqual(getFundDirectionState('DEBIT'), {
    label: '出账',
    sign: '-',
    tone: 'debit',
  })
})

test('收益、成本、中性、调账和三类批次均使用稳定中文语义展示', () => {
  assert.deepEqual([
    getFundBusinessCategoryLabel('REVENUE'),
    getFundBusinessCategoryLabel('COST'),
    getFundBusinessCategoryLabel('NEUTRAL'),
    getFundBusinessCategoryLabel('ADJUSTMENT'),
  ], ['收益', '成本', '中性', '调账'])
  assert.deepEqual([
    getFundBatchKindLabel('BUSINESS'),
    getFundBatchKindLabel('MANUAL_ADJUSTMENT'),
    getFundBatchKindLabel('REVERSAL'),
  ], ['业务动账', '管理员调账', '冲账批次'])
  assert.deepEqual([
    getFundReversalStatusLabel('NONE'),
    getFundReversalStatusLabel('PARTIAL'),
    getFundReversalStatusLabel('FULL'),
    getFundReversalStatusLabel('NOT_APPLICABLE'),
  ], ['未冲账', '部分冲账', '已全部冲账', '冲账批次'])
})
