import 'dotenv/config'

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDirectory, '..')
const SHADOW_DATABASE_NAME_PATTERN =
  /^qianshu_dms_shadow_[a-z0-9][a-z0-9_]{0,43}$/u

function parsePostgreSqlTarget(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`)
  }

  let url
  try {
    url = new URL(value)
  }
  catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`)
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${label} must use the PostgreSQL protocol`)
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ''))
  if (databaseName === '' || databaseName.includes('/')) {
    throw new Error(`${label} must identify exactly one database`)
  }

  return {
    databaseName,
    // PostgreSQL 的两个 URL scheme 语义相同，因此比较物理目标时统一归一化。
    identity: [
      url.hostname.toLowerCase(),
      url.port || '5432',
      databaseName,
    ].join(':'),
  }
}

/**
 * Prisma 会重置 shadow database 后重放全部 migration。这里在启动 Prisma 前实施硬边界，
 * 防止配置错误把业务数据库当成 shadow database 清空。错误信息禁止包含连接字符串。
 */
export function validateDriftDatabaseUrls({ databaseUrl, shadowDatabaseUrl }) {
  const target = parsePostgreSqlTarget(databaseUrl, 'DATABASE_URL')
  const shadow = parsePostgreSqlTarget(
    shadowDatabaseUrl,
    'SHADOW_DATABASE_URL',
  )

  if (shadow.identity === target.identity) {
    throw new Error('SHADOW_DATABASE_URL must not identify the target database')
  }
  if (!SHADOW_DATABASE_NAME_PATTERN.test(shadow.databaseName)) {
    throw new Error(
      'SHADOW_DATABASE_URL database name must match qianshu_dms_shadow_[a-z0-9_]+',
    )
  }

  return {
    shadowDatabaseName: shadow.databaseName,
    targetDatabaseName: target.databaseName,
  }
}

export function buildPrismaDiffArguments() {
  return [
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    'prisma/migrations',
    '--to-config-datasource',
    '--exit-code',
  ]
}

/**
 * 不解析、不改写 Prisma 输出和退出码：0 表示无 drift，1 表示执行错误，2 表示存在 drift。
 * 这样 raw operator class 等物理结构由 migration history 还原后直接参与数据库同构比较，
 * 同时任何未知差异都会保持 fail-closed。
 */
export function runPrismaDriftCheck({
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  validateDriftDatabaseUrls({
    databaseUrl: env.DATABASE_URL,
    shadowDatabaseUrl: env.SHADOW_DATABASE_URL,
  })

  const result = spawnSyncImpl('pnpm', buildPrismaDiffArguments(), {
    cwd: serverRoot,
    env,
    stdio: 'inherit',
  })

  if (result.error) {
    throw new Error('Failed to start Prisma drift check')
  }
  if (typeof result.status !== 'number') {
    throw new Error('Prisma drift check ended without an exit status')
  }

  return result.status
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntrypoint) {
  try {
    process.exitCode = runPrismaDriftCheck()
  }
  catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Prisma drift check failed'
    console.error(message)
    process.exitCode = 1
  }
}
