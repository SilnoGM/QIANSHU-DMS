import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { Client, Pool } from 'pg'

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
  '20260805090000_supplier_management_schema_and_permissions',
].map(directory => resolve(
  serverRoot,
  `prisma/migrations/${directory}/migration.sql`,
))

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for Supplier E2E tests')
  }
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^supplier_e2e_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Supplier E2E schema name is invalid')
  }
  return `"${identifier}"`
}

function withSchemaSearchPath(
  databaseUrl: string,
  schemaName: string,
): string {
  const url = new URL(databaseUrl)
  // pg 的 options 会为池中的每个连接固定 search_path，避免并发 API 请求逃逸
  // 到共享开发 schema。
  url.searchParams.set('options', `-c search_path=${schemaName},public`)
  return url.toString()
}

export interface IsolatedSupplierDatabase {
  readonly baseDatabaseUrl: string
  readonly databaseUrl: string
  readonly schemaName: string
  dispose(): Promise<void>
}

/**
 * PrismaPg 需要显式 adapter schema 才能让生成查询与领域 raw SQL 命中同一隔离
 * schema。该 provider 只供 Supplier E2E 使用，不改变生产 PrismaService。
 */
export class IsolatedSupplierPrismaService extends PrismaClient {
  constructor(database: IsolatedSupplierDatabase) {
    const pool = new Pool({
      connectionString: database.databaseUrl,
      max: 16,
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
 * Supplier 创建会留下不可删除的 intent 和 Numbering ledger，因此本测试按 spec
 * 重放正式 migration 到随机 schema；结束时只删除经过格式校验的该 schema。
 */
export async function createIsolatedSupplierDatabase():
Promise<IsolatedSupplierDatabase> {
  const baseDatabaseUrl = requireDatabaseUrl()
  const schemaName = `supplier_e2e_${randomUUID().replaceAll('-', '')}`
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
