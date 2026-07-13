import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  POSTGRES_IMAGE,
  assertOwnedContainerId,
  redactSensitiveText,
  runWithPostgres,
} from './ci-postgres.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const entrypoint = path.join(scriptsDirectory, 'ci-postgres.mjs')
const ownedContainerId = 'a'.repeat(64)
const deterministicPassword = Buffer.alloc(32, 7).toString('base64url')
const successfulCommand = Object.freeze([
  process.execPath,
  '-e',
  'process.exit(0)',
])

function createDeferred() {
  let reject
  let resolve
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

function fixedResult(exitCode = 0, stdout = '', stderr = '') {
  return { exitCode, stderr, stdout }
}

async function createHarness(t, options = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'qianshu-ci-postgres-test-'),
  )
  t.after(async () => {
    await rm(fixtureRoot, { force: true, recursive: true })
  })

  const events = []
  const dockerCalls = []
  const childCalls = []
  const masks = []
  const outputs = []
  const kills = []
  const observed = {
    filesystemRemoveCalls: 0,
    sessionDirectory: undefined,
  }
  const childCompletion = createDeferred()
  const emitter = new EventEmitter()
  let currentTime = 0
  let inspectCallCount = 0

  const filesystem = {
    async chmod(target, mode) {
      await chmod(target, mode)
    },
    async mkdtemp() {
      const sessionDirectory = await mkdtemp(
        path.join(fixtureRoot, 'session-'),
      )
      observed.sessionDirectory = sessionDirectory
      return sessionDirectory
    },
    async readFile(target, encoding) {
      return readFile(target, encoding)
    },
    async rm(target, removeOptions) {
      observed.filesystemRemoveCalls += 1
      events.push({ target, type: 'filesystem-rm' })
      if (options.filesystemRemoveError) {
        throw options.filesystemRemoveError
      }
      await rm(target, removeOptions)
    },
    async writeFile(target, contents, writeOptions) {
      await writeFile(target, contents, writeOptions)
      if (
        options.signalAfterEnvFile
        && target.endsWith(`${path.sep}postgres.env`)
      ) {
        emitter.emit(options.signalAfterEnvFile)
      }
    },
  }

  const dockerRunner = async ({ argv }) => {
    const call = { argv: [...argv] }
    dockerCalls.push(call)
    events.push({ command: argv[0], type: 'docker' })

    if (typeof options.dockerResponder === 'function') {
      return options.dockerResponder({ call, observed })
    }

    if (argv[0] === 'run') {
      const cidFile = argv[argv.indexOf('--cidfile') + 1]
      const envFile = argv[argv.indexOf('--env-file') + 1]
      observed.sessionMode = (await stat(path.dirname(cidFile))).mode & 0o777
      observed.envFileMode = (await stat(envFile)).mode & 0o777
      observed.envFileContents = await readFile(envFile, 'utf8')
      observed.cidFile = cidFile
      observed.envFile = envFile

      if (options.signalOnDockerRun) {
        emitter.emit(options.signalOnDockerRun)
      }

      if (options.dockerRunExitCode) {
        const stderr = options.echoEnvOnDockerFailure
          ? observed.envFileContents
          : 'docker run failed'
        return fixedResult(options.dockerRunExitCode, '', stderr)
      }

      await writeFile(
        cidFile,
        options.cidFileContents ?? ownedContainerId,
        { encoding: 'utf8', mode: 0o600 },
      )
      return fixedResult()
    }

    if (argv[0] === 'inspect') {
      inspectCallCount += 1
      const status = typeof options.inspectStatus === 'function'
        ? options.inspectStatus(inspectCallCount)
        : options.inspectStatus ?? 'healthy\n'
      return fixedResult(options.inspectExitCode ?? 0, status)
    }

    if (argv[0] === 'port') {
      return fixedResult(
        options.portExitCode ?? 0,
        options.portOutput ?? '127.0.0.1:54321\n',
      )
    }

    if (argv[0] === 'rm') {
      return fixedResult(
        options.dockerRemoveExitCode ?? 0,
        '',
        options.dockerRemoveStderr ?? '',
      )
    }

    throw new Error('Unexpected Docker command in test harness')
  }

  const childRunner = (request) => {
    const call = {
      argv: [...request.argv],
      detached: request.detached,
      env: { ...request.env },
    }
    childCalls.push(call)
    events.push({ type: 'child' })

    options.onChildStart?.(request)
    if (typeof options.childStdout === 'function') {
      request.onStdout(options.childStdout(request))
    }
    if (typeof options.childStderr === 'function') {
      request.onStderr(options.childStderr(request))
    }

    if (options.synchronousSignalOnChildStart) {
      emitter.emit(options.synchronousSignalOnChildStart)
    }

    if (options.signalsOnChildStart) {
      queueMicrotask(() => {
        for (const signal of options.signalsOnChildStart) {
          emitter.emit(signal)
        }
      })
    }

    return {
      completion: options.deferChild
        ? childCompletion.promise
        : Promise.resolve(fixedResult(options.childExitCode ?? 0)),
      pid: options.childPid ?? 4242,
    }
  }

  const signalSource = {
    kill(processGroupId, signal) {
      kills.push({ processGroupId, signal })
      events.push({ processGroupId, signal, type: 'kill' })
      if (signal === options.rejectChildOnKillSignal) {
        childCompletion.reject(
          new Error(`child rejection: ${deterministicPassword}`),
        )
      }
      if (signal === options.resolveChildOnKillSignal) {
        childCompletion.resolve(fixedResult(0))
      }
    },
    listenerCount(signal) {
      return emitter.listenerCount(signal)
    },
    off(signal, listener) {
      emitter.off(signal, listener)
    },
    on(signal, listener) {
      emitter.on(signal, listener)
    },
  }

  const dependencies = {
    childRunner,
    clock() {
      return options.clockValue ?? currentTime
    },
    dockerRunner,
    environment: {
      GITHUB_ACTIONS: options.githubActions === false ? 'false' : 'true',
      PATH: process.env.PATH,
    },
    filesystem,
    maskWriter(value) {
      masks.push(value)
      events.push({ type: 'mask', value })
      if (options.maskWriterError) {
        throw options.maskWriterError
      }
    },
    outputWriter(value) {
      outputs.push(value)
      events.push({ type: 'output', value })
    },
    randomBytes(size) {
      assert.equal(size, 32)
      return options.randomBytesResult ?? Buffer.alloc(32, 7)
    },
    signalSource,
    async wait(milliseconds) {
      currentTime += milliseconds
      await options.onWait?.({
        childCompletion,
        emitter,
        milliseconds,
      })
    },
  }

  return {
    childCalls,
    dependencies,
    dockerCalls,
    events,
    fixtureRoot,
    get inspectCallCount() {
      return inspectCallCount
    },
    kills,
    masks,
    observed,
    outputs,
    password: deterministicPassword,
    signalSource,
  }
}

