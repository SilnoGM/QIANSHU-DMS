import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runDevelopment } from './dev.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const expectedCommands = [
  ['pnpm', ['-C', 'server', 'dev'], { cwd: repositoryRoot, stdio: 'inherit' }],
  ['pnpm', ['-C', 'web', 'dev'], { cwd: repositoryRoot, stdio: 'inherit' }],
]

class FakeChild extends EventEmitter {
  constructor({ killEmitsError = false, killError, pid = 1_000 } = {}) {
    super()
    this.killEmitsError = killEmitsError
    this.killError = killError
    this.killSignals = []
    this.pid = pid
  }

  kill(signal) {
    this.killSignals.push(signal)
    if (this.killEmitsError) {
      this.emit('error', new Error('kill emitted error'))
    }
    if (this.killError) {
      throw this.killError
    }
    return true
  }
}

function createHarness({
  killEmitsErrorAt = [],
  killThrowsAt = [],
  notStartedAt = [],
  throwAt,
} = {}) {
  const calls = []
  const children = []
  const processRef = new EventEmitter()
  const spawnError = new Error('synchronous spawn failure')

  const spawnImpl = (command, args, options) => {
    const callIndex = calls.length
    calls.push([command, args, options])
    if (callIndex === throwAt) {
      throw spawnError
    }

    const child = new FakeChild({
      killEmitsError: killEmitsErrorAt.includes(callIndex),
      killError: killThrowsAt.includes(callIndex)
        ? new Error('kill failed with DATABASE_URL=secret')
        : undefined,
      pid: notStartedAt.includes(callIndex) ? undefined : 1_000 + callIndex,
    })
    children.push(child)
    return child
  }

  return {
    calls,
    children,
    options: { spawnImpl, processRef },
    processRef,
    spawnError,
  }
}

async function assertPending(promise) {
  const pending = Symbol('pending')
  assert.equal(
    await Promise.race([promise, Promise.resolve(pending)]),
    pending,
  )
}

test('立即并行启动 Server 与 Web，均正常退出后返回 0', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  assert.deepEqual(harness.calls, expectedCommands)
  harness.children[0].emit('exit', 0, null)
  harness.children[1].emit('exit', 0, null)

  assert.equal(await completion, 0)
})

test('Server 首先返回 7 时终止 Web 并保留退出码 7', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('exit', 7, null)
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
  await assertPending(completion)
  harness.children[1].emit('exit', null, 'SIGTERM')

  assert.equal(await completion, 7)
})

test('已启动 Web 在 kill 时发出 error 仍等待真实 exit', async () => {
  const harness = createHarness({ killEmitsErrorAt: [1] })
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('exit', 7, null)
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
  await assertPending(completion)
  harness.children[1].emit('exit', null, 'SIGTERM')

  assert.equal(await completion, 7)
})

test('已有失败码时仍转发后续根信号且不覆盖首码', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('exit', 7, null)
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
  harness.processRef.emit('SIGINT')
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM', 'SIGINT'])
  harness.children[1].emit('exit', null, 'SIGINT')

  assert.equal(await completion, 7)
  assert.equal(harness.processRef.listenerCount('SIGINT'), 0)
  assert.equal(harness.processRef.listenerCount('SIGTERM'), 0)
})

test('Web 首先返回 9 时终止 Server 并保留退出码 9', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  harness.children[1].emit('exit', 9, null)
  assert.deepEqual(harness.children[0].killSignals, ['SIGTERM'])
  await assertPending(completion)
  harness.children[0].emit('exit', null, 'SIGTERM')

  assert.equal(await completion, 9)
})

test('一个子进程正常退出时等待另一个正常退出', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('exit', 0, null)
  assert.deepEqual(harness.children[1].killSignals, [])
  await assertPending(completion)
  harness.children[1].emit('exit', 0, null)

  assert.equal(await completion, 0)
})

for (const [signal, expectedExitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`根进程收到 ${signal} 时原样转发并返回 ${expectedExitCode}`, async () => {
    const harness = createHarness()
    const completion = runDevelopment(harness.options)

    harness.processRef.emit(signal)
    assert.deepEqual(harness.children[0].killSignals, [signal])
    assert.deepEqual(harness.children[1].killSignals, [signal])
    await assertPending(completion)
    harness.children[0].emit('exit', null, signal)
    harness.children[1].emit('exit', null, signal)

    assert.equal(await completion, expectedExitCode)
  })
}

for (const [signal, expectedExitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIG_QIANSHU_UNKNOWN', 1],
]) {
  test(`子进程直接收到 ${signal} 时映射为 ${expectedExitCode} 并清理 peer`, async () => {
    const harness = createHarness()
    const completion = runDevelopment(harness.options)

    harness.children[0].emit('exit', null, signal)
    assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
    await assertPending(completion)
    harness.children[1].emit('exit', null, 'SIGTERM')

    assert.equal(await completion, expectedExitCode)
  })
}

test('子进程 error 返回 1、清理 peer，后续 exit 不覆盖结果', async () => {
  const harness = createHarness({ notStartedAt: [0] })
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('error', new Error('spawn failed'))
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
  harness.children[0].emit('exit', 7, null)
  await assertPending(completion)
  harness.children[1].emit('exit', null, 'SIGTERM')

  assert.equal(await completion, 1)
})

test('spawn 事件将无 pid 子进程标记为 started，error 后等待真实 exit', async () => {
  const harness = createHarness({ notStartedAt: [0] })
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('spawn')
  harness.children[0].emit('error', new Error('started child error'))
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
  harness.children[1].emit('exit', null, 'SIGTERM')
  await assertPending(completion)
  harness.children[0].emit('exit', 1, null)

  assert.equal(await completion, 1)
})

test('第一个 spawn 同步 throw 时不启动第二个并返回 1', async () => {
  const harness = createHarness({ throwAt: 0 })

  assert.equal(await runDevelopment(harness.options), 1)
  assert.deepEqual(harness.calls, expectedCommands.slice(0, 1))
  assert.equal(harness.children.length, 0)
})

test('第二个 spawn 同步 throw 时清理已启动子进程并返回 1', async () => {
  const harness = createHarness({ throwAt: 1 })
  const completion = runDevelopment(harness.options)

  assert.deepEqual(harness.calls, expectedCommands)
  assert.deepEqual(harness.children[0].killSignals, ['SIGTERM'])
  await assertPending(completion)
  harness.children[0].emit('exit', null, 'SIGTERM')

  assert.equal(await completion, 1)
})

test('两个子进程近乎同时失败时保留首个观察到的退出码', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('exit', 7, null)
  harness.children[1].emit('exit', 9, null)

  assert.equal(await completion, 7)
})

test('完成后移除根进程的 SIGINT 和 SIGTERM listeners', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  assert.equal(harness.processRef.listenerCount('SIGINT'), 1)
  assert.equal(harness.processRef.listenerCount('SIGTERM'), 1)
  harness.children[0].emit('exit', 0, null)
  harness.children[1].emit('exit', 0, null)
  await completion

  assert.equal(harness.processRef.listenerCount('SIGINT'), 0)
  assert.equal(harness.processRef.listenerCount('SIGTERM'), 0)
})

test('kill 抛错时继续等待 peer，且不覆盖首个失败码', async () => {
  const harness = createHarness({ killThrowsAt: [1] })
  const completion = runDevelopment(harness.options)

  harness.children[0].emit('exit', 7, null)
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
  await assertPending(completion)
  harness.children[1].emit('exit', 0, null)

  assert.equal(await completion, 7)
})
