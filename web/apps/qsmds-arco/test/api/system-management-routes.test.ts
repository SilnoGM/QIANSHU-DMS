import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由契约使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import userRolesRoutes, {
  ADMIN_USER_ROLE_READ_PERMISSIONS,
} from '../../src/router/modules/admin.user-roles'
import basicDataRoutes, {
  BASIC_DATA_READ_PERMISSIONS,
} from '../../src/router/modules/basic.data'
import productManagementRoutes, {
  PRODUCT_MANAGEMENT_PERMISSIONS,
} from '../../src/router/modules/product.management'
import supplierPaymentProfilesRoute, {
  SUPPLIER_PAYMENT_PROFILE_PERMISSIONS,
} from '../../src/router/modules/supplier.payment.profiles'
import systemAuditRoute from '../../src/router/modules/system.audit'
import systemDevelopmentMapRoute from '../../src/router/modules/system.development-map'
import systemReleaseNotesRoute from '../../src/router/modules/system.release-notes'
import systemStatusRoute from '../../src/router/modules/system.status'

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
    /import BasicData, \{ BASIC_DATA_READ_PERMISSIONS \} from '\.\/modules\/basic\.data'/u,
  )
  assert.match(
    routesSource,
    /import UserRoles, \{ ADMIN_USER_ROLE_READ_PERMISSIONS \} from '\.\/modules\/admin\.user-roles'/u,
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

test('管理员工作台 any-of 门槛由四个子模块读取权限并集构成', () => {
  const unionMatch = routesSource.match(
    /const ADMIN_WORKBENCH_PERMISSIONS = \[([\s\S]*?)\]/u,
  )
  assert.ok(unionMatch, 'routes.ts 必须声明管理员工作台权限并集常量')
  const unionBody = unionMatch[1]

  for (const spread of [
    '...BASIC_DATA_READ_PERMISSIONS',
    '...PRODUCT_MANAGEMENT_PERMISSIONS',
    '...ADMIN_USER_ROLE_READ_PERMISSIONS',
    '...SUPPLIER_PAYMENT_PROFILE_PERMISSIONS',
  ]) {
    assert.ok(
      unionBody.includes(spread),
      `管理员工作台权限并集缺少 ${spread}`,
    )
  }

  /*
   * route store 会把主导航组的 auth 覆盖到每个一级子路由，App.vue 又校验全部
   * matched 记录，因此并集必须是子模块读取权限的超集，否则会出现菜单可见但
   * 直达 URL 403。并集按四个模块数组展开组合，新增权限自动进入并集。
   */
  const workbenchSection = asyncRoutesSource.slice(
    asyncRoutesSource.indexOf('title: \'管理员工作台\''),
    asyncRoutesSource.indexOf('title: \'系统管理\''),
  )
  assert.match(
    workbenchSection,
    /auth: \[\.\.\.ADMIN_WORKBENCH_PERMISSIONS\]/u,
  )
})

test('管理员工作台主导航门槛覆盖四个子模块的全部叶子权限', () => {
  const unionNames = [...(routesSource.match(
    /const ADMIN_WORKBENCH_PERMISSIONS = \[([\s\S]*?)\]/u,
  )?.[1] ?? '').matchAll(/\.\.\.([A-Z_]+)/gu)].map(match => match[1])
  const permissionArrays: Record<string, readonly string[]> = {
    ADMIN_USER_ROLE_READ_PERMISSIONS,
    BASIC_DATA_READ_PERMISSIONS,
    PRODUCT_MANAGEMENT_PERMISSIONS,
    SUPPLIER_PAYMENT_PROFILE_PERMISSIONS,
  }

  assert.deepEqual(unionNames.sort(), [
    'ADMIN_USER_ROLE_READ_PERMISSIONS',
    'BASIC_DATA_READ_PERMISSIONS',
    'PRODUCT_MANAGEMENT_PERMISSIONS',
    'SUPPLIER_PAYMENT_PROFILE_PERMISSIONS',
  ])

  const union = unionNames.flatMap((name) => {
    const codes = permissionArrays[name]
    assert.ok(codes, `routes.ts 使用了未登记的权限数组 ${name}`)
    return [...codes]
  })
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

  // 每个叶子至少要有一个读取权限落在并集内；缺项即“菜单可见但直达 URL 403”的根因。
  for (const auth of leafAuths) {
    const values = Array.isArray(auth) ? auth : [auth]
    assert.ok(
      values.some(code => code !== '' && union.includes(code)),
      `管理员工作台并集缺少叶子权限 ${JSON.stringify(auth)}`,
    )
  }
  // 无任何管理权限的身份不得看到管理员工作台，单权限身份仍可进入。
  assert.equal(matchesAuthorization([], union), false)
  assert.equal(matchesAuthorization(['regions:read'], union), true)
  assert.equal(matchesAuthorization(['supplier-payment-profiles:read'], union), true)
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

test('首页复用管理读取权限门槛，使无业务页面的身份进入稳定 403', () => {
  assert.match(
    routesSource,
    /export const MANAGEMENT_READ_PERMISSIONS = \[[\s\S]*?'users:read',[\s\S]*?'roles:read',[\s\S]*?'audit:read',[\s\S]*?'regions:read',[\s\S]*?\]/u,
  )
  assert.match(
    routesSource,
    /path: ''[\s\S]*?meta: \{[\s\S]*?auth: \[\.\.\.MANAGEMENT_READ_PERMISSIONS\]/u,
  )
})

test('系统管理平铺版本更新、开发图谱与系统状态三个只读页面', () => {
  const readOnlyRoutes = [
    { icon: 'qs-release-notes', name: 'systemReleaseNotes', path: '/system/release-notes', route: systemReleaseNotesRoute, title: '版本更新' },
    { icon: 'qs-development-map', name: 'systemDevelopmentMap', path: '/system/development-map', route: systemDevelopmentMapRoute, title: '开发图谱' },
    { icon: 'qs-system-status', name: 'systemStatus', path: '/system/status', route: systemStatusRoute, title: '系统状态' },
  ] as const

  for (const item of readOnlyRoutes) {
    assert.equal(item.route.path, item.path)
    assert.equal(item.route.name, item.name)
    assert.equal(item.route.meta?.title, item.title)
    assert.equal(item.route.meta?.icon, item.icon)
    // 单页菜单与应用配置同款：侧边栏直接落在页面上，不出现折叠分组。
    assert.equal(item.route.meta?.singleMenu, true)
    // 内容为构建期产物、公开健康接口与当前身份自己的信息，不设单独权限码。
    assert.equal(item.route.meta?.auth, undefined)
    assert.equal(item.route.meta?.auths, undefined)
  }

  assert.match(routesSource, /import SystemReleaseNotes from '\.\/modules\/system\.release-notes'/u)
  assert.match(routesSource, /import SystemDevelopmentMap from '\.\/modules\/system\.development-map'/u)
  assert.match(routesSource, /import SystemStatus from '\.\/modules\/system\.status'/u)
  assert.match(
    asyncRoutesSource,
    /title: '系统管理'[\s\S]*?children: \[[\s\S]*?SystemAudit,[\s\S]*?ApplicationSettings,[\s\S]*?SystemReleaseNotes,[\s\S]*?SystemDevelopmentMap,[\s\S]*?SystemStatus,/u,
  )

  // 系统管理分组保持权限中立：门槛只落在需要鉴权的叶子上，新增页面不得改动分组语义。
  const systemManagementSection = asyncRoutesSource.slice(asyncRoutesSource.indexOf('title: \'系统管理\''))
  assert.doesNotMatch(systemManagementSection, /auth:/u)
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
