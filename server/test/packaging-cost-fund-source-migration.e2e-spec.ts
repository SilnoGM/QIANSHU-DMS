import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

const migrationsPath = resolve(__dirname, '../prisma/migrations')

function migrationDirectory(): string {
  const matches = readdirSync(migrationsPath).filter(name => name.endsWith('_packaging_cost_fund_source'))
  if (matches.length !== 1) throw new Error('Exactly one packaging cost fund source migration is required')
  return matches[0]
}

function migrationSql(): string {
  return readFileSync(resolve(migrationsPath, migrationDirectory(), 'migration.sql'), 'utf8')
}

async function withHistoricalDatabase(action: (client: Client) => Promise<void>): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  const schema = `packaging_source_${randomUUID().replaceAll('-', '')}`
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    for (const directory of readdirSync(migrationsPath).filter(name => /^\d/u.test(name) && name < migrationDirectory()).sort()) {
      await client.query(readFileSync(resolve(migrationsPath, directory, 'migration.sql'), 'utf8'))
    }
    await action(client)
  }
  finally {
    await client.query('ROLLBACK')
    await client.query('RESET search_path')
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client.end()
  }
}

// 比较整个业务库中的旧行：迁移只能增加指定来源和授权关系，不能改规则、余额或历史付款。
async function historicalSnapshot(client: Client): Promise<Record<string, unknown>> {
  const tables = await client.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name
  `)
  const snapshot: Record<string, unknown> = {}
  for (const { table_name: tableName } of tables.rows) {
    if (!/^[a-z_]+$/u.test(tableName)) throw new Error('Unexpected historical table name')
    const filter = tableName === 'fund_business_sources'
      ? "WHERE code <> 'PACKAGING_COST'"
      : tableName === 'fund_business_source_posting_types'
        ? "WHERE business_source_id NOT IN (SELECT id FROM fund_business_sources WHERE code = 'PACKAGING_COST')"
        : ''
    const result = await client.query<{ rows: unknown }>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows FROM "${tableName}" t ${filter}`)
    snapshot[tableName] = result.rows[0].rows
  }
  return snapshot
}

async function sourceBindings(client: Client): Promise<unknown[]> {
  const result = await client.query<{ code: string }>(`
    SELECT t.code FROM fund_business_source_posting_types b
    JOIN fund_business_sources s ON s.id = b.business_source_id
    JOIN fund_posting_types t ON t.id = b.posting_type_id
    WHERE s.code = 'PACKAGING_COST' ORDER BY t.code
  `)
  return result.rows
}

describe('packaging cost fund source forward migration', () => {
  jest.setTimeout(90_000)

  it('only inserts the trusted source and binding, with no schema or accounting mutations', () => {
    const sql = migrationSql().replace(/--[^\n]*/gu, '')
    expect(sql).toContain("'PACKAGING_COST'")
    expect(sql).toContain("'WOODEN_PACKING_COST'")
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/iu)
    expect([...sql.matchAll(/\bINSERT\s+INTO\s+(\w+)/giu)].map(match => match[1])).toEqual([
      'fund_business_sources', 'fund_business_source_posting_types',
    ])
  })

  it('leaves a fresh environment unbound without inventing a posting type or rules', async () => {
    await withHistoricalDatabase(async (client) => {
      const before = await historicalSnapshot(client)
      await client.query(migrationSql())
      expect((await client.query("SELECT name, enabled, version FROM fund_business_sources WHERE code = 'PACKAGING_COST'")).rows)
        .toEqual([{ name: '打木架付款', enabled: true, version: 1 }])
      expect(await sourceBindings(client)).toEqual([])
      expect((await client.query("SELECT count(*)::integer AS count FROM fund_posting_types WHERE code = 'WOODEN_PACKING_COST'")).rows)
        .toEqual([{ count: 0 }])
      expect(await historicalSnapshot(client)).toEqual(before)
    })
  })

  it.each([true, false])('binds the existing type while preserving enabled=%s and its exact active rule', async (enabled) => {
    await withHistoricalDatabase(async (client) => {
      const typeId = randomUUID()
      const ruleId = randomUUID()
      await client.query(`INSERT INTO fund_posting_types (id, code, name, description, business_category, requires_user, amount_sign_policy, input_mode, enabled, version)
        VALUES ($1, 'WOODEN_PACKING_COST', '已配置包装费用', '保留本地业务设置', 'COST', true, 'POSITIVE_ONLY', 'STANDARD', $2, 7)`, [typeId, enabled])
      await client.query(`INSERT INTO fund_posting_rule_versions (id, posting_type_id, revision, status) VALUES ($1, $2, 3, 'DRAFT')`, [ruleId, typeId])
      await client.query(`INSERT INTO fund_posting_rule_legs (rule_version_id, position, account_target, direction_policy, amount_strategy)
        VALUES ($1, 1, 'USER', 'DEBIT', 'USER_SHARE'), ($1, 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER')`, [ruleId])
      await client.query("UPDATE fund_posting_rule_versions SET status = 'ACTIVE', published_at = CURRENT_TIMESTAMP WHERE id = $1", [ruleId])
      await client.query('UPDATE fund_posting_types SET current_rule_version_id = $1 WHERE id = $2', [ruleId, typeId])
      const before = await historicalSnapshot(client)
      await client.query(migrationSql())
      expect(await sourceBindings(client)).toEqual([{ code: 'WOODEN_PACKING_COST' }])
      expect(await historicalSnapshot(client)).toEqual(before)
    })
  })

  it('rejects a pre-existing source without overwriting or extending its configuration', async () => {
    await withHistoricalDatabase(async (client) => {
      await client.query("INSERT INTO fund_business_sources (code, name, enabled, version) VALUES ('PACKAGING_COST', '预先配置来源', false, 5)")
      const before = await client.query("SELECT to_jsonb(s) AS source FROM fund_business_sources s WHERE code = 'PACKAGING_COST'")
      await expect(client.query(migrationSql())).rejects.toMatchObject({ code: '23505' })
      await client.query('ROLLBACK')
      expect((await client.query("SELECT to_jsonb(s) AS source FROM fund_business_sources s WHERE code = 'PACKAGING_COST'")).rows).toEqual(before.rows)
      expect(await sourceBindings(client)).toEqual([])
    })
  })
})
