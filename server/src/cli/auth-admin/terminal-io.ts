import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'

import type { AuthAdminIO } from './auth-admin.runner'

type Keypress = Readonly<{
  name?: string
  ctrl?: boolean
  meta?: boolean
}>

export class AuthAdminCliCancelledError extends Error {
  constructor() {
    super('操作已取消')
    this.name = 'AuthAdminCliCancelledError'
  }
}

export class AuthAdminTerminalInputError extends Error {
  constructor() {
    super('终端输入已中断')
    this.name = 'AuthAdminTerminalInputError'
  }
}

/** Node TTY 适配器；密码在 raw mode 中收集，终端只显示提示和换行。 */
export class NodeTerminalIO implements AuthAdminIO {
  constructor(
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
  ) {}

  isInteractive(): boolean {
    return this.input.isTTY === true && this.output.isTTY === true
  }

  async readText(prompt: string): Promise<string> {
    const terminal = createInterface({
      input: this.input,
      output: this.output,
      terminal: true,
    })

    try {
      return await terminal.question(prompt)
    }
    finally {
      terminal.close()
    }
  }

  readSecret(prompt: string): Promise<string> {
    if (!this.isInteractive()) {
      return Promise.reject(new Error('Interactive TTY is unavailable'))
    }

    this.output.write(prompt)
    const originalRawMode = this.input.isRaw === true
    const inputWasPaused = this.input.isPaused()

    return new Promise<string>((resolve, reject) => {
      const codePoints: string[] = []
      let rawModeChanged = false
      let settled = false

      const finish = (error?: Error): void => {
        if (settled) {
          return
        }
        settled = true
        this.input.removeListener('keypress', onKeypress)
        this.input.removeListener('end', onEnd)
        this.input.removeListener('error', onError)

        if (rawModeChanged) {
          try {
            this.input.setRawMode(originalRawMode)
          }
          catch {
            error = new AuthAdminTerminalInputError()
          }
        }
        if (inputWasPaused) {
          this.input.pause()
        }
        this.output.write('\n')

        if (error !== undefined) {
          reject(error)
        }
        else {
          resolve(codePoints.join(''))
        }
      }

      const onKeypress = (character: string | undefined, key: Keypress): void => {
        if (key.ctrl === true && key.name === 'c') {
          finish(new AuthAdminCliCancelledError())
          return
        }
        if (key.ctrl === true && key.name === 'd') {
          finish(new AuthAdminTerminalInputError())
          return
        }
        if (key.name === 'return' || key.name === 'enter') {
          finish()
          return
        }
        if (key.name === 'backspace') {
          codePoints.pop()
          return
        }

        // 控制键、Alt/Meta 组合和转义序列都不进入密码缓冲区。
        if (
          character !== undefined
          && key.ctrl !== true
          && key.meta !== true
          && character !== '\u001b'
        ) {
          codePoints.push(character)
        }
      }

      const onEnd = (): void => {
        finish(new AuthAdminTerminalInputError())
      }

      const onError = (): void => {
        // 原始 Stream Error 可能包含终端或宿主细节，不能向 CLI 外层透传。
        finish(new AuthAdminTerminalInputError())
      }

      this.input.on('keypress', onKeypress)
      this.input.once('end', onEnd)
      this.input.once('error', onError)

      try {
        emitKeypressEvents(this.input)
        this.input.setRawMode(true)
        rawModeChanged = true
        this.input.resume()
      }
      catch {
        finish(new AuthAdminTerminalInputError())
      }
    })
  }

  writeLine(line: string): void {
    this.output.write(`${line}\n`)
  }
}
