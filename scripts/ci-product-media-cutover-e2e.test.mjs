import assert from 'node:assert/strict'
import test from 'node:test'

import { runProductMediaCutoverE2e } from './ci-product-media-cutover-e2e.mjs'

const databaseUrl =
  'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'
const expectedCommand = [
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

test('Product media cutover E2E 只在独占门禁执行固定 suite', async () => {
  const calls = []
  await runProductMediaCutoverE2e({
    env: {
      DATABASE_URL: databaseUrl,
      DEBUG: 'unsafe-debug',
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
      QIANSHU_SAFE_VALUE: 'preserved',
    },
    async run(command, args, options) {
      calls.push({ args, command, options })
    },
  })

  assert.deepEqual(calls.map(({ command, args }) => [command, args]), [
    expectedCommand,
  ])
  const childEnv = calls[0].options.env
  assert.equal(childEnv.DATABASE_URL, new URL(databaseUrl).toString())
  assert.equal(childEnv.DOTENV_CONFIG_PATH, '/dev/null')
  assert.equal(childEnv.NODE_ENV, 'test')
  assert.equal(childEnv.PRODUCT_MEDIA_CUTOVER_E2E_EXCLUSIVE, '1')
  assert.equal(childEnv.QIANSHU_SAFE_VALUE, 'preserved')
  assert.equal(Object.hasOwn(childEnv, 'DEBUG'), false)
  assert.equal(
    Object.hasOwn(childEnv, 'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION'),
    false,
  )
})

test('Product media cutover E2E 拒绝非隔离数据库且不启动 child', async () => {
  const calls = []
  await assert.rejects(
    runProductMediaCutoverE2e({
      env: {
        DATABASE_URL:
          'postgresql://qianshu_ci:secret@remote.example.com:5432/qianshu_ci?schema=public',
      },
      async run(...args) {
        calls.push(args)
      },
    }),
    { message: 'CI database URL is outside the isolated boundary' },
  )
  assert.deepEqual(calls, [])
})
