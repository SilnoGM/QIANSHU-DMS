import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createBrowserRegionsProcessRegistry,
  createBrowserRegionsPlan,
  createBrowserRegionsOutputRelay,
  redactBrowserRegionsOutput,
  runBrowserRegionsE2e,
  validateBrowserRegionsDatabaseUrl,
} from './ci-browser-regions-e2e.mjs'
import { POSTGRES_IMAGE } from './ci-postgres.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const databaseUrl =
  'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'

test('root package 只通过固定 PostgreSQL 16 生命周期执行地区 Browser E2E', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  )

  assert.equal(
    manifest.scripts['ci:browser-regions-e2e'],
    'node ./scripts/ci-postgres.mjs -- node ./scripts/ci-browser-regions-e2e.mjs',
  )
  assert.match(POSTGRES_IMAGE, /^postgres:16@sha256:[a-f0-9]{64}$/u)
  assert.equal('dependencies' in manifest, false)
  assert.equal('devDependencies' in manifest, false)
})

test('只接受 ci-postgres 注入的隔离地区 PostgreSQL URL', () => {
  assert.equal(validateBrowserRegionsDatabaseUrl(databaseUrl), databaseUrl)

  for (const value of [
    undefined,
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?schema=public',
    'postgresql://qianshu_ci:secret@db.example.com:5432/qianshu_ci?schema=public',
    'postgresql://qianshu_ci:secret@127.0.0.1:5432/qianshu_ci',
  ]) {
    assert.throws(
      () => validateBrowserRegionsDatabaseUrl(value),
      {
        message:
          'Browser regions E2E database URL is outside the isolated boundary',
      },
    )
  }
})

