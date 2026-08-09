import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { POSTGRES_IMAGE } from './ci-postgres.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const databaseUrl
  = 'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'

async function loadSubject() {
  return import('./ci-browser-dictionaries-e2e.mjs')
}

test('Root 与 Web package 通过独立入口执行字典 Browser E2E', async () => {
  const rootManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  )
  const webManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'web/package.json'), 'utf8'),
  )

  assert.equal(
    rootManifest.scripts['ci:browser-dictionaries-e2e'],
    'node ./scripts/ci-postgres.mjs -- node ./scripts/ci-browser-dictionaries-e2e.mjs',
  )
  assert.equal(
    webManifest.scripts['test:browser:dictionaries'],
    'node --test --test-concurrency=1 apps/qsmds-arco/test/browser/dictionaries.browser.test.mjs',
  )
  assert.match(POSTGRES_IMAGE, /^postgres:16@sha256:[a-f0-9]{64}$/u)
  assert.equal('dependencies' in rootManifest, false)
  assert.equal('devDependencies' in rootManifest, false)
})

test('生产入口保持无参字典边界且不接受业务场景工厂注入', async () => {
  const source = await readFile(
    path.join(repositoryRoot, 'scripts/ci-browser-dictionaries-e2e.mjs'),
    'utf8',
  )

  assert.match(
    source,
    /export async function runProductionBrowserDictionariesE2e\(\) \{/u,
  )
  for (const retiredOption of [
    'databaseValidator',
    'planFactory',
    'sensitiveValuesFactory',
    'sessionPrefix',
  ]) {
    assert.equal(
      source.includes(retiredOption),
      false,
      `字典生产入口不得保留 ${retiredOption} 注入点`,
    )
  }
})

test('只接受 ci-postgres 注入的隔离字典 PostgreSQL URL', async () => {
  const { validateBrowserDictionariesDatabaseUrl } = await loadSubject()
  assert.equal(validateBrowserDictionariesDatabaseUrl(databaseUrl), databaseUrl)

  for (const value of [
    undefined,
    'mysql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci@127.0.0.1:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:secret@127.0.0.1/qianshu_ci?schema=public',
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?schema=public',
    'postgresql://qianshu_ci:secret@db.example.com:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci?schema=public&sslmode=disable',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci?schema=public#fragment',
  ]) {
    assert.throws(
      () => validateBrowserDictionariesDatabaseUrl(value),
      {
        message:
          'Browser dictionaries E2E database URL is outside the isolated boundary',
      },
    )
  }
})

test('字典计划复用可信 Browser 运行时并精确核验业务状态与八类 Audit', async () => {
  const { createBrowserDictionariesPlan } = await loadSubject()
  const leakedDatabaseUrl
    = 'postgresql://should-not-leak:secret@127.0.0.1:59999/leak'
  const plan = createBrowserDictionariesPlan({
    chromeExecutable: '/opt/google/chrome/chrome',
    databaseUrl,
    ports: {
      devProxy: 43001,
      devServer: 43002,
      prodProxy: 43003,
      prodServer: 43004,
      web: 43005,
    },
    secrets: {
      adminPassword: 'fixture-password',
      hmacKeys: ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)],
      limitedPassword: 'limited-fixture-password',
    },
    sessionDirectory: '/tmp/qianshu-browser-dictionaries-session',
    sourceEnv: {
      AUTH_IP_HMAC_KEY: 'leaked-ip-hmac',
      AUTH_USER_ID_HMAC_KEY: 'leaked-user-id-hmac',
      AUTH_USERNAME_HMAC_KEY: 'leaked-username-hmac',
      DATABASE_URL: leakedDatabaseUrl,
      PATH: process.env.PATH,
      QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: 'leaked-admin-password',
      QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD:
        'leaked-limited-password',
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
    ['pnpm', ['-C', 'web', 'test:browser:dictionaries']],
  )
  assert.equal(
    plan.runner.env.QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD,
    'limited-fixture-password',
  )
  assert.equal(plan.runner.env.DATABASE_URL, undefined)
  assert.equal(plan.verify.length, 1)
  assert.equal(plan.verify[0]?.name, 'dictionaries-database-verification')
  assert.equal(plan.verify[0]?.env.DATABASE_URL, databaseUrl)

  const verificationProgram = plan.verify[0]?.args.at(-1)
  assert.match(verificationProgram, /E2E_BROWSER_DICTIONARY/u)
  assert.match(verificationProgram, /e2e\.browser_dictionary/u)
  assert.match(verificationProgram, /E2E_PRIMARY/u)
  assert.match(verificationProgram, /E2E_SECONDARY/u)
  assert.match(verificationProgram, /浏览器字典已编辑/u)
  assert.match(verificationProgram, /主要条目已编辑/u)
  assert.match(verificationProgram, /次要条目/u)
  for (const event of [
    'DICTIONARY_TYPE_CREATED',
    'DICTIONARY_TYPE_UPDATED',
    'DICTIONARY_TYPE_ENABLED',
    'DICTIONARY_TYPE_DISABLED',
    'DICTIONARY_ITEM_CREATED',
    'DICTIONARY_ITEM_UPDATED',
    'DICTIONARY_ITEM_ENABLED',
    'DICTIONARY_ITEM_DISABLED',
  ]) {
    assert.match(verificationProgram, new RegExp(event, 'u'))
  }
  assert.match(verificationProgram, /dictionaryCode/u)
  assert.match(verificationProgram, /itemValue/u)
  assert.match(verificationProgram, /changedFields/u)
  assert.match(verificationProgram, /request_id/u)
  assert.doesNotMatch(verificationProgram, /test-password/u)

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
  assert.equal(
    [...plan.prepare, ...plan.services, ...plan.verify]
      .every(step => (
        step.env.QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD === undefined
      )),
    true,
  )

  const allSteps = [
    ...plan.prepare,
    ...plan.services,
    plan.runner,
    ...plan.verify,
  ]
  for (const leakedValue of [
    'leaked-admin-password',
    'leaked-ip-hmac',
    'leaked-limited-password',
    'leaked-user-id-hmac',
    'leaked-username-hmac',
  ]) {
    assert.equal(
      allSteps.some(step => Object.values(step.env).includes(leakedValue)),
      false,
    )
  }

  const adminFixture = plan.prepare.find(step => step.name === 'admin-fixture')
  assert.equal(
    adminFixture?.env.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD,
    'fixture-password',
  )
  assert.equal(
    plan.runner.env.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD,
    'fixture-password',
  )
  assert.equal(
    allSteps.filter(step => step !== adminFixture && step !== plan.runner)
      .every(step => (
        step.env.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD === undefined
      )),
    true,
  )

  const serverServices = plan.services.filter(
    service => service.name.startsWith('server-'),
  )
  assert.equal(serverServices.length, 2)
  for (const service of serverServices) {
    assert.deepEqual(
      [
        service.env.AUTH_USERNAME_HMAC_KEY,
        service.env.AUTH_USER_ID_HMAC_KEY,
        service.env.AUTH_IP_HMAC_KEY,
      ],
      ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)],
    )
  }
  assert.equal(
    allSteps.filter(step => !serverServices.includes(step)).every(step => (
      step.env.AUTH_USERNAME_HMAC_KEY === undefined
      && step.env.AUTH_USER_ID_HMAC_KEY === undefined
      && step.env.AUTH_IP_HMAC_KEY === undefined
    )),
    true,
  )
})

