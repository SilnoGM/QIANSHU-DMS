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
].map(directory => resolve(
  serverRoot,
  `prisma/migrations/${directory}/migration.sql`,
))

/**
 * 字典 API E2E 会创建 Trigger 禁止删除的业务行，因此只允许连接根脚本创建的
 * 一次性 CI PostgreSQL。校验失败统一返回固定消息，绝不回显可能含密码的 URL。
 */
function requireCiDatabaseUrl(): string {
  const rawValue = process.env.DATABASE_URL
  if (typeof rawValue !== 'string') {
    throw new Error('Dictionary E2E CI database URL is required')
  }

  let url: URL
  try {
    url = new URL(rawValue)
  }
  catch {
    throw new Error('Dictionary E2E CI database URL is invalid')
  }

  const port = Number.parseInt(url.port, 10)
  const query = [...url.searchParams.entries()]
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || url.username !== 'qianshu_ci'
    || url.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !/^\d{1,5}$/u.test(url.port)
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || url.pathname !== '/qianshu_ci'
    || url.hash !== ''
    || JSON.stringify(query) !== JSON.stringify([['schema', 'public']])
  ) {
    throw new Error('Dictionary E2E database URL is outside CI boundary')
  }

  return url.toString()
}

function quoteTestSchema(identifier: string): string {
  if (!/^dictionary_e2e_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Dictionary E2E schema name is invalid')
  }
  return `"${identifier}"`
}

function withSchemaSearchPath(
  databaseUrl: string,
  schemaName: string,
): string {
  const url = new URL(databaseUrl)
  // 每条 pg 连接都固定到随机 schema；Prisma adapter 还会再显式指定同一 schema。
  url.searchParams.set('options', `-c search_path=${schemaName},public`)
  return url.toString()
}

export interface IsolatedDictionaryDatabase {
  readonly databaseUrl: string
  readonly schemaName: string
  dispose(): Promise<void>
}

/**
 * PrismaPg 会为生成 SQL显式限定 schema，不能只依赖 search_path。测试 provider
 * 因而使用独立连接池和显式 schema，并在 Nest 关闭时释放全部连接。
 */
export class IsolatedDictionaryPrismaService extends PrismaClient {
  constructor(database: IsolatedDictionaryDatabase) {
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
 * 在严格校验的 CI 数据库中新建随机 schema，按正式顺序重放全部 migration。
 * 任一步失败都会回收已创建 schema；dispose 具备幂等性且只删除本 helper 创建、
 * 通过固定格式校验的目标，不能扩大到 public、数据库或其他测试 schema。
 */
export async function createIsolatedDictionaryDatabase():
Promise<IsolatedDictionaryDatabase> {
  const baseDatabaseUrl = requireCiDatabaseUrl()
  const schemaName = `dictionary_e2e_${randomUUID().replaceAll('-', '')}`
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
