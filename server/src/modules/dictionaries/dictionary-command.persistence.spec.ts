import type { Prisma } from '../../generated/prisma/client'
import { DictionaryTone } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  createDictionaryItemRecord,
  createDictionaryTypeRecord,
  readDictionaryItemCommandDto,
  readDictionaryItemMutationContext,
  readDictionaryTypeCommandDto,
  readDictionaryTypeForMutation,
  runDictionaryCommandTransaction,
  updateDictionaryItemRecord,
  updateDictionaryTypeRecord,
} from './dictionary-command.persistence'

const TYPE_ID = '12ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const OTHER_TYPE_ID = '22ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const ITEM_ID = '52ad40d4-7fa5-46fb-81e4-1986bcebf8f6'
const OTHER_ITEM_ID = '62ad40d4-7fa5-46fb-81e4-1986bcebf8f7'
const CREATED_AT = new Date('2026-08-03T01:02:03.000Z')
const UPDATED_AT = new Date('2026-08-03T04:05:06.000Z')

const TYPE_MUTATION_ROW = {
  id: TYPE_ID,
  code: 'sales.channel',
  name: '销售渠道',
  description: null,
  enabled: true,
  sortOrder: 10,
  version: 3,
} as const

const ITEM_MUTATION_ROW = {
  id: ITEM_ID,
  dictionaryTypeId: TYPE_ID,
  value: 'ONLINE',
  label: '线上',
  description: null,
  tone: DictionaryTone.PRIMARY,
  enabled: true,
  sortOrder: 20,
  version: 4,
} as const

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

