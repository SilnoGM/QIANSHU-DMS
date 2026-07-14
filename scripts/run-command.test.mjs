import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  CommandExecutionError,
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

test('CommandExecutionError 保留有效退出码和 cause', () => {
  const cause = new Error('spawn failed')
  const error = new CommandExecutionError('Command failed: node', 7, cause)

  assert.equal(error.name, 'CommandExecutionError')
  assert.equal(error.exitCode, 7)
  assert.equal(error.cause, cause)
})

test('CommandExecutionError 将无效退出码归一为 1', () => {
  for (const exitCode of [0, -1, 1.5, 256, Number.NaN, '7', undefined]) {
    const error = new CommandExecutionError('Command failed: node', exitCode)
    assert.equal(error.exitCode, 1)
  }
})

test('CommandExecutionError 的公开退出码不可被外部篡改', () => {
  const error = new CommandExecutionError('Command failed: node', 7)
  const descriptor = Object.getOwnPropertyDescriptor(error, 'exitCode')

  assert.equal(descriptor?.writable, false)
  assert.equal(descriptor?.configurable, false)
  assert.equal(Reflect.set(error, 'exitCode', 9), false)
  assert.equal(error.exitCode, 7)
})

test('可信退出码读取只接受由模块真实构造的命令错误', async () => {
  const runCommandModule = await import('./run-command.mjs')
  const readExitCode = runCommandModule.getTrustedCommandExitCode
  const trustedError = new CommandExecutionError('Command failed: node', 7)
  const forgedError = Object.assign(new Error('forged'), { exitCode: 9 })
  Object.setPrototypeOf(forgedError, CommandExecutionError.prototype)

  assert.equal(typeof readExitCode, 'function')
  assert.equal(readExitCode(trustedError), 7)
  assert.equal(readExitCode(forgedError), undefined)
  assert.equal(readExitCode(new Error('unknown')), undefined)
})

test('runCommand 使用真实 Node 子进程处理成功退出', async () => {
  await runCommand(process.execPath, ['-e', 'process.exit(0)'])
})

test('runCommand 保留真实子进程的非零退出码', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'process.exit(7)']),
    (error) => {
      assert.equal(error instanceof CommandExecutionError, true)
      assert.equal(error.exitCode, 7)
      return true
    },
  )
})

test('runCommand 将不可执行命令的 spawn error 转为退出码 1', async () => {
  await assert.rejects(
    runCommand('qianshu-command-that-does-not-exist', []),
    (error) => {
      assert.equal(error instanceof CommandExecutionError, true)
      assert.equal(error.exitCode, 1)
      assert.equal(error.cause?.code, 'ENOENT')
      return true
    },
  )
})

test('runCommand 将 spawnImpl 同步 throw 转为退出码 1 并保留 cause', async () => {
  const cause = new Error('synchronous spawn failure')

  await assert.rejects(
    runCommand('fake-command', [], {
      spawnImpl() {
        throw cause
      },
    }),
    (error) => {
      assert.equal(error instanceof CommandExecutionError, true)
      assert.equal(error.exitCode, 1)
      assert.equal(error.cause, cause)
      return true
    },
  )
})

test('runCommand 默认使用 inherit stdio', async () => {
  const child = new EventEmitter()
  const calls = []
  const completion = runCommand('fake-command', [], {
    spawnImpl(command, args, options) {
      calls.push({ command, args, options })
      return child
    },
  })

  child.emit('exit', 0, null)
  await completion

  assert.equal(calls[0].options.env, process.env)
  assert.deepEqual({ ...calls[0], options: {
    cwd: calls[0].options.cwd,
    stdio: calls[0].options.stdio,
  } }, {
    command: 'fake-command',
    args: [],
    options: { cwd: undefined, stdio: 'inherit' },
  })
})

test('runCommand 原样转发显式 env object', async () => {
  const child = new EventEmitter()
  const calls = []
  const expectedEnv = {
    DATABASE_URL: 'postgresql://redacted',
    NODE_ENV: 'test',
  }
  const completion = runCommand('fake-command', [], {
    env: expectedEnv,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options })
      return child
    },
  })

  child.emit('exit', 0, null)
  await completion

  assert.equal(calls[0].options.env, expectedEnv)
})

