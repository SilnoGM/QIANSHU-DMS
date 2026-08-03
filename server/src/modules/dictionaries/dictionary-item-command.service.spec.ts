import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  DictionaryTone,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import {
  createDictionaryItemRecord,
  readDictionaryItemCommandDto,
  readDictionaryItemMutationContext,
  readDictionaryTypeCommandDto,
  updateDictionaryItemRecord,
} from './dictionary-command.persistence'
import { DictionaryCommandService } from './dictionary-command.service'
import { CreateDictionaryItemRequestDto } from './dto/dictionary-command.dto'
import type {
  DictionaryItemDto,
  DictionaryTypeDto,
} from './dto/dictionary-response.dto'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./dictionary-command.persistence', () => {
  const actual = jest.requireActual<
    typeof import('./dictionary-command.persistence')
  >('./dictionary-command.persistence')

  return {
    ...actual,
    createDictionaryItemRecord: jest.fn(),
    readDictionaryItemCommandDto: jest.fn(),
    readDictionaryItemMutationContext: jest.fn(),
    readDictionaryTypeCommandDto: jest.fn(),
    updateDictionaryItemRecord: jest.fn(),
  }
})

const mockedApplyTransactionTimeouts = jest.mocked(
  applyTransactionTimeouts,
)
const mockedCreateDictionaryItemRecord = jest.mocked(
  createDictionaryItemRecord,
)
const mockedReadDictionaryItemCommandDto = jest.mocked(
  readDictionaryItemCommandDto,
)
const mockedReadDictionaryItemMutationContext = jest.mocked(
  readDictionaryItemMutationContext,
)
const mockedReadDictionaryTypeCommandDto = jest.mocked(
  readDictionaryTypeCommandDto,
)
const mockedUpdateDictionaryItemRecord = jest.mocked(
  updateDictionaryItemRecord,
)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const TYPE_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const TYPE_ID_INPUT = TYPE_ID.toUpperCase()
const OTHER_TYPE_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const ITEM_ID = '50ad40d4-7fa5-46fb-81e4-1986bcebf8f6'
const ITEM_ID_INPUT = ITEM_ID.toUpperCase()
const REQUEST_ID = 'dictionary-item-command-spec'

const context = {
  actorUserId: ACTOR_ID,
  requestId: REQUEST_ID,
} as const

function dictionaryTypeLock(overrides: Record<string, unknown> = {}) {
  return {
    id: TYPE_ID,
    code: 'sales.channel',
    name: '销售渠道',
    description: null,
    enabled: true,
    sortOrder: 10,
    version: 3,
    ...overrides,
  }
}

function dictionaryItemLock(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    dictionaryTypeId: TYPE_ID,
    value: 'ONLINE',
    label: '线上渠道',
    description: null,
    tone: DictionaryTone.PRIMARY,
    enabled: false,
    sortOrder: 20,
    version: 1,
    ...overrides,
  }
}

function dictionaryTypeDto(
  overrides: Partial<DictionaryTypeDto> = {},
): DictionaryTypeDto {
  return {
    id: TYPE_ID,
    code: 'sales.channel',
    name: '销售渠道',
    description: null,
    enabled: true,
    sortOrder: 10,
    itemCount: 2,
    enabledItemCount: 2,
    version: 3,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  }
}

function dictionaryItemDto(
  overrides: Partial<DictionaryItemDto> = {},
): DictionaryItemDto {
  return {
    id: ITEM_ID,
    dictionaryTypeId: TYPE_ID,
    value: 'ONLINE',
    label: '线上渠道',
    description: null,
    tone: DictionaryTone.PRIMARY,
    enabled: false,
    effectiveEnabled: false,
    sortOrder: 20,
    version: 1,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
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
  mockedCreateDictionaryItemRecord.mockResolvedValue({
    dictionaryType: dictionaryTypeLock(),
    itemId: ITEM_ID,
  })
  mockedReadDictionaryItemMutationContext.mockResolvedValue({
    dictionaryType: dictionaryTypeLock(),
    dictionaryItem: dictionaryItemLock(),
  })
  mockedReadDictionaryItemCommandDto.mockResolvedValue(dictionaryItemDto())
  mockedReadDictionaryTypeCommandDto.mockResolvedValue(dictionaryTypeDto())
  mockedUpdateDictionaryItemRecord.mockResolvedValue(undefined)
})

