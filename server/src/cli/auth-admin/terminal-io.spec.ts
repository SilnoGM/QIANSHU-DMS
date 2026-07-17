import { EventEmitter } from 'node:events'

import {
  AuthAdminCliCancelledError,
  AuthAdminTerminalInputError,
  NodeTerminalIO,
} from './terminal-io'

class FakeInput extends EventEmitter {
  isTTY = true
  isRaw = false
  paused = true
  readonly setRawMode = jest.fn((rawMode: boolean) => {
    this.isRaw = rawMode
    return this
  })
  readonly isPaused = jest.fn(() => this.paused)
  readonly resume = jest.fn(() => {
    this.paused = false
    return this
  })
  readonly pause = jest.fn(() => {
    this.paused = true
    return this
  })
}

class FakeOutput {
  isTTY = true
  readonly chunks: string[] = []
  readonly write = jest.fn((chunk: string) => {
    this.chunks.push(chunk)
    return true
  })
}

describe('NodeTerminalIO hidden input', () => {
  it('collects a password in raw mode without echoing any character', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const io = new NodeTerminalIO(input as never, output as never)

    const result = io.readSecret('永久密码: ')
    input.emit('keypress', '敏', { name: undefined, ctrl: false, meta: false })
    input.emit('keypress', '感', { name: undefined, ctrl: false, meta: false })
    input.emit('keypress', undefined, { name: 'backspace', ctrl: false, meta: false })
    input.emit('keypress', 'X', { name: 'x', ctrl: false, meta: false })
    input.emit('keypress', undefined, { name: 'return', ctrl: false, meta: false })

    await expect(result).resolves.toBe('敏X')
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(input.resume).toHaveBeenCalledTimes(1)
    expect(input.pause).toHaveBeenCalledTimes(1)
    expect(input.isPaused()).toBe(true)
    expect(output.chunks.join('')).toBe('永久密码: \n')
    expect(output.chunks.join('')).not.toContain('敏')
    expect(output.chunks.join('')).not.toContain('X')
  })

  it('restores terminal mode and returns a fixed cancellation error on Ctrl-C', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const io = new NodeTerminalIO(input as never, output as never)

    const result = io.readSecret('新密码: ')
    input.emit('keypress', undefined, { name: 'c', ctrl: true, meta: false })

    await expect(result).rejects.toBeInstanceOf(AuthAdminCliCancelledError)
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(output.chunks.join('')).toBe('新密码: \n')
  })

  it('does not pause stdin after input when it was already flowing', async () => {
    const input = new FakeInput()
    input.paused = false
    const output = new FakeOutput()
    const io = new NodeTerminalIO(input as never, output as never)

    const result = io.readSecret('密码: ')
    input.emit('keypress', undefined, { name: 'return', ctrl: false, meta: false })

    await expect(result).resolves.toBe('')
    expect(input.pause).not.toHaveBeenCalled()
    expect(input.isPaused()).toBe(false)
  })

  it.each([
    ['end', undefined],
    ['error', new Error('password=must-not-leak')],
  ] as const)(
    'restores the terminal and rejects with a fixed error when stdin emits %s',
    async (eventName, eventValue) => {
      const input = new FakeInput()
      const output = new FakeOutput()
      const io = new NodeTerminalIO(input as never, output as never)

      const result = io.readSecret('密码: ')
      input.emit(eventName, eventValue)

      await expect(result).rejects.toBeInstanceOf(AuthAdminTerminalInputError)
      await expect(result).rejects.toThrow('终端输入已中断')
      expect(input.setRawMode.mock.calls).toEqual([[true], [false]])
      expect(input.pause).toHaveBeenCalledTimes(1)
      expect(input.isPaused()).toBe(true)
      expect(output.chunks.join('')).not.toContain('must-not-leak')
    },
  )

  it('treats Ctrl-D as an interrupted input and restores the paused state', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const io = new NodeTerminalIO(input as never, output as never)

    const result = io.readSecret('密码: ')
    input.emit('keypress', undefined, { name: 'd', ctrl: true, meta: false })

    await expect(result).rejects.toBeInstanceOf(AuthAdminTerminalInputError)
    expect(input.pause).toHaveBeenCalledTimes(1)
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]])
  })
})
