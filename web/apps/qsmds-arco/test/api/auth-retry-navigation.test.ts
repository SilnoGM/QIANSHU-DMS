import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 纯导航决策使用 Node.js 内置 runner 即可验证。
import test from 'node:test'

import {
  resolveAuthRetryNavigation,
  resolveForcedPasswordCompletionNavigation,
  resolveRequestedFullPath,
} from '../../src/store/modules/app/auth-retry-navigation'

test('身份重试恢复认证时重新进入原业务路径', () => {
  assert.equal(
    resolveAuthRetryNavigation('authenticated', '/system/users?page=2', '/'),
    '/system/users?page=2',
  )
})

test('身份重试收敛为匿名时进入登录并保留原业务 redirect', () => {
  assert.deepEqual(
    resolveAuthRetryNavigation('anonymous', '/system/users?page=2', '/'),
    {
      name: 'login',
      query: { redirect: '/system/users?page=2' },
    },
  )
  assert.deepEqual(
    resolveAuthRetryNavigation('anonymous', '/', '/'),
    {
      name: 'login',
      query: {},
    },
  )
})

test('仍不可用或进入强制改密时不制造额外导航', () => {
  assert.equal(resolveAuthRetryNavigation('unavailable', '/system/users', '/'), null)
  assert.equal(
    resolveAuthRetryNavigation('password_change_required', '/system/users', '/'),
    null,
  )
})

test('强制改密状态变为已认证时，即使 Modal 已卸载也回到首页', () => {
  assert.equal(
    resolveForcedPasswordCompletionNavigation(
      'password_change_required',
      'authenticated',
      '/',
    ),
    '/',
  )
  assert.equal(
    resolveForcedPasswordCompletionNavigation(
      'anonymous',
      'authenticated',
      '/',
    ),
    null,
  )
  assert.equal(
    resolveForcedPasswordCompletionNavigation(
      'password_change_required',
      'unavailable',
      '/',
    ),
    null,
  )
})

test('首次导航被网络故障中止时，从真实 hash 地址恢复原深链', () => {
  assert.equal(
    resolveRequestedFullPath('/', '#/system/users?page=2'),
    '/system/users?page=2',
  )
  assert.equal(
    resolveRequestedFullPath('/system/roles', '#invalid-fragment'),
    '/system/roles',
  )
  assert.equal(resolveRequestedFullPath('/', ''), '/')
})
