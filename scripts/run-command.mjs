import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// 公开 prototype 与属性都可被外部对象伪造，因此只有构造器写入的 WeakMap
// 快照才代表本模块真实创建的命令错误。快照不向调用方暴露 message。
const commandExecutionErrorDetails = new WeakMap()

function normalizeExitCode(exitCode) {
  return Number.isInteger(exitCode) && exitCode >= 1 && exitCode <= 255
    ? exitCode
    : 1
}

function exitCodeFromSignal(signal) {
  const signalNumber = typeof signal === 'string'
    ? osConstants.signals[signal]
    : undefined

  return Number.isInteger(signalNumber) && signalNumber > 0
    ? normalizeExitCode(128 + signalNumber)
    : 1
}

export class CommandExecutionError extends Error {
  constructor(message, exitCode = 1, cause) {
    super(message, { cause })
    const normalizedExitCode = normalizeExitCode(exitCode)
    this.name = 'CommandExecutionError'
    Object.defineProperty(this, 'exitCode', {
      enumerable: true,
      value: normalizedExitCode,
    })
    commandExecutionErrorDetails.set(this, {
      exitCode: normalizedExitCode,
      message: this.message,
    })
  }
}

export function getTrustedCommandExitCode(error) {
  return commandExecutionErrorDetails.get(error)?.exitCode
}

export function runCommand(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    spawnImpl = spawn,
    stdio = 'inherit',
  } = options

  return new Promise((resolve, reject) => {
    let child

    try {
      child = spawnImpl(command, args, { cwd, env, stdio })
    } catch (cause) {
      reject(new CommandExecutionError(`Command failed to start: ${command}`, 1, cause))
      return
    }

    // ChildProcess 在启动失败时可能先发出 error，随后再发出退出类事件。
    // settled 保证 Promise 只采用第一个终态，后续事件不会覆盖真实的首个失败码。
    let settled = false
    const settleOnce = (settle) => {
      if (settled) {
        return
      }
      settled = true
      settle()
    }

    child.once('error', (cause) => {
      settleOnce(() => {
        reject(new CommandExecutionError(`Command failed to start: ${command}`, 1, cause))
      })
    })

    child.once('exit', (code, signal) => {
      settleOnce(() => {
        if (code === 0) {
          resolve()
          return
        }

        // 被信号终止时 code 为 null。Shell 约定使用 128 + signal number，
        // 未知信号无法可靠映射，因此统一回退到通用失败码 1。
        const exitCode = code === null
          ? exitCodeFromSignal(signal)
          : normalizeExitCode(code)
        reject(new CommandExecutionError(`Command failed: ${command}`, exitCode))
      })
    })
  })
}

export function applyFailureToProcess(
  error,
  processRef = process,
  consoleRef = console,
) {
  const trustedDetails = commandExecutionErrorDetails.get(error)
  processRef.exitCode = trustedDetails?.exitCode ?? 1

  // 未知异常可能携带环境变量、请求体或底层连接信息，因此不回显其 message。
  // 真实 CommandExecutionError 使用构造时快照，后续公开属性篡改不会进入日志。
  consoleRef.error(
    trustedDetails?.message ?? 'Command failed unexpectedly',
  )
}

export function isDirectEntry(moduleUrl, argv = process.argv) {
  const entryPath = argv?.[1]
  if (typeof entryPath !== 'string' || entryPath.length === 0) {
    return false
  }

  try {
    // 使用模块文件的绝对路径比较，不依赖当前 cwd；测试从 /tmp 导入模块时，
    // argv[1] 指向测试入口，因此不会误启动真实的 Server/Web 命令。
    return path.normalize(fileURLToPath(moduleUrl)) === path.resolve(entryPath)
  } catch {
    return false
  }
}
