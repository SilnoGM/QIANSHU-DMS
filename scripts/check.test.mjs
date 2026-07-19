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
  [
    process.execPath,
    ['--run', 'ci:browser-auth-e2e'],
    { cwd: repositoryRoot },
  ],
]

test('check 先清理根违规产物，再严格执行其余只读检查', async () => {
  const calls = []
  let cleaned = false

  await check(
    async (command, args, options) => {
      assert.equal(cleaned, true)
      calls.push([command, args, options])
    },
    async () => {
      cleaned = true
    },
  )

  assert.equal(cleaned, true)
  assert.deepEqual(calls, expectedCommands)
  assert.equal(calls.flat(2).includes('--fix'), false)
})

test('check 在根违规产物清理失败后不执行任何检查', async () => {
  const expectedError = new Error('root cleanup failed')
  let runCalled = false

  await assert.rejects(
    check(
      async () => {
        runCalled = true
      },
      async () => {
        throw expectedError
      },
    ),
    error => error === expectedError,
  )
  assert.equal(runCalled, false)
})

for (const [failureIndex, label] of [
  'Root',
  'Server',
  'Contract',
  'Web',
  'Browser E2E',
].entries()) {
  test(`check 在 ${label} 失败后立即停止并保留同一错误`, async () => {
    const calls = []
    const expectedError = new Error(`${label} check failed`)

    await assert.rejects(
      check(
        async (command, args, options) => {
          calls.push([command, args, options])
          if (calls.length === failureIndex + 1) {
            throw expectedError
          }
        },
        async () => {},
      ),
      error => error === expectedError,
    )

    assert.deepEqual(calls, expectedCommands.slice(0, failureIndex + 1))
  })
}
