import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createBrowserFundAccountsPlan,
  createBrowserFundAccountsSensitiveValues,
  runBrowserFundAccountsE2e,
  validateBrowserFundAccountsDatabaseUrl,
} from './ci-browser-fund-accounts-e2e.mjs'
import { POSTGRES_IMAGE } from './ci-postgres.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const databaseUrl
  = 'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'

test('根入口只通过固定 PostgreSQL 16 生命周期执行资金账户 Browser E2E', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  )

  assert.equal(
    manifest.scripts['ci:browser-fund-accounts-e2e'],
    'node ./scripts/ci-postgres.mjs -- node ./scripts/ci-browser-fund-accounts-e2e.mjs',
  )
  assert.match(POSTGRES_IMAGE, /^postgres:16@sha256:[a-f0-9]{64}$/u)
  assert.equal('dependencies' in manifest, false)
  assert.equal('devDependencies' in manifest, false)
})

test('资金账户 Browser runner 只接受 ci-postgres 注入的隔离数据库', () => {
  assert.equal(validateBrowserFundAccountsDatabaseUrl(databaseUrl), databaseUrl)

  for (const value of [
    undefined,
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?schema=public',
    'postgresql://qianshu_ci:secret@db.example.com:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci',
  ]) {
    assert.throws(
      () => validateBrowserFundAccountsDatabaseUrl(value),
      {
        message:
          'Browser fund accounts E2E database URL is outside the isolated boundary',
      },
    )
  }
})

test('计划固定迁移、真实构建、认证与资金 fixture、双环境服务和最终数据库核验', () => {
  const plan = createBrowserFundAccountsPlan({
    chromeExecutable: '/opt/google/chrome/chrome',
    databaseUrl,
    ports: {
      devProxy: 41001,
      devServer: 41002,
      prodProxy: 41003,
      prodServer: 41004,
      web: 41005,
    },
    secrets: {
      adminPassword: 'fixture-password',
      hmacKeys: ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)],
      limitedPassword: 'limited-fixture-password',
    },
    sessionDirectory: '/tmp/qianshu-browser-fund-accounts-session',
  })

  assert.deepEqual(plan.prepare.map(step => step.name), [
    'database-migrations',
    'server-build',
    'web-build',
    'admin-fixture',
    'fund-accounts-fixture',
    'tls-certificate',
  ])
  assert.deepEqual(plan.services.map(service => service.name), [
    'web',
    'server-development',
    'server-production',
    'proxy-development',
    'proxy-production',
  ])
  assert.deepEqual(
    [plan.runner.command, plan.runner.args],
    ['pnpm', ['-C', 'web', 'test:browser:fund-accounts']],
  )
  assert.equal(plan.verify.length, 1)
  assert.equal(plan.verify[0]?.name, 'fund-accounts-database-verification')
  assert.equal(plan.verify[0]?.env.DATABASE_URL, databaseUrl)
  assert.equal(plan.runner.env.DATABASE_URL, undefined)
  assert.equal(
    plan.runner.env.QIANSHU_BROWSER_FUND_LIMITED_PASSWORD,
    'limited-fixture-password',
  )
  assert.equal(
    plan.prepare.find(step => step.name === 'fund-accounts-fixture')
      ?.env.QIANSHU_BROWSER_FUND_LIMITED_PASSWORD,
    'limited-fixture-password',
  )
  assert.deepEqual(
    [
      plan.prepare.find(step => step.name === 'fund-accounts-fixture')?.command,
      plan.prepare.find(step => step.name === 'fund-accounts-fixture')?.args,
    ],
    [
      process.execPath,
      ['./scripts/browser-fund-accounts/provision-fixture.mjs'],
    ],
  )
})

test('敏感值集合覆盖数据库与两类登录凭据且保持冻结', () => {
  const values = createBrowserFundAccountsSensitiveValues(databaseUrl, {
    adminPassword: 'admin-secret',
    hmacKeys: ['hmac-a', 'hmac-b', 'hmac-c'],
    limitedPassword: 'limited-secret',
  })
  assert.deepEqual(values, [
    databaseUrl,
    'test-password',
    'admin-secret',
    'limited-secret',
    'hmac-a',
    'hmac-b',
    'hmac-c',
  ])
  assert.equal(Object.isFrozen(values), true)
})

test('Browser 生命周期成功后才核验数据库，并始终逆序停止服务', async () => {
  const events = []
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [{ name: 'web' }, { name: 'server' }],
    verify: [{ name: 'verify' }],
  }

  await runBrowserFundAccountsE2e({
    plan,
    dependencies: {
      cleanup: async () => events.push('cleanup'),
      prepare: async step => events.push(`prepare:${step.name}`),
      runRunner: async step => events.push(`runner:${step.name}`),
      startService: async step => {
        events.push(`start:${step.name}`)
        return step.name
      },
      stopService: async handle => events.push(`stop:${handle}`),
      verify: async step => events.push(`verify:${step.name}`),
      waitUntilReady: async step => events.push(`ready:${step.name}`),
    },
  })

  assert.deepEqual(events, [
    'prepare:prepare',
    'start:web',
    'ready:web',
    'start:server',
    'ready:server',
    'runner:runner',
    'verify:verify',
    'stop:server',
    'stop:web',
    'cleanup',
  ])
})