async function expectLifecycleFailure(promise, exitCode, message) {
  await assert.rejects(
    promise,
    (error) => {
      assert.equal(error?.exitCode, exitCode)
      assert.equal(error?.message, message)
      return true
    },
  )
}

test('ownership helper 只接受精确 64 位小写十六进制容器 ID', () => {
  assert.equal(assertOwnedContainerId(ownedContainerId), ownedContainerId)

  for (const value of [
    `${ownedContainerId}\n`,
    ` ${ownedContainerId}`,
    ownedContainerId.toUpperCase(),
    'a'.repeat(63),
    `${'a'.repeat(63)}g`,
    undefined,
  ]) {
    assert.throws(
      () => assertOwnedContainerId(value),
      { message: 'CI PostgreSQL container ownership is invalid' },
    )
  }
})

test('redact helper 先替换长 URL 再替换重叠密码且不残留部分连接串', () => {
  const password = 'overlapping-password'
  const databaseUrl = `postgresql://qianshu_ci:${password}@127.0.0.1:54321/qianshu_ci`
  const result = redactSensitiveText(
    `${databaseUrl}\n${password}\n${databaseUrl}`,
    [password, databaseUrl, password, '', undefined],
  )

  assert.equal(result, '***\n***\n***')
  assert.doesNotMatch(result, /postgresql:\/\/qianshu_ci:\*\*\*@/u)
})

