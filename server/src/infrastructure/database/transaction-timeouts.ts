import { Prisma } from '../../generated/prisma/client'

const TRANSACTION_LOCK_TIMEOUT = '2s'
const TRANSACTION_STATEMENT_TIMEOUT = '5s'

/**
 * 为 PostgreSQL interactive transaction 设置服务端超时边界。
 *
 * `set_config(..., true)` 只在当前事务内生效，commit 或 rollback 后由 PostgreSQL
 * 自动恢复连接原值，避免连接池复用时污染后续请求。超时值固定在服务端且函数不
 * 接收外部配置，业务请求无法放宽锁等待或语句执行上限。
 */
export async function applyTransactionTimeouts(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT
      set_config('lock_timeout', ${TRANSACTION_LOCK_TIMEOUT}, true),
      set_config('statement_timeout', ${TRANSACTION_STATEMENT_TIMEOUT}, true)
  `)
}