function requireSql(value: unknown): SqlShape {
  if (
    typeof value !== 'object'
    || value === null
    || !('strings' in value)
    || !Array.isArray(value.strings)
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return value as unknown as SqlShape
}

function createTransactionFixture(rawResults: readonly unknown[][] = []) {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
  for (const result of rawResults) {
    queryRaw.mockResolvedValueOnce([...result])
  }

  const typeCreate = jest.fn().mockResolvedValue({ id: TYPE_ID })
  const typeUpdate = jest.fn().mockResolvedValue({ id: TYPE_ID })
  const itemCreate = jest.fn().mockResolvedValue({ id: ITEM_ID })
  const itemUpdate = jest.fn().mockResolvedValue({ id: ITEM_ID })
  const transaction = {
    $queryRaw: queryRaw,
    dictionaryType: {
      create: typeCreate,
      update: typeUpdate,
    },
    dictionaryItem: {
      create: itemCreate,
      update: itemUpdate,
    },
  } as unknown as Prisma.TransactionClient

  return {
    transaction,
    queryRaw,
    typeCreate,
    typeUpdate,
    itemCreate,
    itemUpdate,
  }
}

function createPrismaFixture(transaction: Prisma.TransactionClient) {
  type Operation = (
    transactionClient: Prisma.TransactionClient,
  ) => Promise<unknown>

  const transactionRunner = jest.fn<Promise<unknown>, [Operation]>(
    operation => operation(transaction),
  )

  return {
    prisma: {
      $transaction: transactionRunner,
    } as unknown as PrismaService,
    transactionRunner,
  }
}

describe('Dictionary command persistence', () => {
  describe('transaction boundary', () => {
    it('applies fixed timeouts as the first SQL before invoking a TYPE operation', async () => {
      const fixture = createTransactionFixture([[]])
      const prisma = createPrismaFixture(fixture.transaction)
      const operation = jest.fn(() => Promise.resolve('completed'))

      await expect(
        runDictionaryCommandTransaction(prisma.prisma, 'TYPE', operation),
      ).resolves.toBe('completed')

      expect(prisma.transactionRunner).toHaveBeenCalledTimes(1)
      expect(fixture.queryRaw).toHaveBeenCalledTimes(1)
      expect(
        fixture.queryRaw.mock.invocationCallOrder[0],
      ).toBeLessThan(operation.mock.invocationCallOrder[0] ?? 0)

      const timeoutSql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
      expect(timeoutSql.strings.join('')).toContain("set_config('lock_timeout'")
      expect(timeoutSql.strings.join('')).toContain(
        "set_config('statement_timeout'",
      )
      expect(timeoutSql.values).toEqual(['2s', '5s'])
    })

    it('maps a transaction failure with the explicit ITEM context', async () => {
      const fixture = createTransactionFixture([[]])
      const prisma = createPrismaFixture(fixture.transaction)
      const driverError = Object.assign(
        new Error('must-not-leak postgresql://secret'),
        { code: 'P2034' },
      )

      await expect(
        runDictionaryCommandTransaction(
          prisma.prisma,
          'ITEM',
          () => Promise.reject(driverError),
        ),
      ).rejects.toMatchObject({
        code: 'DICTIONARY_ITEM_STATE_CHANGED',
        publicMessage: '字典条目状态已变化，请刷新后重试',
      })
    })
  })

  describe('Type primitives', () => {
    it('creates a disabled-by-default Type without exposing identity mutation fields', async () => {
      const fixture = createTransactionFixture()
      const input = {
        code: 'sales.channel',
        name: '销售渠道',
        description: null,
        sortOrder: 10,
      }

      await expect(
        createDictionaryTypeRecord(fixture.transaction, input),
      ).resolves.toEqual({ id: TYPE_ID })

      expect(fixture.typeCreate).toHaveBeenCalledWith({
        data: input,
        select: { id: true },
      })
    })

    it('locks and reads one Type with a parameterized FOR UPDATE query', async () => {
      const fixture = createTransactionFixture([[TYPE_MUTATION_ROW]])

      await expect(
        readDictionaryTypeForMutation(fixture.transaction, TYPE_ID),
      ).resolves.toEqual(TYPE_MUTATION_ROW)

      const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
      const source = sql.strings.join('')
      expect(source).toContain('FROM "dictionary_types"')
      expect(source).toContain('FOR UPDATE')
      expect(source).not.toContain(TYPE_ID)
      expect(sql.values).toEqual([TYPE_ID])
    })

    it('updates only mutable Type fields and increments version atomically', async () => {
      const fixture = createTransactionFixture()
      const input = {
        name: '零售渠道',
        description: '面向消费者',
        enabled: true,
        sortOrder: 30,
      }

      await expect(
        updateDictionaryTypeRecord(fixture.transaction, TYPE_ID, input),
      ).resolves.toBeUndefined()

      expect(fixture.typeUpdate).toHaveBeenCalledWith({
        where: { id: TYPE_ID },
        data: {
          ...input,
          version: { increment: 1 },
        },
        select: { id: true },
      })
    })
  })

  describe('Item primitives and lock order', () => {
    it('locks the parent Type before creating an Item', async () => {
      const fixture = createTransactionFixture([[TYPE_MUTATION_ROW]])
      const input = {
        value: 'ONLINE',
        label: '线上',
        description: null,
        tone: DictionaryTone.PRIMARY,
        sortOrder: 20,
      }

      await expect(
        createDictionaryItemRecord(
          fixture.transaction,
          TYPE_ID,
          input,
        ),
      ).resolves.toEqual({
        dictionaryType: TYPE_MUTATION_ROW,
        itemId: ITEM_ID,
      })

      expect(
        fixture.queryRaw.mock.invocationCallOrder[0],
      ).toBeLessThan(fixture.itemCreate.mock.invocationCallOrder[0] ?? 0)
      expect(fixture.itemCreate).toHaveBeenCalledWith({
        data: {
          dictionaryTypeId: TYPE_ID,
          ...input,
        },
        select: { id: true },
      })
    })

    it('does not insert an Item when its lockable parent Type is absent', async () => {
      const fixture = createTransactionFixture([[]])

      await expect(
        createDictionaryItemRecord(
          fixture.transaction,
          TYPE_ID,
          {
            value: 'ONLINE',
            label: '线上',
            description: null,
            tone: DictionaryTone.DEFAULT,
            sortOrder: 0,
          },
        ),
      ).resolves.toBeNull()

      expect(fixture.itemCreate).not.toHaveBeenCalled()
    })

    it('locks Type then path-scoped Item through one combined helper', async () => {
      const fixture = createTransactionFixture([
        [TYPE_MUTATION_ROW],
        [ITEM_MUTATION_ROW],
      ])

      await expect(
        readDictionaryItemMutationContext(
          fixture.transaction,
          TYPE_ID,
          ITEM_ID,
        ),
      ).resolves.toEqual({
        dictionaryType: TYPE_MUTATION_ROW,
        dictionaryItem: ITEM_MUTATION_ROW,
      })

      expect(fixture.queryRaw).toHaveBeenCalledTimes(2)
      const typeSql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
      const itemSql = requireSql(fixture.queryRaw.mock.calls[1]?.[0])
      expect(typeSql.strings.join('')).toContain('FROM "dictionary_types"')
      expect(itemSql.strings.join('')).toContain('FROM "dictionary_items"')
      expect(typeSql.strings.join('')).toContain('FOR UPDATE')
      expect(itemSql.strings.join('')).toContain('FOR UPDATE')
      expect(itemSql.strings.join('')).toContain(
        '"dictionary_type_id" = CAST(',
      )
      expect(itemSql.strings.join('')).not.toContain(TYPE_ID)
      expect(itemSql.strings.join('')).not.toContain(ITEM_ID)
      expect(itemSql.values).toEqual([TYPE_ID, ITEM_ID])
    })

    it('never probes an Item when the parent Type lock cannot be acquired', async () => {
      const fixture = createTransactionFixture([[]])

      await expect(
        readDictionaryItemMutationContext(
          fixture.transaction,
          TYPE_ID,
          OTHER_ITEM_ID,
        ),
      ).resolves.toEqual({
        dictionaryType: null,
        dictionaryItem: null,
      })

      expect(fixture.queryRaw).toHaveBeenCalledTimes(1)
    })

    it('updates only mutable Item fields and increments version atomically', async () => {
      const fixture = createTransactionFixture()
      const input = {
        label: '电商',
        description: '电子商务渠道',
        tone: DictionaryTone.SUCCESS,
        enabled: true,
        sortOrder: 40,
      }

      await expect(
        updateDictionaryItemRecord(fixture.transaction, ITEM_ID, input),
      ).resolves.toBeUndefined()

      expect(fixture.itemUpdate).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
        data: {
          ...input,
          version: { increment: 1 },
        },
        select: { id: true },
      })
    })
  })

  describe('same-transaction response reads', () => {
    it('reads a complete Type DTO with both Item statistics', async () => {
      const fixture = createTransactionFixture([[
        {
          ...TYPE_MUTATION_ROW,
          itemCount: 3,
          enabledItemCount: 2,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
      ]])

      await expect(
        readDictionaryTypeCommandDto(fixture.transaction, TYPE_ID),
      ).resolves.toEqual({
        ...TYPE_MUTATION_ROW,
        itemCount: 3,
        enabledItemCount: 2,
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
      })

      const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
      const source = sql.strings.join('')
      expect(source).toContain('COUNT(item."id")::integer AS "itemCount"')
      expect(source).toMatch(
        /COUNT\(item\."id"\) FILTER \(WHERE item\."enabled"\)[\s)]*::integer AS "enabledItemCount"/u,
      )
      expect(sql.values).toEqual([TYPE_ID])
    })

    it('reads a path-scoped Item DTO and derives effectiveEnabled', async () => {
      const fixture = createTransactionFixture([[
        {
          ...ITEM_MUTATION_ROW,
          dictionaryTypeEnabled: false,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
      ]])

      await expect(
        readDictionaryItemCommandDto(
          fixture.transaction,
          TYPE_ID,
          ITEM_ID,
        ),
      ).resolves.toEqual({
        ...ITEM_MUTATION_ROW,
        effectiveEnabled: false,
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
      })

      const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
      const source = sql.strings.join('')
      expect(source).toContain('INNER JOIN "dictionary_types" AS parent')
      expect(source).toContain('item."dictionary_type_id" = CAST(')
      expect(source).toContain('item."id" = CAST(')
      expect(source).not.toContain(TYPE_ID)
      expect(source).not.toContain(ITEM_ID)
      expect(sql.values).toEqual([TYPE_ID, ITEM_ID])
    })
  })

  describe('runtime field boundary', () => {
    it('copies only frozen Type fields from structurally wider inputs', async () => {
      const createFixture = createTransactionFixture()
      const createInput = {
        code: 'sales.channel',
        name: '销售渠道',
        description: null,
        sortOrder: 10,
        id: OTHER_TYPE_ID,
        enabled: true,
        version: 99,
        expectedVersion: 98,
      }

      await createDictionaryTypeRecord(createFixture.transaction, createInput)

      expect(createFixture.typeCreate).toHaveBeenCalledWith({
        data: {
          code: 'sales.channel',
          name: '销售渠道',
          description: null,
          sortOrder: 10,
        },
        select: { id: true },
      })

      const updateFixture = createTransactionFixture()
      const updateInput = {
        name: '零售渠道',
        description: null,
        enabled: false,
        sortOrder: 20,
        id: OTHER_TYPE_ID,
        code: 'must.not.replace',
        version: 99,
        expectedVersion: 98,
      }

      await updateDictionaryTypeRecord(
        updateFixture.transaction,
        TYPE_ID,
        updateInput,
      )

      expect(updateFixture.typeUpdate).toHaveBeenCalledWith({
        where: { id: TYPE_ID },
        data: {
          name: '零售渠道',
          description: null,
          enabled: false,
          sortOrder: 20,
          version: { increment: 1 },
        },
        select: { id: true },
      })
    })

    it('cannot override the locked Item parent or forward owned fields', async () => {
      const createFixture = createTransactionFixture([[TYPE_MUTATION_ROW]])
      const createInput = {
        value: 'ONLINE',
        label: '线上',
        description: null,
        tone: DictionaryTone.PRIMARY,
        sortOrder: 20,
        dictionaryTypeId: OTHER_TYPE_ID,
        id: OTHER_ITEM_ID,
        enabled: true,
        version: 99,
        expectedVersion: 98,
      }

      await createDictionaryItemRecord(
        createFixture.transaction,
        TYPE_ID,
        createInput,
      )

      expect(createFixture.itemCreate).toHaveBeenCalledWith({
        data: {
          dictionaryTypeId: TYPE_ID,
          value: 'ONLINE',
          label: '线上',
          description: null,
          tone: DictionaryTone.PRIMARY,
          sortOrder: 20,
        },
        select: { id: true },
      })

      const updateFixture = createTransactionFixture()
      const updateInput = {
        label: '电商',
        description: null,
        tone: DictionaryTone.SUCCESS,
        enabled: false,
        sortOrder: 30,
        dictionaryTypeId: OTHER_TYPE_ID,
        id: OTHER_ITEM_ID,
        value: 'MUST_NOT_REPLACE',
        version: 99,
        expectedVersion: 98,
      }

      await updateDictionaryItemRecord(
        updateFixture.transaction,
        ITEM_ID,
        updateInput,
      )

      expect(updateFixture.itemUpdate).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
        data: {
          label: '电商',
          description: null,
          tone: DictionaryTone.SUCCESS,
          enabled: false,
          sortOrder: 30,
          version: { increment: 1 },
        },
        select: { id: true },
      })
    })
  })
})
