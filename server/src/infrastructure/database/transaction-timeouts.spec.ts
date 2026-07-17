import type { Prisma } from '../../generated/prisma/client'

import { applyTransactionTimeouts } from './transaction-timeouts'

interface RawSql {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

type QueryRaw = (query: RawSql) => Promise<unknown[]>

function createTransaction() {
  const queryRaw = jest
    .fn<ReturnType<QueryRaw>, Parameters<QueryRaw>>()
    .mockResolvedValue([])
  const transaction = {
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient

  return { queryRaw, transaction }
}

function normalizeSql(query: RawSql): string {
  return query.strings.join('?').replace(/\s+/g, ' ').trim()
}

describe('applyTransactionTimeouts', () => {
  it('在事务 client 上一次性设置 transaction-local 锁与语句超时', async () => {
    const { queryRaw, transaction } = createTransaction()

    await expect(applyTransactionTimeouts(transaction)).resolves.toBeUndefined()

    expect(queryRaw).toHaveBeenCalledTimes(1)
    const query = queryRaw.mock.calls[0]?.[0]
    expect(query).toBeDefined()
    expect(normalizeSql(query)).toBe(
      "SELECT set_config('lock_timeout', ?, true), set_config('statement_timeout', ?, true)",
    )
    expect(query?.values).toEqual(['2s', '5s'])
  })

  it('只接收事务 client，超时值不暴露为请求可控参数', () => {
    expect(applyTransactionTimeouts).toHaveLength(1)
  })

  it('不吞掉或替换 PostgreSQL 设置超时时抛出的异常', async () => {
    const databaseError = new Error('database rejected set_config')
    const { queryRaw, transaction } = createTransaction()
    queryRaw.mockRejectedValueOnce(databaseError)

    await expect(applyTransactionTimeouts(transaction)).rejects.toBe(
      databaseError,
    )
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })
})
