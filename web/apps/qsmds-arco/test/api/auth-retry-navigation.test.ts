import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 纯导航决策使用 Node.js 内置 runner 即可验证。
import test from 'node:test'

import { AuthLifecycleCoordinator } from '../../src/store/modules/app/auth-lifecycle'
import {
  isAuthRouteAuthorized,
  resolveAuthPermissionFallback,
  resolveAuthRetryNavigation,
  resolveAuthSynchronizationNavigation,
  resolveForcedPasswordCompletionNavigation,
  resolveRequestedFullPath,
  shouldRequestAuthRouteReconciliation,
  toForcedAuthNavigation,
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

test('跨标签退出进入登录页并保留业务路径，已在登录页时不重复重定向', () => {
  assert.deepEqual(resolveAuthSynchronizationNavigation({
    currentFullPath: '/system/users?page=2',
    currentRouteName: 'systemUsers',
    homeFullPath: '/',
    loginRedirect: undefined,
    state: 'anonymous',
  }), {
    name: 'login',
    query: { redirect: '/system/users?page=2' },
  })
  assert.equal(resolveAuthSynchronizationNavigation({
    currentFullPath: '/login?redirect=/system/users',
    currentRouteName: 'login',
    homeFullPath: '/',
    loginRedirect: '/system/users',
    state: 'anonymous',
  }), null)
})

test('初始自动重验的 401 收敛为 anonymous 后请求路由协调并保留深链 redirect', async () => {
  const coordinator = new AuthLifecycleCoordinator({
    getMe: async () => {
      throw Object.assign(new Error('simulated authentication required'), {
        body: {
          code: 'AUTHENTICATION_REQUIRED',
          message: '需要登录',
          requestId: 'req-background-authentication-required',
        },
        kind: 'http',
        status: 401,
      })
    },
    onIdentityBoundary: () => undefined,
    onMutationRevalidated: () => undefined,
    onPermissionsChanged: () => undefined,
  })
  coordinator.state.authState = 'unavailable'
  const previousState = coordinator.state.authState

  await coordinator.revalidateAuth({ broadcastSessionInvalid: false })

  assert.equal(coordinator.state.authState, 'anonymous')
  assert.equal(shouldRequestAuthRouteReconciliation({
    currentState: coordinator.state.authState,
    previousState,
    routeDomainChanged: false,
    routeReconciliationPending: false,
  }), true)
  assert.deepEqual(resolveAuthSynchronizationNavigation({
    currentFullPath: '/system/users?page=2',
    currentRouteName: 'notFound',
    homeFullPath: '/',
    loginRedirect: undefined,
    state: 'anonymous',
  }), {
    name: 'login',
    query: { redirect: '/system/users?page=2' },
  })
})

test('认证状态和身份域均未变化时不重复请求路由协调', () => {
  assert.equal(shouldRequestAuthRouteReconciliation({
    currentState: 'authenticated',
    previousState: 'authenticated',
    routeDomainChanged: false,
    routeReconciliationPending: false,
  }), false)
  assert.equal(shouldRequestAuthRouteReconciliation({
    currentState: 'unavailable',
    previousState: 'loading',
    routeDomainChanged: true,
    routeReconciliationPending: true,
  }), false)
})

test('跨标签重新登录离开登录页，拒绝会回到登录页的 redirect 循环', () => {
  assert.equal(resolveAuthSynchronizationNavigation({
    currentFullPath: '/login?redirect=/system/users',
    currentRouteName: 'login',
    homeFullPath: '/',
    loginRedirect: '/system/users',
    state: 'authenticated',
  }), '/system/users')
  assert.equal(resolveAuthSynchronizationNavigation({
    currentFullPath: '/login?redirect=/login',
    currentRouteName: 'login',
    homeFullPath: '/',
    loginRedirect: '/login',
    state: 'authenticated',
  }), '/')
  assert.equal(resolveAuthSynchronizationNavigation({
    currentFullPath: '/login?redirect=//outside.example',
    currentRouteName: 'login',
    homeFullPath: '/',
    loginRedirect: '//outside.example',
    state: 'authenticated',
  }), '/')
})

test('Session 轮换后重新进入当前路由，并按最新权限判断是否需要降级', () => {
  assert.equal(resolveAuthSynchronizationNavigation({
    currentFullPath: '/system/users?page=2',
    currentRouteName: 'systemUsers',
    homeFullPath: '/',
    loginRedirect: undefined,
    state: 'authenticated',
  }), '/system/users?page=2')
  assert.equal(isAuthRouteAuthorized([
    ['users:read', 'roles:read'],
    'users:read',
  ], ['roles:read']), false)
  assert.equal(isAuthRouteAuthorized([
    ['users:read', 'roles:read'],
    'roles:read',
  ], ['roles:read']), true)
  assert.equal(resolveAuthPermissionFallback({
    currentAllowed: false,
    currentFullPath: '/system/users',
    fallbackFullPath: '/system/roles',
    state: 'authenticated',
  }), '/system/roles')
  assert.equal(resolveAuthPermissionFallback({
    currentAllowed: false,
    currentFullPath: '/',
    fallbackFullPath: '/',
    state: 'authenticated',
  }), null)
  assert.equal(resolveAuthPermissionFallback({
    currentAllowed: true,
    currentFullPath: '/system/users',
    fallbackFullPath: '/system/roles',
    state: 'authenticated',
  }), null)
})

test('身份域清理后的同路径导航强制经过 Guard，不能被 Router 当作重复导航跳过', () => {
  assert.deepEqual(toForcedAuthNavigation('/missing-page'), {
    force: true,
    path: '/missing-page',
  })
  assert.deepEqual(toForcedAuthNavigation({
    name: 'login',
    query: { redirect: '/system/users' },
  }), {
    force: true,
    name: 'login',
    query: { redirect: '/system/users' },
  })
})
