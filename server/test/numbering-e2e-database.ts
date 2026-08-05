import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'

const serverRoot = resolve(__dirname, '..')
const migrationPaths = [
  '20260710152144_init',
  '20260717090000_user_auth_rbac',
  '20260720090000_user_profiles',
  '20260727090000_regions_schema_and_permissions',
  '20260727100000_regions_seed',
  '20260729090000_currency_exchange_rate_schema_and_permissions',
  '20260729100000_currency_seed',
  '20260802090000_numbering_management_schema_and_permissions',
  '20260803090000_dictionary_management_schema_and_permissions',
].map(directory => resolve(
  serverRoot,
  `prisma/migrations/${directory}/migration.sql`,
))

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for Numbering E2E tests')
  }
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^numbering_e2e_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Numbering E2E schema name is invalid')
  }
  return `"${identifier}"`
}

function withSchemaSearchPath(
  databaseUrl: string,
  schemaName: string,
): string {
  const url = new URL(databaseUrl)
  // pg 的 options 参数会在池中每条连接建立时设置 search_path，确保应用的
  // Prisma 连接和 bootstrap Client 始终命中同一个隔离 schema。
  url.searchParams.set('options', `-c search_path=${schemaName},public`)
  return url.toString()
}

export interface IsolatedNumberingDatabase {
  readonly baseDatabaseUrl: string
  readonly databaseUrl: string
  readonly schemaName: string
  dispose(): Promise<void>
}

/**
 * PrismaPg 默认把生成 SQL 限定到 public。仅设置 PostgreSQL search_path 会让
 * Prisma 生成查询与领域 raw SQL 命中两个 schema，因此 E2E 用显式 adapter
 * schema 覆盖应用 provider；这属于测试连接适配，不改变生产 PrismaService。
 */
export class IsolatedNumberingPrismaService extends PrismaClient {
  constructor(database: IsolatedNumberingDatabase) {
    const pool = new Pool({
      connectionString: database.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    })
    super({
      adapter: new PrismaPg(pool, {
        schema: database.schemaName,
        disposeExternalPool: true,
      }),
    })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}

/**
 * 编号 ledger 明确禁止物理删除，因此 API E2E 不能沿用逐表清理方案。每个 spec
 * 重放正式 migration 到独立 schema，结束时只删除经过严格格式校验的测试 schema，
 * 既验证真实 PostgreSQL 契约，也不会在共享开发库留下永久发号数据。
 */
export async function createIsolatedNumberingDatabase():
Promise<IsolatedNumberingDatabase> {
  const baseDatabaseUrl = requireDatabaseUrl()
  const schemaName = `numbering_e2e_${randomUUID().replaceAll('-', '')}`
  const quotedSchema = quoteTestSchema(schemaName)
  const bootstrap = new Client({ connectionString: baseDatabaseUrl })
  let schemaCreated = false

  await bootstrap.connect()
  try {
    await bootstrap.query(`CREATE SCHEMA ${quotedSchema}`)
    schemaCreated = true
    await bootstrap.query(`SET search_path TO ${quotedSchema}, public`)
    for (const migrationPath of migrationPaths) {
      await bootstrap.query(readFileSync(migrationPath, 'utf8'))
    }
  }
  catch (error) {
    if (schemaCreated) {
      await bootstrap.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
        .catch(() => undefined)
    }
    await bootstrap.end().catch(() => undefined)
    throw error
  }

  let disposed = false
  return {
    baseDatabaseUrl,
    databaseUrl: withSchemaSearchPath(baseDatabaseUrl, schemaName),
    schemaName,
    async dispose(): Promise<void> {
      if (disposed) {
        return
      }
      disposed = true
      try {
        await bootstrap.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
      }
      finally {
        await bootstrap.end()
      }
    },
  }
}