describe('DictionaryCommandService Item lifecycle', () => {
  it('creates a normalized disabled Item with DEFAULT tone and exact Audit metadata', async () => {
    const { audit, service, transaction } = createFixture()

    await expect(service.createItem(context, TYPE_ID_INPUT, {
      value: ' online ',
      label: ' 线上　渠道 ',
      description: ' 首选　入口 ',
      sortOrder: 20,
    })).resolves.toEqual(dictionaryItemDto())

    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(transaction)
    expect(mockedCreateDictionaryItemRecord).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      {
        value: 'ONLINE',
        label: '线上 渠道',
        description: '首选 入口',
        tone: DictionaryTone.DEFAULT,
        sortOrder: 20,
      },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_ITEM_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryItem',
      targetId: ITEM_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        itemValue: 'ONLINE',
        changedFields:
          'description,dictionaryTypeId,enabled,label,sortOrder,tone,value',
        version: 1,
      },
    })
    expect(mockedReadDictionaryItemCommandDto).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      ITEM_ID,
    )
    expect(
      mockedApplyTransactionTimeouts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockedCreateDictionaryItemRecord.mock.invocationCallOrder[0],
    )
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      mockedReadDictionaryItemCommandDto.mock.invocationCallOrder[0],
    )
  })

  it('omits description from create changedFields when it was not submitted', async () => {
    const { audit, service, transaction } = createFixture()
    const input = Object.assign(new CreateDictionaryItemRequestDto(), {
      value: 'ONLINE',
      label: '线上渠道',
      tone: DictionaryTone.SUCCESS,
      sortOrder: 20,
    })

    // 真实 DTO 实例会定义 optional class field，不能仅靠 own-property 判定提交。
    expect(Object.hasOwn(input, 'description')).toBe(true)
    expect(input.description).toBeUndefined()
    await service.createItem(context, TYPE_ID, input)

    expect(mockedCreateDictionaryItemRecord).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      {
        value: 'ONLINE',
        label: '线上渠道',
        description: null,
        tone: DictionaryTone.SUCCESS,
        sortOrder: 20,
      },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_ITEM_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryItem',
      targetId: ITEM_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        itemValue: 'ONLINE',
        changedFields: 'dictionaryTypeId,enabled,label,sortOrder,tone,value',
        version: 1,
      },
    })
  })

  it('returns Type not-found when create cannot lock its parent', async () => {
    mockedCreateDictionaryItemRecord.mockResolvedValue(null)
    const { audit, service } = createFixture()

    await expect(service.createItem(context, TYPE_ID, {
      value: 'ONLINE',
      label: '线上渠道',
      sortOrder: 20,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_NOT_FOUND',
      status: 404,
    })

    expect(mockedReadDictionaryItemCommandDto).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('maps a duplicate normalized value to Item conflict during create', async () => {
    mockedCreateDictionaryItemRecord.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['dictionaryTypeId', 'value'] },
      message: 'must-not-leak duplicate Item value',
    })
    const { service } = createFixture()

    await expect(service.createItem(context, TYPE_ID, {
      value: ' online ',
      label: '同名 Label 允许',
      sortOrder: 20,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_ITEM_VALUE_ALREADY_EXISTS',
      status: 409,
    })
  })

  it('maps an Item-create parent lock transaction conflict to Type state change', async () => {
    const { service, transactionRunner } = createFixture()
    transactionRunner.mockRejectedValueOnce({
      code: 'P2034',
      message: 'must-not-leak parent lock state',
    })

    await expect(service.createItem(context, TYPE_ID, {
      value: 'ONLINE',
      label: '线上渠道',
      sortOrder: 20,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_STATE_CHANGED',
      status: 409,
    })
  })

  it('rejects a direct-service empty Item Patch before opening a transaction', async () => {
    const { audit, service, transactionRunner } = createFixture()

    await expect(service.updateItem(context, TYPE_ID, ITEM_ID, {
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
    })

    expect(transactionRunner).not.toHaveBeenCalled()
    expect(mockedReadDictionaryItemMutationContext).not.toHaveBeenCalled()
    expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it.each([
    ['missing parent', { dictionaryType: null, dictionaryItem: null }],
    ['missing or cross-Type Item', {
      dictionaryType: dictionaryTypeLock(),
      dictionaryItem: null,
    }],
  ] as const)(
    'hides %s as stable Item not-found for update',
    async (_caseName, mutationContext) => {
      mockedReadDictionaryItemMutationContext.mockResolvedValue(
        mutationContext,
      )
      const { audit, service } = createFixture()

      await expect(service.updateItem(context, TYPE_ID, ITEM_ID, {
        label: '新 Label',
        expectedVersion: 1,
      })).rejects.toMatchObject({
        code: 'DICTIONARY_ITEM_NOT_FOUND',
        status: 404,
      })

      expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it('rejects stale Item expectedVersion before a normalized update no-op', async () => {
    mockedReadDictionaryItemMutationContext.mockResolvedValue({
      dictionaryType: dictionaryTypeLock(),
      dictionaryItem: dictionaryItemLock({ version: 3 }),
    })
    const { audit, service } = createFixture()

    await expect(service.updateItem(context, TYPE_ID, ITEM_ID, {
      label: '线上渠道',
      expectedVersion: 2,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_ITEM_STATE_CHANGED',
      status: 409,
    })

    expect(mockedReadDictionaryItemCommandDto).not.toHaveBeenCalled()
    expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('returns a normalized Item update no-op without version or Audit writes', async () => {
    const { audit, service, transaction } = createFixture()

    await expect(service.updateItem(context, TYPE_ID_INPUT, ITEM_ID_INPUT, {
      label: ' 线上渠道 ',
      description: null,
      tone: DictionaryTone.PRIMARY,
      sortOrder: 20,
      expectedVersion: 1,
    })).resolves.toEqual(dictionaryItemDto())

    expect(mockedReadDictionaryItemMutationContext).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      ITEM_ID,
    )
    expect(mockedReadDictionaryItemCommandDto).toHaveBeenCalledWith(
      transaction,
      TYPE_ID,
      ITEM_ID,
    )
    expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('updates only mutable Item fields and ignores runtime identity pollution', async () => {
    mockedReadDictionaryItemMutationContext.mockResolvedValue({
      dictionaryType: dictionaryTypeLock(),
      dictionaryItem: dictionaryItemLock({ description: '旧说明' }),
    })
    mockedReadDictionaryItemCommandDto.mockResolvedValue(
      dictionaryItemDto({
        label: '直营网点',
        description: null,
        tone: DictionaryTone.SUCCESS,
        sortOrder: 30,
        version: 2,
      }),
    )
    const { audit, service, transaction } = createFixture()
    const pollutedInput = {
      label: ' 直营网点 ',
      description: '   ',
      tone: DictionaryTone.SUCCESS,
      sortOrder: 30,
      expectedVersion: 1,
      id: 'must-not-be-written',
      dictionaryTypeId: OTHER_TYPE_ID,
      value: 'MUST_NOT_CHANGE',
      enabled: true,
    }

    await service.updateItem(
      context,
      TYPE_ID,
      ITEM_ID,
      pollutedInput,
    )

    expect(mockedUpdateDictionaryItemRecord).toHaveBeenCalledWith(
      transaction,
      ITEM_ID,
      {
        label: '直营网点',
        description: null,
        tone: DictionaryTone.SUCCESS,
        sortOrder: 30,
      },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_ITEM_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryItem',
      targetId: ITEM_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        itemValue: 'ONLINE',
        changedFields: 'description,label,sortOrder,tone',
        previousVersion: 1,
        version: 2,
      },
    })
  })

  it.each(['enableItem', 'disableItem'] as const)(
    'returns stable Item not-found when %s cannot resolve the nested path',
    async (method) => {
      mockedReadDictionaryItemMutationContext.mockResolvedValue({
        dictionaryType: dictionaryTypeLock(),
        dictionaryItem: null,
      })
      const { audit, service } = createFixture()

      await expect(service[method](context, TYPE_ID, ITEM_ID, {
        expectedVersion: 1,
      })).rejects.toMatchObject({
        code: 'DICTIONARY_ITEM_NOT_FOUND',
        status: 404,
      })

      expect(mockedReadDictionaryItemCommandDto).not.toHaveBeenCalled()
      expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['enableItem', true],
    ['disableItem', false],
  ] as const)(
    'checks Item expectedVersion before a same-state %s no-op',
    async (method, enabled) => {
      mockedReadDictionaryItemMutationContext.mockResolvedValue({
        dictionaryType: dictionaryTypeLock(),
        dictionaryItem: dictionaryItemLock({ enabled, version: 3 }),
      })
      const { audit, service } = createFixture()

      await expect(service[method](context, TYPE_ID, ITEM_ID, {
        expectedVersion: 2,
      })).rejects.toMatchObject({
        code: 'DICTIONARY_ITEM_STATE_CHANGED',
        status: 409,
      })

      expect(mockedReadDictionaryItemCommandDto).not.toHaveBeenCalled()
      expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it('enables an Item under a disabled Type while effectiveEnabled remains false', async () => {
    mockedReadDictionaryItemMutationContext.mockResolvedValue({
      dictionaryType: dictionaryTypeLock({ enabled: false }),
      dictionaryItem: dictionaryItemLock({ enabled: false }),
    })
    mockedReadDictionaryItemCommandDto.mockResolvedValue(
      dictionaryItemDto({
        enabled: true,
        effectiveEnabled: false,
        version: 2,
      }),
    )
    const { audit, service, transaction } = createFixture()

    await expect(service.enableItem(context, TYPE_ID, ITEM_ID, {
      expectedVersion: 1,
    })).resolves.toEqual(dictionaryItemDto({
      enabled: true,
      effectiveEnabled: false,
      version: 2,
    }))

    expect(mockedUpdateDictionaryItemRecord).toHaveBeenCalledWith(
      transaction,
      ITEM_ID,
      { enabled: true },
    )
    expect(mockedReadDictionaryTypeCommandDto).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_ITEM_ENABLED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryItem',
      targetId: ITEM_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        itemValue: 'ONLINE',
        changedFields: 'enabled',
        previousVersion: 1,
        version: 2,
      },
    })
  })

  it('rejects disabling the last enabled Item while its Type is enabled', async () => {
    mockedReadDictionaryItemMutationContext.mockResolvedValue({
      dictionaryType: dictionaryTypeLock({ enabled: true }),
      dictionaryItem: dictionaryItemLock({ enabled: true }),
    })
    mockedReadDictionaryTypeCommandDto.mockResolvedValue(
      dictionaryTypeDto({ enabled: true, enabledItemCount: 1 }),
    )
    const { audit, service } = createFixture()

    await expect(service.disableItem(context, TYPE_ID, ITEM_ID, {
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
      status: 422,
    })

    expect(mockedReadDictionaryTypeCommandDto).toHaveBeenCalledTimes(1)
    expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('allows disabling the last own-enabled Item while its Type is disabled', async () => {
    mockedReadDictionaryItemMutationContext.mockResolvedValue({
      dictionaryType: dictionaryTypeLock({ enabled: false }),
      dictionaryItem: dictionaryItemLock({ enabled: true }),
    })
    mockedReadDictionaryItemCommandDto.mockResolvedValue(
      dictionaryItemDto({ enabled: false, effectiveEnabled: false, version: 2 }),
    )
    const { audit, service, transaction } = createFixture()

    await service.disableItem(context, TYPE_ID, ITEM_ID, {
      expectedVersion: 1,
    })

    expect(mockedReadDictionaryTypeCommandDto).not.toHaveBeenCalled()
    expect(mockedUpdateDictionaryItemRecord).toHaveBeenCalledWith(
      transaction,
      ITEM_ID,
      { enabled: false },
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: AuditEventType.DICTIONARY_ITEM_DISABLED,
      }),
    )
  })

  it('allows disabling one of multiple enabled Items under an enabled Type', async () => {
    mockedReadDictionaryItemMutationContext.mockResolvedValue({
      dictionaryType: dictionaryTypeLock({ enabled: true }),
      dictionaryItem: dictionaryItemLock({ enabled: true }),
    })
    mockedReadDictionaryTypeCommandDto.mockResolvedValue(
      dictionaryTypeDto({ enabled: true, enabledItemCount: 2 }),
    )
    mockedReadDictionaryItemCommandDto.mockResolvedValue(
      dictionaryItemDto({ enabled: false, version: 2 }),
    )
    const { audit, service, transaction } = createFixture()

    await service.disableItem(context, TYPE_ID, ITEM_ID, {
      expectedVersion: 1,
    })

    expect(mockedUpdateDictionaryItemRecord).toHaveBeenCalledWith(
      transaction,
      ITEM_ID,
      { enabled: false },
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.DICTIONARY_ITEM_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'DictionaryItem',
      targetId: ITEM_ID,
      requestId: REQUEST_ID,
      metadata: {
        dictionaryCode: 'sales.channel',
        itemValue: 'ONLINE',
        changedFields: 'enabled',
        previousVersion: 1,
        version: 2,
      },
    })
  })

  it.each([
    ['enableItem', true],
    ['disableItem', false],
  ] as const)(
    'returns a version-current %s same-state no-op without write or Audit',
    async (method, enabled) => {
      mockedReadDictionaryItemMutationContext.mockResolvedValue({
        dictionaryType: dictionaryTypeLock(),
        dictionaryItem: dictionaryItemLock({ enabled }),
      })
      mockedReadDictionaryItemCommandDto.mockResolvedValue(
        dictionaryItemDto({ enabled, effectiveEnabled: enabled }),
      )
      const { audit, service } = createFixture()

      await expect(service[method](context, TYPE_ID, ITEM_ID, {
        expectedVersion: 1,
      })).resolves.toEqual(
        dictionaryItemDto({ enabled, effectiveEnabled: enabled }),
      )

      expect(mockedReadDictionaryItemCommandDto).toHaveBeenCalledTimes(1)
      expect(mockedReadDictionaryTypeCommandDto).not.toHaveBeenCalled()
      expect(mockedUpdateDictionaryItemRecord).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    },
  )

  it('maps Item Audit failure safely and skips the final response read', async () => {
    const { audit, service } = createFixture()
    audit.record.mockRejectedValue(
      new Error('must-not-leak Item audit database details'),
    )

    await expect(service.updateItem(context, TYPE_ID, ITEM_ID, {
      label: '新 Label',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    })

    expect(mockedUpdateDictionaryItemRecord).toHaveBeenCalledTimes(1)
    expect(mockedReadDictionaryItemCommandDto).not.toHaveBeenCalled()
  })

  it('maps an Item update transaction conflict to Item state change', async () => {
    const { service, transactionRunner } = createFixture()
    transactionRunner.mockRejectedValueOnce({
      code: 'P2034',
      message: 'must-not-leak Item state',
    })

    await expect(service.updateItem(context, TYPE_ID, ITEM_ID, {
      label: '新 Label',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'DICTIONARY_ITEM_STATE_CHANGED',
      status: 409,
    })
  })

  it('at service level, serializes same-version Item writes into one success and one 409', async () => {
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
    mockedReadDictionaryItemMutationContext.mockImplementation(() =>
      Promise.resolve({
        dictionaryType: dictionaryTypeLock(),
        dictionaryItem: dictionaryItemLock({ version: committedVersion }),
      }),
    )
    mockedUpdateDictionaryItemRecord.mockImplementation(() => {
      committedVersion += 1
      return Promise.resolve()
    })
    mockedReadDictionaryItemCommandDto.mockImplementation(() =>
      Promise.resolve(dictionaryItemDto({ version: committedVersion })),
    )

    const results = await Promise.allSettled([
      service.updateItem(context, TYPE_ID, ITEM_ID, {
        label: '第一个 Label',
        expectedVersion: 1,
      }),
      service.updateItem(context, TYPE_ID, ITEM_ID, {
        label: '第二个 Label',
        expectedVersion: 1,
      }),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: {
        code: 'DICTIONARY_ITEM_STATE_CHANGED',
        status: 409,
      },
    })
    expect(mockedUpdateDictionaryItemRecord).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(committedVersion).toBe(2)
  })

  it('does not expose Item delete, move, or stable-value mutation operations', () => {
    const { service } = createFixture()

    expect('deleteItem' in service).toBe(false)
    expect('moveItem' in service).toBe(false)
    expect('updateItemValue' in service).toBe(false)
  })
})
