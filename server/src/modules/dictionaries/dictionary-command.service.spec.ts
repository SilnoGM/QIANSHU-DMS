import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import {
  createDictionaryTypeRecord,
  readDictionaryTypeCommandDto,
  readDictionaryTypeForMutation,
  updateDictionaryTypeRecord,
} from './dictionary-command.persistence'
import { DictionaryCommandService } from './dictionary-command.service'
import { CreateDictionaryTypeRequestDto } from './dto/dictionary-command.dto'
import type { DictionaryTypeDto } from './dto/dictionary-response.dto'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./dictionary-command.persistence', () => {
  const actual = jest.requireActual<
    typeof import('./dictionary-command.persistence')
  >('./dictionary-command.persistence')

  return {
    ...actual,
    createDictionaryTypeRecord: jest.fn(),
    readDictionaryTypeCommandDto: jest.fn(),
    readDictionaryTypeForMutation: jest.fn(),
    updateDictionaryTypeRecord: jest.fn(),
  }
})

const mockedApplyTransactionTimeouts = jest.mocked(
  applyTransactionTimeouts,
)
const mockedCreateDictionaryTypeRecord = jest.mocked(
  createDictionaryTypeRecord,
)
const mockedReadDictionaryTypeCommandDto = jest.mocked(
  readDictionaryTypeCommandDto,
)
const mockedReadDictionaryTypeForMutation = jest.mocked(
  readDictionaryTypeForMutation,
)
const mockedUpdateDictionaryTypeRecord = jest.mocked(
  updateDictionaryTypeRecord,
)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const TYPE_ID = '20000000-0000-4000-8000-000000000001'
const REQUEST_ID = 'dictionary-type-command-spec'

const context = {
  actorUserId: ACTOR_ID,
  requestId: REQUEST_ID,
} as const

function dictionaryTypeDto(
  overrides: Partial<DictionaryTypeDto> = {},
): DictionaryTypeDto {
  return {
    id: TYPE_ID,
    code: 'sales.channel',
    name: '销售渠道',
    description: null,
    enabled: false,
    sortOrder: 10,
    itemCount: 2,
    enabledItemCount: 1,
    version: 1,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  }
}

function dictionaryTypeLock(
  overrides: Partial<NonNullable<Awaited<
    ReturnType<typeof readDictionaryTypeForMutation>
  >>> = {},
) {
  return {
    id: TYPE_ID,
    code: 'sales.channel',
    name: '销售渠道',
    description: null,
    enabled: false,
    sortOrder: 10,
    version: 1,
    ...overrides,
  }
}

type TransactionOperation = (transaction: object) => Promise<unknown>

function createFixture() {
  const transaction = {}
  const transactionRunner = jest.fn(
    (operation: TransactionOperation) => operation(transaction),
  )
  const prisma = { $transaction: transactionRunner }
  const audit = {
    record: jest.fn().mockResolvedValue({ id: 'audit-id' }),
  }

  return {
    audit,
    prisma,
    service: new DictionaryCommandService(
      prisma as unknown as PrismaService,
      audit,
    ),
    transaction,
    transactionRunner,
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  mockedApplyTransactionTimeouts.mockResolvedValue(undefined)
  mockedCreateDictionaryTypeRecord.mockResolvedValue({ id: TYPE_ID })
  mockedReadDictionaryTypeCommandDto.mockResolvedValue(dictionaryTypeDto())
  mockedReadDictionaryTypeForMutation.mockResolvedValue(
    dictionaryTypeLock(),
  )
  mockedUpdateDictionaryTypeRecord.mockResolvedValue(undefined)
})

