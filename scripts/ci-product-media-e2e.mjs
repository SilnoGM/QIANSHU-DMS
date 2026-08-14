import process from 'node:process'

import {
  runCommand,
  applyFailureToProcess,
  isDirectEntry,
} from './run-command.mjs'
import { validateCiDatabaseUrl } from './ci-server-e2e.mjs'

const EXPECTED_COMMANDS = [
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'exec', 'prisma', 'migrate', 'status']],
  [
    'pnpm',
    [
      '-C',
      'server',
      'exec',
      'jest',
      '--config',
      'test/jest-e2e.json',
      '--runInBand',
      '--runTestsByPath',
      'test/product-media-service.e2e-spec.ts',
    ],
  ],
]

function createSafeChildEnv(sourceEnv, databaseUrl) {
  const childEnv = {
    ...sourceEnv,
    DATABASE_URL: databaseUrl,
    DOTENV_CONFIG_PATH: '/dev/null',
    NODE_ENV: 'test',
    PRODUCT_MEDIA_E2E_EXCLUSIVE: '1',
  }
  delete childEnv.DEBUG
  delete childEnv.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  return childEnv
}

/**
 * ProductMedia 历史关联不可删除，因此该 suite 必须独占 ci-postgres 创建的一次性数据库。
 * runner 固定 migration 重放、幂等 deploy、status 和唯一测试文件，避免污染其他 E2E。
 */
export async function runProductMediaE2e({
  env = process.env,
  run = runCommand,
} = {}) {
  const databaseUrl = validateCiDatabaseUrl(env.DATABASE_URL)
  const childEnv = createSafeChildEnv(env, databaseUrl)

  for (const [command, args] of EXPECTED_COMMANDS) {
    await run(command, args, { env: childEnv })
  }
}

if (isDirectEntry(import.meta.url)) {
  runProductMediaE2e().catch(error => applyFailureToProcess(error))
}
