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
  // 主导航组权限并集在装配区之前声明，产品读取权限必须留在并集内并覆盖一级子路由。
  const workbenchPermissionUnion = routesSource.match(
    /const ADMIN_WORKBENCH_PERMISSIONS = \[([\s\S]*?)\]/u,
  )?.[1] ?? ''
  const financeSource = readFileSync(new URL('../../src/router/modules/role.workbenches.ts', import.meta.url), 'utf8')
  const fundAccountSource = readFileSync(new URL('../../src/router/modules/fund-account.management.ts', import.meta.url), 'utf8')
  const productRouteIndex = administratorWorkbenchSource.indexOf(
    'ProductManagement,',
  )

  assert.match(workbenchPermissionUnion, /\.\.\.PRODUCT_MANAGEMENT_PERMISSIONS/u)
  assert.match(administratorWorkbenchSource, /auth: \[\.\.\.ADMIN_WORKBENCH_PERMISSIONS\]/u)
  assert.ok(productRouteIndex >= 0)
  assert.doesNotMatch(administratorWorkbenchSource, /FUND_ACCOUNT_MANAGEMENT_PERMISSIONS|FundAccountManagement/u)
  // 账户管理挂在财务工作台下；财务分组的准入由工作台准入码决定，账户管理自身
  // 仍用 FUND_ACCOUNT_MANAGEMENT_PERMISSIONS 收敛，不随分组门槛改动而放宽。
  assert.match(financeSource, /FundAccountManagement,/u)
  assert.match(fundAccountSource, /FUND_ACCOUNT_MANAGEMENT_PERMISSIONS/u)
  assert.match(fundAccountSource, /auth: \[\.\.\.FUND_ACCOUNT_MANAGEMENT_PERMISSIONS\]/u)
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
