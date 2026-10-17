import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { INITIAL_FUND_POSTING_RULES } from '../domain'
import { NumberingGeneratorService } from '../../numbering/numbering-generator.service'
import {
  insertFundLedgerEntries,
  insertFundManualAdjustmentBatch,
  lockFundAccountsForPosting,
  lockFundBusinessSourceForPosting,
  lockFundPostingTypeForPosting,
  readFundManualAdjustmentIdentities,
  readFundPostingTransactionTimestamp,
  readFundSourceTypeAuthorization,
  readIdempotentFundPosting,
  updateFundAccountForPosting,
} from './fund-posting.persistence'
import { FundPostingApplicationService } from './fund-posting.service'

jest.mock('./fund-posting.persistence')

const USER_ID = '10000000-0000-4000-8000-000000000001'
const USER_ACCOUNT_ID = '10000000-0000-4000-8000-000000000002'
const COMPANY_ACCOUNT_ID = '10000000-0000-4000-8000-000000000003'
const SOURCE_ID = '10000000-0000-4000-8000-000000000004'
const TYPE_ID = '10000000-0000-4000-8000-000000000005'
const RULE_ID = '10000000-0000-4000-8000-000000000006'
const AS_OF = new Date('2026-08-18T12:00:00.000Z')

const mockedTimestamp = jest.mocked(readFundPostingTransactionTimestamp)
const mockedReplay = jest.mocked(readIdempotentFundPosting)
const mockedSource = jest.mocked(lockFundBusinessSourceForPosting)
const mockedType = jest.mocked(lockFundPostingTypeForPosting)
const mockedAuthorization = jest.mocked(readFundSourceTypeAuthorization)
const mockedIdentities = jest.mocked(readFundManualAdjustmentIdentities)
const mockedAccounts = jest.mocked(lockFundAccountsForPosting)
const mockedInsertBatch = jest.mocked(insertFundManualAdjustmentBatch)
const mockedUpdateAccount = jest.mocked(updateFundAccountForPosting)
const mockedInsertEntries = jest.mocked(insertFundLedgerEntries)

function fixture() {
  const transaction = { $queryRaw: jest.fn().mockResolvedValue([]) }
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof transaction) => unknown) => (
      callback(transaction)
    )),
  }
  const audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) }
  const numbering = {
    generateScopedInTransaction: jest.fn().mockResolvedValue({
      issuanceId: '66666666-6666-4666-a666-666666666666',
      number: 'FUND/20261017-00001',
      ruleCode: 'FUND_POSTING_BATCH_NO',
      ruleRevision: 1,
      issuedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    }),
  }
  return {
    audit,
    service: new FundPostingApplicationService(
      prisma as unknown as PrismaService,
      audit,
      numbering as unknown as NumberingGeneratorService,
    ),
  }
}

