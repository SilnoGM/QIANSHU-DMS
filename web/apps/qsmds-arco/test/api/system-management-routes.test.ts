import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由契约使用 Node.js 内置 runner。
import test from 'node:test'

import systemManagementRoutes, {
  MANAGEMENT_READ_PERMISSIONS,
} from '../../src/router/modules/system.management'

test('系统管理路由按读取权限隔离四个管理页面', () => {
  assert.equal(systemManagementRoutes.path, '/system')
  assert.equal(systemManagementRoutes.meta?.title, '权限体系')
  assert.deepEqual(systemManagementRoutes.meta?.auth, [
    'users:read',
    'roles:read',
    'audit:read',
    'regions:read',
  ])

  assert.deepEqual(
    systemManagementRoutes.children?.map(route => ({
      auth: route.meta?.auth,
      name: route.name,
      path: route.path,
    })),
    [
      { auth: 'users:read', name: 'systemUsers', path: 'users' },
      { auth: 'roles:read', name: 'systemRoles', path: 'roles' },
      { auth: 'roles:read', name: 'systemPermissions', path: 'permissions' },
      { auth: 'audit:read', name: 'systemAudit', path: 'audit' },
    ],
  )
})

test('系统管理主导航下的一级菜单显示权限体系且不改变路由边界', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    routesSource,
    /const asyncRoutes:[\s\S]*?meta: \{[\s\S]*?title: '系统管理',[\s\S]*?children: \[[\s\S]*?SystemManagement/u,
  )
  assert.match(routesSource, /import SystemManagement,[\s\S]*?from '\.\/modules\/system\.management'/u)
})

test('系统管理主导航始终注册独立应用配置页面且不受环境变量控制', () => {
  const applicationSettingsRouteSource = readFileSync(
    new URL('../../src/router/modules/application.settings.ts', import.meta.url),
    'utf8',
  )
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )

  assert.match(applicationSettingsRouteSource, /path: '\/system\/application-settings'/u)
  assert.match(applicationSettingsRouteSource, /name: 'systemApplicationSettings'/u)
  assert.match(applicationSettingsRouteSource, /title: '应用配置'/u)
  assert.match(applicationSettingsRouteSource, /singleMenu: true/u)
  assert.doesNotMatch(applicationSettingsRouteSource, /import\.meta\.env|VITE_APP_SETTING/u)
  assert.match(
    routesSource,
    /import ApplicationSettings from '\.\/modules\/application\.settings'/u,
  )
  assert.match(
    routesSource,
    /title: '系统管理'[\s\S]*?children: \[[\s\S]*?SystemManagement,[\s\S]*?ApplicationSettings/u,
  )
})

test('首页复用管理读取权限门槛，使无业务页面的身份进入稳定 403', () => {
  assert.deepEqual(MANAGEMENT_READ_PERMISSIONS, [
    'users:read',
    'roles:read',
    'audit:read',
    'regions:read',
  ])

  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )
  assert.match(
    routesSource,
    /path: ''[\s\S]*?meta: \{[\s\S]*?auth: \[\.\.\.MANAGEMENT_READ_PERMISSIONS\]/u,
  )
})

test('无业务权限的已登录用户仍可从 403 页面打开账户菜单', () => {
  const notAllowedSource = readFileSync(
    new URL('../../src/components/AppNotAllowed/index.vue', import.meta.url),
    'utf8',
  )

  assert.match(notAllowedSource, /useAppAccountStore\(\)/u)
  assert.match(
    notAllowedSource,
    /appAccountStore\.authState === 'authenticated'[\s\S]*?<AppAccountButton/u,
  )
})
