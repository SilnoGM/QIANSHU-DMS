import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import {
  createBrowserAuthPlan,
  isServiceReadyStatus,
  runBrowserAuthE2e,
  validateBrowserAuthDatabaseUrl,
} from './ci-browser-auth-e2e.mjs'

const databaseUrl =
  'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'

test('只接受 ci-postgres 注入的隔离 PostgreSQL URL', () => {
  assert.equal(validateBrowserAuthDatabaseUrl(databaseUrl), databaseUrl)

  for (const value of [
    undefined,
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?schema=public',
    'postgresql://qianshu_ci:secret@db.example.com:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci',
  ]) {
    assert.throws(
      () => validateBrowserAuthDatabaseUrl(value),
      { message: 'Browser auth E2E database URL is outside the isolated boundary' },
    )
  }
})

test('服务 ready 只接受明确 200，拒绝错误路由和未授权响应', () => {
  assert.equal(isServiceReadyStatus(200), true)
  for (const status of [0, 201, 204, 301, 400, 401, 403, 404, 500]) {
    assert.equal(isServiceReadyStatus(status), false)
  }
})

test('固定计划使用真实构建、双环境 Server、同源代理和外部 Web runner', () => {
  const plan = createBrowserAuthPlan({
    chromeExecutable: '/opt/google/chrome/chrome',
    databaseUrl,
    ffprobePath: '/opt/media/bin/ffprobe',
    mediaStorageRoot: '/var/tmp/qianshu-browser-media',
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
    },
    sessionDirectory: '/tmp/qianshu-browser-auth-session',
  })

  assert.deepEqual(
    plan.prepare.map(step => [step.command, step.args]),
    [
      ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
      ['pnpm', ['-C', 'server', 'build']],
      ['pnpm', ['-C', 'web', 'build']],
      [process.execPath, ['./scripts/browser-auth/provision-admin.mjs']],
      [process.execPath, ['./scripts/browser-auth/provision-media-fixtures.mjs']],
      ['openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', '/tmp/qianshu-browser-auth-session/tls-key.pem',
        '-out', '/tmp/qianshu-browser-auth-session/tls-cert.pem',
        '-days', '1', '-subj', '/CN=127.0.0.1',
        '-addext', 'subjectAltName=IP:127.0.0.1',
      ]],
    ],
  )
  assert.deepEqual(plan.services.map(service => service.name), [
    'web',
    'server-development',
    'server-production',
    'proxy-development',
    'proxy-production',
  ])
  assert.equal(
    plan.prepare.find(step => step.name === 'media-fixture')
      ?.env.QIANSHU_BROWSER_AUTH_MEDIA_STORAGE_ROOT,
    '/var/tmp/qianshu-browser-media',
  )
  assert.deepEqual(
    plan.services
      .filter(service => service.name.startsWith('server-'))
      .map(service => service.args),
    [
      ['./scripts/browser-auth/server-entry.mjs'],
      ['./scripts/browser-auth/server-entry.mjs'],
    ],
  )
  assert.deepEqual(
    [plan.runner.command, plan.runner.args],
    ['pnpm', ['-C', 'web', 'test:browser:auth']],
  )
  assert.equal(plan.runner.env.QIANSHU_BROWSER_AUTH_BASE_URL, 'https://127.0.0.1:41003')
  assert.equal(plan.runner.env.QIANSHU_BROWSER_AUTH_HTTP_BASE_URL, 'http://127.0.0.1:41001')
  assert.equal(
    plan.runner.env.QIANSHU_BROWSER_AUTH_FIXTURE_DIRECTORY,
    '/tmp/qianshu-browser-auth-session/media-fixtures',
  )
  for (const server of plan.services.filter(service => service.name.startsWith('server-'))) {
    assert.equal(server.env.MEDIA_FFPROBE_PATH, '/opt/media/bin/ffprobe')
    assert.equal(server.env.MEDIA_STORAGE_DRIVER, 'local')
    assert.equal(server.env.MEDIA_STORAGE_ROOT, '/var/tmp/qianshu-browser-media')
  }
  for (const proxy of plan.services.filter(service => service.name.startsWith('proxy-'))) {
    assert.equal(
      proxy.env.QIANSHU_BROWSER_AUTH_MEDIA_STORAGE_ROOT,
      '/var/tmp/qianshu-browser-media',
    )
  }
  assert.equal(
    [...plan.prepare, ...plan.services, plan.runner]
      .flatMap(step => step.args)
      .includes('fixture-password'),
    false,
  )
})

test('runner 失败时按逆序停止全部服务并清理唯一临时目录', async () => {
  const events = []
  const expectedError = new Error('browser runner failed')
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [
      { name: 'web' },
      { name: 'server' },
      { name: 'proxy' },
    ],
  }

  await assert.rejects(
    runBrowserAuthE2e({
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
        stopService: async handle => events.push(`stop:${handle.name}`),
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