test('外层日志脱敏覆盖字典 Browser 的全部临时凭据', async () => {
  const { createBrowserDictionariesSensitiveValues } = await loadSubject()
  const secrets = {
    adminPassword: 'fixture-password',
    hmacKeys: ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)],
    limitedPassword: 'limited-fixture-password',
  }
  assert.deepEqual(
    createBrowserDictionariesSensitiveValues(databaseUrl, secrets),
    [
      databaseUrl,
      'test-password',
      secrets.adminPassword,
      secrets.limitedPassword,
      ...secrets.hmacKeys,
    ],
  )
})

test('runner 失败时逆序停止服务并保留首个错误', async () => {
  const { runBrowserDictionariesE2e } = await loadSubject()
  const events = []
  const expectedError = new Error('dictionary browser runner exited 7')
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [{ name: 'web' }, { name: 'server' }, { name: 'proxy' }],
    verify: [{ name: 'dictionaries-database-verification' }],
  }

  await assert.rejects(runBrowserDictionariesE2e({
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
  }), error => error === expectedError)

  assert.deepEqual(events, [
    'prepare:prepare',
    'start:web', 'ready:web',
    'start:server', 'ready:server',
    'start:proxy', 'ready:proxy',
    'runner',
    'stop:proxy', 'stop:server', 'stop:web',
    'cleanup',
  ])
})

