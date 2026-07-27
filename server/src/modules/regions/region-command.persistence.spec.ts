import type { Prisma } from '../../generated/prisma/client'
import {
  lockRegionIdsInStableOrder,
  readRegionForCreate,
  readRegionForUpdate,
  readRegionStatusGraph,
} from './region-command.persistence'

const ID_A = '12ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const ID_B = '52ad40d4-7fa5-46fb-81e4-1986bcebf8f6'

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

function transactionWithRows(rows: unknown[]) {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue(rows)
  return {
    queryRaw,
    transaction: {
      $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient,
  }
}

describe('Region command persistence locks', () => {
  it('uses FOR SHARE for create parent inference', async () => {
    const fixture = transactionWithRows([])

    await expect(
      readRegionForCreate(fixture.transaction, ID_A),
    ).resolves.toBeNull()

    const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
    expect(sql.strings.join('')).toContain('FOR SHARE')
    expect(sql.strings.join('')).not.toContain(ID_A)
    expect(sql.values).toEqual([ID_A])
  })

  it('uses FOR UPDATE before comparing editable fields', async () => {
    const fixture = transactionWithRows([])

    await expect(
      readRegionForUpdate(fixture.transaction, ID_A),
    ).resolves.toBeNull()

    const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
    expect(sql.strings.join('')).toContain('FOR UPDATE')
    expect(sql.strings.join('')).not.toContain(ID_A)
    expect(sql.values).toEqual([ID_A])
  })

  it('locks unique UUIDs in SQL ORDER BY order and rejects an incomplete lock set', async () => {
    const complete = transactionWithRows([{ id: ID_A }, { id: ID_B }])

    await expect(
      lockRegionIdsInStableOrder(
        complete.transaction,
        [ID_B.toUpperCase(), ID_A, ID_B],
      ),
    ).resolves.toBeUndefined()

    const sql = requireSql(complete.queryRaw.mock.calls[0]?.[0])
    const source = sql.strings.join('')
    expect(source).toContain('ORDER BY "id" ASC')
    expect(source).toContain('FOR UPDATE')
    expect(source).not.toContain(ID_A)
    expect(source).not.toContain(ID_B)
    expect(sql.values).toEqual([ID_A, ID_B])

    const incomplete = transactionWithRows([{ id: ID_A }])
    await expect(
      lockRegionIdsInStableOrder(
        incomplete.transaction,
        [ID_A, ID_B],
      ),
    ).rejects.toMatchObject({
      code: 'REGION_STATE_CHANGED',
      publicMessage: '地区状态已变化，请刷新后重试',
    })
  })

  it('reads ancestry and subtree in one stable recursive snapshot', async () => {
    const fixture = transactionWithRows([])

    await expect(
      readRegionStatusGraph(fixture.transaction, ID_A),
    ).resolves.toEqual([])

    const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
    const source = sql.strings.join('')
    expect(source).toContain('WITH RECURSIVE')
    expect(source).toContain('"ancestry"')
    expect(source).toContain('"subtree"')
    expect(source).toContain('ORDER BY graph."id" ASC')
    expect(sql.values).toEqual([ID_A, ID_A])
  })
})
