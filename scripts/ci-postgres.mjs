import { randomBytes as nodeRandomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import * as nodeFilesystem from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { isDirectEntry } from './run-command.mjs'

export const POSTGRES_IMAGE =
  'postgres:16@sha256:be01cf82fc7dbba824acf0a82e150b4b360f3ff93c6631d7844af431e841a95c'

const requiredFilesystemMethods = [
  'chmod',
  'mkdtemp',
  'readFile',
  'rm',
  'writeFile',
]
const requiredDependencyFunctions = [
  'childRunner',
  'clock',
  'dockerRunner',
  'maskWriter',
  'outputWriter',
  'randomBytes',
  'wait',
]
const requiredSignalSourceMethods = ['kill', 'off', 'on']
const databaseName = 'qianshu_ci'
const databaseUser = 'qianshu_ci'
const healthTimeoutMilliseconds = 30_000
const healthWaitMilliseconds = 1_000
const signalGraceMilliseconds = 5_000

class CiPostgresError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'CiPostgresError'
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0
      ? exitCode
      : 1
  }
}

function inputError() {
  return new CiPostgresError('CI PostgreSQL lifecycle input is invalid')
}

function lifecycleError(message, exitCode = 1) {
  return new CiPostgresError(message, exitCode)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertLifecycleInput(command, dependencies) {
  if (
    !Array.isArray(command)
    || !Object.isFrozen(command)
    || command.length === 0
    || command.some(value => (
      typeof value !== 'string'
      || value.length === 0
      || value.includes('\0')
    ))
    || !isRecord(dependencies)
    || !isRecord(dependencies.environment)
    || !isRecord(dependencies.filesystem)
    || !isRecord(dependencies.signalSource)
    || requiredDependencyFunctions.some(
      name => typeof dependencies[name] !== 'function',
    )
    || requiredFilesystemMethods.some(
      name => typeof dependencies.filesystem[name] !== 'function',
    )
    || requiredSignalSourceMethods.some(
      name => typeof dependencies.signalSource[name] !== 'function',
    )
  ) {
    throw inputError()
  }
}

export function assertOwnedContainerId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('CI PostgreSQL container ownership is invalid')
  }
  return value
}

export function redactSensitiveText(value, sensitiveValues) {
  const orderedSecrets = [...new Set(sensitiveValues
    .filter(secret => typeof secret === 'string' && secret.length > 0)
  )].sort((left, right) => right.length - left.length)
  return orderedSecrets.reduce(
    (text, secret) => text.split(secret).join('***'),
    String(value),
  )
}

function normalizeLifecycleError(error) {
  if (error instanceof CiPostgresError) {
    return error
  }
  if (error?.message === 'CI PostgreSQL container ownership is invalid') {
    return lifecycleError(error.message)
  }
  return lifecycleError('CI PostgreSQL lifecycle failed')
}

function normalizeRunnerResult(result) {
  if (
    !isRecord(result)
    || !Number.isInteger(result.exitCode)
    || result.exitCode < 0
    || typeof result.stdout !== 'string'
    || typeof result.stderr !== 'string'
  ) {
    throw lifecycleError('CI PostgreSQL lifecycle failed')
  }
  return result
}

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : 143
}

function exitCodeFromChild(code, signal) {
  if (Number.isInteger(code)) {
    return code === 0 ? 0 : code > 0 ? code : 1
  }
  const signalNumber = typeof signal === 'string'
    ? os.constants.signals[signal]
    : undefined
  return Number.isInteger(signalNumber) && signalNumber > 0
    ? 128 + signalNumber
    : 1
}

function runBufferedProcess(command, argv) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, argv, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      resolve({ exitCode: 1, stderr: '', stdout: '' })
      return
    }

    const stdout = []
    const stderr = []
    let settled = false
    const settle = (result) => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }
    child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.once('error', () => {
      settle({ exitCode: 1, stderr: '', stdout: '' })
    })
    child.once('exit', (code, signal) => {
      settle({
        exitCode: exitCodeFromChild(code, signal),
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      })
    })
  })
}

