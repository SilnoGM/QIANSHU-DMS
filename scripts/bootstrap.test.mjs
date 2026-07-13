import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { bootstrap } from './bootstrap.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const expectedCommands = [
  ['pnpm', ['-C', 'server', 'install'], { cwd: repositoryRoot }],
  ['pnpm', ['-C', 'web', 'install'], { cwd: repositoryRoot }],
]

test('bootstrap 严格按照 Server 到 Web 的顺序安装', async () => {
  const calls = []

  await bootstrap(async (command, args, options) => {
    calls.push([command, args, options])
  })

  assert.deepEqual(calls, expectedCommands)
})

test('bootstrap 在 Server 安装失败后立即停止', async () => {
  const calls = []
  const expectedError = new Error('server install failed')

  await assert.rejects(
    bootstrap(async (command, args, options) => {
      calls.push([command, args, options])
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
    bootstrap(async (command, args, options) => {
      calls.push([command, args, options])
      if (calls.length === 2) {
        throw expectedError
      }
    }),
    error => error === expectedError,
  )

  assert.deepEqual(calls, expectedCommands)
})
