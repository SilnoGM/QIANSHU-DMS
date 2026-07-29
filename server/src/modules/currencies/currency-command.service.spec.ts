import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import type { CurrencyDto } from './dto/currency.dto'
import {
  createCurrencyRecord,
  readCurrencyCommandDto,
  readCurrencyForMutation,
  readExchangeRateForCurrency,
  updateCurrencyRecord,
} from './currency-command.persistence'
import { CurrencyCommandService } from './currency-command.service'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./currency-command.persistence', () => ({
  createCurrencyRecord: jest.fn(),
  readCurrencyCommandDto: jest.fn(),
  readCurrencyForMutation: jest.fn(),
  readExchangeRateForCurrency: jest.fn(),
  updateCurrencyRecord: jest.fn(),
}))

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)
const mockedCreateCurrencyRecord = jest.mocked(createCurrencyRecord)
const mockedReadCurrencyCommandDto = jest.mocked(readCurrencyCommandDto)
const mockedReadCurrencyForMutation = jest.mocked(
  readCurrencyForMutation,
)
const mockedReadExchangeRateForCurrency = jest.mocked(
  readExchangeRateForCurrency,
)
const mockedUpdateCurrencyRecord = jest.mocked(updateCurrencyRecord)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const CURRENCY_ID = '20000000-0000-4000-8000-000000000001'
const RATE_ID = '30000000-0000-4000-8000-000000000001'
const REQUEST_ID = 'currency-command-spec'

const context = {
  actorUserId: ACTOR_ID,
  requestId: REQUEST_ID,
} as const

function currencyDto(
  overrides: Partial<CurrencyDto> = {},
): CurrencyDto {
  return {
    id: CURRENCY_ID,
    code: 'TWD',
    name: '新台币',
    englishName: 'New Taiwan Dollar',
    symbol: 'NT$',
    minorUnit: 2,
    enabled: false,
    isBase: false,
    sortOrder: 20,
    exchangeRateConfigured: false,
    version: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  }
}

function currencyLock(
  overrides: Partial<Awaited<
    ReturnType<typeof readCurrencyForMutation>
  >> = {},
) {
  return {
    id: CURRENCY_ID,
    code: 'TWD',
    name: '新台币',
    englishName: 'New Taiwan Dollar',
    symbol: 'NT$',
    minorUnit: 2,
    enabled: false,
    sortOrder: 20,
    version: 1,
    ...overrides,
  }
}

function createFixture() {
  const transaction = {}
  const prisma = {
    $transaction: jest.fn((callback: (tx: object) => unknown) =>
      callback(transaction)),
  }
  const audit = {
    record: jest.fn().mockResolvedValue({ id: 'audit-id' }),
  }

  return {
    audit,
    prisma,
    service: new CurrencyCommandService(
      prisma as unknown as PrismaService,
      audit,
    ),
    transaction,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedApplyTransactionTimeouts.mockResolvedValue(undefined)
  mockedCreateCurrencyRecord.mockResolvedValue({ id: CURRENCY_ID })
  mockedReadCurrencyCommandDto.mockResolvedValue(currencyDto())
  mockedReadCurrencyForMutation.mockResolvedValue(currencyLock())
  mockedReadExchangeRateForCurrency.mockResolvedValue({ id: RATE_ID })
  mockedUpdateCurrencyRecord.mockResolvedValue(undefined)
})

