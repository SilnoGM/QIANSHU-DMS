import process from 'node:process'

import {
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const EXPECTED_COMMANDS = [
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'exec', 'prisma', 'migrate', 'status']],
  ['pnpm', ['-C', 'server', 'test:e2e']],
  [process.execPath, ['./scripts/ci-product-media-e2e.mjs']],
  [process.execPath, ['./scripts/ci-product-media-cutover-e2e.mjs']],
]

export function validateCiDatabaseUrl(rawValue) {
  if (typeof rawValue !== 'string') {
    throw new Error('CI database URL is required')
  }

  let url
  try {
    url = new URL(rawValue)
  } catch {
    // URL 可能包含数据库凭据，因此解析错误只返回固定消息。
    throw new Error('CI database URL is invalid')
  }

  const query = [...url.searchParams.entries()]
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || url.username !== 'qianshu_ci'
    || url.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !/^\d{1,5}$/u.test(url.port)
    || url.pathname !== '/qianshu_ci'
    || url.hash !== ''
    || JSON.stringify(query) !== JSON.stringify([['schema', 'public']])
  ) {
    throw new Error('CI database URL is outside the isolated boundary')
  }
  return url.toString()
}

function createSafeChildEnv(sourceEnv, databaseUrl) {
  const childEnv = {
    ...sourceEnv,
    DATABASE_URL: databaseUrl,
    DOTENV_CONFIG_PATH: '/dev/null',
    NODE_ENV: 'test',
  }

  // CI 子进程只保留必要环境；调试开关和 Prisma 危险操作授权不得跨边界继承。
  delete childEnv.DEBUG
  delete childEnv.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  return childEnv
}

export async function runServerE2e({
  env = process.env,
  run = runCommand,
} = {}) {
  const databaseUrl = validateCiDatabaseUrl(env.DATABASE_URL)
  const childEnv = createSafeChildEnv(env, databaseUrl)

  // 连续执行两次 deploy 用于证明 migration 可重复；公共 E2E 通过后，再在
  // 同一隔离数据库中执行媒体服务、HTTP 与 cutover 专属验收。任一步 reject
  // 都由 await 原样向上传播，并自然阻止后续命令继续访问数据库。
  for (const [command, args] of EXPECTED_COMMANDS) {
    await run(command, args, { env: childEnv })
  }
}

if (isDirectEntry(import.meta.url)) {
  runServerE2e().catch(error => applyFailureToProcess(error))
}
