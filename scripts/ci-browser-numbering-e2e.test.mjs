import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { POSTGRES_IMAGE } from './ci-postgres.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const databaseUrl =
  'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'

async function loadSubject() {
  return import('./ci-browser-numbering-e2e.mjs')
}

test('root 与 Web package 通过独立入口执行编号 Browser E2E', async () => {
  const rootManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  )
  const webManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'web/package.json'), 'utf8'),
  )

  assert.equal(
    rootManifest.scripts['ci:browser-numbering-e2e'],
    'node ./scripts/ci-postgres.mjs -- node ./scripts/ci-browser-numbering-e2e.mjs',
  )
  assert.equal(
    webManifest.scripts['test:browser:numbering'],
    'node --test --test-concurrency=1 apps/qsmds-arco/test/browser/numbering.browser.test.mjs',
  )
  assert.match(POSTGRES_IMAGE, /^postgres:16@sha256:[a-f0-9]{64}$/u)
  assert.equal('dependencies' in rootManifest, false)
  assert.equal('devDependencies' in rootManifest, false)
})

test('只接受 ci-postgres 注入的隔离编号 PostgreSQL URL', async () => {
  const { validateBrowserNumberingDatabaseUrl } = await loadSubject()
  assert.equal(validateBrowserNumberingDatabaseUrl(databaseUrl), databaseUrl)

  for (const value of [
    undefined,
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?schema=public',
    'postgresql://qianshu_ci:secret@db.example.com:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci',
  ]) {
    assert.throws(
      () => validateBrowserNumberingDatabaseUrl(value),
      {
        message:
          'Browser numbering E2E database URL is outside the isolated boundary',
      },
    )
  }
})

test('编号计划复用地区可信运行时但只执行编号 runner 与编号数据库核验', async () => {
  const { createBrowserNumberingPlan } = await loadSubject()
  const leakedDatabaseUrl
    = 'postgresql://should-not-leak:secret@127.0.0.1:59999/leak'
  const plan = createBrowserNumberingPlan({
    chromeExecutable: '/opt/google/chrome/chrome',
    databaseUrl,
    ports: {
      devProxy: 42001,
      devServer: 42002,
      prodProxy: 42003,
      prodServer: 42004,
      web: 42005,
    },
    secrets: {
      adminPassword: 'fixture-password',
      hmacKeys: ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)],
    },
    sessionDirectory: '/tmp/qianshu-browser-numbering-session',
    sourceEnv: {
      DATABASE_URL: leakedDatabaseUrl,
      PATH: process.env.PATH,
    },
  })

  assert.deepEqual(plan.prepare.map(step => step.name), [
    'database-migrations',
    'server-build',
    'web-build',
    'admin-fixture',
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
    ['pnpm', ['-C', 'web', 'test:browser:numbering']],
  )
  assert.equal(plan.verify.length, 1)
  assert.equal(plan.verify[0]?.name, 'numbering-database-verification')
  assert.equal(plan.verify[0]?.env.DATABASE_URL, databaseUrl)
  assert.deepEqual(
    [plan.verify[0]?.command, plan.verify[0]?.args.slice(0, 5)],
    ['pnpm', ['-C', 'server', 'exec', 'node', '--input-type=commonjs']],
  )

  const verificationProgram = plan.verify[0]?.args.at(-1)
  assert.match(verificationProgram, /E2E_BROWSER_SEQUENCE/u)
  assert.match(verificationProgram, /E2E_BROWSER_RANDOM/u)
  assert.match(verificationProgram, /E2E_BROWSER_MIXED/u)
  assert.match(verificationProgram, /E2E_BROWSER_CLONE/u)
  assert.match(verificationProgram, /NUMBERING_RULE_CREATED/u)
  assert.match(verificationProgram, /NUMBERING_RULE_UPDATED/u)
  assert.match(verificationProgram, /NUMBERING_RULE_VERSION_PUBLISHED/u)
  assert.match(verificationProgram, /NUMBERING_RULE_ENABLED/u)
  assert.match(verificationProgram, /NUMBERING_RULE_DISABLED/u)
  assert.match(verificationProgram, /username_normalized/u)
  assert.match(verificationProgram, /request_id/u)
  assert.doesNotMatch(verificationProgram, /test-password/u)

  const databaseConsumers = [
    ...plan.prepare.filter(step => [
      'admin-fixture',
      'database-migrations',
      'server-build',
    ].includes(step.name)),
    ...plan.services.filter(service => service.name.startsWith('server-')),
    ...plan.verify,
  ]
  assert.equal(
    databaseConsumers.every(step => step.env.DATABASE_URL === databaseUrl),
    true,
  )
  const databaseIsolatedProcesses = [
    ...plan.prepare.filter(step => [
      'tls-certificate',
      'web-build',
    ].includes(step.name)),
    ...plan.services.filter(service => !service.name.startsWith('server-')),
    plan.runner,
  ]
  assert.equal(
    databaseIsolatedProcesses.every(step => step.env.DATABASE_URL === undefined),
    true,
  )
  assert.equal(
    [...plan.prepare, ...plan.services, plan.runner, ...plan.verify]
      .some(step => step.env.DATABASE_URL === leakedDatabaseUrl),
    false,
  )
})

test('runner 失败时逆序停止服务并保留首个错误', async () => {
  const { runBrowserNumberingE2e } = await loadSubject()
  const events = []
  const expectedError = new Error('numbering browser runner exited 7')
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [
      { name: 'web' },
      { name: 'server' },
      { name: 'proxy' },
    ],
    verify: [{ name: 'numbering-database-verification' }],
  }

  await assert.rejects(
    runBrowserNumberingE2e({
      plan,
      dependencies: {
        cleanup: async () => events.push('cleanup'),
        prepare: async step => events.push(`prepare:${step.name}`),
        runRunner: async () => {
          events.push('runner')
          throw expectedError
        },
        startService: async (service) => {
          events.push(`start:${service.name}`)
          return { name: service.name }
        },
        stopService: async (handle) => {
          events.push(`stop:${handle.name}`)
          throw new Error('cleanup must not replace runner failure')
        },
        verify: async step => events.push(`verify:${step.name}`),
        waitUntilReady: async service => events.push(`ready:${service.name}`),
      },
    }),
    error => error === expectedError,
  )

  assert.deepEqual(events, [
    'prepare:prepare',
    'start:web',
    'ready:web',
    'start:server',
    'ready:server',
    'start:proxy',
    'ready:proxy',
    'runner',
    'stop:proxy',
    'stop:server',
    'stop:web',
    'cleanup',
  ])
})

test('runner 成功后先核验数据库，再逆序停止服务与清理目录', async () => {
  const { runBrowserNumberingE2e } = await loadSubject()
  const events = []
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [{ name: 'server' }],
    verify: [{ name: 'numbering-database-verification' }],
  }

  await runBrowserNumberingE2e({
    plan,
    dependencies: {
      cleanup: async () => events.push('cleanup'),
      prepare: async step => events.push(`prepare:${step.name}`),
      runRunner: async () => events.push('runner'),
      startService: async service => ({ name: service.name }),
      stopService: async handle => events.push(`stop:${handle.name}`),
      verify: async step => events.push(`verify:${step.name}`),
      waitUntilReady: async service => events.push(`ready:${service.name}`),
    },
  })

  assert.deepEqual(events, [
    'prepare:prepare',
    'ready:server',
    'runner',
    'verify:numbering-database-verification',
    'stop:server',
    'cleanup',
  ])
})