test('input 要求冻结的非空 argv 与完整显式依赖且零副作用拒绝错误输入', async (t) => {
  const harness = await createHarness(t)
  const invalidCommands = [
    [process.execPath],
    Object.freeze([]),
    Object.freeze(['']),
    Object.freeze([process.execPath, 7]),
  ]

  for (const command of invalidCommands) {
    await expectLifecycleFailure(
      runWithPostgres({ command, dependencies: harness.dependencies }),
      1,
      'CI PostgreSQL lifecycle input is invalid',
    )
  }

  await expectLifecycleFailure(
    runWithPostgres(null),
    1,
    'CI PostgreSQL lifecycle input is invalid',
  )

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: { ...harness.dependencies, wait: undefined },
    }),
    1,
    'CI PostgreSQL lifecycle input is invalid',
  )
  assert.equal(harness.observed.sessionDirectory, undefined)
  assert.deepEqual(harness.dockerCalls, [])
})

test('session、password、mask、Docker argv、动态端口与 cleanup 保持安全顺序', async (t) => {
  const harness = await createHarness(t)

  assert.equal(
    await runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    0,
  )

  const dockerRun = harness.dockerCalls.find(call => call.argv[0] === 'run')
  const dockerPort = harness.dockerCalls.find(call => call.argv[0] === 'port')
  const dockerRemove = harness.dockerCalls.find(call => call.argv[0] === 'rm')
  const child = harness.childCalls[0]
  const databaseUrl = child.env.DATABASE_URL

  assert.deepEqual(
    dockerRun.argv.slice(0, 5),
    ['run', '--detach', '--cidfile', harness.observed.cidFile, '--env-file'],
  )
  assert.equal(dockerRun.argv.at(-1), POSTGRES_IMAGE)
  assert.match(POSTGRES_IMAGE, /^postgres:16@sha256:[a-f0-9]{64}$/u)
  assert.equal(
    dockerRun.argv.some(value => value.includes(harness.password)),
    false,
  )
  assert.equal(
    dockerRun.argv[dockerRun.argv.indexOf('--publish') + 1],
    '127.0.0.1::5432/tcp',
  )
  assert.equal(
    dockerRun.argv[dockerRun.argv.indexOf('--health-cmd') + 1],
    'pg_isready -U qianshu_ci -d qianshu_ci',
  )
  assert.deepEqual(dockerPort.argv, [
    'port',
    ownedContainerId,
    '5432/tcp',
  ])
  assert.deepEqual(dockerRemove.argv, [
    'rm',
    '--force',
    '--volumes',
    ownedContainerId,
  ])
  assert.deepEqual(child.argv, successfulCommand)
  assert.equal(child.detached, true)
  assert.equal(
    databaseUrl,
    `postgresql://qianshu_ci:${harness.password}@127.0.0.1:54321/qianshu_ci?schema=public`,
  )
  assert.deepEqual(harness.masks, [harness.password, databaseUrl])

  const maskPasswordIndex = harness.events.findIndex(
    event => event.type === 'mask' && event.value === harness.password,
  )
  const dockerRunIndex = harness.events.findIndex(
    event => event.type === 'docker' && event.command === 'run',
  )
  const dockerPortIndex = harness.events.findIndex(
    event => event.type === 'docker' && event.command === 'port',
  )
  const maskDatabaseUrlIndex = harness.events.findIndex(
    event => event.type === 'mask' && event.value === databaseUrl,
  )
  const childIndex = harness.events.findIndex(event => event.type === 'child')

  assert.ok(maskPasswordIndex < dockerRunIndex)
  assert.ok(dockerPortIndex < maskDatabaseUrlIndex)
  assert.ok(maskDatabaseUrlIndex < childIndex)
  assert.equal(harness.observed.sessionMode, 0o700)
  assert.equal(harness.observed.envFileMode, 0o600)
  assert.equal(
    harness.observed.envFileContents,
    `POSTGRES_USER=qianshu_ci\nPOSTGRES_DB=qianshu_ci\nPOSTGRES_PASSWORD=${harness.password}\n`,
  )
  await assert.rejects(access(harness.observed.sessionDirectory), {
    code: 'ENOENT',
  })
})