describe('CurrencyCommandService', () => {
  it('creates a normalized disabled currency and audits in the same transaction', async () => {
    const { audit, service, transaction } = createFixture()

    await expect(service.create(context, {
      code: 'twd',
      name: '  新　台币  ',
      englishName: ' New   Taiwan Dollar ',
      symbol: ' NT$ ',
      minorUnit: 2,
      sortOrder: 20,
    })).resolves.toEqual(currencyDto())

    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(transaction)
    expect(mockedCreateCurrencyRecord).toHaveBeenCalledWith(transaction, {
      code: 'TWD',
      name: '新 台币',
      englishName: 'New Taiwan Dollar',
      symbol: 'NT$',
      minorUnit: 2,
      enabled: false,
      sortOrder: 20,
    })
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.CURRENCY_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'Currency',
      targetId: CURRENCY_ID,
      requestId: REQUEST_ID,
      metadata: {
        currencyCode: 'TWD',
        changedFields:
          'code,enabled,englishName,minorUnit,name,sortOrder,symbol',
        version: 1,
      },
    })
  })

  it('returns an update no-op without incrementing version or auditing', async () => {
    const { audit, service } = createFixture()

    await expect(service.update(context, CURRENCY_ID, {
      name: '新台币',
      englishName: 'New Taiwan Dollar',
      symbol: 'NT$',
      sortOrder: 20,
      expectedVersion: 1,
    })).resolves.toEqual(currencyDto())

    expect(mockedUpdateCurrencyRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects a stale expectedVersion before writing', async () => {
    mockedReadCurrencyForMutation.mockResolvedValue(
      currencyLock({ version: 3 }),
    )
    const { audit, service } = createFixture()

    await expect(service.update(context, CURRENCY_ID, {
      name: '新名称',
      expectedVersion: 2,
    })).rejects.toMatchObject({
      code: 'CURRENCY_STATE_CHANGED',
      status: 409,
    })

    expect(mockedUpdateCurrencyRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('updates only changed mutable fields and increments version once', async () => {
    mockedReadCurrencyCommandDto.mockResolvedValue(
      currencyDto({
        name: '新台币（新版）',
        symbol: null,
        version: 2,
      }),
    )
    const { audit, service, transaction } = createFixture()

    await expect(service.update(context, CURRENCY_ID, {
      name: ' 新台币（新版） ',
      symbol: null,
      expectedVersion: 1,
    })).resolves.toEqual(
      currencyDto({
        name: '新台币（新版）',
        symbol: null,
        version: 2,
      }),
    )

    expect(mockedUpdateCurrencyRecord).toHaveBeenCalledWith(
      transaction,
      CURRENCY_ID,
      {
        name: '新台币（新版）',
        symbol: null,
      },
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: AuditEventType.CURRENCY_UPDATED,
        metadata: {
          currencyCode: 'TWD',
          changedFields: 'name,symbol',
          previousVersion: 1,
          version: 2,
        },
      }),
    )
  })

  it('requires a current rate before enabling a non-CNY currency', async () => {
    mockedReadExchangeRateForCurrency.mockResolvedValue(null)
    const { audit, service, transaction } = createFixture()

    await expect(service.enable(context, CURRENCY_ID, {
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'CURRENCY_EXCHANGE_RATE_REQUIRED',
      status: 422,
    })

    expect(mockedReadCurrencyForMutation).toHaveBeenCalledWith(
      transaction,
      CURRENCY_ID,
    )
    expect(mockedReadExchangeRateForCurrency).toHaveBeenCalledWith(
      transaction,
      CURRENCY_ID,
    )
    expect(mockedUpdateCurrencyRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('enables after locking Currency then ExchangeRate and writes one audit', async () => {
    mockedReadCurrencyCommandDto.mockResolvedValue(
      currencyDto({
        enabled: true,
        exchangeRateConfigured: true,
        version: 2,
      }),
    )
    const { audit, service, transaction } = createFixture()

    await service.enable(context, CURRENCY_ID, { expectedVersion: 1 })

    expect(
      mockedReadCurrencyForMutation.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockedReadExchangeRateForCurrency.mock.invocationCallOrder[0],
    )
    expect(mockedUpdateCurrencyRecord).toHaveBeenCalledWith(
      transaction,
      CURRENCY_ID,
      { enabled: true },
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: AuditEventType.CURRENCY_ENABLED,
        metadata: {
          currencyCode: 'TWD',
          changedFields: 'enabled',
          previousVersion: 1,
          version: 2,
        },
      }),
    )
  })

  it('never permits disabling fixed CNY', async () => {
    mockedReadCurrencyForMutation.mockResolvedValue(
      currencyLock({
        code: 'CNY',
        enabled: true,
      }),
    )
    const { audit, service } = createFixture()

    await expect(service.disable(context, CURRENCY_ID, {
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'BASE_CURRENCY_CANNOT_BE_DISABLED',
      status: 422,
    })

    expect(mockedUpdateCurrencyRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('maps Audit failure safely so the surrounding transaction rejects', async () => {
    const { audit, service } = createFixture()
    audit.record.mockRejectedValue(new Error('must-not-leak audit'))

    await expect(service.update(context, CURRENCY_ID, {
      name: '新名称',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    })
  })
})
