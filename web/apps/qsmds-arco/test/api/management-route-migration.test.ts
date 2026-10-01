import type { RouteRecordRaw } from 'vue-router'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 用真实路由解析验证旧地址重定向及参数保留。
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'

import userRolesRoutes from '../../src/router/modules/admin.user-roles'
import applicationSettingsRoute from '../../src/router/modules/application.settings'
import basicDataRoutes from '../../src/router/modules/basic.data'
import { managementLegacyRedirects } from '../../src/router/modules/management-legacy-redirects'
import systemAuditRoute from '../../src/router/modules/system.audit'

function withoutViews(route: RouteRecordRaw): RouteRecordRaw {
  return { ...route, component: {}, children: route.children?.map(withoutViews) } as RouteRecordRaw
}

function createMigrationRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      ...managementLegacyRedirects,
      withoutViews(basicDataRoutes),
      withoutViews(userRolesRoutes),
      withoutViews(systemAuditRoute),
      withoutViews(applicationSettingsRoute),
    ],
  })
}

test('旧系统管理地址转向管理员工作台新路由并保留查询与锚点', async () => {
  const router = createMigrationRouter()

  for (const [oldPath, name] of [
    ['/system', 'systemUsers'],
    ['/system/users', 'systemUsers'],
    ['/system/roles', 'systemRoles'],
    ['/system/permissions', 'systemPermissions'],
    ['/system/basic-data/regions', 'systemBasicDataRegions'],
    ['/system/basic-data/currencies', 'systemBasicDataCurrencies'],
    ['/system/basic-data/numbering', 'systemBasicDataNumbering'],
    ['/system/basic-data/numbering/shipping-mark-bindings', 'systemBasicDataShippingMarkBindings'],
    ['/system/basic-data/dictionaries', 'systemBasicDataDictionaries'],
  ]) {
    await router.push(`${oldPath}?keyword=region-a#panel`)
    assert.equal(router.currentRoute.value.name, name, `${oldPath} 应转向 ${name}`)
    assert.equal(router.currentRoute.value.query.keyword, 'region-a')
    assert.equal(router.currentRoute.value.hash, '#panel')
    assert.ok(router.currentRoute.value.meta.auth, `${oldPath} 的目标路由必须重新校验权限`)
  }
})

test('旧新增编号规则地址转向新地址并保留 returnTo 上下文', async () => {
  const router = createMigrationRouter()

  await router.push('/system/basic-data/numbering/create?purpose=BUSINESS&returnTo=%2Fsystem%2Fbasic-data%2Fnumbering')

  assert.equal(router.currentRoute.value.name, 'systemBasicDataNumberingCreate')
  assert.equal(router.currentRoute.value.query.purpose, 'BUSINESS')
  assert.equal(router.currentRoute.value.query.returnTo, '/system/basic-data/numbering')
})

test('旧当前汇率地址沿目标路由自身规则合并到货币汇率页签', async () => {
  const router = createMigrationRouter()

  await router.push('/system/basic-data/exchange-rates')

  assert.equal(router.currentRoute.value.name, 'systemBasicDataCurrencies')
  assert.equal(router.currentRoute.value.query.tab, 'exchange-rates')
})

test('未迁移的审计日志与应用配置不注册旧地址重定向', () => {
  const legacyPaths = managementLegacyRedirects.map(route => route.path)

  assert.equal(legacyPaths.includes('/system/audit'), false)
  assert.equal(legacyPaths.includes('/system/application-settings'), false)
  assert.equal(new Set(legacyPaths).size, legacyPaths.length)
})
