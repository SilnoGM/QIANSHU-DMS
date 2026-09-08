import { HttpStatus } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import type { NumberingRandomSource } from './random-source'
import {
  readDatabaseAsOfInTransaction,
  readNumberingIssuancesPageInTransaction,
  readNumberingPeriodUsageInTransaction,
  readNumberingRuleDetailInTransaction,
  readNumberingRuleHasIssuancesInTransaction,
  readNumberingRuleListPageInTransaction,
  readNumberingRuleVersionsPageInTransaction,
  type NumberingRuleReadRow,
  type NumberingVersionReadRow,
} from './numbering-query.persistence'
import { NumberingQueryService } from './numbering-query.service'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./numbering-query.persistence', () => ({
  readDatabaseAsOfInTransaction: jest.fn(),
  readNumberingIssuancesPageInTransaction: jest.fn(),
  readNumberingPeriodUsageInTransaction: jest.fn(),
  readNumberingRuleDetailInTransaction: jest.fn(),
  readNumberingRuleHasIssuancesInTransaction: jest.fn(),
  readNumberingRuleListPageInTransaction: jest.fn(),
  readNumberingRuleVersionsPageInTransaction: jest.fn(),
}))

const AS_OF = new Date('2026-08-01T16:00:00.000Z')
const RULE_ID = '00000000-0000-4000-8000-000000000001'
const ACTIVE_VERSION_ID = '00000000-0000-4000-8000-000000000011'
const DRAFT_VERSION_ID = '00000000-0000-4000-8000-000000000012'

const ZERO_RANDOM_SOURCE: NumberingRandomSource = {
  nextInt(maxExclusive: number): number {
    if (maxExclusive < 1) {
      throw new RangeError('maxExclusive must be positive')
    }
    return 0
  },
}

function sequenceVersion(
  status: 'ACTIVE' | 'DRAFT',
  width = 18,
): NumberingVersionReadRow {
  return {
    id: status === 'ACTIVE' ? ACTIVE_VERSION_ID : DRAFT_VERSION_ID,
    revision: status === 'ACTIVE' ? 2 : 3,
    status,
    resetPolicy: 'DAILY',
    timezone: 'Asia/Shanghai',
    createdAt: AS_OF,
    publishedAt: status === 'ACTIVE' ? AS_OF : null,
    segments: [
      {
        id: '00000000-0000-4000-8000-000000000021',
        position: 0,
        type: 'FIXED',
        fixedValue: 'SO',
        dateFormat: null,
        separatorValue: null,
        sequenceWidth: null,
        sequenceStartValue: null,
        sequenceStep: null,
        randomLetterLength: null,
        randomDigitLength: null,
        randomMode: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000022',
        position: 1,
        type: 'DATE',
        fixedValue: null,
        dateFormat: 'YYYYMMDD',
        separatorValue: null,
        sequenceWidth: null,
        sequenceStartValue: null,
        sequenceStep: null,
        randomLetterLength: null,
        randomDigitLength: null,
        randomMode: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000023',
        position: 2,
        type: 'SEQUENCE',
        fixedValue: null,
        dateFormat: null,
        separatorValue: null,
        sequenceWidth: width,
        sequenceStartValue: 0n,
        sequenceStep: 1n,
        randomLetterLength: null,
        randomDigitLength: null,
        randomMode: null,
      },
    ],
  }
}

function rule(versions: NumberingVersionReadRow[]): NumberingRuleReadRow {
  return {
    purpose: 'BUSINESS',
    id: RULE_ID,
    ruleCode: 'SALES_ORDER',
    name: '销售订单',
    description: null,
    status: 'DISABLED',
    version: 4,
    createdAt: AS_OF,
    updatedAt: AS_OF,
    versions,
  }
}

function createService(): {
  service: NumberingQueryService
  transaction: Prisma.TransactionClient
  transactionCall: jest.Mock
} {
  const transaction = {} as Prisma.TransactionClient
  const transactionCall = jest.fn(async (
    callback: (client: Prisma.TransactionClient) => Promise<unknown>,
  ) => callback(transaction))
  const prisma = { $transaction: transactionCall } as unknown as PrismaService

  return {
    service: new NumberingQueryService(prisma, ZERO_RANDOM_SOURCE),
    transaction,
    transactionCall,
  }
}