describe('DictionaryCommandService Type lifecycle', () => {
  it('creates a normalized disabled Type and writes exact Audit metadata in the same transaction', async () => {
    const { audit, service, transaction } = createFixture()

    await expect(service.createType(context, {
      code: ' Sales.Channel ',
      name: '  销售　渠道  ',
      description: ' 首选　销售入口 ',
      sortOrder: 10,
    })).resolves.toEqual(dictionaryTypeDto())

    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(transaction)
    expect(mockedCreateDictionaryTypeRecord).toHaveBeenCalledWith(
      transaction,
      {
        code: 'sales.channel',
        name: '销售 渠道',
        description: '首选 销售入口',
        sortOrder: 10,
      },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_TYPE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryType',
      targetId: TYPE_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        changedFields: 'code,description,enabled,name,sortOrder',
        version: 1,
      },
    })
    expect(mockedReadDictionaryTypeCommandDto).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
    )
    expect(
      mockedApplyTransactionTimeouts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockedCreateDictionaryTypeRecord.mock.invocationCallOrder[0],
    )
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      mockedReadDictionaryTypeCommandDto.mock.invocationCallOrder[0],
    )
  })

  it('omits description from create changedFields when the request did not contain it', async () => {
    const { audit, service, transaction } = createFixture()
    const input = Object.assign(new CreateDictionaryTypeRequestDto(), {
      code: 'sales.channel',
      name: '销售渠道',
      sortOrder: 10,
    })

    // ValidationPipe transform 后 optional class field 存在，但未提交值仍为 undefined。
    expect(Object.hasOwn(input, 'description')).toBe(true)
    expect(input.description).toBeUndefined()
    await service.createType(context, input)

    expect(mockedCreateDictionaryTypeRecord).toHaveBeenCalledWith(
      transaction,
      {
        code: 'sales.channel',
        name: '销售渠道',
        description: null,
        sortOrder: 10,
      },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_TYPE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryType',
      targetId: TYPE_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        changedFields: 'code,enabled,name,sortOrder',
        version: 1,
      },
    })
  })

  it('maps a duplicate normalized Type code to the stable conflict', async () => {
    mockedCreateDictionaryTypeRecord.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['code'] },
      message: 'must-not-leak duplicate input',
    })
    const { service } = createFixture()

    await expect(service.createType(context, {
      code: ' Sales.Channel ',
      name: '销售渠道',
      sortOrder: 10,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_CODE_ALREADY_EXISTS',
      status: 409,
    })
  })

  it('rejects a direct-service empty Type Patch before opening a transaction', async () => {
    const { audit, service, transactionRunner } = createFixture()

    await expect(service.updateType(context, TYPE_ID, {
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
    })

    expect(transactionRunner).not.toHaveBeenCalled()
    expect(mockedReadDictionaryTypeForMutation).not.toHaveBeenCalled()
    expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('returns stable not-found after locking cannot locate the Type', async () => {
    mockedReadDictionaryTypeForMutation.mockResolvedValue(null)
    const { audit, service } = createFixture()

    await expect(service.updateType(context, TYPE_ID, {
      name: '新名称',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_NOT_FOUND',
      status: 404,
    })

    expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects stale update expectedVersion before comparing or writing fields', async () => {
    mockedReadDictionaryTypeForMutation.mockResolvedValue(
      dictionaryTypeLock({ version: 3 }),
    )
    const { audit, service } = createFixture()

    await expect(service.updateType(context, TYPE_ID, {
      name: '销售渠道',
      expectedVersion: 2,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_STATE_CHANGED',
      status: 409,
    })

    expect(mockedReadDictionaryTypeCommandDto).not.toHaveBeenCalled()
    expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('returns a normalized update no-op without incrementing version or auditing', async () => {
    const { audit, service, transaction } = createFixture()

    await expect(service.updateType(context, TYPE_ID, {
      name: '  销售渠道  ',
      description: null,
      sortOrder: 10,
      expectedVersion: 1,
    })).resolves.toEqual(dictionaryTypeDto())

    expect(mockedReadDictionaryTypeForMutation).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
    )
    expect(mockedReadDictionaryTypeCommandDto).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
    )
    expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('updates only normalized changed fields and audits exact sorted metadata', async () => {
    mockedReadDictionaryTypeCommandDto.mockResolvedValue(
      dictionaryTypeDto({
        name: '直营网点',
        description: null,
        sortOrder: 20,
        version: 2,
      }),
    )
    const { audit, service, transaction } = createFixture()

    await expect(service.updateType(context, TYPE_ID, {
      name: ' 直营网点 ',
      description: '   ',
      sortOrder: 20,
      expectedVersion: 1,
    })).resolves.toEqual(dictionaryTypeDto({
      name: '直营网点',
      description: null,
      sortOrder: 20,
      version: 2,
    }))

    expect(mockedUpdateDictionaryTypeRecord).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      {
        name: '直营网点',
        sortOrder: 20,
      },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_TYPE_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryType',
      targetId: TYPE_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        changedFields: 'name,sortOrder',
        previousVersion: 1,
        version: 2,
      },
    })
  })

  it('clears an existing description and audits description as the only change', async () => {
    mockedReadDictionaryTypeForMutation.mockResolvedValue(
      dictionaryTypeLock({ description: '旧说明' }),
    )
    mockedReadDictionaryTypeCommandDto.mockResolvedValue(
      dictionaryTypeDto({ description: null, version: 2 }),
    )
    const { audit, service, transaction } = createFixture()

    await service.updateType(context, TYPE_ID, {
      description: '   ',
      expectedVersion: 1,
    })

    expect(mockedUpdateDictionaryTypeRecord).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      { description: null },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_TYPE_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryType',
      targetId: TYPE_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        changedFields: 'description',
        previousVersion: 1,
        version: 2,
      },
    })
  })

  it.each(['enableType', 'disableType'] as const)(
    'returns stable not-found when %s cannot lock the Type',
    async (method) => {
      mockedReadDictionaryTypeForMutation.mockResolvedValue(null)
      const { audit, service } = createFixture()

      await expect(service[method](context, TYPE_ID, {
        expectedVersion: 1,
      })).rejects.toMatchObject({
        code: 'DICTIONARY_TYPE_NOT_FOUND',
        status: 404,
      })

      expect(mockedReadDictionaryTypeCommandDto).not.toHaveBeenCalled()
      expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['enableType', true],
    ['disableType', false],
  ] as const)(
    'checks expectedVersion before a same-state %s no-op',
    async (method, enabled) => {
      mockedReadDictionaryTypeForMutation.mockResolvedValue(
        dictionaryTypeLock({ enabled, version: 3 }),
      )
      const { audit, service } = createFixture()

      await expect(service[method](context, TYPE_ID, {
        expectedVersion: 2,
      })).rejects.toMatchObject({
        code: 'DICTIONARY_TYPE_STATE_CHANGED',
        status: 409,
      })

      expect(mockedReadDictionaryTypeCommandDto).not.toHaveBeenCalled()
      expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it('rejects enabling a Type without an enabled Item before writing or auditing', async () => {
    mockedReadDictionaryTypeCommandDto.mockResolvedValue(
      dictionaryTypeDto({ itemCount: 2, enabledItemCount: 0 }),
    )
    const { audit, service } = createFixture()

    await expect(service.enableType(context, TYPE_ID, {
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
      status: 422,
    })

    expect(mockedReadDictionaryTypeCommandDto).toHaveBeenCalledTimes(1)
    expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('enables after the Type lock and enabled-item check, then audits and rereads', async () => {
    mockedReadDictionaryTypeCommandDto
      .mockResolvedValueOnce(dictionaryTypeDto({ enabledItemCount: 2 }))
      .mockResolvedValueOnce(dictionaryTypeDto({
        enabled: true,
        enabledItemCount: 2,
        version: 2,
      }))
    const { audit, service, transaction } = createFixture()

    await expect(service.enableType(context, TYPE_ID, {
      expectedVersion: 1,
    })).resolves.toEqual(dictionaryTypeDto({
      enabled: true,
      enabledItemCount: 2,
      version: 2,
    }))

    expect(mockedReadDictionaryTypeForMutation).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
    )
    expect(mockedUpdateDictionaryTypeRecord).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      { enabled: true },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_TYPE_ENABLED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryType',
      targetId: TYPE_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        changedFields: 'enabled',
        previousVersion: 1,
        version: 2,
      },
    })
    expect(mockedReadDictionaryTypeCommandDto).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['enableType', true],
    ['disableType', false],
  ] as const)(
    'returns a version-current %s same-state no-op without write or Audit',
    async (method, enabled) => {
      mockedReadDictionaryTypeForMutation.mockResolvedValue(
        dictionaryTypeLock({ enabled }),
      )
      mockedReadDictionaryTypeCommandDto.mockResolvedValue(
        dictionaryTypeDto({ enabled }),
      )
      const { audit, service } = createFixture()

      await expect(service[method](context, TYPE_ID, {
        expectedVersion: 1,
      })).resolves.toEqual(dictionaryTypeDto({ enabled }))

      expect(mockedReadDictionaryTypeCommandDto).toHaveBeenCalledTimes(1)
      expect(mockedUpdateDictionaryTypeRecord).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it('disables only the Type and writes exact disabled Audit metadata', async () => {
    mockedReadDictionaryTypeForMutation.mockResolvedValue(
      dictionaryTypeLock({ enabled: true }),
    )
    mockedReadDictionaryTypeCommandDto.mockResolvedValue(
      dictionaryTypeDto({ enabled: false, version: 2 }),
    )
    const { audit, service, transaction } = createFixture()

    await service.disableType(context, TYPE_ID, { expectedVersion: 1 })

    expect(mockedUpdateDictionaryTypeRecord).toHaveBeenCalledTimes(1)
    expect(mockedUpdateDictionaryTypeRecord).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      { enabled: false },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_TYPE_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryType',
      targetId: TYPE_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        changedFields: 'enabled',
        previousVersion: 1,
        version: 2,
      },
    })
  })

  it('maps Audit failure safely and never performs the final response read', async () => {
    const { audit, service } = createFixture()
    audit.record.mockRejectedValue(
      new Error('must-not-leak audit database details'),
    )

    await expect(service.updateType(context, TYPE_ID, {
      name: '新名称',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    })

    expect(mockedUpdateDictionaryTypeRecord).toHaveBeenCalledTimes(1)
    expect(mockedReadDictionaryTypeCommandDto).not.toHaveBeenCalled()
  })

  it('maps a transaction conflict using TYPE context', async () => {
    const { service, transactionRunner } = createFixture()
    transactionRunner.mockRejectedValueOnce({
      code: 'P2034',
      message: 'must-not-leak transaction state',
    })

    await expect(service.updateType(context, TYPE_ID, {
      name: '新名称',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_STATE_CHANGED',
      status: 409,
    })
  })

  it('at service level, serializes same-version writes into one success and one 409', async () => {
    const transaction = {}
    let committedVersion = 1
    let transactionTail = Promise.resolve()
    const transactionRunner = jest.fn(
      (operation: TransactionOperation): Promise<unknown> => {
        const result = transactionTail.then(() => operation(transaction))
        transactionTail = result.then(() => undefined, () => undefined)
        return result
      },
    )
    const prisma = { $transaction: transactionRunner }
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-id' }),
    }
    const service = new DictionaryCommandService(
      prisma as unknown as PrismaService,
      audit,
    )
    mockedReadDictionaryTypeForMutation.mockImplementation(() =>
      Promise.resolve(dictionaryTypeLock({ version: committedVersion })),
    )
    mockedUpdateDictionaryTypeRecord.mockImplementation(() => {
      committedVersion += 1
      return Promise.resolve()
    })
    mockedReadDictionaryTypeCommandDto.mockImplementation(() =>
      Promise.resolve(dictionaryTypeDto({ version: committedVersion })),
    )

    const results = await Promise.allSettled([
      service.updateType(context, TYPE_ID, {
        name: '第一个名称',
        expectedVersion: 1,
      }),
      service.updateType(context, TYPE_ID, {
        name: '第二个名称',
        expectedVersion: 1,
      }),
    ])

    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: {
        code: 'DICTIONARY_TYPE_STATE_CHANGED',
        status: 409,
      },
    })
    expect(mockedUpdateDictionaryTypeRecord).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(committedVersion).toBe(2)
  })

  it('does not expose any Type delete operation', () => {
    const { service } = createFixture()

    expect('deleteType' in service).toBe(false)
  })
})
