import type { Prisma } from '../../generated/prisma/client'
import { UserStatus } from '../../generated/prisma/enums'

import {
  lockRoles,
  lockUsers,
  readDatabaseNow,
  toUserDto,
} from './users.persistence'

const ID_A = '12ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const ID_B = '52ad40d4-7fa5-46fb-81e4-1986bcebf8f6'

interface SqlShape {
  values: unknown[]
}

function getSqlValues(value: unknown): unknown[] {
  if (
    typeof value !== 'object'
    || value === null
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return (value as SqlShape).values
}

function transactionWithRows(rows: unknown[]) {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue(rows)

  return {
    transaction: { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient,
    queryRaw,
  }
}

describe('users persistence lock order', () => {
  it('Role 锁对 UUID 去重排序，并返回以 ID 为键的锁定集合', async () => {
    const { transaction, queryRaw } = transactionWithRows([
      { id: ID_A, code: 'a' },
      { id: ID_B, code: 'b' },
    ])

    const locked = await lockRoles(transaction, [
      ID_B.toUpperCase(),
      ID_A,
      ID_B,
    ])

    expect(getSqlValues(queryRaw.mock.calls[0]?.[0])).toEqual([ID_A, ID_B])
    expect([...locked.keys()]).toEqual([ID_A, ID_B])
  })

  it('User 锁同样去重排序，保证 Role 后 User 的全局锁约定可执行', async () => {
    const { transaction, queryRaw } = transactionWithRows([
      {
        id: ID_A,
        status: UserStatus.ACTIVE,
        authVersion: 1,
        passwordHash: 'hash-a',
      },
      {
        id: ID_B,
        status: UserStatus.DISABLED,
        authVersion: 2,
        passwordHash: 'hash-b',
      },
    ])

    const locked = await lockUsers(transaction, [
      ID_B.toUpperCase(),
      ID_A,
      ID_A.toUpperCase(),
    ])

    expect(getSqlValues(queryRaw.mock.calls[0]?.[0])).toEqual([ID_A, ID_B])
    expect([...locked.keys()]).toEqual([ID_A, ID_B])
  })
})

describe('users persistence boundaries', () => {
  it('安全期限只接受 PostgreSQL 返回的有效 clock_timestamp', async () => {
    const databaseNow = new Date('2026-07-17T06:00:00.000Z')
    const valid = transactionWithRows([{ now: databaseNow }])
    const invalid = transactionWithRows([{ now: new Date(Number.NaN) }])

    await expect(readDatabaseNow(valid.transaction)).resolves.toBe(databaseNow)
    await expect(readDatabaseNow(invalid.transaction)).rejects.toThrow(
      'Invalid database clock result',
    )
  })

  it('响应 mapper 去重排序 roleIds 且不复制内部认证字段', () => {
    const result = toUserDto({
      id: ID_A,
      username: 'alice',
      displayName: 'Alice',
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      roles: [{ roleId: ID_B }, { roleId: ID_A }, { roleId: ID_B }],
    })

    expect(result.roleIds).toEqual([ID_A, ID_B])
    expect(result).not.toHaveProperty('passwordHash')
    expect(result).not.toHaveProperty('authVersion')
  })
})
