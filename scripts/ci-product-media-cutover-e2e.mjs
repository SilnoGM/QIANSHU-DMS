import process from 'node:process'

import {
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'
import { validateCiDatabaseUrl } from './ci-server-e2e.mjs'

const EXPECTED_COMMAND = [
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
    'test/product-media-cutover.e2e-spec.ts',
  ],
]

function createSafeChildEnv(sourceEnv, databaseUrl) {
  const childEnv = {
    ...sourceEnv,
    DATABASE_URL: databaseUrl,
    DOTENV_CONFIG_PATH: '/dev/null',
    NODE_ENV: 'test',
    PRODUCT_MEDIA_CUTOVER_E2E_EXCLUSIVE: '1',
  }
  delete childEnv.DEBUG
  delete childEnv.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  return childEnv
}

/** 只在 ci-postgres 创建的一次性数据库内执行会反复 DROP/恢复旧列的 migration 演练。 */
export async function runProductMediaCutoverE2e({
  env = process.env,
  run = runCommand,
} = {}) {
  const databaseUrl = validateCiDatabaseUrl(env.DATABASE_URL)
  const childEnv = createSafeChildEnv(env, databaseUrl)
  await run(EXPECTED_COMMAND[0], EXPECTED_COMMAND[1], { env: childEnv })
}

if (isDirectEntry(import.meta.url)) {
  runProductMediaCutoverE2e().catch(error => applyFailureToProcess(error))
}