function startChildProcess({ argv, detached, env, onStderr, onStdout }) {
  let child
  try {
    child = spawn(argv[0], argv.slice(1), {
      detached,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return {
      completion: Promise.resolve({ exitCode: 1, stderr: '', stdout: '' }),
      pid: undefined,
    }
  }

  const completion = new Promise((resolve) => {
    let settled = false
    const settle = (exitCode) => {
      if (settled) {
        return
      }
      settled = true
      resolve({ exitCode, stderr: '', stdout: '' })
    }
    child.stdout?.on('data', chunk => onStdout(String(chunk)))
    child.stderr?.on('data', chunk => onStderr(String(chunk)))
    child.once('error', () => settle(1))
    child.once('exit', (code, signal) => {
      settle(exitCodeFromChild(code, signal))
    })
  })

  return { completion, pid: child.pid }
}

function productionDependencies() {
  return {
    childRunner: startChildProcess,
    clock: Date.now,
    dockerRunner: ({ argv }) => runBufferedProcess('docker', argv),
    environment: { ...process.env },
    filesystem: nodeFilesystem,
    maskWriter: value => process.stdout.write(`::add-mask::${value}\n`),
    outputWriter: value => process.stderr.write(value),
    randomBytes: nodeRandomBytes,
    signalSource: process,
    wait: milliseconds => new Promise(
      resolve => setTimeout(resolve, milliseconds),
    ),
  }
}

function parseCliCommand(argv) {
  if (
    !Array.isArray(argv)
    || argv.length < 2
    || argv[0] !== '--'
    || argv.slice(1).some(value => (
      typeof value !== 'string'
      || value.length === 0
      || value.includes('\0')
    ))
  ) {
    throw inputError()
  }
  return Object.freeze(argv.slice(1))
}

export async function runWithPostgres(input = {}) {
  const command = isRecord(input) ? input.command : undefined
  const dependencies = isRecord(input) ? input.dependencies : undefined
  assertLifecycleInput(command, dependencies)

  const {
    childRunner,
    clock,
    dockerRunner,
    environment,
    filesystem,
    maskWriter,
    outputWriter,
    randomBytes,
    signalSource,
    wait,
  } = dependencies
  const sensitiveValues = []
  let childHandle
  let cleanupPromise
  let containerId
  let primaryError
  let requestedSignal
  let sessionDirectory
  let signalForwarded = false
  let resolveSignal
  const registeredSignals = []
  const signalPromise = new Promise((resolve) => {
    resolveSignal = resolve
  })

  const safeWrite = (value) => {
    if (value === '') {
      return
    }
    outputWriter(redactSensitiveText(value, sensitiveValues))
  }

  const forwardSignalToChild = (signal) => {
    if (
      signalForwarded
      || !childHandle
      || !Number.isInteger(childHandle.pid)
      || childHandle.pid <= 0
    ) {
      return
    }
    signalForwarded = true
    try {
      // 生产 child 以 detached 模式创建，负 PID 精确指向其进程组。
      signalSource.kill(-childHandle.pid, signal)
    } catch {
      // kill 失败不泄露底层上下文；主流程仍会按有界等待路径升级终止。
    }
  }

  const handleSignal = (signal) => {
    if (requestedSignal !== undefined) {
      return
    }
    requestedSignal = signal
    resolveSignal(signal)
    forwardSignalToChild(signal)
  }
  const handleSigint = () => handleSignal('SIGINT')
  const handleSigterm = () => handleSignal('SIGTERM')

  const throwIfInterrupted = () => {
    if (requestedSignal !== undefined && childHandle === undefined) {
      throw lifecycleError(
        'CI PostgreSQL child command interrupted',
        signalExitCode(requestedSignal),
      )
    }
  }

  const runDocker = async (argv) => {
    let result
    try {
      result = normalizeRunnerResult(await dockerRunner({
        argv: Object.freeze([...argv]),
      }))
    } catch (error) {
      if (error instanceof CiPostgresError) {
        throw error
      }
      throw lifecycleError('CI PostgreSQL Docker command failed')
    }
    safeWrite(result.stdout)
    safeWrite(result.stderr)
    if (result.exitCode !== 0) {
      throw lifecycleError(
        'CI PostgreSQL Docker command failed',
        result.exitCode,
      )
    }
    return result
  }

  const cleanup = () => {
    if (cleanupPromise) {
      return cleanupPromise
    }
    cleanupPromise = (async () => {
      let cleanupFailure

      if (containerId !== undefined) {
        try {
          const result = normalizeRunnerResult(await dockerRunner({
            argv: Object.freeze([
              'rm',
              '--force',
              '--volumes',
              containerId,
            ]),
          }))
          if (result.exitCode !== 0) {
            cleanupFailure = lifecycleError(
              'CI PostgreSQL cleanup failed',
              result.exitCode,
            )
          }
        } catch {
          cleanupFailure = lifecycleError('CI PostgreSQL cleanup failed')
        }
      }

      if (sessionDirectory !== undefined) {
        try {
          await filesystem.rm(sessionDirectory, {
            force: true,
            recursive: true,
          })
        } catch {
          cleanupFailure ??= lifecycleError('CI PostgreSQL cleanup failed')
        }
      }

      if (cleanupFailure) {
        try {
          outputWriter('CI PostgreSQL cleanup failed\n')
        } catch {
          // cleanup 诊断通道失败不能覆盖更早的业务退出码。
        }
      }
      return cleanupFailure
    })()
    return cleanupPromise
  }

  try {
    signalSource.on('SIGINT', handleSigint)
    registeredSignals.push(['SIGINT', handleSigint])
    signalSource.on('SIGTERM', handleSigterm)
    registeredSignals.push(['SIGTERM', handleSigterm])

    sessionDirectory = await filesystem.mkdtemp(
      path.join(os.tmpdir(), 'qianshu-ci-postgres-'),
    )
    await filesystem.chmod(sessionDirectory, 0o700)
    throwIfInterrupted()

    const passwordBytes = randomBytes(32)
    if (!Buffer.isBuffer(passwordBytes) || passwordBytes.length !== 32) {
      throw lifecycleError('CI PostgreSQL lifecycle failed')
    }
    const password = passwordBytes.toString('base64url')
    sensitiveValues.push(password)
    if (environment.GITHUB_ACTIONS === 'true') {
      maskWriter(password)
    }
    throwIfInterrupted()

    const envFile = path.join(sessionDirectory, 'postgres.env')
    const cidFile = path.join(sessionDirectory, 'postgres.cid')
    await filesystem.writeFile(
      envFile,
      `POSTGRES_USER=${databaseUser}\nPOSTGRES_DB=${databaseName}\nPOSTGRES_PASSWORD=${password}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    )
    // 信号可能在异步写文件期间到达；启动 Docker 前必须再次检查，避免
    // 为已经取消的任务创建新容器。
    throwIfInterrupted()

    await runDocker([
      'run',
      '--detach',
      '--cidfile',
      cidFile,
      '--env-file',
      envFile,
      '--label',
      `qianshu-dms.ci-session=${path.basename(sessionDirectory)}`,
      '--publish',
      '127.0.0.1::5432/tcp',
      '--health-cmd',
      `pg_isready -U ${databaseUser} -d ${databaseName}`,
      '--health-interval',
      '1s',
      '--health-timeout',
      '5s',
      '--health-retries',
      '30',
      POSTGRES_IMAGE,
    ])
    containerId = assertOwnedContainerId(
      await filesystem.readFile(cidFile, 'utf8'),
    )
    throwIfInterrupted()

    const healthStartedAt = clock()
    if (!Number.isFinite(healthStartedAt)) {
      throw lifecycleError('CI PostgreSQL lifecycle failed')
    }
    const healthDeadline = healthStartedAt + healthTimeoutMilliseconds
    while (true) {
      const healthResult = await runDocker([
        'inspect',
        '--format',
        '{{.State.Health.Status}}',
        containerId,
      ])
      throwIfInterrupted()
      if (/^healthy\n?$/u.test(healthResult.stdout)) {
        break
      }
      if (!/^starting\n?$/u.test(healthResult.stdout)) {
        throw lifecycleError('CI PostgreSQL health check failed')
      }
      const currentTime = clock()
      if (!Number.isFinite(currentTime)) {
        throw lifecycleError('CI PostgreSQL lifecycle failed')
      }
      if (currentTime >= healthDeadline) {
        throw lifecycleError('CI PostgreSQL health check timed out')
      }
      await wait(healthWaitMilliseconds)
      throwIfInterrupted()
    }

    const portResult = await runDocker([
      'port',
      containerId,
      '5432/tcp',
    ])
    throwIfInterrupted()
    const portMatch = /^127\.0\.0\.1:([1-9][0-9]{0,4})\n?$/u.exec(
      portResult.stdout,
    )
    const port = portMatch ? Number(portMatch[1]) : Number.NaN
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw lifecycleError('CI PostgreSQL published port is invalid')
    }

    const databaseUrl =
      `postgresql://${databaseUser}:${password}@127.0.0.1:${port}/${databaseName}?schema=public`
    sensitiveValues.push(databaseUrl)
    if (environment.GITHUB_ACTIONS === 'true') {
      maskWriter(databaseUrl)
    }
    throwIfInterrupted()

    childHandle = childRunner({
      argv: command,
      detached: true,
      env: {
        ...environment,
        DATABASE_URL: databaseUrl,
        // 媒体 E2E 只允许在本次 CI session 内创建临时对象；父编排器在
        // 正常退出、失败或信号中断时统一递归清理，避免污染真实媒体根目录。
        QIANSHU_CI_TEMP_ROOT: sessionDirectory,
      },
      onStderr: safeWrite,
      onStdout: safeWrite,
    })
    if (
      !isRecord(childHandle)
      || !Number.isInteger(childHandle.pid)
      || childHandle.pid <= 0
      || !childHandle.completion
      || typeof childHandle.completion.then !== 'function'
    ) {
      throw lifecycleError('CI PostgreSQL lifecycle failed')
    }

    const childCompletion = Promise.resolve(childHandle.completion)
      .then(normalizeRunnerResult)
      .catch((error) => {
        if (error instanceof CiPostgresError) {
          throw error
        }
        throw lifecycleError('CI PostgreSQL child command failed')
      })
    if (requestedSignal !== undefined) {
      forwardSignalToChild(requestedSignal)
    }
    const outcome = await Promise.race([
      childCompletion.then(result => ({ result, type: 'child' })),
      signalPromise.then(signal => ({ signal, type: 'signal' })),
    ])

    if (outcome.type === 'signal') {
      const gracefulOutcome = await Promise.race([
        childCompletion.then(() => 'exited'),
        wait(signalGraceMilliseconds).then(() => 'timeout'),
      ])
      if (gracefulOutcome === 'timeout') {
        try {
          signalSource.kill(-childHandle.pid, 'SIGKILL')
        } catch {
          // SIGKILL 失败不改变原 signal 退出码；仍等待真实 child 终态。
        }
        await childCompletion
      }
      throw lifecycleError(
        'CI PostgreSQL child command interrupted',
        signalExitCode(outcome.signal),
      )
    }

    if (outcome.result.exitCode !== 0) {
      throw lifecycleError(
        'CI PostgreSQL child command failed',
        outcome.result.exitCode,
      )
    }
  } catch (error) {
    // signal handler 只会在底层 runner 仍进行时先写入 requestedSignal；若随后
    // Docker/child 才返回错误，必须保留先观察到的 130/143，而不是后到的码。
    primaryError = requestedSignal === undefined
      ? normalizeLifecycleError(error)
      : lifecycleError(
          'CI PostgreSQL child command interrupted',
          signalExitCode(requestedSignal),
        )
  } finally {
    for (const [signal, listener] of registeredSignals) {
      try {
        signalSource.off(signal, listener)
      } catch {
        primaryError ??= lifecycleError('CI PostgreSQL lifecycle failed')
      }
    }
    const cleanupFailure = await cleanup()
    if (!primaryError && cleanupFailure) {
      primaryError = cleanupFailure
    }
  }

  if (primaryError) {
    throw primaryError
  }
  return 0
}

if (isDirectEntry(import.meta.url)) {
  Promise.resolve()
    .then(() => parseCliCommand(process.argv.slice(2)))
    .then(command => runWithPostgres({
      command,
      dependencies: productionDependencies(),
    }))
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error) => {
      process.exitCode = error instanceof CiPostgresError
        ? error.exitCode
        : 1
      // CLI 不回显 argv、底层异常、容器输出或连接信息；详细输出已在生命周期内脱敏。
      process.stderr.write('CI PostgreSQL lifecycle failed\n')
    })
}
