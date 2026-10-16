import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由契约使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import userRolesRoutes, {
  ADMIN_USER_ROLE_READ_PERMISSIONS,
} from '../../src/router/modules/admin.user-roles'
import applicationSettingsRoute from '../../src/router/modules/application.settings'
import basicDataRoutes from '../../src/router/modules/basic.data'
import productManagementRoutes from '../../src/router/modules/product.management'
import supplierPaymentProfilesRoute from '../../src/router/modules/supplier.payment.profiles'
import systemAuditRoute from '../../src/router/modules/system.audit'
import {
  ADMIN_WORKBENCH_PERMISSION,
  SYSTEM_MANAGEMENT_PERMISSION,
} from '../../src/router/modules/workbench-access'

const routesSource = readFileSync(
  new URL('../../src/router/routes.ts', import.meta.url),
  'utf8',
)
const asyncRoutesSource = routesSource.slice(routesSource.indexOf('const asyncRoutes'))

test('审计日志上移为系统管理直接子项并保留原路径与路由名', () => {
  assert.equal(systemAuditRoute.path, '/system/audit')
  assert.equal(systemAuditRoute.name, 'systemAudit')
  assert.equal(systemAuditRoute.meta?.title, '审计日志')
  assert.equal(systemAuditRoute.meta?.auth, 'audit:read')
  assert.equal(systemAuditRoute.meta?.icon, 'qs-audit-log')
  // 单页菜单与应用配置同款：侧边栏直接落在审计日志，面包屑仍显示「系统管理 / 审计日志」。
  assert.equal(systemAuditRoute.meta?.singleMenu, true)
})

