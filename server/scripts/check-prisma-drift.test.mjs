import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildPrismaDiffArguments,
  runPrismaDriftCheck,
  validateDriftDatabaseUrls,
} from './check-prisma-drift.mjs'

const TARGET_DATABASE_URL =
  'postgresql://target_user:target_password@127.0.0.1:15433/qianshu_dms_dev?schema=public'
const SHADOW_DATABASE_URL =
  'postgresql://shadow_user:shadow_password@127.0.0.1:15433/qianshu_dms_shadow_task_18_1b?schema=public'

test('accepts an explicitly isolated and name-bounded shadow database', () => {
  assert.deepEqual(
    validateDriftDatabaseUrls({
      databaseUrl: TARGET_DATABASE_URL,
      shadowDatabaseUrl: SHADOW_DATABASE_URL,
    }),
    {
      shadowDatabaseName: 'qianshu_dms_shadow_task_18_1b',
      targetDatabaseName: 'qianshu_dms_dev',
    },
  )
})

test('rejects the target database itself even when credentials and query differ', () => {
  assert.throws(
    () => validateDriftDatabaseUrls({
      databaseUrl: TARGET_DATABASE_URL,
      shadowDatabaseUrl:
        'postgresql://other:secret@127.0.0.1:15433/qianshu_dms_dev?schema=shadow',
    }),
    /must not identify the target database/u,
  )
})

test('rejects an unbounded shadow database name', () => {
  assert.throws(
    () => validateDriftDatabaseUrls({
      databaseUrl: TARGET_DATABASE_URL,
      shadowDatabaseUrl:
        'postgresql://other:secret@127.0.0.1:15433/postgres',
    }),
    /must match/u,
  )
})

test('uses migration history as the physical drift truth source', () => {
  assert.deepEqual(buildPrismaDiffArguments(), [
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    'prisma/migrations',
    '--to-config-datasource',
    '--exit-code',
  ])
})

test('wires the guarded wrapper into package scripts and Prisma config', () => {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const prismaConfig = readFileSync(
    new URL('../prisma.config.ts', import.meta.url),
    'utf8',
  )
  const driftScript = readFileSync(
    new URL('./check-prisma-drift.mjs', import.meta.url),
    'utf8',
  )

  assert.equal(
    packageJson.scripts['prisma:drift:check'],
    'pnpm prisma:validate && node scripts/check-prisma-drift.mjs',
  )
  assert.match(
    prismaConfig,
    /shadowDatabaseUrl:\s*process\.env\.SHADOW_DATABASE_URL\s*\|\|\s*undefined/u,
  )
  assert.match(driftScript, /^import 'dotenv\/config'$/mu)
})

test('propagates Prisma non-zero drift status without masking it', () => {
  const calls = []
  const status = runPrismaDriftCheck({
    env: {
      DATABASE_URL: TARGET_DATABASE_URL,
      SHADOW_DATABASE_URL,
    },
    spawnSyncImpl(command, arguments_, options) {
      calls.push({ arguments_, command, options })
      return { status: 2 }
    },
  })

  assert.equal(status, 2)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'pnpm')
  assert.deepEqual(calls[0].arguments_, buildPrismaDiffArguments())
  assert.equal(calls[0].options.stdio, 'inherit')
})
