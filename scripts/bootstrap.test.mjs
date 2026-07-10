import assert from 'node:assert/strict'
import test from 'node:test'

import { bootstrap } from './bootstrap.mjs'

const expectedCommands = [
  ['pnpm', ['-C', 'server', 'install']],
  ['pnpm', ['-C', 'web', 'install']],
]

test('bootstrap 严格按照 Server 到 Web 的顺序安装', async () => {
  const calls = []

  await bootstrap(async (command, args) => {
    calls.push([command, args])
  })

  assert.deepEqual(calls, expectedCommands)
})

test('bootstrap 在 Server 安装失败后立即停止', async () => {
  const calls = []
  const expectedError = new Error('server install failed')

  await assert.rejects(
    bootstrap(async (command, args) => {
      calls.push([command, args])
      throw expectedError
    }),
    error => error === expectedError,
  )

  assert.deepEqual(calls, expectedCommands.slice(0, 1))
})

test('bootstrap 向上传播 Web 安装错误', async () => {
  const calls = []
  const expectedError = new Error('web install failed')

  await assert.rejects(
    bootstrap(async (command, args) => {
      calls.push([command, args])
      if (calls.length === 2) {
        throw expectedError
      }
    }),
    error => error === expectedError,
  )

  assert.deepEqual(calls, expectedCommands)
})
