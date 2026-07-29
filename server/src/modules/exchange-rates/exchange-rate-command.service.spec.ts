import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import {
  createExchangeRateRecord,
  readCurrencyForExchangeRate,
  readExchangeRateCommandDto,
  readExchangeRateForCurrency,
  readExchangeRateForMutation,
  readExchangeRateIdentity,
  updateExchangeRateRecord,
} from './exchange-rate-command.persistence'
import { ExchangeRateCommandService } from './exchange-rate-command.service'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./exchange-rate-command.persistence', () => ({
  createExchangeRateRecord: jest.fn(),
  readCurrencyForExchangeRate: jest.fn(),
  readExchangeRateCommandDto: jest.fn(),
  readExchangeRateForCurrency: jest.fn(),
  readExchangeRateForMutation: jest.fn(),
  readExchangeRateIdentity: jest.fn(),
  updateExchangeRateRecord: jest.fn(),
}))

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)
const mockedCreateExchangeRateRecord = jest.mocked(createExchangeRateRecord)
const mockedReadCurrencyForExchangeRate = jest.mocked(
  readCurrencyForExchangeRate,
)
const mockedReadExchangeRateCommandDto = jest.mocked(
  readExchangeRateCommandDto,
)
const mockedReadExchangeRateForCurrency = jest.mocked(
  readExchangeRateForCurrency,
)
const mockedReadExchangeRateForMutation = jest.mocked(
  readExchangeRateForMutation,
)
const mockedReadExchangeRateIdentity = jest.mocked(
  readExchangeRateIdentity,
)
const mockedUpdateExchangeRateRecord = jest.mocked(
  updateExchangeRateRecord,
)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const CURRENCY_ID = '20000000-0000-4000-8000-000000000001'
const RATE_ID = '30000000-0000-4000-8000-000000000001'
const REQUEST_ID = 'exchange-rate-command-spec'

const context = {
  actorUserId: ACTOR_ID,
  requestId: REQUEST_ID,
} as const

function rateDto(overrides: Record<string, unknown> = {}) {
  return {
    id: RATE_ID,
    currencyId: CURRENCY_ID,
    foreignUnitsPerCny: '4.8',
    version: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
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
    service: new ExchangeRateCommandService(
      prisma as unknown as PrismaService,
      audit,
    ),
    transaction,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedApplyTransactionTimeouts.mockResolvedValue(undefined)
  mockedReadCurrencyForExchangeRate.mockResolvedValue({
    id: CURRENCY_ID,
    code: 'TWD',
  })
  mockedReadExchangeRateForCurrency.mockResolvedValue(null)
  mockedCreateExchangeRateRecord.mockResolvedValue({ id: RATE_ID })
  mockedReadExchangeRateCommandDto.mockResolvedValue(rateDto())
  mockedReadExchangeRateIdentity.mockResolvedValue({
    id: RATE_ID,
    currencyId: CURRENCY_ID,
  })
  mockedReadExchangeRateForMutation.mockResolvedValue({
    id: RATE_ID,
    currencyId: CURRENCY_ID,
    foreignUnitsPerCny: '4.8',
    version: 1,
  })
  mockedUpdateExchangeRateRecord.mockResolvedValue(undefined)
})

