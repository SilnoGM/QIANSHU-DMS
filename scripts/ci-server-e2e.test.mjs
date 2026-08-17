import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  runServerE2e,
  validateCiDatabaseUrl,
} from './ci-server-e2e.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const entrypoint = path.join(scriptsDirectory, 'ci-server-e2e.mjs')
const databaseUrl =
  'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'
const expectedCommands = [
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'exec', 'prisma', 'migrate', 'status']],
  ['pnpm', ['-C', 'server', 'test:e2e']],
  [process.execPath, ['./scripts/ci-product-media-e2e.mjs']],
  [process.execPath, ['./scripts/ci-product-media-cutover-e2e.mjs']],
]

test('URL 守卫接受 127.0.0.1 与 localhost 的精确 CI 数据库', () => {
  for (const value of [
    databaseUrl,
    'postgres://qianshu_ci:another-password@localhost:1/qianshu_ci?schema=public',
  ]) {
    assert.equal(validateCiDatabaseUrl(value), new URL(value).toString())
  }
})

test('URL 守卫区分 required、invalid 且不回显原始输入', () => {
  for (const value of [undefined, null, 42]) {
    assert.throws(
      () => validateCiDatabaseUrl(value),
      { message: 'CI database URL is required' },
    )
  }

  const invalidValue = 'not-a-url-with-secret'
  assert.throws(
    () => validateCiDatabaseUrl(invalidValue),
    (error) => {
      assert.equal(error.message, 'CI database URL is invalid')
      assert.equal(error.message.includes(invalidValue), false)
      return true
    },
  )
})

test('URL 守卫拒绝隔离边界外的协议、凭据、主机、路径和参数', () => {
  const unsafeValues = [
    'postgresql://qianshu_ci@127.0.0.1:54321/qianshu_ci?schema=public',
    'mysql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public',
    'postgresql://other:test-password@127.0.0.1:54321/qianshu_ci?schema=public',
    'postgresql://other%40qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:test-password@db.example.com:54321/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:test-password@127.0.0.1/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:test-password@127.0.0.1:54321/development?schema=public',
    'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=private',
    'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public&sslmode=disable',
    'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public&schema=public',
    'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public#fragment',
  ]

  for (const value of unsafeValues) {
    assert.throws(
      () => validateCiDatabaseUrl(value),
      { message: 'CI database URL is outside the isolated boundary' },
    )
  }
})

test('Server E2E 固定执行公共与媒体专属验收并复用唯一安全 child env', async () => {
  const sourceEnv = {
    DATABASE_URL: databaseUrl,
    DEBUG: 'unsafe-debug',
    DOTENV_CONFIG_PATH: '/tmp/unsafe.env',
    NODE_ENV: 'production',
    PATH: '/usr/bin',
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
    QIANSHU_SAFE_VALUE: 'preserved',
  }
  const originalEnv = { ...sourceEnv }
  const calls = []

  await runServerE2e({
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
  assert.notEqual(childEnv, sourceEnv)
  assert.ok(calls.every(call => call.options.env === childEnv))
  assert.equal(childEnv.DATABASE_URL, new URL(databaseUrl).toString())
  assert.equal(childEnv.NODE_ENV, 'test')
  assert.equal(childEnv.DOTENV_CONFIG_PATH, '/dev/null')
  assert.equal(childEnv.QIANSHU_SAFE_VALUE, 'preserved')
  assert.equal(Object.hasOwn(childEnv, 'DEBUG'), false)
  assert.equal(
    Object.hasOwn(childEnv, 'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION'),
    false,
  )
  assert.deepEqual(sourceEnv, originalEnv)
})

test('任一 migration、status 或 E2E 失败后立即短路并保留原错误', async () => {
  for (let failureIndex = 0; failureIndex < expectedCommands.length; failureIndex += 1) {
    const failure = Object.assign(new Error('safe test failure'), {
      exitCode: failureIndex + 2,
    })
    const calls = []

    await assert.rejects(
      runServerE2e({
        env: { DATABASE_URL: databaseUrl },
        async run(command, args, options) {
          calls.push({ args, command, options })
          if (calls.length - 1 === failureIndex) {
            throw failure
          }
        },
      }),
      error => error === failure,
    )
    assert.deepEqual(
      calls.map(({ command, args }) => [command, args]),
      expectedCommands.slice(0, failureIndex + 1),
    )
  }
})

test('非法 DATABASE_URL 在任何 child 命令前失败', async () => {
  const calls = []

  await assert.rejects(
    runServerE2e({
      env: {
        DATABASE_URL:
          'postgresql://qianshu_ci:test-password@remote.example.com:5432/qianshu_ci?schema=public',
      },
      async run(...args) {
        calls.push(args)
      },
    }),
    { message: 'CI database URL is outside the isolated boundary' },
  )
  assert.deepEqual(calls, [])
})

test('CLI 使用安全 URL 启动编排且 pnpm 缺失时不泄露连接串', () => {
  const result = spawnSync(process.execPath, [entrypoint], {
    encoding: 'utf8',
    env: {
      DATABASE_URL: databaseUrl,
      PATH: '/qianshu-path-that-does-not-exist',
    },
  })

  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Command failed to start: pnpm\n')
  assert.equal(result.stderr.includes(databaseUrl), false)
})
