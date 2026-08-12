import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与占位页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import productManagementRoutes, {
  PRODUCT_MANAGEMENT_PERMISSIONS,
} from '../../src/router/modules/product.management'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'

test('管理员工作台注册产品管理的两个权限隔离页面', () => {
  assert.deepEqual(PRODUCT_MANAGEMENT_PERMISSIONS, [
    'products:read',
    'products:create',
  ])
  assert.equal(productManagementRoutes.path, '/admin/products')
  assert.equal(productManagementRoutes.name, 'adminProductManagement')
  assert.equal(productManagementRoutes.meta?.title, '产品管理')
  assert.deepEqual(
    productManagementRoutes.children?.map(route => ({
      auth: route.meta?.auth,
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      {
        auth: 'products:create',
        name: 'adminProductCreate',
        path: 'create',
        title: '新增产品',
      },
      {
        auth: 'products:read',
        name: 'adminProductList',
        path: 'list',
        title: '产品列表',
      },
    ],
  )
  assert.ok(
    productManagementRoutes.children?.every(
      route => typeof route.component === 'function',
    ),
  )
})

test('管理员工作台是第一项独立顶部导航并挂载产品管理', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )
  const asyncRoutesSource = routesSource.slice(
    routesSource.indexOf('const asyncRoutes'),
  )

  assert.match(
    asyncRoutesSource,
    /title: '管理员工作台'[\s\S]*?auth: \[\.\.\.PRODUCT_MANAGEMENT_PERMISSIONS\][\s\S]*?children: \[[\s\S]*?ProductManagement/u,
  )
  assert.ok(
    asyncRoutesSource.indexOf('title: \'管理员工作台\'')
    < asyncRoutesSource.indexOf('title: \'系统管理\''),
  )
})

test('产品权限精确控制菜单和直接访问资格', () => {
  const menuFixture = [{
    path: productManagementRoutes.path,
    meta: {
      auth: productManagementRoutes.meta?.auth,
      title: productManagementRoutes.meta?.title,
    },
    children: (productManagementRoutes.children ?? []).map(route => ({
      path: route.path,
      meta: {
        auth: route.meta?.auth,
        title: route.meta?.title,
      },
    })),
  }]
  const visiblePaths = (permissions: string[]) => filterAccessibleMenus(
    menuFixture,
    value => matchesAuthorization(permissions, value),
    () => true,
  )[0]?.children?.map(menu => menu.path) ?? []

  assert.deepEqual(visiblePaths(['products:create']), ['create'])
  assert.deepEqual(visiblePaths(['products:read']), ['list'])
  assert.deepEqual(
    visiblePaths(['products:read', 'products:create']),
    ['create', 'list'],
  )
  assert.deepEqual(visiblePaths([]), [])
})

test('仅新增产品页面继续保持单按钮占位边界', () => {
  const source = readFileSync(new URL(
    '../../src/views/admin/product-management/create/index.vue',
    import.meta.url,
  ), 'utf8')

  assert.equal(source.match(/<FaButton(?:\s|>)/gu)?.length, 1)
  assert.equal(source.match(/<\/FaButton>/gu)?.length, 1)
  assert.match(source, />新增产品<\/FaButton>/u)
  assert.doesNotMatch(source, /<script|<style/u)
})