describe('ExchangeRateCommandService', () => {
  it('locks Currency first and creates one normalized current rate with Audit', async () => {
    mockedReadExchangeRateCommandDto.mockResolvedValue(
      rateDto({ foreignUnitsPerCny: '4.8' }),
    )
    const { audit, service, transaction } = createFixture()

    await expect(service.create(context, {
      currencyId: CURRENCY_ID,
      foreignUnitsPerCny: '4.800000000000',
    })).resolves.toEqual(rateDto())

    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(transaction)
    expect(mockedReadCurrencyForExchangeRate).toHaveBeenCalledWith(
      transaction,
      CURRENCY_ID,
    )
    expect(mockedReadExchangeRateForCurrency).toHaveBeenCalledWith(
      transaction,
      CURRENCY_ID,
    )
    expect(
      mockedReadCurrencyForExchangeRate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockedReadExchangeRateForCurrency.mock.invocationCallOrder[0],
    )
    expect(mockedCreateExchangeRateRecord).toHaveBeenCalledWith(
      transaction,
      {
        currencyId: CURRENCY_ID,
        foreignUnitsPerCny: '4.8',
      },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.EXCHANGE_RATE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'ExchangeRate',
      targetId: RATE_ID,
      requestId: REQUEST_ID,
      metadata: {
        currencyCode: 'TWD',
        changedFields: 'foreignUnitsPerCny',
        newForeignUnitsPerCny: '4.8',
        version: 1,
      },
    })
  })

  it('allows disabled foreign currency but rejects fixed CNY', async () => {
    mockedReadCurrencyForExchangeRate.mockResolvedValue({
      id: CURRENCY_ID,
      code: 'CNY',
    })
    const { audit, service } = createFixture()

    await expect(service.create(context, {
      currencyId: CURRENCY_ID,
      foreignUnitsPerCny: '1',
    })).rejects.toMatchObject({
      code: 'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
      status: 422,
    })

    expect(mockedCreateExchangeRateRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('returns a stable duplicate-current-rate conflict', async () => {
    mockedReadExchangeRateForCurrency.mockResolvedValue({ id: RATE_ID })
    const { audit, service } = createFixture()

    await expect(service.create(context, {
      currencyId: CURRENCY_ID,
      foreignUnitsPerCny: '4.8',
    })).rejects.toMatchObject({
      code: 'EXCHANGE_RATE_ALREADY_EXISTS',
      status: 409,
    })

    expect(mockedCreateExchangeRateRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('locks Currency before ExchangeRate during update and rejects stale version', async () => {
    mockedReadExchangeRateForMutation.mockResolvedValue({
      id: RATE_ID,
      currencyId: CURRENCY_ID,
      foreignUnitsPerCny: '4.8',
      version: 3,
    })
    const { audit, service } = createFixture()

    await expect(service.update(context, RATE_ID, {
      foreignUnitsPerCny: '5',
      expectedVersion: 2,
    })).rejects.toMatchObject({
      code: 'EXCHANGE_RATE_STATE_CHANGED',
      status: 409,
    })

    expect(
      mockedReadCurrencyForExchangeRate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockedReadExchangeRateForMutation.mock.invocationCallOrder[0],
    )
    expect(mockedUpdateExchangeRateRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('returns a canonical no-op without version or Audit write', async () => {
    const { audit, service } = createFixture()

    await expect(service.update(context, RATE_ID, {
      foreignUnitsPerCny: '4.800000000000',
      expectedVersion: 1,
    })).resolves.toEqual(rateDto())

    expect(mockedUpdateExchangeRateRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('updates the current row once and records old/new decimal strings', async () => {
    mockedReadExchangeRateCommandDto.mockResolvedValue(
      rateDto({
        foreignUnitsPerCny: '5.25',
        version: 2,
      }),
    )
    const { audit, service, transaction } = createFixture()

    await expect(service.update(context, RATE_ID, {
      foreignUnitsPerCny: '5.250000000000',
      expectedVersion: 1,
    })).resolves.toEqual(
      rateDto({
        foreignUnitsPerCny: '5.25',
        version: 2,
      }),
    )

    expect(mockedUpdateExchangeRateRecord).toHaveBeenCalledWith(
      transaction,
      RATE_ID,
      { foreignUnitsPerCny: '5.25' },
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: AuditEventType.EXCHANGE_RATE_UPDATED,
        metadata: {
          currencyCode: 'TWD',
          changedFields: 'foreignUnitsPerCny',
          oldForeignUnitsPerCny: '4.8',
          newForeignUnitsPerCny: '5.25',
          previousVersion: 1,
          version: 2,
        },
      }),
    )
  })

  it('fails closed when the target disappears after identity lookup', async () => {
    mockedReadExchangeRateForMutation.mockResolvedValue(null)
    const { service } = createFixture()

    await expect(service.update(context, RATE_ID, {
      foreignUnitsPerCny: '5',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'EXCHANGE_RATE_STATE_CHANGED',
      status: 409,
    })
  })
})
