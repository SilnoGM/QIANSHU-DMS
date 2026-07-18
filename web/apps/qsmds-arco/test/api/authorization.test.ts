import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 权限判定使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'

test('权限判定只读取服务端权限快照，不提供本地设置绕过入口', () => {
  const permissions = ['users:read', 'roles:read']

  assert.equal(matchesAuthorization(permissions, ''), true)
  assert.equal(matchesAuthorization(permissions, 'users:read'), true)
  assert.equal(matchesAuthorization(permissions, 'users:update'), false)
  assert.equal(
    matchesAuthorization(permissions, ['users:update', 'roles:read']),
    true,
  )
  assert.equal(matchesAuthorization(permissions, []), true)
})
