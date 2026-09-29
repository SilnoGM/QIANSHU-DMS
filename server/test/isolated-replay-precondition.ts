import { Client } from 'pg'

/**
 * 隔离 schema 回放的前置条件：目标库的 public 必须先应用过迁移。
 *
 * 为什么需要这道断言：历史迁移里有四处结构自校验把表名写死在 public
 * （20260926130000_slh_bill_management、20260926131000、20260926133000、20260927100000）。
 * 隔离器把表建在 `purchase_mark_e2e_*` schema 里，这些自校验在 public 查不到就报
 * 「SLH bill tables missing」——一句看不出原因、也看不出该怎么修的错。
 * 这里提前失败，把「先在目标库跑一次 db:migrate:deploy」直接写进错误消息。
 */
const REPLAY_PRECONDITION_TABLES = ['slh_bills', 'slh_bill_lines', 'slh_bill_line_charges'] as const

/** 缺表时的错误消息；都在时返回 null。抽成纯函数便于断言文案与命令行。 */
export function resolveReplayPreconditionError(presentTables: readonly string[]): string | null {
  const present = new Set(presentTables)
  const missing = REPLAY_PRECONDITION_TABLES.filter(name => !present.has(name))
  if (missing.length === 0) {
    return null
  }
  return `Isolated replay requires the target database public schema to be migrated first (missing in public: ${missing.join(', ')}). Run: pnpm -C server db:migrate:deploy`
}

/** 只有 CI 形态的隔离库才检查：其它目标由隔离器自己以「outside isolated boundary」拒绝。 */
function isIsolatedTarget(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl)
    return (url.username === 'qianshu_ci' && url.pathname === '/qianshu_ci')
      || (url.username === 'receipt_test' && url.pathname === '/receipt_test')
  }
  catch {
    return false
  }
}

export async function assertIsolatedReplayPrecondition(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl || !isIsolatedTarget(databaseUrl)) {
    return
  }
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const { rows } = await client.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])',
      ['public', [...REPLAY_PRECONDITION_TABLES]],
    )
    const message = resolveReplayPreconditionError(rows.map(row => row.table_name))
    if (message !== null) {
      throw new Error(message)
    }
  }
  finally {
    await client.end().catch(() => undefined)
  }
}