test('本地执行不调用 GitHub mask channel 且 child stderr 完整脱敏并保留退出码', async (t) => {
  const harness = await createHarness(t, {
    childExitCode: 7,
    childStderr: ({ env }) => `${env.DATABASE_URL}\n${deterministicPassword}`,
    githubActions: false,
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    7,
    'CI PostgreSQL child command failed',
  )

  const databaseUrl = harness.childCalls[0].env.DATABASE_URL
  const output = harness.outputs.join('')
  assert.deepEqual(harness.masks, [])
  assert.match(output, /\*\*\*/u)
  assert.doesNotMatch(output, new RegExp(harness.password, 'u'))
  assert.equal(output.includes(databaseUrl), false)
  assert.doesNotMatch(output, /postgresql:\/\/qianshu_ci:\*\*\*@/u)
  assert.equal(
    harness.dockerCalls.filter(call => call.argv[0] === 'rm').length,
    1,
  )
})

test('docker run 失败时脱敏输出、保留退出码并只删除 session', async (t) => {
  const harness = await createHarness(t, {
    dockerRunExitCode: 9,
    echoEnvOnDockerFailure: true,
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    9,
    'CI PostgreSQL Docker command failed',
  )

  const output = harness.outputs.join('')
  assert.match(output, /POSTGRES_PASSWORD=\*\*\*/u)
  assert.equal(output.includes(harness.password), false)
  assert.equal(
    harness.dockerCalls.some(call => call.argv[0] === 'rm'),
    false,
  )
  assert.equal(harness.observed.filesystemRemoveCalls, 1)
})

test('伪造 cidfile 永不触发 Docker cleanup', async (t) => {
  const harness = await createHarness(t, {
    cidFileContents: `${ownedContainerId}\n`,
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    1,
    'CI PostgreSQL container ownership is invalid',
  )
  assert.equal(
    harness.dockerCalls.some(call => call.argv[0] === 'rm'),
    false,
  )
  assert.equal(harness.observed.filesystemRemoveCalls, 1)
})

test('health timeout 使用注入 clock/wait 并清理唯一所有容器', async (t) => {
  const harness = await createHarness(t, { inspectStatus: 'starting\n' })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    1,
    'CI PostgreSQL health check timed out',
  )
  assert.ok(harness.inspectCallCount > 1)
  assert.deepEqual(
    harness.dockerCalls.filter(call => call.argv[0] === 'rm')[0].argv,
    ['rm', '--force', '--volumes', ownedContainerId],
  )
})

test('health clock 返回非有限值时安全失败并清理所有容器', async (t) => {
  const harness = await createHarness(t, { clockValue: Number.NaN })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    1,
    'CI PostgreSQL lifecycle failed',
  )
  assert.deepEqual(
    harness.dockerCalls.filter(call => call.argv[0] === 'rm')[0].argv,
    ['rm', '--force', '--volumes', ownedContainerId],
  )
})

test('docker port 只接受 loopback 单端口与 1-65535 范围', async (t) => {
  for (const portOutput of [
    '0.0.0.0:54321\n',
    '127.0.0.1:0\n',
    '127.0.0.1:65536\n',
    '127.0.0.1:54321\n127.0.0.1:54322\n',
    ' 127.0.0.1:54321\n',
  ]) {
    await t.test(portOutput.replaceAll('\n', '\\n'), async (subtest) => {
      const harness = await createHarness(subtest, { portOutput })
      await expectLifecycleFailure(
        runWithPostgres({
          command: successfulCommand,
          dependencies: harness.dependencies,
        }),
        1,
        'CI PostgreSQL published port is invalid',
      )
      assert.equal(
        harness.dockerCalls.filter(call => call.argv[0] === 'rm').length,
        1,
      )
    })
  }
})

test('SIGINT 在 env file 完成后到达时不再启动 Docker', async (t) => {
  const harness = await createHarness(t, { signalAfterEnvFile: 'SIGINT' })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    130,
    'CI PostgreSQL child command interrupted',
  )
  assert.deepEqual(harness.dockerCalls, [])
  assert.deepEqual(harness.kills, [])
  assert.equal(harness.observed.filesystemRemoveCalls, 1)
  assert.equal(harness.signalSource.listenerCount('SIGINT'), 0)
  assert.equal(harness.signalSource.listenerCount('SIGTERM'), 0)
})