test('runCommand 转发 cwd 与 stdio，并将 SIGINT 转为退出码 130', async () => {
  const child = new EventEmitter()
  const calls = []
  const completion = runCommand('fake-command', ['--flag'], {
    cwd: '/tmp/qianshu-run-command-test',
    stdio: 'pipe',
    spawnImpl(command, args, options) {
      calls.push({ command, args, options })
      return child
    },
  })

  child.emit('exit', null, 'SIGINT')

  await assert.rejects(completion, (error) => {
    assert.equal(error.exitCode, 130)
    return true
  })
  assert.equal(calls[0].options.env, process.env)
  assert.deepEqual({ ...calls[0], options: {
    cwd: calls[0].options.cwd,
    stdio: calls[0].options.stdio,
  } }, {
    command: 'fake-command',
    args: ['--flag'],
    options: {
      cwd: '/tmp/qianshu-run-command-test',
      stdio: 'pipe',
    },
  })
})

test('runCommand 将未知 signal 归一为退出码 1', async () => {
  const child = new EventEmitter()
  const completion = runCommand('fake-command', [], {
    spawnImpl: () => child,
  })

  child.emit('exit', null, 'SIG_QIANSHU_UNKNOWN')

  await assert.rejects(completion, (error) => {
    assert.equal(error.exitCode, 1)
    return true
  })
})

test('runCommand 在 error 与 exit 连续触发时只采用首个结果', async () => {
  const child = new EventEmitter()
  const spawnError = Object.assign(new Error('cannot spawn'), { code: 'ENOENT' })
  const completion = runCommand('fake-command', [], {
    spawnImpl: () => child,
  })

  child.emit('error', spawnError)
  child.emit('exit', 7, null)

  await assert.rejects(completion, (error) => {
    assert.equal(error.exitCode, 1)
    assert.equal(error.cause, spawnError)
    return true
  })
})

test('applyFailureToProcess 保留命令失败码并输出安全消息', () => {
  const processRef = { exitCode: undefined }
  const messages = []
  const consoleRef = { error: message => messages.push(message) }

  applyFailureToProcess(
    new CommandExecutionError('Command failed: fake-command', 7),
    processRef,
    consoleRef,
  )

  assert.equal(processRef.exitCode, 7)
  assert.deepEqual(messages, ['Command failed: fake-command'])
})

test('applyFailureToProcess 将未知错误归一为 1 且不泄露错误内容', () => {
  const processRef = { exitCode: undefined }
  const messages = []
  const consoleRef = { error: message => messages.push(message) }

  applyFailureToProcess(
    new Error('DATABASE_URL=postgres://secret'),
    processRef,
    consoleRef,
  )

  assert.equal(processRef.exitCode, 1)
  assert.deepEqual(messages, ['Command failed unexpectedly'])
})

test('applyFailureToProcess 拒绝真实 Error 通过替换 prototype 伪造命令错误', () => {
  const processRef = { exitCode: undefined }
  const messages = []
  const consoleRef = { error: message => messages.push(message) }
  const forgedError = Object.assign(
    new Error('DATABASE_URL=postgres://prototype-secret'),
    { exitCode: 7 },
  )
  Object.setPrototypeOf(forgedError, CommandExecutionError.prototype)

  applyFailureToProcess(forgedError, processRef, consoleRef)

  assert.equal(processRef.exitCode, 1)
  assert.deepEqual(messages, ['Command failed unexpectedly'])
})

test('applyFailureToProcess 不触发伪造命令错误的 throwing getter', () => {
  const processRef = { exitCode: undefined }
  const messages = []
  const consoleRef = { error: message => messages.push(message) }
  const forgedError = new Error('DATABASE_URL=postgres://getter-secret')
  Object.defineProperty(forgedError, 'exitCode', {
    get() {
      throw new Error('exitCode getter must not run')
    },
  })
  Object.setPrototypeOf(forgedError, CommandExecutionError.prototype)

  assert.doesNotThrow(() => {
    applyFailureToProcess(forgedError, processRef, consoleRef)
  })
  assert.equal(processRef.exitCode, 1)
  assert.deepEqual(messages, ['Command failed unexpectedly'])
})

test('isDirectEntry 通过绝对入口路径判断，且不会把其他入口误判为直接执行', () => {
  const modulePath = path.join('/tmp', 'qianshu-dms', 'scripts', 'bootstrap.mjs')
  const moduleUrl = pathToFileURL(modulePath).href

  assert.equal(isDirectEntry(moduleUrl, ['node', modulePath]), true)
  assert.equal(
    isDirectEntry(moduleUrl, ['node', path.join('/tmp', 'outside', 'test.mjs')]),
    false,
  )
  assert.equal(isDirectEntry(moduleUrl, ['node']), false)
})
