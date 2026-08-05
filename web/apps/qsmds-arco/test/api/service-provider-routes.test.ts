import type { MenuRecordRaw } from '@fantastic-admin/types'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由契约使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import serviceProviderRoutes, {
  SERVICE_PROVIDER_READ_PERMISSIONS,
} from '../../src/router/modules/service.provider'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'

test('合作供方父路由权限中立且供应商叶子固定要求 suppliers:read', () => {
  assert.equal(serviceProviderRoutes.path, '/system/service-provider')
  assert.equal(serviceProviderRoutes.name, 'systemServiceProvider')
  assert.equal(serviceProviderRoutes.meta?.title, '合作供方')
  assert.equal(serviceProviderRoutes.meta?.auth, undefined)
  assert.equal(typeof serviceProviderRoutes.component, 'function')
  assert.deepEqual(SERVICE_PROVIDER_READ_PERMISSIONS, ['suppliers:read'])

  assert.equal(serviceProviderRoutes.children?.length, 1)
  const supplierRoute = serviceProviderRoutes.children?.[0]
  assert.equal(supplierRoute?.path, 'suppliers')
  assert.equal(supplierRoute?.name, 'systemServiceProviderSuppliers')
  assert.equal(supplierRoute?.meta?.title, '供应商管理')
  assert.equal(supplierRoute?.meta?.auth, 'suppliers:read')
  assert.equal(typeof supplierRoute?.component, 'function')
  assert.equal(
    matchesAuthorization(['suppliers:read'], supplierRoute?.meta?.auth),
    true,
  )
  assert.equal(matchesAuthorization([], supplierRoute?.meta?.auth), false)
})

test('无供应商读取权限时递归隐藏空的合作供方菜单', () => {
  const menuFixture: MenuRecordRaw[] = [{
    path: serviceProviderRoutes.path,
    meta: {
      auth: serviceProviderRoutes.meta?.auth,
      title: serviceProviderRoutes.meta?.title,
    },
    children: (serviceProviderRoutes.children ?? []).map(route => ({
      path: route.path,
      meta: { auth: route.meta?.auth, title: route.meta?.title },
    })),
  }]
  const visibleMenus = (permissions: string[]) => filterAccessibleMenus(
    menuFixture,
    value => matchesAuthorization(permissions, value),
    () => true,
  )

  assert.deepEqual(visibleMenus([]), [])
  assert.equal(visibleMenus(['suppliers:read'])[0]?.path, serviceProviderRoutes.path)
  assert.equal(visibleMenus(['suppliers:read'])[0]?.children?.[0]?.path, 'suppliers')
})

test('合作供方注册在系统管理下并独立参与首页读取权限', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    routesSource,
    /import ServiceProvider, \{[\s\S]*?SERVICE_PROVIDER_READ_PERMISSIONS,[\s\S]*?\} from '\.\/modules\/service\.provider'/u,
  )
  assert.match(
    routesSource,
    /auth: \[[\s\S]*?\.\.\.MANAGEMENT_READ_PERMISSIONS,[\s\S]*?\.\.\.SERVICE_PROVIDER_READ_PERMISSIONS,[\s\S]*?\]/u,
  )
  assert.match(
    routesSource,
    /title: '系统管理'[\s\S]*?children: \[[\s\S]*?SystemManagement,[\s\S]*?BasicData,[\s\S]*?ServiceProvider,[\s\S]*?ApplicationSettings/u,
  )
})