const mockedAsOf = jest.mocked(readDatabaseAsOfInTransaction)
const mockedDetail = jest.mocked(readNumberingRuleDetailInTransaction)
const mockedHasIssuances = jest.mocked(readNumberingRuleHasIssuancesInTransaction)
const mockedIssuances = jest.mocked(readNumberingIssuancesPageInTransaction)
const mockedList = jest.mocked(readNumberingRuleListPageInTransaction)
const mockedUsage = jest.mocked(readNumberingPeriodUsageInTransaction)
const mockedVersions = jest.mocked(readNumberingRuleVersionsPageInTransaction)
const mockedTimeouts = jest.mocked(applyTransactionTimeouts)

function callArgument<T>(
  mock: jest.Mock,
  callIndex = 0,
  argumentIndex = 0,
): T {
  const calls = mock.mock.calls as unknown as readonly (readonly unknown[])[]
  return calls[callIndex]?.[argumentIndex] as T
}

describe('NumberingQueryService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAsOf.mockResolvedValue(AS_OF)
    mockedUsage.mockResolvedValue(new Map())
  })

  it('constructs in Nest without an accidental Object dependency', async () => {
    const module = await Test.createTestingModule({
      providers: [
        NumberingQueryService,
        {
          provide: PrismaService,
          useValue: { $transaction: jest.fn() },
        },
      ],
    }).compile()

    expect(module.get(NumberingQueryService)).toBeInstanceOf(
      NumberingQueryService,
    )
    await module.close()
  })

  it('uses one REPEATABLE READ snapshot and prefers active statistics over draft', async () => {
    const { service, transaction, transactionCall } = createService()
    mockedDetail.mockResolvedValue(rule([
      sequenceVersion('DRAFT', 18),
      sequenceVersion('ACTIVE', 18),
    ]))
    mockedUsage.mockResolvedValue(new Map([[RULE_ID, {
      usedCount: '9007199254740993',
      lifetimeUsedCount: '9007199254740995',
    }]]))

    const result = await service.getDetail(RULE_ID)

    expect(mockedTimeouts).toHaveBeenCalledWith(transaction)
    expect(callArgument(transactionCall, 0, 1)).toEqual({
      isolationLevel: 'RepeatableRead',
    })
    expect(mockedDetail).toHaveBeenCalledWith(transaction, RULE_ID)
    expect(mockedUsage).toHaveBeenCalledWith(transaction, [{
      ruleId: RULE_ID,
      periodKey: '20260802',
    }])
    expect(result.activeVersion?.revision).toBe(2)
    expect(result.draftVersion?.revision).toBe(3)
    expect(result.statistics).toEqual(expect.objectContaining({
      statisticsSource: 'ACTIVE',
      usedCount: '9007199254740993',
      lifetimeUsedCount: '9007199254740995',
      nextSequenceValue: '9007199254740993',
      asOf: AS_OF.toISOString(),
    }))
  })

  it('returns draft-only theoretical statistics without requesting a current state', async () => {
    const { service, transaction } = createService()
    mockedDetail.mockResolvedValue(rule([sequenceVersion('DRAFT', 3)]))
    mockedUsage.mockResolvedValue(new Map([[RULE_ID, {
      usedCount: '7',
      lifetimeUsedCount: '7',
    }]]))

    const result = await service.getDetail(RULE_ID)

    expect(mockedUsage).toHaveBeenCalledWith(transaction, [{
      ruleId: RULE_ID,
      periodKey: null,
    }])
    expect(result.statistics).toEqual(expect.objectContaining({
      statisticsSource: 'DRAFT',
      usedCount: '0',
      lifetimeUsedCount: '7',
      nextSequenceValue: '0',
    }))
  })

  it('exposes a detail helper that does not open a nested transaction or timeout', async () => {
    const { service, transaction, transactionCall } = createService()
    mockedDetail.mockResolvedValue(rule([sequenceVersion('ACTIVE', 3)]))

    await service.getDetailInTransaction(transaction, RULE_ID, AS_OF)

    expect(transactionCall).not.toHaveBeenCalled()
    expect(mockedTimeouts).not.toHaveBeenCalled()
    expect(mockedAsOf).not.toHaveBeenCalled()
    expect(mockedDetail).toHaveBeenCalledWith(transaction, RULE_ID)
  })

  it('maps one set-based list usage read and preserves pagination', async () => {
    const { service, transaction } = createService()
    mockedList.mockResolvedValue({
      total: 1,
      purposeCounts: [{ value: 'ALL', count: 1 }, { value: 'BUSINESS', count: 1 }, { value: 'SHIPPING_MARK', count: 0 }],
      rows: [rule([sequenceVersion('ACTIVE', 3)])],
    })
    mockedUsage.mockResolvedValue(new Map([[RULE_ID, {
      usedCount: '2',
      lifetimeUsedCount: '5',
    }]]))

    const result = await service.list({
      keyword: '  销售  ',
      status: 'DISABLED',
      page: 2,
      pageSize: 10,
      sortBy: 'updatedAt',
      sortOrder: 'asc',
    })

    expect(mockedList).toHaveBeenCalledWith(transaction, expect.objectContaining({
      keyword: '销售',
      status: 'DISABLED',
      page: 2,
      pageSize: 10,
      skip: 10,
      sortOrder: 'asc',
    }))
    expect(mockedUsage).toHaveBeenCalledTimes(1)
    expect(result.page).toBe(2)
    expect(result.pageSize).toBe(10)
    expect(result.total).toBe(1)
    expect(result.items[0].activeRevision).toBe(2)
    expect(result.items[0].draftRevision).toBeNull()
    expect(result.items[0].statistics.usedCount).toBe('2')
  })

  it('returns pure-random null next values and stable version/issuance pages', async () => {
    const { service } = createService()
    const randomVersion: NumberingVersionReadRow = {
      ...sequenceVersion('ACTIVE'),
      resetPolicy: 'NEVER',
      segments: [{
        id: '00000000-0000-4000-8000-000000000024',
        position: 0,
        type: 'RANDOM',
        fixedValue: null,
        dateFormat: null,
        separatorValue: null,
        sequenceWidth: null,
        sequenceStartValue: null,
        sequenceStep: null,
        randomLetterLength: 2,
        randomDigitLength: 2,
        randomMode: 'LETTERS_THEN_DIGITS',
      }],
    }
    mockedList.mockResolvedValue({ total: 1, rows: [rule([randomVersion])], purposeCounts: [{ value: 'ALL', count: 1 }, { value: 'BUSINESS', count: 1 }, { value: 'SHIPPING_MARK', count: 0 }] })
    mockedVersions.mockResolvedValue({
      ruleExists: true,
      total: 1,
      rows: [randomVersion],
    })
    mockedIssuances.mockResolvedValue({
      ruleExists: true,
      total: 1,
      rows: [{
        id: '00000000-0000-4000-8000-000000000031',
        ruleRevision: 2,
        periodKey: 'ALL',
        generatedNumber: 'AB12',
        sequenceValue: null,
        consumerCode: 'ORDER',
        issuedAt: AS_OF,
      }],
    })

    const list = await service.list({})
    const versions = await service.listVersions(RULE_ID, {})
    const issuances = await service.listIssuances(RULE_ID, {})

    expect(list.items[0].statistics).toEqual(expect.objectContaining({
      nextSequenceValue: null,
      nextNumberPreview: null,
    }))
    expect(versions.items[0]).toEqual(expect.objectContaining({ revision: 2 }))
    expect(issuances.items[0]).toEqual({
      id: '00000000-0000-4000-8000-000000000031',
      ruleRevision: 2,
      periodKey: 'ALL',
      generatedNumber: 'AB12',
      sequenceValue: null,
      consumerCode: 'ORDER',
      issuedAt: AS_OF.toISOString(),
    })
    expect(issuances.items[0]).not.toHaveProperty('idempotencyKeyHash')
    expect(issuances.items[0]).not.toHaveProperty('requestFingerprintHash')
  })

  it('defaults generated-number matching to EXACT and returns 404 for unknown history', async () => {
    const { service, transaction } = createService()
    mockedIssuances.mockResolvedValue({
      ruleExists: true,
      total: 0,
      rows: [],
    })

    await service.listIssuances(RULE_ID, { generatedNumber: 'SO001' })

    expect(mockedIssuances).toHaveBeenCalledWith(
      transaction,
      RULE_ID,
      expect.objectContaining({
        generatedNumber: 'SO001',
        generatedNumberMatch: 'EXACT',
      }),
    )

    mockedVersions.mockResolvedValue({
      ruleExists: false,
      total: 0,
      rows: [],
    })
    await expect(service.listVersions(RULE_ID, {})).rejects.toMatchObject({
      code: 'NUMBERING_RULE_NOT_FOUND',
    })

    mockedIssuances.mockResolvedValue({
      ruleExists: false,
      total: 0,
      rows: [],
    })
    await expect(service.listIssuances(RULE_ID, {})).rejects.toMatchObject({
      code: 'NUMBERING_RULE_NOT_FOUND',
    })
  })

  it('returns stable validation errors for non-object list/history inputs', async () => {
    const { service } = createService()

    await expect(service.list(null as never)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(service.listVersions(RULE_ID, null as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(service.listIssuances(RULE_ID, null as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('maps structured transaction conflicts instead of flattening them to 500', async () => {
    const { service } = createService()
    mockedList.mockRejectedValue({ code: 'P2034' })

    await expect(service.list({})).rejects.toMatchObject({
      code: 'NUMBERING_RULE_STATE_CHANGED',
      status: HttpStatus.CONFLICT,
    })
  })

  it('previews without writes and returns 404 for an unknown edit rule', async () => {
    const { service } = createService()
    const preview = await service.preview({
      resetPolicy: 'NEVER',
      segments: [{
        type: 'RANDOM',
        letterLength: 1,
        digitLength: 1,
        mode: 'LETTERS_THEN_DIGITS',
      }],
    })

    expect(preview.normalizedConfig.timezone).toBe('Asia/Shanghai')
    expect(preview.normalizedConfig.maxOutputLength).toBe(2)
    expect(preview.usedCount).toBe('0')
    expect(preview.nextNumberPreview).toBeNull()
    expect(preview.samples).toEqual(['A0', 'A0', 'A0', 'A0', 'A0'])
    expect(preview.asOf).toBe(AS_OF.toISOString())
    expect(mockedDetail).not.toHaveBeenCalled()
    expect(mockedHasIssuances).not.toHaveBeenCalled()

    mockedDetail.mockResolvedValue(null)
    await expect(service.preview({
      ruleId: RULE_ID,
      resetPolicy: 'NEVER',
      segments: [{
        type: 'SEQUENCE',
        width: 3,
        startValue: '0',
        step: '1',
      }],
    })).rejects.toMatchObject({ code: 'NUMBERING_RULE_NOT_FOUND' })
  })

  it('enforces issued-rule compatibility while allowing sequence width growth', async () => {
    const { service } = createService()
    mockedDetail.mockResolvedValue(rule([sequenceVersion('ACTIVE', 3)]))
    mockedHasIssuances.mockResolvedValue(true)
    mockedUsage.mockResolvedValue(new Map([[RULE_ID, {
      usedCount: '2',
      lifetimeUsedCount: '2',
    }]]))

    await expect(service.preview({
      ruleId: RULE_ID,
      resetPolicy: 'DAILY',
      segments: [
        { type: 'FIXED', value: 'SO' },
        { type: 'DATE', format: 'YYYYMMDD' },
        {
          type: 'SEQUENCE',
          width: 4,
          startValue: '0',
          step: '1',
        },
      ],
    })).resolves.toEqual(expect.objectContaining({
      usedCount: '2',
      nextSequenceValue: '2',
    }))

    await expect(service.preview({
      ruleId: RULE_ID,
      resetPolicy: 'DAILY',
      segments: [
        { type: 'FIXED', value: 'XX' },
        { type: 'DATE', format: 'YYYYMMDD' },
        {
          type: 'SEQUENCE',
          width: 4,
          startValue: '0',
          step: '1',
        },
      ],
    })).rejects.toMatchObject({
      code: 'NUMBERING_RULE_CONFIG_INVALID',
      status: 422,
    })
  })

  it('maps malformed preview configuration to a stable 422 error', async () => {
    const { service } = createService()

    await expect(service.preview({
      resetPolicy: 'NEVER',
      segments: [],
    })).rejects.toMatchObject({
      code: 'NUMBERING_RULE_CONFIG_INVALID',
      status: 422,
    })
  })
})
