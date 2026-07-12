import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { check } from './check.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const expectedCommands = [
  [process.execPath, ['--run', 'test:root'], { cwd: repositoryRoot }],
  ['pnpm', ['-C', 'server', 'check'], { cwd: repositoryRoot }],
  [
    process.execPath,
    ['./scripts/contract-check.mjs'],
    { cwd: repositoryRoot },
  ],
  ['pnpm', ['-C', 'web', 'check'], { cwd: repositoryRoot }],
]

test('check 严格按照 Root、Server、Contract、Web 的顺序执行且不自动修复', async () => {
  const calls = []

  await check(async (command, args, options) => {
    calls.push([command, args, options])
  })

  assert.deepEqual(calls, expectedCommands)
  assert.equal(calls.flat(2).includes('--fix'), false)
})

for (const [failureIndex, label] of [
  'Root',
  'Server',
  'Contract',
  'Web',
].entries()) {
  test(`check 在 ${label} 失败后立即停止并保留同一错误`, async () => {
    const calls = []
    const expectedError = new Error(`${label} check failed`)

    await assert.rejects(
      check(async (command, args, options) => {
        calls.push([command, args, options])
        if (calls.length === failureIndex + 1) {
          throw expectedError
        }
      }),
      error => error === expectedError,
    )

    assert.deepEqual(calls, expectedCommands.slice(0, failureIndex + 1))
  })
}
