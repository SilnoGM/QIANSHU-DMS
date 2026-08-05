import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const databaseUrl
  = 'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'

async function loadSubject() {
  return import('./ci-browser-suppliers-e2e.mjs')
}

test('Root 与 Web package 通过独立入口执行供应商 Browser E2E', async () => {
  const rootManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  )
  const webManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'web/package.json'), 'utf8'),
  )

  assert.equal(
    rootManifest.scripts['ci:browser-suppliers-e2e'],
    'node ./scripts/ci-postgres.mjs -- node ./scripts/ci-browser-suppliers-e2e.mjs',
  )
  assert.equal(
    webManifest.scripts['test:browser:suppliers'],
    'node --test --test-concurrency=1 apps/qsmds-arco/test/browser/suppliers.browser.test.mjs',
  )
  assert.equal('dependencies' in rootManifest, false)
  assert.equal('devDependencies' in rootManifest, false)
})

test('只接受 ci-postgres 注入的隔离供应商 PostgreSQL URL', async () => {
  const { validateBrowserSuppliersDatabaseUrl } = await loadSubject()
  assert.equal(validateBrowserSuppliersDatabaseUrl(databaseUrl), databaseUrl)

  for (const value of [
    undefined,
    'mysql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci@127.0.0.1:5432/qianshu_ci?schema=public',
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?schema=public',
    'postgresql://qianshu_ci:secret@db.example.com:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci?schema=public&sslmode=disable',
  ]) {
    assert.throws(
      () => validateBrowserSuppliersDatabaseUrl(value),
      { message: 'Browser suppliers E2E database URL is outside the isolated boundary' },
    )
  }
})

test('供应商计划只向必要进程注入数据库和临时凭据', async () => {
  const { createBrowserSuppliersPlan } = await loadSubject()
  const plan = createBrowserSuppliersPlan({
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
    sessionDirectory: '/tmp/qianshu-browser-suppliers-session',
    sourceEnv: {
      DATABASE_URL: 'postgresql://should-not-leak:secret@127.0.0.1:59999/leak',
      QIANSHU_BROWSER_SUPPLIERS_LIMITED_PASSWORD: 'leaked-limited-password',
      PATH: process.env.PATH,
    },
  })

  assert.deepEqual(plan.prepare.map(step => step.name), [
    'database-migrations',
    'supplier-numbering-fixture',
    'server-build',
    'web-build',
    'admin-fixture',
    'tls-certificate',
  ])
  assert.deepEqual(
    [plan.runner.command, plan.runner.args],
    ['pnpm', ['-C', 'web', 'test:browser:suppliers']],
  )
  assert.equal(
    plan.runner.env.QIANSHU_BROWSER_SUPPLIERS_LIMITED_PASSWORD,
    'limited-fixture-password',
  )
  assert.equal(plan.runner.env.DATABASE_URL, undefined)
  assert.equal(plan.verify[0]?.name, 'suppliers-database-verification')
  assert.equal(plan.verify[0]?.env.DATABASE_URL, databaseUrl)

  const fixtureProgram = plan.prepare[1]?.args.at(-1)
  assert.match(fixtureProgram, /SUPPLIER/u)
  assert.match(fixtureProgram, /Supplier Browser fixture only/u)
  assert.match(fixtureProgram, /numbering_rule_versions/u)

  const verificationProgram = plan.verify[0]?.args.at(-1)
  assert.match(verificationProgram, /浏览器供应商已编辑/u)
  assert.match(verificationProgram, /SUPPLIER_CREATED/u)
  assert.match(verificationProgram, /SUPPLIER_UPDATED/u)
  assert.match(verificationProgram, /SUPPLIER_ENABLED/u)
  assert.match(verificationProgram, /SUPPLIER_DISABLED/u)
  assert.match(verificationProgram, /supplier_create_requests/u)
  assert.match(verificationProgram, /numbering_issuances/u)
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
})

test('Browser 场景锁定 unknown create、权限、生命周期与 390px 响应式', async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    'web/apps/qsmds-arco/test/browser/suppliers.browser.test.mjs',
  ), 'utf8')

  assert.match(source, /requestStage: 'Response'/u)
  assert.match(source, /Idempotency-Key/iu)
  assert.match(source, /使用原请求确认结果/u)
  assert.match(source, /suppliers:read/u)
  assert.match(source, /suppliers:create/u)
  assert.match(source, /suppliers:update/u)
  assert.match(source, /suppliers:enable/u)
  assert.match(source, /suppliers:disable/u)
  assert.match(source, /setViewport\(390, 844, true\)/u)
  assert.match(source, /prefers-reduced-motion/u)
  assert.match(source, /setColorScheme\('dark'\)/u)
})
