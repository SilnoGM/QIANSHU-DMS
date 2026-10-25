import process from 'node:process'

import {
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const BASE_COMMANDS = [
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'exec', 'prisma', 'migrate', 'status']],
]
// 媒体专属验收会占用一次性数据库，只在首个分片执行；其余分片只跑 Jest shard。
const MEDIA_COMMANDS = [
  [process.execPath, ['./scripts/ci-product-media-e2e.mjs']],
  [process.execPath, ['./scripts/ci-product-media-cutover-e2e.mjs']],
]

function parseShard(rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return undefined
  }
  const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(rawValue)
  if (match === null) {
    throw new Error('CI E2E shard is invalid')
  }
  const index = Number(match[1])
  const total = Number(match[2])
  if (index > total) {
    throw new Error('CI E2E shard is invalid')
  }
  return { index, total }
}

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
  // 分片只由当前编排消费，避免 Jest 与媒体套件看到同一变量后误判。
  delete childEnv.QIANSHU_SERVER_E2E_SHARD
  return childEnv
}

export async function runServerE2e({
  env = process.env,
  run = runCommand,
} = {}) {
  const databaseUrl = validateCiDatabaseUrl(env.DATABASE_URL)
  const shard = parseShard(env.QIANSHU_SERVER_E2E_SHARD)
  const childEnv = createSafeChildEnv(env, databaseUrl)
  // pnpm 会把 `--` 原样传给脚本，Jest 会把它之后的分片参数当成测试路径；
  // 因此分片路径直接调用 jest CLI，并显式补上 test:e2e 原有的 Prisma 生成。
  const e2eCommands = shard === undefined
    ? [['pnpm', ['-C', 'server', 'test:e2e']]]
    : [
        ['pnpm', ['-C', 'server', 'exec', 'prisma', 'generate']],
        ['pnpm', [
          '-C', 'server', 'exec', 'jest',
          '--config', 'test/jest-e2e.json',
          '--runInBand',
          `--shard=${shard.index}/${shard.total}`,
        ]],
      ]

  // 连续执行两次 deploy 用于证明 migration 可重复；公共 E2E 通过后，首个
  // 分片再在同一隔离数据库中执行媒体服务、HTTP 与 cutover 专属验收。任一
  // 步 reject 都由 await 原样向上传播，并自然阻止后续命令继续访问数据库。
  const commands = [
    ...BASE_COMMANDS,
    ...e2eCommands,
    ...(shard === undefined || shard.index === 1 ? MEDIA_COMMANDS : []),
  ]
  for (const [command, args] of commands) {
    await run(command, args, { env: childEnv })
  }
}

if (isDirectEntry(import.meta.url)) {
  runServerE2e().catch(error => applyFailureToProcess(error))
}