test('用户与角色分组按读取权限隔离三个管理页面', () => {
  assert.deepEqual(ADMIN_USER_ROLE_READ_PERMISSIONS, ['users:read', 'roles:read'])
  assert.equal(userRolesRoutes.path, '/admin')
  assert.equal(userRolesRoutes.name, 'adminUserRoles')
  assert.equal(userRolesRoutes.meta?.title, '用户与角色')
  assert.equal(userRolesRoutes.meta?.icon, 'qs-access-control')
  assert.deepEqual(userRolesRoutes.meta?.auth, ['users:read', 'roles:read'])

  assert.deepEqual(
    userRolesRoutes.children?.map(route => ({
      auth: route.meta?.auth,
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      { auth: 'users:read', name: 'systemUsers', path: 'users', title: '用户管理' },
      { auth: 'roles:read', name: 'systemRoles', path: 'roles', title: '角色管理' },
      { auth: 'roles:read', name: 'systemPermissions', path: 'permissions', title: '权限目录' },
    ],
  )
  // 分组 any-of 集合必须覆盖每个叶子的读取权限，否则叶子可见时分组已被整体过滤。
  for (const route of userRolesRoutes.children ?? []) {
    assert.equal(
      matchesAuthorization([...ADMIN_USER_ROLE_READ_PERMISSIONS], route.meta?.auth ?? ''),
      true,
    )
  }
})

test('顶层主导航按目标结构装配管理员工作台与系统管理', () => {
  assert.match(
    routesSource,
    /import BasicData from '\.\/modules\/basic\.data'/u,
  )
  assert.match(
    routesSource,
    /import UserRoles from '\.\/modules\/admin\.user-roles'/u,
  )
  assert.match(
    routesSource,
    /import SystemAudit from '\.\/modules\/system\.audit'/u,
  )
  assert.match(
    asyncRoutesSource,
    /title: '管理员工作台'[\s\S]*?children: \[[\s\S]*?BasicData,[\s\S]*?ProductManagement,[\s\S]*?UserRoles,[\s\S]*?SupplierPaymentProfiles,/u,
  )
  assert.match(
    asyncRoutesSource,
    /title: '系统管理'[\s\S]*?children: \[[\s\S]*?SystemAudit,[\s\S]*?ApplicationSettings,/u,
  )

  // 原「权限体系」分组已解散：管理页面不再位于系统管理主路由内。
  const systemManagementSection = asyncRoutesSource.slice(
    asyncRoutesSource.indexOf('title: \'管理员工作台\''),
    asyncRoutesSource.indexOf('title: \'系统管理\''),
  )
  assert.doesNotMatch(systemManagementSection, /SystemAudit/u)
  assert.doesNotMatch(systemManagementSection, /ApplicationSettings/u)
})

test('管理员工作台由独立准入码收敛，业务读码不再放行', () => {
  assert.equal(ADMIN_WORKBENCH_PERMISSION, 'workbench:admin')
  // 并集门槛已退役：历史缺陷是四个子模块读取权限的并集当作准入门槛，
  // 任何业务角色获得并集中的一条（如运营/财务的 exchange-rates:read）就能进入。
  assert.doesNotMatch(routesSource, /ADMIN_WORKBENCH_PERMISSIONS/u)
  const workbenchSection = asyncRoutesSource.slice(
    asyncRoutesSource.indexOf('title: \'管理员工作台\''),
    asyncRoutesSource.indexOf('title: \'系统管理\''),
  )
  assert.match(
    workbenchSection,
    /auth: \[ADMIN_WORKBENCH_PERMISSION\]/u,
  )

  // 四个子模块的读取码都不等于工作台准入：单条业务码不得放行管理员工作台。
  for (const code of [
    'regions:read',
    'currencies:read',
    'exchange-rates:read',
    'numbering-rules:read',
    'purchase-shipping-marks:read',
    'dictionaries:read',
    'products:read',
    'products:create',
    'users:read',
    'roles:read',
    'supplier-payment-profiles:read',
  ]) {
    assert.equal(
      matchesAuthorization([code], ADMIN_WORKBENCH_PERMISSION),
      false,
      `${code} 不得放行管理员工作台`,
    )
  }
  assert.equal(matchesAuthorization([], ADMIN_WORKBENCH_PERMISSION), false)
  assert.equal(
    matchesAuthorization([ADMIN_WORKBENCH_PERMISSION], ADMIN_WORKBENCH_PERMISSION),
    true,
  )
})

test('管理员工作台每个叶子仍各自声明业务权限', () => {
  const leafAuths: Array<string | string[]> = []
  const collectLeafAuths = (route: { children?: unknown, meta?: { auth?: string | string[] } } | undefined): void => {
    if (!route) {
      return
    }
    const children = route.children as Array<typeof route> | undefined
    if (children?.length) {
      children.forEach(collectLeafAuths)
      return
    }
    leafAuths.push(route.meta?.auth ?? '')
  }
  for (const module of [
    basicDataRoutes,
    productManagementRoutes,
    userRolesRoutes,
    supplierPaymentProfilesRoute,
  ]) {
    collectLeafAuths(module)
  }

  // 准入码只决定工作台本身：叶子必须保留自己的业务码，否则只有准入码的身份
  // 就能进入该模块的全部页面。
  for (const auth of leafAuths) {
    const values = Array.isArray(auth) ? auth : [auth]
    assert.ok(
      values.some(code => code !== ''),
      `管理员工作台叶子缺少业务权限：${JSON.stringify(auth)}`,
    )
    assert.ok(
      values.every(code => code !== ADMIN_WORKBENCH_PERMISSION),
      `叶子不得直接用工作台准入码当作页面权限：${JSON.stringify(auth)}`,
    )
  }
  // 基础数据父级保持权限中立，菜单过滤交给叶子；准入由工作台准入码承担。
  assert.equal(basicDataRoutes.meta?.auth, undefined)
  assert.deepEqual(
    productManagementRoutes.meta?.auth,
    ['products:read', 'products:create', 'products:update'],
  )
  assert.deepEqual(userRolesRoutes.meta?.auth, ['users:read', 'roles:read'])
  assert.deepEqual(
    supplierPaymentProfilesRoute.meta?.auth,
    ['supplier-payment-profiles:read'],
  )
})

test('系统管理主导航始终注册独立应用配置页面且不受环境变量控制', () => {
  const applicationSettingsRouteSource = readFileSync(
    new URL('../../src/router/modules/application.settings.ts', import.meta.url),
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
})

test('系统管理分组用系统专用权限 audit:read 收敛，只有管理员可进入', () => {
  assert.equal(SYSTEM_MANAGEMENT_PERMISSION, 'audit:read')
  // audit:read 在权限目录里 system_only = true，普通角色无法分配，因此「只有管理员可进入」由权限目录保证。
  assert.match(
    asyncRoutesSource,
    /title: '系统管理'[\s\S]{0,200}?auth: \[SYSTEM_MANAGEMENT_PERMISSION\]/u,
  )
  // 应用配置自身不声明 auth，继承分组门槛；审计日志页面自身的 audit:read 保持不变。
  assert.equal(applicationSettingsRoute.meta?.auth, undefined)
  assert.equal(systemAuditRoute.meta?.auth, 'audit:read')
})

test('首页不参与页面权限校验，任一已登录身份均可进入', () => {
  const homeRouteSource = routesSource.slice(
    routesSource.indexOf('component: () => import(\'@/views/index.vue\')'),
    routesSource.indexOf('path: \'reload\''),
  )
  assert.ok(homeRouteSource.includes('meta: {'), 'routes.ts 必须声明首页路由')

  // 首页是登录后的默认落点，不能再声明 meta.auth，否则缺少管理读取权限的身份一登录就落到 403。
  assert.doesNotMatch(homeRouteSource, /\bauth\b/u)
  assert.doesNotMatch(routesSource, /MANAGEMENT_READ_PERMISSIONS/u)
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