test('固定计划复用迁移、真实构建、认证 fixture 与双环境同源服务', () => {
  const leakedDatabaseUrl
    = 'postgresql://should-not-leak:secret@127.0.0.1:59999/leak'
  const plan = createBrowserRegionsPlan({
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
    },
    sessionDirectory: '/tmp/qianshu-browser-regions-session',
    sourceEnv: {
      DATABASE_URL: leakedDatabaseUrl,
      PATH: process.env.PATH,
    },
  })

  assert.deepEqual(
    plan.prepare.map(step => [step.command, step.args]),
    [
      ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
      ['pnpm', ['-C', 'server', 'build']],
      ['pnpm', [
        '-C', 'web',
        '--filter', 'qsmds-arco',
        'run', 'build:test',
      ]],
      [process.execPath, ['./scripts/browser-auth/provision-admin.mjs']],
      ['openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', '/tmp/qianshu-browser-regions-session/tls-key.pem',
        '-out', '/tmp/qianshu-browser-regions-session/tls-cert.pem',
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
  assert.deepEqual(
    [plan.runner.command, plan.runner.args],
    [
      'pnpm',
      ['-C', 'web', 'test:browser:regions'],
    ],
  )
  assert.deepEqual(
    plan.verify.map(step => [step.command, step.args.slice(0, 5)]),
    [[
      'pnpm',
      ['-C', 'server', 'exec', 'node', '--input-type=commonjs'],
    ]],
  )
  assert.equal(plan.verify[0]?.env.DATABASE_URL, databaseUrl)
  assert.equal(
    plan.verify.flatMap(step => step.args).includes(databaseUrl),
    false,
  )
  const verificationProgram = plan.verify[0]?.args.at(-1)
  assert.match(
    verificationProgram,
    /auditResult\.rowCount !== expectedEvents\.length/u,
  )
  assert.match(verificationProgram, /username_normalized/u)
  assert.match(verificationProgram, /request_id/u)
  assert.match(verificationProgram, /affectedCount/u)
  assert.match(verificationProgram, /changedFields/u)
  assert.match(verificationProgram, /ORDER BY occurred_at ASC, id ASC/u)
  assert.doesNotMatch(verificationProgram, /\bcreated_at\b/u)
  const databaseConsumers = [
    ...plan.prepare.filter(step =>
      ['admin-fixture', 'database-migrations', 'server-build']
        .includes(step.name)),
    ...plan.services.filter(service =>
      service.name.startsWith('server-')),
    ...plan.verify,
  ]
  assert.equal(
    databaseConsumers.every(step => step.env.DATABASE_URL === databaseUrl),
    true,
  )
  const databaseIsolatedProcesses = [
    ...plan.prepare.filter(step =>
      ['tls-certificate', 'web-build'].includes(step.name)),
    ...plan.services.filter(service =>
      !service.name.startsWith('server-')),
    plan.runner,
  ]
  assert.equal(
    databaseIsolatedProcesses.every(step =>
      step.env.DATABASE_URL === undefined),
    true,
  )
  assert.equal(
    [...plan.prepare, ...plan.services, plan.runner, ...plan.verify]
      .some(step => step.env.DATABASE_URL === leakedDatabaseUrl),
    false,
  )
  assert.equal(
    plan.runner.env.QIANSHU_BROWSER_AUTH_BASE_URL,
    'https://127.0.0.1:41003',
  )
  assert.equal(
    plan.runner.env.QIANSHU_BROWSER_AUTH_HTTP_BASE_URL,
    'http://127.0.0.1:41001',
  )
  assert.equal(
    plan.prepare.find(step => step.name === 'web-build')
      ?.env.VITE_ENABLE_COMPONENT_LIBRARY,
    'true',
  )
  assert.equal(
    plan.prepare.find(step => step.name === 'web-build')
      ?.env.VITE_APP_API_BASEURL,
    '/api',
  )
  assert.equal(
    plan.prepare.find(step => step.name === 'web-build')
      ?.env.VITE_BUILD_FAKE,
    'false',
  )
  assert.equal(
    plan.services.find(service => service.name === 'web')
      ?.env.QIANSHU_BROWSER_AUTH_WEB_ROOT,
    path.join(repositoryRoot, 'web/apps/qsmds-arco/dist-test'),
  )
  assert.equal(plan.runner.env.DATABASE_URL, undefined)
  assert.equal(plan.runner.env.QIANSHU_BROWSER_AUTH_ADMIN_USERNAME, 'browser_admin')
  assert.equal(
    [...plan.prepare, ...plan.services, plan.runner]
      .flatMap(step => step.args)
      .includes('fixture-password'),
    false,
  )
})

test('runner 失败时逆序停止服务并保留首个退出错误', async () => {
  const events = []
  const expectedError = new Error('regions browser runner exited 7')
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [
      { name: 'web' },
      { name: 'server' },
      { name: 'proxy' },
    ],
    verify: [{ name: 'database-verification' }],
  }

  await assert.rejects(
    runBrowserRegionsE2e({
      plan,
      dependencies: {
        cleanup: async () => events.push('cleanup'),
        prepare: async step => events.push(`prepare:${step.name}`),
        runRunner: async () => {
          events.push('runner')
          throw expectedError
        },
        verify: async step => events.push(`verify:${step.name}`),
        startService: async (service) => {
          events.push(`start:${service.name}`)
          return { name: service.name }
        },
        stopService: async (handle) => {
          events.push(`stop:${handle.name}`)
          throw new Error('cleanup must not replace runner failure')
        },
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

test('runner 成功后在停止服务前完成 server-domain 数据库最终态核验', async () => {
  const events = []
  const plan = {
    prepare: [{ name: 'prepare' }],
    runner: { name: 'runner' },
    services: [{ name: 'server' }],
    verify: [{ name: 'database-verification' }],
  }

  await runBrowserRegionsE2e({
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
    'verify:database-verification',
    'stop:server',
    'cleanup',
  ])
})

test('中断会并发停止当前步骤与全部已启动服务且同一 handle 只停止一次', async () => {
  const stops = []
  const registry = createBrowserRegionsProcessRegistry(async (handle) => {
    stops.push(handle.name)
  })
  const web = { name: 'web' }
  const server = { name: 'server' }
  const runner = { name: 'runner' }

  registry.addService(web)
  registry.addService(server)
  registry.setActive(runner)
  await Promise.all([
    registry.stopAll(),
    registry.stopAll(),
  ])

  assert.deepEqual(stops.sort(), ['runner', 'server', 'web'])

  registry.clearActive(runner)
  registry.removeService(web)
  registry.removeService(server)
  const lateProxy = { name: 'late-proxy' }
  registry.addService(lateProxy)
  await registry.stop(lateProxy)
  await registry.stopAll()
  assert.deepEqual(
    stops.sort(),
    ['late-proxy', 'runner', 'server', 'web'],
  )
})

test('输出按长值优先遮罩数据库 URL、密码和 HMAC 且不残留片段', () => {
  const adminPassword = 'Region-Fixture-Password'
  const hmacKey = 'region-hmac-key'
  const text = [
    databaseUrl,
    'test-password',
    adminPassword,
    hmacKey,
    databaseUrl,
  ].join('\n')

  const redacted = redactBrowserRegionsOutput(text, [
    'test-password',
    databaseUrl,
    adminPassword,
    hmacKey,
  ])

  assert.equal(redacted, ['***', '***', '***', '***', '***'].join('\n'))
  for (const secret of [
    databaseUrl,
    'test-password',
    adminPassword,
    hmacKey,
  ]) {
    assert.equal(redacted.includes(secret), false)
  }
})

test('子进程输出可流式诊断且跨 chunk secret 仍只输出遮罩', () => {
  const outputs = []
  const relay = createBrowserRegionsOutputRelay(
    value => outputs.push(value),
    [databaseUrl, 'test-password'],
  )
  const splitIndex = databaseUrl.indexOf('test-password') + 5

  relay.push('safe-line\n')
  assert.equal(outputs.join(''), 'safe-line\n')
  relay.push(`before:${databaseUrl.slice(0, splitIndex)}`)
  relay.push(`${databaseUrl.slice(splitIndex)}:after`)
  relay.flush()
  relay.flush()

  assert.equal(outputs.join(''), 'safe-line\nbefore:***:after')
  assert.equal(outputs.join('').includes(databaseUrl), false)
  assert.equal(outputs.join('').includes('test-password'), false)
})

test('子进程在 secret 前缀处结束时 fail-closed 遮罩尾串', () => {
  const outputs = []
  const secret = 'TOPSECRET123'
  const relay = createBrowserRegionsOutputRelay(
    value => outputs.push(value),
    [secret],
  )

  relay.push('safe:TOPSEC')
  relay.flush()

  assert.equal(outputs.join(''), 'safe:***')
  assert.equal(outputs.join('').includes('TOPSEC'), false)
})

test('完整行在 secret 前缀处截断时同样 fail-closed 且安全行仍即时输出', () => {
  for (const lineEnding of ['\n', '\r', '\r\n']) {
    const outputs = []
    const relay = createBrowserRegionsOutputRelay(
      value => outputs.push(value),
      ['TOPSECRET123'],
    )

    relay.push(`safe-line${lineEnding}`)
    assert.equal(outputs.join(''), `safe-line${lineEnding}`)
    relay.push(`safe:TOPSEC${lineEnding}`)

    assert.equal(
      outputs.join(''),
      `safe-line${lineEnding}safe:***${lineEnding}`,
    )
    assert.equal(outputs.join('').includes('TOPSEC'), false)
  }

  const databaseOutputs = []
  const databaseRelay = createBrowserRegionsOutputRelay(
    value => databaseOutputs.push(value),
    [databaseUrl, 'test-password'],
  )
  const databasePrefix = databaseUrl.slice(
    0,
    databaseUrl.indexOf('test-password') + 5,
  )
  databaseRelay.push(`error:${databasePrefix}\n`)

  assert.equal(databaseOutputs.join(''), 'error:***\n')
  assert.equal(databaseOutputs.join('').includes('postgresql://'), false)

  const mixedOutputs = []
  const mixedRelay = createBrowserRegionsOutputRelay(
    value => mixedOutputs.push(value),
    ['TOPSECRET123', 'bridge\nsecret'],
  )
  mixedRelay.push('safe:TOPSEC\nordinary-tail-that-settles~')
  mixedRelay.flush()
  assert.equal(
    mixedOutputs.join(''),
    'safe:***\nordinary-tail-that-settles~',
  )

  const embeddedLineEndingOutputs = []
  const embeddedLineEndingRelay = createBrowserRegionsOutputRelay(
    value => embeddedLineEndingOutputs.push(value),
    ['TOPSECRET123', 'bridge\nsecret'],
  )
  for (const character of 'before:bridge\nsecret:after') {
    embeddedLineEndingRelay.push(character)
  }
  embeddedLineEndingRelay.flush()
  assert.equal(embeddedLineEndingOutputs.join(''), 'before:***:after')
})

test('重叠 password 不会破坏任一 DATABASE_URL 跨 chunk 遮罩', () => {
  for (let splitIndex = 1; splitIndex < databaseUrl.length; splitIndex += 1) {
    const outputs = []
    const relay = createBrowserRegionsOutputRelay(
      value => outputs.push(value),
      [databaseUrl, 'test-password'],
    )

    relay.push(`before:${databaseUrl.slice(0, splitIndex)}`)
    relay.push(`${databaseUrl.slice(splitIndex)}:after`)
    relay.flush()

    assert.equal(
      outputs.join(''),
      'before:***:after',
      `DATABASE_URL split ${splitIndex}`,
    )
    assert.equal(outputs.join('').includes('postgresql://'), false)
    assert.equal(outputs.join('').includes('test-password'), false)
  }
})

test('不同 secret 的前后缀碰撞不会拆开已完整到达的 DATABASE_URL', () => {
  const collisionSecret = 'cHmacFixture'
  const value = `before:${databaseUrl}:after`

  for (let splitIndex = 1; splitIndex < value.length; splitIndex += 1) {
    const outputs = []
    const relay = createBrowserRegionsOutputRelay(
      output => outputs.push(output),
      [databaseUrl, 'test-password', collisionSecret],
    )

    relay.push(value.slice(0, splitIndex))
    relay.push(value.slice(splitIndex))
    relay.flush()

    assert.equal(
      outputs.join(''),
      'before:***:after',
      `cross-secret split ${splitIndex}`,
    )
    assert.equal(outputs.join('').includes('postgresql://'), false)
  }

  const eofOutputs = []
  const eofRelay = createBrowserRegionsOutputRelay(
    output => eofOutputs.push(output),
    [databaseUrl, 'test-password', collisionSecret],
  )
  eofRelay.push(databaseUrl)
  eofRelay.flush()
  assert.equal(eofOutputs.join(''), '***')
})

test('secret 自身前后缀重叠时每个完整 occurrence 都作为同一遮罩区间输出', () => {
  const cases = [
    {
      input: 'TOPSECRETTOPSECRET',
      secrets: ['TOPSECRETTOPSECRET'],
    },
    { input: 'aaaaa', secrets: ['aaaa'] },
    { input: 'ababa', secrets: ['aba'] },
    { input: 'abcabx', secrets: ['abcab', 'abx'] },
    { input: 'abcd', secrets: ['abc', 'abcd'] },
  ]

  for (const { input, secrets } of cases) {
    const value = `before:${input}:after`
    for (let splitIndex = 1; splitIndex < value.length; splitIndex += 1) {
      const outputs = []
      const relay = createBrowserRegionsOutputRelay(
        output => outputs.push(output),
        secrets,
      )

      relay.push(value.slice(0, splitIndex))
      relay.push(value.slice(splitIndex))
      relay.flush()

      assert.equal(
        outputs.join(''),
        'before:***:after',
        `${secrets.join(',')} split ${splitIndex}`,
      )
    }

    const eofOutputs = []
    const eofRelay = createBrowserRegionsOutputRelay(
      output => eofOutputs.push(output),
      secrets,
    )
    for (const character of input) {
      eofRelay.push(character)
    }
    eofRelay.flush()
    assert.equal(eofOutputs.join(''), '***', `${secrets.join(',')} EOF`)
  }
})

test('流式 relay 对任意 chunk partition 都与离线区间并集 oracle 一致', () => {
  const redactWithIntervalOracle = (input, sensitiveValues) => {
    const secrets = [...new Set(sensitiveValues.filter(
      value => typeof value === 'string' && value.length > 0,
    ))]
    const mask = Array.from({ length: input.length }, () => false)

    for (const secret of secrets) {
      let searchIndex = 0
      while (searchIndex <= input.length - secret.length) {
        const matchIndex = input.indexOf(secret, searchIndex)
        if (matchIndex === -1) {
          break
        }
        mask.fill(true, matchIndex, matchIndex + secret.length)
        searchIndex = matchIndex + 1
      }
    }

    const markProtectedSuffix = (endIndex, protectedSecrets = secrets) => {
      let protectedSuffixLength = 0
      for (const secret of protectedSecrets) {
        for (
          let length = Math.min(secret.length - 1, endIndex);
          length > protectedSuffixLength;
          length -= 1
        ) {
          if (input.endsWith(secret.slice(0, length), endIndex)) {
            protectedSuffixLength = length
            break
          }
        }
      }
      mask.fill(true, endIndex - protectedSuffixLength, endIndex)
    }
    const newlineProtectedSecrets = secrets.filter(
      secret => !secret.includes('\n'),
    )
    const carriageReturnProtectedSecrets = secrets.filter(
      secret => !secret.includes('\r'),
    )
    for (let index = 0; index < input.length; index += 1) {
      if (input[index] === '\n') {
        markProtectedSuffix(index, newlineProtectedSecrets)
      }
      else if (input[index] === '\r') {
        markProtectedSuffix(index, carriageReturnProtectedSecrets)
      }
    }
    markProtectedSuffix(input.length)

    let output = ''
    let maskRunOpen = false
    for (let index = 0; index < input.length; index += 1) {
      if (mask[index]) {
        if (!maskRunOpen) {
          output += '***'
          maskRunOpen = true
        }
      }
      else {
        maskRunOpen = false
        output += input[index]
      }
    }
    return output
  }

  const cases = [
    { input: 'xxabcabxyy', secrets: ['abcab', 'abx'] },
    { input: 'ababa', secrets: ['aba'] },
    { input: 'aaaaa', secrets: ['aaaa'] },
    { input: 'abcX', secrets: ['abc', 'abcd'] },
    { input: 'safe:TOP', secrets: ['TOPSECRET'] },
    { input: 'safe:TOP\nok', secrets: ['TOPSECRET'] },
    { input: 'safe:TOP\r\nok', secrets: ['TOPSECRET'] },
    { input: 'ab\nzzzz', secrets: ['abcd', 'x\ny'] },
    { input: 'x\ny', secrets: ['abcd', 'x\ny'] },
    { input: 'plain', secrets: ['', undefined] },
  ]

  for (const { input, secrets } of cases) {
    const partitionCount = 2 ** Math.max(0, input.length - 1)
    const expected = redactWithIntervalOracle(input, secrets)
    for (let partition = 0; partition < partitionCount; partition += 1) {
      const chunks = []
      let chunkStart = 0
      for (let index = 1; index <= input.length; index += 1) {
        const hasBoundary = index === input.length
          || (partition & (2 ** (index - 1))) !== 0
        if (hasBoundary) {
          chunks.push(input.slice(chunkStart, index))
          chunkStart = index
        }
      }

      const outputs = []
      const relay = createBrowserRegionsOutputRelay(
        output => outputs.push(output),
        secrets,
      )
      for (const chunk of chunks) {
        relay.push(chunk)
      }
      relay.flush()

      assert.equal(
        outputs.join(''),
        expected,
        `${input} partition ${partition}`,
      )
    }
  }
})
