import assert from 'node:assert/strict'
import test from 'node:test'

import { runProductMediaE2e } from './ci-product-media-e2e.mjs'

const databaseUrl =
  'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'
const expectedCommands = [
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

test('ProductMedia E2E 使用独占门禁执行固定 migration 与单 suite', async () => {
  const calls = []
  const sourceEnv = {
    DATABASE_URL: databaseUrl,
    DEBUG: 'unsafe-debug',
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
    QIANSHU_SAFE_VALUE: 'preserved',
  }

  await runProductMediaE2e({
    env: sourceEnv,
    async run(command, args, options) {
      calls.push({ args, command, options })
    },
  })

  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    expectedCommands,
  )
  const childEnv = calls[0].options.env
  assert.ok(calls.every(call => call.options.env === childEnv))
  assert.equal(childEnv.DATABASE_URL, new URL(databaseUrl).toString())
  assert.equal(childEnv.DOTENV_CONFIG_PATH, '/dev/null')
  assert.equal(childEnv.NODE_ENV, 'test')
  assert.equal(childEnv.PRODUCT_MEDIA_E2E_EXCLUSIVE, '1')
  assert.equal(childEnv.QIANSHU_SAFE_VALUE, 'preserved')
  assert.equal(Object.hasOwn(childEnv, 'DEBUG'), false)
  assert.equal(
    Object.hasOwn(childEnv, 'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION'),
    false,
  )
})

test('ProductMedia E2E 任一步失败后短路且非法数据库不启动 child', async () => {
  for (let failureIndex = 0; failureIndex < expectedCommands.length; failureIndex += 1) {
    const failure = new Error('safe test failure')
    const calls = []
    await assert.rejects(
      runProductMediaE2e({
        env: { DATABASE_URL: databaseUrl },
        async run(command, args) {
          calls.push([command, args])
          if (calls.length - 1 === failureIndex) throw failure
        },
      }),
      error => error === failure,
    )
    assert.deepEqual(calls, expectedCommands.slice(0, failureIndex + 1))
  }

  const unsafeCalls = []
  await assert.rejects(
    runProductMediaE2e({
      env: {
        DATABASE_URL:
          'postgresql://qianshu_ci:secret@remote.example.com:5432/qianshu_ci?schema=public',
      },
      async run(...args) {
        unsafeCalls.push(args)
      },
    }),
    { message: 'CI database URL is outside the isolated boundary' },
  )
  assert.deepEqual(unsafeCalls, [])
})
