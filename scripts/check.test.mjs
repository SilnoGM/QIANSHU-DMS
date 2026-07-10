import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { check } from './check.mjs'

const expectedCommands = [
  [process.execPath, ['--run', 'test:root']],
  ['pnpm', ['-C', 'server', 'check']],
  ['pnpm', ['-C', 'web', 'check']],
]

test('check 严格按照 Root、Server、Web 的顺序执行且不自动修复', async () => {
  const calls = []

  await check(async (command, args) => {
    calls.push([command, args])
  })

  assert.deepEqual(calls, expectedCommands)
  assert.equal(calls.flat(2).includes('--fix'), false)
})

for (const [failureIndex, label] of ['Root', 'Server', 'Web'].entries()) {
  test(`check 在 ${label} 失败后立即停止并保留同一错误`, async () => {
    const calls = []
    const expectedError = new Error(`${label} check failed`)

    await assert.rejects(
      check(async (command, args) => {
        calls.push([command, args])
        if (calls.length === failureIndex + 1) {
          throw expectedError
        }
      }),
      error => error === expectedError,
    )

    assert.deepEqual(calls, expectedCommands.slice(0, failureIndex + 1))
  })
}
