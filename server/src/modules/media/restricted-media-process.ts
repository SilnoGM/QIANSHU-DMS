import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process'
import { isAbsolute, parse, resolve } from 'node:path'

export type RestrictedMediaProcessErrorCode =
  | 'MEDIA_PROCESS_CONFIGURATION_INVALID'
  | 'MEDIA_PROCESS_EXIT_NON_ZERO'
  | 'MEDIA_PROCESS_OUTPUT_LIMIT'
  | 'MEDIA_PROCESS_TIMEOUT'
  | 'MEDIA_PROCESS_UNAVAILABLE'

const RESTRICTED_PROCESS_MESSAGES: Readonly<Record<RestrictedMediaProcessErrorCode, string>> = {
  MEDIA_PROCESS_CONFIGURATION_INVALID: 'Media validator process configuration is invalid',
  MEDIA_PROCESS_EXIT_NON_ZERO: 'Media validator process rejected the content',
  MEDIA_PROCESS_OUTPUT_LIMIT: 'Media validator process output limit exceeded',
  MEDIA_PROCESS_TIMEOUT: 'Media validator process timed out',
  MEDIA_PROCESS_UNAVAILABLE: 'Media validator process is unavailable',
}

export class RestrictedMediaProcessError extends Error {
  readonly code: RestrictedMediaProcessErrorCode

  constructor(code: RestrictedMediaProcessErrorCode) {
    super(RESTRICTED_PROCESS_MESSAGES[code])
    this.name = 'RestrictedMediaProcessError'
    this.code = code
  }
}

export interface RestrictedMediaProcessRequest {
  readonly arguments: readonly string[]
  readonly executablePath: string
  readonly stderrLimitBytes: number
  readonly stdoutLimitBytes: number
  readonly timeoutMs: number
}

export interface RestrictedMediaProcessResult {
  readonly stdout: string
}

export type RestrictedMediaSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function validateRequest(request: RestrictedMediaProcessRequest): void {
  const normalizedExecutable = resolve(request.executablePath)
  if (
    !isAbsolute(request.executablePath) ||
    normalizedExecutable === parse(normalizedExecutable).root ||
    request.executablePath.includes('\0') ||
    !Array.isArray(request.arguments) ||
    request.arguments.some(argument => (
      typeof argument !== 'string' || argument.includes('\0')
    )) ||
    !isPositiveSafeInteger(request.timeoutMs) ||
    !isPositiveSafeInteger(request.stdoutLimitBytes) ||
    !isPositiveSafeInteger(request.stderrLimitBytes)
  ) {
    throw new RestrictedMediaProcessError('MEDIA_PROCESS_CONFIGURATION_INVALID')
  }
}

/**
 * 用固定安全选项运行媒体解析器。stdout 只在成功且未超限时返回；stderr 仅计数后丢弃，
 * 任一路径都不会把命令、参数、文件路径或第三方诊断拼入异常。
 */
export function runRestrictedMediaProcess(
  request: RestrictedMediaProcessRequest,
  spawnProcess: RestrictedMediaSpawn = spawn,
): Promise<RestrictedMediaProcessResult> {
  try {
    validateRequest(request)
  }
  catch (error) {
    return Promise.reject(
      error instanceof RestrictedMediaProcessError
        ? error
        : new RestrictedMediaProcessError('MEDIA_PROCESS_CONFIGURATION_INVALID'),
    )
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcess
    try {
      child = spawnProcess(request.executablePath, request.arguments, {
        env: { LANG: 'C', LC_ALL: 'C' },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    }
    catch {
      rejectPromise(new RestrictedMediaProcessError('MEDIA_PROCESS_UNAVAILABLE'))
      return
    }

    if (!child.stdout || !child.stderr) {
      child.kill('SIGKILL')
      rejectPromise(new RestrictedMediaProcessError('MEDIA_PROCESS_UNAVAILABLE'))
      return
    }

    let settled = false
    let stdoutSize = 0
    let stderrSize = 0
    const stdoutChunks: Buffer[] = []

    const settleFailure = (code: RestrictedMediaProcessErrorCode): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      child.kill('SIGKILL')
      rejectPromise(new RestrictedMediaProcessError(code))
    }

    const timeout = setTimeout(() => {
      settleFailure('MEDIA_PROCESS_TIMEOUT')
    }, request.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stdoutSize += buffer.length
      if (stdoutSize > request.stdoutLimitBytes) {
        settleFailure('MEDIA_PROCESS_OUTPUT_LIMIT')
        return
      }
      stdoutChunks.push(buffer)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrSize += Buffer.byteLength(chunk)
      if (stderrSize > request.stderrLimitBytes) {
        settleFailure('MEDIA_PROCESS_OUTPUT_LIMIT')
      }
    })
    child.once('error', () => {
      settleFailure('MEDIA_PROCESS_UNAVAILABLE')
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code !== 0) {
        rejectPromise(new RestrictedMediaProcessError('MEDIA_PROCESS_EXIT_NON_ZERO'))
        return
      }
      resolvePromise(Object.freeze({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      }))
    })
  })
}
