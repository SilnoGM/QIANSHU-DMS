import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ensurePnpm, isPnpmUserAgent } from './ensure-pnpm.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.join(scriptsDirectory, 'ensure-pnpm.mjs')

test('只接受 pnpm user agent', () => {
  assert.equal(isPnpmUserAgent('pnpm/11.9.0 npm/? node/v24.16.0 darwin arm64'), true)
  assert.equal(isPnpmUserAgent('npm/11.0.0 node/v24.16.0 darwin arm64'), false)
  assert.equal(isPnpmUserAgent('yarn/4.0.0 npm/? node/v24.16.0 darwin arm64'), false)
  assert.equal(isPnpmUserAgent(''), false)
  assert.equal(isPnpmUserAgent(undefined), false)
})

test('失败信息固定且不回显 user agent', () => {
  const messages = []
  const result = ensurePnpm('npm/private-environment-value', message => messages.push(message))

  assert.equal(result, false)
  assert.deepEqual(messages, ['This project requires pnpm.'])
  assert.equal(messages.join('\n').includes('private-environment-value'), false)
})

test('直接执行守卫时 pnpm 成功，其他调用方失败', () => {
  const pnpmResult = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { npm_config_user_agent: 'pnpm/11.9.0 npm/? node/v24.16.0 darwin arm64' },
  })
  assert.equal(pnpmResult.status, 0)
  assert.equal(pnpmResult.stderr, '')

  for (const userAgent of ['npm/11.0.0 node/v24.16.0', '']) {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: userAgent ? { npm_config_user_agent: userAgent } : {},
    })
    assert.equal(result.status, 1)
    assert.equal(result.stderr.trim(), 'This project requires pnpm.')
    assert.equal(result.stdout, '')
  }
})