function configureSuccess(): void {
  const rule = INITIAL_FUND_POSTING_RULES.find(
    item => item.postingTypeCode === 'ADMIN_MANUAL_ADJUSTMENT',
  )
  if (rule === undefined) throw new Error('missing administrator rule fixture')

  mockedTimestamp.mockResolvedValue(AS_OF)
  mockedReplay.mockResolvedValue(null)
  mockedSource.mockResolvedValue({
    id: SOURCE_ID,
    code: 'ADMIN_CONSOLE',
    name: '管理员工作台',
    enabled: true,
  })
  mockedType.mockResolvedValue({
    id: TYPE_ID,
    code: rule.postingTypeCode,
    name: '管理员手动调账',
    businessCategory: rule.businessCategory,
    requiresUser: rule.requiresUser,
    amountSignPolicy: rule.amountSignPolicy,
    inputMode: rule.inputMode,
    enabled: true,
    currentRuleVersionId: RULE_ID,
    ruleVersion: {
      id: RULE_ID,
      revision: 1,
      status: 'ACTIVE',
      legs: rule.legs,
    },
  })
  mockedAuthorization.mockResolvedValue(true)
  mockedIdentities.mockResolvedValue({
    userId: USER_ID,
    userAccountId: USER_ACCOUNT_ID,
    companyAccountId: COMPANY_ACCOUNT_ID,
  })
  mockedAccounts.mockResolvedValue([
    {
      id: USER_ACCOUNT_ID,
      ownerType: 'USER',
      userId: USER_ID,
      balance: '100.00',
      userShareRate: '30.00',
      nextSequence: 1n,
      version: 1,
    },
    {
      id: COMPANY_ACCOUNT_ID,
      ownerType: 'COMPANY',
      userId: null,
      balance: '1000.00',
      userShareRate: null,
      nextSequence: 1n,
      version: 1,
    },
  ])
  mockedInsertBatch.mockResolvedValue(undefined)
  mockedUpdateAccount.mockResolvedValue(true)
  mockedInsertEntries.mockResolvedValue(undefined)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('FundPostingApplicationService manual adjustment', () => {
  it('posts a signed proportional adjustment under fixed administrator identities', async () => {
    configureSuccess()
    const { audit, service } = fixture()

    const result = await service.postManualAdjustment(
      { actorUserId: USER_ID, requestId: 'request-1' },
      {
        userAccountId: USER_ACCOUNT_ID,
        amount: '-100',
        adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
        reason: '修正录入金额',
        metadata: { ticketNo: 'FIN-1' },
        idempotencyKey: 'manual-adjustment-1',
      },
    )

    expect(result).toMatchObject({
      postingTypeCode: 'ADMIN_MANUAL_ADJUSTMENT',
      businessCategory: 'ADJUSTMENT',
      businessAmount: '-100.00',
      userShareRateSnapshot: '30.00',
      companyShareRateSnapshot: '70.00',
      entries: [
        expect.objectContaining({ direction: 'DEBIT', amount: '30.00' }),
        expect.objectContaining({ direction: 'DEBIT', amount: '70.00' }),
      ],
    })
    expect(mockedSource).toHaveBeenCalledWith(
      expect.anything(),
      'ADMIN_CONSOLE',
    )
    expect(mockedType).toHaveBeenCalledWith(
      expect.anything(),
      'ADMIN_MANUAL_ADJUSTMENT',
    )
    expect(mockedInsertBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'MANUAL_ADJUSTMENT',
        adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
        actorUserId: USER_ID,
        businessSourceCodeSnapshot: 'ADMIN_CONSOLE',
      }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'FUND_MANUAL_ADJUSTMENT_POSTED',
        actorUserId: USER_ID,
      }),
    )
  })

  it('adjusts only the selected user account in USER_ONLY mode', async () => {
    configureSuccess()
    mockedIdentities.mockResolvedValue({
      userId: USER_ID,
      userAccountId: USER_ACCOUNT_ID,
      companyAccountId: null,
    })
    mockedAccounts.mockResolvedValue([
      {
        id: USER_ACCOUNT_ID,
        ownerType: 'USER',
        userId: USER_ID,
        balance: '100.00',
        userShareRate: '30.00',
        nextSequence: 1n,
        version: 1,
      },
    ])
    const { service } = fixture()

    const result = await service.postManualAdjustment(
      { actorUserId: USER_ID, requestId: 'request-2' },
      {
        userAccountId: USER_ACCOUNT_ID,
        amount: '100',
        adjustmentMode: 'USER_ONLY',
        reason: '只调整选定用户账户',
        idempotencyKey: 'manual-adjustment-2',
      },
    )

    expect(mockedIdentities).toHaveBeenCalledWith(expect.anything(), {
      userAccountId: USER_ACCOUNT_ID,
      requireCompanyAccount: false,
    })
    expect(mockedAccounts).toHaveBeenCalledWith(
      expect.anything(),
      [USER_ACCOUNT_ID],
    )
    expect(result.entries).toEqual([
      expect.objectContaining({
        accountId: USER_ACCOUNT_ID,
        direction: 'CREDIT',
        amount: '100.00',
      }),
    ])
  })
})