test('SIGTERM 先于 docker run 失败时保留 signal 退出码', async (t) => {
  const harness = await createHarness(t, {
    dockerRunExitCode: 9,
    signalOnDockerRun: 'SIGTERM',
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    143,
    'CI PostgreSQL child command interrupted',
  )
  assert.equal(harness.outputs.join('').includes(harness.password), false)
  assert.equal(harness.observed.filesystemRemoveCalls, 1)
})

test('SIGINT 后 child completion 拒绝仍保留 signal 退出码', async (t) => {
  const harness = await createHarness(t, {
    deferChild: true,
    rejectChildOnKillSignal: 'SIGINT',
    signalsOnChildStart: ['SIGINT'],
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    130,
    'CI PostgreSQL child command interrupted',
  )
  assert.equal(harness.outputs.join('').includes(harness.password), false)
  assert.equal(
    harness.dockerCalls.filter(call => call.argv[0] === 'rm').length,
    1,
  )
})

test('child handle 返回前同步 SIGINT 仍优先进入中断路径', async (t) => {
  const harness = await createHarness(t, {
    deferChild: true,
    resolveChildOnKillSignal: 'SIGINT',
    synchronousSignalOnChildStart: 'SIGINT',
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    130,
    'CI PostgreSQL child command interrupted',
  )
  assert.deepEqual(harness.kills, [
    { processGroupId: -4242, signal: 'SIGINT' },
  ])
  assert.equal(
    harness.dockerCalls.filter(call => call.argv[0] === 'rm').length,
    1,
  )
})

for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  test(`${signal} 转发精确 child process group 后才清理数据库`, async (t) => {
    const harness = await createHarness(t, {
      deferChild: true,
      resolveChildOnKillSignal: signal,
      signalsOnChildStart: [signal],
    })

    await expectLifecycleFailure(
      runWithPostgres({
        command: successfulCommand,
        dependencies: harness.dependencies,
      }),
      exitCode,
      'CI PostgreSQL child command interrupted',
    )

    assert.deepEqual(harness.kills, [
      { processGroupId: -4242, signal },
    ])
    const killIndex = harness.events.findIndex(event => event.type === 'kill')
    const removeIndex = harness.events.findIndex(
      event => event.type === 'docker' && event.command === 'rm',
    )
    assert.ok(killIndex < removeIndex)
    assert.equal(harness.signalSource.listenerCount('SIGINT'), 0)
    assert.equal(harness.signalSource.listenerCount('SIGTERM'), 0)
  })
}

test('signal 有界等待超时后升级 SIGKILL 且 cleanup 仍只执行一次', async (t) => {
  const harness = await createHarness(t, {
    deferChild: true,
    resolveChildOnKillSignal: 'SIGKILL',
    signalsOnChildStart: ['SIGTERM', 'SIGINT'],
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    143,
    'CI PostgreSQL child command interrupted',
  )
  assert.deepEqual(harness.kills, [
    { processGroupId: -4242, signal: 'SIGTERM' },
    { processGroupId: -4242, signal: 'SIGKILL' },
  ])
  assert.equal(
    harness.dockerCalls.filter(call => call.argv[0] === 'rm').length,
    1,
  )
  assert.equal(harness.observed.filesystemRemoveCalls, 1)
})

test('cleanup 失败只输出安全诊断且不覆盖 child 首个退出码', async (t) => {
  const harness = await createHarness(t, {
    childExitCode: 7,
    dockerRemoveExitCode: 11,
    dockerRemoveStderr: 'unsafe cleanup detail',
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    7,
    'CI PostgreSQL child command failed',
  )
  assert.match(harness.outputs.join(''), /CI PostgreSQL cleanup failed/u)
  assert.doesNotMatch(harness.outputs.join(''), /unsafe cleanup detail/u)
})

test('唯一 cleanup 失败在主流程成功时成为安全非零结果', async (t) => {
  const harness = await createHarness(t, { dockerRemoveExitCode: 11 })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    11,
    'CI PostgreSQL cleanup failed',
  )
})

test('GitHub password mask 失败时不得启动 Docker 或泄露错误', async (t) => {
  const harness = await createHarness(t, {
    maskWriterError: new Error(`mask failed: ${deterministicPassword}`),
  })

  await expectLifecycleFailure(
    runWithPostgres({
      command: successfulCommand,
      dependencies: harness.dependencies,
    }),
    1,
    'CI PostgreSQL lifecycle failed',
  )
  assert.deepEqual(harness.dockerCalls, [])
  assert.equal(harness.outputs.join('').includes(harness.password), false)
})

test('CLI 只接受 -- 后的非空 argv 且错误不回显参数', () => {
  for (const args of [[], ['--'], ['unexpected', 'secret-cli-value']]) {
    const result = spawnSync(process.execPath, [entrypoint, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    })

    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'CI PostgreSQL lifecycle failed\n')
    assert.equal(result.stderr.includes('secret-cli-value'), false)
  }
})
