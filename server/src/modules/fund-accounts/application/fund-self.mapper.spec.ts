import { FundPostingError } from './fund-posting.errors'
import type { FundAccountView } from './fund-account.contract'
import type { FundTransactionView } from './fund-transaction.contract'
import {
  mapFundSelfAccountView,
  mapFundSelfTransactionView,
} from './fund-self.mapper'

const ACCOUNT_VIEW: FundAccountView = Object.freeze({
  id: 'account-id',
  ownerType: 'USER',
  user: Object.freeze({
    id: 'user-id',
    username: 'operator',
    displayName: '运营人员',
    avatarUrl: null,
    status: 'ACTIVE',
  }),
  currency: 'CNY',
  balance: '120.50',
  userShareRate: '30.00',
  companyShareRate: '70.00',
  version: 7,
  shareRateUpdatedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
})

const TRANSACTION_VIEW: FundTransactionView = Object.freeze({
  entryId: 'entry-id',
  batchId: 'batch-id',
  batchNo: 'FUND/20261017-001',
  batchKind: 'BUSINESS',
  account: Object.freeze({
    id: 'account-id',
    ownerType: 'USER',
    user: Object.freeze({
      id: 'user-id',
      username: 'operator',
      displayName: '运营人员',
      avatarUrl: null,
      status: 'ACTIVE',
    }),
  }),
  accountTarget: 'USER',
  postingTypeId: 'posting-type-id',
  postingTypeCode: 'ORDER_SETTLEMENT',
  postingTypeName: '订单结算',
  businessCategory: 'REVENUE',
  businessSourceId: 'source-id',
  businessSourceCode: 'FUND_E2E',
  businessSourceName: '资金 E2E 业务域',
  direction: 'CREDIT',
  amountStrategy: 'USER_SHARE',
  amount: '30.00',
  balanceBefore: '90.50',
  balanceAfter: '120.50',
  accountSequence: '3',
  businessAmount: '100.00',
  userShareRateSnapshot: '30.00',
  companyShareRateSnapshot: '70.00',
  businessId: 'business-id',
  businessNo: 'ORDER/0000001',
  summary: '订单结算入账',
  businessOccurredAt: '2026-10-01T08:00:00.000Z',
  adjustmentMode: null,
  reversalOfBatchId: null,
  reversalStatus: 'NONE',
  postedAt: '2026-10-01T08:00:01.000Z',
})

describe('fund self view mappers', () => {
  it('keeps only the operator-visible account fields and never exposes the company share rate', () => {
    const view = mapFundSelfAccountView(ACCOUNT_VIEW)

    expect(Object.keys(view).sort()).toEqual([
      'balance',
      'createdAt',
      'currency',
      'id',
      'shareRateUpdatedAt',
      'updatedAt',
      'userShareRate',
    ])
    expect(view).toEqual({
      id: 'account-id',
      currency: 'CNY',
      balance: '120.50',
      userShareRate: '30.00',
      shareRateUpdatedAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    })
  })

  it('rejects a company account as the caller self account', () => {
    const companyView: FundAccountView = Object.freeze({
      ...ACCOUNT_VIEW,
      ownerType: 'COMPANY',
      user: null,
      userShareRate: null,
      companyShareRate: null,
      shareRateUpdatedAt: null,
    })

    expect(() => mapFundSelfAccountView(companyView)).toThrow(FundPostingError)
  })

  it('trims the operator transaction view to the agreed fields', () => {
    const view = mapFundSelfTransactionView(TRANSACTION_VIEW)

    expect(Object.keys(view).sort()).toEqual([
      'accountSequence',
      'amount',
      'balanceAfter',
      'balanceBefore',
      'batchKind',
      'batchNo',
      'businessAmount',
      'businessCategory',
      'businessNo',
      'businessOccurredAt',
      'businessSourceName',
      'direction',
      'entryId',
      'postedAt',
      'postingTypeId',
      'postingTypeName',
      'reversalStatus',
      'summary',
      'userShareRateSnapshot',
    ])
    expect(view).not.toHaveProperty('companyShareRateSnapshot')
    expect(view).not.toHaveProperty('account')
    expect(view).not.toHaveProperty('accountTarget')
    expect(view).not.toHaveProperty('batchId')
    expect(view).toMatchObject({
      entryId: 'entry-id',
      summary: '订单结算入账',
      businessSourceName: '资金 E2E 业务域',
      businessNo: 'ORDER/0000001',
    })
  })

  it('strips a legacy withdrawal number that is already exposed as businessNo', () => {
    const view = mapFundSelfTransactionView({
      ...TRANSACTION_VIEW,
      postingTypeCode: 'USER_WITHDRAWAL',
      postingTypeName: '用户提款',
      businessNo: 'WD/20261017-0002',
      summary: '用户提款 WD/20261017-0002',
    })

    expect(view.summary).toBe('用户提款')
    expect(view.businessNo).toBe('WD/20261017-0002')
  })
})