test('runner 成功后先核验数据库，再逆序停止服务与清理目录', async () => {
  const { runBrowserDictionariesE2e } = await loadSubject()
  const events = []
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [{ name: 'web' }, { name: 'server' }],
    verify: [{ name: 'dictionaries-database-verification' }],
  }
  await runBrowserDictionariesE2e({
    plan,
    dependencies: {
      cleanup: async () => events.push('cleanup'),
      prepare: async step => events.push(`prepare:${step.name}`),
      runRunner: async () => events.push('runner'),
      startService: async (service) => {
        events.push(`start:${service.name}`)
        return { name: service.name }
      },
      stopService: async handle => events.push(`stop:${handle.name}`),
      verify: async step => events.push(`verify:${step.name}`),
      waitUntilReady: async service => events.push(`ready:${service.name}`),
    },
  })
  assert.deepEqual(events, [
    'prepare:prepare',
    'start:web', 'ready:web',
    'start:server', 'ready:server',
    'runner',
    'verify:dictionaries-database-verification',
    'stop:server', 'stop:web',
    'cleanup',
  ])
})

test('数据库核验失败时仍逆序停止服务与清理，并保留核验首错', async () => {
  const { runBrowserDictionariesE2e } = await loadSubject()
  const events = []
  const expectedError = new Error('dictionary database verification exited 9')
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [{ name: 'web' }, { name: 'server' }],
    verify: [{ name: 'dictionaries-database-verification' }],
  }

  await assert.rejects(runBrowserDictionariesE2e({
    plan,
    dependencies: {
      cleanup: async () => {
        events.push('cleanup')
        throw new Error('cleanup must not replace verifier failure')
      },
      prepare: async step => events.push(`prepare:${step.name}`),
      runRunner: async () => events.push('runner'),
      startService: async (service) => {
        events.push(`start:${service.name}`)
        return { name: service.name }
      },
      stopService: async (handle) => {
        events.push(`stop:${handle.name}`)
        throw new Error('stop must not replace verifier failure')
      },
      verify: async () => {
        events.push('verify:dictionaries-database-verification')
        throw expectedError
      },
      waitUntilReady: async service => events.push(`ready:${service.name}`),
    },
  }), error => error === expectedError)

  assert.deepEqual(events, [
    'prepare:prepare',
    'start:web', 'ready:web',
    'start:server', 'ready:server',
    'runner',
    'verify:dictionaries-database-verification',
    'stop:server', 'stop:web',
    'cleanup',
  ])
})

test('service readiness 被 signal 停止时优先保留中断退出语义', async () => {
  const source = await readFile(
    path.join(repositoryRoot, 'scripts/ci-browser-dictionaries-e2e.mjs'),
    'utf8',
  )

  assert.match(
    source,
    /catch \(error\) \{\n\s+\/\/ signal handler[\s\S]*?throwIfInterrupted\(\)\n\s+throw error\n\s+\}/u,
  )
})

test('active 子进程被清理为 SIGTERM 时仍优先采用原始 SIGINT 退出码', async () => {
  const { prioritizeBrowserDictionariesSignalError } = await loadSubject()
  const childTerminationError = Object.assign(
    new Error('child exited after cleanup SIGTERM'),
    { exitCode: 143 },
  )

  const sigintError = prioritizeBrowserDictionariesSignalError(
    'SIGINT',
    childTerminationError,
  )
  assert.equal(sigintError.message, 'Browser dictionaries E2E interrupted')
  assert.equal(sigintError.exitCode, 130)

  const sigtermError = prioritizeBrowserDictionariesSignalError(
    'SIGTERM',
    childTerminationError,
  )
  assert.equal(sigtermError.exitCode, 143)
  assert.equal(
    prioritizeBrowserDictionariesSignalError(
      undefined,
      childTerminationError,
    ),
    childTerminationError,
  )
})
