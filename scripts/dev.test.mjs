import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  developmentCommandsFor,
  runDevelopment,
  startDevelopment,
} from './dev.mjs'

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
    // 大部分既有测试聚焦直接 ChildProcess 语义，显式关闭进程组后可保持断言单一；
    // 进程组与父进程消失由下方专门测试覆盖。
    options: { spawnImpl, processRef, useProcessGroups: false },
    processRef,
    spawnError,
  }
}

test('开发目标只接受 server、web 或省略值', () => {
  assert.deepEqual(developmentCommandsFor(), expectedCommands.map(
    ([command, args]) => [command, args],
  ))
  assert.deepEqual(developmentCommandsFor('server'), [
    ['pnpm', ['-C', 'server', 'dev']],
  ])
  assert.deepEqual(developmentCommandsFor('web'), [
    ['pnpm', ['-C', 'web', 'dev']],
  ])
  assert.throws(
    () => developmentCommandsFor('unknown'),
    /^Error: Unsupported development target$/,
  )
})

test('开发入口先清理根违规产物再启动目标进程', async () => {
  const events = []

  const exitCode = await startDevelopment('web', {
    async cleanRoot() {
      events.push('cleanup')
    },
    async run(options) {
      events.push(['run', options.commands])
      return 0
    },
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(events, [
    'cleanup',
    ['run', [['pnpm', ['-C', 'web', 'dev']]]],
  ])
})

test('根违规产物清理失败时开发入口不启动任何进程', async () => {
  const expectedError = new Error('cleanup failed')
  let runCalled = false

  await assert.rejects(
    startDevelopment(undefined, {
      async cleanRoot() {
        throw expectedError
      },
      async run() {
        runCalled = true
        return 0
      },
    }),
    error => error === expectedError,
  )
  assert.equal(runCalled, false)
})

test('无效开发目标在清理和启动前被拒绝', async () => {
  let cleanupCalled = false
  let runCalled = false

  await assert.rejects(
    startDevelopment('unknown', {
      async cleanRoot() {
        cleanupCalled = true
      },
      async run() {
        runCalled = true
        return 0
      },
    }),
    /^Error: Unsupported development target$/,
  )
  assert.equal(cleanupCalled, false)
  assert.equal(runCalled, false)
})

test('单端模式只启动指定的开发命令', async () => {
  const harness = createHarness()
  const completion = runDevelopment({
    ...harness.options,
    commands: expectedCommands.slice(0, 1).map(([command, args]) => [
      command,
      args,
    ]),
  })

  assert.deepEqual(harness.calls, expectedCommands.slice(0, 1))
  harness.children[0].emit('exit', 0, null)

  assert.equal(await completion, 0)
})

test('POSIX 进程组模式创建独立组并向完整子树转发信号', async () => {
  const harness = createHarness()
  const groupSignals = []
  harness.processRef.kill = (pid, signal) => {
    groupSignals.push([pid, signal])
    return true
  }

  const completion = runDevelopment({
    ...harness.options,
    useProcessGroups: true,
  })

  assert.deepEqual(
    harness.calls.map(([, , options]) => options.detached),
    [true, true],
  )
  harness.processRef.emit('SIGINT')
  assert.deepEqual(groupSignals, [
    [-1_000, 'SIGINT'],
    [-1_001, 'SIGINT'],
  ])
  assert.deepEqual(harness.children[0].killSignals, [])
  assert.deepEqual(harness.children[1].killSignals, [])
  harness.children[0].emit('exit', null, 'SIGINT')
  harness.children[1].emit('exit', null, 'SIGINT')

  assert.equal(await completion, 130)
})

test('进程组信号失败时回退到直接 ChildProcess 信号', async () => {
  const harness = createHarness()
  harness.processRef.kill = () => {
    throw new Error('process group is unavailable')
  }

  const completion = runDevelopment({
    ...harness.options,
    useProcessGroups: true,
  })

  harness.processRef.emit('SIGTERM')
  assert.deepEqual(harness.children[0].killSignals, ['SIGTERM'])
  assert.deepEqual(harness.children[1].killSignals, ['SIGTERM'])
  harness.children[0].emit('exit', null, 'SIGTERM')
  harness.children[1].emit('exit', null, 'SIGTERM')

  assert.equal(await completion, 143)
})

test('外层 node --run 消失时终止完整进程组并清理监控器', async () => {
  const harness = createHarness()
  const groupSignals = []
  const intervalCallbacks = []
  const clearedIntervals = []
  const intervalHandle = { unref() {} }
  harness.processRef.ppid = 4_000
  harness.processRef.kill = (pid, signal) => {
    groupSignals.push([pid, signal])
    return true
  }

  const completion = runDevelopment({
    ...harness.options,
    useProcessGroups: true,
    setIntervalImpl(callback) {
      intervalCallbacks.push(callback)
      return intervalHandle
    },
    clearIntervalImpl(handle) {
      clearedIntervals.push(handle)
    },
  })

  assert.equal(intervalCallbacks.length, 1)
  harness.processRef.ppid = 1
  intervalCallbacks[0]()
  assert.deepEqual(groupSignals, [
    [-1_000, 'SIGTERM'],
    [-1_001, 'SIGTERM'],
  ])
  harness.children[0].emit('exit', null, 'SIGTERM')
  harness.children[1].emit('exit', null, 'SIGTERM')

  assert.equal(await completion, 143)
  assert.deepEqual(clearedIntervals, [intervalHandle])
})

for (const [scenario, changedOuterParentPid] of [
  ['被重挂到 PID 1', 1],
  ['无法继续读取', undefined],
]) {
  test(`直接父 shell 存活但外层 node --run ${scenario}时终止完整进程组`, async () => {
    const harness = createHarness()
    const groupSignals = []
    const intervalCallbacks = []
    const parentPidReads = [5_000, 5_000, changedOuterParentPid]
    const intervalHandle = { unref() {} }
    harness.processRef.ppid = 4_000
    harness.processRef.kill = (pid, signal) => {
      groupSignals.push([pid, signal])
      return true
    }

    const completion = runDevelopment({
      ...harness.options,
      useProcessGroups: true,
      readParentPidImpl(pid) {
        assert.equal(pid, 4_000)
        return parentPidReads.shift()
      },
      setIntervalImpl(callback) {
        intervalCallbacks.push(callback)
        return intervalHandle
      },
      clearIntervalImpl() {},
    })

    // Linux 的 node --run 会留下仍存活的中间 shell；manager 的直接 PPID
    // 保持不变时不能误杀，只有 shell 的 outer ancestry 变化或不可读取时收口。
    assert.equal(intervalCallbacks.length, 1)
    intervalCallbacks[0]()
    assert.deepEqual(groupSignals, [])
    intervalCallbacks[0]()
    assert.deepEqual(groupSignals, [
      [-1_000, 'SIGTERM'],
      [-1_001, 'SIGTERM'],
    ])
    assert.deepEqual(parentPidReads, [])
    harness.children[0].emit('exit', null, 'SIGTERM')
    harness.children[1].emit('exit', null, 'SIGTERM')

    assert.equal(await completion, 143)
  })
}

test('已经收到根信号后父进程消失不会重复发送降级信号', async () => {
  const harness = createHarness()
  const groupSignals = []
  const intervalCallbacks = []
  harness.processRef.ppid = 4_000
  harness.processRef.kill = (pid, signal) => {
    groupSignals.push([pid, signal])
    return true
  }

  const completion = runDevelopment({
    ...harness.options,
    useProcessGroups: true,
    setIntervalImpl(callback) {
      intervalCallbacks.push(callback)
      return { unref() {} }
    },
    clearIntervalImpl() {},
  })

  harness.processRef.emit('SIGINT')
  harness.processRef.ppid = 1
  intervalCallbacks[0]()
  assert.deepEqual(groupSignals, [
    [-1_000, 'SIGINT'],
    [-1_001, 'SIGINT'],
  ])
  harness.children[0].emit('exit', null, 'SIGINT')
  harness.children[1].emit('exit', null, 'SIGINT')

  assert.equal(await completion, 130)
})

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

for (const [signal, expectedExitCode] of [
  ['SIGHUP', 129],
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
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
  ['SIGHUP', 129],
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

test('完成后移除根进程的 SIGHUP、SIGINT 和 SIGTERM listeners', async () => {
  const harness = createHarness()
  const completion = runDevelopment(harness.options)

  assert.equal(harness.processRef.listenerCount('SIGHUP'), 1)
  assert.equal(harness.processRef.listenerCount('SIGINT'), 1)
  assert.equal(harness.processRef.listenerCount('SIGTERM'), 1)
  harness.children[0].emit('exit', 0, null)
  harness.children[1].emit('exit', 0, null)
  await completion

  assert.equal(harness.processRef.listenerCount('SIGHUP'), 0)
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
