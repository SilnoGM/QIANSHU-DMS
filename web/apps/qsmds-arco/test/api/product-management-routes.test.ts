import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与占位页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import productManagementRoutes, {
  PRODUCT_MANAGEMENT_PERMISSIONS,
} from '../../src/router/modules/product.management'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'

test('管理员工作台注册产品管理的创建、列表与隐藏编辑路由', () => {
  assert.deepEqual(PRODUCT_MANAGEMENT_PERMISSIONS, [
    'products:read',
    'products:create',
    'products:update',
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
      {
        auth: 'products:update',
        name: 'adminProductEdit',
        path: ':productId/edit',
        title: '编辑产品',
      },
    ],
  )
  const editRoute = productManagementRoutes.children?.find(
    route => route.name === 'adminProductEdit',
  )
  assert.equal(editRoute?.meta?.menu, false)
  assert.equal(editRoute?.meta?.activeMenu, '/admin/products/list')
  assert.ok(
    productManagementRoutes.children?.every(
      route => typeof route.component === 'function',
    ),
  )
})

test('管理员工作台保留产品管理，资金账户迁移至财务工作台', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )
  const asyncRoutesSource = routesSource.slice(
    routesSource.indexOf('const asyncRoutes'),
  )
  const administratorWorkbenchSource = asyncRoutesSource.slice(
    asyncRoutesSource.indexOf('title: \'管理员工作台\''),
    asyncRoutesSource.indexOf('title: \'系统管理\''),
  )
  const productPermissionIndex = administratorWorkbenchSource.indexOf(
    '...PRODUCT_MANAGEMENT_PERMISSIONS',
  )
  const financeSource = readFileSync(new URL('../../src/router/modules/role.workbenches.ts', import.meta.url), 'utf8')
  const productRouteIndex = administratorWorkbenchSource.indexOf(
    'ProductManagement,',
  )

  assert.ok(productPermissionIndex >= 0)
  assert.ok(productRouteIndex > productPermissionIndex)
  assert.doesNotMatch(administratorWorkbenchSource, /FUND_ACCOUNT_MANAGEMENT_PERMISSIONS|FundAccountManagement/u)
  assert.match(financeSource, /FUND_ACCOUNT_MANAGEMENT_PERMISSIONS/u)
  assert.match(financeSource, /FundAccountManagement,/u)
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
    children: (productManagementRoutes.children ?? [])
      .filter(route => route.meta?.menu !== false)
      .map(route => ({
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
  assert.deepEqual(visiblePaths(['products:update']), [])
  assert.deepEqual(
    visiblePaths(['products:read', 'products:create', 'products:update']),
    ['create', 'list'],
  )
  assert.deepEqual(visiblePaths([]), [])
})

test('新增产品页面已接入正式表单与写入编排', () => {
  const source = readFileSync(new URL(
    '../../src/views/admin/product-management/create/index.vue',
    import.meta.url,
  ), 'utf8')

  assert.match(source, /<script setup lang="ts">/u)
  assert.match(source, /<FaPageHeader/u)
  assert.match(source, /<FaPageMain/u)
  assert.match(source, /<ProductForm/u)
  assert.match(source, /productsApi\.create/u)
  assert.match(source, /products:create/u)
  assert.doesNotMatch(source, /新增产品功能将在后续版本开放/u)
})
